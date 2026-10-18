import { downloadInboundImage, sendText, type InboundText } from "../channels/photon.js";
import { createCase } from "../db/cases.js";
import { createUser, findUserByFamilyPhone, findUserByPhone, normalizePhone, type User } from "../db/users.js";
import { dashboardReply, handleCommand } from "./commands.js";
import { alertFamily, relayFamilyReply } from "./familyRelay.js";
import type { AnalysisImage } from "./images.js";
import { recentSummaries } from "./memory.js";
import { alertCopy, deliverVoice, notifyLevel } from "./notify.js";
import { advanceOnboarding, currentPrompt } from "./onboarding.js";
import { analyze } from "./analyze.js";
import { isAssistantRequest, preCheck, withRefusal } from "./guardrails.js";
import type { ParsedMessage } from "./types.js";

const seen = new Set<string>();

export async function handleInboundText(message: InboundText): Promise<void> {
  if (seen.has(message.id)) return;
  const normalized = normalizePhone(message.phone);

  const family = await findUserByFamilyPhone(normalized);
  if (family && family.user.phone !== normalized) {
    if (/^dashboard\b/i.test(message.text.trim())) {
      await sendText(normalized, await dashboardReply(family.user));
      seen.add(message.id);
      return;
    }
    const reply = message.text.trim()
      ? await relayFamilyReply(family.user, family.contact, message.text)
      : "Send that as a text and I will pass it on.";
    await sendText(normalized, reply);
    seen.add(message.id);
    return;
  }

  let image: AnalysisImage | undefined;
  if (message.attachmentId) {
    const downloaded = await downloadInboundImage(message.attachmentId);
    if (!downloaded) {
      await sendText(normalized, "Send the message as text, or forward a photo of it.");
      seen.add(message.id);
      return;
    }
    image = downloaded;
  }

  const user = (await findUserByPhone(normalized)) ?? (await createUser(normalized));
  const command = user.onboardingStep === "done" ? await handleCommand(user, message.text) : await stopOnly(user, message.text);
  if (command) {
    await sendText(normalized, command);
    seen.add(message.id);
    return;
  }

  const forwarded = Boolean(image) || looksForwarded(message.text);
  if (forwarded) await checkForward(user, normalized, message.text, image);

  if (user.onboardingStep !== "done") {
    const prompt = forwarded ? currentPrompt(user) : await advanceOnboarding(user, message.text);
    if (prompt) await sendText(normalized, prompt);
    seen.add(message.id);
    return;
  }

  if (!forwarded) await sendText(normalized, "Forward a message and I will check it, or send HELP.");
  seen.add(message.id);
}

async function stopOnly(user: User, text: string): Promise<string | null> {
  if (!/^stop\b/i.test(text.trim())) return null;
  return handleCommand(user, text);
}

async function checkForward(
  user: User,
  phone: string,
  text: string,
  image?: AnalysisImage,
): Promise<void> {
  // Crisis, or a parent pasting their own card/SSN: fixed reply, no model.
  const guard = preCheck(text, /https?:\/\//i.test(text));
  if (guard) {
    if (image) image.data.fill(0);
    await sendText(phone, guard.reply);
    return;
  }
  await sendText(phone, "Checking…");
  const message: ParsedMessage = {
    source: "imessage",
    from: phone,
    text,
    links: [],
  };
  const result = await analyze(
    message,
    {
      language: user.language,
      recentCaseSummaries: await recentSummaries(user),
    },
    image,
  );
  if (image) image.data.fill(0);
  const level = notifyLevel(result);
  const copy = alertCopy(result, level === "none");
  await sendText(phone, isAssistantRequest(text) ? withRefusal(copy, level === "none") : copy);
  if (level !== "none") await deliverVoice(phone, result.spoken_summary);
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
  if (level === "call" && user.familyContacts.length > 0) {
    await alertFamily(user, { scamType: result.scam_type, caseId: String(caseId) });
  }
}

function looksForwarded(text: string): boolean {
  return /https?:\/\//i.test(text) || text.trim().length > 180;
}
