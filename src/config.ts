import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const envSchema = z.object({
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).default("gemini-3.8-flash"),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | undefined;

/** Load a local `.env` when present. Existing process env wins. */
function loadDotEnv(): void {
  const path = resolve(".env");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function loadConfig(): AppConfig {
  if (cached) return cached;
  loadDotEnv();
  cached = envSchema.parse({
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || undefined,
    GEMINI_MODEL: process.env.GEMINI_MODEL || undefined,
  });
  return cached;
}
