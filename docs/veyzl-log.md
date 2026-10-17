# VEYZL Audit Log

Running record of VEYZL findings and the changes they triggered.
Required for the Best Use of VEYZL track: evidence that findings changed the build.

Format for each entry:
- **Finding** - exact VEYZL output or summary
- **Impact** - why it mattered for ScamCheck
- **Fix** - what we changed
- **PR** - link to the pull request that landed the fix
- **Date** - 10-17-26

---

## Expected areas (pre-audit notes)

These are the controls we expect VEYZL to flag, based on the project’s privacy & safety requirements (section 14 of the context doc). We will replace these with real findings once the repo is ready for PR audits.

### 1. Data minimization / raw content storage
- **Finding (expected):** System processes email and message content but must not persist raw bodies, transcripts, or media.
- **Impact:** Violates data-minimization and retention controls (EU AI Act, ISO 42001).
- **Fix (planned):** Cases store only summary, verdict, scam type, and domain — never raw text, images, or audio. Media deleted after analysis. Documented in `src/db/cases.ts` and `src/email/parse.ts`.
- **PR:** TBD
- **Status:** Planned

### 2. Human oversight on high-risk actions
- **Finding (expected):** High-risk decisions (outbound calls, family alerts) lack a clear human-in-the-loop path.
- **Impact:** NIST AI RMF and EU AI Act expect human oversight for consequential automated actions.
- **Fix (planned):** Family relay is the explicit human oversight mechanism. User and family member can confirm, override, or mark “real.” Logged in `familyRelay.ts` and case `familyResponse` / `userAction` fields.
- **PR:** TBD
- **Status:** Planned

### 3. Inbox access scope & consent
- **Finding (expected):** Gmail access is read-only but consent and purpose limitation must be explicit.
- **Impact:** Access to personal email requires clear consent and minimal scope.
- **Fix (planned):** OAuth scope is `gmail.readonly` only. Onboarding requires explicit “YES” consent text. `STOP` command revokes token and deletes Gmail fields. Documented in `src/email/oauth.ts` and onboarding flow.
- **PR:** TBD
- **Status:** Planned

### 4. Prompt injection / untrusted input
- **Finding (expected):** User-supplied message content is passed to the LLM.
- **Impact:** Risk of instruction override.
- **Fix (planned):** Analysis prompt explicitly treats message content as untrusted data and forbids following instructions inside it. Rule-based floor prevents the model from overriding clear high-severity findings.
- **PR:** TBD
- **Status:** Planned

---

## Real findings (filled as audits run)

<!-- Paste actual VEYZL check-run findings here once PRs start triggering audits. -->
