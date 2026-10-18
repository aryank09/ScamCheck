import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectId } from "mongodb";
import type { ParentLink } from "../src/db/accounts.js";
import type { CaseRecord } from "../src/db/cases.js";
import type { User } from "../src/db/users.js";
import { barList, dailyBars, donut, niceMax } from "../src/web/charts.js";
import { handleSite, isSitePath } from "../src/web/site.js";
import { caseStats, parentView, parseRange, warningItems } from "../src/web/stats.js";
import { addParentPage, landingPage, overviewPage, parentPage } from "../src/web/views.js";

const ZONE = "America/Los_Angeles";
// 11:30 PM Saturday in Seattle, already Sunday in UTC.
const NOW = new Date("2026-10-18T06:30:00Z");
const BANNED = /\b(safe|verified|guaranteed|legitimate|official)\b/i;
const account = { name: "Omar Siddiqui", email: "omar@example.com" };

function sampleCase(iso: string, verdict: CaseRecord["verdict"], extra: Partial<CaseRecord> = {}): CaseRecord {
  return {
    _id: new ObjectId(),
    userId: new ObjectId(),
    source: "email",
    verdict,
    riskScore: verdict === "scam" ? 90 : verdict === "suspicious" ? 60 : 5,
    scamType: "newsletter",
    summary: "A routine email.",
    notifiedVia: [],
    familyAlerted: false,
    latencyMs: 1000,
    createdAt: new Date(iso),
    ...extra,
  };
}

function sampleLink(name = "Rashid"): ParentLink {
  return {
    _id: new ObjectId(),
    accountId: new ObjectId(),
    phone: "+12065550100",
    parentName: name,
    language: "ur",
    createdAt: NOW,
  };
}

function sampleUser(extra: Partial<User> = {}): User {
  return {
    _id: new ObjectId(),
    phone: "+12065550100",
    messagePlatform: "imessage",
    language: "ur",
    familyContacts: [],
    onboardingStep: "done",
    gmail: { email: "rashid@example.com", refreshTokenEnc: "test", lastCheckedAt: NOW },
    seenEmailIds: [],
    emailsChecked: 40,
    ...extra,
  };
}

describe("dashboard numbers", () => {
  it("buckets checks by the family's calendar day, not the server's", () => {
    const cases = [
      sampleCase("2026-10-18T05:00:00Z", "scam", {
        claimedBrand: "Chase",
        notifiedVia: ["text", "call"],
        familyAlerted: true,
        familyResponse: "Son: don't pay",
      }),
      sampleCase("2026-10-17T06:00:00Z", "suspicious", { source: "imessage", scamType: "gift card request" }),
      sampleCase("2026-10-16T20:00:00Z", "no_red_flags"),
      sampleCase("2026-10-10T20:00:00Z", "scam"),
    ];
    const stats = caseStats(cases, 7, NOW, ZONE);
    assert.equal(stats.daily.length, 7);
    assert.equal(stats.daily.at(-1)?.date, "2026-10-17");
    assert.equal(stats.daily.at(-1)?.label, "Sat");
    assert.equal(stats.daily.at(-1)?.scam, 1);
    assert.equal(stats.daily.at(-2)?.suspicious, 1);
    assert.equal(stats.daily.at(-2)?.quiet, 1);
    const { checks, scams, suspicious, quiet, calls, texts, familyAlerts, familyReplies } = stats;
    assert.deepEqual(
      { checks, scams, suspicious, quiet, calls, texts, familyAlerts, familyReplies },
      { checks: 3, scams: 1, suspicious: 1, quiet: 1, calls: 1, texts: 1, familyAlerts: 1, familyReplies: 1 },
    );
    assert.deepEqual(stats.sources, [
      { label: "Email", value: 1 },
      { label: "iMessage", value: 1 },
    ]);
    assert.deepEqual(stats.topScams, [
      { label: "Chase", value: 1 },
      { label: "Gift card request", value: 1 },
    ]);
  });

  it("folds the long tail of scam labels into Other", () => {
    const cases = ["Amazon", "Chase", "FedEx", "IRS", "PayPal", "USPS"].map((brand) =>
      sampleCase("2026-10-17T18:00:00Z", "scam", { claimedBrand: brand }),
    );
    cases.push(sampleCase("2026-10-17T19:00:00Z", "scam", { claimedBrand: "USPS" }));
    const top = caseStats(cases, 7, NOW, ZONE).topScams;
    assert.equal(top.length, 5);
    assert.deepEqual(top[0], { label: "USPS", value: 2 });
    assert.deepEqual(top.at(-1), { label: "Other", value: 2 });
  });

  it("labels a month view by date and only accepts known ranges", () => {
    const stats = caseStats([], 30, NOW, ZONE);
    assert.equal(stats.daily.length, 30);
    assert.equal(stats.daily[0]?.date, "2026-09-18");
    assert.equal(stats.daily.at(-1)?.label, "Oct 17");
    assert.equal(parseRange("30"), 30);
    assert.equal(parseRange("365"), 7);
    assert.equal(parseRange(null), 7);
  });

  it("never shows a banned word in a warning", () => {
    const [item] = warningItems(
      [
        sampleCase("2026-10-17T18:00:00Z", "suspicious", {
          scamType: "official notice",
          summary: "Looks legitimate and safe but asks for a code.",
          claimedBrand: "Official Bank",
          familyResponse: "Son: it's verified",
        }),
      ],
      7,
      NOW,
      ZONE,
    );
    assert.ok(item);
    assert.doesNotMatch([item.title, item.summary, item.brand, item.familyResponse].join(" "), BANNED);
  });

  it("hides a parent's numbers until they agree", () => {
    const cases = [sampleCase("2026-10-17T18:00:00Z", "scam")];
    const options = { days: 7 as const, now: NOW, timeZone: ZONE };
    const waiting = parentView(sampleLink(), sampleUser(), cases, options);
    assert.equal(waiting.watching, false);
    assert.equal(waiting.emailsChecked, 0);
    assert.equal(waiting.stats.checks, 0);
    assert.equal(waiting.warnings.length, 0);
    assert.equal(waiting.gmailEmail, undefined);

    const agreed = parentView(sampleLink(), sampleUser({ consentAcceptedAt: NOW }), cases, options);
    assert.equal(agreed.watching, true);
    assert.equal(agreed.emailsChecked, 40);
    assert.equal(agreed.stats.scams, 1);
    assert.equal(agreed.phoneLast4, "0100");
    assert.equal(agreed.languageLabel, "Urdu");
  });
});

