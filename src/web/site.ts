import { listCasesForUser } from "../db/cases.js";
import {
  accountForToken,
  addParentLink,
  closeSession,
  createAccount,
  findAccountByEmail,
  listParentLinks,
  openSession,
  removeParentLink,
  saveParentInvite,
  type Account,
  type ParentLink,
} from "../db/accounts.js";
import { checkPassword } from "../db/accounts.js";
import { findUserByPhone } from "../db/users.js";
import { messageStatus, sendText } from "../channels/photon.js";
import { familyView, type FamilySnapshot } from "./family.js";
import {
  clearSessionCookie,
  inviteStillOpen,
  parentIsWatching,
  parseParent,
  parseSignup,
  readCookie,
  sessionCookie,
  textStatusLabel,
} from "./accountForms.js";

const MAX_PARENTS = 8;
const COOKIE = "scamcheck_session";

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  es: "Spanish",
  ur: "Urdu",
  hi: "Hindi",
};

const NOTICES: Record<string, string> = {
  added: "Added. SMS status is on their card. Reload this page to check delivery.",
  watching: "Added. We texted them. SMS status is on their card. Summaries show here once they reply ALLOW.",
  removed: "Removed from your account.",
};

export interface SiteResult {
  status: number;
  html?: string;
  redirect?: string;
  cookie?: string;
}

export function isSitePath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/signup" ||
    pathname === "/login" ||
    pathname === "/logout" ||
    pathname === "/app" ||
    pathname === "/app/parents" ||
    pathname === "/app/parents/remove"
  );
}

export function siteErrorHtml(message: string): string {
  return page("ScamCheck", `<main><p class="lede">${escapeHtml(message)}</p></main>`);
}

export async function handleSite(
  method: string,
  url: URL,
  cookieHeader: string | undefined,
  body: Buffer | undefined,
): Promise<SiteResult> {
  const token = readCookie(cookieHeader, COOKIE);
  if (method === "GET" && url.pathname === "/") return home(await viewer(token));
  if (method === "GET" && url.pathname === "/signup") return authGet("signup", token);
  if (method === "GET" && url.pathname === "/login") return authGet("login", token);
  if (method === "POST" && url.pathname === "/signup") return signup(readForm(body));
  if (method === "POST" && url.pathname === "/login") return login(readForm(body));
  if (method === "POST" && url.pathname === "/logout") return logout(token);
  if (url.pathname === "/app" || url.pathname.startsWith("/app/")) {
    const account = await accountForToken(token);
    if (!account) return { status: 303, redirect: "/login" };
    if (method === "GET" && url.pathname === "/app") return dashboard(account, url);
    if (method === "POST" && url.pathname === "/app/parents") return addParent(account, readForm(body));
    if (method === "POST" && url.pathname === "/app/parents/remove") return removeParent(account, readForm(body));
  }
  return { status: 405, html: siteErrorHtml("That action is not available.") };
}

async function home(account: Account | null): Promise<SiteResult> {
  const actions = account
    ? `<a class="button" href="/app">Open your parents</a>`
    : `<a class="button" href="/signup">Create an account</a><a class="button ghost" href="/login">Log in</a>`;
  return {
    status: 200,
    html: page(
      "ScamCheck",
      `<main>
        <p class="eyebrow">ScamCheck</p>
        <h1>Keep an eye on your parents.</h1>
        <p class="lede">Create an account, add a parent by name and mobile number, and read warning summaries here. The original emails and messages stay off this page.</p>
        <p class="actions">${actions}</p>
        <div class="steps">
          <article><b>1</b><h2>Create an account</h2><p>Your login is for you, the person who wants the summaries.</p></article>
          <article><b>2</b><h2>Add a parent</h2><p>Enter their name and mobile number, the same way you would add a child to a family account.</p></article>
          <article><b>3</b><h2>Read the metrics</h2><p>Emails checked, warnings, calls, and family replies appear after that number has agreed with ScamCheck.</p></article>
        </div>
        <p class="fine">Automated check. It can be wrong. Verify with the company directly.</p>
      </main>`,
    ),
  };
}

