import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkPassword, hashPassword } from "../src/db/accounts.js";
import {
  clearSessionCookie,
  inviteStillOpen,
  parentIsWatching,
  parseParent,
  parseSignup,
  readCookie,
  sessionCookie,
  textStatusLabel,
} from "../src/web/accountForms.js";
import { handleSite } from "../src/web/site.js";

describe("website accounts", () => {
  it("accepts a signup and rejects a short password", () => {
    assert.deepEqual(parseSignup({ name: " Aryan ", email: "Aryan@Example.com", password: "correct-horse" }), {
      ok: true,
      value: { name: "Aryan", email: "aryan@example.com", password: "correct-horse" },
    });
    assert.equal(parseSignup({ name: "Aryan", email: "aryan@example.com", password: "short" }).ok, false);
    assert.equal(parseSignup({ name: "", email: "aryan@example.com", password: "correct-horse" }).ok, false);
  });

  it("parses a parent the way a family roster adds a child", () => {
    assert.deepEqual(parseParent({ name: " Rashid ", phone: "(206) 555-0100", language: "ur", relation: " dad " }), {
      ok: true,
      value: { name: "Rashid", phone: "+12065550100", language: "ur", relation: "dad" },
    });
    assert.equal(parseParent({ name: "Rashid", phone: "123", language: "en" }).ok, false);
    assert.equal(parseParent({ name: "Rashid", phone: "2065550100", language: "fr" }).ok, false);
  });

  it("describes Photon SMS delivery without the phone number", () => {
    assert.equal(textStatusLabel(undefined), "SMS not sent");
    assert.equal(textStatusLabel("dispatched"), "SMS sent, waiting on the carrier");
    assert.equal(textStatusLabel("accepted"), "SMS accepted by the carrier");
    assert.equal(textStatusLabel("delivered"), "SMS delivered");
    assert.equal(
      textStatusLabel("failed", "recipient_invalid"),
      "SMS failed. That number does not look like a mobile number.",
    );
    assert.equal(textStatusLabel("failed", "not_configured"), "SMS failed. SMS is not set up.");
    assert.equal(textStatusLabel("failed"), "SMS failed.");
    assert.equal(inviteStillOpen("accepted"), true);
    assert.equal(inviteStillOpen("delivered"), false);
    assert.equal(inviteStillOpen("failed"), false);
  });

  it("hides metrics until the parent has agreed", () => {
    assert.equal(parentIsWatching(undefined), false);
    assert.equal(parentIsWatching(new Date("not-a-date")), false);
    assert.equal(parentIsWatching(new Date("2026-10-17T12:00:00Z")), true);
  });

  it("sets an httpOnly session cookie", () => {
    assert.match(sessionCookie("abc", false), /HttpOnly/);
    assert.doesNotMatch(sessionCookie("abc", false), /Secure/);
    assert.match(sessionCookie("abc", true), /Secure/);
    assert.match(clearSessionCookie(true), /Max-Age=0/);
    assert.equal(readCookie("scamcheck_session=abc; other=1", "scamcheck_session"), "abc");
  });

  it("round-trips a password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct-horse");
    assert.equal(await checkPassword("correct-horse", stored), true);
    assert.equal(await checkPassword("wrong-password", stored), false);
    assert.equal(stored.includes("correct-horse"), false);
  });

  it("serves the website without messaging a parent", async () => {
    const home = await handleSite("GET", new URL("http://localhost/"), undefined, undefined);
    assert.equal(home.status, 200);
    assert.match(home.html ?? "", /Create an account/);
    assert.match(home.html ?? "", /Add a parent/);
    assert.doesNotMatch(home.html ?? "", /text them|we'll text|reply YES/i);

    const add = await handleSite("POST", new URL("http://localhost/app/parents"), undefined, Buffer.from("name=Rashid&phone=2065550100"));
    assert.equal(add.status, 303);
    assert.equal(add.redirect, "/login");
  });
});
