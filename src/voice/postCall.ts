// ElevenLabs post-call webhook → short text follow-up via Photon.
// Route: POST /voice/post-call with the RAW body (HMAC needs the exact bytes).
// Never stores transcripts (AGENTS.md §10, §14).
import { createHmac, timingSafeEqual } from "node:crypto";
// ponytail: assumed signatures from teammates' modules; adjust here if theirs differ.
import { findUserByPhone } from "../db/users.js";
import { sendText } from "../channels/photon.js";
import { scrubBannedWords } from "../core/bannedWords.js";

const MAX_AGE_SECS = 30 * 60;
const FOOTER = "Automated check — it can be wrong. Verify with the company directly.";

// Header format: "t=<unix>,v0=<hex hmac-sha256 of `${t}.${rawBody}`>"
export function verifySignature(rawBody: Buffer | string, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.trim());
  const t = parts.find((p) => p.startsWith("t="))?.slice(2);
  const sigs = parts.filter((p) => p.startsWith("v0=")).map((p) => p.slice(3));
  if (!t || sigs.length === 0) return false;
  if (!(Math.abs(Date.now() / 1000 - Number(t)) <= MAX_AGE_SECS)) return false;

  const expected = createHmac("sha256", secret).update(`${t}.`).update(rawBody).digest();
  return sigs.some((hex) => {
    const given = Buffer.from(hex, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

interface PostCallEvent {
  type: string;
  data?: {
    conversation_id?: string;
    analysis?: { data_collection_results?: Record<string, { value?: unknown }> };
    conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> };
  };
}

// Returns the HTTP status to send back. Only a bad signature returns non-200,
// since ElevenLabs disables the webhook after repeated failures.
export async function handlePostCall(rawBody: Buffer | string, signature: string | undefined): Promise<number> {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret || !verifySignature(rawBody, signature, secret)) return 401;

  const event = JSON.parse(rawBody.toString()) as PostCallEvent;
  if (event.type !== "post_call_transcription" || !event.data) return 200;

  const vars = event.data.conversation_initiation_client_data?.dynamic_variables ?? {};
  let user = null;
  for (const phone of [vars.system__caller_id, vars.system__called_number]) {
    if (typeof phone === "string" && (user = await findUserByPhone(phone))) break;
  }
  if (!user) return 200;

  // `followup_text` is a Data Collection field on the agent (see agentPrompt.md),
  // written by ElevenLabs in the caller's language, so no extra LLM call here.
  const followup = event.data.analysis?.data_collection_results?.followup_text?.value;
  const scamType = typeof vars.scam_type === "string" && vars.scam_type !== "none" ? vars.scam_type : null;
  const text =
    typeof followup === "string" && followup.trim()
      ? followup.trim()
      : scamType
        ? `Following up on our call about the ${scamType}. Don't click, reply, or pay. Text me if you have questions.`
        : "Thanks for calling ScamCheck. Text me anytime if something else looks off.";

  try {
    // followup_text is LLM-written, so it gets the same banned-words pass as analyze.ts.
    await sendText(user.phone, `${scrubBannedWords(text)}\n\n${FOOTER}`);
  } catch (err) {
    console.error(`post-call follow-up failed conv=${event.data.conversation_id} error=${(err as Error).name}`);
  }
  return 200;
}
