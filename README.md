# ParaBank BDD — Playwright + TypeScript + Cucumber

Risk-based functional test suite for Parasoft's [ParaBank](https://github.com/parasoft/parabank)
demo bank. Scenarios are written in Gherkin as business behavior. Cucumber executes them, and
Playwright drives the browser and the bank's own JSON endpoints underneath.

The same suite runs against either controlled environment; nothing in the features, steps or
pages is environment-specific (`TARGET_ENV` selects the target):

| Environment | URL                               | What it is                                                                   |
| ----------- | --------------------------------- | ---------------------------------------------------------------------------- |
| `qa`        | `http://localhost:8090/parabank/` | Every deploying build is validated here (default target)                     |
| `uat`       | `http://localhost:8091/parabank/` | MAIN builds: QA Regression, approval, then the same image ID here, UAT Smoke |

Both run the same immutable, source-built ParaBank image, built once and promoted by image ID
(see [Environments](#environments) and [docs/ci-cd.md](docs/ci-cd.md)). The public ParaBank site
is not a test target.

## Why Playwright + Cucumber

- **Gherkin** makes the coverage readable and reviewable by QA, developers, product owners and
  analysts, without knowledge of Playwright.
- **Playwright** gives reliable auto-waiting, network-aware synchronization and an
  `APIRequestContext` that shares the browser session. That lets scenarios verify persisted bank
  state, not only what the page says.
- **One test engine, two entry points:** Cucumber executes every scenario. `npx playwright test`
  is the standard Playwright entry point: it declares one Playwright test per Gherkin scenario
  and has Cucumber execute it through Cucumber's official programmatic API
  (`@cucumber/cucumber/api`). The `.feature` files remain the only definition of the tests;
  there are no hand-written or generated `*.spec.ts` copies of the scenarios.

## Architecture

```
npx playwright test (canonical)               npx cucumber-js --profile <suite>
  playwright.config.ts: workers 1, preflight     cucumber.js profiles
  playwright/cucumber.spec.ts                    (native engine; CI tooling uses its
    plan  = Cucumber dry run (77 pickles)         JSON report)
    test  = runCucumber(feature:line)                    │
      └──────────────────────┬───────────────────────────┘
                             ↓
Feature files (features/**/*.feature)        business behavior, tags, examples (source of truth)
      ↓
Step definitions (src/step-definitions)     thin coordination + business assertions
      ↓
Page Objects (src/pages)                    selectors, navigation, interactions (no assertions)
Support (src/support)                       World, hooks, parameter types, ledger, provisioning
API client (src/api)                        thin transport to ParaBank's services_proxy endpoints
Factories (src/factories)                   synthetic customers, payees, contact details
      ↓
Playwright (Chromium)  →  ParaBank
```

| Layer                            | Responsibility                                                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `features/`                      | One folder per business domain; scenarios state preconditions explicitly in `Given` steps.                                                             |
| `src/step-definitions/`          | One file per domain plus shared `customer`, `feedback` and `ledger` steps. No selectors, no transport code, no random data.                            |
| `src/pages/`                     | One class per ParaBank page, plus the `Feedback` component for error messages. Locators come from the inspected DOM.                                   |
| `src/support/world.ts`           | Typed per-scenario state: browser context, page objects, API client, the customer, account ids, the ledger baseline and the recorded POST submissions. |
| `src/support/hooks.ts`           | Lifecycle only: browser per worker, context per scenario, failure screenshot, optional trace. No business preconditions.                               |
| `src/support/provisioning.ts`    | Creates a fresh synthetic customer per scenario through public registration, in its own HTTP session (setup); sign-in is a visible step.               |
| `src/support/ledger.ts`          | Captures balances and transaction ids, before and after, for state assertions.                                                                         |
| `src/support/parameter-types.ts` | `{money}` (converted to integer cents), `{accountRole}`, `{accountType}`, `{entryPoint}`.                                                              |
| `src/api/parabank-client.ts`     | Thin client for the endpoints the UI itself calls; it never logs bodies.                                                                               |
| `src/factories/`                 | All synthetic-data generation.                                                                                                                         |
| `scripts/check-target.ts`        | Read-only health check before any scenario runs; `--wait` polls with a bounded timeout.                                                                |
| `src/support/config.ts`          | The only place a target URL is resolved (`TARGET_ENV` = `qa`/`uat`, `PARABANK_BASE_URL`); environments are defined in `environments.ts`.               |

```
.
├── features/            (incl. authorization/customer-data-isolation.feature)
│   ├── public/home.feature
│   ├── authentication/{sign-in,login-recovery}.feature
│   ├── registration/registration.feature
│   ├── accounts/accounts.feature
│   ├── transfers/transfer-funds.feature
│   ├── payments/bill-pay.feature
│   ├── transactions/find-transactions.feature
│   ├── profile/update-contact-info.feature
│   └── loans/request-loan.feature
├── src/
│   ├── api/            parabank-client.ts, types.ts
│   ├── factories/      customer.factory.ts, payee.factory.ts
│   ├── pages/          *.page.ts, account-services.menu.ts, feedback.component.ts, index.ts
│   ├── step-definitions/  *.steps.ts
│   ├── support/        world.ts, hooks.ts, config.ts, assertions.ts, ledger.ts,
│   │                   provisioning.ts, parameter-types.ts
│   └── utils/          money.ts
├── scripts/check-target.ts   target health check (one-shot or bounded polling)
├── Jenkinsfile           Multibranch CI/CD: build once → QA; main → approval → same image to UAT → Smoke
├── compose.yaml          the QA and UAT environments (one definition, separate Compose projects)
├── docker/parabank/      source-built ParaBank image: Dockerfile + pinned source commit
├── docker/ci-agent/      Jenkins agent image: pinned Playwright + Docker CLI
├── scripts/environment.ts   QA/UAT deploy, start, stop, status, health, image identity (redacted logs)
├── scripts/ci/           host lock, per-suite coverage validator
├── scripts/build-parabank-image.ts   build once, with provenance
├── docs/qa-coverage.md   discovery evidence, product findings, risk & coverage matrix
├── cucumber.js           profiles: default, full, smoke, sanity, regression, known-defects
├── playwright.config.ts  Playwright Test entry point: one worker, target preflight, reports
├── playwright/           adapter only: scenario plan + per-scenario Cucumber run (no test logic)
└── .github/workflows/playwright.yml
```

## Prerequisites

- Node.js 22 or later (required by Cucumber 13)
- npm
- Docker with Compose v2 (Docker Engine 25+ for the healthcheck's `start_interval`), for QA/UAT

## Installation and configuration

```powershell
npm ci
npm run browsers:install
```

Optional local overrides: copy `.env.example` to `.env`. It is git-ignored and loaded
automatically. The file contains placeholders and settings only. No credentials are needed,
because every customer is created per scenario.

| Variable              | Default   | Purpose                                                                             |
| --------------------- | --------- | ----------------------------------------------------------------------------------- |
| `TARGET_ENV`          | `qa`      | `qa` (port 8090) or `uat` (port 8091), from `src/support/environments.ts`           |
| `PARABANK_BASE_URL`   | (unset)   | Address of the selected environment when not on localhost (Jenkins container agent) |
| `REPORTS_DIR`         | `reports` | Where a run writes its reports (CI: `reports/<env>/<suite>`)                        |
| `HEADLESS`            | `true`    | `false` shows the browser (headed/debug runs)                                       |
| `SLOW_MO`             | `0`       | Milliseconds between Playwright actions, for watching a run                         |
| `CUCUMBER_PARALLEL`   | `1`       | Worker count; keep 1 (ParaBank registration is not concurrency-safe, see below)     |
| `CUCUMBER_RETRY`      | `0`       | Retries for failed scenarios; retried scenarios are reported as such                |
| `PW_TRACE_ON_FAILURE` | `false`   | Save a Playwright trace for failed scenarios (local use only, see Security)         |
| `NET_DIAG`            | `false`   | Per-scenario request accounting in `reports/network-diagnostics.jsonl` (redacted)   |

## Environments

Two controlled environments, defined once in `src/support/environments.ts` and run from one
`compose.yaml` as separate Compose projects: separate containers, separate embedded databases,
loopback ports only. Each one is deployed, started, stopped and health-checked on its own.

| Environment | Compose project | URL                               | Typical use                                      |
| ----------- | --------------- | --------------------------------- | ------------------------------------------------ |
| QA          | `parabank-qa`   | `http://localhost:8090/parabank/` | PR/push: Smoke, Impacted Tests; main: Regression |
| UAT         | `parabank-uat`  | `http://localhost:8091/parabank/` | MAIN builds after approval: UAT Smoke            |

```powershell
npm run app:build          # BUILD ONCE: source-built image, ID recorded in build/parabank-image.json
npm run qa:deploy          # fresh QA container (fresh database) from that image ID
npm run uat:deploy         # PROMOTE: the same image ID to UAT (never a rebuild)
npm run env:identity       # fails unless QA and UAT run the same image ID (Docker metadata)
npm run qa:health          # container healthy + application serving (uat:health likewise)
npm run qa:status          # container, state, health, image ID, port
npm run qa:stop            # stop QA only (its data is kept); UAT keeps running
npm run qa:start           # start QA again and wait until it is healthy
npm run test:smoke                          # against QA (default)
$env:TARGET_ENV = 'uat'; npm run test:smoke # the same tests against UAT (Bash: TARGET_ENV=uat ...)
```

`npm run env -- deploy uat <image ID>` deploys an explicit image ID. `compose.yaml` has no
default image: an environment can only be created from an explicit image ID, so it can never
fall back silently to another image. State: ParaBank keeps its data in the container's embedded
HSQLDB; stop/start keeps it, a deploy starts from the image's seed data. Scenarios do not depend
on either: each one creates its own synthetic customer.

## Application image: source-built, promoted by ID

QA and UAT run the source-built image: ParaBank built by this project from a recorded commit of
the official source, with its own tests. Tests never change with the image.

### Source and revision strategy

- Repository: `https://github.com/parasoft/parabank.git` (official Parasoft source).
- Revision: one full commit SHA in [`docker/parabank/source.env`](docker/parabank/source.env),
  currently `13cc8d4c0b978d8da261cad8f2d39b5ed5c0a05b`. Never a branch name; upgrading means
  changing that line deliberately.
- The ParaBank source is **not** copied into this repository. The build fetches exactly that
  commit and verifies `git rev-parse HEAD` before building.

### Build prerequisites

Docker only (BuildKit, Docker Engine 25+). Java, Maven and the browser used by ParaBank's own
integration tests are pinned inside the build (`docker/parabank/Dockerfile`): Maven 3.9.16 on
Temurin JDK 21 (the POM requires Maven ≥ 3.9.0, Java release 21), runtime
`tomcat:11.0.26-jre25-temurin-noble`, all by digest. Network access to GitHub, Maven Central and
the Chrome for Testing storage is needed during the build. amd64 hosts only for now (the pinned
Chrome for Testing build is linux64).

### Build the image

```powershell
npm run app:build
```

This runs ParaBank's official build, `mvn clean install`, **including its tests**: 236 unit tests
and 3 Selenium integration tests against a Tomcat started by the build. A failing test fails the
image build. Results:

- image `parabank-local:<first 12 chars of the commit>`; an existing tag is never overwritten
  (one tag = one image ID). To rebuild deliberately: `docker image rm parabank-local:<tag>`;
- `build/parabank-image.json`: provenance record (image ID, commit, WAR sha256, test totals,
  whether the Maven layer came from the build cache);
- `build/parabank-build.log`: full build output.

The image carries its own provenance: OCI labels `org.opencontainers.image.source`,
`.revision` and `.version` (the commit), `.base.name` (runtime base with digest), and
`/opt/parabank/provenance/` (commit, WAR sha256, application test totals; outside `webapps/`,
never served over HTTP). The build context is `docker/parabank/` only, so nothing from this
repository (`.env`, `node_modules`, reports) can enter the image.

Two build-environment adaptations, both build stage only (the runtime image contains neither):
ParaBank's Selenium tests need a browser, so a pinned Chrome for Testing release (checksum
verified) is installed; and because the build sandbox blocks Chrome's own sandbox ("No usable
sandbox!") while the upstream test does not pass `--no-sandbox`, Selenium finds Chrome through a
`google-chrome` wrapper adding that flag. ParaBank's source and tests are unmodified.

### Why one Cucumber worker

ParaBank's registration is not safe under concurrency: simultaneous registrations can silently
fail or bind a session to the wrong customer (see `docs/qa-coverage.md`). Every scenario creates
its own customer, so the suite runs with `CUCUMBER_PARALLEL=1` on every environment. Do not raise it.
The Playwright entry point is pinned to `workers: 1`, and its global setup refuses a command-line
override such as `--workers 2`.

## Running

### Playwright Test (canonical)

`npx playwright test` is the canonical command: it is the standard entry point of a Playwright
project, it checks the target once before any scenario (a dead environment fails in seconds as
`TARGET UNAVAILABLE` instead of as dozens of `ECONNREFUSED` failures), and it guarantees one worker.
Gherkin tags are Playwright tags, so `--grep` selects exactly what Cucumber's tag filter selects.

| Command                                                  | What it runs                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `npx playwright test`                                    | Full: the 52 normal scenarios (`@known-defect` excluded)                     |
| `npm run test:known-defects`                             | The 25 known-defect scenarios (16 defect IDs), reported as expected failures |
| `npx playwright test --grep @smoke`                      | Smoke: 4                                                                     |
| `npx playwright test --grep @regression`                 | Regression: 24                                                               |
| `npx playwright test --grep @sanity`                     | Sanity: 10 (manual / on demand)                                              |
| `npx playwright test --list`                             | Discovery only (Cucumber dry run)                                            |
| `npx playwright test --grep "transfer-funds.feature:27"` | One scenario, by feature-file location                                       |

Results: `reports/playwright/html` (`npx playwright show-report reports/playwright/html`) and
`reports/playwright/junit.xml` (known-defect runs: `reports/playwright-known-defects/`); Cucumber's
failure screenshot and notes are attached to the test.

#### Interactive runs (UI Mode, headed)

Playwright Test owns the browser (its `browser` fixture is lent to the Cucumber hooks), so the
standard Playwright tooling observes the real ParaBank session:

```powershell
npx playwright test --ui                                  # interactive runner
npx playwright test --headed --grep "sign-in.feature:10"  # visible browser, one scenario
$env:SLOW_MO = '300'; npx playwright test --headed --grep @smoke
```

In UI Mode, select a **scenario** row (not a feature group) and run it. Its Actions list shows every
Playwright call (navigation, fills, clicks, `expect` with locators) with the DOM snapshot, source
location in the Page Object / step file, network and console. The browser panel shows the trace of
the selected row: it reads `about:blank` with "Did not run" for a group row, a scenario not run in
this UI session, or after a source change (UI Mode reloads and clears results), and during the
first seconds of a run, before the scenario has opened a page. Gherkin steps are not grouped as
Playwright steps; the Cucumber summary is attached to each test.

UI Mode always records a local trace, which includes the synthetic customer's password (fill
actions and network). It is synthetic data, but do not share those traces.

### Native Cucumber

The same scenarios, executed by `cucumber-js` directly. The CI tooling (Jenkinsfile,
`scripts/ci/verify-suite-coverage.ts`) consumes this runner's JSON report.

| Command                                   | What it runs                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm run test:smoke`                      | Smoke (`@smoke`): 4 critical-path scenarios, fast gate                                           |
| `npm run test:sanity`                     | Sanity (`@sanity`): 10 scenarios, one main positive path per functional area, manual / on demand |
| `npm run test:regression`                 | Regression (`@regression`): 24 risk-selected scenarios (money, identity, business rules)         |
| `npm run test:full` / `npm test`          | Full suite: all 52 gating scenarios                                                              |
| `npx cucumber-js --profile known-defects` | The 25 known-defect scenarios ([docs/defects.md](docs/defects.md)); expected to fail             |
| `npm run test:dry-run`                    | Scenario discovery: fails on undefined or ambiguous steps, no browser                            |
| `npm run check:target`                    | Is the configured ParaBank reachable and genuine?                                                |

Pass Cucumber options after `--`:

```powershell
npm test -- --tags "@transfer and @p0"
npm test -- features/loans/request-loan.feature
npm test -- features/transfers/transfer-funds.feature:27   # one scenario by line
```

For headed debugging, set `HEADLESS=false` (and optionally `SLOW_MO=250`) in `.env`.

## Tags

| Tag                                                                                                                                 | Meaning                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `@smoke`                                                                                                                            | 4 scenarios: sign-in and sign-out, registration, accounts overview, transfer $100                |
| `@sanity`                                                                                                                           | 10 scenarios: one main positive path per functional area                                         |
| `@regression`                                                                                                                       | 24 risk-selected scenarios; risk matrix in [docs/test-suites.md](docs/test-suites.md)            |
| (no suite tag)                                                                                                                      | Full suite only: lower-risk validation, boundary and search checks (all 52 run with `test:full`) |
| `@known-defect` `@PB-xx`                                                                                                            | States the correct behavior of product defect PB-xx; excluded from every gating suite            |
| `@p0` / `@p1` / `@p2`                                                                                                               | Risk priority: money, identity and access / business rules and state / validation and navigation |
| `@public` `@authentication` `@authorization` `@registration` `@accounts` `@transfer` `@payments` `@transactions` `@profile` `@loan` | Business domain                                                                                  |

## Reports and artifacts

Every run writes to `reports/` (git-ignored). `npx playwright test` writes
`reports/playwright/` (HTML report, JUnit, per-test output); `cucumber-js` writes:

- `cucumber-report.html`: human-readable report with failure screenshots attached
- `cucumber-report.json`: machine-readable results
- `cucumber-junit.xml`: JUnit for CI dashboards

Artifacts are failure-focused. A full-page screenshot (password inputs masked) and the failing
path are attached only for failed scenarios. If the edge proxy rejected requests during the
scenario, a note says so, so that rate limiting is not mistaken for a product defect. Videos are
not recorded. Traces are opt-in (`PW_TRACE_ON_FAILURE=true`) and saved to `reports/traces/`.

## Quality gates

```powershell
npm run lint           # ESLint + typescript-eslint (type-aware: floating promises, no sleeps)
npm run format:check   # Prettier
npm run typecheck      # tsc --noEmit, strict
```

ESLint rejects `waitForTimeout` and `page.pause`. Synchronization is done on observable state:
locator assertions, URLs, and the specific network responses each page action waits for.

## CI

**Jenkins is the CI/CD** (Multibranch Pipeline, `Jenkinsfile`); see [docs/ci-cd.md](docs/ci-cd.md).
ParaBank is built **once** per pipeline and QA and UAT run that image by ID:

| Event        | Test plan                                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Push         | By branch prefix: `feature/*` QA Smoke (4); `qa/*` QA Impacted Tests; `config/*` Quality Gates + Config Check only (no deployment)                                                                                        |
| Pull request | Quality gates → config check → build image → deploy QA → QA Smoke (4) → QA Impacted Tests → completeness check = the required `Jenkins` check + `pr-head` status; auto-merge only per PR, never for gate-defining changes |
| `main`       | Quality gates → build image → deploy QA → QA Regression (24) → **manual Jenkins approval** → same image ID to UAT → UAT Smoke (4)                                                                                         |

Quality gates on every push and PR: lint, format, typecheck, strict dry run, test-data audit, BDD
structure check (`scripts/ci/verify-bdd-structure.ts`) and the suite inventories. Each suite run is
checked against its approved size (`scripts/ci/verify-suite-coverage.ts`). Known defects never gate
a deployment (optional stage on `main`, at most UNSTABLE). Cucumber always runs with one worker and
no retries. PRs that change gate-defining files (`.github/gate-defining-paths.json`) are merged
manually; `.github/workflows/gate-guard.yml` turns auto-merge off on them.
**Status:** the current pipeline has not yet run on the real Jenkins; see the runbook in
[docs/ci-cd.md](docs/ci-cd.md).

`.github/workflows/playwright.yml` is a secondary GitHub Actions validation; it is not part of the
Jenkins model and is reviewed with the Git/GitHub integration.

## Test-data strategy

- Each scenario that acts as a customer registers **its own** synthetic customer through
  ParaBank's public registration, in a separate HTTP session that is then discarded (setup). The
  customer then signs in through the sign-in form, and the sign-in is proven (the session's
  customer id is that customer); at the end the customer signs out, and the sign-out is proven
  (HTTP 401 from the customer's accounts). See [docs/scenario-inventory.md](docs/scenario-inventory.md).
- Customers, accounts, payees and transactions are never shared, so scenarios are independent,
  order-free and repeatable (the normal suite also passes in random order).
- Each scenario owns its data: every customer gets its own synthetic names, address, ZIP,
  fictional 555-01xx phone, never-issued 000-xx-xxxx SSN (persistent per-environment cursor),
  unique `qa…` username and random password, from one allocator (`src/factories/test-data.ts`).
  Business inputs are distinct per scenario unless the repetition is the point (boundaries,
  comparison pairs, documented defect reproductions); `npm run audit:test-data` enforces it. See
  [docs/test-data.md](docs/test-data.md).
- Amounts are compared as integer cents. Opening balances are read, never assumed.

## Why a controlled environment (not the public site)

The public ParaBank site is not a test target. Measured on 2026-10-05: Cloudflare blocks the whole
site with HTTP 429 for 300 s after roughly 22 scenarios in ~50 s, sporadic bot challenges (HTTP 403) hit registration, and the site's data and configuration are shared and changeable by anyone
(its admin settings had been changed so that every new customer's accounts overview failed).
QA and UAT are controlled, isolated and deterministic instead.

See [docs/qa-coverage.md](docs/qa-coverage.md) for discovery evidence, product findings,
the coverage matrix and what is deliberately not automated.

## Security approach

Sensitive-data protection is a permanent requirement: passwords, credentials, tokens, cookies,
session ids, authorization headers and identity data must never reach persistent evidence. Tests may
compare such values in memory; only the evidence layer is sanitized, never the assertions.

- No credentials, tokens or personal data are stored in the repository. `.env` is ignored and
  `.env.example` holds placeholders only. Every customer is synthetic and created per scenario.
- **Error redaction:** every step and hook runs through `src/support/evidence.ts`, which removes
  synthetic credentials and SSNs, cookie/authorization header values, `jsessionid` and credential
  query parameters from failure messages before any report sees them. (Playwright's API call log
  prints request headers, including the session cookie, when a request fails at transport level.)
  Every username, password and SSN the customer factory generates is registered with the redaction
  layer when it is created, so it is masked even if no step stored it; the shapes of generated
  credentials are masked as a safety net. The Playwright adapter redacts again before attaching.
- **Screenshots:** masked before capture: password, username and SSN inputs, the login-recovery
  result (prints the credentials, PB-13), the registration greeting (shows the username), and any
  text showing one of the scenario's generated credentials or SSNs.
- **Playwright reports:** Playwright records every action as a report step, and an input step's
  title holds the typed value. `playwright/redacting-reporter.ts` runs before the HTML and JUnit
  reporters and replaces every typed value; other step titles are redacted like error messages.
- **Playwright error context:** the ARIA page snapshot is disabled (`PLAYWRIGHT_NO_COPY_PROMPT`);
  `error-context.md` holds only the redacted error and a source code frame.
- **Traces:** ParaBank embeds the password in the Update Profile page and request URL (PB-18).
  Traces capture fill values, request bodies, cookies and the DOM, and cannot be redacted, so they
  are opt-in locally (`PW_TRACE_ON_FAILURE=true`), never produced or uploaded in CI, and UI Mode
  traces stay on the local machine. Classification of every artifact:
  [docs/functional-coverage.md](docs/functional-coverage.md#artifact-classification-sensitive-data).
- **Assertions** that involve identity data compare in memory and print only a boolean (SSN,
  recovered username); API response bodies are never logged.
- **Authorization checks** are functional only: they use two synthetic customers created by the
  same scenario, on the controlled QA/UAT environments, with the requests ParaBank's own pages send.
  The suite performs no load, brute-force, enumeration, exploitation or admin-page actions.
