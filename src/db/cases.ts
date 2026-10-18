import { ObjectId } from "mongodb";
import { getDb } from "./mongo.js";

export type CaseSource = "email" | "imessage" | "whatsapp" | "call";
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
  summary: string;
  notifiedVia: NotifyChannel[];
  familyAlerted: boolean;
  familyResponse?: string;
  userAction?: UserAction;
  latencyMs: number;
  createdAt: Date;
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

export async function updateCase(id: string, update: CaseUpdate): Promise<void> {
  if (!ObjectId.isValid(id)) return;
  const set: Record<string, unknown> = {};
  if (update.userAction) set.userAction = update.userAction;
  if (update.familyAlerted !== undefined) set.familyAlerted = update.familyAlerted;
  if (update.familyResponse) set.familyResponse = clip(update.familyResponse, 240);
  const change: Record<string, unknown> = {};
  if (Object.keys(set).length > 0) change.$set = set;
  if (update.notifiedVia) change.$addToSet = { notifiedVia: update.notifiedVia };
  if (Object.keys(change).length === 0) return;
  const db = await getDb();
  await db.collection("cases").updateOne({ _id: new ObjectId(id) }, change);
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

/** Newest flagged case from the last 3 days that no family member has answered yet. */
export async function findLatestOpenCase(userIds: ObjectId[]): Promise<CaseRecord | null> {
  if (userIds.length === 0) return null;
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const db = await getDb();
  return db.collection<CaseRecord>("cases").findOne(
    {
      userId: { $in: userIds },
      verdict: { $ne: "no_red_flags" },
      familyResponse: { $exists: false },
      createdAt: { $gte: since },
    },
    { sort: { createdAt: -1 } },
  );
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