describe("dashboard charts", () => {
  it("escapes every label", () => {
    const list = barList([{ label: "<img src=x onerror=alert(1)>", value: 2, href: "/app/parents/abc" }], "Nothing yet");
    assert.doesNotMatch(list, /<img/);
    assert.match(list, /&lt;img src=x onerror=alert\(1\)&gt;/);
    const ring = donut([{ label: "<b>Scam</b>", value: 1, color: "var(--scam)" }], "<i>checks</i>");
    assert.doesNotMatch(ring, /<b>Scam<\/b>|<i>checks<\/i>/);
  });

  it("draws one bar per day with a spoken label, and an empty state", () => {
    const html = dailyBars(caseStats([sampleCase("2026-10-17T18:00:00Z", "scam")], 7, NOW, ZONE).daily);
    assert.equal(html.match(/class="bar"/g)?.length, 7);
    assert.match(html, /aria-label="Sat, Oct 17: 1 scam, 0 suspicious, 0 no red flags"/);
    assert.match(dailyBars(caseStats([], 7, NOW, ZONE).daily), /No checks in this period/);
  });

  it("rounds the axis so the midline is a whole number", () => {
    for (const value of [0, 1, 3, 5, 7, 9, 13, 17, 23, 45, 99, 101, 333]) {
      const top = niceMax(value);
      assert.ok(top >= value, `${top} for ${value}`);
      assert.ok(Number.isInteger(top / 2), `${top} for ${value}`);
    }
  });
});

describe("dashboard pages", () => {
  it("escapes a parent's name everywhere it appears", () => {
    const parent = parentView(sampleLink("<img src=x onerror=alert(1)>"), null, [], {
      days: 7,
      now: NOW,
      timeZone: ZONE,
      connectUrl: "https://example.com/connect/gmail?p=abc",
    });
    const html = parentPage({ account, parents: [parent], parent, days: 7, now: NOW, timeZone: ZONE });
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /Connect .*Gmail/);
  });

  it("refills the add form with escaped values after an error", () => {
    const html = addParentPage({
      account,
      parents: [],
      atLimit: false,
      error: "Enter a real mobile number.",
      fields: { name: '"><script>alert(1)</script>', phone: "123", language: "es" },
    });
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /value="&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
    assert.match(html, /Enter a real mobile number\./);
    assert.match(html, /value="es" checked/);
  });

  it("welcomes a new account and allows only its own inline script", () => {
    const html = overviewPage({
      account,
      parents: [],
      totals: caseStats([], 7, NOW, ZONE),
      recent: [],
      days: 7,
      now: NOW,
      timeZone: ZONE,
    });
    assert.match(html, /Add your first parent/);
    assert.match(html, /script-src 'sha256-[A-Za-z0-9+/=]+'/);
    assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/);
  });

  it("keeps marketing copy free of banned words", () => {
    assert.doesNotMatch(landingPage(false), BANNED);
    assert.match(landingPage(true), /Open dashboard/);
  });
});

describe("dashboard routes", () => {
  it("knows which paths belong to the website", () => {
    assert.equal(isSitePath("/app/parents/0123456789abcdef01234567"), true);
    assert.equal(isSitePath("/app/parents/new"), true);
    assert.equal(isSitePath("/radar"), false);
    assert.equal(isSitePath("/family"), false);
  });

  it("sends signed-out visitors to the login page", async () => {
    for (const [method, path] of [
      ["GET", "/app"],
      ["GET", "/app/parents/new"],
      ["GET", "/app/parents/0123456789abcdef01234567"],
      ["POST", "/app/parents/remove"],
    ] as const) {
      const result = await handleSite(method, new URL(`http://localhost${path}`), undefined, Buffer.from("id=x"));
      assert.equal(result.status, 303, `${method} ${path}`);
      assert.equal(result.redirect, "/login");
    }
  });
});
