# ParaBank discovery, risk and coverage

## Scope and observation

Target: `https://parabank.parasoft.com/parabank/`, a public third-party demo site behind a
Cloudflare edge proxy. This repository does not control its data, availability, configuration
or deployment. Observations were made on 2026-10-05 in two sessions.

### Session 1 (initial, Playwright Test)

- Home page: Customer Login panel, Register and "Forgot login info?" links, public navigation.
- Invalid login reached `/login.htm` with "The username and password could not be verified."
- Empty registration showed a required message for ten fields; phone is optional.
- Empty Customer Lookup showed required messages for its seven identity fields.
- An unauthenticated request to `/openaccount.htm` returned HTTP 500 instead of a login redirect.
- Two generated usernames were reported as "already existing", so registration and all
  authenticated behavior were left untested.

### Session 2 (this migration): registration re-investigated

Registration **does** work with unique synthetic data. The earlier failure was not reproduced.
The first attempt in this session got HTTP 403 from the edge proxy, and later attempts
succeeded. The edge proxy intermittently rejects requests, which matches the session 1 symptom.

Observed and verified behavior (each with a synthetic customer created for the purpose):

| Area                  | Observed behavior                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registration          | Success page "Welcome {username}" + "Your account was created successfully. You are now logged in."; session is signed in. A new customer owns exactly one CHECKING account with a positive opening balance (observed $515.50, not asserted as a constant). Mismatched confirmation: "Passwords did not match." Taken username: "This username already exists."              |
| Registration via HTTP | `POST register.htm` works only after a `GET register.htm` (form-backing session); without it, HTTP 500.                                                                                                                                                                                                                                                                      |
| Sign-in               | Valid credentials land on `overview.htm` with "Welcome {first} {last}". Wrong password: "The username and password could not be verified." Empty form: "Please enter a username and password."                                                                                                                                                                               |
| Sign-out              | `logout.htm` returns to the home page; the accounts API then answers **401** "User login required". A protected page such as `overview.htm` answers HTTP 500 with "An internal error has occurred" instead of redirecting to login.                                                                                                                                          |
| Accounts overview     | Rendered client-side from `GET services_proxy/bank/customers/{id}/accounts`; total = sum of balances; "Available" shows 0 for negative balances.                                                                                                                                                                                                                             |
| Open new account      | CHECKING or SAVINGS; $100 minimum moved from the chosen funding account. The `createAccount` response reports balance 0, but the persisted balance is $100.                                                                                                                                                                                                                  |
| Transfer funds        | Persists a "Funds Transfer Sent" debit and a "Funds Transfer Received" credit. Empty amount: server HTTP 400, UI shows a generic "Error!" panel, and no money moves.                                                                                                                                                                                                         |
| Bill pay              | Persists a debit "Bill Payment to {payee}". Client-side validation for all payee fields, account-number confirmation mismatch, and amount.                                                                                                                                                                                                                                   |
| Find transactions     | By id, date, date range and amount (`services_proxy/bank/accounts/{id}/transactions/...`). Non-numeric amount: "Invalid amount" (client-side).                                                                                                                                                                                                                               |
| Update contact info   | Persisted through `services_proxy/bank/customers/update/{id}`; first/last name, address, city, state and ZIP are required client-side.                                                                                                                                                                                                                                       |
| Request loan          | Decided synchronously by "Wealth Securities Dynamic Loans (WSDL)". Affordable request approved: a new LOAN account holding the loan amount, and the down payment is taken from the funding account. Too large: "We cannot grant a loan in that amount with your available funds." Down payment above balance: "You do not have sufficient funds for the given down payment." |

### Product findings (documented, deliberately not asserted)

There is no published requirement for these, so the suite neither enshrines them as correct
nor fails on them. They are candidates for defects:

1. **Transfers accept zero and negative amounts and allow overdrafts** (observed through the
   same endpoint the UI uses). A negative amount moves money in reverse.
2. **The amount validation messages on Transfer Funds are never shown**: an empty amount
   reaches the server and produces a generic "internal error" page.
3. **Protected pages answer HTTP 500 to signed-out visitors** instead of redirecting to login.
4. **Security: ParaBank logs credentials and identity data.** Every login writes the username
   and the plaintext password to the application log (INFO and WARN), and customer objects are
   dumped with password and SSN. Observed on the official image and the source build alike. CI
   therefore archives only redacted container logs (`scripts/ci/environment.ts`).
