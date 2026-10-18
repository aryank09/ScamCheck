import { sendText } from "../channels/photon.js";
import { relayFamilyReply } from "../core/familyRelay.js";
import { scrubBannedWords } from "../core/bannedWords.js";
import { listCasesForUser, type CaseRecord, type NotifyChannel } from "../db/cases.js";
import {
  findUserByFamilyToken,
  joinFamilyGroups,
  normalizePhone,
  saveUser,
  type FamilyContact,
  type User,
} from "../db/users.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_HELPERS = 8;

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  es: "Spanish",
  ur: "Urdu",
  hi: "Hindi",
};

export interface FamilyHelperView {
  name: string;
  relation?: string;
  phoneLast4: string;
}

export interface FamilyWarningView {
  createdAt: string;
  source: CaseRecord["source"];
  verdict: "scam" | "suspicious";
  scamType: string;
  claimedBrand?: string;
  summary: string;
  notifiedVia: NotifyChannel[];
  familyResponse?: string;
  userAction?: CaseRecord["userAction"];
}

export interface FamilySnapshot {
  parentName: string;
  language: string;
  languageLabel: string;
  gmailConnected: boolean;
  gmailEmail?: string;
  metrics: {
    emailsChecked: number;
    warnings: number;
    calls: number;
    familyReplies: number;
  };
  quietCount: number;
  warnings: FamilyWarningView[];
  helpers: FamilyHelperView[];
  canReply: boolean;
}

export type FamilyResult = { status: number; body: FamilySnapshot | { error: string } };

/** Counts and the warning feed. Quiet cases stay out of the list. */
export function familyView(user: User, cases: CaseRecord[], now = Date.now()): FamilySnapshot {
  const since = now - WEEK_MS;
  const recent = cases
    .filter((item) => item.createdAt.getTime() >= since)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const warnings = recent.filter((item) => item.verdict === "scam" || item.verdict === "suspicious");
  return {
    parentName: user.displayName?.trim() || "Your family",
    language: user.language,
    languageLabel: LANGUAGE_LABELS[user.language] ?? user.language,
    gmailConnected: Boolean(user.gmail?.email),
    gmailEmail: user.gmail?.email,
    metrics: {
      emailsChecked: user.emailsChecked,
      warnings: warnings.length,
      calls: recent.filter((item) => item.notifiedVia.includes("call")).length,
      familyReplies: recent.filter((item) => Boolean(item.familyResponse)).length,
    },
    quietCount: recent.filter((item) => item.verdict === "no_red_flags").length,
    warnings: warnings.slice(0, 30).map(toWarning),
    helpers: user.familyContacts.map(toHelper),
    canReply: warnings.some((item) => !item.familyResponse),
  };
}

export function parseHelper(input: unknown): FamilyContact | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const body = input as { name?: unknown; phone?: unknown; relation?: unknown };
  if (typeof body.name !== "string" || typeof body.phone !== "string") return null;
  const name = body.name.trim().slice(0, 80);
  const phone = normalizePhone(body.phone);
  if (!name || phone.replace(/\D/g, "").length < 8) return null;
  const relation = typeof body.relation === "string" ? body.relation.trim().slice(0, 40) : "";
  return { name, phone, relation: relation || undefined };
}

export async function getFamilyApi(token: string): Promise<FamilyResult> {
  const user = await findUserByFamilyToken(token);
  if (!user) return { status: 404, body: { error: "This family link is not valid." } };
  return { status: 200, body: await snapshot(user) };
}

