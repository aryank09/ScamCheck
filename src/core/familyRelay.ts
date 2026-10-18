import { sendText } from "../channels/photon.js";
import { findLatestOpenCase, updateCase } from "../db/cases.js";
import { findUsersByFamilyPhone, markFamilyIntroSent, type FamilyContact, type User } from "../db/users.js";

// AGENTS.md §11, §14: family messages name who was contacted and the scam type only.
// The original email or text is never included.

const RESPONSE_MAX = 240;

/** Tell the family contacts the user added. First-time contacts get a one-time intro first. */
export async function alertFamily(
  user: User,
  alert: { scamType: string; caseId?: string },
): Promise<void> {
  const name = user.displayName?.trim() || "Your family member";
  const text =
    `ScamCheck: ${name} received a likely scam (${alert.scamType}). ` +
    `They were told not to click or reply. Reply here and I'll pass your message to ${name}.`;
  for (const contact of user.familyContacts) {
    if (!contact.introSentAt) {
      await sendText(contact.phone, introText(contact));
      await markFamilyIntroSent(user._id, contact.phone);
    }
    await sendText(contact.phone, text);
  }
  if (alert.caseId) await updateCase(alert.caseId, { familyAlerted: true });
}

/**
 * A family contact replied. Relay it to the user on their newest open case.
 * Returns false when this phone has no open case to attach to, so the caller can treat it as a normal message.
 */
export async function handleFamilyReply(fromPhone: string, text: string): Promise<boolean> {
  const users = await findUsersByFamilyPhone(fromPhone);
  const openCase = await findLatestOpenCase(users.map((u) => u._id));
  if (!openCase) return false;
  const user = users.find((u) => String(u._id) === String(openCase.userId));
  const contact = user?.familyContacts.find((c) => c.phone === fromPhone.trim());
  if (!user || !contact) return false;

  // ponytail: relayed as written; Gemini translation into user.language goes here.
  const reply = text.replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim().slice(0, RESPONSE_MAX);
  if (!reply) return false;
  const speaker = contact.relation?.trim() || contact.name.trim() || "Family";
  const confirmedReal = saysItIsReal(reply);

  await updateCase(String(openCase._id), {
    familyResponse: `${speaker}: ${reply}`,
    userAction: confirmedReal ? "confirmed_real" : undefined,
  });
  // TODO: voice note of the same line once photon.ts can send audio.
  await sendText(
    user.phone,
    confirmedReal ? `Message from ${speaker}: they say this is real. ${reply}` : `Message from ${speaker}: ${reply}`,
  );
  return true;
}

/**
 * True only for a plain "it's real" with no negation. A false "no" is the safe miss:
 * the user still sees the family message, the case just isn't marked confirmed_real.
 * ponytail: English phrases only.
 */
export function saysItIsReal(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(not|never|nothing|no|don'?t|didn'?t|isn'?t|scam|fake)\b|n't\b/.test(t)) return false;
  return /\b(i ordered (it|that|this)|it'?s real|that'?s real|this is real|it is real)\b/.test(t);
}

function introText(contact: FamilyContact): string {
  const who = contact.name.trim() || "there";
  return (
    `Hi ${who}, this is ScamCheck. I help your family spot scams. ` +
    `I only say who was contacted and what kind of scam it was. I never send the original message. ` +
    `Reply here and I'll pass it on. You can sign up other relatives too.`
  );
}
