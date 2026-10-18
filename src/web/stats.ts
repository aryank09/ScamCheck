// Numbers and lists for the account dashboard, computed from stored case summaries only.
// Pure: no database calls, so views and tests can use sample data.
import { scrubBannedWords } from "../core/bannedWords.js";
import type { ParentLink } from "../db/accounts.js";
import type { CaseRecord, CaseSource, NotifyChannel, UserAction } from "../db/cases.js";
import type { User } from "../db/users.js";
import { parentIsWatching } from "./accountForms.js";

export type RangeDays = 7 | 30;

export function parseRange(value: string | null | undefined): RangeDays {
  return value === "30" ? 30 : 7;
}

export interface DayCount {
  /** Calendar date in the display time zone, YYYY-MM-DD. */
  date: string;
  /** Axis label: "Sat" in a week view, "Oct 17" in a month view. */
  label: string;
  /** Tooltip label, e.g. "Sat, Oct 17". */
  full: string;
  scam: number;
  suspicious: number;
  quiet: number;
}

export interface Tally {
  label: string;
  value: number;
}

export interface CaseStats {
  days: RangeDays;
  checks: number;
  scams: number;
  suspicious: number;
  quiet: number;
  texts: number;
  calls: number;
  familyAlerts: number;
  familyReplies: number;
  daily: DayCount[];
  /** Warnings only: where they came from. */
  sources: Tally[];
  /** Warnings only: brand they pretended to be, or the scam type when no brand was named. */
  topScams: Tally[];
}

export interface WarningItem {
  createdAt: Date;
  verdict: "scam" | "suspicious";
  riskScore: number;
  title: string;
  brand?: string;
  summary: string;
  source: string;
  via: string[];
  familyResponse?: string;
  userAction?: string;
}

export interface ParentView {
  id: string;
  name: string;
  relation?: string;
  phoneLast4: string;
  languageLabel: string;
  /** Gmail address typed when they were added. */
  email?: string;
  addedAt: Date;
  gmailConnected: boolean;
  gmailEmail?: string;
  lastCheckedAt?: Date;
  connectUrl?: string;
  /** Summaries are visible once this person has agreed with ScamCheck. */
  watching: boolean;
  emailsChecked: number;
  stats: CaseStats;
  warnings: WarningItem[];
}

export const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  es: "Spanish",
  ur: "Urdu",
  hi: "Hindi",
};

const SOURCE_LABELS: Record<CaseSource, string> = {
  email: "Email",
  imessage: "iMessage",
  sms: "Text message",
  whatsapp: "WhatsApp",
  call: "Phone call",
};

const VIA_LABELS: Record<NotifyChannel, string> = {
  call: "Called",
  text: "Texted",
  digest: "Daily summary",
};

const ACTION_LABELS: Partial<Record<UserAction, string>> = {
  paid: "They said they already paid",
  clicked: "They said they already clicked",
  confirmed_real: "Family said this one is real",
};

export function caseStats(cases: readonly CaseRecord[], days: RangeDays, now: Date, timeZone: string): CaseStats {
  const daily = calendarDays(days, now, timeZone);
  const byDate = new Map(daily.map((day) => [day.date, day]));
  const dateOf = dateKey(timeZone);
  const stats: CaseStats = {
    days,
    checks: 0,
    scams: 0,
    suspicious: 0,
    quiet: 0,
    texts: 0,
    calls: 0,
    familyAlerts: 0,
    familyReplies: 0,
    daily,
    sources: [],
    topScams: [],
  };
  const sources = new Map<string, number>();
  const scams = new Map<string, number>();
  for (const item of cases) {
    const day = byDate.get(dateOf(item.createdAt));
    if (!day) continue;
    stats.checks += 1;
    if (item.notifiedVia.includes("text")) stats.texts += 1;
    if (item.notifiedVia.includes("call")) stats.calls += 1;
    if (item.familyAlerted) stats.familyAlerts += 1;
    if (item.familyResponse) stats.familyReplies += 1;
    if (item.verdict === "no_red_flags") {
      day.quiet += 1;
      stats.quiet += 1;
      continue;
    }
    if (item.verdict === "scam") {
      day.scam += 1;
      stats.scams += 1;
    } else {
      day.suspicious += 1;
      stats.suspicious += 1;
    }
    bump(sources, SOURCE_LABELS[item.source] ?? "Other");
    bump(scams, scamLabel(item));
  }
  stats.sources = ranked(sources, 5);
  stats.topScams = ranked(scams, 5);
  return stats;
}

