import { createHash } from "node:crypto";

/**
 * Shared site template. `script` is inline JS allowed by its CSP hash (motion, forms, live
 * dashboard refresh). It runs in <head> so scroll reveals can hide content before first paint.
 * `head` adds extra tags (e.g. the radar page's meta refresh).
 */
export function page(title: string, body: string, script = "", head = ""): string {
  const scriptSrc = script
    ? `; script-src 'sha256-${createHash("sha256").update(script).digest("base64")}'; connect-src 'self'`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'${scriptSrc}">
  <title>${escapeHtml(title)}</title>
  ${head}
  <style>${SITE_CSS}</style>
  ${script ? `<script>${script}</script>` : ""}
</head>
<body>
${body}
</body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ICONS: Record<string, string> = {
  shield: `<path d="M12 3l7.5 3v5.5c0 4.6-3.1 8.4-7.5 9.9-4.4-1.5-7.5-5.3-7.5-9.9V6L12 3z"/><path d="M8.8 12.2l2.2 2.2 4.3-4.6"/>`,
  overview: `<rect x="3.5" y="3.5" width="7" height="8" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.6"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.6"/><rect x="3.5" y="14.5" width="7" height="6" rx="1.6"/>`,
  userPlus: `<circle cx="9.5" cy="8" r="3.8"/><path d="M2.8 20.5c.6-3.6 3.4-6 6.7-6s6.1 2.4 6.7 6"/><path d="M19 7.5v6M16 10.5h6"/>`,
  radar: `<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l5.5-5.5"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>`,
  logout: `<path d="M9.5 4.5H6.5a2 2 0 00-2 2v11a2 2 0 002 2h3"/><path d="M15.5 16.5l4.5-4.5-4.5-4.5"/><path d="M20 12H9.5"/>`,
  mail: `<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7.5l8.5 6 8.5-6"/>`,
  alert: `<path d="M10.3 4.2L2.8 17.3A2 2 0 004.5 20.3h15a2 2 0 001.7-3L13.7 4.2a2 2 0 00-3.4 0z"/><path d="M12 9.5v4"/><path d="M12 16.8v.1"/>`,
  eye: `<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>`,
  phone: `<path d="M6.6 3.5h2.8l1.5 4.2-2 1.4a12 12 0 006 6l1.4-2 4.2 1.5v2.8a2 2 0 01-2.2 2A16.6 16.6 0 014.6 5.7a2 2 0 012-2.2z"/>`,
  chat: `<path d="M20.5 11.6a8.1 8.1 0 01-11.8 7.2L3.5 20l1.3-4.9a8.1 8.1 0 1115.7-3.5z"/>`,
  family: `<circle cx="9" cy="8" r="3.4"/><path d="M2.8 20c.5-3.4 3.1-5.8 6.2-5.8s5.7 2.4 6.2 5.8"/><path d="M15.8 4.8a3.3 3.3 0 010 6.4"/><path d="M18 14.6c1.7.8 2.9 2.7 3.2 5.4"/>`,
  check: `<circle cx="12" cy="12" r="8.8"/><path d="M8.3 12.4l2.5 2.5 5-5.3"/>`,
  copy: `<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.2"/><path d="M15.5 8.5V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7.5a2 2 0 002 2h2.5"/>`,
  globe: `<circle cx="12" cy="12" r="8.8"/><path d="M3.5 12h17"/><path d="M12 3.2c2.3 2.4 3.5 5.4 3.5 8.8s-1.2 6.4-3.5 8.8c-2.3-2.4-3.5-5.4-3.5-8.8s1.2-6.4 3.5-8.8z"/>`,
  lock: `<rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/><path d="M8 10.5V7.8a4 4 0 018 0v2.7"/>`,
  bell: `<path d="M6.2 9.2a5.8 5.8 0 0111.6 0c0 6 2.7 7.8 2.7 7.8H3.5s2.7-1.8 2.7-7.8z"/><path d="M10 20.2a2.1 2.1 0 004 0"/>`,
  arrow: `<path d="M5 12h14"/><path d="M13.5 6.5L19 12l-5.5 5.5"/>`,
  calendar: `<rect x="3.5" y="5" width="17" height="15.5" rx="2.4"/><path d="M3.5 10h17"/><path d="M8 3v4M16 3v4"/>`,
  memory: `<path d="M12 3.5l8.5 4.6-8.5 4.6-8.5-4.6L12 3.5z"/><path d="M3.5 12.4l8.5 4.6 8.5-4.6"/><path d="M3.5 16.4l8.5 4.6 8.5-4.6"/>`,
  external: `<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5L11 13"/><path d="M17.5 14v4.5a1.5 1.5 0 01-1.5 1.5H6a1.5 1.5 0 01-1.5-1.5v-10A1.5 1.5 0 016 7h4.5"/>`,
  clock: `<circle cx="12" cy="12" r="8.8"/><path d="M12 7.2V12l3.2 2"/>`,
  trash: `<path d="M4.5 7h15"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l.9 12.2a1.5 1.5 0 001.5 1.3h6.2a1.5 1.5 0 001.5-1.3L17.5 7"/>`,
};

/** Inline stroke icon. Unknown names render nothing. */
export function icon(name: string, size = 18): string {
  const paths = ICONS[name];
  if (!paths) return "";
  return `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

export function brandMark(size = 32): string {
  return `<span class="brand-mark" style="width:${size}px;height:${size}px">${icon("shield", Math.round(size * 0.6))}</span>`;
}

const SITE_CSS = `
:root {
  color-scheme: light;
  --bg: #f4f5f9;
  --surface: #ffffff;
  --surface-2: #f8f9fc;
  --ink: #0f172a;
  --ink-2: #334155;
  --muted: #64748b;
  --line: #e4e7ef;
  --line-2: #eef0f6;
  --brand: #4f46e5;
  --brand-hover: #4338ca;
  --brand-ink: #3730a3;
  --brand-soft: #eef2ff;
  --violet: #8b5cf6;
  --scam: #e11d48;
  --scam-ink: #be123c;
  --scam-soft: #fff1f2;
  --warn: #f59e0b;
  --warn-ink: #b45309;
  --warn-soft: #fffbeb;
  --ok: #10b981;
  --ok-ink: #047857;
  --ok-soft: #ecfdf5;
  --side: #0f172a;
  --side-ink: #e2e8f0;
  --side-muted: #8b98ad;
  --radius: 16px;
  --shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 6px 20px rgba(15, 23, 42, 0.05);
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --font: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 var(--font); -webkit-font-smoothing: antialiased; }
a { color: var(--brand); text-decoration: none; }
a:hover { text-decoration: underline; }
h1, h2, h3 { margin: 0; color: var(--ink); letter-spacing: -0.02em; line-height: 1.2; }
p { margin: 0; }
.icon { flex: none; display: block; }
.muted { color: var(--muted); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* Standalone pages (radar, errors) */
body > main { max-width: 880px; margin: 0 auto; padding: 44px 20px 80px; }
body > main > h1 { font-size: 34px; margin: 6px 0 10px; letter-spacing: -0.03em; }
body > main > h2 { font-size: 18px; margin: 32px 0 12px; }
.eyebrow { margin: 0; color: var(--brand); font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
.lede { color: var(--muted); margin: 0 0 18px; font-size: 17px; }
.fine { color: var(--muted); margin: 18px 0 0; font-size: 13px; }
.meta { color: var(--muted); margin: 4px 0 0; font-size: 14px; }
.when { color: var(--muted); font-size: 13px; }
.metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
.metric { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; box-shadow: var(--shadow); }
.metric span { display: block; color: var(--muted); font-size: 13px; font-weight: 500; }
.metric b { display: block; margin-top: 4px; font-size: 26px; letter-spacing: -0.03em; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; margin-top: 12px; box-shadow: var(--shadow); }
.card header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 6px; }
.card h3 { font-size: 16px; }
.pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.pill.waiting { color: var(--warn-ink); background: var(--warn-soft); }
.pill.watching { color: var(--ok-ink); background: var(--ok-soft); }

/* Buttons and forms */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 16px; border-radius: 10px; border: 1px solid transparent; font: 600 15px/1.2 var(--font); cursor: pointer; text-decoration: none; white-space: nowrap; transition: background 0.2s, border-color 0.2s, box-shadow 0.2s, color 0.2s, opacity 0.2s, transform 0.2s var(--ease-out); }
.btn:hover { text-decoration: none; }
.btn:focus-visible, .nav-item:focus-visible, .seg a:focus-visible { outline: 3px solid rgba(99, 102, 241, 0.45); outline-offset: 2px; }
.btn-primary { background: var(--brand); color: #fff; box-shadow: 0 1px 2px rgba(79, 70, 229, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.15); }
.btn-primary:hover { background: var(--brand-hover); }
.btn-secondary { background: var(--surface); color: var(--ink); border-color: var(--line); box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05); }
.btn-secondary:hover { background: var(--surface-2); border-color: #d5d9e4; }
.btn-danger { background: var(--scam); color: #fff; }
.btn-danger:hover { background: var(--scam-ink); }
.btn-lg { padding: 14px 22px; font-size: 16px; border-radius: 12px; }
.btn-sm { padding: 8px 12px; font-size: 14px; }
.btn-block { width: 100%; }
.btn[disabled] { opacity: 0.5; cursor: not-allowed; }
.form { display: grid; gap: 18px; }
.field { display: grid; gap: 7px; }
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.label { font-size: 14px; font-weight: 600; color: var(--ink-2); }
.label small { font-weight: 500; color: var(--muted); }
.hint { font-size: 13px; color: var(--muted); }
input, select, textarea, button { font: inherit; }
.input { width: 100%; padding: 11px 13px; border: 1px solid var(--line); border-radius: 10px; background: #fff; color: var(--ink); transition: border-color 0.15s, box-shadow 0.15s; }
.input::placeholder { color: #9aa4b5; }
.input:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.12); }
.input[readonly] { background: var(--surface-2); color: var(--ink-2); font-size: 14px; }
.choices { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.choice { position: relative; }
.choice input { position: absolute; opacity: 0; pointer-events: none; }
.choice span { display: grid; gap: 2px; padding: 10px 8px; border: 1px solid var(--line); border-radius: 10px; background: #fff; text-align: center; cursor: pointer; transition: border-color 0.2s, background 0.2s, box-shadow 0.2s, transform 0.25s var(--ease-out); }
.choice b { font-size: 15px; }
.choice small { color: var(--muted); font-size: 12px; }
.choice input:checked + span { border-color: var(--brand); background: var(--brand-soft); box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.12); }
.choice input:focus-visible + span { outline: 3px solid rgba(99, 102, 241, 0.45); outline-offset: 2px; }
.notice { display: flex; gap: 10px; align-items: flex-start; padding: 12px 16px; border-radius: 12px; font-size: 14px; border: 1px solid; }
.notice.ok { background: var(--ok-soft); border-color: #a7f3d0; color: var(--ok-ink); }
.notice.error { background: var(--scam-soft); border-color: #fecdd3; color: var(--scam-ink); }

/* Brand */
.brand { display: inline-flex; align-items: center; gap: 10px; font-weight: 750; font-size: 18px; letter-spacing: -0.02em; color: var(--ink); }
.brand:hover { text-decoration: none; }
.brand-mark { display: inline-grid; place-items: center; flex: none; border-radius: 10px; color: #fff; background: linear-gradient(135deg, #6366f1, #8b5cf6); box-shadow: 0 6px 16px rgba(99, 102, 241, 0.35); }

/* Public site */
.site { background: radial-gradient(1200px 500px at 85% -10%, #e9e7ff 0%, rgba(233, 231, 255, 0) 60%), radial-gradient(900px 500px at -10% 10%, #e8f3ff 0%, rgba(232, 243, 255, 0) 55%), var(--bg); }
.site-nav { max-width: 1180px; margin: 0 auto; padding: 18px 24px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.site-links { display: flex; align-items: center; gap: 26px; }
.site-links a:not(.btn) { color: var(--ink-2); font-weight: 500; font-size: 15px; }
.hero { max-width: 1180px; margin: 0 auto; padding: 40px 24px 80px; display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr); gap: 56px; align-items: center; }
.chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; background: #fff; border: 1px solid var(--line); color: var(--ink-2); font-weight: 600; font-size: 13px; box-shadow: var(--shadow); }
.chip i { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.15); }
.hero h1 { margin: 20px 0 18px; font-size: clamp(38px, 5.2vw, 60px); line-height: 1.03; letter-spacing: -0.04em; }
.grad { background: linear-gradient(90deg, #4f46e5, #9333ea 25%, #6366f1 50%, #9333ea 75%, #4f46e5) 0 center / 200% auto; -webkit-background-clip: text; background-clip: text; color: transparent; }
.hero-lead { font-size: 19px; color: var(--ink-2); max-width: 560px; }
.hero-cta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; }
.langs { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 30px; font-size: 14px; color: var(--muted); }
.langs span { padding: 5px 12px; border-radius: 999px; background: #fff; border: 1px solid var(--line); color: var(--ink-2); font-weight: 500; }
.mock { position: relative; min-height: 520px; display: flex; justify-content: flex-end; }
.mock-phone { position: relative; z-index: 1; width: 300px; margin: 0; padding: 14px; border-radius: 40px; background: #0f172a; box-shadow: 0 30px 80px rgba(30, 27, 75, 0.35); }
.mock-screen { border-radius: 28px; background: #fff; padding: 18px 14px 20px; min-height: 480px; display: flex; flex-direction: column; gap: 10px; }
.mock-top { display: flex; align-items: center; gap: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--line-2); margin-bottom: 4px; }
.mock-top b { display: block; font-size: 14px; }
.mock-top small { display: block; color: var(--muted); font-size: 12px; }
.bubble { max-width: 86%; padding: 9px 12px; border-radius: 18px; font-size: 13px; line-height: 1.4; }
.bubble.in { align-self: flex-end; background: #3b82f6; color: #fff; border-bottom-right-radius: 6px; }
.bubble.in small { display: block; opacity: 0.8; font-size: 11px; margin-bottom: 2px; }
.bubble.out { align-self: flex-start; background: #eef0f5; color: var(--ink); border-bottom-left-radius: 6px; }
.bubble.out b { display: block; margin-bottom: 4px; }
.bubble.out ul { margin: 0 0 6px; padding-left: 16px; }
.bubble.voice { display: flex; align-items: center; gap: 8px; }
.bubble.voice .play { width: 24px; height: 24px; border-radius: 50%; background: var(--brand); display: grid; place-items: center; color: #fff; font-size: 10px; }
.wave { display: flex; align-items: center; gap: 2px; height: 18px; }
.wave i { width: 3px; border-radius: 2px; background: #94a3b8; }
.float { position: absolute; z-index: 2; background: #fff; border: 1px solid var(--line); border-radius: 16px; padding: 14px 16px; box-shadow: 0 18px 50px rgba(15, 23, 42, 0.12); }
.float-a { top: 36px; left: 0; width: 220px; }
.float-b { bottom: 34px; left: 0; width: 230px; }
.float small { display: block; color: var(--muted); font-size: 12px; }
.float b { display: block; font-size: 22px; letter-spacing: -0.03em; }
.float .mini-bars { display: flex; align-items: flex-end; gap: 5px; height: 42px; margin-top: 8px; }
.float .mini-bars i { flex: 1; border-radius: 4px 4px 0 0; background: #c7d2fe; }
.float .mini-bars i.hot { background: var(--scam); }
.float-b p { font-size: 13px; color: var(--ink-2); margin-top: 6px; }
.section { max-width: 1180px; margin: 0 auto; padding: 72px 24px; }
.section-head { max-width: 640px; margin-bottom: 36px; }
.section-head h2 { font-size: clamp(28px, 3.4vw, 38px); letter-spacing: -0.03em; margin: 10px 0 12px; }
.section-head p { color: var(--muted); font-size: 17px; }
.features { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
.feature { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 24px; box-shadow: var(--shadow); }
.feature h3 { font-size: 17px; margin: 16px 0 8px; }
.feature p { color: var(--muted); font-size: 15px; }
.feature-icon { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; background: var(--brand-soft); color: var(--brand); }
.feature-icon.scam { background: var(--scam-soft); color: var(--scam); }
.feature-icon.ok { background: var(--ok-soft); color: var(--ok-ink); }
.feature-icon.warn { background: var(--warn-soft); color: var(--warn-ink); }
.steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; counter-reset: step; }
.step { position: relative; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 24px; box-shadow: var(--shadow); }
.step-num { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: var(--ink); color: #fff; font-weight: 700; font-size: 15px; }
.step h3 { font-size: 17px; margin: 16px 0 8px; }
.step p { color: var(--muted); font-size: 15px; }
.privacy { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); gap: 40px; align-items: center; background: #0f172a; color: #cbd5e1; border-radius: 28px; padding: 48px; }
.privacy h2 { color: #fff; font-size: clamp(26px, 3vw, 34px); letter-spacing: -0.03em; margin: 10px 0 12px; }
.privacy .eyebrow { color: #a5b4fc; }
.privacy-list { display: grid; gap: 14px; }
.privacy-item { display: flex; gap: 14px; align-items: flex-start; padding: 16px; border-radius: 14px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); }
.privacy-item b { display: block; color: #fff; margin-bottom: 2px; }
.privacy-item p { font-size: 14px; }
.privacy-item .icon { color: #a5b4fc; margin-top: 2px; }
.cta-band { text-align: center; background: linear-gradient(135deg, #4f46e5, #7c3aed); color: #e0e7ff; border-radius: 28px; padding: 56px 24px; box-shadow: 0 24px 60px rgba(79, 70, 229, 0.3); }
.cta-band h2 { color: #fff; font-size: clamp(28px, 3.4vw, 40px); letter-spacing: -0.03em; margin-bottom: 12px; }
.cta-band .btn-primary { background: #fff; color: var(--brand-ink); margin-top: 26px; }
.cta-band .btn-primary:hover { background: #eef2ff; }
.site-foot { max-width: 1180px; margin: 0 auto; padding: 28px 24px 48px; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; color: var(--muted); font-size: 13px; border-top: 1px solid var(--line); }

/* Sign in and sign up */
.auth { min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.auth-side { position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; gap: 32px; padding: 40px 48px; color: #c7d2fe; background: radial-gradient(600px 400px at 100% 0%, rgba(139, 92, 246, 0.45), rgba(139, 92, 246, 0) 70%), linear-gradient(160deg, #1e1b4b, #312e81 60%, #3b2a8a); }
.auth-side .brand { color: #fff; }
.auth-side h2 { color: #fff; font-size: 34px; letter-spacing: -0.03em; line-height: 1.15; max-width: 440px; }
.auth-points { display: grid; gap: 14px; margin-top: 26px; max-width: 440px; }
.auth-points div { display: flex; gap: 12px; align-items: flex-start; font-size: 15px; }
.auth-points .icon { color: #a5b4fc; margin-top: 2px; }
.auth-quote { padding: 18px 20px; border-radius: 16px; background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.12); font-size: 15px; max-width: 440px; }
.auth-quote b { color: #fff; display: block; margin-bottom: 4px; }
.auth-main { display: grid; place-items: center; padding: 40px 24px; }
.auth-card { width: 100%; max-width: 420px; }
.auth-card h1 { font-size: 30px; letter-spacing: -0.03em; margin: 28px 0 8px; }
.auth-card .lede { font-size: 16px; margin-bottom: 26px; }
.auth-card .notice { margin-bottom: 18px; }
.auth-switch { margin-top: 22px; font-size: 15px; color: var(--muted); text-align: center; }
.auth-mobile-brand { display: none; }

/* App shell */
.app { display: grid; grid-template-columns: 268px minmax(0, 1fr); min-height: 100vh; }
.sidebar { position: sticky; top: 0; height: 100vh; overflow-y: auto; display: flex; flex-direction: column; gap: 18px; padding: 22px 14px 18px; background: var(--side); color: var(--side-ink); }
.sidebar .brand { color: #fff; padding: 2px 8px; }
.nav { display: grid; gap: 2px; }
.nav-label { margin: 14px 10px 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: var(--side-muted); }
.nav-item { position: relative; display: flex; align-items: center; gap: 11px; width: 100%; padding: 9px 10px; border: 0; border-radius: 10px; background: none; color: var(--side-ink); font: 500 15px/1.3 var(--font); text-align: left; text-decoration: none; cursor: pointer; transition: background 0.2s, color 0.2s; }
.nav-item:hover { background: rgba(255, 255, 255, 0.06); text-decoration: none; }
.nav-item.active { color: #fff; }
.nav-item > :not(.nav-glow) { position: relative; }
/* The active highlight is its own element so page transitions can slide it between items. */
.nav-glow { position: absolute; inset: 0; border-radius: 10px; background: rgba(129, 140, 248, 0.18); box-shadow: inset 3px 0 0 #818cf8; }
.nav-item .icon { opacity: 0.85; transition: opacity 0.2s, transform 0.25s var(--ease-out); }
.nav-item:hover .icon { opacity: 1; transform: translateX(2px); }
.nav-item .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-count { min-width: 22px; padding: 1px 7px; border-radius: 999px; font-size: 12px; font-weight: 700; text-align: center; background: rgba(255, 255, 255, 0.1); color: var(--side-ink); }
.nav-count.scam { background: rgba(225, 29, 72, 0.9); color: #fff; }
.nav-count.suspicious { background: rgba(245, 158, 11, 0.9); color: #1f1300; }
.nav-count.setup { font-size: 11px; font-weight: 600; color: #c7d2fe; background: rgba(129, 140, 248, 0.18); }
.nav-empty { padding: 4px 10px; color: var(--side-muted); font-size: 14px; }
.sidebar-foot { margin-top: auto; display: grid; gap: 6px; padding-top: 14px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
.me { display: flex; align-items: center; gap: 10px; padding: 6px 8px; min-width: 0; }
.me b { display: block; color: #fff; font-size: 14px; }
.me > div span { display: block; color: var(--side-muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.me > div { min-width: 0; }
.avatar { flex: none; display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; color: #fff; font-weight: 700; font-size: 13px; }
.avatar.lg { width: 48px; height: 48px; font-size: 19px; }
.avatar.sm { width: 24px; height: 24px; font-size: 11px; }
.avatar.c0 { background: linear-gradient(135deg, #6366f1, #8b5cf6); }
.avatar.c1 { background: linear-gradient(135deg, #0ea5e9, #2563eb); }
.avatar.c2 { background: linear-gradient(135deg, #10b981, #0d9488); }
.avatar.c3 { background: linear-gradient(135deg, #f59e0b, #ea580c); }
.avatar.c4 { background: linear-gradient(135deg, #ec4899, #db2777); }
.avatar.c5 { background: linear-gradient(135deg, #64748b, #334155); }
.content { min-width: 0; }
.topbar { position: sticky; top: 0; z-index: 5; background: rgba(244, 245, 249, 0.86); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
.topbar-inner { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; max-width: 1344px; margin: 0 auto; padding: 18px 32px; }
.topbar-title { display: flex; align-items: center; gap: 14px; min-width: 0; }
.topbar h1 { font-size: 24px; letter-spacing: -0.03em; }
.crumbs { font-size: 13px; color: var(--muted); margin-bottom: 2px; }
.crumbs a { color: var(--muted); }
.topbar-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.seg { display: inline-flex; padding: 3px; border-radius: 11px; background: #e9ebf2; }
.seg a { padding: 6px 12px; border-radius: 8px; color: var(--ink-2); font-size: 14px; font-weight: 600; }
.seg a:hover { text-decoration: none; color: var(--ink); }
.seg a.on { background: #fff; color: var(--ink); box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12); }
.app-main { display: grid; gap: 20px; max-width: 1344px; margin: 0 auto; padding: 26px 32px 64px; }

/* Panels and dashboard pieces */
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 20px 22px; box-shadow: var(--shadow); min-width: 0; }
.panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
.panel-head h2 { font-size: 16px; letter-spacing: -0.01em; }
.panel-head p { margin-top: 3px; color: var(--muted); font-size: 13px; }
.panel-foot { margin-top: 14px; color: var(--muted); font-size: 12.5px; }
.grid-main { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 20px; }
.grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
.grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.kpi { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 6px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px 20px 16px; box-shadow: var(--shadow); }
.kpi-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.kpi-label { color: var(--muted); font-size: 14px; font-weight: 600; }
.kpi-icon { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; background: var(--brand-soft); color: var(--brand); }
.kpi-icon.scam { background: var(--scam-soft); color: var(--scam); }
.kpi-icon.warn { background: var(--warn-soft); color: var(--warn-ink); }
.kpi-icon.ok { background: var(--ok-soft); color: var(--ok-ink); }
.kpi-icon.violet { background: #f3efff; color: #7c3aed; }
.kpi-value { font-size: 32px; font-weight: 750; letter-spacing: -0.04em; line-height: 1.1; }
.kpi-foot { color: var(--muted); font-size: 13px; min-height: 18px; }
.kpi .spark { position: absolute; right: 16px; bottom: 16px; width: 92px; height: 30px; }
.status { display: flex; align-items: center; gap: 16px; padding: 18px 22px; border-radius: var(--radius); border: 1px solid; }
.status-icon { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; flex: none; background: rgba(255, 255, 255, 0.7); }
.status b { display: block; font-size: 16px; }
.status p { font-size: 14px; opacity: 0.9; }
.status .btn { margin-left: auto; }
.status.ok { background: var(--ok-soft); border-color: #bbf0d9; color: var(--ok-ink); }
.status.warn { background: var(--warn-soft); border-color: #fde7a8; color: var(--warn-ink); }
.status.scam { background: var(--scam-soft); border-color: #fecdd3; color: var(--scam-ink); }
.badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 650; white-space: nowrap; }
.badge::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.badge.scam { color: var(--scam-ink); background: var(--scam-soft); }
.badge.suspicious { color: var(--warn-ink); background: var(--warn-soft); }
.badge.ok { color: var(--ok-ink); background: var(--ok-soft); }
.badge.neutral { color: var(--ink-2); background: #eef0f6; }
.tag { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--line); color: var(--ink-2); font-size: 12px; font-weight: 500; }
.tag .icon { opacity: 0.7; }

/* Charts */
.chart-bars { display: grid; grid-template-columns: 30px minmax(0, 1fr); column-gap: 10px; }
.bars-y { position: relative; height: 210px; font-size: 12px; color: var(--muted); }
.bars-y span { position: absolute; right: 0; transform: translateY(-50%); }
.bars-plot { position: relative; height: 210px; display: flex; align-items: stretch; gap: var(--gap, 8px); border-bottom: 1px solid var(--line); background-image: linear-gradient(to bottom, var(--line-2) 1px, transparent 1px); background-size: 100% 50%; }
.bar { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column-reverse; border-radius: 6px 6px 0 0; }
.bar:hover { background: rgba(79, 70, 229, 0.06); }
.seg-scam, .seg-suspicious, .seg-quiet { width: 64%; margin: 0 auto; flex: none; }
.seg-scam { background: var(--scam); }
.seg-suspicious { background: var(--warn); }
.seg-quiet { background: #a5b4fc; }
.bar > .seg-top { border-radius: 5px 5px 0 0; }
.bar > [class^="seg-"] + [class^="seg-"] { box-shadow: inset 0 -2px 0 var(--surface); }
.tip { position: absolute; left: 50%; bottom: calc(var(--h, 0%) + 10px); transform: translate(-50%, 6px); z-index: 3; opacity: 0; visibility: hidden; transition: opacity 0.16s, visibility 0.16s, transform 0.22s var(--ease-out); min-width: 150px; padding: 10px 12px; border-radius: 10px; background: #0f172a; color: #e2e8f0; font-size: 12px; line-height: 1.5; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.25); pointer-events: none; }
.tip b { display: block; color: #fff; font-size: 12.5px; margin-bottom: 4px; }
.tip i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 6px; }
.bar:hover .tip { opacity: 1; visibility: visible; transform: translate(-50%, 0); }
.bar:first-child .tip { left: 0; transform: translateY(6px); }
.bar:last-child .tip { left: auto; right: 0; transform: translateY(6px); }
.bar:first-child:hover .tip, .bar:last-child:hover .tip { transform: none; }
.bar > span { transition: opacity 0.2s; }
.bars-plot:hover .bar:not(:hover):not(.ghost) > span { opacity: 0.45; }
.bars-x { display: flex; gap: var(--gap, 8px); margin: 8px 0 0 40px; font-size: 12px; color: var(--muted); }
.bars-x span { flex: 1; min-width: 0; text-align: center; white-space: nowrap; }
.chart-empty { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; color: var(--muted); font-size: 14px; }
.chart-empty b { display: block; color: var(--ink-2); font-size: 15px; }
.chart-empty > div { padding: 10px 18px; border-radius: 12px; background: rgba(255, 255, 255, 0.9); }
.seg-ghost { width: 64%; margin: 0 auto; flex: none; background: #eceff7; }
.bar.ghost:hover { background: none; }
.legend { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 16px; font-size: 13px; color: var(--ink-2); }
.legend span { display: inline-flex; align-items: center; gap: 7px; }
.legend i { width: 10px; height: 10px; border-radius: 3px; }
.legend b { font-weight: 650; }
.donut-wrap { display: flex; flex-direction: column; align-items: center; gap: 18px; }
.donut { position: relative; width: 176px; height: 176px; }
.donut svg { display: block; transform: rotate(-90deg); }
.donut .arc { transition: stroke-width 0.15s; }
.donut .arc:hover { stroke-width: 22; }
.donut-center { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; pointer-events: none; }
.donut-center b { font-size: 30px; letter-spacing: -0.04em; line-height: 1; }
.donut-center span { color: var(--muted); font-size: 13px; margin-top: 4px; }
.donut-legend { width: 100%; display: grid; gap: 8px; }
.donut-legend div { display: flex; align-items: center; gap: 10px; font-size: 14px; }
.donut-legend i { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.donut-legend span { flex: 1; color: var(--ink-2); }
.donut-legend b { font-weight: 650; }
.donut-legend small { width: 42px; text-align: right; color: var(--muted); }
.barlist { display: grid; gap: 14px; }
.barlist-row { display: grid; gap: 7px; }
.barlist-top { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; }
.barlist-top span { color: var(--ink-2); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.barlist-top a { color: var(--ink-2); font-weight: 500; }
.barlist-top b { font-weight: 650; }
.barlist-track { height: 8px; border-radius: 999px; background: var(--line-2); overflow: hidden; }
.barlist-fill { height: 100%; border-radius: 999px; background: var(--brand); }
.empty-note { padding: 18px 0 6px; color: var(--muted); font-size: 14px; text-align: center; }

/* Warnings feed */
.feed { display: grid; }
.feed-item { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 14px; padding: 16px 0; border-top: 1px solid var(--line-2); }
.feed-item:first-child { border-top: 0; padding-top: 2px; }
.feed-icon { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; }
.feed-icon.scam { background: var(--scam-soft); color: var(--scam); }
.feed-icon.suspicious { background: var(--warn-soft); color: var(--warn-ink); }
.feed-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; flex-wrap: wrap; }
.feed-title { font-weight: 650; font-size: 15px; }
.feed-summary { margin: 3px 0 9px; color: var(--ink-2); font-size: 14px; }
.feed-meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.reply-quote { margin-top: 10px; padding: 9px 12px; border-left: 3px solid var(--brand); border-radius: 0 10px 10px 0; background: var(--brand-soft); color: var(--brand-ink); font-size: 14px; }
.action-note { margin-top: 8px; color: var(--scam-ink); font-size: 13px; font-weight: 600; }

/* Parents */
.parent-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr)); gap: 16px; }
.parent-card { display: flex; flex-direction: column; gap: 14px; padding: 18px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface-2); color: inherit; transition: border-color 0.2s, box-shadow 0.3s, background 0.2s, transform 0.3s var(--ease-out); }
.parent-card:hover { text-decoration: none; border-color: #c7cdf9; background: #fff; transform: translateY(-3px); box-shadow: 0 16px 36px -18px rgba(30, 27, 75, 0.25); }
.parent-card-foot .icon { transition: transform 0.25s var(--ease-out); }
.parent-card:hover .parent-card-foot .icon { transform: translateX(4px); }
.parent-card-head { display: flex; align-items: center; gap: 12px; }
.parent-card-head b { display: block; font-size: 15px; }
.parent-card-head > div { flex: 1; min-width: 0; }
.parent-card-head > div span { display: block; color: var(--muted); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.parent-card-head .badge { margin-left: auto; }
.mini-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.mini-stats div { padding: 8px 10px; border-radius: 10px; background: #fff; border: 1px solid var(--line-2); }
.mini-stats small { display: block; color: var(--muted); font-size: 12px; }
.mini-stats b { font-size: 18px; letter-spacing: -0.02em; }
.parent-card-foot { display: flex; justify-content: space-between; align-items: center; color: var(--brand); font-size: 14px; font-weight: 600; }
.setup { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 18px; border-color: #c7d2fe; background: linear-gradient(180deg, #f5f6ff, #fff); }
.setup-icon { width: 46px; height: 46px; border-radius: 13px; display: grid; place-items: center; background: var(--brand); color: #fff; box-shadow: 0 8px 20px rgba(79, 70, 229, 0.3); }
.setup h2 { font-size: 18px; }
.setup p { color: var(--ink-2); font-size: 15px; margin-top: 4px; max-width: 680px; }
.copy-row { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
.copy-row .input { flex: 1 1 320px; min-width: 0; }
.checklist { display: flex; flex-wrap: wrap; gap: 8px 22px; margin-top: 16px; font-size: 14px; color: var(--muted); }
.checklist > span { display: inline-flex; align-items: center; gap: 8px; }
.checklist .done { color: var(--ok-ink); font-weight: 600; }
.checklist .num { width: 20px; height: 20px; border-radius: 50%; display: inline-grid; place-items: center; background: #e9ebf2; color: var(--ink-2); font-size: 12px; font-weight: 700; }
.details-list { display: grid; gap: 0; }
.details-list div { display: flex; justify-content: space-between; gap: 16px; padding: 11px 0; border-top: 1px solid var(--line-2); font-size: 14px; }
.details-list div:first-child { border-top: 0; padding-top: 0; }
.details-list dt { color: var(--muted); }
.details-list dd { margin: 0; font-weight: 600; text-align: right; overflow-wrap: anywhere; }
.danger-zone summary { cursor: pointer; color: var(--scam-ink); font-weight: 600; font-size: 14px; list-style: none; display: inline-flex; align-items: center; gap: 8px; }
.danger-zone summary::-webkit-details-marker { display: none; }
.danger-zone[open] summary { margin-bottom: 12px; }
.danger-zone p { color: var(--ink-2); font-size: 14px; margin-bottom: 12px; }
.welcome { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 32px; align-items: center; padding: 34px; background: linear-gradient(135deg, #eef2ff, #fff 60%); border-color: #d9ddfb; }
.welcome h2 { font-size: 28px; letter-spacing: -0.03em; margin-bottom: 10px; }
.welcome p { color: var(--ink-2); font-size: 16px; margin-bottom: 22px; }
.welcome-steps { display: grid; gap: 12px; }
.welcome-steps > div { display: flex; gap: 14px; align-items: flex-start; padding: 14px 16px; background: #fff; border: 1px solid var(--line); border-radius: 14px; }
.welcome-steps b { display: block; font-size: 15px; }
.welcome-steps b + span { color: var(--muted); font-size: 14px; }
.form-layout { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 20px; align-items: start; }
.aside-steps { display: grid; gap: 16px; }
.aside-step { display: flex; gap: 12px; }
.num { flex: none; width: 26px; height: 26px; border-radius: 50%; display: inline-grid; place-items: center; background: var(--brand-soft); color: var(--brand-ink); font-weight: 700; font-size: 13px; }
.aside-step b { display: block; font-size: 15px; }
.aside-step p { color: var(--muted); font-size: 14px; }
.foot-note { color: var(--muted); font-size: 12.5px; }

@media (max-width: 1180px) {
  .float { display: none; }
  .mock { justify-content: center; }
  .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .grid-3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .grid-3 > :last-child { grid-column: 1 / -1; }
}
@media (max-width: 960px) {
  .app { grid-template-columns: minmax(0, 1fr); }
  .sidebar { position: sticky; z-index: 10; height: auto; flex-direction: row; align-items: center; gap: 6px; padding: 10px 12px; overflow-x: auto; overflow-y: hidden; }
  .sidebar .brand span:last-child { display: none; }
  .nav { display: flex; gap: 4px; }
  .nav-label, .nav-empty, .me { display: none; }
  .nav-item { width: auto; white-space: nowrap; padding: 8px 10px; }
  .nav-glow { box-shadow: inset 0 -3px 0 #818cf8; }
  .sidebar-foot { margin: 0 0 0 auto; padding: 0; border: 0; display: flex; }
  .topbar { position: static; }
  .topbar-inner { padding: 18px 18px 16px; }
  .app-main { padding: 18px 16px 48px; }
  .grid-main, .grid-2, .welcome, .form-layout { grid-template-columns: minmax(0, 1fr); }
  .hero, .privacy, .auth { grid-template-columns: minmax(0, 1fr); }
  .hero { padding-top: 24px; gap: 36px; }
  .features, .steps { grid-template-columns: minmax(0, 1fr); }
  .site-links a:not(.btn) { display: none; }
  .auth-side { display: none; }
  .auth-mobile-brand { display: inline-flex; }
  .privacy { padding: 32px 24px; }
  .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .kpis, .grid-3 { grid-template-columns: minmax(0, 1fr); }
  .choices, .field-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .field-row { grid-template-columns: minmax(0, 1fr); }
  .mock { min-height: 0; }
  .float { display: none; }
  .mock-phone { width: 100%; max-width: 320px; }
  .setup { grid-template-columns: minmax(0, 1fr); }
  .status { flex-wrap: wrap; }
  .status .btn { margin-left: 0; }
}

/* ---------- Motion ----------
   Transforms and opacity only. Dashboard intros are scoped to html:not(.settled): the live
   refresh adds .settled before it swaps in new panels, so a refresh never replays the intro.
   Everything collapses to instant under prefers-reduced-motion (end of this section). */
html { scroll-behavior: smooth; }
@media (prefers-reduced-motion: no-preference) {
  @view-transition { navigation: auto; }
}
::view-transition-old(root), ::view-transition-new(root) { animation-duration: 0.22s; }
::view-transition-group(*) { animation-duration: 0.38s; animation-timing-function: var(--ease-out); }
.sidebar { view-transition-name: sidebar; }
.nav-glow { view-transition-name: nav-glow; }
.seg a.on { view-transition-name: range-pill; }
.seg a { transition: color 0.2s; }

@keyframes rise { from { opacity: 0; transform: translateY(14px); } }
@keyframes reveal { from { opacity: 0; transform: translateY(26px); } }
@keyframes pop { from { opacity: 0; transform: translateY(8px) scale(0.94); } }
@keyframes rise-phone { from { opacity: 0; transform: translateY(36px) rotate(2deg) scale(0.97); } }
@keyframes bob { 50% { transform: translateY(-8px); } }
@keyframes nudge { 50% { transform: translateY(-3px); } }
@keyframes shimmer { to { background-position: -200% center; } }
@keyframes ping { 0% { transform: scale(1); opacity: 0.55; } 80%, 100% { transform: scale(2.8); opacity: 0; } }
@keyframes halo { from { box-shadow: 0 0 0 0 rgba(225, 29, 72, 0.35); } to { box-shadow: 0 0 0 14px rgba(225, 29, 72, 0); } }
@keyframes drift { 50% { background-position: 100% 50%; } }
@keyframes glow-drift { to { transform: translate(-140px, 240px) scale(1.2); } }
@keyframes grow-up { from { clip-path: inset(100% 0 0 0); } to { clip-path: inset(0 0 0 0); } }
@keyframes grow-y { from { transform: scaleY(0); } }
@keyframes wipe { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
@keyframes fill { from { width: 0; } }
@keyframes arc-draw { from { stroke-dasharray: 0 1000; } }
@keyframes wave { 0%, 100% { transform: scaleY(0.4); } 50% { transform: scaleY(1); } }
@keyframes typing-dot { 0%, 60%, 100% { transform: none; opacity: 0.35; } 30% { transform: translateY(-3px); opacity: 1; } }
@keyframes typing-life { 0% { opacity: 0; transform: scale(0.9); } 15%, 80% { opacity: 1; transform: none; } 100% { opacity: 0; transform: scale(0.9); } }
@keyframes fade-out { to { opacity: 0; } }
@keyframes bump { 40% { transform: scale(1.18); } }
@keyframes shake { 20%, 60% { transform: translateX(-5px); } 40%, 80% { transform: translateX(5px); } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes press { 50% { transform: scale(1.04); } }

/* Buttons, links, inputs */
.btn:hover { transform: translateY(-1px); }
.btn:active { transform: translateY(0) scale(0.98); transition-duration: 0.08s; }
.btn[disabled], fieldset[disabled] .btn { transform: none; }
.btn-primary:hover { box-shadow: 0 10px 24px -8px rgba(79, 70, 229, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.15); }
.btn-secondary:hover { box-shadow: 0 6px 16px -8px rgba(15, 23, 42, 0.22); }
.btn > .icon:last-child:not(:first-child) { transition: transform 0.25s var(--ease-out); }
.btn:hover > .icon:last-child:not(:first-child) { transform: translateX(3px); }
.btn-primary.btn-lg { position: relative; overflow: hidden; isolation: isolate; }
.btn-primary.btn-lg::after { content: ""; position: absolute; inset: 0; z-index: -1; background: linear-gradient(110deg, transparent 35%, rgba(255, 255, 255, 0.3) 50%, transparent 65%); transform: translateX(-110%); }
.btn-primary.btn-lg:hover::after { transform: translateX(110%); transition: transform 0.8s var(--ease-out); }
.btn.copied { color: var(--ok-ink); background: var(--ok-soft); border-color: #a7f3d0; animation: press 0.35s var(--ease-spring); }
.btn.is-busy { pointer-events: none; opacity: 0.85; }
.btn.is-busy > .icon { display: none; }
.btn.is-busy::before { content: ""; flex: none; width: 15px; height: 15px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: spin 0.7s linear infinite; }
.input:hover:not(:focus):not([readonly]) { border-color: #cfd5e3; }
.choice span:hover { transform: translateY(-1px); border-color: #c7cdf9; }
.choice input:checked + span { animation: press 0.35s var(--ease-spring); }
.brand-mark { transition: transform 0.45s var(--ease-spring); }
.brand:hover .brand-mark { transform: rotate(-8deg) scale(1.06); }
.notice { animation: rise 0.45s var(--ease-out) backwards; }
.notice.error { animation: rise 0.45s var(--ease-out) backwards, shake 0.45s ease 0.15s; }
.danger-zone[open] > :not(summary) { animation: rise 0.3s var(--ease-out); }

/* Landing page */
.site-header { position: sticky; top: 0; z-index: 20; border-bottom: 1px solid transparent; transition: background 0.3s, border-color 0.3s, box-shadow 0.3s; }
.site-header.scrolled { background: rgba(244, 245, 249, 0.8); backdrop-filter: saturate(1.5) blur(14px); -webkit-backdrop-filter: saturate(1.5) blur(14px); border-bottom-color: var(--line); box-shadow: 0 10px 30px -18px rgba(15, 23, 42, 0.25); }
.site-links a:not(.btn) { position: relative; transition: color 0.2s; }
.site-links a:not(.btn)::after { content: ""; position: absolute; left: 0; right: 0; bottom: -5px; height: 2px; border-radius: 2px; background: var(--brand); transform: scaleX(0); transform-origin: left; transition: transform 0.3s var(--ease-out); }
.site-links a:not(.btn):hover { color: var(--ink); text-decoration: none; }
.site-links a:not(.btn):hover::after { transform: scaleX(1); }
.section { scroll-margin-top: 76px; }
.hero > div:first-child > * { animation: rise 0.8s var(--ease-out) backwards; }
.hero > div:first-child > :nth-child(2) { animation-delay: 0.08s; }
.hero > div:first-child > :nth-child(3) { animation-delay: 0.16s; }
.hero > div:first-child > :nth-child(4) { animation-delay: 0.24s; }
.hero > div:first-child > :nth-child(5) { animation-delay: 0.32s; }
.grad { animation: shimmer 8s linear infinite; }
.chip i { position: relative; }
.chip i::after { content: ""; position: absolute; inset: 0; border-radius: 50%; background: var(--ok); animation: ping 2.2s var(--ease-out) infinite; }
/* The phone plays the conversation once: forward, typing, verdict, voice note, family reply. */
.mock-phone { animation: rise-phone 1s var(--ease-out) 0.15s backwards; }
.float-a { animation: pop 0.7s var(--ease-out) 1s backwards, bob 7s ease-in-out 1.7s infinite; }
.float-b { animation: pop 0.7s var(--ease-out) 2.4s backwards, bob 8s ease-in-out 3.1s infinite; }
.float .mini-bars i { transform-origin: bottom; animation: grow-y 0.6s var(--ease-out) backwards; animation-delay: calc(1.25s + var(--i, 0) * 70ms); }
.mock-screen > .bubble.in { transform-origin: bottom right; animation: pop 0.5s var(--ease-out) 0.8s backwards; }
.slot { position: relative; display: flex; flex-direction: column; }
.slot > .bubble { transform-origin: bottom left; animation: pop 0.5s var(--ease-out) 2.1s backwards; }
.typing { position: absolute; top: 0; left: 0; display: inline-flex; gap: 4px; padding: 12px 14px; border-radius: 18px 18px 18px 6px; background: #eef0f5; animation: typing-life 1s ease 1.2s both; }
.typing i { width: 6px; height: 6px; border-radius: 50%; background: #94a3b8; animation: typing-dot 0.9s ease-in-out infinite; }
.typing i:nth-child(2) { animation-delay: 0.15s; }
.typing i:nth-child(3) { animation-delay: 0.3s; }
.bubble.voice { transform-origin: bottom left; animation: pop 0.5s var(--ease-out) 2.7s backwards; }
.wave i { animation: wave 1s ease-in-out calc(3s + var(--i, 0) * 60ms) 6; }
.bubble.family { transform-origin: bottom left; animation: pop 0.5s var(--ease-out) 3.6s backwards; }
.js-reveal [data-reveal]:not(.in) { opacity: 0; }
.js-reveal [data-reveal].in { animation: reveal 0.8s var(--ease-out) backwards; animation-delay: calc(var(--i, 0) * 80ms); }
.feature, .step { transition: transform 0.35s var(--ease-out), box-shadow 0.35s, border-color 0.35s; }
.feature:hover, .step:hover { transform: translateY(-4px); border-color: #d9ddfb; box-shadow: 0 20px 44px -20px rgba(30, 27, 75, 0.25); }
.feature-icon, .kpi-icon, .feed-icon { transition: transform 0.4s var(--ease-spring); }
.feature:hover .feature-icon { transform: scale(1.08) rotate(-6deg); }
.step-num { transition: background 0.3s, transform 0.4s var(--ease-spring); }
.step:hover .step-num { background: var(--brand); transform: scale(1.1); }
.privacy-item { transition: background 0.3s, border-color 0.3s, transform 0.35s var(--ease-out); }
.privacy-item:hover { background: rgba(255, 255, 255, 0.07); border-color: rgba(165, 180, 252, 0.35); transform: translateX(4px); }
.cta-band { position: relative; overflow: hidden; isolation: isolate; }
.cta-band::before { content: ""; position: absolute; inset: 0; z-index: -1; background: linear-gradient(120deg, #4f46e5, #7c3aed, #6366f1, #9333ea, #4f46e5) 0 0 / 300% 300%; animation: drift 14s ease-in-out infinite; }

/* Sign in and sign up */
.auth-card > * { animation: rise 0.7s var(--ease-out) backwards; }
.auth-card > :nth-child(2) { animation-delay: 0.05s; }
.auth-card > :nth-child(3) { animation-delay: 0.1s; }
.auth-card > :nth-child(4) { animation-delay: 0.15s; }
.auth-card > :nth-child(5) { animation-delay: 0.2s; }
.auth-card > :nth-child(6) { animation-delay: 0.25s; }
.auth-side { isolation: isolate; }
.auth-side::before { content: ""; position: absolute; z-index: -1; top: -180px; right: -180px; width: 560px; height: 560px; border-radius: 50%; background: radial-gradient(circle, rgba(129, 140, 248, 0.35), rgba(129, 140, 248, 0) 65%); pointer-events: none; animation: glow-drift 18s ease-in-out infinite alternate; }
.auth-side > * { animation: rise 0.9s var(--ease-out) backwards; }
.auth-side > :nth-child(2) { animation-delay: 0.12s; }
.auth-side > :nth-child(3) { animation-delay: 0.3s; }
.auth-points > div { animation: rise 0.7s var(--ease-out) backwards; }
.auth-points > :nth-child(1) { animation-delay: 0.25s; }
.auth-points > :nth-child(2) { animation-delay: 0.35s; }
.auth-points > :nth-child(3) { animation-delay: 0.45s; }

/* Dashboard hover */
.kpi { transition: transform 0.3s var(--ease-out), box-shadow 0.3s, border-color 0.3s; }
.kpi:hover { transform: translateY(-2px); border-color: #dde1f3; box-shadow: 0 16px 36px -18px rgba(30, 27, 75, 0.22); }
.kpi:hover .kpi-icon { transform: scale(1.1) rotate(-8deg); }
.feed-item { position: relative; }
.feed-item:hover .feed-icon { transform: scale(1.08) rotate(-6deg); }
.status-icon { position: relative; }
.status.scam .status-icon::after { content: ""; position: absolute; inset: 0; border-radius: inherit; animation: halo 1.8s var(--ease-out) 0.8s 3; }
.setup-icon { animation: nudge 2.6s ease-in-out 1s 3; }

/* Dashboard intro: rows rise in order, cards within a row follow, then the charts draw. */
.app-main > :nth-child(2) { --row: 70ms; }
.app-main > :nth-child(3) { --row: 140ms; }
.app-main > :nth-child(4) { --row: 210ms; }
.app-main > :nth-child(5) { --row: 280ms; }
.app-main > :nth-child(6) { --row: 350ms; }
.app-main > :nth-child(7) { --row: 420ms; }
.app-main > :nth-child(n + 8) { --row: 490ms; }
:is(.kpis, .grid-main, .grid-3, .grid-2, .form-layout) > :nth-child(2) { --col: 60ms; }
:is(.kpis, .grid-main, .grid-3, .grid-2, .form-layout) > :nth-child(3) { --col: 120ms; }
:is(.kpis, .grid-main, .grid-3, .grid-2, .form-layout) > :nth-child(4) { --col: 180ms; }
html:not(.settled) .app-main :is(.status, .kpi, .panel, .foot-note) { animation: rise 0.6s var(--ease-out) backwards; animation-delay: calc(var(--row, 0ms) + var(--col, 0ms)); }
html:not(.settled) .bars-plot > .bar { animation: grow-up 0.8s var(--ease-out) backwards; animation-delay: calc(var(--row, 0ms) + var(--col, 0ms) + 150ms + var(--i, 0) * var(--stagger, 45ms)); }
html:not(.settled) .donut .arc { animation: arc-draw calc(var(--len, 1) * 0.9s) linear backwards; animation-delay: calc(var(--row, 0ms) + var(--col, 0ms) + 250ms + var(--start, 0) * 0.9s); }
html:not(.settled) .barlist-fill { animation: fill 0.9s var(--ease-out) backwards; animation-delay: calc(var(--row, 0ms) + var(--col, 0ms) + 200ms + var(--i, 0) * 70ms); }
html:not(.settled) .kpi .spark { animation: wipe 1.1s var(--ease-out) backwards; animation-delay: calc(var(--row, 0ms) + var(--col, 0ms) + 300ms); }
html:not(.settled) .welcome-steps > div { animation: rise 0.6s var(--ease-out) backwards; animation-delay: calc(200ms + var(--i, 0) * 90ms); }

/* Live refresh: new warnings slide in with a "New" tag; changed numbers count and bump. */
.feed-item.fresh { animation: rise 0.6s var(--ease-out) backwards; }
.feed-item.fresh::before { content: ""; position: absolute; inset: 4px -12px; border-radius: 12px; background: rgba(79, 70, 229, 0.07); pointer-events: none; animation: fade-out 1.2s ease 5s forwards; }
.feed-item.fresh .feed-title::after { content: "New"; display: inline-block; margin-left: 8px; padding: 1px 8px; border-radius: 999px; background: var(--brand); color: #fff; font-size: 11px; font-weight: 700; letter-spacing: 0.02em; vertical-align: 2px; animation: pop 0.4s var(--ease-spring) 0.3s backwards; }
.mini-stats b { display: inline-block; }
.bump { animation: bump 0.6s var(--ease-spring); }

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { animation-duration: 1ms !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important; transition-delay: 0s !important; }
}
`;
