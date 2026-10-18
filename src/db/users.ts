import { randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { getDb } from "./mongo.js";
import type { MessagePlatform } from "../channels/photon.js";

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
  messagePlatform?: MessagePlatform;
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
  messagePlatform: MessagePlatform;
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
  /** From addresses already seen. Addresses only, capped, so "new sender" is not every email. */
  seenSenders?: string[];
  quietHours?: { start: string; end: string; tz: string };
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

/**
 * Remember which channel a family contact texts from. Updates that one field in place,
 * so a helper added on the family page at the same moment is never overwritten.
 */
export async function setFamilyContactPlatform(id: ObjectId, phone: string, platform: MessagePlatform): Promise<void> {
  const db = await getDb();
  await db
    .collection("users")
    .updateOne({ _id: id, "familyContacts.phone": phone }, { $set: { "familyContacts.$.messagePlatform": platform } });
}

export async function findUserById(id: ObjectId): Promise<User | null> {
  const db = await getDb();
  const doc = await db.collection("users").findOne({ _id: id });
  return doc ? toUser(doc) : null;
}

/** Every user who listed this phone as a family contact, plus that contact. */
export async function findUsersByFamilyPhone(
  phone: string,
): Promise<{ user: User; contact: FamilyContact }[]> {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];
  const db = await getDb();
  const docs = await db.collection("users").find({ "familyContacts.phone": normalized }).toArray();
  const matches: { user: User; contact: FamilyContact }[] = [];
  for (const doc of docs) {
    const user = toUser(doc);
    const contact = user.familyContacts.find((item) => item.phone === normalized);
    if (contact) matches.push({ user, contact });
  }
  return matches;
}

/** The user who listed this phone as a family contact, plus that contact. */
export async function findUserByFamilyPhone(
  phone: string,
): Promise<{ user: User; contact: FamilyContact } | null> {
  const matches = await findUsersByFamilyPhone(phone);
  return matches[0] ?? null;
}

/**
 * Give this user and the people they text with one familyGroupId, so a later
 * check can see a spouse's recent case. Old cases move onto the shared id.
 */
export async function joinFamilyGroups(user: User): Promise<void> {
  const listedBy = await findUsersByFamilyPhone(user.phone);
  for (const match of listedBy) {
    if (String(match.user._id) === String(user._id)) continue;
    await shareUsers(user, match.user);
  }
  for (const contact of user.familyContacts) {
    if (contact.phone === user.phone) continue;
    const other = await findUserByPhone(contact.phone);
    if (!other || String(other._id) === String(user._id)) continue;
    await shareUsers(user, other);
  }
}

async function shareUsers(a: User, b: User): Promise<void> {
  const group = a.familyGroupId ?? b.familyGroupId ?? a._id.toHexString();
  if (a.familyGroupId === group && b.familyGroupId === group) return;
  await moveGroup(a, group);
  const fresh = (await findUserById(b._id)) ?? b;
  await moveGroup(fresh, group);
  b.familyGroupId = fresh.familyGroupId;
}

async function moveGroup(user: User, group: string): Promise<void> {
  if (user.familyGroupId === group) return;
  const previous = user.familyGroupId;
  await saveUser(user._id, { familyGroupId: group });
  user.familyGroupId = group;
  const db = await getDb();
  if (previous && previous !== group) {
    await db.collection("users").updateMany({ familyGroupId: previous }, { $set: { familyGroupId: group } });
    await db.collection("cases").updateMany({ familyGroupId: previous }, { $set: { familyGroupId: group } });
  }
  await db.collection("cases").updateMany({ userId: user._id }, { $set: { familyGroupId: group } });
}

export async function listGmailUsers(): Promise<User[]> {
  const db = await getDb();
  const docs = await db.collection("users").find({ "gmail.refreshTokenEnc": { $type: "string" } }).toArray();
  return docs.map(toUser);
}

/** The watcher only reads users with a Gmail token, so this stops their email checks. */
export async function clearGmail(id: ObjectId): Promise<void> {
  const db = await getDb();
  await db.collection("users").updateOne({ _id: id }, { $unset: { gmail: "" } });
}

export async function createUser(phone: string, messagePlatform: MessagePlatform = "imessage"): Promise<User> {
  const normalized = normalizePhone(phone);
  const db = await getDb();
  const existing = await db.collection("users").findOne({ phone: normalized });
  if (existing) return toUser(existing);
  const doc = {
    phone: normalized,
    messagePlatform,
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
  patch: Partial<Omit<User, "_id" | "phone">> & { seenEmailId?: string; seenSender?: string },
): Promise<void> {
  const set: Record<string, unknown> = {};
  if (patch.displayName !== undefined) set.displayName = patch.displayName;
  if (patch.messagePlatform !== undefined) set.messagePlatform = patch.messagePlatform;
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
  const add: Record<string, string> = {};
  if (patch.seenEmailId) add.seenEmailIds = patch.seenEmailId;
  if (patch.seenSender) add.seenSenders = patch.seenSender.toLowerCase();
  if (Object.keys(add).length > 0) update.$addToSet = add;
  if (Object.keys(update).length === 0) return;
  const db = await getDb();
  await db.collection("users").updateOne({ _id: id }, update);
  const slice: Record<string, unknown> = {};
  if (patch.seenEmailId) slice.seenEmailIds = { $slice: ["$seenEmailIds", -500] };
  if (patch.seenSender) slice.seenSenders = { $slice: ["$seenSenders", -200] };
  if (Object.keys(slice).length > 0) {
    await db.collection("users").updateOne({ _id: id }, [{ $set: slice }]);
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
    messagePlatform: doc.messagePlatform === "sms" ? "sms" : "imessage",
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
    seenSenders: stringList(doc.seenSenders).map((sender) => sender.toLowerCase()),
    quietHours: quietHoursOf(doc.quietHours),
  };
}

function quietHoursOf(value: unknown): User["quietHours"] {
  if (!value || typeof value !== "object") return undefined;
  const hours = value as { start?: unknown; end?: unknown; tz?: unknown };
  if (typeof hours.start !== "string" || typeof hours.end !== "string" || typeof hours.tz !== "string") return undefined;
  return { start: hours.start, end: hours.end, tz: hours.tz };
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
    const contact = item as { name?: unknown; phone?: unknown; relation?: unknown; messagePlatform?: unknown };
    if (typeof contact.name !== "string" || typeof contact.phone !== "string") continue;
    parsed.push({
      name: contact.name,
      phone: normalizePhone(contact.phone),
      relation: typeof contact.relation === "string" ? contact.relation : undefined,
      messagePlatform: contact.messagePlatform === "sms" ? "sms" : contact.messagePlatform === "imessage" ? "imessage" : undefined,
    });
  }
  return parsed;
}