export async function addHelper(token: string, payload: unknown): Promise<FamilyResult> {
  const user = await findUserByFamilyToken(token);
  if (!user) return { status: 404, body: { error: "This family link is not valid." } };
  const contact = parseHelper(payload);
  if (!contact) return { status: 400, body: { error: "Send a name and a real phone number." } };
  if (contact.phone === user.phone) {
    return { status: 400, body: { error: "That number is the person ScamCheck is watching." } };
  }
  const exists = user.familyContacts.some((item) => item.phone === contact.phone);
  if (!exists && user.familyContacts.length >= MAX_HELPERS) {
    return { status: 400, body: { error: "You can add up to 8 helpers." } };
  }
  const familyContacts = [...user.familyContacts.filter((item) => item.phone !== contact.phone), contact];
  await saveUser(user._id, {
    familyContacts,
    familyGroupId: user.familyGroupId ?? user._id.toHexString(),
  });
  user.familyContacts = familyContacts;
  if (!user.familyGroupId) user.familyGroupId = user._id.toHexString();
  await joinFamilyGroups(user);
  // AGENTS.md §14: alerts only go to contacts the user chose. A link holder added this one,
  // so tell the parent and give them a one-word undo.
  if (!exists) {
    const last4 = contact.phone.replace(/\D/g, "").slice(-4);
    const who = contact.relation ? `${contact.name} (${contact.relation})` : contact.name;
    try {
      await sendText(
        user.phone,
        `${who}, number ending ${last4}, was added from your family page and will get your scam alerts. ` +
          `If that's wrong, reply REMOVE ${last4}.`,
        user.messagePlatform,
      );
    } catch (error) {
      console.error("helper notice failed error=" + (error as Error).name);
    }
  }
  return { status: 200, body: await snapshot(user) };
}

export async function replyOnFamilyPage(token: string, payload: unknown): Promise<FamilyResult> {
  const user = await findUserByFamilyToken(token);
  if (!user) return { status: 404, body: { error: "This family link is not valid." } };
  const text = replyText(payload);
  if (!text) return { status: 400, body: { error: "Write a message to pass on." } };
  const from = replyFrom(payload, user);
  const cases = await listCasesForUser(user._id, 7);
  const open = cases.find((item) => item.verdict !== "no_red_flags" && !item.familyResponse);
  if (!open) return { status: 409, body: { error: "There is no open warning to reply to." } };
  const note = await relayFamilyReply(user, { name: from, phone: "dashboard" }, text, { userOnly: true });
  if (note.startsWith("There is no open")) {
    return { status: 409, body: { error: "There is no open warning to reply to." } };
  }
  return { status: 200, body: await snapshot(user) };
}

export async function renderFamilyPage(token: string): Promise<{ status: number; html: string }> {
  const user = await findUserByFamilyToken(token);
  if (!user) return { status: 404, html: noticePage("This family link is not valid.") };
  return { status: 200, html: familyPageHtml() };
}

export function familyErrorHtml(): string {
  return noticePage("The family page could not be loaded. Try again in a moment.");
}

function toWarning(item: CaseRecord): FamilyWarningView {
  const warning: FamilyWarningView = {
    createdAt: item.createdAt.toISOString(),
    source: item.source,
    verdict: item.verdict === "scam" ? "scam" : "suspicious",
    scamType: scrubBannedWords(item.scamType),
    summary: scrubBannedWords(item.summary) || "Case recorded.",
    notifiedVia: item.notifiedVia,
  };
  if (item.claimedBrand) warning.claimedBrand = scrubBannedWords(item.claimedBrand);
  if (item.familyResponse) warning.familyResponse = scrubBannedWords(item.familyResponse);
  if (item.userAction) warning.userAction = item.userAction;
  return warning;
}

function toHelper(contact: FamilyContact): FamilyHelperView {
  const helper: FamilyHelperView = {
    name: contact.name,
    phoneLast4: contact.phone.replace(/\D/g, "").slice(-4),
  };
  if (contact.relation) helper.relation = contact.relation;
  return helper;
}

async function snapshot(user: User): Promise<FamilySnapshot> {
  return familyView(user, await listCasesForUser(user._id, 7));
}

function replyText(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const text = (payload as { text?: unknown }).text;
  return typeof text === "string" ? text.trim().slice(0, 500) : "";
}

