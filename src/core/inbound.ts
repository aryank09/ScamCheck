import { downloadInboundImage, sendText, type InboundText } from "../channels/photon.js";
import { createCase, listCasesForUser } from "../db/cases.js";
import { claimInbound, releaseInbound } from "../db/inbound.js";
import {
  createUser,
  findUsersByFamilyPhone,
  findUserByPhone,
  joinFamilyGroups,
  normalizePhone,
  saveUser,
  setFamilyContactPlatform,
  type FamilyContact,
  type User,
} from "../db/users.js";
import { handleCommand, isUserCommand } from "./commands.js";
import { alertFamily, relayFamilyReply } from "./familyRelay.js";
import type { AnalysisImage } from "./images.js";
import { recentSummaries } from "./memory.js";
import { alertCopy, deliverVoice, deliverWarningCall, notifyLevel } from "./notify.js";
import { advanceOnboarding, currentPrompt } from "./onboarding.js";
import { applyAddedParent } from "./parentProfile.js";
import { analyze } from "./analyze.js";
import { isAssistantRequest, preCheck, withRefusal } from "./guardrails.js";
import type { ParsedMessage } from "./types.js";

const seen = new Set<string>();
// A send that keeps failing (e.g. Photon SMS_CAMPAIGN_NOT_ELIGIBLE) must not block the inbox forever.
const MAX_ATTEMPTS = 3;
const attempts = new Map<string, number>();

/**
 * True when the message is finished (handled, or already seen).
 * False when it failed before anything was sent, so the poll should retry it.
 */
export async function handleInboundText(message: InboundText): Promise<boolean> {
  const eventKey = `${message.platform}:${message.id}`;
  if (seen.has(eventKey)) return true;
  const claimed = await claimInbound(message.platform, message.id);
  if (!claimed) {
    seen.add(eventKey);
    return true;
  }
  seen.add(eventKey);
  const progress = { sent: false };
  try {
    await dispatch(message, progress);
    return true;
  } catch (error) {
    console.error("inbound message failed error=" + (error as Error).name);
    if (progress.sent) return true;
    const tries = (attempts.get(eventKey) ?? 0) + 1;
    if (tries >= MAX_ATTEMPTS) {
      // Give up on this one so later messages still get answered. It stays claimed, so it isn't retried.
      attempts.delete(eventKey);
      console.error(`inbound message dropped after ${tries} attempts`);
      return true;
    }
    attempts.set(eventKey, tries);
    seen.delete(eventKey);
    await releaseInbound(message.platform, message.id);
    return false;
  }
}

async function dispatch(message: InboundText, progress: { sent: boolean }): Promise<void> {
  const normalized = normalizePhone(message.phone);
  let image: AnalysisImage | undefined;
  if (message.attachmentId) {
    const downloaded = await downloadInboundImage(message.attachmentId);
    if (!downloaded) {
      await reply(normalized, "Send the message as text, or forward a photo of it.", message, progress);
      return;
    }
    image = downloaded;
  }

  const text = message.text.trim();
  const existing = await findUserByPhone(normalized);
  // A person still onboarding owns their texts. A helper's short reply does not.
  const ownMessage =
    Boolean(image) || looksForwarded(text) || isUserCommand(text) || (existing !== null && existing.onboardingStep !== "done");
  if (!ownMessage) {
    const target = await relayTarget(normalized);
    if (target) {
      if (target.contact.messagePlatform !== message.platform) {
        await setFamilyContactPlatform(target.user._id, normalized, message.platform);
        target.contact.messagePlatform = message.platform;
      }
      const note = text
        ? await relayFamilyReply(target.user, target.contact, text)
        : "Send that as a text and I will pass it on.";
      await reply(normalized, note, message, progress);
      return;
    }
  }

  const user = existing ?? (await createUser(normalized, message.platform));
  if (user.messagePlatform !== message.platform) {
    user.messagePlatform = message.platform;
    await saveUser(user._id, { messagePlatform: message.platform });
  }
  await applyAddedParent(user);
  await joinFamilyGroups(user);

  if (/^allow\b/i.test(text) && !image) {
    const answer = await handleCommand(user, text);
    const prompt = user.onboardingStep !== "done" ? currentPrompt(user) : "";
    await reply(normalized, prompt && answer ? `${answer}\n\n${prompt}` : (answer ?? ""), message, progress);
    return;
  }

  const command = user.onboardingStep === "done" ? await handleCommand(user, text) : await stopOnly(user, text);
  if (command) {
    await reply(normalized, command, message, progress);
    return;
  }

  const forwarded = Boolean(image) || looksForwarded(text);
  if (forwarded) await checkForward(user, normalized, text, message, progress, image);

  if (user.onboardingStep !== "done") {
    const prompt = forwarded ? currentPrompt(user) : await advanceOnboarding(user, text);
    if (prompt) await reply(normalized, prompt, message, progress);
    return;
  }

  if (!forwarded) await reply(normalized, "Forward a message and I will check it, or send HELP.", message, progress);
}

