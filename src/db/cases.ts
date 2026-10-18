import { ObjectId } from "mongodb";
import { getDb } from "./mongo.js";

export type CaseSource = "email" | "imessage" | "sms" | "whatsapp" | "call";
export type CaseVerdict = "scam" | "suspicious" | "no_red_flags";
export type NotifyChannel = "call" | "text" | "digest";
export type UserAction = "paid" | "clicked" | "ignored" | "confirmed_real";

/**
 * Stored case. Summary is one English sentence.
 * Raw email, message text, images, audio, and transcripts are never fields here.
 */
export interface CaseRecord {
  _id: ObjectId;
  userId: ObjectId;
  familyGroupId?: string;
  source: CaseSource;
  verdict: CaseVerdict;
  riskScore: number;
  scamType: string;
  claimedBrand?: string;
  senderDomain?: string;
  /** Community Scam Radar: deterministic scam category and the user's language. */
  category?: string;
  language?: string;
  /** Seeded by scripts/seedRadar.ts. Counted only when RADAR_DEMO=on. */
  demo?: boolean;
  summary: string;
  notifiedVia: NotifyChannel[];
  familyAlerted: boolean;
  familyResponse?: string;
  userAction?: UserAction;
  latencyMs: number;
  createdAt: Date;
  /** Set when a warning call is waiting for quiet hours to end. */
  callDeferredUntil?: Date;
  /** Short warning to speak on the deferred call. Not the original message. */
  callOpening?: string;
}

export interface NewCase {
  userId: ObjectId;
  familyGroupId?: string;
  source: CaseSource;
  verdict: CaseVerdict;
  riskScore: number;
  scamType: string;
  claimedBrand?: string;
  senderDomain?: string;
  category?: string;
  language?: string;
  summary: string;
  notifiedVia: NotifyChannel[];
  familyAlerted: boolean;
  userAction?: UserAction;
  latencyMs: number;
}

export interface CaseUpdate {
  userAction?: UserAction;
  notifiedVia?: NotifyChannel;
  familyAlerted?: boolean;
  familyResponse?: string;
  /** A Date defers the call. Null clears it once the call is placed. */
  callDeferredUntil?: Date | null;
  callOpening?: string;
}

export async function createCase(input: NewCase): Promise<ObjectId> {
  const db = await getDb();
  const doc: Omit<CaseRecord, "_id"> = {
    userId: input.userId,
    familyGroupId: input.familyGroupId,
    source: input.source,
    verdict: input.verdict,
    riskScore: input.riskScore,
    scamType: clip(input.scamType, 80),
    claimedBrand: input.claimedBrand ? clip(input.claimedBrand, 80) : undefined,
    senderDomain: input.senderDomain ? clip(input.senderDomain, 120) : undefined,
    category: input.category ? clip(input.category, 40) : undefined,
    language: input.language ? clip(input.language, 8) : undefined,
    summary: storedSummary(input.summary),
    notifiedVia: input.notifiedVia,
    familyAlerted: input.familyAlerted,
    userAction: input.userAction,
    latencyMs: input.latencyMs,
    createdAt: new Date(),
  };
  const result = await db.collection<Omit<CaseRecord, "_id">>("cases").insertOne(doc);
  return result.insertedId;
}

export async function findCaseById(id: string): Promise<CaseRecord | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb();
  return db.collection<CaseRecord>("cases").findOne({ _id: new ObjectId(id) });
}

export async function updateCase(id: string, update: CaseUpdate): Promise<void> {
  if (!ObjectId.isValid(id)) return;
  const set: Record<string, unknown> = {};
  const unset: Record<string, ""> = {};
  if (update.userAction) set.userAction = update.userAction;
  if (update.familyAlerted !== undefined) set.familyAlerted = update.familyAlerted;
  if (update.familyResponse) set.familyResponse = clip(update.familyResponse, 240);
  if (update.callDeferredUntil) set.callDeferredUntil = update.callDeferredUntil;
  if (update.callDeferredUntil === null) unset.callDeferredUntil = "";
  if (update.callOpening) set.callOpening = clip(update.callOpening, 240);
  const change: Record<string, unknown> = {};
  if (Object.keys(set).length > 0) change.$set = set;
  if (Object.keys(unset).length > 0) change.$unset = unset;
  if (update.notifiedVia) change.$addToSet = { notifiedVia: update.notifiedVia };
  if (Object.keys(change).length === 0) return;
  const db = await getDb();
  await db.collection("cases").updateOne({ _id: new ObjectId(id) }, change);
}

/** Warning calls that were held for quiet hours and are now due. */
export async function listDeferredCalls(now: Date): Promise<CaseRecord[]> {
  const db = await getDb();
  return db
    .collection<CaseRecord>("cases")
    .find({ callDeferredUntil: { $lte: now }, notifiedVia: { $nin: ["call"] } })
    .sort({ callDeferredUntil: 1 })
    .limit(20)
    .toArray();
}

export async function listRecentCases(query: {
  userId: ObjectId;
  familyGroupId?: string;
  days: number;
}): Promise<CaseRecord[]> {
  const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000);
  const or: Record<string, unknown>[] = [{ userId: query.userId }];
  if (query.familyGroupId) or.push({ familyGroupId: query.familyGroupId });
  const db = await getDb();
  return db
    .collection<CaseRecord>("cases")
    .find({ createdAt: { $gte: since }, $or: or })
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();
}

/** This user's cases only, newest first. Does not pull the rest of the family group. */
export async function listCasesForUser(userId: ObjectId, days: number): Promise<CaseRecord[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const db = await getDb();
  return db
    .collection<CaseRecord>("cases")
    .find({ userId, createdAt: { $gte: since } })
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray();
}

/** Fields the Community Scam Radar needs. No summaries, no user ids beyond counting families. */
export type CommunityCase = Pick<
  CaseRecord,
  "_id" | "userId" | "familyGroupId" | "claimedBrand" | "senderDomain" | "category" | "language" | "createdAt"
>;

/**
 * Flagged cases (risk >= 40) since `since` that the family did not confirm as real.
 * Demo seed cases are included only when RADAR_DEMO=on.
 */
export async function listCommunityCases(
  since: Date,
  match: { senderDomain?: string; claimedBrand?: string; category?: string } = {},
): Promise<CommunityCase[]> {
  const filter: Record<string, unknown> = {
    createdAt: { $gte: since },
    riskScore: { $gte: 40 },
    userAction: { $ne: "confirmed_real" },
  };
  if (process.env.RADAR_DEMO !== "on") filter.demo = { $ne: true };
  if (match.senderDomain) filter.senderDomain = match.senderDomain;
  if (match.claimedBrand) filter.claimedBrand = match.claimedBrand;
  if (match.category) filter.category = match.category;
  const db = await getDb();
  return db
    .collection<CaseRecord>("cases")
    .find(filter, {
      projection: { userId: 1, familyGroupId: 1, claimedBrand: 1, senderDomain: 1, category: 1, language: 1, createdAt: 1 },
    })
    .sort({ createdAt: -1 })
    .limit(2000)
    .toArray();
}

/** Drop links and long numbers so a stored sentence cannot hold message content. */
function storedSummary(summary: string): string {
  const cleaned = summary
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\b\d[\d\s().-]{4,}\d\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clip(cleaned || "Case recorded.", 280);
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}
