import { ObjectId } from "mongodb";
import { getDb } from "./mongo.js";

export interface FamilyContact {
  name: string;
  phone: string;
  relation?: string;
  /** Set once the one-time ScamCheck intro was sent to this contact. */
  introSentAt?: Date;
}

/** Identity across iMessage, calls, and family links. No message bodies. */
export interface User {
  _id: ObjectId;
  phone: string;
  displayName?: string;
  language: string;
  familyContacts: FamilyContact[];
  familyGroupId?: string;
}

export async function findUserByPhone(phone: string): Promise<User | null> {
  const normalized = phone.trim();
  if (!normalized) return null;
  const db = await getDb();
  const doc = await db.collection("users").findOne({ phone: normalized });
  return doc ? toUser(doc) : null;
}

function contacts(value: unknown): FamilyContact[] {
  if (!Array.isArray(value)) return [];
  const parsed: FamilyContact[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const contact = item as { name?: unknown; phone?: unknown; relation?: unknown; introSentAt?: unknown };
    if (typeof contact.name !== "string" || typeof contact.phone !== "string") continue;
    parsed.push({
      name: contact.name,
      phone: contact.phone,
      relation: typeof contact.relation === "string" ? contact.relation : undefined,
      introSentAt: contact.introSentAt instanceof Date ? contact.introSentAt : undefined,
    });
  }
  return parsed;
}

function toUser(doc: Record<string, unknown> & { _id: ObjectId }): User {
  return {
    _id: doc._id,
    phone: String(doc.phone),
    displayName: typeof doc.displayName === "string" ? doc.displayName : undefined,
    language: typeof doc.language === "string" && doc.language ? doc.language : "en",
    familyContacts: contacts(doc.familyContacts),
    familyGroupId: typeof doc.familyGroupId === "string" ? doc.familyGroupId : undefined,
  };
}

/** Users who listed this phone as a family contact (a son can be linked to both parents). */
export async function findUsersByFamilyPhone(phone: string): Promise<User[]> {
  const normalized = phone.trim();
  if (!normalized) return [];
  const db = await getDb();
  const docs = await db.collection("users").find({ "familyContacts.phone": normalized }).limit(10).toArray();
  return docs.map(toUser);
}

/** Persisted so a restart doesn't send the intro again. */
export async function markFamilyIntroSent(userId: ObjectId, phone: string): Promise<void> {
  const db = await getDb();
  await db
    .collection("users")
    .updateOne({ _id: userId, "familyContacts.phone": phone }, { $set: { "familyContacts.$.introSentAt": new Date() } });
}
