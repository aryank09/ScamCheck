import { DEFAULT_QUIET_HOURS } from "../core/quietHours.js";
import { listCasesForUser, type CaseRecord } from "../db/cases.js";
import {
  accountForToken,
  addParentLink,
  closeSession,
  createAccount,
  ensureParentConnectToken,
  findAccountByEmail,
  listParentLinks,
  listParentLinksByPhone,
  openSession,
  removeParentLink,
  type Account,
  type ParentLink,
} from "../db/accounts.js";
import { checkPassword } from "../db/accounts.js";
import { findUserByPhone } from "../db/users.js";
import { disconnectGmail } from "../email/oauth.js";
import {
  clearSessionCookie,
  parentIsWatching,
  parseParent,
  parseSignup,
  readCookie,
  sessionCookie,
} from "./accountForms.js";
import { brandMark, escapeHtml, page } from "./layout.js";
import { privacyPage, termsPage } from "./legal.js";
import { caseStats, parentView, parseRange, type ParentView, type RangeDays } from "./stats.js";
import {
  addParentPage,
  authPage,
  landingPage,
  overviewPage,
  parentPage,
  type AccountView,
  type RecentWarning,
} from "./views.js";

export { escapeHtml, page } from "./layout.js";

const MAX_PARENTS = 8;
const COOKIE = "scamcheck_session";
const PARENT_PATH = /^\/app\/parents\/([a-f0-9]{24})$/;
// The server runs in UTC; dashboard days and times use the same zone as quiet hours.
const DISPLAY_TIME_ZONE = DEFAULT_QUIET_HOURS.tz;

const NOTICES: Record<string, string> = {
  removed: "Removed from your account.",
  stopped: "Removed. ScamCheck stopped reading their Gmail.",
};

export interface SiteResult {
  status: number;
  html?: string;
  redirect?: string;
  cookie?: string;
}

export function isSitePath(pathname: string): boolean {
  return ["/", "/signup", "/login", "/logout", "/app", "/privacy", "/terms"].includes(pathname) || pathname.startsWith("/app/");
}

export function siteErrorHtml(message: string): string {
  return page(
    "ScamCheck",
    `<main>
      <a class="brand" href="/">${brandMark(32)}<span>ScamCheck</span></a>
      <p class="lede" style="margin-top:28px">${escapeHtml(message)}</p>
      <p><a class="btn btn-secondary" href="/">Back to home</a></p>
    </main>`,
  );
}

export async function handleSite(
  method: string,
  url: URL,
  cookieHeader: string | undefined,
  body: Buffer | undefined,
): Promise<SiteResult> {
  const token = readCookie(cookieHeader, COOKIE);
  if (method === "GET" && url.pathname === "/") return { status: 200, html: landingPage(Boolean(await viewer(token))) };
  if (method === "GET" && url.pathname === "/privacy") return { status: 200, html: privacyPage() };
  if (method === "GET" && url.pathname === "/terms") return { status: 200, html: termsPage() };
  if (method === "GET" && url.pathname === "/signup") return authGet("signup", token);
  if (method === "GET" && url.pathname === "/login") return authGet("login", token);
  if (method === "POST" && url.pathname === "/signup") return signup(readForm(body));
  if (method === "POST" && url.pathname === "/login") return login(readForm(body));
  if (method === "POST" && url.pathname === "/logout") return logout(token);
  if (url.pathname === "/app" || url.pathname.startsWith("/app/")) {
    const account = await accountForToken(token);
    if (!account) return { status: 303, redirect: "/login" };
    if (method === "GET" && url.pathname === "/app") return overview(account, url);
    if (method === "GET" && url.pathname === "/app/parents/new") return newParent(account);
    if (method === "POST" && url.pathname === "/app/parents") return addParent(account, readForm(body));
    if (method === "POST" && url.pathname === "/app/parents/remove") return removeParent(account, readForm(body));
    const parentId = PARENT_PATH.exec(url.pathname)?.[1];
    if (method === "GET" && parentId) return parentDetail(account, parentId, url);
    return { status: 404, html: siteErrorHtml("That page does not exist.") };
  }
  return { status: 405, html: siteErrorHtml("That action is not available.") };
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

async function overview(account: Account, url: URL): Promise<SiteResult> {
  const days = parseRange(url.searchParams.get("days"));
  const now = new Date();
  const loaded = await loadParents(account, days, now);
  const parents = loaded.map((item) => item.view);
  const recent: RecentWarning[] = parents
    .flatMap((parent) => parent.warnings.map((item) => ({ ...item, parentId: parent.id, parentName: parent.name })))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 8);
  return {
    status: 200,
    html: overviewPage({
      account: accountView(account),
      parents,
      totals: caseStats(
        loaded.flatMap((item) => item.cases),
        days,
        now,
        DISPLAY_TIME_ZONE,
      ),
      recent,
      days,
      now,
      timeZone: DISPLAY_TIME_ZONE,
      notice: NOTICES[url.searchParams.get("notice") ?? ""],
      error: url.searchParams.get("error") === "missing" ? "That parent is not on your account." : undefined,
    }),
  };
}

