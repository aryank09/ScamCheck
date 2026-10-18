// Community Scam Radar: wave key, family counting, page grouping, and the spoken line.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectId } from "mongodb";
import type { CommunityCase } from "../src/db/cases.js";
import { buildRadar, communityLine, countOtherFamilies, publicCases } from "../src/core/radar.js";
import { normalizeBrand, scamCategory, scamDomain, waveFields } from "../src/core/waveKey.js";

describe("wave key", () => {
  it("picks the lookalike link domain, not the official one", () => {
    const domain = scamDomain({
      source: "email",
      from: "alerts@chase-secure-login.net",
      text: "Visit chase.com or verify now",
      links: [
        { visibleText: "chase.com", href: "https://www.chase.com/" },
        { visibleText: "Verify", href: "https://login.chase-secure-login.net/verify" },
      ],
    });
    assert.equal(domain, "chase-secure-login.net");
  });

  it("finds a bare URL in a forwarded text", () => {
    assert.equal(scamDomain({ source: "sms", text: "USPS: pay fee at https://usps-redelivery.info/x", links: [] }), "usps-redelivery.info");
  });

  it("never treats a free-mail sender as a scam domain", () => {
    assert.equal(scamDomain({ source: "email", from: "friend@gmail.com", text: "hi", links: [] }), undefined);
  });

  it("normalizes brand names and categories deterministically", () => {
    assert.equal(normalizeBrand("CHASE bank"), "Chase");
    assert.equal(normalizeBrand(null), undefined);
    assert.equal(scamCategory("Your account is locked. Verify now.", "Chase"), "account_locked");
    assert.equal(scamCategory("Pay a small redelivery fee", "USPS"), "fee");
    assert.equal(scamCategory("Buy gift cards and send the codes", undefined), "gift_card");
    assert.equal(scamCategory("Hello there", "Chase"), "impersonation");
    assert.deepEqual(
      waveFields({ source: "email", from: "x@chase-secure-login.net", text: "Account locked", links: [] }, "Chase"),
      { brand: "Chase", senderDomain: "chase-secure-login.net", category: "account_locked" },
    );
  });
});

describe("community counting", () => {
  const me = { userId: new ObjectId(), familyGroupId: "fam-me" };
  const other = (family: string) => ({ userId: new ObjectId(), familyGroupId: family });

  it("counts distinct other families, never the asker's own", () => {
    const cases = [other("a"), other("a"), other("b"), { ...me }, { userId: new ObjectId(), familyGroupId: "fam-me" }];
    assert.equal(countOtherFamilies(cases, me), 2);
  });

  it("falls back to the user id when there is no family group", () => {
    const solo = { userId: new ObjectId() };
    assert.equal(countOtherFamilies([solo, { userId: new ObjectId() }], { userId: solo.userId }), 1);
  });
});

describe("radar page", () => {
  const now = new Date("2026-10-18T06:00:00Z");
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3600_000);
  const c = (family: string, hoursAgo: number, language: string, domain?: string): CommunityCase => ({
    _id: new ObjectId(),
    userId: new ObjectId(),
    familyGroupId: family,
    claimedBrand: domain ? "Chase" : "USPS",
    senderDomain: domain,
    category: domain ? "account_locked" : "fee",
    language,
    riskScore: 90,
    createdAt: at(hoursAgo),
  });

  it("groups by brand and domain, counts families, flags active waves", () => {
    const radar = buildRadar(
      [c("a", 1, "ur", "chase-secure-login.net"), c("b", 2, "es", "chase-secure-login.net"), c("a", 3, "ur", "chase-secure-login.net"), c("z", 50, "en")],
      now,
    );
    assert.equal(radar.families, 3);
    assert.equal(radar.scams, 4);
    const chase = radar.waves.find((w) => w.domain === "chase-secure-login.net")!;
    assert.equal(chase.families, 2);
    assert.equal(chase.active, true);
    assert.deepEqual(chase.languages, ["es", "ur"]);
    const usps = radar.waves.find((w) => w.brand === "USPS")!;
    assert.equal(usps.active, false);
    assert.equal(radar.waves[0], chase, "most recent first");
  });

  it("puts no personal data on the page", () => {
    const json = JSON.stringify(buildRadar([c("secret-family-id", 1, "ur", "chase-secure-login.net")], now));
    assert.equal(json.includes("secret-family-id"), false);
  });
});

describe("community line", () => {
  it("speaks an exact count for the same scam, a brand for a similar one", () => {
    assert.equal(communityLine({ tier: "same", families: 6, brand: "Chase", domain: "x.net" }, "en"), "This is the same scam that reached 6 other families this week.");
    assert.match(communityLine({ tier: "same", families: 1, domain: "x.net" }, "en"), /1 other family /);
    assert.match(communityLine({ tier: "same", families: 6, domain: "x.net" }, "ur"), /6/);
    assert.match(communityLine({ tier: "similar", brand: "Chase" }, "es"), /Chase/);
    assert.equal(communityLine(null, "en"), "");
    assert.match(communityLine({ tier: "similar", brand: "IRS" }, "fr"), /pretending to be IRS/, "unknown language falls back to English");
  });
});

describe("radar page html", () => {
  it("escapes attacker-controlled domains and refreshes itself", async () => {
    const { radarPageHtml } = await import("../src/web/radar.js");
    const html = radarPageHtml({
      families: 1,
      scams: 1,
      languages: ["ur"],
      waves: [{ brand: "Chase", domain: '<script>x</script>.net', category: "account_locked", families: 1, active: false, languages: ["ur"], firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString() }],
    });
    assert.equal(html.includes("<script>x"), false);
    assert.match(html, /http-equiv="refresh" content="10"/);
    assert.match(html, /Community Scam Radar/);
  });
});

describe("public radar filter", () => {
  it("keeps scam-level cases with a category; drops suspicious-only and pre-radar cases", () => {
    const base = { _id: new ObjectId(), userId: new ObjectId(), createdAt: new Date() };
    const kept = publicCases([
      { ...base, riskScore: 90, category: "account_locked" },
      { ...base, riskScore: 55, category: "account_locked" },
      { ...base, riskScore: 90 },
    ]);
    assert.equal(kept.length, 1);
    assert.equal(kept[0]!.riskScore, 90);
  });
});