async function reply(
  phone: string,
  text: string,
  message: InboundText,
  progress: { sent: boolean },
  commit = true,
): Promise<void> {
  await sendText(phone, text, message.platform);
  if (commit) progress.sent = true;
}

async function stopOnly(user: User, text: string): Promise<string | null> {
  if (!/^stop\b/i.test(text.trim())) return null;
  return handleCommand(user, text);
}

/** The parent with the newest open warning who listed this phone. Not an arbitrary one. */
async function relayTarget(phone: string): Promise<{ user: User; contact: FamilyContact } | null> {
  const matches = await findUsersByFamilyPhone(phone);
  let best: { user: User; contact: FamilyContact; at: number } | null = null;
  for (const match of matches) {
    if (match.user.phone === phone) continue;
    const cases = await listCasesForUser(match.user._id, 7);
    const open = cases.find((item) => item.verdict !== "no_red_flags" && !item.familyResponse);
    if (!open) continue;
    const at = open.createdAt.getTime();
    if (!best || at > best.at) best = { user: match.user, contact: match.contact, at };
  }
  return best ? { user: best.user, contact: best.contact } : null;
}

async function checkForward(
  user: User,
  phone: string,
  text: string,
  message: InboundText,
  progress: { sent: boolean },
  image?: AnalysisImage,
): Promise<void> {
  const guard = preCheck(text, /https?:\/\//i.test(text));
  if (guard) {
    if (image) image.data.fill(0);
    await reply(phone, guard.reply, message, progress);
    return;
  }
  await reply(phone, "Checking…", message, progress, false);
  const parsed: ParsedMessage = {
    source: message.platform,
    from: phone,
    text,
    links: [],
  };
  const result = await analyze(
    parsed,
    {
      language: user.language,
      recentCaseSummaries: await recentSummaries(user),
    },
    image,
  );
  if (image) image.data.fill(0);
  const level = notifyLevel(result);
  const copy = alertCopy(result, level === "none");
  await reply(phone, isAssistantRequest(text) ? withRefusal(copy, level === "none") : copy, message, progress);
  if (level !== "none" && message.platform === "imessage") await deliverVoice(phone, result.spoken_summary);
  const caseId = await createCase({
    userId: user._id,
    familyGroupId: user.familyGroupId,
    source: message.platform,
    verdict: result.verdict,
    riskScore: result.risk_score,
    scamType: result.scam_type,
    claimedBrand: result.claimed_brand ?? undefined,
    summary: result.case_summary,
    notifiedVia: ["text"],
    familyAlerted: false,
    latencyMs: 0,
  });
  if (level === "call") {
    await deliverWarningCall(user, String(caseId), result);
    if (user.familyContacts.length > 0) await alertFamily(user, { scamType: result.scam_type, caseId: String(caseId) });
  }
}

function looksForwarded(text: string): boolean {
  return /https?:\/\//i.test(text) || text.trim().length > 180;
}
