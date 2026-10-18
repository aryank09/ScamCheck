// Consent gate for Gmail access. A new number cannot connect mail until they reply YES.
// Photon sends, user writes, token minting, and translation are TODOs.
// The caller passes the current user (or null) and persists `patch`.

import type { FamilyContact } from "./db/users.js";

export const CONSENT_TEXT =
  "ScamCheck is an automated tool that uses AI. It can miss scams and can flag real messages by mistake. It is not a guarantee and is not affiliated with any bank, company, or government agency. Always confirm by contacting the company directly, using the number on your card or their official website. Never share codes or passwords. By replying YES, you agree to let ScamCheck read your email to check for scams. We don't store your emails or messages. Reply STOP anytime to delete your data.";

export type OnboardingStep = "language" | "consent" | "gmail" | "family" | "done";

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

const LANGUAGE_CHOICES: readonly { pattern: RegExp; code: string }[] = [
  { pattern: /\burdu\b|\bur\b/i, code: "ur" },
  { pattern: /espa[nñ]ol|\bspanish\b|\bes\b/i, code: "es" },
  { pattern: /हिंदी|\bhindi\b|\bhi\b/i, code: "hi" },
  { pattern: /\benglish\b|\ben\b/i, code: "en" },
];

const ASK_LANGUAGE = "What language should I use? You can reply Urdu, español, हिंदी, or English.";
const ASK_FAMILY = "Want family alerts? Send their name and number, or reply SKIP.";
const DONE_TIP =
  "Save me as a contact. To check a message, long-press it, tap Forward, and send it to me. Or just call me.";

/** First contact, or the next setup reply. `user` is null for a new number. */
export async function handleOnboardingMessage(
  user: OnboardingUser | null,
  text: string,
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
      return answerConsent(text);
    case "gmail":
      return answerGmail();
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

export function isConsentYes(text: string): boolean {
  return normalize(text) === "yes";
}

export function isStopCommand(text: string): boolean {
  return normalize(text) === "stop";
}

/** Read-only Gmail connect path. TODO: mint a one-time token; never log it. */
export function gmailConnectUrl(token: string): string {
  const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  return `${base}/connect/gmail?u=${encodeURIComponent(token)}`;
}

export function parseFamilyReply(text: string): "skip" | FamilyContact | undefined {
  if (normalize(text) === "skip") return "skip";
  const match = text.match(/(\+?\d[\d\s().-]{7,}\d)/);
  const raw = match?.[1];
  if (!raw) return undefined;
  const phone = raw.replace(/[^\d+]/g, "");
  const name = text.replace(raw, "").replace(/^[\s,:-]+|[\s,:-]+$/g, "").trim();
  if (!name || phone.length < 8) return undefined;
  return { name, phone };
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

function answerConsent(text: string): OnboardingTurn {
  if (!isConsentYes(text)) {
    return {
      handled: true,
      replies: ["Reply YES to let ScamCheck check your email.", CONSENT_TEXT],
      step: "consent",
      patch: { onboardingStep: "consent" },
    };
  }
  return {
    handled: true,
    replies: [
      "Thank you. You can connect Gmail so I can check new mail. Access stays read-only.",
      "Reply SKIP to do this later. The link is /connect/gmail?u=…",
    ],
    step: "gmail",
    patch: { onboardingStep: "gmail", consentAcceptedAt: new Date() },
  };
}

function answerGmail(): OnboardingTurn {
  // TODO: mint a token and send gmailConnectUrl(token) through Photon. Scope is gmail.readonly.
  return {
    handled: true,
    replies: [ASK_FAMILY],
    step: "family",
    patch: { onboardingStep: "family" },
  };
}

function answerFamily(text: string): OnboardingTurn {
  const parsed = parseFamilyReply(text);
  if (parsed === undefined) {
    return {
      handled: true,
      replies: [ASK_FAMILY],
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
  // TODO: revoke the Gmail refresh token, delete the user, and delete their cases.
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
