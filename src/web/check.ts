// POST /api/check: the same pipeline a forwarded iMessage gets (rules → Gemini → banned-word scrub),
// exposed for VEYZL audits. Bearer-protected so the public can't spend Gemini credits.
// Stateless: no case is stored and message text is never logged (AGENTS.md §14).
import { timingSafeEqual } from "node:crypto";
import { analyze } from "../core/analyze.js";
import { isAssistantRequest, preCheck, redactOutput, withRefusal } from "../core/guardrails.js";
import { imageMime, type AnalysisImage } from "../core/images.js";
import { alertCopy } from "../core/notify.js";

const MAX_TEXT = 4000;

export function checkAuditToken(authorization: string | undefined): boolean {
  const secret = process.env.VEYZL_AUDIT_TOKEN;
  const given = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!secret || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Accept the common chat shapes: { text }, { message }, { prompt }, { input }, or OpenAI-style { messages }. */
export function checkText(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const body = payload as Record<string, unknown>;
  for (const key of ["text", "message", "prompt", "input"]) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, MAX_TEXT);
  }
  if (Array.isArray(body.messages)) {
    const last = body.messages.at(-1) as { content?: unknown } | undefined;
    if (typeof last?.content === "string" && last.content.trim()) return last.content.trim().slice(0, MAX_TEXT);
  }
  return "";
}

export async function runCheck(payload: unknown): Promise<{ status: number; body: object }> {
  const text = checkText(payload);
  if (!text) return { status: 400, body: { error: "Send the message to check as { \"text\": \"...\" }." } };
  const requested = (payload as { language?: unknown }).language;
  const language = typeof requested === "string" && /^[a-z]{2}$/.test(requested) ? requested : "en";

  const guard = preCheck(text, /https?:\/\//i.test(text));
  if (guard) return { status: 200, body: { reply: guard.reply, guard: guard.guard, verdict: null } };

  const image = checkImage(payload);
  const result = await analyze({ source: "imessage", text, links: [] }, { language, recentCaseSummaries: [] }, image);
  if (image) image.data.fill(0);
  return {
    status: 200,
    body: {
      reply: reply(text, result),
      verdict: result.verdict,
      risk_score: result.risk_score,
      scam_type: redactOutput(result.scam_type),
      red_flags: result.red_flags.map(redactOutput),
      action: redactOutput(result.action),
      spoken_summary: redactOutput(result.spoken_summary),
    },
  };
}

function reply(text: string, result: Awaited<ReturnType<typeof analyze>>): string {
  const lowRisk = result.risk_score < 40;
  const copy = alertCopy(result, lowRisk);
  return isAssistantRequest(text) ? withRefusal(copy, lowRisk) : copy;
}

/** Optional screenshot: a data URL or bare base64 PNG/JPEG. Held in memory for one call. */
function checkImage(payload: unknown): AnalysisImage | undefined {
  const raw = (payload as { image?: unknown }).image;
  if (typeof raw !== "string" || !raw) return undefined;
  const match = raw.match(/^data:([^;,]+);base64,(.*)$/s);
  const data = Buffer.from(match ? match[2]! : raw, "base64");
  if (data.length === 0) return undefined;
  const sniffed = data[0] === 0x89 ? "image/png" : data[0] === 0xff ? "image/jpeg" : undefined;
  const mimeType = imageMime(match?.[1] ?? sniffed);
  return mimeType ? { mimeType, data } : undefined;
}
