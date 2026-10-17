import { sendText } from "../channels/photon.js";
import { updateCase } from "../db/cases.js";
import type { User } from "../db/users.js";

/**
 * Tell the family contacts the user added. The original message is never included.
 * Their reply path (translate and relay back) is a later step.
 */
export async function alertFamily(
  user: User,
  alert: { scamType: string; caseId?: string },
): Promise<void> {
  const name = user.displayName?.trim() || "Your family member";
  const text =
    `ScamCheck: ${name} received a likely scam (${alert.scamType}). ` +
    `They were told not to click or reply. Reply here and I'll pass your message to ${name}.`;
  for (const contact of user.familyContacts) {
    await sendText(contact.phone, text);
  }
  if (alert.caseId) await updateCase(alert.caseId, { familyAlerted: true });
}
