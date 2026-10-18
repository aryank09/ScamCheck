// Demo seed for the Community Scam Radar. Fake data, tagged demo: true.
// Counted only when the server runs with RADAR_DEMO=on.
//   npx tsx --env-file=.env scripts/seedRadar.ts         seed (replaces earlier demo cases)
//   npx tsx --env-file=.env scripts/seedRadar.ts --wipe  remove all demo cases
import { ObjectId } from "mongodb";
import { getDb } from "../src/db/mongo.js";

const HOUR = 3600_000;

interface Wave {
  brand: string;
  domain?: string;
  category: string;
  scamType: string;
  source: "email" | "sms";
  // One entry per family: [language, hours ago]
  hits: [string, number][];
}

// The demo email uses chase-secure-login.net, so Person B's call says "6 other families".
const WAVES: Wave[] = [
  {
    brand: "Chase",
    domain: "chase-secure-login.net",
    category: "account_locked",
    scamType: "fake Chase account locked",
    source: "email",
    hits: [["ur", 1], ["es", 2], ["hi", 4], ["en", 7], ["ur", 11], ["es", 19]],
  },
  {
    brand: "USPS",
    domain: "usps-redelivery.info",
    category: "fee",
    scamType: "USPS redelivery fee",
    source: "sms",
    hits: [["es", 3], ["en", 9], ["ur", 30]],
  },
  {
    brand: "IRS",
    domain: "irs-taxrefund-gov.com",
    category: "refund",
    scamType: "IRS tax refund",
    source: "email",
    hits: [["hi", 26], ["en", 60]],
  },
  {
    brand: "Amazon",
    category: "gift_card",
    scamType: "Amazon gift card request",
    source: "sms",
    hits: [["es", 5]],
  },
];

async function main(): Promise<void> {
  const db = await getDb();
  const cases = db.collection("cases");
  const removed = await cases.deleteMany({ demo: true });
  console.log(`removed ${removed.deletedCount} earlier demo cases`);
  if (process.argv.includes("--wipe")) return;

  const now = Date.now();
  let family = 0;
  const docs = WAVES.flatMap((wave) =>
    wave.hits.map(([language, hoursAgo]) => ({
      userId: new ObjectId(),
      familyGroupId: `demo-fam-${++family}`,
      source: wave.source,
      verdict: "scam",
      riskScore: 90,
      scamType: wave.scamType,
      claimedBrand: wave.brand,
      ...(wave.domain ? { senderDomain: wave.domain } : {}),
      category: wave.category,
      language,
      summary: "Demo seed case.",
      notifiedVia: ["call"],
      familyAlerted: false,
      latencyMs: 0,
      createdAt: new Date(now - hoursAgo * HOUR),
      demo: true,
    })),
  );
  await cases.insertMany(docs);
  console.log(`seeded ${docs.length} demo cases across ${family} families. Set RADAR_DEMO=on on the server.`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("seed failed:", (error as Error).message);
    process.exit(1);
  });
