import type { User } from "../db/users.js";
import { saveUser } from "../db/users.js";
import { normalizePhone } from "../db/users.js";

const CONSENT: Record<string, string> = {
  en: "ScamCheck is an automated tool that uses AI. It can miss scams and can flag real messages by mistake. It is not a guarantee and is not affiliated with any bank, company, or government agency. Always confirm by contacting the company directly, using the number on your card or their website. Never share codes or passwords. By replying YES, you agree to let ScamCheck read your email to check for scams. We don't store your emails or messages. Reply STOP anytime to delete your data.",
  es: "ScamCheck es una herramienta automatica que usa IA. Puede no ver una estafa y puede marcar un mensaje real por error. No es una garantia y no esta afiliada a ningun banco, empresa o gobierno. Confirma siempre con la empresa, usando el numero de tu tarjeta o su sitio. Nunca compartas codigos ni contrasenas. Al responder SI, aceptas que ScamCheck lea tu correo para buscar estafas. No guardamos tus correos ni mensajes. Responde STOP cuando quieras borrar tus datos.",
};

const LANGUAGE_NAMES: readonly [RegExp, string][] = [
  [/\b(spanish|espanol|castellano)\b|español/, "es"],
  [/\burdu\b|اردو/, "ur"],
  [/\bhindi\b|हिंदी|हिन्दी/, "hi"],
  [/\benglish\b|ingl[eé]s/, "en"],
];
const LANGUAGE_CODES = new Set(["es", "ur", "hi", "en"]);
const NOT_A_LANGUAGE =
  /^(hi|hello|hey|hola|yo|thanks|thank you|ok|okay|start|help|test|yes|no|si|sí|yep|yeah|nah|stop)\b/i;

/**
 * Language code from free text, or null if not recognized.
 * Bare codes only count with allowCodes (the LANGUAGE command): as a first message,
 * "hi" is a greeting and "ur" is "your".
 */
export function languageCode(text: string, allowCodes = false): string | null {
  const value = text.trim().toLowerCase();
  for (const [pattern, code] of LANGUAGE_NAMES) if (pattern.test(value)) return code;
  if (allowCodes && LANGUAGE_CODES.has(value)) return value;
  return null;
}

/**
 * A language answer for the first onboarding question.
 * Null means the text is a greeting or not a language, so the question should be asked again.
 * An unrecognized language name falls back to English.
 */
export function languageAnswer(text: string): { code: string; recognized: boolean } | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 40) return null;
  if (NOT_A_LANGUAGE.test(trimmed)) return null;
  const known = languageCode(trimmed);
  if (known) return { code: known, recognized: true };
  if (/^[\p{L}][\p{L}\s'.-]{0,40}$/u.test(trimmed)) return { code: "en", recognized: false };
  return null;
}

export function consentText(language: string): string {
  if (CONSENT[language]) return CONSENT[language];
  return `I don't have that language saved, so this is in English.\n\n${CONSENT.en}`;
}

export function familyPageLink(token: string): string | null {
  const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  if (!base || !token) return null;
  return `${base}/family?t=${token}`;
}

export function connectLink(user: User): string {
  const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  if (!base || !user.connectToken) return "The Gmail connect link is not ready yet.";
  return `${base}/connect/gmail?u=${user.connectToken}`;
}

export function currentPrompt(user: User): string {
  if (user.onboardingStep === "language") return "What language should I use? For example: English, Spanish, Urdu, or Hindi.";
  if (user.onboardingStep === "consent") return consentText(user.language);
  if (user.onboardingStep === "family") return "Send their name and number, or reply SKIP.";
  return `Save me as a contact. To check a message, forward it to me, or call me.\n\nConnect Gmail: ${connectLink(user)}`;
}

/** Returns the next prompt. Null means this message is not an onboarding step. */
export async function advanceOnboarding(user: User, text: string): Promise<string | null> {
  if (user.onboardingStep === "done") return null;
  const trimmed = text.trim();

  if (user.onboardingStep === "language") {
    const answer = languageAnswer(trimmed);
    if (!answer) return "What language should I use? For example: English, Spanish, Urdu, or Hindi.";
    await saveUser(user._id, { language: answer.code, onboardingStep: "consent" });
    user.language = answer.code;
    user.onboardingStep = "consent";
    if (!answer.recognized) {
      return `I don't have that language saved, so this is in English.\n\n${consentText("en")}`;
    }
    return consentText(answer.code);
  }

  if (user.onboardingStep === "consent") {
    if (!/^(yes|si|sí)$/i.test(trimmed)) return "Reply YES to continue, or STOP to delete your data.";
    await saveUser(user._id, { consentAcceptedAt: new Date(), onboardingStep: "family" });
    user.onboardingStep = "family";
    return "Send their name and number, or reply SKIP.";
  }

  if (/^skip$/i.test(trimmed)) {
    await saveUser(user._id, { onboardingStep: "done" });
    user.onboardingStep = "done";
    return `Save me as a contact. To check a message, long-press it, tap Forward, and send it to me. Or just call me.\n\nConnect Gmail: ${connectLink(user)}`;
  }

  const parsed = parseFamily(trimmed);
  if (!parsed) return "Send their name and number, or reply SKIP.";
  await saveUser(user._id, {
    familyContacts: [...user.familyContacts, parsed],
    familyGroupId: user.familyGroupId ?? user._id.toHexString(),
    onboardingStep: "done",
  });
  user.onboardingStep = "done";
  return `I'll tell ${parsed.name} if something looks risky.\n\nConnect Gmail: ${connectLink(user)}`;
}

export function parseFamily(text: string): { name: string; phone: string } | null {
  const match = text.match(/^(.+?)\s+(\+?\d[\d\s().-]{7,}\d)$/);
  if (!match?.[1] || !match[2]) return null;
  const phone = normalizePhone(match[2]);
  if (phone.replace(/\D/g, "").length < 8) return null;
  return { name: match[1].trim().slice(0, 80), phone };
}
