// HTML for the account website. Views take plain data so they render without a database.
import { COLORS, barList, dailyBars, donut, legend, sparkline, type Segment } from "./charts.js";
import { brandMark, escapeHtml, icon, page } from "./layout.js";
import { validTimeZone, type CaseStats, type ParentView, type RangeDays, type WarningItem } from "./stats.js";

const FOOTER = "Automated check. It can be wrong. Verify with the company directly.";

export interface AccountView {
  name: string;
  email: string;
}

export interface RecentWarning extends WarningItem {
  parentId: string;
  parentName: string;
}

export interface OverviewInput {
  account: AccountView;
  parents: readonly ParentView[];
  totals: CaseStats;
  recent: readonly RecentWarning[];
  days: RangeDays;
  now: Date;
  timeZone: string;
  notice?: string;
  error?: string;
}

export interface ParentPageInput {
  account: AccountView;
  parents: readonly ParentView[];
  parent: ParentView;
  days: RangeDays;
  now: Date;
  timeZone: string;
  notice?: "added" | "connected";
}

export interface AddParentInput {
  account: AccountView;
  parents: readonly ParentView[];
  atLimit: boolean;
  error?: string;
  fields?: Record<string, string>;
}

// The one inline script on every account page (it runs in <head>):
// - strips a one-time notice from the address bar and copies the Gmail link
// - shows a spinner on submit and blocks double submits
// - reveals landing sections on scroll and counts numbers up on first view
// - on dashboard pages (<main data-live>), refetches the page every 15 s and swaps in only
//   the panels whose HTML changed, so new warnings appear without a reload or a replayed intro.
//   It waits while someone is selecting, typing, or has a menu open.
export const SITE_SCRIPT = `(function () {
  var root = document.documentElement;
  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var each = function (list, fn) { Array.prototype.forEach.call(list, fn); };
  var format = function (value) { return Math.round(value).toLocaleString("en-US"); };
  var signatures = new WeakMap();
  var loading = false;

  var url = new URL(location.href);
  if (url.searchParams.has("notice") || url.searchParams.has("error")) {
    url.searchParams.delete("notice");
    url.searchParams.delete("error");
    history.replaceState(null, "", url.pathname + url.search);
  }
  if (!still && "IntersectionObserver" in window) root.classList.add("js-reveal");

  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest("[data-copy]");
    if (!button) return;
    var input = document.getElementById(button.getAttribute("data-copy"));
    var label = button.querySelector("span");
    if (!input || !label) return;
    input.select();
    var done = function () {
      label.textContent = "Copied";
      button.classList.add("copied");
      setTimeout(function () { label.textContent = "Copy link"; button.classList.remove("copied"); }, 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(input.value).then(done, function () { document.execCommand("copy"); done(); });
    } else {
      document.execCommand("copy");
      done();
    }
  });

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (form.hasAttribute("data-sending")) { event.preventDefault(); return; }
    form.setAttribute("data-sending", "");
    var button = event.submitter || form.querySelector("[type=submit]");
    if (button && button.classList.contains("btn")) {
      button.classList.add("is-busy");
      button.setAttribute("aria-busy", "true");
    }
    setTimeout(release, 8000);
  });
  function release() {
    each(document.querySelectorAll("form[data-sending]"), function (form) { form.removeAttribute("data-sending"); });
    each(document.querySelectorAll(".is-busy"), function (button) {
      button.classList.remove("is-busy");
      button.removeAttribute("aria-busy");
    });
  }
  addEventListener("pageshow", function (event) { if (event.persisted) release(); });

  function countUp(el, from, to, delay) {
    if (still || from === to) { el.textContent = format(to); return; }
    var start = 0;
    el.textContent = format(from);
    requestAnimationFrame(function step(now) {
      if (!start) start = now + delay;
      var t = Math.min(1, Math.max(0, (now - start) / 900));
      el.textContent = format(from + (to - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(step);
    });
  }
  function bump(el) {
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
  }
  function intro() {
    each(document.querySelectorAll("[data-count]"), function (el) {
      countUp(el, 0, Number(el.getAttribute("data-count")), Number(el.getAttribute("data-delay") || 250));
    });
  }

  function regions(doc) {
    var main = doc.querySelector("main[data-live]");
    if (!main) return null;
    var parts = Array.prototype.filter.call(main.children, function (el) { return !el.classList.contains("notice"); });
    return { main: main, parts: parts, edges: [doc.querySelector(".sidebar .nav"), doc.querySelector(".topbar-inner")] };
  }
  function remember() {
    var current = regions(document);
    if (!current) return;
    each(current.edges.concat(current.parts), function (el) {
      if (el && !signatures.has(el)) signatures.set(el, el.outerHTML);
    });
  }
  function replace(el, next) {
    if (!el || !next) return;
    var html = next.outerHTML;
    if (signatures.get(el) === html) return;
    var copy = document.importNode(next, true);
    signatures.set(copy, html);
    el.replaceWith(copy);
  }
  function badges() {
    var map = {};
    each(document.querySelectorAll(".sidebar .nav-item[href]"), function (link) {
      var badge = link.querySelector(".nav-count");
      var value = badge ? parseInt(badge.textContent, 10) : 0;
      if (value > 0) map[link.getAttribute("href")] = { el: badge, value: value };
    });
    return map;
  }
  function swap(doc) {
    var current = regions(document);
    var next = regions(doc);
    if (!current || !next) return;
    var keys = Array.prototype.map.call(document.querySelectorAll(".feed-item[data-key]"), function (el) { return el.getAttribute("data-key"); });
    var counts = Array.prototype.map.call(current.main.querySelectorAll("[data-count]"), function (el) { return Number(el.getAttribute("data-count")); });
    var oldBadges = badges();
    var reshaped = current.main.getAttribute("data-state") !== next.main.getAttribute("data-state") || current.parts.length !== next.parts.length;
    root.classList.add("settled");
    replace(current.edges[0], next.edges[0]);
    replace(current.edges[1], next.edges[1]);
    if (reshaped) {
      root.classList.remove("settled");
      current.main.replaceWith(document.importNode(next.main, true));
      remember();
      intro();
      return;
    }
    each(current.parts, function (el, index) { replace(el, next.parts[index]); });
    remember();
    each(document.querySelectorAll(".feed-item[data-key]"), function (el) {
      if (keys.indexOf(el.getAttribute("data-key")) < 0) el.classList.add("fresh");
    });
    var now = document.querySelectorAll("main[data-live] [data-count]");
    if (now.length === counts.length) {
      each(now, function (el, index) {
        var to = Number(el.getAttribute("data-count"));
        if (counts[index] === to) return;
        countUp(el, counts[index], to, 0);
        bump(el);
      });
    }
    var newBadges = badges();
    Object.keys(newBadges).forEach(function (href) {
      if (newBadges[href].value > (oldBadges[href] ? oldBadges[href].value : 0)) bump(newBadges[href].el);
    });
  }
  function busy() {
    if (document.hidden || String(getSelection())) return true;
    var active = document.activeElement;
    if (active && active.matches && active.matches("input, select, textarea, summary")) return true;
    return !!document.querySelector("details[open], form[data-sending]");
  }
  function refresh() {
    if (loading || busy()) return;
    loading = true;
    fetch(location.href, { credentials: "same-origin", cache: "no-store" })
      .then(function (response) {
        if (response.redirected) { location.reload(); return ""; }
        return response.ok ? response.text() : "";
      })
      .then(function (html) {
        if (html && !busy()) swap(new DOMParser().parseFromString(html, "text/html"));
      })
      .catch(function () {})
      .then(function () { loading = false; });
  }

  function ready() {
    var header = document.querySelector(".site-header");
    if (header) {
      var onScroll = function () { header.classList.toggle("scrolled", scrollY > 8); };
      addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }
    if (root.classList.contains("js-reveal")) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        });
      }, { rootMargin: "0px 0px -8% 0px" });
      each(document.querySelectorAll("[data-reveal]"), function (el) { observer.observe(el); });
    }
    remember();
    intro();
    if (document.querySelector("main[data-live]")) {
      setInterval(refresh, 15000);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();`;

