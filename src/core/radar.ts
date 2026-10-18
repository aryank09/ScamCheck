// Community Scam Radar: is this scam going around other ScamCheck families?
// Counts families, not messages, and never exposes who they are.
import type { ObjectId } from "mongodb";
import { listCommunityCases, type CommunityCase } from "../db/cases.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 7 * DAY_MS;

export type CommunityMatch =
  | { tier: "same"; families: number; brand?: string; domain: string }
  | { tier: "similar"; brand: string }
  | null;

/** Who is asking: their own family never counts toward "other families". */
export interface Asker {
  userId: ObjectId | string;
  familyGroupId?: string;
}

export interface WaveQuery {
  brand?: string;
  senderDomain?: string;
  category: string;
}

function familyKey(item: { userId: ObjectId | string; familyGroupId?: string }): string {
  return item.familyGroupId ?? String(item.userId);
}

/** Distinct families among `cases`, minus the asker's own family. Pure, so it's testable. */
export function countOtherFamilies(cases: readonly Pick<CommunityCase, "userId" | "familyGroupId">[], asker: Asker): number {
  const own = familyKey(asker);
  const ownUser = String(asker.userId);
  const families = new Set<string>();
  for (const item of cases) {
    if (String(item.userId) === ownUser) continue;
    const key = familyKey(item);
    if (key !== own) families.add(key);
  }
  return families.size;
}

/**
 * Same scam: other families got mail from the exact scam domain this week (gets a count).
 * Similar scam: same brand and category, different domain (brand only, no number).
 * ponytail: ~2 small queries per flagged message; add indexes on (senderDomain, createdAt) if volume grows.
 */
export async function communityMatch(wave: WaveQuery, asker: Asker, now = new Date()): Promise<CommunityMatch> {
  const since = new Date(now.getTime() - WINDOW_MS);
  if (wave.senderDomain) {
    const same = await listCommunityCases(since, { senderDomain: wave.senderDomain });
    const families = countOtherFamilies(same, asker);
    if (families > 0) return { tier: "same", families, brand: wave.brand, domain: wave.senderDomain };
  }
  if (wave.brand) {
    const similar = await listCommunityCases(since, { claimedBrand: wave.brand, category: wave.category });
    const others = similar.filter((item) => item.senderDomain !== wave.senderDomain);
    if (countOtherFamilies(others, asker) > 0) return { tier: "similar", brand: wave.brand };
  }
  return null;
}

export interface RadarWave {
  brand: string;
  domain?: string;
  category: string;
  families: number;
  /** 2+ families in the last 24 hours. */
  active: boolean;
  languages: string[];
  firstSeen: string;
  lastSeen: string;
}

export interface RadarSnapshot {
  families: number;
  scams: number;
  languages: string[];
  waves: RadarWave[];
}

/** Group cases into waves for the public page. Pure: no names, phones, or summaries go in or out. */
export function buildRadar(cases: readonly CommunityCase[], now = new Date()): RadarSnapshot {
  const groups = new Map<string, CommunityCase[]>();
  for (const item of cases) {
    const brand = item.claimedBrand ?? "Unknown sender";
    const key = item.senderDomain ? `${brand}|${item.senderDomain}` : `${brand}|~${item.category ?? "other"}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const dayAgo = now.getTime() - DAY_MS;
  const waves: RadarWave[] = [];
  for (const list of groups.values()) {
    const first = list[0]!;
    const times = list.map((item) => item.createdAt.getTime());
    const recent = list.filter((item) => item.createdAt.getTime() >= dayAgo);
    waves.push({
      brand: first.claimedBrand ?? "Unknown sender",
      domain: first.senderDomain,
      category: first.category ?? "other",
      families: new Set(list.map(familyKey)).size,
      active: new Set(recent.map(familyKey)).size >= 2,
      languages: [...new Set(list.map((item) => item.language).filter((l): l is string => Boolean(l)))].sort(),
      firstSeen: new Date(Math.min(...times)).toISOString(),
      lastSeen: new Date(Math.max(...times)).toISOString(),
    });
  }
  waves.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  return {
    families: new Set(cases.map(familyKey)).size,
    scams: cases.length,
    languages: [...new Set(cases.map((item) => item.language).filter((l): l is string => Boolean(l)))].sort(),
    waves: waves.slice(0, 20),
  };
}

/**
 * The public page shows only scam-level cases (risk >= 75) that carry a radar category.
 * Suspicious-only mail (40-74) is often a real service's notice, and listing it would
 * reveal which services a family uses. Pre-radar cases have no category and stay off too.
 * The call's community match still uses risk >= 40.
 */
export function publicCases<T extends Pick<CommunityCase, "riskScore" | "category">>(cases: readonly T[]): T[] {
  return cases.filter((item) => item.riskScore >= 75 && Boolean(item.category));
}

export async function radarSnapshot(now = new Date()): Promise<RadarSnapshot> {
  return buildRadar(publicCases(await listCommunityCases(new Date(now.getTime() - WINDOW_MS))), now);
}

// Spoken first on the warning call, in the user's language. Code fills the number so it's always exact.
// ponytail: en/es/ur/hi only; other languages fall back to English.
const LINES: Record<string, { same: (n: number) => string; similar: (brand: string) => string }> = {
  en: {
    same: (n) => `This is the same scam that reached ${n} other ${n === 1 ? "family" : "families"} this week.`,
    similar: (brand) => `Scams like this, pretending to be ${brand}, have been going around this week.`,
  },
  es: {
    same: (n) => `Es la misma estafa que llegó a ${n} ${n === 1 ? "familia más" : "familias más"} esta semana.`,
    similar: (brand) => `Estafas como esta, que se hacen pasar por ${brand}, están circulando esta semana.`,
  },
  ur: {
    same: (n) => `یہ وہی دھوکہ ہے جو اس ہفتے ${n} اور خاندانوں تک پہنچا ہے۔`,
    similar: (brand) => `اس ہفتے ${brand} کے نام پر اسی طرح کے دھوکے پھیل رہے ہیں۔`,
  },
  hi: {
    same: (n) => `यह वही धोखा है जो इस हफ़्ते ${n} और परिवारों तक पहुँचा है।`,
    similar: (brand) => `इस हफ़्ते ${brand} के नाम पर ऐसे ही धोखे फैल रहे हैं।`,
  },
};

/** The community sentence for this match, or "" when there is none. */
export function communityLine(match: CommunityMatch, language: string): string {
  if (!match) return "";
  const lines = LINES[language] ?? LINES.en!;
  return match.tier === "same" ? lines.same(match.families) : lines.similar(match.brand);
}

/**
 * The community sentence for a flagged message, or "" on no match.
 * Never throws: a radar problem must not block the warning call.
 */
export async function communityLead(wave: WaveQuery, asker: Asker, language: string): Promise<string> {
  try {
    return communityLine(await communityMatch(wave, asker), language);
  } catch (error) {
    console.error("community match failed error=" + (error as Error).name);
    return "";
  }
}
