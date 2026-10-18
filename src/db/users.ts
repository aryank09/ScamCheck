import { randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { getDb } from "./mongo.js";

// Link tokens are the only lock on the Gmail-connect and family pages, so they must be
// unguessable. ObjectIds are not: same-process ids differ only in a counter.
const TOKEN_RE = /^[a-f0-9]{32}$/;
export function newToken(): string {
  return randomBytes(16).toString("hex");
}

export interface FamilyContact {
  name: string;
  phone: string;
  relation?: string;
}

export type OnboardingStep = "language" | "consent" | "family" | "done";

export interface GmailLink {
  email: string;
  refreshTokenEnc: string;
  lastCheckedAt?: Date;
}

/** Identity across iMessage, calls, and family links. No message bodies. */
export interface User {
  _id: ObjectId;
  phone: string;
  displayName?: string;
  language: string;
  familyContacts: FamilyContact[];
  familyGroupId?: string;
  onboardingStep: OnboardingStep;
  consentAcceptedAt?: Date;
  gmail?: GmailLink;
  seenEmailIds: string[];
  connectToken?: string;
  /** Private link for the family page. Separate from the Gmail connect token. */
  familyToken?: string;
  /** Running total of Gmail messages processed, including ones the model skipped. */
  emailsChecked: number;
}

export async function findUserByPhone(phone: string): Promise<User | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const db = await getDb();
  const doc = await db.collection("users").findOne({ phone: normalized });
  return doc ? upgradeTokens(toUser(doc)) : null;
}

/** One-time swap of old ObjectId-style tokens for random ones. Runs when the user next texts in. */
async function upgradeTokens(user: User): Promise<User> {
  const patch: { connectToken?: string; familyToken?: string } = {};
  if (user.connectToken && !TOKEN_RE.test(user.connectToken)) patch.connectToken = newToken();
  if (user.familyToken && !TOKEN_RE.test(user.familyToken)) patch.familyToken = newToken();
  if (!patch.connectToken && !patch.familyToken) return user;
  await saveUser(user._id, patch);
  return { ...user, ...patch };
}

export async function findUserByConnectToken(token: string): Promise<User | null> {
  if (!TOKEN_RE.test(token)) return null;
  const db = await getDb();
  const doc = await db.collection("users").findOne({ connectToken: token });
  return doc ? toUser(doc) : null;
}

export async function findUserByFamilyToken(token: string): Promise<User | null> {
  if (!TOKEN_RE.test(token)) return null;
  const db = await getDb();
  const doc = await db.collection("users").findOne({ familyToken: token });
  return doc ? toUser(doc) : null;
}

/** Create the family-page token once. Existing tokens are left alone. */
export async function ensureFamilyToken(user: User): Promise<string> {
  if (user.familyToken && TOKEN_RE.test(user.familyToken)) return user.familyToken;
  const token = newToken();
  await saveUser(user._id, { familyToken: token });
  user.familyToken = token;
  return token;
}

/**
 * Count one processed Gmail message.
 * If the counter was never stored, start from how many ids this user already had.
 */
export async function incrementEmailsChecked(id: ObjectId, alreadySeen: number): Promise<void> {
  const seed = Number.isFinite(alreadySeen) && alreadySeen > 0 ? Math.floor(alreadySeen) : 0;
  const db = await getDb();
  await db.collection("users").updateOne({ _id: id }, [
    { $set: { emailsChecked: { $add: [{ $ifNull: ["$emailsChecked", seed] }, 1] } } },
  ]);
}

/** The user who listed this phone as a family contact, plus that contact. */
export async function findUserByFamilyPhone(
  phone: string,
): Promise<{ user: User; contact: FamilyContact } | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const db = await getDb();
  const doc = await db.collection("users").findOne({ "familyContacts.phone": normalized });
  if (!doc) return null;
  const user = toUser(doc);
  const contact = user.familyContacts.find((item) => item.phone === normalized);
  if (!contact) return null;
  return { user, contact };
}

export async function listGmailUsers(): Promise<User[]> {
  const db = await getDb();
  const docs = await db.collection("users").find({ "gmail.refreshTokenEnc": { $type: "string" } }).toArray();
  return docs.map(toUser);
}

export async function createUser(phone: string): Promise<User> {
  const normalized = normalizePhone(phone);
  const db = await getDb();
  const existing = await db.collection("users").findOne({ phone: normalized });
  if (existing) return toUser(existing);
  const doc = {
    phone: normalized,
    language: "en",
    familyContacts: [],
    onboardingStep: "language" as const,
    seenEmailIds: [],
    connectToken: newToken(),
    familyToken: newToken(),
    emailsChecked: 0,
    createdAt: new Date(),
  };
  const result = await db.collection("users").insertOne(doc);
  return toUser({ ...doc, _id: result.insertedId });
}

