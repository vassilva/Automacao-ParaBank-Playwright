# Failure triage

Every red scenario is classified **before** anything is changed. A fix without a proven root cause
is not accepted, and retries, longer timeouts or weaker assertions are never fixes (one worker,
`retries: 0`, see AGENTS.md). History of real classifications: docs/qa-coverage.md and
docs/defects.md ("Other findings").

## 1. Classify

Work top-down: the first class whose signal matches is usually the answer, but confirm it with the
evidence listed.

| Class                            | Typical signal in this framework                                                                                                                                                                     | Confirm with                                                                                                                       | Owner                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **Environment issue**            | `TARGET UNAVAILABLE` from the Playwright preflight; `Target validation failed` from `npm run check:target`; `ECONNREFUSED` in many scenarios at once; an "Environment instability … edge proxy" note | `npm run qa:health` / `uat:health`, `npm run env:identity` (QA and UAT on the same image), `npm run qa:status`                     | Environment            |
| **Infrastructure or dependency** | Failure before any scenario: `npm ci`, browser launch, agent image, Docker, Jenkins stage outside the test stages                                                                                    | Jenkins stage log, `npx playwright --version`, `npm ls`; the same commit green elsewhere                                           | CI / platform          |
| **Application defect**           | A `Then` step fails on an assertion (`OutcomeCheckFailure` or `expect`) with a healthy target; reproducible on a fresh customer                                                                      | Re-run the single scenario; compare with docs/functional-coverage.md (the rule) and docs/defects.md (already known?)               | Product (report PB-xx) |
| **Automation defect**            | `Given`/`When` step fails: locator not found, strict-mode violation (two matches), undefined/ambiguous step, `TypeError`, a missing fact from `requireValue`                                         | Same failure on the unchanged image ID? The page markup (`curl` the page) vs the Page Object; `git log` of the test code           | Automation             |
| **Test-data issue**              | Registration refused ("This username already exists."), login recovery fails for a customer (shared SSN, PB-15), `audit:test-data` failure                                                           | `TEST_DATA_AUDIT=true` fingerprints (unique per scenario?), `.test-data/ssn-cursor-<env>.json` present, database age (redeployed?) | Automation             |
| **Synchronization issue**        | Timeout waiting for an element that appears in the failure screenshot; passes on an immediate single re-run                                                                                          | `NET_DIAG=true` (did the response arrive?); does the action wait for its response or rendered answer (`waitForResponse`, `or()`)?  | Automation             |
| **Insufficient evidence**        | None of the above can be confirmed                                                                                                                                                                   | Collect more (section 3); do not change code yet                                                                                   | Whoever reproduces it  |

A failure that is not the first one in the run is often a consequence: fix the earliest
environment or data cause first, then re-run.

## 2. Known-defect scenarios

`npm run test:known-defects` judges each `@known-defect` scenario through its registered proof
(`playwright/known-defect-proofs.ts`):

| Message                                                     | Meaning                                                                       | Action                                                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `PB-xx reproduced through "<check>"` (expected failure)     | The defect still exists, proven by its outcome check                          | None                                                                                            |
| `PB-xx no longer reproduces`                                | The scenario passed: the product may be fixed                                 | Verify the fix on the image, then remove `@known-defect`/`@PB-xx` and classify (needs approval) |
| `Known-defect scenario did not fail through the proof of …` | It failed, but not on its proof (setup, action, transport, hook, other check) | Classify with section 1; this is **not** a reproduction and must not be ignored                 |

Native `cucumber-js --profile known-defects` shows all of them red; only the Playwright adapter
distinguishes the three cases.

## 3. Collect evidence safely

Evidence is redacted by default (`src/support/evidence.ts`, `playwright/redacting-reporter.ts`);
failure screenshots mask credential and identity fields. **In Jenkins**, open the failed build:

- **Tests** (JUnit): the failed scenario and its assertion message;
- **Artifacts** → `reports/<qa|uat>/<suite>/failures/`: `<scenario>-<id>.json` (failed step,
  error, expected/actual, stack frames, environment, browser, build, timeline) and `.png` (masked
  screenshot); `cucumber-report.html` in the same folder shows them per scenario;
- **Console**: `EVIDENCE SCAN` lines; a file listed as `SENSITIVE` was removed before publishing
  and the build failed for that reason too.

| Need                      | How                                                                 | Sensitive-data note                                                                |
| ------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| One scenario, visible     | `$env:HEADLESS='false'; npm test -- features/<file>.feature:<line>` | Local only                                                                         |
| Request accounting        | `$env:NET_DIAG='true'` → `reports/network-diagnostics.jsonl`        | Redacted; safe to share                                                            |
| Generated data uniqueness | `$env:TEST_DATA_AUDIT='true'` → `reports/test-data-audit.json`      | HMAC fingerprints only                                                             |
| Full trace                | `$env:PW_TRACE_ON_FAILURE='true'` → `reports/traces/`               | **Contains passwords, cookies, request bodies; local only, never attach or share** |
| Environment state         | `npm run qa:status`, `npm run env:identity`                         | Safe                                                                               |

Do not enable traces or extra capture in CI.

## 4. Record

In the PR or defect report: class, failing step and redacted error, expected vs actual business
outcome, evidence used, root cause (or what is still missing), corrective action and owner. Never
paste a credential, SSN, session id, cookie or trace content; describe it instead.
