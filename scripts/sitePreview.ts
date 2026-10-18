// Preview the account website with made-up sample data. No database, Photon, or Gmail.
// Run: npx tsx scripts/sitePreview.ts   then open http://localhost:3999/app
import { createServer } from "node:http";
import { ObjectId } from "mongodb";
import type { ParentLink } from "../src/db/accounts.js";
import type { CaseRecord, CaseSource, CaseVerdict, NotifyChannel, UserAction } from "../src/db/cases.js";
import type { User } from "../src/db/users.js";
import { buildRadar } from "../src/core/radar.js";
import { radarPageHtml } from "../src/web/radar.js";
import { caseStats, parentView, parseRange, type ParentView, type RangeDays } from "../src/web/stats.js";
import { addParentPage, authPage, landingPage, overviewPage, parentPage, type RecentWarning } from "../src/web/views.js";

const PORT = Number(process.env.PREVIEW_PORT ?? "3999");
const ZONE = "America/Los_Angeles";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const account = { name: "Omar Siddiqui", email: "omar@example.com" };
const accountId = new ObjectId();

let seed = 11;
function random(): number {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
}

interface Sample {
  link: ParentLink;
  user: User | null;
  cases: CaseRecord[];
}

function sampleCase(
  userId: ObjectId,
  hoursAgo: number,
  verdict: CaseVerdict,
  extra: {
    source?: CaseSource;
    scamType?: string;
    claimedBrand?: string;
    summary?: string;
    riskScore?: number;
    notifiedVia?: NotifyChannel[];
    familyAlerted?: boolean;
    familyResponse?: string;
    userAction?: UserAction;
  } = {},
): CaseRecord {
  return {
    _id: new ObjectId(),
    userId,
    source: extra.source ?? "email",
    verdict,
    riskScore: extra.riskScore ?? (verdict === "scam" ? 90 : verdict === "suspicious" ? 58 : 8),
    scamType: extra.scamType ?? "newsletter",
    claimedBrand: extra.claimedBrand,
    summary: extra.summary ?? "An ordinary email with no red flags.",
    notifiedVia: extra.notifiedVia ?? [],
    familyAlerted: extra.familyAlerted ?? false,
    familyResponse: extra.familyResponse,
    userAction: extra.userAction,
    latencyMs: 2100,
    createdAt: new Date(Date.now() - hoursAgo * HOUR),
  };
}

function quietChecks(userId: ObjectId, perDay: number): CaseRecord[] {
  const list: CaseRecord[] = [];
  for (let day = 0; day < 30; day += 1) {
    const count = Math.floor(random() * (perDay + 1));
    for (let index = 0; index < count; index += 1) list.push(sampleCase(userId, day * 24 + random() * 20, "no_red_flags"));
  }
  return list;
}

function sampleParent(
  id: string,
  name: string,
  relation: string,
  language: string,
  phone: string,
  email: string,
  options: { connected: boolean; emailsChecked: number; cases: (userId: ObjectId) => CaseRecord[] },
): Sample {
  const link: ParentLink = {
    _id: new ObjectId(id),
    accountId,
    phone,
    parentName: name,
    language,
    relation,
    email,
    createdAt: new Date(Date.now() - 32 * DAY),
  };
  if (!options.connected) return { link, user: null, cases: [] };
  const user: User = {
    _id: new ObjectId(),
    phone,
    messagePlatform: "imessage",
    displayName: name,
    language,
    familyContacts: [],
    onboardingStep: "done",
    consentAcceptedAt: new Date(Date.now() - 31 * DAY),
    gmail: { email, refreshTokenEnc: "preview", lastCheckedAt: new Date(Date.now() - 2 * 60 * 1000) },
    seenEmailIds: [],
    emailsChecked: options.emailsChecked,
  };
  return { link, user, cases: options.cases(user._id) };
}

