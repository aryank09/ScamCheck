import { downloadInboundImage, sendText, type InboundText } from "../channels/photon.js";
import { createCase } from "../db/cases.js";
import {
  createUser,
  findUserByFamilyPhone,
  findUserByPhone,
  normalizePhone,
  saveUser,
  setFamilyContactPlatform,
  type User,
} from "../db/users.js";
import { dashboardReply, handleCommand } from "./commands.js";
import { alertFamily, relayFamilyReply } from "./familyRelay.js";
import type { AnalysisImage } from "./images.js";
import { recentSummaries } from "./memory.js";
import { alertCopy, deliverVoice, notifyLevel } from "./notify.js";
import { advanceOnboarding, currentPrompt } from "./onboarding.js";
import { applyAddedParent } from "./parentProfile.js";
import { analyze } from "./analyze.js";
import { isAssistantRequest, preCheck, withRefusal } from "./guardrails.js";
import type { ParsedMessage } from "./types.js";

const seen = new Set<string>();

export async function handleInboundText(message: InboundText): Promise<void> {
  const eventKey = `${message.platform}:${message.id}`;
  if (seen.has(eventKey)) return;
  const normalized = normalizePhone(message.phone);

  const family = await findUserByFamilyPhone(normalized);
  if (family && family.user.phone !== normalized) {
    if (/^dashboard\b/i.test(message.text.trim())) {
      await sendText(normalized, await dashboardReply(family.user), message.platform);
      seen.add(eventKey);
      return;
    }
    if (family.contact.messagePlatform !== message.platform) {
      await setFamilyContactPlatform(family.user._id, normalized, message.platform);
      family.contact.messagePlatform = message.platform;
    }
    const reply = message.text.trim()
      ? await relayFamilyReply(family.user, family.contact, message.text)
      : "Send that as a text and I will pass it on.";
    await sendText(normalized, reply, message.platform);
    seen.add(eventKey);
    return;
  }

  let image: AnalysisImage | undefined;
  if (message.attachmentId) {
    const downloaded = await downloadInboundImage(message.attachmentId);
    if (!downloaded) {
      await sendText(normalized, "Send the message as text, or forward a photo of it.", message.platform);
      seen.add(eventKey);
      return;
    }
    image = downloaded;
  }

  const user = (await findUserByPhone(normalized)) ?? (await createUser(normalized, message.platform));
  if (user.messagePlatform !== message.platform) {
    user.messagePlatform = message.platform;
    await saveUser(user._id, { messagePlatform: message.platform });
  }
  const command = user.onboardingStep === "done" ? await handleCommand(user, message.text) : await stopOnly(user, message.text);
  if (command) {
    await sendText(normalized, command, message.platform);
    seen.add(eventKey);
    return;
  }

  await applyAddedParent(user);

  const forwarded = Boolean(image) || looksForwarded(message.text);
  if (forwarded) await checkForward(user, normalized, message.text, message.platform, image);

  if (user.onboardingStep !== "done") {
    const prompt = forwarded ? currentPrompt(user) : await advanceOnboarding(user, message.text);
    if (prompt) await sendText(normalized, prompt, message.platform);
    seen.add(eventKey);
    return;
  }

  if (!forwarded) await sendText(normalized, "Forward a message and I will check it, or send HELP.", message.platform);
  seen.add(eventKey);
}

async function stopOnly(user: User, text: string): Promise<string | null> {
  if (!/^stop\b/i.test(text.trim())) return null;
  return handleCommand(user, text);
}

async function checkForward(
  user: User,
  phone: string,
  text: string,
  platform: InboundText["platform"],
  image?: AnalysisImage,
): Promise<void> {
  // Crisis, or a parent pasting their own card/SSN: fixed reply, no model.
  const guard = preCheck(text, /https?:\/\//i.test(text));
  if (guard) {
    if (image) image.data.fill(0);
    await sendText(phone, guard.reply, platform);
    return;
  }
  await sendText(phone, "Checking…", platform);
  const message: ParsedMessage = {
    source: platform,
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
  await sendText(phone, isAssistantRequest(text) ? withRefusal(copy, level === "none") : copy, platform);
  if (level !== "none" && platform === "imessage") await deliverVoice(phone, result.spoken_summary);
  const caseId = await createCase({
    userId: user._id,
    familyGroupId: user.familyGroupId,
    source: platform,
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
