import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { familyPageLink } from "../src/core/onboarding.js";
import type { CaseRecord } from "../src/db/cases.js";
import type { User } from "../src/db/users.js";
import { familyView, parseHelper } from "../src/web/family.js";

const now = Date.parse("2026-10-17T18:00:00Z");
const day = 24 * 60 * 60 * 1000;

function user(): User {
  return {
    _id: new ObjectId(),
    phone: "+15550001111",
    messagePlatform: "imessage",
    displayName: "Rashid",
    language: "ur",
    familyContacts: [{ name: "Aryan", phone: "+15551234567", relation: "son" }],
    onboardingStep: "done",
    gmail: { email: "parent@example.com", refreshTokenEnc: "super-secret-token" },
    seenEmailIds: [],
    emailsChecked: 23,
  };
}

function recorded(patch: Partial<CaseRecord> & Pick<CaseRecord, "verdict" | "createdAt">): CaseRecord {
  return {
    _id: new ObjectId(),
    userId: new ObjectId(),
    source: "email",
    riskScore: 80,
    scamType: "fake Chase login",
    summary: "An email claimed to be an official bank.",
    notifiedVia: ["text"],
    familyAlerted: false,
    latencyMs: 0,
    ...patch,
  };
}

describe("family dashboard", () => {
  it("lists warnings and keeps quiet checks as a count", () => {
    const view = familyView(user(), [
      recorded({
        verdict: "scam",
        createdAt: new Date(now - 2 * day),
        notifiedVia: ["text", "call"],
        claimedBrand: "Chase",
      }),
      recorded({
        verdict: "no_red_flags",
        createdAt: new Date(now - day),
        riskScore: 10,
        scamType: "bank statement",
        summary: "A bank statement with no red flags.",
        notifiedVia: [],
      }),
      recorded({
        verdict: "suspicious",
        createdAt: new Date(now - 8 * day),
        familyResponse: "Son: don't pay",
      }),
    ], now);

    assert.equal(view.parentName, "Rashid");
    assert.equal(view.languageLabel, "Urdu");
    assert.equal(view.gmailConnected, true);
    assert.equal(view.gmailEmail, "parent@example.com");
    assert.equal(view.metrics.emailsChecked, 23);
    assert.equal(view.metrics.warnings, 1);
    assert.equal(view.metrics.calls, 1);
    assert.equal(view.metrics.familyReplies, 0);
    assert.equal(view.quietCount, 1);
    assert.equal(view.warnings.length, 1);
    assert.equal(view.warnings[0]?.verdict, "scam");
    assert.equal(view.warnings[0]?.summary, "An email claimed to be an company bank.");
    assert.equal(view.canReply, true);
    assert.deepEqual(view.helpers, [{ name: "Aryan", relation: "son", phoneLast4: "4567" }]);

    const json = JSON.stringify(view);
    assert.equal(json.includes("super-secret-token"), false);
    assert.equal(json.includes("+15551234567"), false);
    assert.equal(json.includes("5551234567"), false);
  });

  it("parses a helper and rejects a short number", () => {
    assert.deepEqual(parseHelper({ name: " Aryan ", phone: "(555) 123-4567", relation: " son " }), {
      name: "Aryan",
      phone: "+15551234567",
      relation: "son",
    });
    assert.equal(parseHelper({ name: "Aryan", phone: "123" }), null);
    assert.equal(parseHelper({ name: " ", phone: "5551234567" }), null);
  });

  it("builds the family link from the public address", () => {
    const previous = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = "https://demo.example/";
    assert.equal(familyPageLink("abc123"), "https://demo.example/family?t=abc123");
    assert.equal(familyPageLink(""), null);
    if (previous === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previous;
  });
});

describe("family page safety", () => {
  it("uses random 32-hex tokens", async () => {
    const { newToken } = await import("../src/db/users.js");
    const a = newToken();
    const b = newToken();
    assert.match(a, /^[a-f0-9]{32}$/);
    assert.notEqual(a.slice(0, 30), b.slice(0, 30));
  });

  it("only lets a saved helper's name speak to the parent", async () => {
    const { replyFrom } = await import("../src/web/family.js");
    const parent = user();
    assert.equal(replyFrom({ from: "aryan" }, parent), "Aryan");
    assert.equal(replyFrom({ from: "Chase Bank" }, parent), "your family page");
    assert.equal(replyFrom({ from: "" }, parent), "your family page");
    assert.equal(replyFrom({}, parent), "your family page");
  });
});