const samples: Sample[] = [
  sampleParent("000000000000000000000001", "Rashid", "Dad", "ur", "+12065550100", "rashid@example.com", {
    connected: true,
    emailsChecked: 184,
    cases: (id) => [
      sampleCase(id, 5, "scam", {
        scamType: "fake Chase login",
        claimedBrand: "Chase",
        summary: "An email claiming to be Chase asked him to sign in on a different website.",
        riskScore: 94,
        notifiedVia: ["text", "call"],
        familyAlerted: true,
        familyResponse: "Omar: Don't click it. I'll call you tonight.",
      }),
      sampleCase(id, 3 * 24 + 4, "scam", {
        source: "imessage",
        scamType: "USPS redelivery fee",
        claimedBrand: "USPS",
        summary: "A forwarded text asked for a small fee to redeliver a package.",
        riskScore: 88,
        notifiedVia: ["text"],
        familyAlerted: true,
      }),
      sampleCase(id, 5 * 24 + 2, "suspicious", {
        scamType: "order problem notice",
        claimedBrand: "Amazon",
        summary: "An email about a problem with an order used urgent wording and a shortened link.",
        notifiedVia: ["text"],
      }),
      sampleCase(id, 12 * 24, "scam", {
        source: "call",
        scamType: "IRS impersonation",
        summary: "A caller said he owed back taxes and must pay with gift cards.",
        riskScore: 91,
        notifiedVia: ["text"],
        familyAlerted: true,
        userAction: "clicked",
      }),
      sampleCase(id, 20 * 24, "scam", {
        source: "whatsapp",
        scamType: "gift card request",
        summary: "A message from an unknown number asked him to buy gift cards for a relative.",
        notifiedVia: ["text", "call"],
        familyAlerted: true,
        familyResponse: "Omar: That's not me. Ignore it.",
      }),
      ...quietChecks(id, 4),
    ],
  }),
  sampleParent("000000000000000000000002", "Maria", "Mom", "es", "+12065550111", "maria@example.com", {
    connected: true,
    emailsChecked: 96,
    cases: (id) => [
      sampleCase(id, 26, "suspicious", {
        scamType: "account limited notice",
        claimedBrand: "PayPal",
        summary: "An email said her account was limited and asked her to confirm details.",
        riskScore: 62,
        notifiedVia: ["text"],
      }),
      sampleCase(id, 9 * 24, "scam", {
        scamType: "fake Chase login",
        claimedBrand: "Chase",
        summary: "The same Chase look-alike email her husband got, from a different website.",
        notifiedVia: ["text", "call"],
        familyAlerted: true,
      }),
      ...quietChecks(id, 3),
    ],
  }),
  sampleParent("000000000000000000000003", "Nani", "Grandma", "hi", "+12065550122", "nani@example.com", {
    connected: false,
    emailsChecked: 0,
    cases: () => [],
  }),
];

function views(days: RangeDays, now: Date): { parents: ParentView[]; cases: CaseRecord[] } {
  const parents = samples.map((sample) =>
    parentView(sample.link, sample.user, sample.cases, {
      days,
      now,
      timeZone: ZONE,
      connectUrl: sample.user ? undefined : `http://localhost:${PORT}/connect/gmail?p=0123456789abcdef0123456789abcdef`,
    }),
  );
  return { parents, cases: samples.flatMap((sample) => sample.cases) };
}

function render(url: URL): string | null {
  const now = new Date();
  const days = parseRange(url.searchParams.get("days"));
  const { parents, cases } = views(days, now);
  if (url.pathname === "/") return landingPage(false);
  if (url.pathname === "/login") return authPage("login", url.searchParams.has("error") ? "That email and password did not match." : "", {});
  if (url.pathname === "/signup") return authPage("signup", "", {});
  if (url.pathname === "/radar") {
    const radarCases = samples.flatMap((sample) =>
      sample.cases
        .filter((item) => item.riskScore >= 75 && item.verdict === "scam")
        .map((item) => ({ ...item, category: "account_locked", language: sample.link.language })),
    );
    return radarPageHtml(buildRadar(radarCases, now), now);
  }
  if (url.pathname === "/app") {
    const shown = url.searchParams.has("empty") ? [] : parents;
    const recent: RecentWarning[] = shown
      .flatMap((parent) => parent.warnings.map((item) => ({ ...item, parentId: parent.id, parentName: parent.name })))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 8);
    return overviewPage({
      account,
      parents: shown,
      totals: caseStats(shown.length ? cases : [], days, now, ZONE),
      recent,
      days,
      now,
      timeZone: ZONE,
    });
  }
  if (url.pathname === "/app/parents/new") {
    const error = url.searchParams.has("error") ? "Enter a real mobile number." : undefined;
    return addParentPage({ account, parents, atLimit: false, error, fields: error ? { name: "Rashid", phone: "123" } : {} });
  }
  const parent = parents.find((item) => url.pathname === `/app/parents/${item.id}`);
  if (parent) {
    const notice = url.searchParams.get("notice");
    return parentPage({ account, parents, parent, days, now, timeZone: ZONE, notice: notice === "added" ? "added" : undefined });
  }
  return null;
}

createServer((request, response) => {
  const html = render(new URL(request.url ?? "/", `http://localhost:${PORT}`));
  response.writeHead(html ? 200 : 404, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(html ?? "Not in the preview.");
}).listen(PORT, () => {
  console.info(`site preview on http://localhost:${PORT}/app`);
  for (const sample of samples) console.info(`  ${sample.link.parentName}: /app/parents/${sample.link._id.toHexString()}`);
});
