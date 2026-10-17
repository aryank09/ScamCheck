import { ObjectId } from "mongodb";
import { getDb } from "./mongo.js";

export interface FamilyContact {
  name: string;
  phone: string;
  relation?: string;
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
  if (!doc) return null;
  return {
    _id: doc._id,
    phone: String(doc.phone),
    displayName: typeof doc.displayName === "string" ? doc.displayName : undefined,
    language: typeof doc.language === "string" && doc.language ? doc.language : "en",
    familyContacts: contacts(doc.familyContacts),
    familyGroupId: typeof doc.familyGroupId === "string" ? doc.familyGroupId : undefined,
  };
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
      phone: contact.phone,
      relation: typeof contact.relation === "string" ? contact.relation : undefined,
    });
  }
  return parsed;
}