5. **Security: the customer's password is embedded in clear text** in the Update Profile page
   script and sent in the update request's query string. The registration POST also carries it
   (expected for a form). This drives the artifact policy below.

### Environment constraints

- **Rate limiting (measured):** a 2-worker run triggered Cloudflare **HTTP 429** for the whole
  site (`Retry-After: 175`). With one worker and images not downloaded, a run is blocked after
  roughly 22 scenarios in about 50 seconds, for 300 seconds. A full run of 27 scenarios (or smoke
  followed by regression) therefore does not reliably fit in one window on the public site. The
  suite does **not** pace itself with sleeps to get under the limit; it reports these failures
  as environment instability. The remedy is an isolated ParaBank instance (see the README).
- **Bot challenge:** sporadic HTTP 403 with `cf-mitigated: challenge` ("Just a moment...") on
  registration posts, from both the browser and HTTP paths, independent of the submitted data.
  The suite never tries to bypass it.
- **Shared configuration:** the public Admin page (`admin.htm`, inspected read-only) exposes
  Database Initialize/Clean, the initial and minimum balances, and the loan provider, processor
  (Available Funds / Down Payment / Combined) and threshold settings. Anyone can therefore
  change opening balances, the $100 minimum deposit, loan decisions, or wipe customers during
  a run. The suite never assumes an opening balance. Failures of the minimum-deposit or loan
  assertions should first be triaged as possible environment drift (check `admin.htm`).

## Coverage matrix

Priority: P0 = money, identity or access; P1 = important business rule or state; P2 = validation
and navigation.

| Feature file                  | Scenario                                               | Priority | Type             | Verified through                               |
| ----------------------------- | ------------------------------------------------------ | -------- | ---------------- | ---------------------------------------------- |
| public/home                   | Visitor reaches registration from home (outline row)   | P2       | positive         | UI navigation                                  |
| public/home                   | Visitor reaches login recovery from home (outline row) | P2       | positive         | UI navigation                                  |
| authentication/sign-in        | Registered customer signs in (smoke)                   | P0       | positive         | UI + own account shown                         |
| authentication/sign-in        | Wrong password refused                                 | P0       | negative         | UI message + API 401                           |
| authentication/sign-in        | Empty credentials refused                              | P2       | negative         | UI message                                     |
| authentication/sign-in        | Sign-out ends the session                              | P0       | state transition | UI + API 401                                   |
| authentication/login-recovery | All identity details required                          | P2       | negative         | UI messages                                    |
| registration                  | New customer registers with a funded account (smoke)   | P0       | positive         | UI + accounts data                             |
| registration                  | Password confirmation mismatch                         | P1       | negative         | UI message, not signed in                      |
| registration                  | Duplicate username                                     | P1       | negative         | UI message, not signed in                      |
| registration                  | All mandatory details required; phone optional         | P2       | negative         | UI messages                                    |
| accounts                      | Overview matches the bank's records (smoke)            | P0       | positive         | UI rows/total vs API                           |
| accounts                      | Open SAVINGS account (outline row)                     | P0       | state transition | UI + new account type/balance + funding debit  |
| accounts                      | Open CHECKING account (outline row)                    | P1       | state transition | same                                           |
| transfers                     | Transfer $100.00 (outline row, smoke)                  | P0       | positive         | UI + both balances + one ledger entry each     |
| transfers                     | Transfer $0.01 (outline row)                           | P1       | boundary         | same                                           |
| transfers                     | Transfer without amount                                | P1       | negative         | UI rejection + ledger unchanged                |
| payments                      | Pay a bill                                             | P0       | positive         | UI + balance + one debit to payee              |
| payments                      | Mismatched account confirmation                        | P1       | negative         | UI message + no submission + ledger unchanged  |
| payments                      | All payee details required                             | P2       | negative         | UI messages + no submission                    |
| transactions                  | Find a transaction by amount                           | P1       | positive         | result row = exact transaction id from API     |
| transactions                  | Non-numeric search amount                              | P2       | negative         | UI message, no results                         |
| profile                       | Contact details saved                                  | P1       | positive         | UI + stored profile + identity unchanged       |
| profile                       | First name required                                    | P2       | negative         | UI message + no submission + profile unchanged |
| loans                         | Affordable loan approved                               | P1       | positive         | UI + new LOAN account + down payment debited   |
| loans                         | Denied: funds too low (outline row)                    | P1       | negative         | UI reason + ledger unchanged                   |
| loans                         | Denied: down payment not covered (outline row)         | P2       | negative         | UI reason + ledger unchanged                   |

