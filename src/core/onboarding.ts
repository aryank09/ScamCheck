// Consent gate for Gmail access. A new number cannot connect mail until they reply YES.
// Photon sends, user writes, token minting, and translation are TODOs.
// The caller passes the current user (or null) and persists `patch`.

import type { FamilyContact } from "../db/users.js";

export const CONSENT_TEXT =
  "ScamCheck is an automated tool that uses AI. It can miss scams and can flag real messages by mistake. It is not a guarantee and is not affiliated with any bank, company, or government agency. Always confirm by contacting the company directly, using the number on your card or their official website. Never share codes or passwords. By replying YES, you agree to let ScamCheck read your email to check for scams. We don't store your emails or messages. Reply STOP anytime to delete your data.";

// Matches users.onboardingStep in AGENTS.md §7. The Gmail offer rides along with the family question.
export type OnboardingStep = "language" | "consent" | "family" | "done";

/** User fields this flow reads and writes. `language` matches the user record. */
export interface OnboardingUser {
  phone: string;
  language: string;
  onboardingStep: OnboardingStep;
  consentAcceptedAt?: Date;
  familyContacts: FamilyContact[];
  gmail?: {
    email: string;
    refreshTokenEnc: string;
    lastCheckedAt: Date;
  };
}

export interface OnboardingPatch {
  onboardingStep: OnboardingStep;
  language?: string;
  consentAcceptedAt?: Date;
  familyContact?: FamilyContact;
  /** STOP: revoke the Gmail token, then delete the user and their cases. */
  deleteUser?: boolean;
}

export interface OnboardingTurn {
  /** False once setup is done, so the caller can treat the text as a normal check. */
  handled: boolean;
  replies: string[];
  step: OnboardingStep;
  patch?: OnboardingPatch;
}

// Language names only, never 2-letter codes: "hi" is a greeting, "ur" is "your".
const LANGUAGE_CHOICES: readonly { pattern: RegExp; code: string }[] = [
  { pattern: /\burdu\b|اردو/i, code: "ur" },
  { pattern: /espa[nñ]ol|\bspanish\b|\bcastellano\b/i, code: "es" },
  { pattern: /हिंदी|हिन्दी|\bhindi\b/i, code: "hi" },
  { pattern: /\benglish\b|ingl[eé]s/i, code: "en" },
];

const ASK_LANGUAGE = "What language should I use? You can reply Urdu, español, हिंदी, or English.";
const ASK_FAMILY = "Want family alerts? Send their name and number, or reply SKIP.";
const ASK_FAMILY_RETRY = "I couldn't read that. Send a name and phone number with area code, like: Ali 206 555 0100. Or reply SKIP.";
const DONE_TIP =
  "Save me as a contact. To check a message, long-press it, tap Forward, and send it to me. Or just call me.";

/**
 * First contact, or the next setup reply. `user` is null for a new number.
 * The caller persists `patch` BEFORE sending `replies` (STOP says the data is already deleted).
 * Pass `gmailToken` (one-time, never logged) to include the Gmail connect link after YES.
 */
export async function handleOnboardingMessage(
  user: OnboardingUser | null,
  text: string,
  opts: { gmailToken?: string } = {},
): Promise<OnboardingTurn> {
  if (isStopCommand(text)) return stopTurn();

  if (!user || user.onboardingStep === "language") {
    if (!user && isLikelyForwardedScam(text)) {
      const verdict = await analyzeForwardedFirst(text);
      return {
        handled: true,
        replies: [verdict, ASK_LANGUAGE],
        step: "language",
        patch: { onboardingStep: "language", language: "en" },
      };
    }
    if (!user && !parseLanguageChoice(text).recognized) {
      return {
        handled: true,
        replies: [ASK_LANGUAGE],
        step: "language",
        patch: { onboardingStep: "language", language: "en" },
      };
    }
    return chooseLanguage(text);
  }

  switch (user.onboardingStep) {
    case "consent":
      return answerConsent(text, opts.gmailToken);
    case "family":
      return answerFamily(text);
    case "done":
      return { handled: false, replies: [], step: "done" };
  }
}

/** Free-text language. Unknown requests default to English. */
export function parseLanguageChoice(text: string): { language: string; recognized: boolean } {
  for (const choice of LANGUAGE_CHOICES) {
    if (choice.pattern.test(text)) return { language: choice.code, recognized: true };
  }
  return { language: "en", recognized: false };
}

