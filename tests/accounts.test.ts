import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkPassword, hashPassword } from "../src/db/accounts.js";
import { parentConsentHtml, sameMailbox } from "../src/email/oauth.js";
import {
  clearSessionCookie,
  parentIsWatching,
  parseParent,
  parseSignup,
  readCookie,
  sessionCookie,
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

  it("keeps the parent's Gmail address", () => {
    const parsed = parseParent({ name: "Rashid", phone: "2065550100", language: "ur", email: " Rashid.Khan@Gmail.com " });
    assert.equal(parsed.ok && parsed.value.email, "rashid.khan@gmail.com");
    const bad = parseParent({ name: "Rashid", phone: "2065550100", language: "ur", email: "not-an-email" });
    assert.equal(bad.ok, false);
    assert.match(bad.ok ? "" : bad.error, /Gmail/);
  });

  it("only lets the typed Gmail address connect", () => {
    assert.equal(sameMailbox("Rashid.Khan+news@googlemail.com", "rashidkhan@gmail.com"), true);
    assert.equal(sameMailbox("rashid@gmail.com", "someone.else@gmail.com"), false);
    assert.equal(sameMailbox("r.khan@example.com", "rkhan@example.com"), false);
  });

  it("shows who asked and escapes their name on the Gmail consent page", () => {
    const html = parentConsentHtml({
      accountName: "<b>Aryan</b>",
      email: "rashid@gmail.com",
      phoneLast4: "0100",
      language: "es",
      startUrl: "/connect/gmail/start?p=abc",
    });
    assert.match(html, /&lt;b&gt;Aryan&lt;\/b&gt; te agregó a ScamCheck/);
    assert.doesNotMatch(html, /<b>Aryan<\/b>/);
    assert.match(html, /rashid@gmail\.com/);
    assert.match(html, /···0100/);
    assert.match(html, /href="\/connect\/gmail\/start\?p=abc"/);
    assert.match(html, /Conectar Gmail/);
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
