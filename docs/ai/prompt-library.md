# AI prompt library

Ten reusable prompts for AI-assisted QA work on this framework. Copy a prompt, fill the
`{placeholders}`, and give it to the agent. Every prompt inherits the rules of
[AGENTS.md](../../AGENTS.md) (the agent reads it automatically in Claude Code; paste it otherwise).
Results are reviewed with [test-quality-gates.md](test-quality-gates.md) before they are accepted.

**Shared constraints (apply to every prompt):** Gherkin + Cucumber is the only test definition (no
`*.spec.ts`); one worker, no retries; never weaken an assertion or hide a defect; known-defect
proofs stay intact; Sanity is manual only; no Jenkins/Docker/`.github` changes; synthetic data only
and no sensitive values in any output; no commits or pushes. State uncertainty instead of guessing,
and cite file paths and lines as evidence.

---

## 1. Scenario design

**Purpose:** derive risk-based scenarios from a user story.
**Inputs:** `{user story}`, `{acceptance criteria}`, optional `{known business rules or defects}`.

> Design scenarios for {user story} with acceptance criteria {criteria}. First list the existing
> scenarios in `features/` that already cover any criterion. Then propose only the missing
> positive, negative and boundary scenarios. For each: business rule covered, partition or
> boundary value and why, Impact (H/M/L) × Likelihood (H/M/L), proposed priority and suite tags per
> docs/test-suites.md "Selection criteria", and the business oracle (which persisted state proves
> it). Drop any scenario whose mechanism a stronger existing scenario already proves, and say so.

**Output:** a table (criterion → scenario → partition/boundary → oracle → priority/suites), plus
the rejected candidates with reasons.
**Acceptance:** every criterion is traced; each scenario can fail when the behavior is wrong;
boundaries use the exact edge and the value just outside it; no duplicates of existing coverage.

## 2. Locator discovery

**Purpose:** stable locators for a page or element.
**Inputs:** `{page URL or Page Object}`, `{elements needed}`.

> For {elements} on {page}, recommend locators in this order: getByRole with accessible name,
> getByText for stable business text, then a stable id/name attribute. ParaBank has no labels,
> test ids or aria-labels (AGENTS.md), so do not propose getByLabel/getByTestId unless you show
> the markup now supports them. Never XPath, nth-child or layout CSS. For each locator give the
> markup evidence, why it is unique, and how it could break.

**Output:** element → locator → evidence → uniqueness → fragility notes.
**Acceptance:** each locator resolves to exactly one element on the real QA page; no forbidden
patterns (`npm run lint` passes once used).

## 3. BDD test generation

**Purpose:** implement approved scenarios in the existing architecture.
**Inputs:** `{approved scenarios}` (from prompt 1), `{target feature file}`.

> Implement {scenarios} in {feature file}. Reuse existing steps first (list the ones reused, found
> with `npm run test:dry-run` and grep). Add new steps only to the domain step file, thin, with
> business assertions on persisted state; selectors and actions only in src/pages; data only from
> src/factories. Use web-first assertions (`expect` from src/support/assertions.ts, which carries
> the configured timeout) and actions that wait for the bank's answer; never a sleep or a fixed
> timeout. Tag each scenario with one area, one priority and the approved suite tags. Do
> not create any Playwright spec. Then run the mandatory validation in AGENTS.md and report it.

**Output:** the diff, the list of reused vs new steps, validation commands with real results.
**Acceptance:** dry run passes with no undefined/ambiguous steps; lint, typecheck, `ci:bdd` and
`audit:test-data` pass; suite counts change only as approved; the new scenarios pass on QA.

## 4. Test review

**Purpose:** find defects in tests before they are trusted.
**Inputs:** `{diff, files or feature}`.

> Review {target} against docs/ai/test-quality-gates.md. Report, with file:line: missing awaits,
> assertions that cannot fail or check only page text where state matters, hard waits or
> arbitrary timeouts, brittle selectors, duplicated coverage, steps that hide failures (try/catch,
> optional checks), false-positive risks, data shared between scenarios, and any sensitive value
> that could reach evidence. Rank findings by severity; propose the smallest fix for each.

**Output:** findings (severity, file:line, evidence, fix); the 14-criterion checklist result.
**Acceptance:** every finding is reproducible from the cited code; no style-only noise.

## 5. Flaky-test investigation

