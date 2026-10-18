import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { TEXT_PLATFORM } from "../src/channels/photon.js";
import { handleCommand } from "../src/core/commands.js";
import { currentPrompt, IMESSAGE_TEXT_LINE, replyOnImessage } from "../src/core/onboarding.js";
import type { User } from "../src/db/users.js";

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...tsFiles(path));
    else if (name.endsWith(".ts")) out.push(path);
  }
  return out;
}

function sliceFn(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing ${start}`);
  return source.slice(from, to);
}

function user(step: User["onboardingStep"]): User {
  return {
    _id: new ObjectId(),
    phone: "+15550001111",
    messagePlatform: "sms",
    language: "en",
    familyContacts: [],
    onboardingStep: step,
    seenEmailIds: [],
    emailsChecked: 0,
    connectToken: "abc",
  };
}

describe("text goes out on iMessage", () => {
  it("locks the Photon text platform to imessage", () => {
    assert.equal(TEXT_PLATFORM, "imessage");
    const photon = readFileSync(new URL("../src/channels/photon.ts", import.meta.url), "utf8");
    const send = sliceFn(photon, "export async function sendText", "export async function messageStatus");
    const voice = sliceFn(photon, "export async function sendVoiceNote", "const MAX_IMAGE_BYTES");
    const convo = sliceFn(photon, "async function conversation", "function inboundText");
    for (const block of [send, voice, convo]) assert.doesNotMatch(block, /["']sms["']/);
    assert.match(send, /TEXT_PLATFORM/);
    assert.match(voice, /conversation\(/);
    assert.match(convo, /TEXT_PLATFORM/);
    assert.match(send, /function sendText\(phone: string, text: string\)/);
    const site = readFileSync(new URL("../src/web/site.ts", import.meta.url), "utf8");
    assert.match(site, /one iMessage/);
    assert.doesNotMatch(site, /one SMS|Check SMS|["']sms["']/);

    const src = join(import.meta.dirname, "../src");
    for (const file of tsFiles(src)) {
      const text = readFileSync(file, "utf8");
      for (const call of text.match(/send(?:Text|VoiceNote)\([^;]*\)/g) ?? []) {
        assert.doesNotMatch(call, /["']sms["']/);
      }
    }
  });

  it("still receives a stray SMS without sending one", () => {
    const inbox = readFileSync(new URL("../src/channels/inbox.ts", import.meta.url), "utf8");
    assert.match(inbox, /\["imessage", "sms"\]/);
  });

  it("tells people to text on iMessage", async () => {
    assert.match(currentPrompt(user("language")), new RegExp(IMESSAGE_TEXT_LINE));
    assert.match(currentPrompt(user("done")), /iMessage contact/);
    assert.match(currentPrompt(user("done")), new RegExp(IMESSAGE_TEXT_LINE));
    const help = await handleCommand(user("done"), "HELP");
    assert.match(help ?? "", /iMessage/);
    assert.match(help ?? "", new RegExp(IMESSAGE_TEXT_LINE));
  });

  it("adds the iMessage line when the inbound message was SMS", () => {
    assert.equal(replyOnImessage("Checking…", "imessage"), "Checking…");
    assert.equal(replyOnImessage("Checking…", "sms"), `Checking…\n\n${IMESSAGE_TEXT_LINE}`);
    assert.equal(replyOnImessage(IMESSAGE_TEXT_LINE, "sms"), IMESSAGE_TEXT_LINE);
  });
});