/* ---------- Public pages ---------- */

export function landingPage(signedIn: boolean): string {
  const start = signedIn
    ? `<a class="btn btn-primary btn-lg" href="/app">Open your dashboard ${icon("arrow", 18)}</a>`
    : `<a class="btn btn-primary btn-lg" href="/signup">Create an account ${icon("arrow", 18)}</a><a class="btn btn-secondary btn-lg" href="/login">Log in</a>`;
  const navActions = signedIn
    ? `<a class="btn btn-primary" href="/app">Open dashboard</a>`
    : `<a href="/login">Log in</a><a class="btn btn-primary" href="/signup">Create an account</a>`;
  const features: [string, string, string, string][] = [
    ["mail", "", "Watches their Gmail", "Read-only access. New emails are checked within seconds, with nothing for them to install or learn."],
    ["phone", "scam", "Calls them when it's serious", "For a high-risk email, ScamCheck phones them, explains the danger out loud, then follows up with a text."],
    ["chat", "", "Ask anything, anytime", "A strange text or WhatsApp? They forward it to ScamCheck in iMessage, or just call and describe it."],
    ["family", "ok", "Brings the family in", "You get an alert on risky items. Reply, and ScamCheck passes it on, translated, as a text and voice note."],
    ["memory", "", "Remembers every case", "Calls, texts, and emails share one memory, so it knows which email they're calling about."],
    ["calendar", "warn", "One calm daily summary", "Instead of a ping per email: “I checked 23 emails today. 1 looked suspicious.”"],
  ];
  const body = `<div class="site">
  <header class="site-header"><div class="site-nav">
    <a class="brand" href="/">${brandMark(34)}<span>ScamCheck</span></a>
    <nav class="site-links" aria-label="Site">
      <a href="#how">How it works</a>
      <a href="#privacy">Privacy</a>
      <a href="/radar">Scam Radar</a>
      ${navActions}
    </nav>
  </div></header>
  <section class="hero">
    <div>
      <span class="chip"><i></i>Scam protection for families</span>
      <h1>Protect your parents from scams, <span class="grad">in their own language.</span></h1>
      <p class="hero-lead">ScamCheck watches their inbox, calls them when something is dangerous, and brings you in to help. The AI catches it; the family decides.</p>
      <div class="hero-cta">${start}</div>
      <div class="langs">Speaks <span>English</span><span>Español</span><span lang="ur" dir="rtl">اردو</span><span lang="hi">हिन्दी</span></div>
    </div>
    ${heroMock()}
  </section>
  <section class="section" id="features">
    <div class="section-head" data-reveal>
      <p class="eyebrow">What it does</p>
      <h2>It lives where they already are.</h2>
      <p>iMessage, phone calls, and their email inbox. ScamCheck doesn't wait to be asked.</p>
    </div>
    <div class="features">${features
      .map(
        ([name, tone, title, text], index) =>
          `<article class="feature" data-reveal style="--i:${index % 3}"><span class="feature-icon ${tone}">${icon(name, 22)}</span><h3>${title}</h3><p>${text}</p></article>`,
      )
      .join("")}</div>
  </section>
  <section class="section" id="how">
    <div class="section-head" data-reveal>
      <p class="eyebrow">How it works</p>
      <h2>Set it up for them in two minutes.</h2>
      <p>You do the setup. They don't have to learn anything new.</p>
    </div>
    <div class="steps">
      <article class="step" data-reveal><span class="step-num">1</span><h3>Create an account</h3><p>Your login is for you, the person who wants to keep an eye out.</p></article>
      <article class="step" data-reveal style="--i:1"><span class="step-num">2</span><h3>Add a parent</h3><p>Enter their name, mobile number, and Gmail address, then send them their Gmail link.</p></article>
      <article class="step" data-reveal style="--i:2"><span class="step-num">3</span><h3>Watch the dashboard</h3><p>Emails checked, warnings, and calls show up with charts for every parent.</p></article>
    </div>
  </section>
  <section class="section" id="privacy">
    <div class="privacy" data-reveal>
      <div>
        <p class="eyebrow">Privacy first</p>
        <h2>Built to see as little as possible.</h2>
        <p>ScamCheck checks messages for scams and keeps a one-line summary of each case. You see warnings, never their emails.</p>
      </div>
      <div class="privacy-list">
        <div class="privacy-item" data-reveal style="--i:1">${icon("lock", 20)}<div><b>Read-only Gmail</b><p>ScamCheck can read new email to look for scams. It can't send, delete, or change anything.</p></div></div>
        <div class="privacy-item" data-reveal style="--i:2">${icon("shield", 20)}<div><b>No emails stored</b><p>Messages are checked in memory. Only a short summary of each case is kept.</p></div></div>
        <div class="privacy-item" data-reveal style="--i:3">${icon("family", 20)}<div><b>The family decides</b><p>Rules and AI flag the risk. A person they trust helps decide what to do.</p></div></div>
        <div class="privacy-item" data-reveal style="--i:4">${icon("trash", 20)}<div><b>Delete anytime</b><p>Replying STOP deletes their data and disconnects Gmail.</p></div></div>
      </div>
    </div>
  </section>
  <section class="section" data-reveal>
    <div class="cta-band">
      <h2>Start looking out for them tonight.</h2>
      <p>Adding a parent takes two minutes.</p>
      <a class="btn btn-primary btn-lg" href="${signedIn ? "/app" : "/signup"}">${signedIn ? "Open your dashboard" : "Create an account"} ${icon("arrow", 18)}</a>
    </div>
  </section>
  <footer class="site-foot">
    <span>${FOOTER} Not affiliated with any bank, company, or government agency.</span>
    <span><a href="/radar">Community Scam Radar</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · ScamCheck</span>
  </footer>
</div>`;
  return page("ScamCheck · Scam protection for families", body, SITE_SCRIPT);
}

