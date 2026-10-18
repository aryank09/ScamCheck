import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { loadConfig } from "../src/config.js";
import { collectEvidence, rulesFloor } from "../src/core/evidence.js";

const fixtureSchema = z.object({
  id: z.string().min(1),
  expectHighFinding: z.boolean(),
  expectCodes: z.array(z.string()).default([]),
  /** Fixtures that share a pair must all be high. Used for the same scam hitting two people. */
  pair: z.string().min(1).optional(),
  message: z.object({
    source: z.enum(["email", "imessage", "whatsapp"]),
    from: z.string().optional(),
    replyTo: z.string().optional(),
    subject: z.string().optional(),
    displayName: z.string().optional(),
    text: z.string(),
    html: z.string().optional(),
    links: z.array(z.object({ visibleText: z.string(), href: z.string() })).default([]),
    authenticationResults: z.string().optional(),
    seenSenderBefore: z.boolean().optional(),
  }),
});

type Fixture = z.infer<typeof fixtureSchema>;

const fixturesDir = resolve("tests/fixtures");

async function main(): Promise<void> {
  const fixtures = await loadFixtures();
  let caught = 0;
  let missed = 0;
  let falseAlarms = 0;
  const problems: string[] = [];
  const pairs = new Map<string, { total: number; caught: number; ids: string[] }>();

  for (const fixture of fixtures) {
    const findings = collectEvidence(fixture.message);
    const hasHigh = findings.some((finding) => finding.severity === "high");
    const codes = new Set(findings.map((finding) => finding.code));
    const missingCodes = fixture.expectCodes.filter((code) => !codes.has(code));
    const floor = rulesFloor(findings);

    const passed = fixture.expectHighFinding && hasHigh && missingCodes.length === 0 && floor >= 75;
    if (fixture.pair) {
      const state = pairs.get(fixture.pair) ?? { total: 0, caught: 0, ids: [] };
      state.total += 1;
      state.ids.push(fixture.id);
      if (passed) state.caught += 1;
      pairs.set(fixture.pair, state);
    }

    if (passed) {
      caught += 1;
      console.log(`caught  ${fixture.id}  ${summarize(findings)}`);
    } else if (fixture.expectHighFinding || missingCodes.length > 0) {
      missed += 1;
      problems.push(
        `missed  ${fixture.id}  high=${hasHigh} floor=${floor} missing=${missingCodes.join(",") || "-"}  ${summarize(findings)}`,
      );
    } else if (hasHigh) {
      falseAlarms += 1;
      problems.push(`false   ${fixture.id}  ${summarize(findings)}`);
    } else {
      console.log(`clear   ${fixture.id}  ${summarize(findings)}`);
    }
  }

  for (const [pair, state] of pairs) {
    if (state.total < 2 || state.caught !== state.total) {
      problems.push(`pair ${pair} caught ${state.caught}/${state.total} (${state.ids.join(", ")})`);
    } else {
      console.log(`pair    ${pair}  ${state.ids.join(" + ")}`);
    }
  }

  console.log("");
  console.log(`caught ${caught}  missed ${missed}  false alarms ${falseAlarms}  total ${fixtures.length}`);

  const config = loadConfig();
  if (config.GEMINI_API_KEY) {
    const { analyze } = await import("../src/core/analyze.js");
    console.log("\nGemini verdicts:");
    for (const fixture of fixtures) {
      const result = await analyze(fixture.message);
      const hasHigh = result.findings.some((finding) => finding.severity === "high");
      console.log(
        `${fixture.id}  verdict=${result.verdict}  score=${result.risk_score}  floor=${result.rulesFloor}`,
      );
      if (hasHigh && result.risk_score < 75) {
        problems.push(`${fixture.id} high finding scored ${result.risk_score}, under the floor of 75`);
      }
    }
  } else {
    console.log("Gemini skipped (no GEMINI_API_KEY).");
  }

  if (problems.length > 0) {
    console.error("\nProblems:");
    for (const problem of problems) console.error(problem);
    process.exit(1);
  }
}

async function loadFixtures(): Promise<Fixture[]> {
  const names = (await readdir(fixturesDir)).filter((name) => name.endsWith(".json")).sort();
  if (names.length === 0) throw new Error(`no fixtures in ${fixturesDir}`);
  const fixtures: Fixture[] = [];
  for (const name of names) {
    const raw = JSON.parse(await readFile(resolve(fixturesDir, name), "utf8")) as unknown;
    const parsed = fixtureSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`${name} is not a valid fixture: ${parsed.error.message}`);
    }
    fixtures.push(parsed.data);
  }
  return fixtures;
}

function summarize(findings: { severity: string; code: string }[]): string {
  if (findings.length === 0) return "(no findings)";
  return findings.map((finding) => `${finding.severity}:${finding.code}`).join(", ");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
