import { listParentLinksByPhone, rememberParentUser } from "../db/accounts.js";
import { saveUser, type User } from "../db/users.js";

/**
 * A website account can save a parent's name and language before that parent
 * ever messages ScamCheck. Apply it on their first text. Nothing is sent to them here.
 */
export async function applyAddedParent(user: User): Promise<void> {
  const links = await listParentLinksByPhone(user.phone);
  if (links.length === 0) return;
  await rememberParentUser(user.phone, user._id);
  if (user.onboardingStep !== "language") return;
  const link = links[0];
  if (!link) return;
  const displayName = user.displayName?.trim() || link.parentName;
  await saveUser(user._id, { displayName, language: link.language, onboardingStep: "consent" });
  user.displayName = displayName;
  user.language = link.language;
  user.onboardingStep = "consent";
}
