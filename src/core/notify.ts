import { sendText, sendVoiceNote } from "../channels/photon.js";
import { createCase, listDeferredCalls, updateCase } from "../db/cases.js";
import { findUserById, type User } from "../db/users.js";
import { startWarningCall } from "../voice/outbound.js";
import type { AnalysisResult } from "./types.js";
import { alertFamily } from "./familyRelay.js";
import { tts } from "./tts.js";
import { scrubBannedWords } from "./bannedWords.js";
import { redactOutput } from "./guardrails.js";
import { isQuietHours, quietHoursResumeAt } from "./quietHours.js";

const FOOTER = "Automated check — it can be wrong. Verify with the company directly.";

/** none: store the case and stay quiet. text: text plus voice note. call: those, plus a call and family alert. */
export function notifyLevel(result: AnalysisResult): "none" | "text" | "call" {
  if (result.modelFailed && result.rulesFloor < 75) return "none";
  if (result.risk_score < 40) return "none";
  if (result.risk_score < 75) return "text";
  return "call";
}

export function alertCopy(result: AnalysisResult, short: boolean): string {
  if (result.modelFailed && result.risk_score < 75) {
    return scrubBannedWords("I could not finish checking this message. Please do not click links or share codes.");
  }
  if (short || result.risk_score < 40) {
    return scrubBannedWords("I don't see red flags, but be careful.");
  }
  const icon = result.risk_score >= 75 ? "🚨" : "⚠️";
  const label = result.verdict === "scam" || result.risk_score >= 75 ? "This is a scam" : "This looks suspicious";
  const flags = result.red_flags.slice(0, 3).map((flag) => `- ${scrubBannedWords(flag)}`).join("\n");
  return redactOutput(scrubBannedWords(`${icon} ${label}\n${flags}\n${result.action}\n\n${FOOTER}`));
}

/** The only place that chooses call vs text vs silence for an email. */
export async function notifyEmail(user: User, result: AnalysisResult): Promise<void> {
  const caseId = await createCase({
    userId: user._id,
    familyGroupId: user.familyGroupId,
    source: "email",
    verdict: result.verdict,
    riskScore: result.risk_score,
    scamType: result.scam_type,
    claimedBrand: result.claimed_brand ?? undefined,
    summary: result.case_summary,
    notifiedVia: [],
    familyAlerted: false,
    latencyMs: 0,
  });
  const id = String(caseId);
  const level = notifyLevel(result);
  if (level === "none") return;

  // A failed text must not stop the warning call below: the call is the high-risk path.
  try {
    await sendText(user.phone, alertCopy(result, false), user.messagePlatform);
    await updateCase(id, { notifiedVia: "text" });
  } catch (error) {
    console.error("alert text failed case=" + id + " error=" + (error as Error).name);
  }
  if (user.messagePlatform === "imessage") await deliverVoice(user.phone, result.spoken_summary);

  if (level === "text") return;
  await deliverWarningCall(user, id, result);
  if (user.familyContacts.length > 0) await alertFamily(user, { scamType: result.scam_type, caseId: id });
}

/**
 * Place the warning call, or hold it until quiet hours end.
 * Paid/clicked passes force=true: that call goes out immediately.
 */
export async function deliverWarningCall(
  user: User,
  caseId: string,
  result: Pick<AnalysisResult, "claimed_brand" | "scam_type" | "spoken_summary">,
  force = false,
): Promise<void> {
  const opening = redactOutput(scrubBannedWords(result.spoken_summary));
  if (!force && isQuietHours(user.quietHours)) {
    await updateCase(caseId, { callDeferredUntil: quietHoursResumeAt(user.quietHours), callOpening: opening });
    return;
  }
  const conversationId = await startWarningCall({
    toPhone: user.phone,
    caseId,
    language: user.language,
    userName: user.displayName,
    brand: result.claimed_brand ?? undefined,
    scamType: result.scam_type,
    opening,
  });
  if (conversationId) await updateCase(caseId, { notifiedVia: "call", callDeferredUntil: null });
}

/** Morning pass for calls that waited out quiet hours. */
export async function placeDeferredCalls(now = new Date()): Promise<void> {
  const due = await listDeferredCalls(now);
  for (const item of due) {
    const user = await findUserById(item.userId);
    if (!user) {
      await updateCase(String(item._id), { callDeferredUntil: null });
      continue;
    }
    if (isQuietHours(user.quietHours, now)) continue;
    const conversationId = await startWarningCall({
      toPhone: user.phone,
      caseId: String(item._id),
      language: user.language,
      userName: user.displayName,
      brand: item.claimedBrand,
      scamType: item.scamType,
      opening: item.callOpening,
    });
    if (conversationId) {
      await updateCase(String(item._id), { notifiedVia: "call", callDeferredUntil: null });
    } else {
      await updateCase(String(item._id), { callDeferredUntil: new Date(now.getTime() + 15 * 60 * 1000) });
    }
  }
}

export async function deliverVoice(phone: string, spoken: string): Promise<void> {
  const audio = await tts(redactOutput(scrubBannedWords(spoken)));
  if (!audio) return;
  try {
    await sendVoiceNote(phone, audio);
  } catch (error) {
    console.error("voice note failed error=" + (error as Error).name);
  }
}
