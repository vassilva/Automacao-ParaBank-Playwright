# AI-assisted review: PR #13, runtime API contracts (2026-10-12)

First real use of [prompt 4, "Test review"](../prompt-library.md#4-test-review) and the
[14-criterion checklist](../test-quality-gates.md). Reviewer: Claude (AI), on the change it wrote
itself, so a human review of the PR is still required (AGENTS.md).

**Input:** commit `13a107d` (`src/api/contracts.ts`, `src/api/parabank-client.ts`,
`scripts/ci/tests/api-contracts.test.ts`, `docs/functional-coverage.md`).

## Findings and disposition

| #   | Severity | Finding (evidence)                                                                                                                                                                                         | Disposition                                                                                                                                                                                      |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Medium   | `src/pages/accounts-overview.page.ts:43` still read the overview's accounts with a cast (`as Account[]`), bypassing the new contracts on the Smoke path (criterion 5, assertion strength; 13, consistency) | **Fixed:** `parseAccounts(await response.json())`                                                                                                                                                |
| 2   | Low      | `src/step-definitions/authorization.steps.ts:91,113` cast other customers' bodies                                                                                                                          | **Accepted, unchanged:** these are refusal checks that must accept any body; a contract there would turn an unexpected body into a transport error and could mask the PB-01 proof (criterion 14) |
| 3   | Low      | A `ContractViolation` named the field but not the call that failed (criterion 21-style diagnosability)                                                                                                     | **Fixed:** the client prefixes the action ("could not read the customer profile: …"); 3 client-level tests                                                                                       |
| 4   | Low      | `docs/failure-triage.md` did not classify the new signal                                                                                                                                                   | **Fixed:** "API contract violation" row (confirm against the image's ParaBank source commit)                                                                                                     |

## Checklist result (abridged)

Traceability, business-outcome validation, positive/negative and boundary coverage (null, missing,
wrong type, unknown enum, non-array/non-object, HTML body, zero/negative balance): pass. False
positives: extra fields allowed, so ParaBank adding a field does not break the suite; negative
amounts allowed (PB-04 reproductions). Determinism and isolation: pure functions, no I/O. Sensitive
data: messages name paths and JSON types only (tested). Architecture: no dependency, no new layer,
Cucumber unchanged. Known-defect integrity: 25/25 reproduced through their proofs with contracts
active. "Prove it can fail": removing the amount guard fails 5 tests.

## Validation after the fixes

Recorded in the PR: `test:ci`, Smoke on QA (the overview read of finding 1 is on its path), and the
Jenkins PR build.
