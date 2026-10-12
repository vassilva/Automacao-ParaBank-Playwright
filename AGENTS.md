# Instructions for AI coding agents

This file is the **single authoritative instruction source** for any AI agent (Claude Code,
Copilot, Codex, Cursor, …) working in this repository. Tool-specific files only point here
(`CLAUDE.md`, `.github/copilot-instructions.md`). Humans follow the same rules; the details live in the linked documents, which win
over this summary if they ever disagree (then fix this file).

Read first: [README.md](README.md) (architecture, commands), [docs/test-suites.md](docs/test-suites.md)
(suite selection), [docs/defects.md](docs/defects.md) (known defects), [docs/test-data.md](docs/test-data.md).
Task prompts: [docs/ai/prompt-library.md](docs/ai/prompt-library.md). Review standard:
[docs/ai/test-quality-gates.md](docs/ai/test-quality-gates.md). Failures:
[docs/failure-triage.md](docs/failure-triage.md).

## Non-negotiable rules

1. **Cucumber is the only test definition.** Every test is a Gherkin scenario in `features/`.
   Never write `*.spec.ts` files or Playwright `test()` blocks for behavior; `playwright/` is an
   adapter that runs the Gherkin scenarios and contains no test logic.
2. **One worker, no retries, everywhere.** `workers: 1`, `CUCUMBER_PARALLEL=1`, `retries: 0`.
   ParaBank registration is not concurrency-safe (PB-20). Never add parallelism or retries. This is
   enforced: `cucumber.js` refuses `CUCUMBER_RETRY`/`CUCUMBER_PARALLEL` overrides and `--retry`/
   `--parallel`; `playwright/global-setup.ts` refuses `--workers` and `--retries`.
3. **Never weaken an assertion to get green.** No removed checks, looser matchers, longer
   timeouts or skipped steps to hide a failure. Find the root cause first
   ([docs/failure-triage.md](docs/failure-triage.md)).
4. **Known defects keep their proof.** A `@known-defect @PB-xx` scenario states the _correct_
   behavior and must fail through its registered outcome check
   (`playwright/known-defect-proofs.ts`). Do not change its oracle, its tags or its proof without
   evidence that the defect changed.
5. **Suites are policy.** Smoke 4, Sanity 10, Regression 24, Full 52, known defects 25 (77 total)
   are approved sizes checked by CI. Changing a suite tag is a reclassification that needs a
   justification in [docs/test-suites.md](docs/test-suites.md) and human approval. **Sanity is
   manual only**: never add it to an automatic pipeline path.
6. **No infrastructure changes from test work.** Do not modify `Jenkinsfile`, `compose.yaml`,
   `docker/`, `jenkins/`, `.github/` or Jenkins/Docker state to make tests pass. Those are
   gate-defining (`.github/gate-defining-paths.json`) and need explicit approval.
