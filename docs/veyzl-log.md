# VEYZL Audit Log

Running record of VEYZL findings and the changes they triggered.
Required for the Best Use of VEYZL track: evidence that findings changed the build.

Format for each entry:
- **Finding** — exact VEYZL output or summary
- **Impact** — why it mattered for ScamCheck
- **Fix** — what we changed
- **PR** — link to the pull request that landed the fix
- **Date** — 10-17-26

These four entries are expected controls from the privacy rules. They are not audit results. Real check-run output goes in the section at the bottom.

---

## Expected areas

### 1. Data minimization
- **Finding (expected):** Email and message content is read in memory and must not be stored.
- **Impact:** Retention of raw bodies, transcripts, or media breaks data minimization (EU AI Act, ISO 42001).
- **Fix:** `src/db/cases.ts` stores a short summary, verdict, scam type, and sender domain. Links and long numbers are stripped from the summary before insert. Raw email, text, images, audio, and transcripts are not fields on a case.
- **PR:** https://github.com/Se9uencer/ScamCheck/pull/4
- **Date:** 10-17-26
- **Status:** Landed, awaiting audit

### 2. Human oversight
- **Finding (expected):** Outbound calls and family alerts are consequential and need a person who can override them.
- **Impact:** NIST AI RMF and the EU AI Act expect human oversight on automated actions that affect someone else.
- **Fix:** Family alerts (`src/core/familyRelay.ts`) name who was contacted and the scam type only. The original message is never included. A reply can be saved on the case as `familyResponse` or `userAction` (`confirmed_real`).
- **PR:** https://github.com/Se9uencer/ScamCheck/pull/4
- **Date:** 10-17-26
- **Status:** Alert content landed; reply relay still open

### 3. Inbox access and consent
- **Finding (expected):** Gmail access must be read-only, purpose-limited, and tied to explicit consent.
- **Impact:** Reading personal email without a stated purpose and a way to revoke it is out of scope.
- **Fix (planned):** OAuth scope `gmail.readonly` only. Onboarding requires YES on the consent text. STOP revokes the token and deletes Gmail fields.
- **PR:** TBD
- **Date:** 10-17-26
- **Status:** Planned

### 4. Prompt injection
- **Finding (expected):** Untrusted message text is passed to the model and can try to override the verdict.
- **Impact:** A scam can instruct the model to call the message safe and hide a clear red flag.
- **Fix:** `src/core/prompt.ts` treats the message as untrusted data and forbids following instructions inside it. A high-severity rule finding sets a score floor of 75 (`src/core/evidence.ts`), so the model cannot undercut it. Verdict text, including the case summary, passes through the banned-word filter (`src/core/bannedWords.ts`) and cannot call a message safe, verified, legitimate, or official.
- **PR:** https://github.com/Se9uencer/ScamCheck/pull/4
- **Date:** 10-17-26
- **Status:** Landed, awaiting audit

---

## Real findings

<!-- Paste actual VEYZL check-run findings here once PRs start triggering audits. -->
