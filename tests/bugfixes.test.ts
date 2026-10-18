import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isUserCommand, languageCommandResult } from "../src/core/commands.js";
import { preCheck, sharesOwnSecret } from "../src/core/guardrails.js";
import { isQuietHours, quietHoursResumeAt } from "../src/core/quietHours.js";
import { emailAddressFromHeader } from "../src/email/headers.js";

describe("a scam that quotes a card is still checked", () => {
  const scam = "Your Chase account is locked. We charged 4111 1111 1111 1111. Call us.";

  it("does not take the secret-sharing path", () => {
    assert.equal(sharesOwnSecret(scam), false);
    assert.equal(preCheck(scam, false), null);
  });

  it("still stops a parent from handing over their own card", () => {
    const own = "Here is my credit card 4532 1234 5678 9010 - confirm it back to me.";
    assert.equal(sharesOwnSecret(own), true);
    assert.equal(preCheck(own, false)?.guard, "sensitive_share");
  });
});

describe("LANGUAGE does not wipe a saved language", () => {
  it("keeps Urdu when the name is unknown", () => {
    const result = languageCommandResult("french", "ur");
    assert.equal(result.save, undefined);
    assert.match(result.reply, /keep using ur/);
  });

  it("keeps the current language when no language was named", () => {
    assert.equal(languageCommandResult("", "es").save, undefined);
  });

  it("saves a language it recognizes", () => {
    assert.equal(languageCommandResult("english", "ur").save, "en");
    assert.equal(languageCommandResult("ur", "en").save, "ur");
  });
});

describe("quiet hours hold the warning call overnight", () => {
  const hours = { start: "22:00", end: "07:00", tz: "America/Los_Angeles" };

  it("is quiet at 10:30pm Pacific and open at 7:30am", () => {
    assert.equal(isQuietHours(hours, new Date("2026-10-18T05:30:00Z")), true);
    assert.equal(isQuietHours(hours, new Date("2026-10-18T13:30:00Z")), true);
    assert.equal(isQuietHours(hours, new Date("2026-10-18T14:30:00Z")), false);
  });

  it("resumes at 7am Pacific", () => {
    const resume = quietHoursResumeAt(hours, new Date("2026-10-18T05:30:00Z"));
    assert.equal(resume.toISOString(), "2026-10-18T14:00:00.000Z");
    assert.equal(quietHoursResumeAt(hours, new Date("2026-10-18T18:00:00Z")).toISOString(), "2026-10-18T18:00:00.000Z");
  });
});

describe("commands and sender addresses", () => {
  it("treats ALLOW as the sender's own command", () => {
    assert.equal(isUserCommand("ALLOW"), true);
    assert.equal(isUserCommand("Don't pay, I'll call you"), false);
  });

  it("reads the mailbox, not the display name", () => {
    assert.equal(emailAddressFromHeader('"Chase" <Alerts@Chase.com>'), "alerts@chase.com");
    assert.equal(emailAddressFromHeader("not an address"), undefined);
  });
});