async function authGet(mode: "signup" | "login", token: string): Promise<SiteResult> {
  if (await accountForToken(token)) return { status: 303, redirect: "/app" };
  return { status: 200, html: authPage(mode, "", { name: "", email: "" }) };
}

async function signup(fields: Record<string, string>): Promise<SiteResult> {
  const parsed = parseSignup(fields);
  if (!parsed.ok) return { status: 400, html: authPage("signup", parsed.error, fields) };
  const created = await createAccount(parsed.value);
  if (!created.ok) {
    return { status: 400, html: authPage("signup", "An account with that email already exists.", fields) };
  }
  const token = await openSession(created.account._id);
  return { status: 303, redirect: "/app", cookie: sessionCookie(token, secureCookie()) };
}

async function login(fields: Record<string, string>): Promise<SiteResult> {
  const email = (fields.email ?? "").trim().toLowerCase();
  const account = email ? await findAccountByEmail(email) : null;
  const passwordOk = account ? await checkPassword(fields.password ?? "", account.passwordHash) : false;
  if (!account || !passwordOk) {
    return { status: 401, html: authPage("login", "That email and password did not match.", fields) };
  }
  const token = await openSession(account._id);
  return { status: 303, redirect: "/app", cookie: sessionCookie(token, secureCookie()) };
}

async function logout(token: string): Promise<SiteResult> {
  await closeSession(token);
  return { status: 303, redirect: "/", cookie: clearSessionCookie(secureCookie()) };
}

async function dashboard(account: Account, url: URL): Promise<SiteResult> {
  const notice = NOTICES[url.searchParams.get("notice") ?? ""] ?? "";
  const error = dashboardError(url.searchParams.get("error") ?? "");
  const links = await listParentLinks(account._id);
  const cards = await Promise.all(links.map(parentCard));
  return { status: 200, html: dashboardPage(account, cards, notice, error) };
}

async function addParent(account: Account, fields: Record<string, string>): Promise<SiteResult> {
  const parsed = parseParent(fields);
  if (!parsed.ok) return { status: 303, redirect: "/app?error=" + parentErrorCode(parsed.error) };
  const links = await listParentLinks(account._id);
  if (links.some((link) => link.phone === parsed.value.phone)) return { status: 303, redirect: "/app?error=duplicate" };
  if (links.length >= MAX_PARENTS) return { status: 303, redirect: "/app?error=limit" };
  const user = await findUserByPhone(parsed.value.phone);
  const result = await addParentLink(account._id, { ...parsed.value, userId: user?._id });
  if (result === "duplicate") return { status: 303, redirect: "/app?error=duplicate" };
  const watching = parentIsWatching(user?.consentAcceptedAt);
  // SMS goes out so the account can see whether the number actually received a text.
  // Summaries stay hidden until the parent replies ALLOW.
  await saveParentInvite(account._id, parsed.value.phone, await requestAllow(account.name, parsed.value.phone));
  return { status: 303, redirect: "/app?notice=" + (watching ? "watching" : "added") };
}

async function requestAllow(
  name: string,
  phone: string,
): Promise<{ messageId?: string; status: string; failure?: string }> {
  try {
    const sent = await sendText(
      phone,
      `${name} asked to see your ScamCheck warning summaries on the ScamCheck website. ` +
        "Reply ALLOW to share them. If you don't know them, ignore this.",
      "sms",
    );
    return {
      messageId: sent.id,
      status: sent.status,
      ...(sent.failure ? { failure: sent.failure } : {}),
    };
  } catch (error) {
    console.error("allow request failed error=" + (error as Error).name);
    const message = error instanceof Error ? error.message : "";
    const failure = /is not set|No sms agent/.test(message) ? "not_configured" : "send_failed";
    return { status: "failed", failure };
  }
}

