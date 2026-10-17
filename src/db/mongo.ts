import { MongoClient, type Db } from "mongodb";

const CONNECT_TIMEOUT_MS = 10_000;

let client: MongoClient | undefined;

/** Shared Mongo handle. Connects on first use. */
export async function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  client ??= new MongoClient(uri, { serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS });
  await client.connect();
  return client.db();
}