7. **No sensitive data in evidence** (logs, reports, screenshots, traces, docs, commit messages,
   your own output). See [Sensitive data](#sensitive-data).
8. **No commits, pushes, merges, deletions of tests or new major dependencies** without explicit
   human approval. A gate-defining PR also needs the owner's review (docs/ci-cd.md, "gate-review");
   an agent never adds that review or the `gate-change-reviewed` label itself.

## Where code goes

| Layer                   | Owns                                                                       | Must not contain                                                 |
| ----------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `features/<domain>/`    | Business behavior, tags, examples                                          | UI details (selectors, URLs, button names unless business terms) |
| `src/step-definitions/` | Thin coordination and business assertions (one file per domain + shared)   | Selectors, `page.locator`/`getBy*`, transport code, random data  |
| `src/pages/`            | Locators, navigation, interactions, waiting for the bank's answer          | Assertions (`expect`), business decisions                        |
| `src/support/`          | World, hooks, ledger, provisioning, redaction, outcome checks              | Business preconditions in hooks                                  |
| `src/api/`              | Thin client for the endpoints ParaBank's own UI calls (state verification) | Logging of request/response bodies                               |
| `src/factories/`        | All synthetic data (`test-data.ts` is the single allocator)                | Real or shared data                                              |

ESLint enforces the mechanical part of this table (see `eslint.config.mjs`).

## Gherkin

- Business language, first person ("I transfer …", "my source account"), present-tense intent.
  `Given` = precondition, `When` = one action, `Then` = observable business outcome.
- One functional-area tag (from the feature) and exactly one priority (`@p0` money/identity/access,
  `@p1` business rules/state, `@p2` validation/navigation). Only known tags (checked by
  `npm run ci:bdd`).
- Authenticated scenarios prove the sign-in first (the shared sign-in `Background` of each domain
  feature; `sign-in.feature` signs in inside the scenario because sign-in is what it tests) and
  end with `When I sign out` / `Then my banking session should be ended`.
- Use `Scenario Outline` + `Examples` for partitions of the same rule; tag each `Examples` block
  with its own suite/priority. Do not duplicate a scenario to change one value.
- Every scenario owns its data and runs in any order.

## Step definitions

- **Reuse before writing.** Search existing steps first (`npm run test:dry-run` fails on undefined
  or ambiguous steps; `grep -rn "<phrase>" src/step-definitions`). Shared steps live in
  `customer.steps.ts`, `feedback.steps.ts`, `ledger.steps.ts`.
- Use the existing parameter types (`src/support/parameter-types.ts`): `{money}` (integer cents),
  `{accountRole}`, `{accountType}`, `{entryPoint}`, `{billPayField}`, `{searchCriterion}`,
  `{foreignResource}`, `{foreignOperation}`. Money is always integer cents (`src/utils/money.ts`).
- A `When` that ends on a settled page sets `this.outcomeSettled = true`; read facts with
  `requireValue` (fails loudly when a fact is missing).
- Assertions that state the scenario's expected outcome and may prove a known defect go through
  `outcomeCheck('<id>', …)` (`src/support/outcome-check.ts`).

## Page Objects and locators

Locator order of preference, **verified against ParaBank's markup**: the application has no
`<label>` elements, no `data-testid` and no `aria-label` (checked 2026-10-12), so `getByLabel` and
`getByTestId` cannot work here.

1. `getByRole` with the accessible name (buttons, links, headings, tables).
2. `getByText` for visible business text that is stable.
3. Stable element `id` / `name` attributes (`#amount`, `input[name="customer.firstName"]`).
4. Never XPath, positional chains (`nth-child`), generated classes or layout-dependent CSS.

Actions wait for the specific network response or rendered answer they cause
(`waitForResponse`, `a.or(b).waitFor()`). Forbidden (lint-enforced): `waitForTimeout`, `pause`,
`networkidle`, `force: true`, XPath.

## Assertions and coverage

- Assert **business outcomes and persisted state**, not only page text: balances and postings via
  the ledger (`captureBaseline`, `expectPostings`), the customer via the API client. Opening
  balances are read, never assumed.
- A refused request must prove **nothing changed** (`no money should have moved …`).
- Design positive, negative and boundary cases from risk (impact × likelihood, see
  [docs/test-suites.md](docs/test-suites.md#selection-criteria)). No scenario only to raise the count;
  no second scenario for a mechanism a stronger one already proves.
- A scenario that cannot fail when the behavior is wrong is not a test; reject it.

## Test data

All values come from `src/factories/` and the allocator `src/factories/test-data.ts` (unique,
deterministic, traceable; passwords random). Every generated credential/SSN is registered for
redaction. A repeated scenario input must be intentional and registered in
`scripts/audit-test-data.ts` (`npm run audit:test-data`). Only synthetic data; never the public
ParaBank site or production systems.

## Sensitive data

Passwords, usernames, SSNs, session ids (`jsessionid`), cookies and authorization headers never
reach persistent evidence. Compare them in memory and print only booleans. Never log API bodies.
Traces capture everything and cannot be redacted: opt-in locally only
(`PW_TRACE_ON_FAILURE=true`), never in CI, never shared. When reporting an exposure, describe it
without reproducing the value.

## Mandatory validation before handing over

```powershell
npm run typecheck; npm run lint; npm run format:check
npm run test:dry-run
npm run audit:test-data; npm run test:ci
npm run ci:bdd -- --total 77 --known-defects 25        # update the totals only with an approved change
npm run ci:coverage -- --suite smoke --expect 4         # likewise regression 24, sanity 10, full 52
npm run check:target; npm run test:smoke; npm run test:regression   # needs QA up (npm run qa:health)
npm run test:known-defects                              # when touching a known-defect scenario or proof
```

Never run Sanity automatically. Report the commands you actually ran and their real results; a
test that did not run did not pass. Significant generated test changes go to human review with the
checklist in [docs/ai/test-quality-gates.md](docs/ai/test-quality-gates.md).