async function removeParent(account: Account, fields: Record<string, string>): Promise<SiteResult> {
  const parsed = parseParent({ ...fields, language: "en" });
  if (!parsed.ok) return { status: 303, redirect: "/app?error=missing" };
  const removed = await removeParentLink(account._id, parsed.value.phone);
  return { status: 303, redirect: removed ? "/app?notice=removed" : "/app?error=missing" };
}

interface ParentCard {
  link: ParentLink;
  watching: boolean;
  snapshot?: FamilySnapshot;
}

async function parentCard(link: ParentLink): Promise<ParentCard> {
  const current = await refreshInvite(link);
  const user = await findUserByPhone(current.phone);
  if (!user || !parentIsWatching(user.consentAcceptedAt) || !current.approvedAt) return { link: current, watching: false };
  return { link: current, watching: true, snapshot: familyView(user, await listCasesForUser(user._id, 7)) };
}

async function refreshInvite(link: ParentLink): Promise<ParentLink> {
  if (!link.inviteMessageId || !inviteStillOpen(link.inviteStatus)) return link;
  try {
    const latest = await messageStatus(link.inviteMessageId);
    if (latest.status === link.inviteStatus && latest.failure === link.inviteFailure) return link;
    await saveParentInvite(link.accountId, link.phone, {
      messageId: link.inviteMessageId,
      status: latest.status,
      failure: latest.failure,
    });
    return { ...link, inviteStatus: latest.status, inviteFailure: latest.failure };
  } catch (error) {
    console.error("message status failed error=" + (error as Error).name);
    return link;
  }
}

function dashboardPage(account: Account, cards: ParentCard[], notice: string, error: string): string {
  return page(
    "Your parents",
    `<main>
      <div class="top">
        <div>
          <p class="eyebrow">ScamCheck</p>
          <h1>${escapeHtml(account.name)}</h1>
        </div>
        <form method="post" action="/logout"><button class="ghost" type="submit">Log out</button></form>
      </div>
      <p class="lede">Add a parent by name and mobile number. We send one SMS so you can see if it was delivered. Reload this page to check again. Summaries appear after they reply ALLOW.</p>
      ${banner(notice, error)}
      <section class="panel">
        <h2>Add a parent</h2>
        <form method="post" action="/app/parents">
          <label for="parent-name">Name</label>
          <input id="parent-name" name="name" maxlength="80" autocomplete="name" required>
          <label for="parent-phone">Mobile number</label>
          <input id="parent-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+1 206 555 0100" required>
          <label for="parent-language">Language they prefer</label>
          <select id="parent-language" name="language">
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="ur">Urdu</option>
            <option value="hi">Hindi</option>
          </select>
          <label for="parent-relation">Relation, optional</label>
          <input id="parent-relation" name="relation" maxlength="40" placeholder="mom">
          <button type="submit">Add parent</button>
        </form>
      </section>
      <h2>Parents</h2>
      ${cards.length === 0 ? `<p class="lede">No parents yet.</p>` : cards.map(renderCard).join("")}
      <p class="fine">Automated check. It can be wrong. Verify with the company directly.</p>
    </main>`,
  );
}

function renderCard(card: ParentCard): string {
  const last4 = card.link.phone.replace(/\D/g, "").slice(-4);
  const who = card.link.relation ? `${card.link.parentName} · ${card.link.relation}` : card.link.parentName;
  const language = card.snapshot?.languageLabel ?? LANGUAGE_LABELS[card.link.language] ?? card.link.language;
  const status = card.watching
    ? `<span class="pill watching">Watching</span>`
    : `<span class="pill waiting">Waiting for them</span>`;
  const sms = `<p class="meta">${escapeHtml(textStatusLabel(card.link.inviteStatus, card.link.inviteFailure))}</p>`;
  const check = inviteStillOpen(card.link.inviteStatus) ? `<p class="fine"><a href="/app">Check SMS status</a></p>` : "";
  const body = card.watching && card.snapshot
    ? metricsBlock(card.snapshot)
    : `<p class="lede">Summaries show here after they agree with ScamCheck and reply ALLOW.</p>`;
  return `<article class="card parent">
    <header>
      <div><h3>${escapeHtml(who)}</h3><p class="meta">···${escapeHtml(last4)} · ${escapeHtml(language)}</p></div>
      ${status}
    </header>
    ${sms}
    ${check}
    ${body}
    <form method="post" action="/app/parents/remove">
      <input type="hidden" name="name" value="${escapeHtml(card.link.parentName)}">
      <input type="hidden" name="phone" value="${escapeHtml(card.link.phone)}">
      <button class="ghost" type="submit">Remove</button>
    </form>
  </article>`;
}

