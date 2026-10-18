// Public Community Scam Radar page. Aggregates only: brand, the scammer's domain, family counts,
// languages, and times. No names, phone numbers, summaries, or message text.
// Server-rendered and refreshed by <meta refresh>, so the strict no-script CSP stays intact.
import type { RadarSnapshot, RadarWave } from "../core/radar.js";
import { escapeHtml, page } from "./site.js";

const LANGUAGES: Record<string, string> = { en: "English", es: "Spanish", ur: "Urdu", hi: "Hindi" };
const CATEGORIES: Record<string, string> = {
  account_locked: "Account locked",
  fee: "Fake fee",
  gift_card: "Gift cards",
  prize: "Fake prize",
  refund: "Fake refund",
  impersonation: "Impersonation",
  other: "Other",
};

export function radarPageHtml(radar: RadarSnapshot, now = new Date()): string {
  const languageNames = radar.languages.map((code) => LANGUAGES[code] ?? code);
  const body = `<main>
    <p class="eyebrow">ScamCheck</p>
    <h1>Community Scam Radar</h1>
    <p class="lede">Scams reaching ScamCheck families this week. When one family is targeted, everyone else is warned it's going around.</p>
    <div class="metrics">
      ${metric("Families protected", String(radar.families))}
      ${metric("Scams caught", String(radar.scams))}
      ${metric("Active waves", String(radar.waves.filter((wave) => wave.active).length))}
      ${metric("Languages", languageNames.length ? escapeHtml(languageNames.join(", ")) : "—")}
    </div>
    <h2>Going around now</h2>
    ${radar.waves.length ? radar.waves.map((wave) => waveCard(wave, now)).join("") : `<p class="lede">No scams reported this week.</p>`}
    <p class="fine">Updates every 10 seconds. Counts are families, not messages. Only the brand and the scammer's website are shown, never who received it.</p>
  </main>`;
  return page("Community Scam Radar · ScamCheck", body, `<meta http-equiv="refresh" content="10">`);
}

function metric(label: string, value: string): string {
  return `<div class="metric"><span>${escapeHtml(label)}</span><b>${value}</b></div>`;
}

function waveCard(wave: RadarWave, now: Date): string {
  const title = wave.domain ? `${wave.brand} · ${wave.domain}` : `${wave.brand} · ${CATEGORIES[wave.category] ?? wave.category}`;
  const families = `${wave.families} ${wave.families === 1 ? "family" : "families"}`;
  const languages = wave.languages.map((code) => LANGUAGES[code] ?? code).join(", ");
  const status = wave.active
    ? `<span class="pill waiting">🌊 Active wave</span>`
    : `<span class="pill watching">Reported</span>`;
  return `<article class="card">
    <header>
      <div>
        <h3>${escapeHtml(title)}</h3>
        <p class="meta">${escapeHtml(CATEGORIES[wave.category] ?? wave.category)} · ${escapeHtml(families)}${languages ? ` · ${escapeHtml(languages)}` : ""}</p>
      </div>
      ${status}
    </header>
    <p class="when">Last seen ${escapeHtml(ago(wave.lastSeen, now))} · first seen ${escapeHtml(ago(wave.firstSeen, now))}</p>
  </article>`;
}

function ago(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}
