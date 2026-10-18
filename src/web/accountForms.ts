import { normalizePhone } from "../db/users.js";

const LANGUAGES = new Set(["en", "es", "ur", "hi"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SignupInput {
  name: string;
  email: string;
  password: string;
}

export interface ParentInput {
  name: string;
  phone: string;
  language: string;
  relation?: string;
}

export function parseSignup(fields: Record<string, string>): { ok: true; value: SignupInput } | { ok: false; error: string } {
  const name = clean(fields.name, 80);
  const email = (fields.email ?? "").trim().toLowerCase();
  const password = fields.password ?? "";
  if (!name) return { ok: false, error: "Enter your name." };
  if (!EMAIL_RE.test(email) || email.length > 200) return { ok: false, error: "Enter a real email address." };
  if (password.length < 8 || password.length > 200) return { ok: false, error: "Use a password of at least 8 characters." };
  return { ok: true, value: { name, email, password } };
}

export function parseParent(fields: Record<string, string>): { ok: true; value: ParentInput } | { ok: false; error: string } {
  const name = clean(fields.name, 80);
  const phone = normalizePhone(fields.phone ?? "");
  const language = (fields.language ?? "en").trim().toLowerCase();
  const relation = clean(fields.relation, 40);
  if (!name) return { ok: false, error: "Enter their name." };
  if (phone.includes("@") || phone.replace(/\D/g, "").length < 8) {
    return { ok: false, error: "Enter a real mobile number." };
  }
  if (!LANGUAGES.has(language)) return { ok: false, error: "Choose English, Spanish, Urdu, or Hindi." };
  return { ok: true, value: { name, phone, language, relation: relation || undefined } };
}

const TEXT_FAILURES: Record<string, string> = {
  recipient_invalid: "That number does not look like a mobile number.",
  recipient_unreachable: "The carrier could not reach that number.",
  recipient_opted_out: "That number has opted out of texts.",
  message_blocked: "The message was blocked.",
  message_blocked_by_carrier: "The carrier blocked the message.",
  message_rate_limited: "The carrier asked us to slow down.",
  message_rejected: "The carrier rejected it.",
  message_expired: "The carrier dropped it before delivery.",
  message_delivery_failed: "The carrier did not deliver it.",
  sender_registration_required: "This line is not ready to send iMessage yet.",
  sender_not_authorized: "This line is not allowed to text that number.",
  sender_unavailable: "The iMessage line is unavailable.",
  not_configured: "iMessage is not set up.",
  send_failed: "The text did not send.",
};

/** Plain status for the parent heads-up iMessage. Reload the page to ask Photon again. */
export function textStatusLabel(status?: string, failure?: string): string {
  if (!status) return "iMessage not sent";
  if (status === "delivered") return "iMessage delivered";
  if (status === "accepted") return "iMessage accepted";
  if (status === "dispatched") return "iMessage sent, waiting on delivery";
  if (status === "failed") {
    const detail = failure ? TEXT_FAILURES[failure] : undefined;
    return detail ? `iMessage failed. ${detail}` : "iMessage failed.";
  }
  return `iMessage status: ${status}`;
}

/** Delivery can still change. Delivered and failed are final. */
export function inviteStillOpen(status?: string): boolean {
  return status === "dispatched" || status === "accepted";
}

/** Case summaries stay hidden until this person has agreed with ScamCheck. */
export function parentIsWatching(consentAcceptedAt: Date | undefined): boolean {
  return consentAcceptedAt instanceof Date && !Number.isNaN(consentAcceptedAt.getTime());
}

export function sessionCookie(token: string, secure: boolean): string {
  const base = `scamcheck_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1209600`;
  return secure ? `${base}; Secure` : base;
}

export function clearSessionCookie(secure: boolean): string {
  const base = "scamcheck_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
  return secure ? `${base}; Secure` : base;
}

export function readCookie(header: string | undefined, name: string): string {
  if (!header) return "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

function clean(value: string | undefined, max: number): string {
  return (value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}