function heroMock(): string {
  const wave = [6, 12, 9, 15, 7, 13, 16, 8, 11, 14, 6, 10, 15, 9, 12, 7, 13, 8]
    .map((height, index) => `<i style="height:${height}px;--i:${index}"></i>`)
    .join("");
  const week = [2, 3, 1, 4, 2, 5, 3]
    .map((height, index) => `<i class="${index === 5 ? "hot" : ""}" style="height:${height * 8}px;--i:${index}"></i>`)
    .join("");
  return `<div class="mock" aria-hidden="true">
      <div class="float float-a"><small>Emails checked this week</small><b data-count="23" data-delay="1100">23</b><div class="mini-bars">${week}</div><small style="margin-top:8px">1 scam caught · 0 false alarms</small></div>
      <div class="mock-phone"><div class="mock-screen">
        <div class="mock-top">${brandMark(30)}<div><b>ScamCheck</b><small>iMessage</small></div></div>
        <div class="bubble in"><small>Forwarded</small>Chase: Your account is locked. Verify now at chase-secure-login.net</div>
        <div class="slot">
          <div class="typing"><i></i><i></i><i></i></div>
          <div class="bubble out"><b>🚨 This is a scam</b><ul><li>It says it's from Chase, but the link goes to a different website.</li><li>Real banks never ask you to verify by text.</li></ul>Don't tap the link. I let Omar know.</div>
        </div>
        <div class="bubble out voice"><span class="play">▶</span><span class="wave">${wave}</span><small>0:14 · اردو</small></div>
        <div class="bubble out family"><b>Message from Omar (son)</b>Don't pay anything. I'll call you tonight.</div>
      </div></div>
      <div class="float float-b"><small>${icon("phone", 14)}</small><b style="font-size:16px">Warning call placed</b><p>Called Rashid in Urdu about a fake USPS fee. Omar was alerted.</p></div>
    </div>`;
}

export function authPage(mode: "signup" | "login", error: string, fields: Record<string, string>): string {
  const signup = mode === "signup";
  const nameField = signup
    ? `<div class="field"><label class="label" for="name">Your name</label><input class="input" id="name" name="name" maxlength="80" autocomplete="name" placeholder="Omar Siddiqui" value="${escapeHtml(fields.name ?? "")}" required></div>`
    : "";
  const body = `<div class="auth">
  <aside class="auth-side">
    <a class="brand" href="/">${brandMark(34)}<span>ScamCheck</span></a>
    <div>
      <h2>Every scam warning for the people you love, in one place.</h2>
      <div class="auth-points">
        <div>${icon("mail", 20)}<span>Email checks start as soon as a parent connects Gmail.</span></div>
        <div>${icon("phone", 20)}<span>High-risk emails trigger a warning call in their language.</span></div>
        <div>${icon("family", 20)}<span>You're alerted on risky items, and your reply reaches them translated.</span></div>
      </div>
    </div>
    <div class="auth-quote"><b>The AI catches it; the family decides.</b>You see short warning summaries, never their emails.</div>
  </aside>
  <div class="auth-main">
    <div class="auth-card">
      <a class="brand auth-mobile-brand" href="/">${brandMark(30)}<span>ScamCheck</span></a>
      <h1>${signup ? "Create your account" : "Welcome back"}</h1>
      <p class="lede">${signup ? "This account is for you. You'll add your parents next." : "Log in to see how your parents are doing."}</p>
      ${error ? `<div class="notice error" role="alert">${icon("alert", 18)}<span>${escapeHtml(error)}</span></div>` : ""}
      <form class="form" method="post" action="${signup ? "/signup" : "/login"}">
        ${nameField}
        <div class="field"><label class="label" for="email">Email</label><input class="input" id="email" name="email" type="email" autocomplete="username" placeholder="you@example.com" value="${escapeHtml(fields.email ?? "")}" required></div>
        <div class="field"><label class="label" for="password">Password</label><input class="input" id="password" name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="8" required>${signup ? `<span class="hint">At least 8 characters.</span>` : ""}</div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">${signup ? "Create account" : "Log in"}</button>
      </form>
      ${signup ? `<p class="hint" style="margin-top:14px">By creating an account, you agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p>` : ""}
      <p class="auth-switch">${signup ? `Already have an account? <a href="/login">Log in</a>` : `New to ScamCheck? <a href="/signup">Create an account</a>`}</p>
    </div>
  </div>
</div>`;
  return page(signup ? "Create an account · ScamCheck" : "Log in · ScamCheck", body, SITE_SCRIPT);
}

