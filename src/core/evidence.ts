import { getDomain } from "tldts";
import { BRANDS, type Brand } from "./brands.js";
import { parseHtml } from "../email/parse.js";
import type { Finding, MessageLink, ParsedMessage } from "./types.js";

export const HIGH_RISK_FLOOR = 75;

const SHORTENERS = new Set([
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "cutt.ly",
  "rb.gy",
  "buff.ly",
  "rebrand.ly",
]);

const RISKY_ASKS: readonly RegExp[] = [
  /gift\s*cards?/i,
  /\bcrypto\b/i,
  /\bbitcoin\b/i,
  /wire\s+transfer/i,
  /\bpassword\b/i,
  /\bpasscode\b/i,
  /one[- ]time (code|password)/i,
  /verification code/i,
  /verify your account/i,
  /small fee/i,
];

const URGENCY: readonly RegExp[] = [
  /\burgent\b/i,
  /\bimmediately\b/i,
  /act now/i,
  /\bsuspended\b/i,
  /limited time/i,
  /\boverdue\b/i,
  /account (is )?locked/i,
  /past due/i,
  /\brefund\b/i,
];

const CONFUSABLE_FOLDS: readonly [RegExp, string][] = [
  [/0/g, "o"],
  [/1/g, "l"],
  [/5/g, "s"],
  [/rn/g, "m"],
];

export function rulesFloor(findings: readonly Finding[]): number {
  return findings.some((finding) => finding.severity === "high") ? HIGH_RISK_FLOOR : 0;
}

/**
 * Rule checks from AGENTS.md section 8. Deterministic: no network calls.
 * Google Safe Browsing is optional and stays out of this function.
 */
