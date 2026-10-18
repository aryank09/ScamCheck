// Server tools the ElevenLabs agent calls mid-call (configured in agentPrompt.md).
// Route: POST /voice/tools/:name → checkToolSecret(header) → voiceTools[name](body) → 200 JSON.
import { timingSafeEqual } from "node:crypto";
// ponytail: assumed signatures from teammates' modules; adjust here if theirs differ.
import { findUserByPhone } from "../db/users.js";
import { createCase, findCaseById, updateCase, listRecentCases } from "../db/cases.js";
import { alertFamily } from "../core/familyRelay.js";

interface ToolBody {
  caller_id?: string;
  called_number?: string;
  case_id?: string;
  verdict?: "scam" | "suspicious" | "no_red_flags";
  risk_score?: number;
  scam_type?: string;
  summary?: string;
  user_action?: "paid" | "clicked" | "ignored" | "none";
}

export function checkToolSecret(header: string | undefined): boolean {
  const secret = process.env.VOICE_TOOL_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Inbound: the user is the caller. Outbound: the user is the called number.
async function userFor(body: ToolBody) {
  for (const phone of [body.caller_id, body.called_number]) {
    if (!phone) continue;
    const user = await findUserByPhone(phone);
    if (user) return user;
  }
  return null;
}

const realCaseId = (id?: string) => (id && id !== "none" ? id : undefined);

async function ownedCase(id: string | undefined, userId: { toString(): string }) {
  const real = realCaseId(id);
  if (!real) return null;
  const found = await findCaseById(real);
  if (!found || found.userId.toString() !== userId.toString()) return null;
  return found;
}

export const voiceTools: Record<string, (body: ToolBody) => Promise<object>> = {
  async get_user_context(body) {
    const user = await userFor(body);
    if (!user) return { known_user: false, note: "New caller. Ask their preferred language." };

    const cases = await listRecentCases({ userId: user._id, familyGroupId: user.familyGroupId, days: 7 });
    const recent = cases.slice(0, 5).map((c) => ({
      case_id: String(c._id),
      mine: String(c.userId) === String(user._id),
      source: c.source,
      verdict: c.verdict,
      scam_type: c.scamType,
      brand: c.claimedBrand ?? null,
      summary: c.summary,
      when: c.createdAt,
    }));
    const pending = recent.find((c) => c.mine && c.verdict !== "no_red_flags") ?? null;

    return {
      known_user: true,
      name: user.displayName ?? null,
      language: user.language,
      has_family_contact: user.familyContacts.length > 0,
      pending_flagged_item: pending,
      recent_cases: recent,
    };
  },

  async record_case(body) {
    const user = await userFor(body);
    if (!user) return { ok: false, note: "Unknown caller; not recorded." };

    const userAction = body.user_action && body.user_action !== "none" ? body.user_action : undefined;
    const existing = realCaseId(body.case_id);
    if (existing) {
      const found = await ownedCase(existing, user._id);
      if (!found) return { ok: false, note: "That case is not this caller's." };
      // Outbound call about an existing case: only record what changed.
      await updateCase(String(found._id), { userAction, notifiedVia: "call" });
      return { ok: true, case_id: String(found._id) };
    }

    const id = await createCase({
      userId: user._id,
      familyGroupId: user.familyGroupId,
      source: "call",
      verdict: body.verdict ?? "suspicious",
      riskScore: body.risk_score ?? 50,
      scamType: body.scam_type ?? "unknown",
      summary: body.summary ?? "",
      notifiedVia: ["call"],
      familyAlerted: false,
      userAction,
      latencyMs: 0,
    });
    return { ok: true, case_id: String(id) };
  },

  async alert_family(body) {
    const user = await userFor(body);
    if (!user) return { ok: false, note: "Unknown caller." };
    if (user.familyContacts.length === 0) return { ok: false, note: "No family contact saved." };
    const caseId = realCaseId(body.case_id);
    if (caseId && !(await ownedCase(caseId, user._id))) return { ok: false, note: "That case is not this caller's." };
    await alertFamily(user, { scamType: body.scam_type ?? "possible scam", caseId });
    return { ok: true };
  },
};
