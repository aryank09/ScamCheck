// Community Scam Radar: what makes two cases "the same scam".
// Decided by code from the message, never by the model's free-text label.
import { BRANDS } from "./brands.js";
import { hostOf, messageLinks, registrableDomain } from "./evidence.js";
import type { ParsedMessage } from "./types.js";

export type ScamCategory = "account_locked" | "fee" | "gift_card" | "prize" | "refund" | "impersonation" | "other";

export interface WaveFields {
  /** Normalized brand name ("Chase"), or undefined when none is claimed. */
  brand?: string;
  /** Registrable domain the scam uses (lookalike link, else sender). Not personal data. */
  senderDomain?: string;
  category: ScamCategory;
}

const OFFICIAL = new Set(BRANDS.flatMap((brand) => brand.domains));

// A friend's gmail.com is not a scam domain; grouping every gmail sender would fake a wave.
const FREE_MAIL = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "aol.com", "proton.me"]);

// First match wins, so the order runs from most to least specific.
const CATEGORIES: readonly [ScamCategory, RegExp][] = [
  ["gift_card", /gift\s*cards?/i],
  ["prize", /\b(you('ve)? won|winner|prize|lottery|sweepstakes)\b/i],
  ["refund", /\b(refund|tax return|stimulus|overpaid)\b/i],
  ["fee", /\b(fee|redeliver\w*|package|parcel|shipping|toll|customs)\b/i],
  ["account_locked", /\b(locked|suspended|unusual (sign[- ]in|activity)|verify your (account|identity)|restricted)\b/i],
];

/** Map the model's claimed brand ("chase bank", "CHASE") onto our brand list. */
export function normalizeBrand(claimed: string | null | undefined): string | undefined {
  const value = claimed?.trim();
  if (!value) return undefined;
  const known = BRANDS.find(
    (brand) => brand.name.toLowerCase() === value.toLowerCase() || brand.patterns.some((p) => p.test(value)),
  );
  return known ? known.name : value.slice(0, 40);
}

/** The scam's domain: first link that isn't any brand's official site, else the sender's domain. */
export function scamDomain(message: ParsedMessage): string | undefined {
  const { links } = messageLinks(message);
  for (const link of links) {
    const host = hostOf(link.href);
    const domain = host ? registrableDomain(host) : null;
    if (domain && !OFFICIAL.has(domain)) return domain;
  }
  const sender = hostOf(message.from);
  const domain = sender ? registrableDomain(sender) : null;
  return domain && !OFFICIAL.has(domain) && !FREE_MAIL.has(domain) ? domain : undefined;
}

export function scamCategory(text: string, brand?: string): ScamCategory {
  for (const [category, pattern] of CATEGORIES) if (pattern.test(text)) return category;
  return brand ? "impersonation" : "other";
}

export function waveFields(message: ParsedMessage, claimedBrand: string | null | undefined): WaveFields {
  const brand = normalizeBrand(claimedBrand);
  const { text } = messageLinks(message);
  return { brand, senderDomain: scamDomain(message), category: scamCategory(text, brand) };
}