/* ---------- Signed-in app ---------- */

export function overviewPage(input: OverviewInput): string {
  const { account, parents, days } = input;
  const range = parents.some((parent) => parent.watching) ? rangeToggle("/app", days) : "";
  const actions = parents.length
    ? `${range}<a class="btn btn-primary btn-sm" href="/app/parents/new">${icon("userPlus", 16)}Add a parent</a>`
    : "";
  const body = `${banner(input.notice, input.error)}${parents.length === 0 ? welcomePanel() : overviewBody(input)}`;
  const state = parents.length === 0 ? "welcome" : parents.some((parent) => parent.watching) ? "watching" : "waiting";
  return page(
    "Overview · ScamCheck",
    appShell({
      account,
      parents,
      active: "overview",
      title: "Overview",
      crumbs: `Welcome back, ${escapeHtml(firstName(account.name))}`,
      actions,
      body,
      live: state,
    }),
    SITE_SCRIPT,
  );
}

function overviewBody(input: OverviewInput): string {
  const { parents, totals, days } = input;
  const emails = parents.reduce((sum, parent) => sum + parent.emailsChecked, 0);
  const connected = parents.filter((parent) => parent.gmailConnected).length;
  const byParent = parents.map((parent) => ({
    label: parent.name,
    value: parent.stats.scams + parent.stats.suspicious,
    href: `/app/parents/${parent.id}`,
    color: parent.stats.scams > 0 ? COLORS.scam : COLORS.suspicious,
  }));
  const cards = panel(
    "Your parents",
    "Open a parent to see their charts and warnings",
    `<div class="parent-cards">${parents.map((parent) => parentCard(parent, parents)).join("")}</div>`,
  );
  const footer = `<p class="foot-note">${FOOTER} Times are ${escapeHtml(zoneName(input.timeZone, input.now))}.</p>`;
  if (!parents.some((parent) => parent.watching)) {
    return `${overviewStatus(input)}${waitingPanel(parents.length === 1 ? (parents[0]?.name ?? "a parent") : "a parent")}${cards}${footer}`;
  }
  return `${overviewStatus(input)}
    ${kpis([
      { label: "Emails scanned", value: emails, icon: "mail", tone: "", foot: `${connected} of ${parents.length} ${parents.length === 1 ? "parent" : "parents"} connected` },
      { label: "Scams caught", value: totals.scams, icon: "alert", tone: "scam", foot: `Last ${days} days`, spark: totals.daily.map((day) => day.scam), color: COLORS.scam },
      { label: "Suspicious", value: totals.suspicious, icon: "eye", tone: "warn", foot: `Last ${days} days`, spark: totals.daily.map((day) => day.suspicious), color: COLORS.suspicious },
      { label: "Warning calls", value: totals.calls, icon: "phone", tone: "violet", foot: `${totals.familyReplies} family ${totals.familyReplies === 1 ? "reply" : "replies"}` },
    ])}
    ${activityRow(totals, `Across all your parents, last ${days} days`)}
    <div class="grid-3">
      ${panel("Warnings by parent", `Scam and suspicious, last ${days} days`, barList(byParent, "No warnings for anyone in this period."))}
      ${panel("Most common scams", "By brand named, or type of scam", barList(totals.topScams.map((row) => ({ ...row, color: COLORS.violet })), "Nothing to rank yet."))}
      ${responsePanel(totals)}
    </div>
    ${panel(
      "Recent warnings",
      "Newest first, across your parents",
      input.recent.length
        ? `<div class="feed">${input.recent.map((item) => warningRow(item, input.now, input.timeZone, item)).join("")}</div>`
        : `<p class="empty-note">No warnings in the last ${days} days.</p>`,
    )}
    ${cards}
    ${footer}`;
}

function overviewStatus(input: OverviewInput): string {
  const { parents, totals, days } = input;
  const newestFirst = (list: ParentView[]) =>
    [...list].sort((a, b) => (b.warnings[0]?.createdAt.getTime() ?? 0) - (a.warnings[0]?.createdAt.getTime() ?? 0));
  const targeted = newestFirst(parents.filter((parent) => parent.stats.scams > 0));
  const unsure = newestFirst(parents.filter((parent) => parent.stats.suspicious > 0));
  const suspiciousLine = `${totals.suspicious} suspicious ${totals.suspicious === 1 ? "message" : "messages"}`;
  const target = targeted[0];
  if (target) {
    const extra = totals.suspicious > 0 ? ` Also ${suspiciousLine} worth a look.` : "";
    return statusBanner(
      "scam",
      "alert",
      `${totals.scams} ${totals.scams === 1 ? "scam" : "scams"} caught in the last ${days} days`,
      `${names(targeted.map((parent) => parent.name))} ${targeted.length === 1 ? "was" : "were"} targeted and told not to click or reply.${extra}`,
      `/app/parents/${target.id}`,
      "Review",
    );
  }
  const check = unsure[0];
  if (check) {
    return statusBanner(
      "warn",
      "eye",
      `${suspiciousLine} in the last ${days} days`,
      `Worth a look for ${names(unsure.map((parent) => parent.name))}.`,
      `/app/parents/${check.id}`,
      "Review",
    );
  }
  const waiting = parents.filter((parent) => !parent.gmailConnected);
  const pending = waiting[0];
  if (pending) {
    return statusBanner(
      "warn",
      "mail",
      `Finish setup for ${names(waiting.map((parent) => parent.name))}`,
      "Their Gmail isn't connected yet, so new emails aren't being checked.",
      `/app/parents/${pending.id}`,
      "Finish setup",
    );
  }
  return statusBanner("ok", "check", `All quiet. No warnings in the last ${days} days.`, "ScamCheck is watching every connected inbox.", "", "");
}

