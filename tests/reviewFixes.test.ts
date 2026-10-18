import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analysisWithoutModel } from "../src/core/analyze.js";
import { collectEvidence } from "../src/core/evidence.js";
import { imageMime } from "../src/core/images.js";
import { alertCopy, notifyLevel } from "../src/core/notify.js";
import { languageAnswer, languageCode } from "../src/core/onboarding.js";
import { displayNameFromHeader } from "../src/email/headers.js";
import type { AnalysisResult, ParsedMessage } from "../src/core/types.js";

const linkedMail: ParsedMessage = {
  source: "email",
  from: "alerts@chase.com",
  displayName: "Chase",
  subject: "Your statement is ready",
  text: "Your statement is ready.",
  links: [{ visibleText: "View", href: "https://secure.chase.com/statement" }],
  authenticationResults: "dmarc=pass",
  seenSenderBefore: true,
};

describe("model failure does not alert on ordinary mail", () => {
  it("scores a linked email at the rules floor of 0", () => {
    const result = analysisWithoutModel(linkedMail);
    assert.equal(result.modelFailed, true);
    assert.equal(result.rulesFloor, 0);
    assert.equal(result.risk_score, 0);
    assert.equal(notifyLevel(result), "none");
  });

  it("still alerts when a high finding is already present", () => {
    const result = analysisWithoutModel({
      source: "email",
      from: "billing@chase-secure.example",
      displayName: "Chase",
      subject: "Your account is locked",
      text: "Verify your account now.",
      links: [{ visibleText: "Chase", href: "https://chase-secure.example/login" }],
    });
    assert.equal(result.modelFailed, true);
    assert.equal(result.rulesFloor, 75);
    assert.equal(result.risk_score, 75);
    assert.equal(notifyLevel(result), "call");
  });

  it("keeps a real model score in the text band", () => {
    const result: AnalysisResult = {
      verdict: "suspicious",
      risk_score: 55,
      scam_type: "payment",
      claimed_brand: null,
      red_flags: ["It asks for a code."],
      spoken_summary: "This looks unusual.",
      action: "Do not reply.",
      case_summary: "A message asked for a code.",
      matches_recent_case: false,
      findings: [],
      rulesFloor: 0,
      modelFailed: false,
    };
    assert.equal(notifyLevel(result), "text");
    assert.match(alertCopy(result, false), /suspicious/);
  });
});

describe("a bare From address is not a brand", () => {
  it("drops an address used as the display name", () => {
    assert.equal(displayNameFromHeader("alerts@chase.com"), undefined);
    assert.equal(displayNameFromHeader("<alerts@chase.com>"), undefined);
    assert.equal(displayNameFromHeader('"Chase" <alerts@chase.com>'), "Chase");
  });

  it("does not treat the address as a Chase claim", () => {
    const findings = collectEvidence({
      source: "email",
      from: "alerts@chase.com",
      displayName: "alerts@chase.com",
      subject: "Your statement is ready",
      text: "Your statement is ready.",
      links: [{ visibleText: "View", href: "https://news.example.com/statement" }],
    });
    assert.equal(
      findings.some((finding) => finding.severity === "high"),
      false,
    );
  });
});

describe("the first text is not a language", () => {
  it("asks again for a greeting", () => {
    assert.equal(languageAnswer("hello"), null);
    assert.equal(languageAnswer("hi"), null);
    assert.equal(languageAnswer("YES"), null);
  });

  it("accepts a named language and falls back when it is unknown", () => {
    assert.deepEqual(languageAnswer("Urdu"), { code: "ur", recognized: true });
    assert.deepEqual(languageAnswer("español"), { code: "es", recognized: true });
    assert.deepEqual(languageAnswer("हिंदी"), { code: "hi", recognized: true });
    assert.deepEqual(languageAnswer("French"), { code: "en", recognized: false });
    assert.equal(languageCode("english"), "en");
  });
});

describe("screenshot mime types", () => {
  it("accepts photos and rejects other files", () => {
    assert.equal(imageMime("image/jpeg"), "image/jpeg");
    assert.equal(imageMime("image/jpg"), "image/jpeg");
    assert.equal(imageMime("image/png; charset=binary"), "image/png");
    assert.equal(imageMime("application/pdf"), null);
    assert.equal(imageMime(undefined), null);
  });
});