/**
 * The parent hears "Message from <name>", so the name must be a helper they already have.
 * Free text would let anyone with the link speak as "Son" or "Chase Bank".
 */
export function replyFrom(payload: unknown, user: User): string {
  const fallback = "your family page";
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fallback;
  const from = (payload as { from?: unknown }).from;
  if (typeof from !== "string") return fallback;
  const helper = user.familyContacts.find((item) => item.name.trim().toLowerCase() === from.trim().toLowerCase());
  return helper ? helper.name : fallback;
}

function noticePage(message: string): string {
  return documentPage(`<main><p>${escapeHtml(message)}</p></main>`);
}

function documentPage(body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'">
  <title>ScamCheck family</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f3efe6;
      --ink: #1c1714;
      --muted: #6d645c;
      --card: #fffdf8;
      --line: #e4dcd0;
      --scam: #9f1239;
      --scam-bg: #fff1f2;
      --warn: #92400e;
      --warn-bg: #fffbeb;
      --quiet: #3f6212;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font: 17px/1.45 ui-sans-serif, system-ui, sans-serif;
    }
    main { max-width: 740px; margin: 0 auto; padding: 28px 18px 72px; }
    .eyebrow { margin: 0; color: var(--muted); font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; }
    h1 { margin: 6px 0 8px; font-family: Georgia, "Iowan Old Style", serif; font-size: 2rem; letter-spacing: -0.03em; line-height: 1.1; }
    h2 { margin: 28px 0 10px; font-size: 1.15rem; }
    .lede, .fine { color: var(--muted); }
    .lede { margin: 0 0 18px; }
    .fine { margin: 8px 0 0; font-size: 14px; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    .metric, .card, .panel { background: var(--card); border: 1px solid var(--line); border-radius: 16px; }
    .metric { padding: 14px 12px; }
    .metric span { display: block; color: var(--muted); font-size: 13px; }
    .metric b { display: block; margin-top: 4px; font-size: 1.7rem; letter-spacing: -0.03em; }
    .stack { display: grid; gap: 10px; }
    .card { padding: 14px 16px; }
    .card header { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
    .badge { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
    .badge.scam { color: var(--scam); }
    .badge.suspicious { color: var(--warn); }
    .when { color: var(--muted); font-size: 13px; }
    .card h3 { margin: 8px 0 4px; font-size: 1.05rem; }
    .card p { margin: 0; }
    .meta { margin-top: 8px; color: var(--muted); font-size: 14px; }
    .reply { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line); }
    .helper { display: flex; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
    .helper:last-child { border-bottom: 0; }
    .panel { padding: 16px; }
    form { display: grid; gap: 8px; }
    label { font-size: 14px; color: var(--muted); }
    input, textarea, select, button { font: inherit; }
    input, textarea, select {
      width: 100%;
      padding: 12px 12px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: #fff;
      color: var(--ink);
    }
    textarea { min-height: 88px; resize: vertical; }
    button {
      justify-self: start;
      padding: 12px 18px;
      border: 0;
      border-radius: 999px;
      background: var(--ink);
      color: #fff;
      cursor: pointer;
    }
    button:disabled { opacity: 0.55; cursor: default; }
    .note { min-height: 1.2em; margin: 8px 0 0; color: var(--scam); }
    .note.ok { color: var(--quiet); }
    @media (max-width: 640px) {
      .metrics { grid-template-columns: repeat(2, 1fr); }
      h1 { font-size: 1.7rem; }
    }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

function familyPageHtml(): string {
  return documentPage(`<main id="app"><p class="lede">Loading…</p></main>
<script>
const token = new URLSearchParams(location.search).get("t") || "";
const app = document.querySelector("#app");
let editing = false;
let loading = false;
let pending = false;
let note = "";
let noteOk = false;

document.addEventListener("focusin", function (event) {
  const target = event.target;
  if (target && target.matches && target.matches("input, textarea, select")) editing = true;
});
document.addEventListener("focusout", function () {
  setTimeout(function () {
    const active = document.activeElement;
    if (!active || !active.matches || !active.matches("input, textarea, select")) editing = false;
  }, 150);
});

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function when(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function sourceLabel(source) {
  if (source === "email") return "Email";
  if (source === "call") return "Call";
  if (source === "whatsapp") return "WhatsApp";
  return "Text";
}

function viaLabel(list) {
  const names = { call: "Called", text: "Texted", digest: "Daily summary" };
  if (!list || !list.length) return "Noted";
  return list.map(function (item) { return names[item] || item; }).join(" · ");
}

function actionLabel(action) {
  if (action === "paid") return "They said they already paid.";
  if (action === "clicked") return "They said they already clicked.";
  if (action === "confirmed_real") return "A helper said this one is real.";
  return "";
}

function field(form, id, label, placeholder) {
  const wrap = el("label", "", label);
  wrap.htmlFor = id;
  const input = document.createElement("input");
  input.id = id;
  input.name = id;
  input.placeholder = placeholder;
  input.autocomplete = "off";
  form.append(wrap, input);
  return input;
}

function render(data) {
  const root = el("div");
  root.append(el("p", "eyebrow", "ScamCheck"));
  root.append(el("h1", "", data.parentName));
  const gmail = data.gmailConnected
    ? "Gmail connected" + (data.gmailEmail ? " · " + data.gmailEmail : "")
    : "Gmail not connected";
  root.append(el("p", "lede", "Warnings for them in " + (data.languageLabel || data.language || "English") + ". " + gmail + "."));
  root.append(el("p", "fine", "We don't store the original emails or messages. This page shows the short summaries ScamCheck already keeps."));

  const metrics = el("div", "metrics");
  [
    ["Emails checked", data.metrics.emailsChecked],
    ["Warnings", data.metrics.warnings],
    ["Calls", data.metrics.calls],
    ["Family replies", data.metrics.familyReplies],
  ].forEach(function (pair) {
    const card = el("div", "metric");
    card.append(el("span", "", pair[0]));
    card.append(el("b", "", String(pair[1])));
    metrics.append(card);
  });
  root.append(metrics);
  root.append(el("p", "fine", "Warnings, calls, and replies are the last 7 days. Emails checked is the running total. " + data.quietCount + " checks came back with no red flags this week."));

  root.append(el("h2", "", "Warnings"));
  if (!data.warnings.length) {
    root.append(el("p", "lede", "No warnings in the last 7 days."));
  } else {
    const list = el("div", "stack");
    data.warnings.forEach(function (item) {
      const card = el("article", "card");
      const header = el("header");
      header.append(el("span", "badge " + item.verdict, item.verdict === "scam" ? "Scam" : "Suspicious"));
      header.append(el("span", "when", sourceLabel(item.source) + " · " + when(item.createdAt)));
      card.append(header);
      const title = item.claimedBrand ? item.scamType + " · " + item.claimedBrand : item.scamType;
      card.append(el("h3", "", title));
      card.append(el("p", "", item.summary));
      card.append(el("p", "meta", viaLabel(item.notifiedVia)));
      const action = actionLabel(item.userAction);
      if (action) card.append(el("p", "meta", action));
      if (item.familyResponse) card.append(el("p", "reply", item.familyResponse));
      list.append(card);
    });
    root.append(list);
  }

  if (data.canReply) {
    root.append(el("h2", "", "Pass a message"));
    const panel = el("div", "panel");
    panel.append(el("p", "lede", "This goes to " + data.parentName + " as a text and a voice note, on the latest open warning."));
    const form = document.createElement("form");
    form.id = "reply-form";
    // Sender is picked from saved helpers; the server rejects any other name.
    const fromLabel = el("label", "", "From");
    fromLabel.htmlFor = "from";
    const fromSelect = document.createElement("select");
    fromSelect.id = "from";
    data.helpers.forEach(function (helper) {
      fromSelect.append(new Option(helper.relation ? helper.name + " (" + helper.relation + ")" : helper.name, helper.name));
    });
    fromSelect.append(new Option("Family page", ""));
    form.append(fromLabel, fromSelect);
    const replyLabel = el("label", "", "Message");
    replyLabel.htmlFor = "reply-text";
    const replyBox = document.createElement("textarea");
    replyBox.id = "reply-text";
    replyBox.name = "text";
    replyBox.maxLength = 500;
    replyBox.placeholder = "Don't pay. I'll call you.";
    form.append(replyLabel, replyBox);
    const send = el("button", "", "Send to them");
    send.type = "submit";
    form.append(send);
    panel.append(form);
    root.append(panel);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      submit(form, "/family/reply", {
        from: form.querySelector("#from").value,
        text: form.querySelector("#reply-text").value,
      }, "Passed on.");
    });
  }

  root.append(el("h2", "", "Helpers"));
  root.append(el("p", "lede", "People you add get a text when something looks risky. They can reply, and ScamCheck passes it on."));
  const people = el("div", "panel");
  if (!data.helpers.length) {
    people.append(el("p", "lede", "No helpers yet."));
  } else {
    data.helpers.forEach(function (helper) {
      const row = el("div", "helper");
      const who = helper.relation ? helper.name + " · " + helper.relation : helper.name;
      row.append(el("span", "", who));
      row.append(el("span", "when", helper.phoneLast4 ? "···" + helper.phoneLast4 : ""));
      people.append(row);
    });
  }
  root.append(people);

  const addPanel = el("div", "panel");
  const addForm = document.createElement("form");
  addForm.id = "helper-form";
  field(addForm, "helper-name", "Name", "Aryan");
  field(addForm, "helper-phone", "Phone", "+1 206 555 0100");
  field(addForm, "helper-relation", "Relation, optional", "son");
  const addButton = el("button", "", "Add helper");
  addButton.type = "submit";
  addForm.append(addButton);
  addPanel.append(addForm);
  root.append(addPanel);
  addForm.addEventListener("submit", function (event) {
    event.preventDefault();
    submit(addForm, "/family/helpers", {
      name: addForm.querySelector("#helper-name").value,
      phone: addForm.querySelector("#helper-phone").value,
      relation: addForm.querySelector("#helper-relation").value,
    }, "Helper added. They'll get the next alert.");
  });

  const status = el("p", noteOk ? "note ok" : "note", note);
  root.append(status);
  root.append(el("p", "fine", "Automated check. It can be wrong. Verify with the company directly."));
  app.replaceChildren(root);
}

async function submit(form, path, payload, success) {
  const button = form.querySelector("button");
  if (button) button.disabled = true;
  noteOk = false;
  try {
    await post(path, payload);
    note = success;
    noteOk = true;
    editing = false;
    await load(true);
  } catch (error) {
    note = error && error.message ? error.message : "That didn't work. Try again.";
    noteOk = false;
    if (button) button.disabled = false;
    const status = app.querySelector(".note");
    if (status) {
      status.textContent = note;
      status.className = "note";
    }
  }
}

async function post(path, payload) {
  const response = await fetch(path + "?t=" + encodeURIComponent(token), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(function () { return {}; });
  if (!response.ok) throw new Error(data.error || "That didn't work. Try again.");
  return data;
}

async function load(force) {
  if (editing && !force) return;
  if (loading) {
    if (force) pending = true;
    return;
  }
  loading = true;
  try {
    const response = await fetch("/family/api?t=" + encodeURIComponent(token));
    const data = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      app.textContent = data.error || "This family link is not valid.";
      return;
    }
    render(data);
  } catch (error) {
    if (force || !app.querySelector("h1")) app.textContent = "Couldn't load this page. Try again.";
  } finally {
    loading = false;
    if (pending) {
      pending = false;
      load(true);
    } else {
      note = "";
      noteOk = false;
    }
  }
}

load(false);
setInterval(function () { load(false); }, 15000);
</script>`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