function welcomePanel(): string {
  return `<section class="panel welcome">
    <div>
      <span class="chip"><i></i>Your account is ready</span>
      <h2 style="margin-top:16px">Add your first parent</h2>
      <p>ScamCheck watches their Gmail for scams, calls them in their language when something is dangerous, and shows you every warning here, with charts.</p>
      <a class="btn btn-primary btn-lg" href="/app/parents/new">${icon("userPlus", 18)}Add a parent</a>
    </div>
    <div class="welcome-steps">
      <div><span class="num">1</span><div><b>Add their details</b><span>Name, mobile number, Gmail address, and language.</span></div></div>
      <div style="--i:1"><span class="num">2</span><div><b>Send them their Gmail link</b><span>They sign in with Google and allow read-only access.</span></div></div>
      <div style="--i:2"><span class="num">3</span><div><b>Watch the dashboard</b><span>Emails checked, warnings, and calls appear with charts.</span></div></div>
    </div>
  </section>`;
}

export function parentPage(input: ParentPageInput): string {
  const { parent, days } = input;
  const details = [parent.relation, `···${parent.phoneLast4}`, parent.languageLabel].filter(Boolean).join(" · ");
  const body = `${parentBanner(input.notice, parent.name)}
    ${parent.gmailConnected ? "" : setupPanel(parent)}
    ${parent.watching ? parentMetrics(input) : waitingPanel(parent.name)}
    <div class="grid-2">
      ${panel("Details", "", detailsList(parent, input.now, input.timeZone))}
      ${panel("Remove", "", removePanel(parent))}
    </div>
    <p class="foot-note">${FOOTER} Times are ${escapeHtml(zoneName(input.timeZone, input.now))}.</p>`;
  return page(
    `${parent.name} · ScamCheck`,
    appShell({
      account: input.account,
      parents: input.parents,
      active: parent.id,
      title: parent.name,
      crumbs: `<a href="/app">Overview</a> / ${escapeHtml(details)}`,
      lead: parentAvatar(parent, input.parents, "lg"),
      actions: `${statusBadge(parent)}${parent.watching ? rangeToggle(`/app/parents/${parent.id}`, days) : ""}`,
      body,
      live: `${parent.watching ? "watching" : "waiting"}${parent.gmailConnected ? "" : "-setup"}`,
    }),
    SITE_SCRIPT,
  );
}

function parentMetrics(input: ParentPageInput): string {
  const { parent, days, now } = input;
  const stats = parent.stats;
  const lastCheck = parent.lastCheckedAt ? `Last checked ${ago(parent.lastCheckedAt, now)}` : parent.gmailConnected ? "Waiting for the first check" : "Gmail not connected";
  return `${kpis([
      { label: "Emails scanned", value: parent.emailsChecked, icon: "mail", tone: "", foot: lastCheck },
      { label: "Scams caught", value: stats.scams, icon: "alert", tone: "scam", foot: `Last ${days} days`, spark: stats.daily.map((day) => day.scam), color: COLORS.scam },
      { label: "Suspicious", value: stats.suspicious, icon: "eye", tone: "warn", foot: `Last ${days} days`, spark: stats.daily.map((day) => day.suspicious), color: COLORS.suspicious },
      { label: "Warning calls", value: stats.calls, icon: "phone", tone: "violet", foot: `${stats.familyReplies} family ${stats.familyReplies === 1 ? "reply" : "replies"}` },
    ])}
    ${activityRow(stats, `${parent.name}, last ${days} days`)}
    <div class="grid-3">
      ${panel("Where warnings came from", "Email, texts, and calls", barList(stats.sources.map((row) => ({ ...row, color: COLORS.brand })), "No warnings in this period."))}
      ${panel("Most common scams", "By brand named, or type of scam", barList(stats.topScams.map((row) => ({ ...row, color: COLORS.violet })), "Nothing to rank yet."))}
      ${responsePanel(stats)}
    </div>
    ${panel(
      "Warnings",
      `Scam and suspicious messages, last ${days} days`,
      parent.warnings.length
        ? `<div class="feed">${parent.warnings.map((item) => warningRow(item, now, input.timeZone)).join("")}</div>`
        : `<p class="empty-note">No warnings in the last ${days} days. ${stats.quiet} ${stats.quiet === 1 ? "check" : "checks"} came back with no red flags.</p>`,
    )}`;
}

function setupPanel(parent: ParentView): string {
  const name = escapeHtml(parent.name);
  const link = parent.connectUrl
    ? `<div class="copy-row">
        <input class="input" id="connect-link" readonly value="${escapeHtml(parent.connectUrl)}" aria-label="Gmail link for ${name}">
        <button class="btn btn-secondary" type="button" data-copy="connect-link">${icon("copy", 16)}<span>Copy link</span></button>
        <a class="btn btn-primary" href="${escapeHtml(parent.connectUrl)}" target="_blank" rel="noopener noreferrer">Open link ${icon("external", 16)}</a>
      </div>`
    : `<p class="hint" style="margin-top:12px">The connect link is not ready yet. Set PUBLIC_BASE_URL on the server.</p>`;
  const mailbox = parent.email ? ` as ${escapeHtml(parent.email)}` : "";
  const charts = parent.watching
    ? `<span class="done">${icon("check", 16)}Texts and calls already show up here</span>`
    : `<span><span class="num">3</span>Warnings and charts show up here</span>`;
  return `<section class="panel setup">
    <span class="setup-icon">${icon("mail", 22)}</span>
    <div>
      <h2>Connect ${name}'s Gmail</h2>
      <p>Send ${name} this link, or open it with them. They sign in with Google and allow read-only access. ScamCheck can read their email but cannot send or delete it.</p>
      ${link}
      <div class="checklist">
        <span class="done">${icon("check", 16)}Added to your account</span>
        <span><span class="num">2</span>${name} signs in with Google${mailbox}</span>
        ${charts}
      </div>
    </div>
  </section>`;
}

function waitingPanel(name: string): string {
  const ghost = [34, 58, 42, 72, 48, 64, 38]
    .map((height, index) => `<div class="bar ghost" style="--i:${index}"><span class="seg-ghost seg-top" style="height:${height}%"></span></div>`)
    .join("");
  return `<section class="panel">
    <div class="chart" style="--gap:12px">
      <div class="chart-bars">
        <div class="bars-y" aria-hidden="true"><span style="top:0">4</span><span style="top:50%">2</span><span style="top:100%">0</span></div>
        <div class="bars-plot">${ghost}<div class="chart-empty"><div><b>Charts appear once ${escapeHtml(name)} connects Gmail</b>Emails checked, warnings, and calls, day by day.</div></div></div>
      </div>
    </div>
  </section>`;
}

