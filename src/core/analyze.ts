import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { collectEvidence, rulesFloor } from "./evidence.js";
import { buildAnalysisPrompt } from "./prompt.js";
import type { AnalysisContext, AnalysisResult, Finding, Verdict } from "./types.js";

const GEMINI_TIMEOUT_MS = 15_000;

const VERDICT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["scam", "suspicious", "no_red_flags"] },
    risk_score: { type: "integer", minimum: 0, maximum: 100 },
    scam_type: { type: "string" },
    claimed_brand: { type: ["string", "null"] },
    red_flags: { type: "array", items: { type: "string" }, maxItems: 3 },
    spoken_summary: { type: "string" },
    action: { type: "string" },
    case_summary: { type: "string" },
    matches_recent_case: { type: "boolean" },
  },
  required: [
    "verdict",
    "risk_score",
    "scam_type",
    "claimed_brand",
    "red_flags",
    "spoken_summary",
    "action",
    "case_summary",
    "matches_recent_case",
  ],
};

const verdictSchema = z.object({
  verdict: z.enum(["scam", "suspicious", "no_red_flags"]),
  risk_score: z.number().min(0).max(100),
  scam_type: z.string().min(1),
  claimed_brand: z.string().nullable(),
  red_flags: z.array(z.string()),
  spoken_summary: z.string().min(1),
  action: z.string().min(1),
  case_summary: z.string().min(1),
  matches_recent_case: z.boolean(),
});

const BANNED_WORDS: readonly [RegExp, string][] = [
  [/\bsafe\b/gi, "cautious"],
  [/\bverified\b/gi, "checked"],
  [/\bguaranteed\b/gi, "certain"],
  [/\blegitimate\b/gi, "real"],
  [/\bofficial\b/gi, "company"],
];

const DEFAULT_CONTEXT: AnalysisContext = {
  language: "en",
  recentCaseSummaries: [],
};

export async function analyze(
  message: ParsedMessageInput,
  context: AnalysisContext = DEFAULT_CONTEXT,
): Promise<AnalysisResult> {
  const findings = collectEvidence(message);
  const config = loadConfig();
  if (!config.GEMINI_API_KEY) {
    return combine(fallbackVerdict(), findings);
  }

  const prompt = buildAnalysisPrompt(message, findings, context);
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const verdict = await requestVerdict(config.GEMINI_API_KEY, config.GEMINI_MODEL, prompt);
      return combine(verdict, findings);
    } catch (error) {
      lastError = error;
    }
  }
  console.error("Gemini verdict failed after one retry:", errorMessage(lastError));
  return combine(fallbackVerdict(), findings);
}

type ParsedMessageInput = Parameters<typeof collectEvidence>[0];

async function requestVerdict(apiKey: string, model: string, prompt: string): Promise<Verdict> {
  const ai = new GoogleGenAI({ apiKey });
  const interaction = await ai.interactions.create(
    {
      model,
      input: prompt,
      response_format: VERDICT_JSON_SCHEMA,
      response_mime_type: "application/json",
      store: false,
      stream: false,
    },
    { timeout: GEMINI_TIMEOUT_MS, maxRetries: 0 },
  );
  if (interaction.status === "failed" || interaction.status === "cancelled") {
    throw new Error(`gemini interaction ${interaction.status}`);
  }
  const parsed = verdictSchema.parse(parseJsonObject(textFromInteraction(interaction.outputs)));
  return {
    ...parsed,
    risk_score: Math.round(parsed.risk_score),
    red_flags: parsed.red_flags.slice(0, 3),
    claimed_brand: parsed.claimed_brand,
  };
}

function textFromInteraction(outputs: { type: string; text?: string }[] | undefined): string {
  const text = (outputs ?? [])
    .filter((output) => output.type === "text" && typeof output.text === "string")
    .map((output) => output.text)
    .join("")
    .trim();
  if (!text) throw new Error("gemini returned no text");
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("gemini response was not JSON");
  return JSON.parse(text.slice(start, end + 1));
}

function combine(verdict: Verdict, findings: Finding[]): AnalysisResult {
  const floor = rulesFloor(findings);
  const risk_score = Math.max(floor, clampScore(verdict.risk_score));
  const scrubbed = scrubVerdict(verdict);
  return {
    ...scrubbed,
    verdict: floor >= 75 && scrubbed.verdict === "no_red_flags" ? "scam" : scrubbed.verdict,
    risk_score,
    findings,
    rulesFloor: floor,
  };
}

function fallbackVerdict(): Verdict {
  return {
    verdict: "suspicious",
    risk_score: 50,
    scam_type: "unconfirmed",
    claimed_brand: null,
    red_flags: ["The automatic check did not finish. Treat this with caution."],
    spoken_summary: "I could not finish checking this message. Please do not click links or share codes.",
    action: "Confirm with the company using a number you already trust.",
    case_summary: "Automatic check failed, so the message was left as suspicious.",
    matches_recent_case: false,
  };
}

function scrubVerdict(verdict: Verdict): Verdict {
  return {
    ...verdict,
    scam_type: scrubText(verdict.scam_type),
    red_flags: verdict.red_flags.map(scrubText),
    spoken_summary: scrubText(verdict.spoken_summary),
    action: scrubText(verdict.action),
    case_summary: scrubText(verdict.case_summary),
  };
}

function scrubText(text: string): string {
  let scrubbed = text;
  for (const [pattern, replacement] of BANNED_WORDS) {
    scrubbed = scrubbed.replace(pattern, replacement);
  }
  return scrubbed;
}

function clampScore(score: number): number {
  if (Number.isNaN(score)) return 0;
  return Math.min(100, Math.max(0, Math.round(score)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