**Purpose:** root cause of an intermittent failure.
**Inputs:** `{scenario}`, `{failing and passing run evidence}` (the failure record
`reports/<env>/<suite>/failures/<scenario>-<id>.json` with its step and request timeline, the
masked screenshot, JUnit, `NET_DIAG` output), `{environment state}`. A full Playwright trace is a
local-only input (`PW_TRACE_ON_FAILURE=true`); never paste its contents.

> Investigate why {scenario} fails intermittently. Classify first with docs/failure-triage.md.
> Compare failing and passing evidence; identify the exact step, the state the test assumed and
> the state that existed. Check synchronization (did the action wait for the bank's answer?),
> data collisions, environment health and concurrency. Propose a fix only for a proven cause.
> Retries, longer timeouts and weaker assertions are not fixes.

**Output:** classification, evidence chain, root cause (or "insufficient evidence" + what to
collect next), minimal fix.
**Acceptance:** the cause explains both failing and passing runs; the fix keeps the assertion.

## 6. Page Object review

**Purpose:** improve maintainability or reliability of `src/pages` only where it pays.
**Inputs:** `{Page Object files}`.

> Review {files}. Flag duplicated locators, actions that do not wait for the bank's answer,
> locators below the preferred order, assertions or business logic in the Page Object, and dead
> members. Propose refactors only with a concrete reliability or maintenance gain; no base
> classes, generic wrappers or new layers.

**Output:** findings with gain per change; refactor diff if approved.
**Acceptance:** behavior unchanged (impacted scenarios pass on QA); no new abstraction layer.

## 7. Test-data generation

**Purpose:** synthetic datasets for valid, invalid and boundary inputs.
**Inputs:** `{field or rule}`, `{schema limits}` (docs/test-data.md, docs/functional-coverage.md).

> Produce valid, invalid and boundary values for {field/rule}: minimum, maximum, just outside each,
> empty, whitespace-only, wrong type, and format edge cases. Mark which belong in a Scenario
> Outline (business input) and which must come from the allocator (src/factories/test-data.ts,
> unique per scenario). Use only synthetic values (fictional 555-01xx phones, 000-area SSNs,
> `qa…` usernames); a repeated input must be registered in scripts/audit-test-data.ts.

**Output:** value → partition → expected result → source (Examples vs factory).
**Acceptance:** no real personal data; `npm run audit:test-data` passes.

## 8. API coverage assessment

**Purpose:** decide whether an API-level check would close a real gap.
**Inputs:** `{business area}`, current coverage (docs/functional-coverage.md).

> For {area}, list the risks UI scenarios cannot observe cheaply. The suite already verifies
> persisted state through src/api/parabank-client.ts (the endpoints the UI itself calls). Propose
> an API check only where it covers a rule not already proven, explain why the UI layer cannot,
> and implement it as a Gherkin scenario using the existing client. No new framework or runner.
> The client already fails on any non-2xx status; assert response schema or response time only
> when a requirement states one (none does today; runtime contracts were closed with #13).

**Output:** gap → evidence → proposal or "no gap" with reasoning.
**Acceptance:** no business rule ends up asserted twice without a reason.

## 9. CI/CD review

**Purpose:** review Jenkins execution and reporting, read-only.
**Inputs:** `Jenkinsfile`, docs/ci-cd.md, `{build evidence}`.

> Review how {pipeline aspect} runs and reports. Check: one worker, no retries, suite size checks,
> Sanity only on manual parameter, known defects never gating, queue-level serialization and
> duplicate-build prevention intact, no sensitive data in archived artifacts. Report findings and
> recommendations only; do not edit the Jenkinsfile, Jenkins or Docker, and do not propose GitHub
> Actions or parallel stages. Also check that the evidence scan runs before JUnit and the archive,
> that failed scenarios leave their failure record and that no Playwright trace is produced.

**Output:** findings with evidence and recommendations, each marked "needs approval".
**Acceptance:** no file changed; every claim cites the Jenkinsfile line or build record.

## 10. Failure explanation

**Purpose:** explain one failure for a defect report or triage.
**Inputs:** the failure record (`failures/<scenario>-<id>.json`: failed step, error, expected and
actual, project stack frames, environment, build, timeline), `{scenario}`, `{suite and
environment}`.

> Explain the failure of {scenario}. Classify it with docs/failure-triage.md; quote the failing
> step and the redacted error; state expected vs actual business outcome; for a known-defect
> scenario say whether it failed through its registered proof. Give the root cause or the missing
> evidence, the corrective action, and who owns it (product, automation, environment).

**Output:** classification, evidence, root cause, action, owner.
**Acceptance:** no sensitive value reproduced; a product defect is never reported as a test fix.