function detailsList(parent: ParentView, now: Date, timeZone: string): string {
  const gmail = parent.gmailConnected
    ? escapeHtml(parent.gmailEmail ?? parent.email ?? "Connected")
    : parent.email
      ? `${escapeHtml(parent.email)} <span class="muted">(not connected)</span>`
      : "Not connected";
  const rows: [string, string][] = [
    ["Relation", escapeHtml(parent.relation ?? "—")],
    ["Mobile, for warning calls", `···${escapeHtml(parent.phoneLast4)}`],
    ["Language", escapeHtml(parent.languageLabel)],
    ["Gmail", gmail],
    ["Last email check", parent.lastCheckedAt ? escapeHtml(ago(parent.lastCheckedAt, now)) : "—"],
    ["Added", escapeHtml(dateOnly(parent.addedAt, timeZone))],
  ];
  return `<dl class="details-list">${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
}

function removePanel(parent: ParentView): string {
  const name = escapeHtml(parent.name);
  return `<p class="hint" style="margin-bottom:14px">Removing ${name} takes their summaries off your dashboard. If no other family account follows them, ScamCheck also stops reading their Gmail.</p>
    <details class="danger-zone">
      <summary>${icon("trash", 16)}Remove ${name}</summary>
      <p>Are you sure? You can add them again later, but they'll need to connect Gmail again.</p>
      <form method="post" action="/app/parents/remove">
        <input type="hidden" name="id" value="${escapeHtml(parent.id)}">
        <button class="btn btn-danger btn-sm" type="submit">Yes, remove ${name}</button>
      </form>
    </details>`;
}

export function addParentPage(input: AddParentInput): string {
  const fields = input.fields ?? {};
  const value = (key: string) => escapeHtml(fields[key] ?? "");
  const chosen = ["en", "es", "ur", "hi"].includes(fields.language ?? "") ? fields.language : "en";
  const languages: [string, string, string][] = [
    ["en", "English", "English"],
    ["es", "Español", "Spanish"],
    ["ur", "اردو", "Urdu"],
    ["hi", "हिन्दी", "Hindi"],
  ];
  const choices = languages
    .map(
      ([code, native, english]) =>
        `<label class="choice"><input type="radio" name="language" value="${code}"${code === chosen ? " checked" : ""}><span><b lang="${code}">${native}</b><small>${english}</small></span></label>`,
    )
    .join("");
  const limit = input.atLimit
    ? `<div class="notice error" role="alert">${icon("alert", 18)}<span>You can add up to 8 parents. Remove one to add another.</span></div>`
    : "";
  const error = input.error ? `<div class="notice error" role="alert">${icon("alert", 18)}<span>${escapeHtml(input.error)}</span></div>` : "";
  const body = `<div class="form-layout">
    <section class="panel">
      <div class="panel-head"><div><h2>Their details</h2><p>ScamCheck uses these to warn them, in their language.</p></div></div>
      ${limit}${error}
      <form class="form" method="post" action="/app/parents"${error || limit ? ` style="margin-top:18px"` : ""}>
        <fieldset class="form" style="border:0;padding:0;margin:0"${input.atLimit ? " disabled" : ""}>
          <div class="field-row">
            <div class="field"><label class="label" for="parent-name">Name</label><input class="input" id="parent-name" name="name" maxlength="80" autocomplete="off" placeholder="Rashid Khan" value="${value("name")}" required></div>
            <div class="field"><label class="label" for="parent-relation">Relation <small>optional</small></label><input class="input" id="parent-relation" name="relation" maxlength="40" autocomplete="off" placeholder="Dad" value="${value("relation")}"></div>
          </div>
          <div class="field"><label class="label" for="parent-phone">Mobile number</label><input class="input" id="parent-phone" name="phone" type="tel" inputmode="tel" autocomplete="off" placeholder="+1 206 555 0100" value="${value("phone")}" required><span class="hint">ScamCheck calls this number when an email looks dangerous.</span></div>
          <div class="field"><label class="label" for="parent-email">Gmail address</label><input class="input" id="parent-email" name="email" type="email" maxlength="200" autocomplete="off" placeholder="rashid@gmail.com" value="${value("email")}" required><span class="hint">Only this Gmail account can connect through their link.</span></div>
          <div class="field" role="radiogroup" aria-labelledby="language-label"><span class="label" id="language-label">Language they prefer</span><div class="choices">${choices}</div><span class="hint">Warnings, calls, and voice notes use this language.</span></div>
          <div><button class="btn btn-primary btn-lg" type="submit">${icon("userPlus", 18)}Add parent</button></div>
        </fieldset>
      </form>
    </section>
    <aside class="panel">
      <div class="panel-head"><div><h2>What happens next</h2><p>Nothing is sent to them until you share the link.</p></div></div>
      <div class="aside-steps">
        <div class="aside-step"><span class="num">1</span><div><b>You get their Gmail link</b><p>It shows on their page right after you add them.</p></div></div>
        <div class="aside-step"><span class="num">2</span><div><b>They sign in with Google</b><p>Read-only access. ScamCheck can't send, delete, or change anything.</p></div></div>
        <div class="aside-step"><span class="num">3</span><div><b>ScamCheck starts watching</b><p>Risky emails get a text, a voice note, or a call, and each warning shows up here.</p></div></div>
      </div>
      <p class="foot-note" style="margin-top:20px">You only ever see short warning summaries, never their emails.</p>
    </aside>
  </div>`;
  return page(
    "Add a parent · ScamCheck",
    appShell({
      account: input.account,
      parents: input.parents,
      active: "add",
      title: "Add a parent",
      crumbs: `<a href="/app">Overview</a> / New parent`,
      body,
    }),
    SITE_SCRIPT,
  );
}

/* ---------- Shell ---------- */

interface ShellOptions {
  account: AccountView;
  parents: readonly ParentView[];
  /** "overview", "add", or a parent id. */
  active: string;
  title: string;
  /** Trusted HTML. */
  crumbs?: string;
  lead?: string;
  actions?: string;
  body: string;
  /** Turns on the live refresh. A different value after a refresh replays the page intro. */
  live?: string;
}

function appShell(options: ShellOptions): string {
  const live = options.live ? ` data-live data-state="${escapeHtml(options.live)}"` : "";
  return `<div class="app">
  ${sidebar(options)}
  <div class="content">
    <header class="topbar"><div class="topbar-inner">
      <div class="topbar-title">${options.lead ?? ""}<div>${options.crumbs ? `<p class="crumbs">${options.crumbs}</p>` : ""}<h1>${escapeHtml(options.title)}</h1></div></div>
      ${options.actions ? `<div class="topbar-actions">${options.actions}</div>` : ""}
    </div></header>
    <main class="app-main"${live}>${options.body}</main>
  </div>
</div>`;
}

function sidebar({ account, parents, active }: ShellOptions): string {
  const glow = `<span class="nav-glow" aria-hidden="true"></span>`;
  const link = (href: string, name: string, label: string, isActive: boolean) =>
    `<a class="nav-item${isActive ? " active" : ""}" href="${href}"${isActive ? ` aria-current="page"` : ""}>${isActive ? glow : ""}${icon(name)}<span class="grow">${label}</span></a>`;
  const people = parents.length
    ? parents
        .map((parent) => {
          const warnings = parent.stats.scams + parent.stats.suspicious;
          const count =
            warnings > 0
              ? `<span class="nav-count ${parent.stats.scams > 0 ? "scam" : "suspicious"}" title="${warnings} ${warnings === 1 ? "warning" : "warnings"}">${warnings}</span>`
              : parent.gmailConnected
                ? ""
                : `<span class="nav-count setup" title="Gmail not connected">Set up</span>`;
          const isActive = active === parent.id;
          return `<a class="nav-item${isActive ? " active" : ""}" href="/app/parents/${escapeHtml(parent.id)}"${isActive ? ` aria-current="page"` : ""}>${isActive ? glow : ""}${parentAvatar(parent, parents, "sm")}<span class="grow">${escapeHtml(parent.name)}</span>${count}</a>`;
        })
        .join("")
    : `<p class="nav-empty">No parents yet</p>`;
  return `<aside class="sidebar">
    <a class="brand" href="/app">${brandMark(30)}<span>ScamCheck</span></a>
    <nav class="nav" aria-label="Menu">
      <p class="nav-label">Menu</p>
      ${link("/app", "overview", "Overview", active === "overview")}
      ${link("/app/parents/new", "userPlus", "Add a parent", active === "add")}
      ${link("/radar", "radar", "Scam Radar", false)}
      <p class="nav-label">Your parents</p>
      ${people}
    </nav>
    <div class="sidebar-foot">
      <div class="me">${avatar(account.name, "", "c5")}<div><b>${escapeHtml(account.name)}</b><span>${escapeHtml(account.email)}</span></div></div>
      <form method="post" action="/logout"><button class="nav-item" type="submit">${icon("logout")}<span class="grow">Log out</span></button></form>
    </div>
  </aside>`;
}

/* ---------- Pieces ---------- */

interface Kpi {
  label: string;
  value: number;
  icon: string;
  tone: string;
  foot: string;
  spark?: number[];
  color?: string;
}

function kpis(items: readonly Kpi[]): string {
  return `<div class="kpis">${items
    .map(
      (item) => `<div class="kpi">
        <div class="kpi-top"><span class="kpi-label">${escapeHtml(item.label)}</span><span class="kpi-icon ${item.tone}">${icon(item.icon, 18)}</span></div>
        <span class="kpi-value" data-count="${item.value}">${item.value.toLocaleString("en-US")}</span>
        <span class="kpi-foot">${escapeHtml(item.foot)}</span>
        ${item.spark && item.color ? sparkline(item.spark, item.color) : ""}
      </div>`,
    )
    .join("")}</div>`;
}

function activityRow(stats: CaseStats, subtitle: string): string {
  const segments: Segment[] = [
    { label: "Scam", value: stats.scams, color: COLORS.scam },
    { label: "Suspicious", value: stats.suspicious, color: COLORS.suspicious },
    { label: "No red flags", value: stats.quiet, color: COLORS.quiet },
  ];
  return `<div class="grid-main">
    ${panel("Checks per day", subtitle, `${dailyBars(stats.daily)}${legend(segments)}`, "Emails with links, attachments, or urgent wording get a full AI check. Other emails only count toward Emails scanned.")}
    ${panel("Verdicts", `Last ${stats.days} days`, donut(segments, stats.checks === 1 ? "check" : "checks"))}
  </div>`;
}

function responsePanel(stats: CaseStats): string {
  const warnings = stats.scams + stats.suspicious;
  const rows = [
    { label: "Warnings", value: warnings, color: COLORS.suspicious },
    { label: "Texted them", value: stats.texts, color: COLORS.brand },
    { label: "Called them", value: stats.calls, color: COLORS.violet },
    { label: "Family alerted", value: stats.familyAlerts, color: COLORS.scam },
    { label: "Family replied", value: stats.familyReplies, color: COLORS.ok },
  ];
  return panel("How ScamCheck responded", "From warning to family reply", barList(rows, "Nothing needed a response yet.", Math.max(warnings, 1)));
}

function panel(title: string, subtitle: string, content: string, foot = ""): string {
  return `<section class="panel">
    <div class="panel-head"><div><h2>${escapeHtml(title)}</h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}</div></div>
    ${content}
    ${foot ? `<p class="panel-foot">${escapeHtml(foot)}</p>` : ""}
  </section>`;
}

function statusBanner(tone: "ok" | "warn" | "scam", iconName: string, title: string, text: string, href: string, action: string): string {
  const button = href ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(href)}">${escapeHtml(action)} ${icon("arrow", 16)}</a>` : "";
  return `<section class="status ${tone}" role="status">
    <span class="status-icon">${icon(iconName, 22)}</span>
    <div><b>${escapeHtml(title)}</b><p>${escapeHtml(text)}</p></div>
    ${button}
  </section>`;
}

