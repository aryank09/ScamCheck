import { sendText } from "../channels/photon.js";
import { createCase } from "../db/cases.js";
import { createUser, findUserByFamilyPhone, findUserByPhone, normalizePhone, type User } from "../db/users.js";
import { handleCommand } from "./commands.js";
import { alertFamily, relayFamilyReply } from "./familyRelay.js";
import { recentSummaries } from "./memory.js";
import { alertCopy, deliverVoice } from "./notify.js";
import { advanceOnboarding, currentPrompt } from "./onboarding.js";
import { analyze } from "./analyze.js";
import type { ParsedMessage } from "./types.js";

const seen = new Set<string>();

export async function handleInboundText(messageId: string, phone: string, text: string): Promise<void> {
  if (seen.has(messageId)) return;
  seen.add(messageId);
  const normalized = normalizePhone(phone);

  const family = await findUserByFamilyPhone(normalized);
  if (family && family.user.phone !== normalized) {
    const reply = await relayFamilyReply(family.user, family.contact, text);
    await sendText(normalized, reply);
    return;
  }

  const user = (await findUserByPhone(normalized)) ?? (await createUser(normalized));
  const command = user.onboardingStep === "done" ? await handleCommand(user, text) : await stopOnly(user, text);
  if (command) {
    await sendText(normalized, command);
    return;
  }

  const forwarded = looksForwarded(text);
  if (forwarded) await checkForward(user, normalized, text);

  if (user.onboardingStep !== "done") {
    const prompt = forwarded ? currentPrompt(user) : await advanceOnboarding(user, text);
    if (prompt) await sendText(normalized, prompt);
    return;
  }

  if (!forwarded) await sendText(normalized, "Forward a message and I will check it, or send HELP.");
}

async function stopOnly(user: User, text: string): Promise<string | null> {
  if (!/^stop\b/i.test(text.trim())) return null;
  return handleCommand(user, text);
}

async function checkForward(user: User, phone: string, text: string): Promise<void> {
  await sendText(phone, "Checking…");
  const message: ParsedMessage = {
    source: "imessage",
    from: phone,
    text,
    links: [],
  };
  const result = await analyze(message, {
    language: user.language,
    recentCaseSummaries: await recentSummaries(user),
  });
  const low = result.risk_score < 40;
  await sendText(phone, alertCopy(result, low));
  if (!low) await deliverVoice(phone, result.spoken_summary);
  const caseId = await createCase({
    userId: user._id,
    familyGroupId: user.familyGroupId,
    source: "imessage",
    verdict: result.verdict,
    riskScore: result.risk_score,
    scamType: result.scam_type,
    claimedBrand: result.claimed_brand ?? undefined,
    summary: result.case_summary,
    notifiedVia: ["text"],
    familyAlerted: false,
    latencyMs: 0,
  });
  if (result.risk_score >= 75 && user.familyContacts.length > 0) {
    await alertFamily(user, { scamType: result.scam_type, caseId: String(caseId) });
  }
}

function looksForwarded(text: string): boolean {
  return /https?:\/\//i.test(text) || text.trim().length > 180;
}
