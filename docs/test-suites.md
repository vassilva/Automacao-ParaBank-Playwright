# Test suites: risk-based selection

77 Gherkin scenarios (Functional Automation Baseline v2): 52 gating scenarios that must pass, and
25 known-defect scenarios that
state the correct behavior of a confirmed product defect ([defects.md](defects.md)). Tags select
risk-based subsets; no scenario is duplicated. The functional audit behind the 2026-10-06 additions
is in [functional-coverage.md](functional-coverage.md); the v2 audit (sign-in/sign-out lifecycle, data
independence, duplicates, classification) is in [scenario-inventory.md](scenario-inventory.md).

| Suite          | Command                                   | Tag             | Scenarios | Purpose                                                                                                                                                                                                 |
| -------------- | ----------------------------------------- | --------------- | --------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Smoke**      | `npm run test:smoke`                      | `@smoke`        |         4 | Fast gate: is the critical path alive? (sign in, onboard, read balances, move money)                                                                                                                    |
| **Sanity**     | `npm run test:sanity`                     | `@sanity`       |        10 | Manual / on demand: is every functional area alive? One main positive path per area, e.g. after an environment rebuild, a configuration change or an image swap                                         |
| **Regression** | `npm run test:regression`                 | `@regression`   |        24 | Every scenario whose failure means wrong money, wrong identity or access, or a broken business rule                                                                                                     |
| **Full**       | `npm run test:full` (= `npm test`)        | none            |        52 | Everything, including low-risk validation and navigation checks                                                                                                                                         |
| Known defects  | `npx cucumber-js --profile known-defects` | `@known-defect` |        25 | Not a gate. Each scenario fails while its defect exists (red in native Cucumber; expected failures in Playwright via `npm run test:known-defects`, accepted only through the defect's registered proof) |

The same suites through Playwright Test (the canonical entry point, see README "Running"), which
executes the same Gherkin scenarios through Cucumber and selects them by the same tags:

| Suite              | Playwright Test command                               |
| ------------------ | ----------------------------------------------------- |
| Smoke              | `npx playwright test --grep @smoke`                   |
| Sanity             | `npx playwright test --grep @sanity`                  |
| Regression         | `npx playwright test --grep @regression`              |
| Full (default)     | `npx playwright test` (52; known defects excluded)    |
| Known defects only | `npm run test:known-defects` (25, own config/reports) |

Smoke ⊂ Regression ⊂ Full. Sanity overlaps Smoke by design, so it can run on its own. No gating suite
contains a `@known-defect` scenario (the Cucumber profiles exclude the tag explicitly).
Measured on QA (source-built image, one worker, 2026-10-07): native Full 52/52 in 46 s (random
order); `npx playwright test` 52 in 1.0 min; `npm run test:known-defects` 25 in 41 s. Every
authenticated scenario includes its proven sign-in and sign-out.

## Selection criteria

- **Impact** if the behavior breaks: **H** = money, identity or access; **M** = business rule or
  data integrity; **L** = form validation or navigation with no state change.
- **Likelihood** of breaking: **H** = server-side state change across several components (ledger,
  accounts, sessions); **M** = server-side rule or persistence; **L** = static page or client-side
  check.
- **Regression** takes every H-impact scenario and every M-impact scenario that guards money or
  identity. It leaves out L-impact checks whose mechanism is already proven by a stronger
  regression scenario (e.g. "validation blocks submission").
- **Smoke** takes the smallest set that touches authentication, onboarding, balance reading and
  money movement, with persisted-state assertions, in seconds.
- **Sanity** takes one main positive path per functional area (public, authentication,
  registration, accounts, transfers, payments, transactions, profile, loans).

## Risk matrix

|   # | Scenario                                             | Priority | Impact | Likelihood | Smoke | Sanity | Regression | Full | Reason                                                                                                                                                                                                                           |
| --: | ---------------------------------------------------- | :------: | :----: | :--------: | :---: | :----: | :--------: | :--: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Accounts overview matches the bank's records         |    P0    |   H    |     M      |   ✓   |   –    |     ✓      |  ✓   | Smoke: one fast check of the authenticated read path (accounts API, rendering, totals against an independent model). Not Sanity: the overview is already shown and checked inside the sign-in and registration sanity scenarios. |
|   2 | Open a new SAVINGS account                           |    P0    |   H    |     M      |   –   |   ✓    |     ✓      |  ✓   | Creates an account and moves the $100 deposit, with full posting checks. Sanity representative of the accounts area. Not Smoke: transfer #25 already covers money movement.                                                      |
|   3 | Open a new CHECKING account                          |    P1    |   M    |     M      |   –   |   –    |     ✓      |  ✓   | Regression: the account type is a separate server parameter (wrong type mapping is a plausible defect). Not Sanity: same flow as #2.                                                                                             |
|   4 | Login recovery requires every identity detail        |    P2    |   L    |     L      |   –   |   –    |     –      |  ✓   | Full only: form validation with no state change and no customer data involved.                                                                                                                                                   |
|   5 | Registered customer signs in and signs out           |    P0    |   H    |     H      |   ✓   |   ✓    |     ✓      |  ✓   | Every customer journey starts and ends here: the complete, proven sign-in/sign-out lifecycle. Smoke and Sanity (authentication area).                                                                                            |
|   6 | Sign-in refused with a wrong password                |    P0    |   H    |     M      |   –   |   –    |     ✓      |  ✓   | Access control: verified through the bank API (401), not only the UI. Not Smoke: a negative path, not needed to prove the system is up.                                                                                          |
|   7 | Sign-in requires username and password               |    P2    |   L    |     L      |   –   |   –    |     –      |  ✓   | Full only: the server-side refusal mechanism is already proven by #6.                                                                                                                                                            |
|   8 | ~~Signing out ends the session~~ (removed in v2)     |    P0    |   H    |     M      |   –   |   –    |     –      |  –   | Removed as a duplicate: #5 and the closing steps of every authenticated scenario prove the same (HTTP 401 after sign-out). See scenario-inventory.md.                                                                            |
|   9 | Affordable loan approved                             |    P1    |   H    |     M      |   –   |   ✓    |     ✓      |  ✓   | Opens a LOAN account and debits the down payment, with posting checks. Sanity representative of the loans area.                                                                                                                  |
|  10 | Loan denied: funds too low                           |    P1    |   H    |     M      |   –   |   –    |     ✓      |  ✓   | Credit decision rule; asserts that no money moved.                                                                                                                                                                               |
|  11 | ~~Loan denied: down payment not covered~~ (removed)  |    P2    |   M    |     M      |   –   |   –    |     –      |  –   | Removed as a duplicate of #36 (same class, same oracle; #36 tests it at the exact boundary). See scenario-inventory.md.                                                                                                          |
|  12 | Pay a bill                                           |    P0    |   H    |     M      |   –   |   ✓    |     ✓      |  ✓   | External money movement with exact balance and posting checks. Sanity representative of payments. Not Smoke: #25 covers money movement more cheaply.                                                                             |
|  13 | Bill payment refused for mismatched account numbers  |    P1    |   M    |     M      |   –   |   –    |     ✓      |  ✓   | Guards against paying the wrong account; asserts that nothing was submitted and no money moved.                                                                                                                                  |
|  14 | Bill payment lists mandatory payee details           |    P2    |   L    |     L      |   –   |   –    |     –      |  ✓   | Full only: client-side validation; "validation blocks submission" is already proven by #13.                                                                                                                                      |
|  15 | Updated contact details are saved                    |    P1    |   M    |     M      |   –   |   ✓    |     ✓      |  ✓   | Data integrity: persisted profile, with identity fields (name, SSN) unchanged. Sanity representative of the profile area.                                                                                                        |
|  16 | Profile update requires a first name                 |    P2    |   L    |     L      |   –   |   –    |     –      |  ✓   | Full only: client-side validation with no state change.                                                                                                                                                                          |
|  17 | Visitor reaches registration from home               |    P2    |   L    |     L      |   –   |   ✓    |     –      |  ✓   | Sanity: a cheap signal that the public site and its navigation are served (no customer needed). Not Regression: no business logic.                                                                                               |
|  18 | Visitor reaches login recovery from home             |    P2    |   L    |     L      |   –   |   ✓    |     –      |  ✓   | Same as #17 (same outline).                                                                                                                                                                                                      |
|  19 | New customer registers with a funded account         |    P0    |   H    |     H      |   ✓   |   ✓    |     ✓      |  ✓   | Onboarding and initial funding, through the real UI. Smoke and Sanity (registration area).                                                                                                                                       |
|  20 | Registration refused: password confirmation mismatch |    P1    |   M    |     M      |   –   |   –    |     ✓      |  ✓   | Credential integrity, checked server-side; the visitor must not be signed in.                                                                                                                                                    |
|  21 | Registration refused: username taken                 |    P1    |   H    |     M      |   –   |   –    |     ✓      |  ✓   | Identity uniqueness: a duplicate username would endanger another customer's account.                                                                                                                                             |
|  22 | Registration lists mandatory details                 |    P2    |   L    |     L      |   –   |   –    |     –      |  ✓   | Full only: field validation; server-side refusals are already proven by #20 and #21.                                                                                                                                             |
|  23 | Find a transaction by amount                         |    P1    |   M    |     M      |   –   |   ✓    |     ✓      |  ✓   | Ledger visibility: the result must be exactly the transaction created in setup. Sanity representative of transactions.                                                                                                           |
|  24 | Search refused for a non-numeric amount              |    P2    |   L    |     L      |   –   |   –    |     –      |  ✓   | Full only: client-side validation with no state.                                                                                                                                                                                 |
|  25 | Transfer $100.00 between own accounts                |    P0    |   H    |     H      |   ✓   |   ✓    |     ✓      |  ✓   | Core money movement: both balances plus exactly one posting on each side. Smoke and Sanity (transfers area).                                                                                                                     |
|  26 | Transfer $0.01 (smallest unit)                       |    P1    |   H    |     M      |   –   |   –    |     ✓      |  ✓   | Boundary: precision and rounding of money; any off-by-a-cent defect fails it.                                                                                                                                                    |
|  27 | Transfer without an amount moves no money            |    P1    |   M    |     M      |   –   |   –    |     ✓      |  ✓   | A request the server rejects must leave the whole ledger unchanged.                                                                                                                                                              |

### Exclusions in summary

- **Excluded from Regression (6 scenarios run in Full only, plus #17 and #18 in Sanity and Full):** #4,
  #7, #14, #16, #22 and #24 are L-impact validation checks whose mechanism a stronger regression
  scenario already proves. #17 and #18 are navigation only.
- **Not in Smoke:** everything except #1, #5, #19 and #25. Negative paths, boundaries and
  secondary money flows belong in Regression; Smoke stays small and positive.
- **Not in Sanity:** second scenarios of an area already represented (#1, #3, #6, #10, #13,
  #20, #21, #26, #27) and all L-impact validations except the public navigation pair.

## Classification of the 2026-10-06 additions

Smoke and Sanity are unchanged (4 and 10). Regression grows from 19 to 25 with six scenarios whose
failure would mean a wrong financial display, a wrong credit decision at its threshold, or an
access or identity weakness. Every other addition is Full only (P2 validation, boundaries without
money impact, search modes). Two original scenarios became outline rows: #24 (now one row of
"A search with an invalid <criterion> is refused") and #27 (one row of "A transfer with <case> is
rejected and moves no money"); their classification is unchanged.

|     # | Scenario                                                        | Priority | Regression | Reason                                                                                             |
| ----: | --------------------------------------------------------------- | :------: | :--------: | -------------------------------------------------------------------------------------------------- |
|    28 | An account's details page matches the bank's records            |    P1    |     ✓      | Balance and transactions shown to the customer: a wrong figure is a financial display defect       |
|    29 | Only checking and savings accounts can be opened online         |    P2    |     –      | Static offer and notice                                                                            |
|    30 | Login recovery: proven identity recovers the login and signs in |    P1    |     ✓      | Account recovery is an access path                                                                 |
|    31 | Login recovery refuses identity details that match no customer  |    P1    |     ✓      | Access must not be granted to an unknown identity                                                  |
|    32 | Sign-in with an unknown username gets the same answer           |    P1    |     ✓      | No account enumeration through sign-in messages                                                    |
|    33 | Sign-in requires a password                                     |    P2    |     –      | Same refusal mechanism as #6                                                                       |
|    34 | A loan of exactly five times the available funds is approved    |    P1    |     ✓      | Credit decision at its threshold, with ledger checks                                               |
|    35 | A down payment equal to the available funds is accepted         |    P2    |     ✓      | v2: accepted side of the down-payment boundary (#36 refused side), money moves; full ledger oracle |
|    36 | A down payment one cent above the available funds is refused    |    P2    |     ✓      | Same classification as #11, at its exact boundary                                                  |
| 37–38 | Bill payment: invalid amount / invalid payee account number     |    P2    |     –      | Client-side validation; blocking mechanism proven by #13                                           |
|    39 | A payee name made only of spaces is treated as missing          |    P2    |     –      | Client-side validation                                                                             |
| 40–42 | Find a transaction by ID / date / date range                    |    P2    |     –      | Read-only search modes; ledger correctness is proven by the money scenarios                        |
|    43 | A search by amount lists every transaction with that amount     |    P2    |     –      | Read-only                                                                                          |
| 44–45 | A search that matches nothing shows an empty result             |    P2    |     –      | Read-only                                                                                          |
| 46–48 | A search with an invalid transaction ID / date / date range     |    P2    |     –      | Client-side validation                                                                             |
|    49 | A profile update lists every mandatory contact detail           |    P2    |     –      | Client-side validation                                                                             |
|    50 | The phone number is optional in my profile                      |    P2    |     –      | Optional-field rule, persisted                                                                     |
|    51 | A transfer with a non-numeric amount moves no money             |    P2    |     –      | Same no-op mechanism as #27                                                                        |
|    52 | A username of the maximum length is accepted                    |    P2    |     –      | Field-length boundary                                                                              |
| 53–54 | Customer care accepts a message / requires every detail         |    P2    |     –      | Public form, no customer state                                                                     |

Known-defect scenarios carry a priority tag (the risk if the defect were fixed and later
regressed) but no suite tag. When a defect is fixed, `npm run test:known-defects` fails with
"no longer reproduces": remove `@known-defect` and its `@PB-xx` tag and classify the scenario with
the criteria above (most belong in Regression).

## Baseline v2 (2026-10-07)

Smoke 4, Sanity 10, Regression 24, Full 52, known defects 25 (77 in total). Changes from v1: two
duplicates removed (#8, #11), #35 added to Regression, #5 renamed; every change is justified in
[scenario-inventory.md](scenario-inventory.md).

## Use in CI

Jenkins ([ci-cd.md](ci-cd.md)) validates each suite on its own against its approved size (Smoke 4,
Regression 24; Sanity 10 and Full 52 on demand): the Quality Gates stage fails before any
deployment if a tag change alters a suite, and every run must have executed exactly its suite's
scenarios, once, all passed (`scripts/ci/verify-suite-coverage.ts`). Suites are never assumed to
add up to another suite.
