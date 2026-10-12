# Quality gates for new or changed tests

Applies to every new or modified scenario, step definition, Page Object or test-data rule, whether
written by a person or an AI agent. Automated checks run in the Jenkins Quality Gates; the review
questions are answered in the pull request. **A passing test is not evidence by itself:** it counts
only if it would fail when the behavior is wrong.

## The 14 criteria

| #   | Criterion                   | Passes when                                                                                                  | Automated by (existing)                                                  | Reviewer checks                                                           |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| 1   | Requirement traceability    | The scenario maps to a rule in docs/functional-coverage.md (or the PR adds that row)                         | –                                                                        | Which acceptance criterion or business rule does it prove?                |
| 2   | Business-outcome validation | `Then` steps assert the business result and persisted state, not only page text                              | –                                                                        | Would a UI that shows success without persisting it pass?                 |
| 3   | Positive and negative       | Rejections prove nothing changed (ledger/profile unchanged)                                                  | –                                                                        | Is the refusal checked server-side and side-effect-free?                  |
| 4   | Boundaries                  | Exact edge and the value just outside it, as a minimal pair                                                  | `npm run audit:test-data` (repeated values must be registered)           | Are both sides of the boundary present?                                   |
| 5   | Assertion strength          | Exact values (integer cents, ids), exact counts of postings                                                  | `npm run lint` (`no-floating-promises`: no un-awaited assertion)         | Any `toBeTruthy`/`toContain` where an exact value is known?               |
| 6   | False-positive prevention   | The test was seen failing against wrong behavior (see below); no try/catch or optional checks around asserts | –                                                                        | Evidence of the "prove it can fail" check                                 |
| 7   | Locator stability           | Role/text/stable id; no XPath or layout CSS                                                                  | `npm run lint` (XPath, `force`, `networkidle` rules)                     | Is each locator unique on the real page?                                  |
| 8   | Deterministic execution     | Waits on the bank's answer; no sleeps; passes repeatedly and in any order                                    | `npm run lint` (`waitForTimeout`, `pause`); one worker, `retries: 0`     | Does every action wait for its response or rendered answer?               |
| 9   | Test-data isolation         | All data from `src/factories`; nothing shared between scenarios                                              | `npm run audit:test-data`; lint (`Math.random` outside factories)        | Does the scenario create everything it uses?                              |
| 10  | Maintainability             | Steps reused; selectors only in Page Objects; no new abstraction layers                                      | `npm run lint` (selectors in steps, `expect` in Page Objects)            | Could an existing step have been reused?                                  |
| 11  | Duplication                 | No scenario whose mechanism a stronger one already proves                                                    | `npm run test:dry-run` (ambiguous steps fail)                            | Checked against docs/test-suites.md risk matrix?                          |
| 12  | Sensitive data              | No credential, SSN, session id or cookie in any output; new values registered for redaction                  | `src/support/evidence.ts` + `redaction.ts` at runtime                    | Any new log, attachment or trace? Any body or header printed?             |
| 13  | Architectural compatibility | Gherkin + Cucumber only; tags valid; suite sizes as approved                                                 | `npm run ci:bdd`, `npm run ci:coverage`, lint (`test()` import in `src`) | Any `*.spec.ts`, runner change or new dependency?                         |
| 14  | Known-defect integrity      | `@known-defect` scenarios still fail through their registered proof only                                     | `npm run ci:bdd` (proof registered), `npm run test:known-defects`        | Was an oracle, tag or proof changed? With what evidence about the defect? |

## Prove it can fail (criterion 6)

For each new outcome assertion, show once, locally, that it fails when the outcome is wrong, then
revert: change the expected value in the Examples table (e.g. `128.45` → `128.46`) or the expected
message, run the single scenario (`npm test -- features/<file>.feature:<line>`), confirm it fails
**on that `Then` step** with a clear message, and restore it. Record the result in the PR
("verified red: <step>"). Never commit the mutated version.

## Decision

- **Accept:** all automated checks pass, every review question has an answer, the impacted
  scenarios passed on QA.
- **Rework:** any criterion fails, or a test passed without having been seen to fail.
- **Human review is mandatory** for significant AI-generated changes: new or changed `Then`
  steps, suite tags, known-defect scenarios or proofs, Page Object actions, and anything in a
  gate-defining path (`.github/gate-defining-paths.json`).
