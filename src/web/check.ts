// POST /api/check: the same pipeline a forwarded iMessage gets (rules → Gemini → banned-word scrub),
// exposed for VEYZL audits. Bearer-protected so the public can't spend Gemini credits.
// Stateless: no case is stored and message text is never logged (AGENTS.md §14).
import { timingSafeEqual } from "node:crypto";
import { analyze } from "../core/analyze.js";
import { alertCopy } from "../core/notify.js";

const MAX_TEXT = 4000;

export function checkAuditToken(authorization: string | undefined): boolean {
  const secret = process.env.VEYZL_AUDIT_TOKEN;
  const given = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!secret || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Accept the common chat shapes: { text }, { message }, { prompt }, { input }, or OpenAI-style { messages }. */
export function checkText(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const body = payload as Record<string, unknown>;
  for (const key of ["text", "message", "prompt", "input"]) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, MAX_TEXT);
  }
  if (Array.isArray(body.messages)) {
    const last = body.messages.at(-1) as { content?: unknown } | undefined;
    if (typeof last?.content === "string" && last.content.trim()) return last.content.trim().slice(0, MAX_TEXT);
  }
  return "";
}

export async function runCheck(payload: unknown): Promise<{ status: number; body: object }> {
  const text = checkText(payload);
  if (!text) return { status: 400, body: { error: "Send the message to check as { \"text\": \"...\" }." } };
  const requested = (payload as { language?: unknown }).language;
  const language = typeof requested === "string" && /^[a-z]{2}$/.test(requested) ? requested : "en";

  const result = await analyze({ source: "imessage", text, links: [] }, { language, recentCaseSummaries: [] });
  return {
    status: 200,
    body: {
      reply: alertCopy(result, result.risk_score < 40),
      verdict: result.verdict,
      risk_score: result.risk_score,
      scam_type: result.scam_type,
      red_flags: result.red_flags,
      action: result.action,
      spoken_summary: result.spoken_summary,
    },
  };
}