export function collectEvidence(message: ParsedMessage): Finding[] {
  const html = message.html ? parseHtml(message.html) : undefined;
  const text = [message.text, html?.text].filter(Boolean).join("\n");
  const links = dedupeLinks([
    ...(message.links ?? []),
    ...(html?.links ?? []),
    ...linksInText(text),
  ]);
  const view: ParsedMessage = { ...message, text, links };

  const findings: Finding[] = [];
  const seen = new Set<string>();
  const add = (finding: Finding) => {
    const key = `${finding.code}|${finding.detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
  };

  if (view.source === "email") {
    for (const protocol of failedAuth(view.authenticationResults)) {
      add({
        code: "AUTH_FAIL",
        severity: "high",
        detail: `${protocol.toUpperCase()} failed.`,
      });
    }
  }

  const claimed = identityClaims(view);
  const fromHost = hostOf(view.from);
  for (const host of hostsToInspect(view, fromHost)) {
    for (const finding of lookalikeFindings(host)) add(finding);
  }
  for (const brand of claimed) {
    for (const finding of brandMismatchFindings(brand, fromHost, links)) add(finding);
  }
  for (const link of links) {
    const hidden = hiddenLinkFinding(link);
    if (hidden) add(hidden);
    const shortener = shortenerFinding(link.href);
    if (shortener) add(shortener);
  }

  if (view.source === "email") {
    const reply = replyToFinding(fromHost, view.replyTo);
    if (reply) add(reply);
    if (view.seenSenderBefore === false && matchesAny(text, URGENCY)) {
      add({
        code: "NEW_SENDER_URGENCY",
        severity: "medium",
        detail: "First time seeing this sender, and the message pushes urgency or money.",
      });
    }
  }

  if (matchesAny(text, RISKY_ASKS)) {
    add({
      code: "RISKY_ASK",
      severity: "medium",
      detail: "The message asks for a payment, a code, or account verification.",
    });
  }

  if (view.source !== "email") {
    const impersonation = textSenderFinding(view, claimed);
    if (impersonation) add(impersonation);
  }

  return findings;
}

function hostsToInspect(message: ParsedMessage, fromHost: string | null): string[] {
  const hosts = new Set<string>();
  if (fromHost) hosts.add(fromHost);
  for (const link of message.links) {
    const host = hostOf(link.href);
    if (host) hosts.add(host);
  }
  return [...hosts];
}

/** Display name and subject only. A body mention, or an email address, is not a claim of identity. */
function identityClaims(message: ParsedMessage): Brand[] {
  const haystack = [claimText(message.displayName), claimText(message.subject)].filter(Boolean).join("\n");
  return BRANDS.filter((brand) => brand.patterns.some((pattern) => pattern.test(haystack)));
}

function claimText(value: string | undefined): string {
  if (!value) return "";
  return value.replace(/[^\s<>"]+@[^\s<>"]+/g, " ");
}

function brandMismatchFindings(brand: Brand, fromHost: string | null, links: MessageLink[]): Finding[] {
  const findings: Finding[] = [];
  if (fromHost && !isOfficialHost(fromHost, brand)) {
    findings.push({
      code: "BRAND_MISMATCH",
      severity: "high",
      detail: `It says it is ${brand.name}, but the sender domain is ${registrableDomain(fromHost) ?? fromHost}.`,
    });
  }
  for (const link of links) {
    const host = hostOf(link.href);
    if (!host || isOfficialHost(host, brand) || isShortener(host)) continue;
    findings.push({
      code: "BRAND_MISMATCH",
      severity: "high",
      detail: `It says it is ${brand.name}, but a link goes to ${registrableDomain(host) ?? host}.`,
    });
  }
  return findings;
}

function lookalikeFindings(host: string): Finding[] {
  const findings: Finding[] = [];
  const lower = host.toLowerCase();
  if (lower.split(".").some((label) => label.startsWith("xn--"))) {
    findings.push({
      code: "LOOKALIKE_DOMAIN",
      severity: "high",
      detail: `${host} uses punycode.`,
    });
  }

  const original = registrableDomain(lower);
  const foldedHost = foldConfusables(lower);
  const folded = registrableDomain(foldedHost);
  if (folded && folded !== original) {
    const matched = BRANDS.find((brand) => brand.domains.includes(folded));
    if (matched && !isOfficialHost(lower, matched)) {
      findings.push({
        code: "LOOKALIKE_DOMAIN",
        severity: "high",
        detail: `${host} is a lookalike of ${matched.domains[0]}.`,
      });
    }
  }

  for (const brand of BRANDS) {
    if (isOfficialHost(lower, brand)) continue;
    if (!embedsBrand(lower, brand.token)) continue;
    findings.push({
      code: "LOOKALIKE_DOMAIN",
      severity: "high",
      detail: `${host} puts ${brand.name} in an unrelated domain.`,
    });
  }
  return findings;
}

function hiddenLinkFinding(link: MessageLink): Finding | null {
  const hrefHost = hostOf(link.href);
  if (!hrefHost) return null;
  const hrefDomain = registrableDomain(hrefHost);
  if (!hrefDomain) return null;
  for (const visibleHost of domainsInText(link.visibleText)) {
    const visibleDomain = registrableDomain(visibleHost);
    if (visibleDomain && visibleDomain !== hrefDomain) {
      return {
        code: "HIDDEN_LINK",
        severity: "high",
        detail: `The link text shows ${visibleDomain}, but it goes to ${hrefDomain}.`,
      };
    }
  }
  return null;
}

function shortenerFinding(href: string): Finding | null {
  const host = hostOf(href);
  if (!host || !isShortener(host)) return null;
  return {
    code: "URL_SHORTENER",
    severity: "low",
    detail: `Link uses the shortener ${registrableDomain(host) ?? host}.`,
  };
}

function replyToFinding(fromHost: string | null, replyTo: string | undefined): Finding | null {
  const replyHost = hostOf(replyTo);
  if (!fromHost || !replyHost) return null;
  const fromDomain = registrableDomain(fromHost);
  const replyDomain = registrableDomain(replyHost);
  if (!fromDomain || !replyDomain || fromDomain === replyDomain) return null;
  return {
    code: "REPLY_TO_MISMATCH",
    severity: "medium",
    detail: `Reply-To domain ${replyDomain} differs from From domain ${fromDomain}.`,
  };
}

function textSenderFinding(message: ParsedMessage, claimed: Brand[]): Finding | null {
  if (claimed.length === 0 || !message.from) return null;
  const from = message.from.trim();
  const looksLikeEmail = /@/.test(from);
  const looksLikeLongNumber = isLongPhone(from);
  if (!looksLikeEmail && !looksLikeLongNumber) return null;
  return {
    code: "SENDER_IMPERSONATION",
    severity: "high",
    detail: `A ${looksLikeEmail ? "random email address" : "phone number"} is claiming to be ${claimed.map((brand) => brand.name).join(", ")}.`,
  };
}

function failedAuth(header: string | undefined): string[] {
  if (!header) return [];
  const failed: string[] = [];
  for (const protocol of ["spf", "dkim", "dmarc"]) {
    if (new RegExp(`\\b${protocol}\\s*=\\s*fail\\b`, "i").test(header)) failed.push(protocol);
  }
  return failed;
}

function isOfficialHost(host: string, brand: Brand): boolean {
  const domain = registrableDomain(host);
  return domain !== null && brand.domains.includes(domain);
}

function isShortener(host: string): boolean {
  const domain = registrableDomain(host);
  return domain !== null && SHORTENERS.has(domain);
}

function embedsBrand(host: string, token: string): boolean {
  for (const label of host.toLowerCase().split(".")) {
    if (label === token) return true;
    if (label.split("-").includes(token)) return true;
  }
  return false;
}

function foldConfusables(host: string): string {
  let folded = host.toLowerCase();
  for (const [pattern, replacement] of CONFUSABLE_FOLDS) {
    folded = folded.replace(pattern, replacement);
  }
  return folded;
}

function domainsInText(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/gi)) {
    if (match[1]) found.add(match[1].toLowerCase());
  }
  return [...found];
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function isLongPhone(from: string): boolean {
  const digits = from.replace(/\D/g, "");
  return digits.length >= 8 && /^[+\d\s().-]+$/.test(from);
}

function linksInText(text: string): MessageLink[] {
  const links: MessageLink[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const href = match[0].replace(/[).,]+$/, "");
    links.push({ visibleText: href, href });
  }
  return links;
}

function dedupeLinks(links: MessageLink[]): MessageLink[] {
  const seen = new Set<string>();
  const unique: MessageLink[] = [];
  for (const link of links) {
    const key = `${link.visibleText}|${link.href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(link);
  }
  return unique;
}

export function hostOf(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    const email = trimmed.match(/[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/i);
    if (email?.[1]) return email[1].toLowerCase();
  }
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
    if (url.hostname.includes(".")) return url.hostname.replace(/\.$/, "").toLowerCase();
  } catch {
    return null;
  }
  return null;
}

export function registrableDomain(host: string): string | null {
  const normalized = host.trim().toLowerCase().replace(/\.$/, "");
  if (!normalized.includes(".")) return null;
  return getDomain(normalized) ?? fallbackDomain(normalized);
}

function fallbackDomain(host: string): string | null {
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) return null;
  return labels.slice(-2).join(".");
}