/** Scam and suspicious cases in the same calendar range as `caseStats`, newest first. */
export function warningItems(
  cases: readonly CaseRecord[],
  days: RangeDays,
  now: Date,
  timeZone: string,
  limit = 30,
): WarningItem[] {
  const dates = new Set(calendarDays(days, now, timeZone).map((day) => day.date));
  const dateOf = dateKey(timeZone);
  return cases
    .filter((item) => item.verdict !== "no_red_flags" && dates.has(dateOf(item.createdAt)))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
    .map(toWarningItem);
}

export function parentView(
  link: ParentLink,
  user: User | null,
  cases: readonly CaseRecord[],
  options: { days: RangeDays; now: Date; timeZone: string; connectUrl?: string },
): ParentView {
  const watching = Boolean(user && parentIsWatching(user.consentAcceptedAt));
  const shown = watching ? cases : [];
  const language = watching && user ? user.language : link.language;
  const view: ParentView = {
    id: link._id.toHexString(),
    name: link.parentName || "Parent",
    phoneLast4: link.phone.replace(/\D/g, "").slice(-4),
    languageLabel: LANGUAGE_LABELS[language] ?? language,
    addedAt: link.createdAt,
    gmailConnected: Boolean(user?.gmail),
    watching,
    emailsChecked: watching && user ? user.emailsChecked : 0,
    stats: caseStats(shown, options.days, options.now, options.timeZone),
    warnings: warningItems(shown, options.days, options.now, options.timeZone),
  };
  if (link.relation) view.relation = link.relation;
  if (link.email) view.email = link.email;
  if (watching && user?.gmail?.email) view.gmailEmail = user.gmail.email;
  if (watching && user?.gmail?.lastCheckedAt) view.lastCheckedAt = user.gmail.lastCheckedAt;
  if (options.connectUrl) view.connectUrl = options.connectUrl;
  return view;
}

/** Display zone for dates. An unknown zone falls back to UTC instead of throwing. */
export function validTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

function toWarningItem(item: CaseRecord): WarningItem {
  const via = item.notifiedVia.map((channel) => VIA_LABELS[channel]).filter((label): label is string => Boolean(label));
  if (item.familyAlerted) via.push("Family alerted");
  const warning: WarningItem = {
    createdAt: item.createdAt,
    verdict: item.verdict === "scam" ? "scam" : "suspicious",
    riskScore: item.riskScore,
    title: capitalize(scrubBannedWords(item.scamType.trim())) || "Possible scam",
    summary: scrubBannedWords(item.summary) || "Case recorded.",
    source: SOURCE_LABELS[item.source] ?? "Message",
    via,
  };
  if (item.claimedBrand) warning.brand = scrubBannedWords(item.claimedBrand);
  if (item.familyResponse) warning.familyResponse = scrubBannedWords(item.familyResponse);
  const action = item.userAction ? ACTION_LABELS[item.userAction] : undefined;
  if (action) warning.userAction = action;
  return warning;
}

function scamLabel(item: CaseRecord): string {
  const brand = item.claimedBrand?.trim();
  if (brand) return scrubBannedWords(brand);
  return capitalize(scrubBannedWords(item.scamType.trim())) || "Unknown";
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Biggest first. Anything past `limit` rows is folded into "Other". */
function ranked(map: Map<string, number>, limit: number): Tally[] {
  const rows = [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  if (rows.length <= limit) return rows;
  const rest = rows.slice(limit - 1).reduce((sum, row) => sum + row.value, 0);
  return [...rows.slice(0, limit - 1), { label: "Other", value: rest }];
}

/** The last `days` calendar days in `timeZone`, oldest first, ending today. */
function calendarDays(days: number, now: Date, timeZone: string): DayCount[] {
  const [year = 1970, month = 1, day = 1] = dateKey(timeZone)(now).split("-").map(Number);
  const list: DayCount[] = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    // Noon UTC on that calendar date: only used for labels, so DST never shifts the day.
    const date = new Date(Date.UTC(year, month - 1, day - back, 12));
    list.push({
      date: date.toISOString().slice(0, 10),
      label: date.toLocaleDateString("en-US", days <= 7 ? { weekday: "short", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" }),
      full: date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }),
      scam: 0,
      suspicious: 0,
      quiet: 0,
    });
  }
  return list;
}

function dateKey(timeZone: string): (date: Date) => string {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: validTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return (date) => {
    const parts = format.formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
