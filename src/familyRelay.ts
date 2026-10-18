// Privacy: family alerts and relays never include the original email, text, image, or audio.
// They may name who was contacted, the scam type, and a short reply. See AGENTS.md §11 and §14.
//
// Skeleton only. Photon sends, translation, voice notes, and database writes are TODOs.
// Voice tools still call alertFamily in src/core/familyRelay.ts until this flow is wired up.

import type { CaseVerdict, UserAction } from "./db/cases.js";

export interface FamilyContactRef {
  name: string;
  phone: string;
  relation?: string;
}

/** What an alert is allowed to carry. There is no field for the original message. */
export interface FamilyAlert {
  caseId: string;
  recipientName: string;
  scamType: string;
  contacts: FamilyContactRef[];
}

export interface FamilyAlertDraft {
  caseId: string;
  messages: { toPhone: string; text: string }[];
}

/** Latest case a family reply can attach to. Same stored fields as CaseRecord, with no raw body. */
export interface OpenCase {
  id: string;
  userId: string;
  language: string;
  userPhone: string;
  scamType: string;
  verdict: CaseVerdict;
  summary: string;
  senderDomain?: string;
  familyResponse?: string;
  userAction?: UserAction;
}

export interface FamilyReply {
  fromPhone: string;
  text: string;
}

export interface FamilyRelayResult {
  caseId: string;
  familyResponse: string;
  userAction?: "confirmed_real";
  /** Text for the user. A voice note should speak this same line. */
  userText: string;
  /** Set only the first time this family phone is seen. Send it before userText. */
  introText?: string;
}

interface FamilyLink {
  contact: FamilyContactRef;
  openCase: OpenCase;
}

const RESPONSE_MAX = 240;

// TODO: persist this on the family contact. A process restart will send the intro again.
const introSent = new Set<string>();

/** Alert line: who and the scam type only. */
export function buildFamilyAlertText(recipientName: string, scamType: string): string {
  const name = recipientName.trim() || "Your family member";
  const scam = scamType.trim() || "possible scam";
  return (
    `ScamCheck: ${name} received a likely scam (${scam}). ` +
    `They were told not to click or reply. Reply here and I'll pass your message to ${name}.`
  );
}

/** Build the alert for each linked contact. First-time contacts get one intro before it. */
export async function sendFamilyAlert(alert: FamilyAlert): Promise<FamilyAlertDraft> {
  const messages: FamilyAlertDraft["messages"] = [];
  for (const contact of alert.contacts) {
    const intro = takeIntro(contact);
    if (intro) messages.push({ toPhone: contact.phone, text: intro });
    messages.push({
      toPhone: contact.phone,
      text: buildFamilyAlertText(alert.recipientName, alert.scamType),
    });
  }

  // TODO: Photon sendText for each message. Do not attach the original email or text.
  // TODO: updateCase(alert.caseId, { familyAlerted: true }).
  return { caseId: alert.caseId, messages };
}

/** One-time intro copy. Returns the text only the first time this phone is seen. */
export function sendFamilyIntro(contact: FamilyContactRef): string | undefined {
  return takeIntro(contact);
}

/**
 * Relay a family reply to the user in their language, as text and a voice note.
 * Returns null when no open case is linked to this phone yet.
 */
export async function handleFamilyReply(reply: FamilyReply): Promise<FamilyRelayResult | null> {
  const found = await findOpenCaseForReply(reply.fromPhone);
  if (!found) return null;

  const { contact, openCase } = found;
  const translated = await translateForUser(reply.text, openCase.language);
  const speaker = contact.relation?.trim() || contact.name.trim() || "Family";
  const familyResponse = shortResponse(speaker, translated);
  const userAction = saysItIsReal(reply.text) ? "confirmed_real" : undefined;
  const userText =
    userAction === "confirmed_real"
      ? `Message from ${speaker}: they say this is real. ${translated}`
      : `Message from ${speaker}: ${translated}`;

  // TODO: updateCase(openCase.id, { familyResponse, userAction }).
  // TODO: Photon sendText(openCase.userPhone, userText).
  // TODO: ElevenLabs voice note of userText. If TTS fails, the text above is enough.

  return {
    caseId: openCase.id,
    familyResponse,
    userAction,
    userText,
    introText: takeIntro(contact),
  };
}

function takeIntro(contact: FamilyContactRef): string | undefined {
  const phone = contact.phone.trim();
  if (!phone || introSent.has(phone)) return undefined;
  introSent.add(phone);
  const who = contact.name.trim() || "there";
  return (
    `Hi ${who}, this is ScamCheck. I help your family spot scams. ` +
    `I only say who was contacted and what kind of scam it was. I never send the original message. ` +
    `Reply here and I will pass it on. You can add other relatives too.`
  );
}

/** TODO: latest case for this family phone with no familyResponse yet, plus that contact's name. */
async function findOpenCaseForReply(familyPhone: string): Promise<FamilyLink | null> {
  void familyPhone;
  return null;
}

/** TODO: Gemini translate into the user's saved language. On failure, keep the reply as written. */
async function translateForUser(text: string, language: string): Promise<string> {
  void language;
  return text.replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim();
}

/** Placeholder phrase list. "I ordered that" marks the case confirmed_real. */
function saysItIsReal(text: string): boolean {
  return /\b(i ordered|it'?s real|that'?s real|this is real|confirmed real)\b/i.test(text);
}

function shortResponse(speaker: string, text: string): string {
  const line = `${speaker}: ${text}`.replace(/\s+/g, " ").trim();
  return line.length <= RESPONSE_MAX ? line : line.slice(0, RESPONSE_MAX);
}
