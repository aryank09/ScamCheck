import { getDb } from "./mongo.js";

const RETAIN_SECONDS = 2 * 24 * 60 * 60;
let indexes: Promise<void> | undefined;

function ready(): Promise<void> {
  indexes ??= buildIndexes().catch((error: unknown) => {
    indexes = undefined;
    throw error;
  });
  return indexes;
}

/**
 * Claim one inbound Photon message. False means another process, or an earlier
 * poll, already took it. The id is the only thing stored.
 */
export async function claimInbound(platform: string, id: string): Promise<boolean> {
  await ready();
  const db = await getDb();
  try {
    await db.collection("inboundSeen").insertOne({ key: `${platform}:${id}`, at: new Date() });
    return true;
  } catch (error) {
    if (isDuplicate(error)) return false;
    throw error;
  }
}

/** Let a poll retry a message that failed before anything was sent. */
export async function releaseInbound(platform: string, id: string): Promise<void> {
  await ready();
  const db = await getDb();
  await db.collection("inboundSeen").deleteOne({ key: `${platform}:${id}` });
}

async function buildIndexes(): Promise<void> {
  const db = await getDb();
  await db.collection("inboundSeen").createIndex({ key: 1 }, { unique: true });
  await db.collection("inboundSeen").createIndex({ at: 1 }, { expireAfterSeconds: RETAIN_SECONDS });
}

function isDuplicate(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === 11000;
}