> **Superseded on 2026-10-06** by the functional audit on the controlled DEV environment:
> [functional-coverage.md](functional-coverage.md) (79 scenarios, traceability matrix, error
> inventory, boundaries) and [defects.md](defects.md) (product defects PB-01 to PB-20). The
> exclusions below applied to the public site; on DEV, cross-customer authorization, search by date
> and range, and successful login recovery (with credential-safe assertions) are now automated.

### Deliberately not automated

- **Successful login recovery:** it displays the customer's username and password on screen,
  which would put a credential into screenshots and reports.
- **Cross-customer authorization (IDOR):** probing access to other customers' data is security
  testing on a shared public system. Recommended only for an isolated environment.
- **Find by date / date range:** dates are rendered in browser local time from a server
  timestamp. They need a controlled time zone and clock to be asserted without flakiness.
- **Account activity month/type filters:** lower risk; transaction persistence is already
  verified through the API for every money movement.
- **Admin, web-service and database-reset functions:** they change shared global state.

## Financial oracle (audited)

Rule: ParaBank supplies only the **initial** state (read before the action) and the **actual**
state (read after it). The test computes every **expected** value itself from the initial state
and the scenario's known inputs. Responses of the action under test (the confirmation page, the
`createAccount` response, the loan response) only identify new accounts and are never used as
expected values.

- Money is integer cents. Gherkin amounts are parsed exactly from decimal strings; JSON numbers
  are converted with a guard that **rejects** sub-cent precision instead of rounding it away;
  formatting uses integer arithmetic only. Currency symbols, commas and comma decimals are
  rejected, not guessed.