function parentCard(parent: ParentView, parents: readonly ParentView[]): string {
  const warnings = parent.stats.scams + parent.stats.suspicious;
  const sub = [parent.relation, parent.languageLabel].filter(Boolean).join(" · ");
  const foot = parent.gmailConnected ? "Open dashboard" : "Finish setup";
  return `<a class="parent-card" href="/app/parents/${escapeHtml(parent.id)}">
    <div class="parent-card-head">${parentAvatar(parent, parents)}<div><b>${escapeHtml(parent.name)}</b><span>${escapeHtml(sub)}</span></div>${statusBadge(parent)}</div>
    <div class="mini-stats">
      <div><small>Emails</small>${liveNumber(parent.emailsChecked)}</div>
      <div><small>Warnings</small>${liveNumber(warnings)}</div>
      <div><small>Calls</small>${liveNumber(parent.stats.calls)}</div>
    </div>
    <div class="parent-card-foot"><span>${foot}</span>${icon("arrow", 16)}</div>
  </a>`;
}

/** A number the page script can count up, and animate when a refresh changes it. */
function liveNumber(value: number): string {
  return `<b data-count="${value}">${value.toLocaleString("en-US")}</b>`;
}

function statusBadge(parent: ParentView): string {
  if (parent.stats.scams > 0) return `<span class="badge scam">Scam caught</span>`;
  if (parent.stats.suspicious > 0) return `<span class="badge suspicious">Needs a look</span>`;
  if (!parent.gmailConnected) return `<span class="badge neutral">No Gmail yet</span>`;
  return `<span class="badge ok">All quiet</span>`;
}

