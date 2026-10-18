// Low-priority daily summary. One calm message instead of a text per email.
// TODO: run around 6 PM in the user's timezone and send the text with Photon.
// ponytail: English only; translate with Gemini when the send is wired.

import { scrubBannedWords } from "./bannedWords.js";
import type { CaseSource, CaseVerdict } from "../db/cases.js";

/** Required disclaimer (AGENTS.md §14). Labels above it are scrubbed so a case title cannot add a banned word. */
export const DIGEST_FOOTER = `"No red flags" doesn't guarantee something is safe.`;

/** The case fields this summary needs. No raw email or message body. */
export interface DigestCase {
  source: CaseSource;
  verdict: CaseVerdict;
  scamType: string;
}

/**
 * Turn today's numbers into the single daily message.
 * `emailsChecked` comes from the watcher's daily counter: emails with no red flags
 * are counted and skipped without creating a case (AGENTS.md §12), so cases can't give the total.
 */
export function buildDailyDigest(emailsChecked: number, cases: readonly DigestCase[]): string {
  const flagged = cases.filter((item) => item.source === "email" && item.verdict !== "no_red_flags");
  const total = Math.max(emailsChecked, flagged.length);
  const scams = flagged.filter((item) => item.verdict === "scam").map((item) => label(item.scamType));
  const suspicious = flagged.filter((item) => item.verdict === "suspicious").map((item) => label(item.scamType));

  const lines = [`I checked ${total} ${total === 1 ? "email" : "emails"} today.`];
  if (scams.length) lines.push(`${scams.length} looked like ${scams.length === 1 ? "a scam" : "scams"} (${scams.join("; ")}).`);
  if (suspicious.length) lines.push(`${suspicious.length} looked suspicious (${suspicious.join("; ")}).`);
  if (flagged.length === 0) lines.push(total === 1 ? "It had no red flags." : "Everything had no red flags.");
  else if (flagged.length < total) lines.push("Everything else had no red flags.");

  return `${lines.join(" ")}\n\n${DIGEST_FOOTER}`;
}

/**
 * TODO: send `buildDailyDigest(emailsChecked, cases)` to `phone` through Photon.
 * Scheduling belongs with the 6 PM user-time job, not in this function.
 */
export async function deliverDailyDigest(
  phone: string,
  emailsChecked: number,
  cases: readonly DigestCase[],
): Promise<string> {
  const text = buildDailyDigest(emailsChecked, cases);
  void phone;
  return text;
}

function label(scamType: string): string {
  const cleaned = scrubBannedWords(scamType).replace(/\s+/g, " ").trim();
  return cleaned || "possible scam";
}