function metricsBlock(snapshot: FamilySnapshot): string {
  const gmail = snapshot.gmailConnected
    ? `Gmail connected${snapshot.gmailEmail ? " · " + snapshot.gmailEmail : ""}`
    : "Gmail not connected";
  const metrics = [
    ["Emails checked", snapshot.metrics.emailsChecked],
    ["Warnings", snapshot.metrics.warnings],
    ["Calls", snapshot.metrics.calls],
    ["Family replies", snapshot.metrics.familyReplies],
  ]
    .map(
      ([label, value]) =>
        `<div class="metric"><span>${label}</span><b>${escapeHtml(String(value))}</b></div>`,
    )
    .join("");
  const warnings =
    snapshot.warnings.length === 0
      ? `<p class="lede">No warnings in the last 7 days.</p>`
      : `<div class="stack">${snapshot.warnings.slice(0, 5).map(warningCard).join("")}</div>`;
  return `<p class="meta">${escapeHtml(gmail)}</p>
    <div class="metrics">${metrics}</div>
    <p class="fine">${snapshot.quietCount} checks came back with no red flags this week. Emails checked is the running total.</p>
    ${warnings}`;
}

function warningCard(item: FamilySnapshot["warnings"][number]): string {
  const title = item.claimedBrand ? `${item.scamType} · ${item.claimedBrand}` : item.scamType;
  const label = item.verdict === "scam" ? "Scam" : "Suspicious";
  return `<article class="card inner">
    <header><span class="badge ${item.verdict}">${label}</span><span class="when">${escapeHtml(when(item.createdAt))}</span></header>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(item.summary)}</p>
  </article>`;
}

function dashboardError(code: string): string {
  if (code === "duplicate") return "That number is already on your account.";
  if (code === "limit") return "You can add up to 8 parents.";
  if (code === "missing") return "That parent is not on your account.";
  if (code === "name") return "Enter their name.";
  if (code === "phone") return "Enter a real mobile number.";
  if (code === "language") return "Choose English, Spanish, Urdu, or Hindi.";
  return "";
}

function parentErrorCode(error: string): string {
  if (error.includes("mobile")) return "phone";
  if (error.includes("Choose")) return "language";
  return "name";
}

function authPage(mode: "signup" | "login", error: string, fields: Record<string, string>): string {
  const signup = mode === "signup";
  const title = signup ? "Create an account" : "Log in";
  const name = signup
    ? `<label for="name">Your name</label><input id="name" name="name" maxlength="80" autocomplete="name" value="${escapeHtml(fields.name ?? "")}" required>`
    : "";
  return page(
    title,
    `<main>
      <p class="eyebrow">ScamCheck</p>
      <h1>${title}</h1>
      <p class="lede">${signup ? "This account is for you. You will add your parents next." : "Use the email and password from your ScamCheck account."}</p>
      ${error ? `<p class="note">${escapeHtml(error)}</p>` : ""}
      <form class="panel" method="post" action="${signup ? "/signup" : "/login"}">
        ${name}
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="username" value="${escapeHtml(fields.email ?? "")}" required>
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="8" required>
        <button type="submit">${signup ? "Create account" : "Log in"}</button>
      </form>
      <p class="fine">${signup ? `<a href="/login">Log in</a>` : `<a href="/signup">Create an account</a>`}</p>
    </main>`,
  );
}

