// AGENTS.md §14: never call a message safe/verified/guaranteed/legitimate/official.
// analyze.ts and the post-call follow-up both pass text through here.
// ponytail: English only; LLM prompts carry the rule for other languages.
const BANNED_WORDS: readonly [RegExp, string][] = [
  [/\bsafe\b/gi, "cautious"],
  [/\bverified\b/gi, "checked"],
  [/\bguaranteed\b/gi, "certain"],
  [/\blegitimate\b/gi, "real"],
  [/\bofficial\b/gi, "company"],
];

export function scrubBannedWords(text: string): string {
  let scrubbed = text;
  for (const [pattern, replacement] of BANNED_WORDS) scrubbed = scrubbed.replace(pattern, replacement);
  return scrubbed;
}
