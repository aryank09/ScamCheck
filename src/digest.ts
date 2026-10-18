// Low-priority daily summary. One calm message instead of a text per email.
// Mail with no red flags is counted here and is not sent on its own.
// TODO: run around 6 PM in the user's timezone and send the text with Photon.

import { scrubBannedWords } from "./core/bannedWords.js";
import type { CaseSource, CaseVerdict } from "./db/cases.js";

/** Required disclaimer. Labels above it are scrubbed so a case title cannot add a banned word. */
export const DIGEST_FOOTER = "No red flags doesn't guarantee something is safe.";

/** The case fields this summary needs. No raw email or message body. */
export interface DigestCase {
  source: CaseSource;
  verdict: CaseVerdict;
  scamType: string;
}

/** Turn today's cases into the single daily message. */
export function buildDailyDigest(cases: readonly DigestCase[]): string {
  const emails = cases.filter((item) => item.source === "email");
  const flagged = emails.filter((item) => item.verdict !== "no_red_flags");
  const labels = flagged.map((item) => label(item.scamType));

  const lines = [`I checked ${emails.length} ${emails.length === 1 ? "email" : "emails"} today.`];
  if (flagged.length === 0) {
    lines.push(emails.length === 1 ? "It had no red flags." : "Everything had no red flags.");
  } else {
    const looked = flagged.length === 1 ? "1 looked suspicious" : `${flagged.length} looked suspicious`;
    lines.push(`${looked} (${labels.join("; ")}).`);
    if (flagged.length < emails.length) lines.push("Everything else had no red flags.");
  }

  return `${lines.join(" ")}\n\n${DIGEST_FOOTER}`;
}

/**
 * TODO: send `buildDailyDigest(cases)` to `phone` through Photon.
 * Scheduling belongs with the 6 PM user-time job, not in this function.
 */
export async function deliverDailyDigest(phone: string, cases: readonly DigestCase[]): Promise<string> {
  const text = buildDailyDigest(cases);
  void phone;
  return text;
}

function label(scamType: string): string {
  const cleaned = scrubBannedWords(scamType).replace(/\s+/g, " ").trim();
  return cleaned || "possible scam";
}