export async function saveUser(
  id: ObjectId,
  patch: Partial<Omit<User, "_id" | "phone">> & { seenEmailId?: string },
): Promise<void> {
  const set: Record<string, unknown> = {};
  if (patch.displayName !== undefined) set.displayName = patch.displayName;
  if (patch.language !== undefined) set.language = patch.language;
  if (patch.familyContacts !== undefined) set.familyContacts = patch.familyContacts;
  if (patch.familyGroupId !== undefined) set.familyGroupId = patch.familyGroupId;
  if (patch.onboardingStep !== undefined) set.onboardingStep = patch.onboardingStep;
  if (patch.consentAcceptedAt !== undefined) set.consentAcceptedAt = patch.consentAcceptedAt;
  if (patch.gmail !== undefined) set.gmail = patch.gmail;
  if (patch.seenEmailIds !== undefined) set.seenEmailIds = patch.seenEmailIds.slice(-500);
  if (patch.connectToken !== undefined) set.connectToken = patch.connectToken;
  if (patch.familyToken !== undefined) set.familyToken = patch.familyToken;
  const update: Record<string, unknown> = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (patch.seenEmailId) update.$addToSet = { seenEmailIds: patch.seenEmailId };
  if (Object.keys(update).length === 0) return;
  const db = await getDb();
  await db.collection("users").updateOne({ _id: id }, update);
  if (patch.seenEmailId) {
    await db.collection("users").updateOne({ _id: id }, [{ $set: { seenEmailIds: { $slice: ["$seenEmailIds", -500] } } }]);
  }
}

export async function deleteUser(id: ObjectId): Promise<void> {
  const db = await getDb();
  const existing = await db.collection("users").findOne({ _id: id });
  const phone = typeof existing?.phone === "string" ? existing.phone : "";
  await db.collection("cases").deleteMany({ userId: id });
  await db.collection("parentLinks").deleteMany(phone ? { $or: [{ userId: id }, { phone }] } : { userId: id });
  await db.collection("users").deleteOne({ _id: id });
}

export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.includes("@")) return trimmed.toLowerCase();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (trimmed.startsWith("+") && digits.length >= 8) return `+${digits}`;
  return trimmed;
}

function toUser(doc: Record<string, unknown> & { _id: ObjectId }): User {
  const gmail = gmailOf(doc.gmail);
  return {
    _id: doc._id,
    phone: String(doc.phone),
    displayName: typeof doc.displayName === "string" ? doc.displayName : undefined,
    language: typeof doc.language === "string" && doc.language ? doc.language : "en",
    familyContacts: contacts(doc.familyContacts),
    familyGroupId: typeof doc.familyGroupId === "string" ? doc.familyGroupId : undefined,
    onboardingStep: stepOf(doc.onboardingStep),
    consentAcceptedAt: doc.consentAcceptedAt instanceof Date ? doc.consentAcceptedAt : undefined,
    gmail,
    seenEmailIds: stringList(doc.seenEmailIds),
    connectToken: typeof doc.connectToken === "string" ? doc.connectToken : undefined,
    familyToken: typeof doc.familyToken === "string" ? doc.familyToken : undefined,
    emailsChecked:
      typeof doc.emailsChecked === "number" && doc.emailsChecked >= 0
        ? doc.emailsChecked
        : stringList(doc.seenEmailIds).length,
  };
}

function stepOf(value: unknown): OnboardingStep {
  if (value === "language" || value === "consent" || value === "family" || value === "done") return value;
  return "done";
}

function gmailOf(value: unknown): GmailLink | undefined {
  if (!value || typeof value !== "object") return undefined;
  const gmail = value as { email?: unknown; refreshTokenEnc?: unknown; lastCheckedAt?: unknown };
  if (typeof gmail.email !== "string" || typeof gmail.refreshTokenEnc !== "string") return undefined;
  return {
    email: gmail.email,
    refreshTokenEnc: gmail.refreshTokenEnc,
    lastCheckedAt: gmail.lastCheckedAt instanceof Date ? gmail.lastCheckedAt : undefined,
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function contacts(value: unknown): FamilyContact[] {
  if (!Array.isArray(value)) return [];
  const parsed: FamilyContact[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const contact = item as { name?: unknown; phone?: unknown; relation?: unknown };
    if (typeof contact.name !== "string" || typeof contact.phone !== "string") continue;
    parsed.push({
      name: contact.name,
      phone: normalizePhone(contact.phone),
      relation: typeof contact.relation === "string" ? contact.relation : undefined,
    });
  }
  return parsed;
}