- One ledger snapshot (every account's type, balance and full transaction content) is taken
  right before the action and one right after it, shared by all outcome steps of the scenario.
- Balances: `expectedAfter = before ± known amount`, compared with the persisted balance.
- Postings: each involved account must have **exactly** the expected new transactions, compared
  by account, direction, description and amount. Every other account must be completely
  unchanged, and no account may appear except the expected new one. This rejects a wrong
  amount, wrong direction, wrong account, duplicate, missing posting, unexpected new account and
  a mutated old transaction (verified offline with synthetic ledgers).
- No-op outcomes compare the full before/after ledgers (types, balances, every transaction).
  Client-side validation scenarios also assert that no state-changing request was sent.
- The accounts overview is compared with an independent model (opening balance - $100 deposit,
  $100), both for the rendered page and for the persisted balances. It is no longer compared
  only with the API data the page itself rendered.
- OBSERVED BEHAVIOR used as expectations (no published requirement): opening deposit $100
  (also stated on the Open New Account page; configurable on the admin page), posted as
  "Funds Transfer Sent" / "Funds Transfer Received"; transfers posted the same way; bill
  payment posted as one debit "Bill Payment to {payee}"; loan approval opens a LOAN account
  holding the loan amount and posts one debit "Down Payment for Loan # {loan account}" on the
  funding account. The new LOAN account has no transaction at all, which is observed and
  deliberately not asserted.
- UI confirmations are secondary evidence only: the transfer confirmation merely echoes the
  amount typed in the browser, so persistence checks carry the verdict.

## Rate-limit investigation (2026-10-05)

Measured with `NET_DIAG=true` (per-scenario request accounting in
`reports/network-diagnostics.jsonl`; redacted paths, statuses and safe headers only).

Facts:

- The first 429 came at scenario 15 of a fail-fast run, after **221 requests in 38 s** (65 in
  the preceding 10 s). It hit an API-client `GET /services_proxy/bank/customers/{n}` with
  `Retry-After: 300`. Earlier runs hit their first 429 on other paths (`register.htm`,
  `index.htm`, accounts endpoint).
- Within 13 s of the trigger, cookieless `curl` requests for unrelated resources (`style.css`,
  `about.htm`) also got 429 with `Retry-After: 291`. The block is site-wide, does not depend on
  the browser session, and the header counts down from 300.
- 429s were still returned 288 s after the trigger. The exact release time of that block was not
  captured (the probe process was suspended). Earlier blocks cleared about 1 to 2 minutes after
  the last observed 429.
- Cost per scenario: public 8 requests; sign-in/out 13 to 17; bill-pay validation 11 to 15;
  bill pay 16; loans 16 to 17; open account 18; transfers and search 20; overview 14. About
  6 per scenario are CSS/JS re-fetched per page load, and 1 registration POST plus 1 GET per
  authenticated scenario. About 30 images per scenario are not downloaded (blocked locally).
  The UI registration scenarios were not measured.
- Assertion cost: state checks account for 4 to 10 API reads per financial scenario. A shared
  after-snapshot made the strengthened assertions cheaper than before (open account 19 -> 18
  requests, loan approval 18 -> 17).
- Separate groups of 4, 3 and 5 financial scenarios (80, 50 and 80 requests) run minutes apart
  did not trigger a block.

Inference (not confirmed): a Cloudflare rate-limiting rule keyed on the client IP that counts
requests to the whole site over a short window and then blocks everything for about 300 s.
The trigger point varied between runs (roughly 14 to 22 scenarios), which suggests a
window-based or approximate count rather than a fixed total. Registration-specific limiting
is not supported by the evidence (registrations were never the first rejected request), but it
cannot be excluded. The exact threshold and window are unknown.

## Test data and traffic

- One synthetic customer per authenticated scenario, created through public registration:
  fictional names, "Example" streets, the 555-01xx phone range, never-issued 000-xx-xxxx SSNs,
  `qa…` unique usernames and random per-customer passwords that are never logged.
- About 22 registrations per full run. Scenarios run on one worker by default (see rate limit),
  and decorative images and fonts are not downloaded, to keep load on the shared site low.
- There is no cleanup API. ParaBank periodically resets its own database.

## Controlled environment (DEV), 2026-10-05

Strategy: Parasoft's official prebuilt image `parasoft/parabank`, pinned by digest
`sha256:a227a8228b4d58c7b803115c3c9ff81ae3229a7655d5c291d2fe3347899699fc` (multi-arch index,
published 2026-10-02; Tomcat 11.0.26, JDK 25, WAR built with JDK 21, HSQLDB 2.7.4). Building from
source was not needed to obtain a controlled environment. The image's tags (`latest`,
`baseline`, `feature`) are mutable, so only the digest is used.

Facts observed on the container:

- Database: embedded HSQLDB server started inside Tomcat (`jdbc:hsqldb:hsql://localhost/parabank`),
  files under `WEB-INF/db` in the container's writable layer; no volume is declared.
- Seed data (`insert.sql`): `initialBalance=515.50`, `minimumBalance=100.00`, loan provider `ws`,
  processor `funds`, threshold 20, i.e. the same defaults the suite's observed-behavior
  expectations are based on, plus two well-known demo customers that the suite never uses.
- `docker compose restart`: data persists. Recreating the container: back to the seed state
  (a marker customer registered before could no longer log in; the seeded demo customer could).
  Recreating from the pinned image is therefore the deterministic, non-destructive reset; the
  admin page's Initialize/Clean actions are not needed.
- Startup to healthy: about 20 s (Tomcat reports ~17 s).

Results: 27/27 scenarios in a single run (17 to 19 s, 379 requests, 0 HTTP 429, 0 HTTP 403),
repeated on a fresh and on a reused database. The only non-2xx responses are expected ones: one
400 (empty transfer amount), two 401 (sign-out and wrong-password checks), two 302 (login).

### Product finding: registration is not safe under concurrency

With 4 Cucumber workers, 1 to 2 of 27 setup registrations were not confirmed. Reproduced outside
the suite with 8 simultaneous registrations in isolated sessions: 4 to 5 of 8 silently failed (the
registration form was re-rendered and no customer was created). In one case the session of a
"confirmed" registration was bound to a different customer than the one its credentials log in
to. Customer ids advance by a shared step (+111), which is consistent with a non-atomic id
generation race. Classification: application behavior (concurrency defect), not automation.
Consequence: the suite runs with one worker (`CUCUMBER_PARALLEL=1`) on every environment.

