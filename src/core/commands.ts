import { deleteUser, saveUser, type User } from "../db/users.js";
import { decryptToken } from "../email/tokens.js";
import { revokeGmail } from "../email/oauth.js";
import { alertFamily } from "./familyRelay.js";
import { startWarningCall } from "../voice/outbound.js";
import { parseFamily } from "./onboarding.js";
import { languageCode } from "./onboarding.js";

const URGENT =
  "Call your bank right away using the number on your card. Do not use a number from the message. I will let your family contact know.";

export async function handleCommand(user: User, text: string): Promise<string | null> {
  const match = text.trim().match(/^(language|family|help|stop|paid|clicked)\b[:\s]*(.*)$/i);
  if (!match?.[1]) return null;
  const command = match[1].toLowerCase();
  const rest = (match[2] ?? "").trim();

  if (command === "help") {
    return "Forward a message and I will check it. Commands: LANGUAGE, FAMILY, HELP, STOP, PAID, CLICKED. Or just call me.";
  }
  if (command === "language") {
    const language = languageCode(rest, true) ?? "en";
    await saveUser(user._id, { language });
    return language === "en" && !/english|\ben\b/i.test(rest)
      ? "I don't have that language saved, so I will use English."
      : `I will reply in ${language}.`;
  }
  if (command === "family") {
    const parsed = parseFamily(rest);
    if (!parsed) return "Send FAMILY, then their name and number.";
    await saveUser(user._id, {
      familyContacts: [...user.familyContacts.filter((item) => item.phone !== parsed.phone), parsed],
      familyGroupId: user.familyGroupId ?? user._id.toHexString(),
    });
    return `I will alert ${parsed.name} about risky messages.`;
  }
  if (command === "stop") {
    await revokeStoredGmail(user);
    await deleteUser(user._id);
    return "Your ScamCheck data is deleted. Text me again if you want to start over.";
  }
  if (command === "paid" || command === "clicked") {
    if (user.familyContacts.length > 0) await alertFamily(user, { scamType: command === "paid" ? "already paid" : "already clicked" });
    await startWarningCall({
      toPhone: user.phone,
      caseId: "none",
      language: user.language,
      userName: user.displayName,
      scamType: command === "paid" ? "already paid" : "already clicked",
    });
    return URGENT;
  }
  return null;
}

async function revokeStoredGmail(user: User): Promise<void> {
  if (!user.gmail?.refreshTokenEnc) return;
  try {
    await revokeGmail(decryptToken(user.gmail.refreshTokenEnc));
  } catch (error) {
    console.error("gmail revoke failed error=" + (error as Error).name);
  }
}
