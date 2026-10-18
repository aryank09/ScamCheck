import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { scrubBannedWords } from "./bannedWords.js";
import { collectEvidence, rulesFloor } from "./evidence.js";
import { redactForModel } from "./guardrails.js";
import { buildAnalysisPrompt } from "./prompt.js";
import type { AnalysisImage } from "./images.js";
import type { AnalysisContext, AnalysisResult, Finding, ParsedMessage, Verdict } from "./types.js";

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

const DEFAULT_CONTEXT: AnalysisContext = {
  language: "en",
  recentCaseSummaries: [],
};

export async function analyze(
  message: ParsedMessageInput,
  context: AnalysisContext = DEFAULT_CONTEXT,
  image?: AnalysisImage,
): Promise<AnalysisResult> {
  const findings = collectEvidence(message);
  const config = loadConfig();
  if (!config.GEMINI_API_KEY) {
    return analysisWithoutModel(message);
  }

  // Rules ran on the original; the model never sees card or Social Security numbers.
  const forModel = {
    ...message,
    text: redactForModel(message.text),
    ...(message.html ? { html: redactForModel(message.html) } : {}),
    ...(message.subject ? { subject: redactForModel(message.subject) } : {}),
  };
  const prompt = buildAnalysisPrompt(forModel, findings, context, Boolean(image));
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const verdict = await requestVerdict(config.GEMINI_API_KEY, config.GEMINI_MODEL, prompt, image);
      return combine(verdict, findings, false);
    } catch (error) {
      lastError = error;
    }
  }
  console.error("Gemini verdict failed after one retry:", errorMessage(lastError));
  return combine(fallbackVerdict(findings), findings, true);
}

/** Score from the rules only. Used when Gemini is unavailable, and by tests. */
export function analysisWithoutModel(message: ParsedMessage): AnalysisResult {
  const findings = collectEvidence(message);
  return combine(fallbackVerdict(findings), findings, true);
}

type ParsedMessageInput = Parameters<typeof collectEvidence>[0];

async function requestVerdict(
  apiKey: string,
  model: string,
  prompt: string,
  image?: AnalysisImage,
): Promise<Verdict> {
  const ai = new GoogleGenAI({ apiKey });
  const input = image
    ? [
        { type: "text" as const, text: prompt },
        { type: "image" as const, data: image.data.toString("base64"), mime_type: image.mimeType },
      ]
    : prompt;
  const interaction = await ai.interactions.create(
    {
      model,
      input,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: VERDICT_JSON_SCHEMA,
      },
      store: false,
      stream: false,
    },
    { timeout: GEMINI_TIMEOUT_MS, maxRetries: 0 },
  );
  if (interaction.status === "failed" || interaction.status === "cancelled") {
    throw new Error(`gemini interaction ${interaction.status}`);
  }
  const parsed = verdictSchema.parse(parseJsonObject(textFromInteraction(interaction.output_text)));
  return {
    ...parsed,
    risk_score: Math.round(parsed.risk_score),
    red_flags: parsed.red_flags.slice(0, 3),
    claimed_brand: parsed.claimed_brand,
  };
}

function textFromInteraction(output: string | undefined): string {
  const text = (output ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!text) throw new Error("gemini returned no text");
  return text;
}

function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("gemini response was not JSON");
  return JSON.parse(text.slice(start, end + 1));
}

function combine(verdict: Verdict, findings: Finding[], modelFailed: boolean): AnalysisResult {
  const floor = rulesFloor(findings);
  const risk_score = Math.max(floor, modelFailed ? 0 : clampScore(verdict.risk_score));
  const scrubbed = scrubVerdict(verdict);
  return {
    ...scrubbed,
    verdict: floor >= 75 && scrubbed.verdict === "no_red_flags" ? "scam" : scrubbed.verdict,
    risk_score,
    findings,
    rulesFloor: floor,
    modelFailed,
  };
}

function fallbackVerdict(findings: Finding[]): Verdict {
  const highs = findings.filter((finding) => finding.severity === "high").slice(0, 3);
  if (highs.length === 0) {
    return {
      verdict: "suspicious",
      risk_score: 0,
      scam_type: "unconfirmed",
      claimed_brand: null,
      red_flags: ["The automatic check did not finish. Treat this with caution."],
      spoken_summary: "I could not finish checking this message. Please do not click links or share codes.",
      action: "Confirm with the company using a number you already trust.",
      case_summary: "Automatic check failed, so nothing was sent.",
      matches_recent_case: false,
    };
  }
  return {
    verdict: "scam",
    risk_score: 0,
    scam_type: "impersonation",
    claimed_brand: null,
    red_flags: highs.map((finding) => finding.detail),
    spoken_summary: "This message has a clear warning sign. Please do not click links or share codes.",
    action: "Confirm with the company using a number you already trust.",
    case_summary: "Automatic check failed, but a high-risk pattern was already found.",
    matches_recent_case: false,
  };
}

function scrubVerdict(verdict: Verdict): Verdict {
  return {
    ...verdict,
    scam_type: scrubBannedWords(verdict.scam_type),
    claimed_brand: verdict.claimed_brand ? scrubBannedWords(verdict.claimed_brand) : null,
    red_flags: verdict.red_flags.map(scrubBannedWords),
    spoken_summary: scrubBannedWords(verdict.spoken_summary),
    action: scrubBannedWords(verdict.action),
    case_summary: scrubBannedWords(verdict.case_summary),
  };
}

function clampScore(score: number): number {
  if (Number.isNaN(score)) return 0;
  return Math.min(100, Math.max(0, Math.round(score)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