// "yes", "Yes please", "sí", "haan", "ہاں", "हाँ". Anything with "no" in it is not consent.
const YES_WORDS = new Set(["yes", "y", "yeah", "yep", "sí", "si", "haan", "han", "ji", "ہاں", "جی", "हाँ", "हां", "जी"]);
export function isConsentYes(text: string): boolean {
  const words = normalize(text).split(/[\s,]+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  if (words.some((w) => w === "no" || w === "not" || w === "nahi" || w === "نہیں" || w === "नहीं")) return false;
  return YES_WORDS.has(words[0]!);
}

export function isStopCommand(text: string): boolean {
  return normalize(text) === "stop";
}

/** Read-only Gmail connect path. The token is one-time and must never be logged. */
export function gmailConnectUrl(token: string): string {
  const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  return `${base}/connect/gmail?u=${encodeURIComponent(token)}`;
}

export function parseFamilyReply(text: string): "skip" | FamilyContact | undefined {
  if (normalize(text) === "skip") return "skip";
  const match = text.match(/(\+?\d[\d\s().-]{7,}\d)/);
  const raw = match?.[1];
  if (!raw) return undefined;
  const phone = toE164(raw);
  const name = text.replace(raw, "").replace(/^[\s,:-]+|[\s,:-]+$/g, "").trim();
  if (!name || !phone) return undefined;
  return { name, phone };
}

/** Phones are identity across channels, so store E.164 only. ponytail: bare 10-digit numbers assume US (+1). */
export function toE164(raw: string): string | undefined {
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : undefined;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return undefined;
}

/** Placeholder. A long first message or one with a link is checked before setup. */
export function isLikelyForwardedScam(text: string): boolean {
  return /https?:\/\//i.test(text) || text.trim().length > 80;
}

function chooseLanguage(text: string): OnboardingTurn {
  const choice = parseLanguageChoice(text);
  // TODO: translate CONSENT_TEXT into choice.language once and cache it.
  const note = choice.recognized
    ? "Thanks. Please read this and reply YES to continue."
    : "I don't know that language yet, so I'll use English. Please read this and reply YES to continue.";
  return {
    handled: true,
    replies: [note, CONSENT_TEXT],
    step: "consent",
    patch: { onboardingStep: "consent", language: choice.language },
  };
}

function answerConsent(text: string, gmailToken?: string): OnboardingTurn {
  if (!isConsentYes(text)) {
    return {
      handled: true,
      replies: ["Reply YES to let ScamCheck check your email.", CONSENT_TEXT],
      step: "consent",
      patch: { onboardingStep: "consent" },
    };
  }
  const replies = ["Thank you."];
  // Read-only Gmail. No link until the caller mints a token; never show a placeholder.
  if (gmailToken) replies.push(`Connect Gmail so I can check new mail (read-only): ${gmailConnectUrl(gmailToken)}`);
  replies.push(ASK_FAMILY);
  return {
    handled: true,
    replies,
    step: "family",
    patch: { onboardingStep: "family", consentAcceptedAt: new Date() },
  };
}

function answerFamily(text: string): OnboardingTurn {
  const parsed = parseFamilyReply(text);
  if (parsed === undefined) {
    return {
      handled: true,
      replies: [ASK_FAMILY_RETRY],
      step: "family",
      patch: { onboardingStep: "family" },
    };
  }
  return {
    handled: true,
    replies: [parsed === "skip" ? "Okay, no family alerts for now." : "I'll alert them about scams.", DONE_TIP],
    step: "done",
    patch: {
      onboardingStep: "done",
      familyContact: parsed === "skip" ? undefined : parsed,
    },
  };
}

function stopTurn(): OnboardingTurn {
  // The caller must revoke the Gmail token and delete the user and cases (patch.deleteUser)
  // before sending this reply, because the reply says it's done.
  return {
    handled: true,
    replies: ["ScamCheck has deleted your data. You can text again if you want to start over."],
    step: "done",
    patch: { onboardingStep: "done", deleteUser: true },
  };
}

/** TODO: run analyze() on the forward, then continue setup. Do not store the message. */
async function analyzeForwardedFirst(text: string): Promise<string> {
  void text;
  return "I'll check that message first, then ask a couple of setup questions.";
}

function normalize(text: string): string {
  return text.trim().replace(/[.!]+$/g, "").toLowerCase();
}
