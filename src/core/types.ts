export type MessageSource = "email" | "imessage" | "whatsapp";

export type FindingSeverity = "high" | "medium" | "low";

export interface Finding {
  code: string;
  severity: FindingSeverity;
  detail: string;
}

export interface MessageLink {
  visibleText: string;
  href: string;
}

/** Email or a forwarded text. Bodies stay in memory; callers must not persist them. */
export interface ParsedMessage {
  source: MessageSource;
  from?: string;
  replyTo?: string;
  subject?: string;
  displayName?: string;
  text: string;
  html?: string;
  links: MessageLink[];
  authenticationResults?: string;
  seenSenderBefore?: boolean;
}

export type VerdictLabel = "scam" | "suspicious" | "no_red_flags";

/** Section 9 verdict. `risk_score` is already combined with the rules floor. */
export interface Verdict {
  verdict: VerdictLabel;
  risk_score: number;
  scam_type: string;
  claimed_brand: string | null;
  red_flags: string[];
  spoken_summary: string;
  action: string;
  case_summary: string;
  matches_recent_case: boolean;
}

export interface AnalysisContext {
  language: string;
  recentCaseSummaries: string[];
}

export interface AnalysisResult extends Verdict {
  findings: Finding[];
  rulesFloor: number;
  /** True when Gemini did not run or both attempts failed. The score is then the rules floor only. */
  modelFailed: boolean;
}
