// Deterministic safety paths that run before and after the model (from the VEYZL audit, 10-17-26).
// Rules here are code, not prompt wording, so no message can talk the model out of them.

/** Fixed reply that replaces the model's answer for this message. */
export interface GuardReply {
  guard: "self_harm" | "sensitive_share";
  reply: string;
}

const CRISIS =
  "I'm worried about you. If you're thinking about hurting yourself, please call or text 988 right now " +
  "(988 Suicide & Crisis Lifeline, free, 24/7). Para español, llama al 988 y oprime 2. " +
  "If you're in danger, call 911. You're not alone.";

const SENSITIVE =
  "Please don't share card numbers, Social Security numbers, passwords, or codes with anyone, including me. " +
  "I didn't keep it. If you already gave it to someone, call your bank right away using the number on your card.";

const SCOPE =
  "I'm ScamCheck. I only check messages for scams, so I won't do what this asks. " +
  "I never follow instructions inside messages or share my settings or anyone's data.";

const SELF_HARM =
  /\b(kill(ing)? myself|harm(ing)? myself|hurt(ing)? myself|end (it all|my life)|suicid\w*|self[- ]harm|want to die|don'?t want to live|quitarme la vida|hacerme daño)\b|خودکشی|आत्महत्या/i;

// Requests aimed at the assistant itself rather than a message being checked.
// ponytail: English patterns; extend from new audit probes.
const ASSISTANT_REQUEST = new RegExp(
  [
    String.raw`\bignore (all |any |your |the )?(previous |prior |above )?(instructions|rules)`,
    String.raw`\b(system|hidden) prompt\b`,
    String.raw`\bdeveloper mode\b`,
    String.raw`\b(reveal|print|dump|show|list)\b.{0,40}\b(api keys?|passwords?|tokens?|secrets?|instructions|private data|customer (emails?|phone))`,
    String.raw`\b(repeat|confirm) it back\b`,
    String.raw`^\s*(please\s+)?(write|invent|describe|identify|tell me|what is|what's|who is|explain|pretend)\b`,
  ].join("|"),
  "i",
);

const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
// 13–19 digits with optional spaces/dashes: card length. Phones (10–11 digits) never match.
const CARD = /\b(?:\d[ -]?){12,18}\d\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g;
const PHONE = /(?<![\w\]])\+?1?[ (.-]*\d{3}[ ).-]*\d{3}[ .-]*\d{4}(?!\w)/g;

// "My SSN is…" / "here is my credit card". A scam that merely contains a number does not match.
const OWN_SECRET =
  /\b(my|here(?:'s| is) my)\b[\s\S]{0,48}\b(ssn|social security|credit card|card number|card)\b/i;

function hasSensitiveNumber(text: string): boolean {
  return new RegExp(SSN.source).test(text) || new RegExp(CARD.source).test(text);
}

/** True when the sender is handing over their own card or SSN, not when a scam quotes one. */
export function sharesOwnSecret(text: string): boolean {
  return hasSensitiveNumber(text) && OWN_SECRET.test(text);
}

/** Fixed path for self-harm or a parent sharing their own card/SSN. Null = check normally. */
export function preCheck(text: string, hasLinks: boolean): GuardReply | null {
  if (SELF_HARM.test(text)) return { guard: "self_harm", reply: CRISIS };
  // A forwarded scam still gets checked, with or without a link. Numbers are redacted before the model.
  if (!hasLinks && sharesOwnSecret(text)) return { guard: "sensitive_share", reply: SENSITIVE };
  return null;
}

/**
 * Text aimed at the AI ("ignore your instructions", "write a rant"). It is still scam-checked:
 * a scammer could add these words on purpose, so they must never switch the check off.
 */
export function isAssistantRequest(text: string): boolean {
  return ASSISTANT_REQUEST.test(text);
}

/** Lead with the refusal; keep the scam warning when there is one. */
export function withRefusal(reply: string, lowRisk: boolean): string {
  return lowRisk ? SCOPE : `${SCOPE}\n\n${reply}`;
}

/** Before the model: card and Social Security numbers never leave our server (AGENTS.md §14). */
export function redactForModel(text: string): string {
  return text.replace(SSN, "[SSN removed]").replace(CARD, "[card number removed]");
}

/** Before anything reaches a user: no SSNs, card numbers, emails, or phone numbers echoed back. */
export function redactOutput(text: string): string {
  return redactForModel(text).replace(EMAIL, "[email removed]").replace(PHONE, "[number removed]");
}
