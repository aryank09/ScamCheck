import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { ObjectId } from "mongodb";
import { getDb } from "./mongo.js";

const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
const TOKEN_RE = /^[a-f0-9]{64}$/;

export interface Account {
  _id: ObjectId;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: Date;
}

export interface ParentLink {
  _id: ObjectId;
  accountId: ObjectId;
  phone: string;
  parentName: string;
  language: string;
  relation?: string;
  userId?: ObjectId;
  createdAt: Date;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = await scryptKey(password, salt);
  return `scrypt$${salt}$${hash.toString("hex")}`;
}

export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [kind, salt, hex] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hex) return false;
  const expected = Buffer.from(hex, "hex");
  const actual = await scryptKey(password, salt);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(actual, expected);
}

let indexes: Promise<void> | undefined;

export function readyAccountStore(): Promise<void> {
  indexes ??= buildIndexes().catch((error: unknown) => {
    indexes = undefined;
    throw error;
  });
  return indexes;
}

export async function createAccount(input: {
  email: string;
  name: string;
  password: string;
}): Promise<{ ok: true; account: Account } | { ok: false; error: "duplicate" }> {
  await readyAccountStore();
  const doc = {
    email: input.email,
    name: input.name,
    passwordHash: await hashPassword(input.password),
    createdAt: new Date(),
  };
  const db = await getDb();
  try {
    const result = await db.collection("accounts").insertOne(doc);
    return { ok: true, account: toAccount({ ...doc, _id: result.insertedId }) };
  } catch (error) {
    if (isDuplicate(error)) return { ok: false, error: "duplicate" };
    throw error;
  }
}

export async function findAccountByEmail(email: string): Promise<Account | null> {
  await readyAccountStore();
  const db = await getDb();
  const doc = await db.collection("accounts").findOne({ email });
  return doc ? toAccount(doc) : null;
}

export async function findAccountById(id: ObjectId): Promise<Account | null> {
  await readyAccountStore();
  const db = await getDb();
  const doc = await db.collection("accounts").findOne({ _id: id });
  return doc ? toAccount(doc) : null;
}

/** Returns the raw cookie token. Only its hash is stored. */
export async function openSession(accountId: ObjectId): Promise<string> {
  await readyAccountStore();
  const token = randomBytes(32).toString("hex");
  const db = await getDb();
  await db.collection("sessions").insertOne({
    tokenHash: sha256(token),
    accountId,
    expiresAt: new Date(Date.now() + SESSION_MS),
  });
  return token;
}

export async function accountForToken(token: string): Promise<Account | null> {
  if (!TOKEN_RE.test(token)) return null;
  await readyAccountStore();
  const db = await getDb();
  const session = await db.collection("sessions").findOne({
    tokenHash: sha256(token),
    expiresAt: { $gt: new Date() },
  });
  if (!session || !(session.accountId instanceof ObjectId)) return null;
  return findAccountById(session.accountId);
}

export async function closeSession(token: string): Promise<void> {
  if (!TOKEN_RE.test(token)) return;
  await readyAccountStore();
  const db = await getDb();
  await db.collection("sessions").deleteOne({ tokenHash: sha256(token) });
}

export async function listParentLinks(accountId: ObjectId): Promise<ParentLink[]> {
  await readyAccountStore();
  const db = await getDb();
  const docs = await db.collection("parentLinks").find({ accountId }).sort({ createdAt: 1 }).toArray();
  return docs.map(toLink);
}

export async function listParentLinksByPhone(phone: string): Promise<ParentLink[]> {
  await readyAccountStore();
  const db = await getDb();
  const docs = await db.collection("parentLinks").find({ phone }).sort({ createdAt: 1 }).toArray();
  return docs.map(toLink);
}

export async function addParentLink(
  accountId: ObjectId,
  parent: { name: string; phone: string; language: string; relation?: string; userId?: ObjectId },
): Promise<"added" | "duplicate"> {
  await readyAccountStore();
  const doc: Record<string, unknown> = {
    accountId,
    phone: parent.phone,
    parentName: parent.name,
    language: parent.language,
    createdAt: new Date(),
  };
  if (parent.relation) doc.relation = parent.relation;
  if (parent.userId) doc.userId = parent.userId;
  const db = await getDb();
  try {
    await db.collection("parentLinks").insertOne(doc);
    return "added";
  } catch (error) {
    if (isDuplicate(error)) return "duplicate";
    throw error;
  }
}

export async function removeParentLink(accountId: ObjectId, phone: string): Promise<boolean> {
  await readyAccountStore();
  const db = await getDb();
  const result = await db.collection("parentLinks").deleteOne({ accountId, phone });
  return result.deletedCount === 1;
}

/** Point every saved link for this phone at the person who actually uses it. */
export async function rememberParentUser(phone: string, userId: ObjectId): Promise<void> {
  await readyAccountStore();
  const db = await getDb();
  await db.collection("parentLinks").updateMany({ phone }, { $set: { userId } });
}

export async function deleteAccount(id: ObjectId): Promise<void> {
  await readyAccountStore();
  const db = await getDb();
  await db.collection("parentLinks").deleteMany({ accountId: id });
  await db.collection("sessions").deleteMany({ accountId: id });
  await db.collection("accounts").deleteOne({ _id: id });
}

function scryptKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function buildIndexes(): Promise<void> {
  const db = await getDb();
  await db.collection("accounts").createIndex({ email: 1 }, { unique: true });
  await db.collection("sessions").createIndex({ tokenHash: 1 }, { unique: true });
  await db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection("parentLinks").createIndex({ accountId: 1, phone: 1 }, { unique: true });
  await db.collection("parentLinks").createIndex({ phone: 1 });
}

function isDuplicate(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === 11000;
}

function toAccount(doc: Record<string, unknown> & { _id: ObjectId }): Account {
  return {
    _id: doc._id,
    email: String(doc.email),
    name: typeof doc.name === "string" ? doc.name : "",
    passwordHash: typeof doc.passwordHash === "string" ? doc.passwordHash : "",
    createdAt: doc.createdAt instanceof Date ? doc.createdAt : new Date(0),
  };
}

function toLink(doc: Record<string, unknown> & { _id: ObjectId }): ParentLink {
  const link: ParentLink = {
    _id: doc._id,
    accountId: doc.accountId instanceof ObjectId ? doc.accountId : new ObjectId(String(doc.accountId)),
    phone: String(doc.phone),
    parentName: typeof doc.parentName === "string" ? doc.parentName : "",
    language: typeof doc.language === "string" && doc.language ? doc.language : "en",
    createdAt: doc.createdAt instanceof Date ? doc.createdAt : new Date(0),
  };
  if (typeof doc.relation === "string" && doc.relation) link.relation = doc.relation;
  if (doc.userId instanceof ObjectId) link.userId = doc.userId;
  return link;
}