### Public site drift observed during this phase

The public admin settings had been changed by a third party to `initialBalance=515.50550` and
`minimumBalance=100.00110` (sub-cent values). Right after a confirmed registration, the public
`overview.htm` answered with ParaBank's internal-error page, so the 4 public smoke scenarios
failed while waiting for the accounts data. Classification: environment configuration drift. The
same scenarios pass on DEV, whose settings are the image defaults.

## Source-built application and provenance (2026-10-05)

| Item              | Value                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Source            | `https://github.com/parasoft/parabank.git` @ `13cc8d4c0b978d8da261cad8f2d39b5ed5c0a05b` (master, 2026-10-02; tag `selenium-demo-baseline`)      |
| Build             | `mvn --batch-mode --no-transfer-progress clean install` in `maven:3.9.16-eclipse-temurin-21-noble@sha256:99e61abc…` (Maven 3.9.16, JDK 21.0.12) |
| Application tests | surefire 236 run / 0 failures / 0 errors / 0 skipped; failsafe (Selenium Chrome) 3 / 0 / 0 / 0                                                  |
| Artifact          | `parabank.war` (6.0.0-SNAPSHOT), sha256 `654c30cc047c13024b84cfe7547487228bf279c9cb0d353ca24ae046b2b6c373`                                      |
| Runtime base      | `tomcat:11.0.26-jre25-temurin-noble@sha256:8c40d472…`                                                                                           |
| Image             | `parabank-local:13cc8d4c0b97`, image ID `sha256:73e7e2775a1c65b62007b7046338b719481dd142082bcbb2afcf073b8669f795` (local only, not pushed)      |

Build investigation (classified before any change; no tests skipped):

1. First build: 236/236 unit tests passed; the 3 Selenium integration tests errored ("Driver
   server process died prematurely, exit value: 127"). There was no browser in the build image.
   Classification: build-environment prerequisite.
2. With Chrome's libraries and a non-root build user: still 3 errors ("Chrome instance exited").
   Reproduced in isolation: "No usable sandbox!", because the build container's seccomp profile
   blocks the user namespaces Chrome's sandbox needs. The upstream test does not pass
   `--no-sandbox`. Classification: build-environment constraint, not a product or test defect.
3. Decision (approved): a pinned, checksum-verified Chrome for Testing 154.0.8037.92 plus
   ChromeDriver in the build stage only, exposed to Selenium as a `google-chrome` wrapper that
   adds `--no-sandbox`, with Selenium Manager offline. Result: BUILD SUCCESS, 239/239 tests.

Comparison with the vendor baseline image: all **411 deployed application files are
byte-identical** (same paths and sha256, classes, JARs, JSPs and manifest included). Runtime
configuration is identical (JDBC access mode, initial balance 515.50, minimum balance 100.00,
loan provider "Web Service", processor "Available Funds", threshold 20). Sequential
registration, login, the overview page structure, the accounts endpoint and the 6 service pages
behave the same. Differences are outside the application: our runtime layer skips the upstream
Dockerfile's `apt dist-upgrade`/`unzip` (unpinned) and exposes only port 8080; labels differ.
Classification: no version, configuration or behavior difference. Inference: the vendor image
was built from this commit, and ParaBank's Maven build output is deterministic.

Suite results on the source-built image (one worker): smoke 4/4; financial domains 14/14; full
regression 27/27 in one run (28.5 s, 379 requests, 0 HTTP 429, 0 HTTP 403; non-2xx only the
expected 400/401/302). Recreating DEV from the same image (same image ID, marker customer gone,
seed present) followed by smoke: 4/4.

Future build once / promote (not implemented): one pipeline run builds `parabank-local:<commit>`
once and records its image ID. DEV runs `PARABANK_IMAGE=<that image>`, then smoke, regression and
the quality gate. QA then runs `PARABANK_ENV=qa PARABANK_PORT=… PARABANK_IMAGE=<same image ID or
registry digest>`. The image is never rebuilt between DEV and QA; `npm run dev:image` (and the same
inspection in QA) proves both run the same image ID and revision. A registry push would add an
immutable repo digest for cross-host promotion.
