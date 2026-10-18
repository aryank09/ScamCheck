import { listRecentCases, updateCase } from "../db/cases.js";
import { deleteUser, ensureFamilyToken, joinFamilyGroups, saveUser, type User } from "../db/users.js";
import { decryptToken } from "../email/tokens.js";
import { revokeGmail } from "../email/oauth.js";
import { alertFamily } from "./familyRelay.js";
import { startWarningCall } from "../voice/outbound.js";
import { familyPageLink, languageCode, parseFamily } from "./onboarding.js";

const COMMAND_RE = /^(language|family|help|stop|paid|clicked|dashboard|remove|allow)\b/i;

/** A word the sender is saying to ScamCheck, not a reply to pass on to a parent. */
export function isUserCommand(text: string): boolean {
  return COMMAND_RE.test(text.trim());
}

/**
 * Unknown text does not change the saved language. "LANGUAGE french" used to
 * overwrite Urdu with English.
 */
export function languageCommandResult(rest: string, current: string): { save?: string; reply: string } {
  const language = languageCode(rest, true);
  if (!language) {
    return {
      reply: `I don't have that language saved, so I will keep using ${current}. You can say English, Spanish, Urdu, or Hindi.`,
    };
  }
  return { save: language, reply: `I will reply in ${language}.` };
}

const URGENT =
  "Call your bank right away using the number on your card. Do not use a number from the message. I will let your family contact know.";

export async function handleCommand(user: User, text: string): Promise<string | null> {
  const match = text.trim().match(/^(language|family|help|stop|paid|clicked|dashboard|remove)\b[:\s]*(.*)$/i);
  if (!match?.[1]) return null;
  const command = match[1].toLowerCase();
  const rest = (match[2] ?? "").trim();

  if (command === "help") {
    return "Forward a message and I will check it. Commands: LANGUAGE, FAMILY, REMOVE, HELP, STOP, PAID, CLICKED, DASHBOARD. Or just call me.";
  }
  if (command === "dashboard") {
    return dashboardReply(user);
  }
  if (command === "remove") {
    // REMOVE 4567: drop the helper whose number ends in those digits.
    const digits = rest.replace(/\D/g, "");
    if (digits.length < 4) return "Send REMOVE and the last 4 digits of their number.";
    const keep = user.familyContacts.filter((item) => !item.phone.replace(/\D/g, "").endsWith(digits));
    if (keep.length === user.familyContacts.length) return "I couldn't find a helper with that number.";
    await saveUser(user._id, { familyContacts: keep });
    return "Removed. They won't get your alerts anymore.";
  }
  if (command === "language") {
    const choice = languageCommandResult(rest, user.language);
    if (choice.save) {
      await saveUser(user._id, { language: choice.save });
      user.language = choice.save;
    }
    return choice.reply;
  }
  if (command === "family") {
    const parsed = parseFamily(rest);
    if (!parsed) return "Send FAMILY, then their name and number.";
    user.familyContacts = [...user.familyContacts.filter((item) => item.phone !== parsed.phone), parsed];
    user.familyGroupId = user.familyGroupId ?? user._id.toHexString();
    await saveUser(user._id, { familyContacts: user.familyContacts, familyGroupId: user.familyGroupId });
    await joinFamilyGroups(user);
    return `I will alert ${parsed.name} about risky messages.`;
  }
  if (command === "stop") {
    await revokeStoredGmail(user);
    await deleteUser(user._id);
    return "Your ScamCheck data is deleted. Text me again if you want to start over.";
  }
  if (command === "paid" || command === "clicked") {
    // Attach to their newest flagged case so the record, family alert, and call all name the real scam.
    const latest = (await listRecentCases({ userId: user._id, days: 7 })).find((c) => c.verdict !== "no_red_flags");
    const caseId = latest ? String(latest._id) : undefined;
    const what = command === "paid" ? "already paid" : "already clicked";
    const scamType = latest ? `${latest.scamType} (${what})` : what;
    if (caseId) await updateCase(caseId, { userAction: command, callDeferredUntil: null });
    if (user.familyContacts.length > 0) await alertFamily(user, { scamType, caseId });
    await startWarningCall({
      toPhone: user.phone,
      caseId: caseId ?? "none",
      language: user.language,
      userName: user.displayName,
      brand: latest?.claimedBrand,
      scamType,
    });
    return URGENT;
  }
  return null;
}

export async function dashboardReply(user: User): Promise<string> {
  const token = await ensureFamilyToken(user);
  const link = familyPageLink(token);
  if (!link) return "The family page is not ready yet.";
  return (
    `Family page: ${link}\n` +
    "It shows warning summaries, not the original messages. Anyone with this link can add helpers."
  );
}

async function revokeStoredGmail(user: User): Promise<void> {
  if (!user.gmail?.refreshTokenEnc) return;
  try {
    await revokeGmail(decryptToken(user.gmail.refreshTokenEnc));
  } catch (error) {
    console.error("gmail revoke failed error=" + (error as Error).name);
  }
}