async function parentDetail(account: Account, id: string, url: URL): Promise<SiteResult> {
  const days = parseRange(url.searchParams.get("days"));
  const now = new Date();
  const parents = (await loadParents(account, days, now)).map((item) => item.view);
  const parent = parents.find((item) => item.id === id);
  if (!parent) return { status: 404, html: siteErrorHtml("That parent is not on your account.") };
  const notice = url.searchParams.get("notice");
  return {
    status: 200,
    html: parentPage({
      account: accountView(account),
      parents,
      parent,
      days,
      now,
      timeZone: DISPLAY_TIME_ZONE,
      notice: notice === "added" || notice === "connected" ? notice : undefined,
    }),
  };
}

async function newParent(account: Account): Promise<SiteResult> {
  const parents = await sidebarParents(account);
  return {
    status: 200,
    html: addParentPage({ account: accountView(account), parents, atLimit: parents.length >= MAX_PARENTS }),
  };
}

async function addParent(account: Account, fields: Record<string, string>): Promise<SiteResult> {
  const retry = async (error: string): Promise<SiteResult> => {
    const parents = await sidebarParents(account);
    return {
      status: 400,
      html: addParentPage({ account: accountView(account), parents, atLimit: parents.length >= MAX_PARENTS, error, fields }),
    };
  };
  const parsed = parseParent(fields);
  if (!parsed.ok) return retry(parsed.error);
  if (!parsed.value.email) return retry("Enter their Gmail address.");
  const links = await listParentLinks(account._id);
  if (links.some((link) => link.phone === parsed.value.phone)) return retry("That number is already on your account.");
  if (links.length >= MAX_PARENTS) return retry("You can add up to 8 parents.");
  const user = await findUserByPhone(parsed.value.phone);
  const result = await addParentLink(account._id, { ...parsed.value, userId: user?._id });
  if (result === "duplicate") return retry("That number is already on your account.");
  // No confirmation step (team decision 10-17-26): adding a parent shows their summaries right away.
  // ponytail: anyone who knows a consenting parent's number can see their summaries; restore a
  // parent-side approval before real launch.
  const added = (await listParentLinks(account._id)).find((link) => link.phone === parsed.value.phone);
  if (!added) return { status: 303, redirect: "/app" };
  const notice = user?.gmail ? "connected" : "added";
  return { status: 303, redirect: `/app/parents/${added._id.toHexString()}?notice=${notice}` };
}

async function removeParent(account: Account, fields: Record<string, string>): Promise<SiteResult> {
  const id = fields.id ?? "";
  const link = (await listParentLinks(account._id)).find((item) => item._id.toHexString() === id);
  if (!link) return { status: 303, redirect: "/app?error=missing" };
  const removed = await removeParentLink(account._id, link.phone);
  if (!removed) return { status: 303, redirect: "/app?error=missing" };
  const stopped = await stopGmailIfNobodyWatches(link.phone);
  return { status: 303, redirect: "/app?notice=" + (stopped ? "stopped" : "removed") };
}

// Another family account may still rely on this parent's email checks.
async function stopGmailIfNobodyWatches(phone: string): Promise<boolean> {
  if ((await listParentLinksByPhone(phone)).length > 0) return false;
  const user = await findUserByPhone(phone);
  if (!user?.gmail) return false;
  await disconnectGmail(user);
  return true;
}

interface LoadedParent {
  view: ParentView;
  /** Empty until the parent has agreed, so totals never include hidden cases. */
  cases: CaseRecord[];
}

async function loadParents(account: Account, days: RangeDays, now: Date): Promise<LoadedParent[]> {
  const links = await listParentLinks(account._id);
  return Promise.all(links.map((link) => loadParent(link, days, now)));
}

async function loadParent(link: ParentLink, days: RangeDays, now: Date): Promise<LoadedParent> {
  const user = await findUserByPhone(link.phone);
  const connectUrl = user?.gmail ? undefined : gmailLink(await ensureParentConnectToken(link));
  const cases = user && parentIsWatching(user.consentAcceptedAt) ? await listCasesForUser(user._id, days) : [];
  return { view: parentView(link, user, cases, { days, now, timeZone: DISPLAY_TIME_ZONE, connectUrl }), cases };
}

async function sidebarParents(account: Account): Promise<ParentView[]> {
  return (await loadParents(account, 7, new Date())).map((item) => item.view);
}

function gmailLink(token: string): string | undefined {
  const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  return base ? `${base}/connect/gmail?p=${token}` : undefined;
}

function accountView(account: Account): AccountView {
  return { name: account.name || "You", email: account.email };
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