function banner(notice: string, error: string): string {
  if (error) return `<p class="note">${escapeHtml(error)}</p>`;
  if (notice) return `<p class="note ok">${escapeHtml(notice)}</p>`;
  return "";
}

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

async function viewer(token: string): Promise<Account | null> {
  try {
    return await accountForToken(token);
  } catch (error) {
    console.error("account session failed error=" + (error as Error).name);
    return null;
  }
}

function readForm(body: Buffer | undefined): Record<string, string> {
  const params = new URLSearchParams((body ?? Buffer.alloc(0)).toString("utf8"));
  const fields: Record<string, string> = {};
  for (const [key, value] of params) fields[key] = value;
  return fields;
}

function secureCookie(): boolean {
  return (process.env.PUBLIC_BASE_URL ?? "").startsWith("https://");
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; --bg: #f3efe6; --ink: #1c1714; --muted: #6d645c; --card: #fffdf8; --line: #e4dcd0; --scam: #9f1239; --warn: #92400e; --quiet: #3f6212; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); font: 17px/1.45 ui-sans-serif, system-ui, sans-serif; }
    main { max-width: 760px; margin: 0 auto; padding: 32px 18px 72px; }
    a { color: var(--ink); }
    .eyebrow { margin: 0; color: var(--muted); font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; }
    h1 { margin: 6px 0 8px; font-family: Georgia, "Iowan Old Style", serif; font-size: 2.4rem; letter-spacing: -0.03em; line-height: 1.05; }
    h2 { margin: 28px 0 10px; font-size: 1.15rem; }
    h3 { margin: 0; font-size: 1.05rem; }
    .lede, .fine, .meta { color: var(--muted); }
    .lede { margin: 0 0 16px; }
    .fine { margin: 16px 0 0; font-size: 14px; }
    .meta { margin: 4px 0 0; font-size: 14px; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 8px 0 28px; }
    .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .steps article, .panel, .card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; }
    .steps article { padding: 16px; }
    .steps b { display: block; font-family: Georgia, serif; font-size: 1.4rem; }
    .steps h2 { margin: 8px 0 6px; }
    .steps p { margin: 0; color: var(--muted); }
    .top { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
    .panel { padding: 16px; }
    .card { padding: 16px; margin-top: 12px; }
    .card header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
    .card.inner { margin-top: 0; }
    .stack { display: grid; gap: 10px; margin-top: 12px; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 12px; }
    .metric { background: var(--bg); border-radius: 12px; padding: 12px; }
    .metric span { display: block; color: var(--muted); font-size: 13px; }
    .metric b { display: block; margin-top: 4px; font-size: 1.5rem; letter-spacing: -0.03em; }
    .badge { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
    .badge.scam { color: var(--scam); }
    .badge.suspicious { color: var(--warn); }
    .when { color: var(--muted); font-size: 13px; }
    .pill { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; border-radius: 999px; padding: 6px 10px; white-space: nowrap; }
    .pill.watching { color: var(--quiet); background: #f4f8e8; }
    .pill.waiting { color: var(--warn); background: #fffbeb; }
    form { display: grid; gap: 8px; }
    label { font-size: 14px; color: var(--muted); }
    input, select, button, .button { font: inherit; }
    input, select { width: 100%; padding: 12px; border: 1px solid var(--line); border-radius: 12px; background: #fff; color: var(--ink); }
    button, .button { justify-self: start; display: inline-block; padding: 12px 18px; border: 0; border-radius: 999px; background: var(--ink); color: #fff; text-decoration: none; cursor: pointer; }
    button.ghost, .button.ghost { background: transparent; color: var(--ink); border: 1px solid var(--line); }
    .note { margin: 0 0 12px; color: var(--scam); }
    .note.ok { color: var(--quiet); }
    @media (max-width: 700px) {
      h1 { font-size: 1.9rem; }
      .steps, .metrics { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