function warningRow(item: WarningItem, now: Date, timeZone: string, parent?: { parentId: string; parentName: string }): string {
  const sourceIcon = item.source === "Email" ? "mail" : item.source === "Phone call" ? "phone" : "chat";
  const who = parent
    ? `<a class="tag" href="/app/parents/${escapeHtml(parent.parentId)}">${escapeHtml(parent.parentName)}</a>`
    : "";
  return `<article class="feed-item" data-key="${item.createdAt.getTime()}-${escapeHtml(item.title)}">
    <span class="feed-icon ${item.verdict}">${icon(item.verdict === "scam" ? "alert" : "eye", 18)}</span>
    <div>
      <div class="feed-head"><span class="feed-title">${escapeHtml(item.title)}</span><span class="when">${escapeHtml(formatWhen(item.createdAt, now, timeZone))}</span></div>
      <p class="feed-summary">${escapeHtml(item.summary)}</p>
      <div class="feed-meta">
        <span class="badge ${item.verdict}">${item.verdict === "scam" ? "Scam" : "Suspicious"}</span>
        ${who}
        <span class="tag">${icon(sourceIcon, 13)}${escapeHtml(item.source)}</span>
        ${item.brand ? `<span class="tag">Says it's from ${escapeHtml(item.brand)}</span>` : ""}
        <span class="tag">Risk ${Math.round(item.riskScore)}</span>
        ${item.via.length ? `<span class="when">${escapeHtml(item.via.join(" · "))}</span>` : ""}
      </div>
      ${item.userAction ? `<p class="action-note">${escapeHtml(item.userAction)}</p>` : ""}
      ${item.familyResponse ? `<p class="reply-quote">${escapeHtml(item.familyResponse)}</p>` : ""}
    </div>
  </article>`;
}

function banner(notice?: string, error?: string): string {
  if (error) return `<div class="notice error" role="alert">${icon("alert", 18)}<span>${escapeHtml(error)}</span></div>`;
  if (notice) return `<div class="notice ok" role="status">${icon("check", 18)}<span>${escapeHtml(notice)}</span></div>`;
  return "";
}

function parentBanner(notice: ParentPageInput["notice"], name: string): string {
  if (notice === "added") return banner(`${name} was added. Send them the Gmail link below. Email checks start once they sign in with Google.`);
  if (notice === "connected") return banner(`${name} was added. Their Gmail is already connected, so their summaries are below.`);
  return "";
}

function rangeToggle(path: string, days: RangeDays): string {
  return `<nav class="seg" aria-label="Time range">${([7, 30] as const)
    .map((option) => `<a class="${option === days ? "on" : ""}" href="${escapeHtml(path)}?days=${option}"${option === days ? ` aria-current="true"` : ""}>${option} days</a>`)
    .join("")}</nav>`;
}

// Colors follow the account's parent order, so up to five parents never share one.
function parentAvatar(parent: ParentView, parents: readonly ParentView[], size = ""): string {
  const index = Math.max(0, parents.findIndex((item) => item.id === parent.id));
  return avatar(parent.name, size, `c${index % 5}`);
}

function avatar(name: string, size: string, tone: string): string {
  const letter = Array.from(name.trim())[0]?.toUpperCase() ?? "?";
  return `<span class="avatar ${tone}${size ? ` ${size}` : ""}" aria-hidden="true">${escapeHtml(letter)}</span>`;
}

function names(list: readonly string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function formatWhen(date: Date, now: Date, timeZone: string): string {
  const zone = validTimeZone(timeZone);
  const day = (value: Date) => value.toLocaleDateString("en-CA", { timeZone: zone });
  const time = date.toLocaleTimeString("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" });
  if (day(date) === day(now)) return `Today, ${time}`;
  if (day(date) === day(new Date(now.getTime() - 24 * 60 * 60 * 1000))) return `Yesterday, ${time}`;
  return `${date.toLocaleDateString("en-US", { timeZone: zone, month: "short", day: "numeric" })}, ${time}`;
}

function dateOnly(date: Date, timeZone: string): string {
  return date.toLocaleDateString("en-US", { timeZone: validTimeZone(timeZone), month: "short", day: "numeric", year: "numeric" });
}

function ago(date: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** "Pacific time (PDT)" style label so nobody reads server UTC as local time. */
function zoneName(timeZone: string, now: Date): string {
  const zone = validTimeZone(timeZone);
  const short = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
    .formatToParts(now)
    .find((part) => part.type === "timeZoneName")?.value;
  return short ? `in ${short}` : `in ${zone}`;
}
