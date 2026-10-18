// Same expectations as `npm run fixtures`, so a rule change that misses a scam or
// raises a false alarm fails `npm test`.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { collectEvidence } from "../src/core/evidence.js";

type FixtureMessage = Parameters<typeof collectEvidence>[0];

describe("scams have a high finding and real mail does not", () => {
  const dir = "tests/fixtures";
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const fixture = JSON.parse(readFileSync(`${dir}/${file}`, "utf8")) as {
      expectHighFinding: boolean;
      expectCodes?: string[];
      message: FixtureMessage;
    };
    it(file, () => {
      const findings = collectEvidence({ ...fixture.message, links: fixture.message.links ?? [] });
      assert.equal(
        findings.some((finding) => finding.severity === "high"),
        fixture.expectHighFinding,
      );
      for (const code of fixture.expectCodes ?? []) {
        assert.ok(findings.some((finding) => finding.code === code), `missing ${code}`);
      }
    });
  }
});
