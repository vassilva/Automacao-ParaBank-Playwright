# Scenario inventory and audit (Functional Automation Baseline v2)

Audit of 2026-10-07. Input: Baseline v1 (79 scenarios = 54 normal + 25 `@known-defect`; Smoke 4,
Sanity 10, Regression 25, Full 54). Output: Baseline v2 (77 = 52 normal + 25 known-defect; Smoke
4, Sanity 10, Regression 24, Full 52). Counts are Cucumber pickles (one per Examples row).

Legend:

- **Session**: `AUTH` the scenario acts as a signed-in customer; `LOGIN` sign-in itself is the
  subject; `PUBLIC` no customer session is involved (visitor, registration, recovery, failed
  sign-in).
- **Login**: `UI+P` the customer signs in through the sign-in form and the sign-in is _proven_
  (`I am signed in as that customer`: the session's customer id is the registered customer and it
  reads that customer's accounts); `—` none.
- **Logout**: `UI+P` the customer signs out through the menu and the sign-out is _proven_ (`my
banking session should be ended`: sign-in form shown, no customer menu, HTTP 401 from the
  customer's accounts endpoint); `ACT` signing out is the action under test; `KD` present, runs
  once the defect is fixed (the defect proof fails first); `—` none.
- **State**: `W` persists a change; `R` reads only; `N` the bank refuses, nothing may change.
- **Data**: every scenario creates its own customer(s) and accounts (`own`); `none` for visitors.
- **Verdict** (Task D): `UNIQUE`, `SIMILAR/RISK`, `BOUNDARY`, `SECURITY`, `KD-PROOF`; see the
  pairwise analysis below.

## Normal scenarios (52)

| Feature / line          | Scenario                                            | Suites           | Session | Objective / input class                          | Oracle                                                              | State | Data | Login | Logout | Verdict      |
| ----------------------- | --------------------------------------------------- | ---------------- | ------- | ------------------------------------------------ | ------------------------------------------------------------------- | ----- | ---- | ----- | ------ | ------------ |
| accounts:15             | Accounts overview matches the bank's records        | smoke reg p0     | AUTH    | balances shown = persisted, 2 accounts           | each row = API balance; total = integer-cent sum                    | R     | own  | UI+P  | UI+P   | UNIQUE       |
| accounts:24             | Account details page matches the bank's records     | reg p1           | AUTH    | details page of one account                      | number/type/balance/available + transactions = API                  | R     | own  | UI+P  | UI+P   | UNIQUE       |
| accounts:33             | Only checking and savings can be opened online      | p2               | AUTH    | offered types, minimum deposit rule              | exact type list; 100.00 deposit message                             | R     | own  | UI+P  | UI+P   | UNIQUE       |
| accounts:54             | Open a new SAVINGS account                          | san reg p0       | AUTH    | account opening, type SAVINGS                    | persisted type + 100.00 balance; source −100.00; transfer posting   | W     | own  | UI+P  | UI+P   | SIMILAR/RISK |
| accounts:59             | Open a new CHECKING account                         | reg p1           | AUTH    | account opening, type CHECKING                   | as above, type CHECKING                                             | W     | own  | UI+P  | UI+P   | SIMILAR/RISK |
| sign-in:10              | Signs in with valid credentials and signs out       | smoke san reg p0 | LOGIN   | full authenticated lifecycle                     | overview of own account, greeting, session identity, HTTP 401 after | R     | own  | UI+P  | UI+P   | UNIQUE       |
| sign-in:20              | Sign-in refused, wrong password                     | reg p0           | PUBLIC  | valid user, invalid password                     | exact message; no session (HTTP 401)                                | N     | own  | —     | —      | SECURITY     |
| sign-in:27              | Sign-in requires username and password (empty form) | p2               | PUBLIC  | both fields empty                                | exact message                                                       | N     | none | —     | —      | BOUNDARY     |
| sign-in:33              | Unknown username gets the same answer               | reg p1           | PUBLIC  | non-existent user                                | same message as wrong password (no user enumeration); not signed in | N     | none | —     | —      | SECURITY     |
| sign-in:40              | Sign-in requires a password                         | p2               | PUBLIC  | valid user, password empty                       | exact message; no session (HTTP 401)                                | N     | own  | —     | —      | BOUNDARY     |
| login-recovery:8        | Recovery requires every identity detail             | p2               | PUBLIC  | empty form                                       | all 7 required messages in order                                    | N     | none | —     | —      | UNIQUE       |
| login-recovery:21       | Identity proven: login recovered, signed in         | reg p1           | PUBLIC  | full correct identity                            | located message; recovered username = own (in memory); HTTP 200     | R     | own  | —     | —      | UNIQUE       |
| login-recovery:29       | Identity matching no customer refused               | reg p1           | PUBLIC  | identity with never-issued SSN area 999          | exact message; not signed in                                        | N     | none | —     | —      | UNIQUE       |
| bill-pay:15             | Pay a bill to a payee                               | san reg p0       | AUTH    | typical payment 42.10                            | confirmation; balance −42.10; one debit to that payee; nothing else | W     | own  | UI+P  | UI+P   | UNIQUE       |
| bill-pay:24             | Mismatched payee account confirmation               | reg p1           | AUTH    | cross-field validation                           | exact message; no request sent; ledger unchanged                    | N     | own  | UI+P  | UI+P   | UNIQUE       |
| bill-pay:33             | Empty bill payment lists every mandatory detail     | p2               | AUTH    | all fields empty                                 | 8 required messages; no request sent                                | N     | own  | UI+P  | UI+P   | UNIQUE       |
| bill-pay:58             | Invalid amount refused before sending               | p2               | AUTH    | non-numeric amount                               | field message only; no request sent                                 | N     | own  | UI+P  | UI+P   | SIMILAR/RISK |
| bill-pay:59             | Invalid payee account number refused                | p2               | AUTH    | non-numeric account number                       | field message only; no request sent                                 | N     | own  | UI+P  | UI+P   | SIMILAR/RISK |
| bill-pay:62             | Payee name of spaces treated as missing             | p2               | AUTH    | whitespace-only name                             | field message; no request sent                                      | N     | own  | UI+P  | UI+P   | BOUNDARY     |
| transfer-funds:27       | Transfer 100.00                                     | smoke san reg p0 | AUTH    | typical amount                                   | confirmation; source −, destination +; one posting each             | W     | own  | UI+P  | UI+P   | UNIQUE       |
| transfer-funds:32       | Transfer 0.01                                       | reg p1           | AUTH    | smallest currency unit                           | as above at 0.01                                                    | W     | own  | UI+P  | UI+P   | BOUNDARY     |
| transfer-funds:45       | Transfer with no amount rejected                    | reg p1           | AUTH    | empty amount                                     | error panel; ledger unchanged                                       | N     | own  | UI+P  | UI+P   | SIMILAR/RISK |
| transfer-funds:50       | Transfer with non-numeric amount rejected           | p2               | AUTH    | `abc`                                            | error panel; ledger unchanged                                       | N     | own  | UI+P  | UI+P   | SIMILAR/RISK |
| find-transactions:15    | Find a transaction by its amount                    | san reg p1       | AUTH    | amount, one match                                | only that transfer, as a debit                                      | R     | own  | UI+P  | UI+P   | SIMILAR/RISK |
| find-transactions:34–36 | Find by transaction ID / date / date range (3)      | p2               | AUTH    | three other search criteria                      | exactly the account's matching transactions                         | R     | own  | UI+P  | UI+P   | UNIQUE       |
| find-transactions:39    | Search by amount lists every match                  | p2               | AUTH    | amount, two matches                              | both transfers listed                                               | R     | own  | UI+P  | UI+P   | SIMILAR/RISK |
| find-transactions:56–57 | Search matching nothing: amount / ID (2)            | p2               | AUTH    | valid input, no match                            | empty result                                                        | R     | own  | UI+P  | UI+P   | UNIQUE       |
| find-transactions:69–72 | Invalid amount / ID / date / date range (4)         | p2               | AUTH    | invalid input per criterion                      | exact message per criterion; no results                             | N     | own  | UI+P  | UI+P   | UNIQUE       |
| update-contact-info:15  | Updated contact details saved                       | san reg p1       | AUTH    | change address and phone                         | persisted new contact; name/identity unchanged                      | W     | own  | UI+P  | UI+P   | UNIQUE       |
| update-contact-info:24  | Profile update requires a first name                | p2               | AUTH    | one field missing, others valid                  | exactly one message; profile unchanged                              | N     | own  | UI+P  | UI+P   | SIMILAR/RISK |
| update-contact-info:32  | Every mandatory contact detail cleared              | p2               | AUTH    | all mandatory fields missing                     | 6 messages; profile unchanged                                       | N     | own  | UI+P  | UI+P   | SIMILAR/RISK |
| update-contact-info:46  | Phone number is optional                            | p2               | AUTH    | optional field removed                           | confirmation; no phone, rest unchanged                              | W     | own  | UI+P  | UI+P   | UNIQUE       |
| request-loan:15         | Affordable loan approved (100 / 10)                 | san reg p1       | AUTH    | typical approval                                 | approved; LOAN account 100.00; primary −10.00; one posting          | W     | own  | UI+P  | UI+P   | UNIQUE       |
| request-loan:36         | Loan denied, funds too low (100000 / 10)            | reg p1           | AUTH    | amount far above the funds rule                  | denied with reason; ledger unchanged                                | N     | own  | UI+P  | UI+P   | SIMILAR/RISK |
| request-loan:43         | Loan of exactly 5× available funds approved         | reg p1           | AUTH    | funds-rule boundary (on)                         | approved; LOAN = amount; primary −1.00; one posting                 | W     | own  | UI+P  | UI+P   | BOUNDARY     |
| request-loan:53         | Down payment equal to available funds accepted      | reg p2           | AUTH    | down-payment rule boundary (on)                  | approved; LOAN = 100.00; primary BEFORE − funds = 0.00; one posting | W     | own  | UI+P  | UI+P   | BOUNDARY     |
| request-loan:62         | Down payment one cent above funds refused           | reg p2           | AUTH    | down-payment rule boundary (just above)          | denied with reason; ledger unchanged                                | N     | own  | UI+P  | UI+P   | BOUNDARY     |
| home:15–16              | Visitor reaches registration / login recovery (2)   | san p2           | PUBLIC  | two public entry points                          | destination URL and heading                                         | R     | none | —     | —      | UNIQUE       |
| home:19                 | Customer care accepts a message                     | p2               | PUBLIC  | complete message                                 | thanks by name; representative notice; no errors                    | R     | none | —     | —      | UNIQUE       |
| home:25                 | Customer care requires every detail                 | p2               | PUBLIC  | empty message                                    | 4 required messages                                                 | N     | none | —     | —      | UNIQUE       |
| registration:8          | New customer registers, funded account              | smoke san reg p0 | PUBLIC  | valid registration                               | confirmation; greeting; exactly one account, positive balance       | W     | own  | —     | —      | UNIQUE       |
| registration:16         | Password confirmation mismatch refused              | reg p1           | PUBLIC  | cross-field validation                           | exact message; not signed in                                        | N     | own  | —     | —      | UNIQUE       |
| registration:23         | Username already taken refused                      | reg p1           | PUBLIC  | duplicate username (own pre-registered customer) | exact message; not signed in                                        | N     | own  | —     | —      | UNIQUE       |
| registration:31         | Empty form lists every mandatory detail             | p2               | PUBLIC  | all empty                                        | 10 messages in order; phone optional                                | N     | none | —     | —      | UNIQUE       |
| registration:48         | Username of maximum length (20) accepted            | p2               | PUBLIC  | field-length boundary (on)                       | registration confirmed                                              | W     | own  | —     | —      | BOUNDARY     |

## Known-defect scenarios (25)

Each one states the correct behavior and is accepted as "reproduced" only through its registered
outcome check (docs/defects.md). All acting as a customer use the same proven sign-in; their
sign-out steps (`KD`) run once the defect is fixed.

| Feature / line                | Scenario                                                        | Defect / priority | Session | Distinct risk                                                               | Proof (outcome check)                                             | Login | Logout | Verdict  |
| ----------------------------- | --------------------------------------------------------------- | ----------------- | ------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----- | ------ | -------- |
| customer-data-isolation:31–33 | Read another customer's accounts / profile / transactions (3)   | PB-01 p0          | AUTH    | three different resources disclosed (balances, identity incl. SSN, history) | request-refused (owner's data compared with the owner's own view) | UI+P  | KD     | SECURITY |
| customer-data-isolation:46–48 | Move another's money: transfer / bill payment / new account (3) | PB-02 p0          | AUTH    | three different money-moving endpoints                                      | other-ledger-unchanged                                            | UI+P  | KD     | SECURITY |
| customer-data-isolation:51    | Change another customer's profile                               | PB-03 p0          | AUTH    | identity takeover path                                                      | other-profile-unchanged                                           | UI+P  | KD     | SECURITY |
| transfer-funds:67–68          | Transfer amount messages: empty / `abc` (2)                     | PB-09 p2          | AUTH    | two different messages never shown                                          | message-shown                                                     | UI+P  | KD     | KD-PROOF |
| transfer-funds:82             | Negative transfer                                               | PB-04 p0          | AUTH    | money moves in reverse                                                      | ledger-unchanged                                                  | UI+P  | KD     | KD-PROOF |
| transfer-funds:87             | Zero transfer                                                   | PB-07 p2          | AUTH    | empty postings (transfer endpoint)                                          | ledger-unchanged                                                  | UI+P  | KD     | KD-PROOF |
| transfer-funds:92             | Sub-cent transfer                                               | PB-08 p1          | AUTH    | accounts made unreadable (transfer endpoint)                                | ledger-readable                                                   | UI+P  | KD     | KD-PROOF |
| bill-pay:84                   | Negative bill payment                                           | PB-05 p0          | AUTH    | paying account credited                                                     | ledger-unchanged                                                  | UI+P  | KD     | KD-PROOF |
| bill-pay:89                   | Zero bill payment                                               | PB-07 p2          | AUTH    | empty posting (bill-pay endpoint)                                           | ledger-unchanged                                                  | UI+P  | KD     | KD-PROOF |
| bill-pay:94                   | Sub-cent bill payment                                           | PB-08 p1          | AUTH    | accounts made unreadable (bill-pay endpoint)                                | ledger-readable                                                   | UI+P  | KD     | KD-PROOF |
| request-loan:74               | Loan one cent above 5× funds                                    | PB-11 p2          | AUTH    | funds rule boundary (just above) approved                                   | loan-denied                                                       | UI+P  | KD     | KD-PROOF |
| request-loan:82               | Negative down payment                                           | PB-06 p0          | AUTH    | funding account credited                                                    | ledger-unchanged                                                  | UI+P  | KD     | KD-PROOF |
| request-loan:99–100           | Loan amount / down payment missing (2)                          | PB-10 p2          | AUTH    | two different messages never shown                                          | message-shown                                                     | UI+P  | KD     | KD-PROOF |
| update-contact-info:57        | Profile first name of spaces                                    | PB-16 p2          | AUTH    | whitespace accepted (profile form)                                          | message-shown                                                     | UI+P  | KD     | KD-PROOF |
| sign-in:50                    | After sign-out, a banking page asks to sign in                  | PB-14 p1          | AUTH    | HTTP 500 instead of the sign-in prompt                                      | message-shown                                                     | UI+P  | ACT    | KD-PROOF |
| login-recovery:40             | Recovery refused when only the SSN matches                      | PB-12 p0          | PUBLIC  | account takeover by SSN                                                     | message-shown                                                     | —     | —      | SECURITY |
| registration:57               | Duplicate SSN registration                                      | PB-15 p1          | PUBLIC  | identity uniqueness                                                         | registration-not-confirmed                                        | —     | —      | KD-PROOF |
| registration:65               | Registration names of spaces                                    | PB-16 p2          | PUBLIC  | whitespace accepted (registration form)                                     | required-messages-shown                                           | —     | —      | KD-PROOF |
| registration:74               | Username of 21 characters                                       | PB-17 p2          | PUBLIC  | wrong refusal reason for over-long input                                    | no-username-taken-message                                         | —     | —      | KD-PROOF |

## Task B: authenticated lifecycle

- **Authenticated (AUTH)**: 35 normal + 21 known-defect pickles, all through one shared
  implementation: a `Background` (accounts, bill pay, transfers, transactions, loans, profile,
  authorization) or explicit steps (sign-in, PB-14). SETUP registers the customer in a separate
  HTTP session that is discarded, so the browser's first and only session is the proven sign-in.
- **Sign-in as the subject (LOGIN)**: the Smoke sign-in scenario now covers the whole lifecycle.
- **Excluded on purpose (PUBLIC)**: registration (it signs the new customer in by itself), login
  recovery (public, and its success signs the visitor in), failed or incomplete sign-in, home page
  entry points and customer care. Adding sign-in there would test nothing and could mask the
  behavior under test.
- **Known defects**: the lifecycle steps are context and closing steps, never a proof. A failure in
  them is reported as "not the defect"; the closing sign-out runs only once the defect is fixed.

## Task C: test-data independence

| Finding                                                                                                                                                                               | Correction                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Synthetic SSNs were 6 random digits (10^6 values). About 150 customers per full run gave a ~1% chance of two customers sharing an SSN, which breaks login recovery for both (PB-15).  | SSNs now come from a sequence with a random start: unique within a run. (Across runs on a long-lived database, see Remaining risk.)               |
| The scenario's customer was registered in the browser's own session, which was then cleared: the first authenticated session was not the one under test.                              | Registration now happens in a separate HTTP session that is discarded; the browser signs in through the form.                                     |
| No scenario reads data created by another scenario: every customer, account, payee, transfer and loan is created by the scenario that uses it.                                        | Proven by running the whole normal suite in random order (`--order random`) and by Playwright, which runs every scenario in its own Cucumber run. |
| Shared literals (e.g. 100.00, 37.25, 42.10, `Renamed`, SSN `999-00-0000`, transaction ID `999999999`) are business values or deliberately non-existent identifiers, not shared state. | Kept deterministic on purpose: they are the inputs and boundaries under test, and each one is applied to the scenario's own accounts.             |

Update (test-data uniqueness audit): SSNs now come from a persistent per-environment cursor, so
successive runs on a long-lived database continue the sequence; every other generated value is
scenario-owned too. See [test-data.md](test-data.md).

## Task D: duplicate audit

### Removed (2)

**1. "Signing out ends the banking session"** (sign-in, `@regression @p0`)

| Question                 | Removed scenario                                 | Retained: "A registered customer signs in with valid credentials and signs out" (Smoke) and the closing steps of every authenticated scenario |
| ------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement              | signing out ends the session                     | same                                                                                                                                          |
| Risk                     | a session that survives sign-out                 | same                                                                                                                                          |
| Input / state transition | signed-in customer → Log Out                     | same (proven signed-in session → Log Out)                                                                                                     |
| Oracle                   | sign-in form offered; accounts endpoint HTTP 401 | sign-in form; no customer menu; accounts endpoint HTTP 401 (stronger: the sign-in before it is proven too)                                    |
| Defect proof             | none                                             | none (PB-14 is a separate known-defect scenario and is unchanged)                                                                             |
| Diagnostic value         | one dedicated scenario                           | checked in every authenticated scenario and in Smoke; a regression shows up in all of them                                                    |

Coverage impact: none lost; sign-out is now verified in Smoke as well as in Regression.

**2. "A loan is denied when the down payment cannot be covered" (100 / 100000)** (loans, `@regression @p2`)

| Question                        | Removed example (down payment 100000)                                                        | Retained: "A down payment one cent above the available funds is refused"         |
| ------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Requirement                     | down payment must not exceed the available funds                                             | same                                                                             |
| Equivalence class               | down payment > available funds (and > loan amount)                                           | same class (available funds + 0.01 is also > the 100.00 loan amount)             |
| Boundary                        | far above (representative value)                                                             | just above the boundary (stronger: also detects an off-by-one or rounding error) |
| State transition                | none (denied)                                                                                | none (denied)                                                                    |
| Oracle                          | denied with "You do not have sufficient funds for the given down payment."; ledger unchanged | identical steps and messages                                                     |
| Defect proof / diagnostic value | none / same message                                                                          | same                                                                             |

Coverage impact: none lost; the on-boundary case ("equal to available funds is accepted") stays as
well, so the rule keeps both sides of its boundary.

### Similar but deliberately retained

| Pair                                                                                  | Why both stay                                                                                                                               |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Loan denied, funds too low (100000 / 10) vs PB-11 (5× funds + 0.01)                   | The funds-rule boundary is defective (PB-11), so the far-above value is the only gating proof that the funds rule denies at all.            |
| Sign-in: empty form vs password missing                                               | Different partitions (no credential vs one missing); the second also proves no session is created.                                          |
| Sign-in: wrong password vs unknown username                                           | Different risk: the second proves the bank does not reveal which usernames exist.                                                           |
| Transfer rejected (no amount / `abc`) vs PB-09 (same inputs)                          | Different oracles: the normal pair gates "invalid input moves no money" (passes today); PB-09 documents the missing messages (fails today). |
| Find by amount (one match) vs search by amount (two matches)                          | Filtering vs completeness: the second catches a search that returns only the first match.                                                   |
| Profile: first name missing vs every mandatory detail cleared                         | Single-field partition with exactly one message (no false positives on valid fields) vs all-empty partition (every field validated).        |
| Open SAVINGS vs open CHECKING                                                         | Different persisted account type, each verified against the bank.                                                                           |
| Bill pay invalid amount vs invalid account number                                     | Different fields and messages.                                                                                                              |
| PB-01 ×3, PB-02 ×3                                                                    | Different resources and money-moving endpoints; each is its own access-control check.                                                       |
| PB-07 transfer vs bill pay, PB-08 transfer vs bill pay, PB-16 registration vs profile | Same defect class, different endpoints/forms: a fix in one does not fix the other.                                                          |
| PB-09 ×2, PB-10 ×2                                                                    | Each example is a different missing message.                                                                                                |

## Task E: suite classification changes

| Scenario                                                | Change                              | Reason                                                                                                                                                  |
| ------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A registered customer signs in with valid credentials…  | renamed "…and signs out"; same tags | Now the complete lifecycle; keeps Smoke at 4 vital flows (sign in/out, register, see balances, move money).                                             |
| Signing out ends the banking session                    | removed (was Regression)            | Duplicate, see above.                                                                                                                                   |
| Loan denied: down payment cannot be covered             | removed (was Regression)            | Duplicate, see above.                                                                                                                                   |
| A down payment equal to the available funds is accepted | `@regression` added (was Full only) | It is the accepted side of a money-moving boundary whose refused side is in Regression; with its financial oracle it belongs with the other boundaries. |

Smoke 4 → 4, Sanity 10 → 10 (still one main positive path per area), Regression 25 → 24,
Full 54 → 52, known defects 25 → 25.
