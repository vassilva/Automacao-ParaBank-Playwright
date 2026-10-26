---
name: new-scenario
description: Design and implement a new or changed Gherkin scenario for ParaBank the way this framework requires (risk-based design, step reuse, page objects, factories, tags, validation). Use when asked to add, cover or automate a behavior, user story or acceptance criterion.
---

# New scenario

Follows prompts 1-3 of [docs/ai/prompt-library.md](../../../docs/ai/prompt-library.md) under the
rules of [AGENTS.md](../../../AGENTS.md). Input: a user story, acceptance criteria or a behavior.

## 1. Design (stop for approval)

- Check existing coverage first: `features/`, [docs/functional-coverage.md](../../../docs/functional-coverage.md),
  [docs/scenario-inventory.md](../../../docs/scenario-inventory.md) and
  [docs/defects.md](../../../docs/defects.md) (is it already a PB-xx?).
- Propose only missing positive, negative and boundary scenarios. For each: rule covered,
  partition or boundary (exact edge and the value just outside it), Impact × Likelihood, priority
  (`@p0` money/identity/access, `@p1` rules/state, `@p2` validation/navigation), suite tags per
  [docs/test-suites.md](../../../docs/test-suites.md#selection-criteria), and the business oracle
  (which persisted state proves it).
- Drop candidates whose mechanism a stronger scenario already proves, and say so.
- **Present the table and wait for the human's approval.** Adding a suite tag changes the approved
  suite sizes (Smoke 4, Sanity 10, Regression 24, Full 52, known defects 25, total 77): that is a
  reclassification needing a justification in test-suites.md and explicit approval.

## 2. Implement

- Gherkin in `features/<domain>/`: business language, first person, `Given` precondition /
  `When` one action / `Then` observable outcome. One area tag, exactly one priority. Authenticated
  scenarios use the domain's sign-in `Background` and end with `When I sign out` /
  `Then my banking session should be ended`. Partitions of one rule are a `Scenario Outline` with
  tagged `Examples`, never copies.
- **Reuse steps first**: `grep -rn "<phrase>" src/step-definitions` and `npm run test:dry-run`.
  Shared steps: `customer.steps.ts`, `feedback.steps.ts`, `ledger.steps.ts`. Use the parameter
  types in `src/support/parameter-types.ts`; money is integer cents.
- New steps go in the domain's step file, thin: no selectors, no `Math.random`. Selectors and
  actions only in `src/pages/` (getByRole → getByText → stable `id`/`name`; ParaBank has no labels,
  test ids or aria-labels; never XPath, nth-child, `waitForTimeout`, `networkidle`, `force`).
  Actions wait for the bank's answer; a `When` ending on a settled page sets
  `this.outcomeSettled = true`.
- Assert persisted state: `captureBaseline` before the action, `expectPostings` / the API client
  after. A refusal proves nothing changed. Outcome assertions that may prove a defect go through
  `outcomeCheck('<id>', …)`. Expected values come from the baseline and known inputs, never from
  the bank's answer to the action under test.
- Data only from `src/factories/` (`test-data.ts` allocator). A deliberately repeated input is
  registered with a reason in `scripts/audit-test-data.ts`.
- A behavior that is wrong today becomes `@known-defect @PB-xx` stating the **correct** behavior,
  with a proof registered in `playwright/known-defect-proofs.ts` (needs human review).
- Never create `*.spec.ts`, never weaken an existing assertion, never touch infrastructure files.

## 3. Prove and validate

- Prove it can fail ([docs/ai/test-quality-gates.md](../../../docs/ai/test-quality-gates.md)
  criterion 6): mutate the expected value locally, run the single scenario
  (`npm test -- features/<file>.feature:<line>`), confirm it fails on the `Then`, revert.
- Run the `validate` skill (the human invokes it: `/validate` in Claude Code, `$validate` in
  Codex) or the AGENTS.md validation list, and report real results, the list of reused vs new
  steps, and the 14-criterion checklist. No commit or push.
