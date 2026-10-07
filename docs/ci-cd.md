# CI/CD: build once, QA, then UAT

One `Jenkinsfile`, one **Multibranch Pipeline**. The build event selects the test plan; every
build creates the ParaBank image exactly once and the environments run that image by ID.

```
PUSH (branch)   BUILD IMAGE ─> DEPLOY QA ─> QA READY ─> QA SMOKE
PULL REQUEST    BUILD IMAGE ─> DEPLOY QA ─> QA READY ─> QA SMOKE ─> QA REGRESSION
MAIN            BUILD IMAGE ─> DEPLOY QA ─> QA READY ─> QA SMOKE
                  ─> PROMOTE SAME IMAGE ID TO UAT ─> UAT READY ─> UAT SMOKE ─> UAT REGRESSION
                  [─> KNOWN DEFECTS (optional, never gating)] ─> DEPLOYMENT RECORD
```

The UAT deployment gate:

```
DEPLOY UAT ─> UAT READY ─> SMOKE ──fail──> STOP (build FAILED, Regression not executed)
                             │
                            pass
                             ▼
                         REGRESSION ──fail──> STOP (build FAILED)
                             │
                            pass ──> SUCCESS
```

## Repository, branches and triggers

- **Repository:** https://github.com/vassilva/Automacao-ParaBank-Playwright (public; `main` is the
  default branch).
- **Branches:** `main` is the stable integration branch and the only branch that deploys to UAT.
  Work happens on `feature/*` branches and reaches `main` through a Pull Request.
- **Jenkins job:** Multibranch Pipeline `Automacao-ParaBank-Playwright` (GitHub Branch Source,
  credential `github-app-qa-automation`, the GitHub App "Jenkins QA Automation" installed on the
  repository). The local Jenkins is not reachable from GitHub, so it **scans the repository every
  2 minutes** instead of receiving webhooks; a push is picked up by the next scan.
- **Discovery:** branches, _excluding branches that are also filed as PRs_; PRs from the
  repository itself, built as the PR _merged with its target branch_. A branch with an open PR is
  therefore built once (as the PR), never twice.

| Event                                     | Jenkins build           | Test plan                                                              | UAT? |
| ----------------------------------------- | ----------------------- | ---------------------------------------------------------------------- | :--: |
| Push to a `feature/*` branch without a PR | branch job (PUSH)       | quality gates, build image, deploy QA, QA Smoke (4)                    |  no  |
| PR opened / updated (from this repo)      | `PR-<n>` (PULL REQUEST) | the above + QA Regression (24), on the PR merged with `main`           |  no  |
| Merge into (or push to) `main`            | `main` (MAIN)           | QA Smoke, promote the same image ID to UAT, UAT Smoke → UAT Regression | yes  |

A Pull Request never deploys to UAT: unmerged code is validated on QA only. Recommended GitHub
setting (not configured automatically): protect `main` so that changes arrive through PRs.

## Stages, in execution order

| #   | Stage               | PUSH | PR  | MAIN | What it does                                                                                                            |
| --- | ------------------- | :--: | :-: | :--: | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | Build Context       |  ✓   |  ✓  |  ✓   | Build mode (`CHANGE_ID` → PR; `PARABANK_MAIN_BRANCH`, default `main` → MAIN; otherwise PUSH), build image tag           |
| 2   | Workspace Guard     |  ✓   |  ✓  |  ✓   | Clean `reports/`, `build/`, `deployment/`; refuse a `.env`; require 1 worker and 0 retries                              |
| 3   | Install             |  ✓   |  ✓  |  ✓   | `npm ci`                                                                                                                |
| 4   | Quality Gates       |  ✓   |  ✓  |  ✓   | lint, format, typecheck, dry run, test-data audit; **approved suite sizes**: Smoke 4, Regression 24, Sanity 10, Full 52 |
| 5   | Acquire Host Lock   |  ✓   |  ✓  |  ✓   | One pipeline at a time on the shared QA/UAT host (see Concurrency)                                                      |
| 6   | Build Image         |  ✓   |  ✓  |  ✓   | **The only build**: pinned source commit, ParaBank's own 239 tests, OCI labels; records `IMAGE_ID`                      |
| 7   | Deploy QA           |  ✓   |  ✓  |  ✓   | `env deploy qa <IMAGE_ID>`: fresh `parabank-qa` container (fresh database) from the image ID                            |
| 8   | QA Ready            |  ✓   |  ✓  |  ✓   | Container healthy + application serving + database initialized; QA runs exactly `IMAGE_ID`                              |
| 9   | QA Smoke            |  ✓   |  ✓  |  ✓   | `test:smoke`, then 4/4 executed once and passed                                                                         |
| 10  | QA Regression       |  –   |  ✓  |  –   | Only after QA Smoke passed: `test:regression`, then 24/24                                                               |
| 11  | QA Additional Suite | opt  | opt | opt  | Parameter `ADDITIONAL_QA_SUITE` = `sanity` (10) or `full` (52), after QA Smoke                                          |
| 12  | Promote to UAT      |  –   |  –  |  ✓   | `env deploy uat <QA image ID>` (refused unless QA image ID = built image ID); **no rebuild**                            |
| 13  | UAT Ready           |  –   |  –  |  ✓   | Container healthy + application serving + database initialized; **identity gate**: built = QA = UAT image ID            |
| 14  | UAT Smoke           |  –   |  –  |  ✓   | The deployment gate: `test:smoke`, then 4/4                                                                             |
| 15  | UAT Regression      |  –   |  –  |  ✓   | Only after UAT Smoke passed (`UAT_SMOKE_PASSED`): `test:regression`, then 24/24                                         |
| 16  | Known Defects       |  –   |  –  | opt  | Parameter `RUN_KNOWN_DEFECTS`: the 25 known-defect scenarios on UAT; result at most UNSTABLE, never FAILED              |
| 17  | Deployment Record   |  –   |  –  |  ✓   | `deployment/deployment-record.txt`: source commit, built/QA/UAT image IDs, validation counts                            |

## Why Regression can never run after a failed Smoke

1. Declarative stages run in sequence: a failing `sh` fails its stage, the build is FAILED, and
   every later stage is skipped.
2. Independently of that, each Regression stage has a `when` guard on its Smoke stage's own
   success flag (`QA_SMOKE_PASSED`, `UAT_SMOKE_PASSED`), set only as the last statement of the
   Smoke stage, after both the suite and its count check passed.

Smoke and Regression are separate, sequential stages of one pipeline (separate evidence), never
parallel or independent jobs. Verified locally with the same commands as `runSuite()`: with UAT
stopped, Smoke failed (4/4 failed) and Regression was not executed (no report); with UAT running,
Smoke passed (4/4) and Regression ran (24/24).

## Suite counts and the coverage validator

`scripts/ci/verify-suite-coverage.ts --suite <smoke|sanity|regression|full> --expect <N> [dir]`
validates **one suite at a time**:

- the suite's inventory (Cucumber dry run of its profile) must be exactly the approved size; the
  approved sizes live in the Jenkinsfile (`SMOKE_EXPECTED=4`, `REGRESSION_EXPECTED=24`,
  `SANITY_EXPECTED=10`, `FULL_EXPECTED=52`) and in docs/test-suites.md;
- with a reports directory, the run must have executed exactly that inventory, every scenario
  once, all passed.

It never assumes that suites add up to another suite (Smoke ⊂ Regression in v2, and the UAT
Regression stage runs the complete Regression suite, Smoke scenarios included). The dry run
writes to a relative directory under `reports/`, so it works on Windows as well as Linux (an
absolute `C:\...` path is not a valid Cucumber format option).

## Environments

|                 | QA                                             | UAT                                             |
| --------------- | ---------------------------------------------- | ----------------------------------------------- |
| Compose project | `parabank-qa`                                  | `parabank-uat`                                  |
| Local URL       | `http://localhost:8090/parabank/`              | `http://localhost:8091/parabank/`               |
| From the agent  | `http://parabank-qa-parabank-1:8080/parabank/` | `http://parabank-uat-parabank-1:8080/parabank/` |
| Database        | own container, fresh per deploy                | own container, fresh per deploy                 |
| Deployed by     | every build                                    | MAIN builds that passed QA Smoke                |
| After the build | left running                                   | left running                                    |

Both are defined once in `src/support/environments.ts` and managed by `scripts/environment.ts`
(`npm run qa:deploy|start|stop|status|health`, the same for `uat:`, and `npm run env:identity`).
The same tests target either one by configuration only: `TARGET_ENV=qa` (default) or
`TARGET_ENV=uat`; Jenkins also sets `PARABANK_BASE_URL` to the container address, because a
container agent cannot use the host's loopback port.

## Build once, promote the same image

- The image is built once per pipeline (stage 6); its ID (`sha256:…`) is the identity. Tags are
  only pointers for humans (`parabank-ci:<build>`, removed after the build; `parabank-qa:current`
  and `parabank-uat:current`).
- `compose.yaml` has **no default image**: QA and UAT can only be started with an explicit image
  ID, so a silent fallback to another image (e.g. the vendor image) is impossible.
- Promotion deploys the image ID QA runs, after checking it equals the built ID; UAT Ready then
  reads the image ID of both running containers from Docker and fails unless built = QA = UAT.

## Known defects in CI

The 25 known-defect scenarios document confirmed product defects (docs/defects.md). They are not
part of the deployment gate: a defect that reproduces through its registered proof is the expected
result. On MAIN, `RUN_KNOWN_DEFECTS=true` runs them on UAT after the gate; a scenario that no
longer reproduces, or fails for another reason, marks the build UNSTABLE (never FAILED). Their
Playwright report goes to `reports/uat/known-defects/`.

## Reporting and evidence

Reports are separated per environment and suite, so nothing overwrites anything:
`reports/qa/smoke`, `reports/qa/regression`, `reports/qa/<sanity|full>`, `reports/uat/smoke`,
`reports/uat/regression`, `reports/uat/known-defects`, plus `reports/logs/qa.log` and
`reports/logs/uat.log`. Published: JUnit of every run; archived: the reports, the redacted
container logs, the application build log and provenance record (`build/`), and the deployment
record (`deployment/`). The Phase 3 protections apply unchanged: failure messages, attachments
and Playwright step titles are redacted, screenshots are masked before capture, and Playwright
traces are never produced in CI. ParaBank logs passwords and SSNs in clear text; the environment
script redacts them and refuses to save a log in which any remain.

## Concurrency

QA and UAT are shared by every job of the host, so the build, deploy and test part of a pipeline
holds a **host-wide lock** (`scripts/ci/host-lock.ts`): an atomic Docker network labelled with the
owner (`BUILD_TAG`); waiters poll for at most 60 min (`PARABANK_LOCK_WAIT_MINUTES`); a lock older
than 150 min (`PARABANK_LOCK_STALE_MINUTES`) is removed loudly; it is released in `post`, also on
failure or abort. `disableConcurrentBuilds()` covers one branch/PR job. Cucumber always runs
with one worker and no retries (checked by the Workspace Guard).

## Configuration

| Item                   | Default | Meaning                                                              |
| ---------------------- | ------- | -------------------------------------------------------------------- |
| `PARABANK_MAIN_BRANCH` | `main`  | Global property: builds of this branch promote to UAT                |
| `RUN_KNOWN_DEFECTS`    | `false` | Build parameter (MAIN): run the known defects on UAT                 |
| `ADDITIONAL_QA_SUITE`  | `none`  | Build parameter: `sanity` or `full` on QA after QA Smoke             |
| `GATE_DRILL`           | `none`  | Build parameter (MAIN): `fail-uat-smoke` proves the gate (see below) |

Agent requirements: a Docker-capable Jenkins with the Docker Pipeline plugin and access to the
host Docker socket; host ports 8090 and 8091 free for QA and UAT.

## Gate drill (proving the gate in Jenkins)

`GATE_DRILL=fail-uat-smoke` (MAIN builds only, default `none`) runs UAT Smoke against a port of the
UAT container on which nothing listens. Every Smoke scenario then fails for real, at transport
level, without changing any test or either environment, and the build must end FAILED with UAT
Regression not executed. Run a normal build afterwards to leave UAT validated again.

## Validation status

Executed locally (2026-10-07): QA and UAT deployed from one image ID with the identity gate
passing; independent stop/start of each; data isolation; Smoke, Regression, Sanity and Full on
QA, Smoke and Regression on UAT; the coverage validator on every suite, including its failure on
a wrong approved count; the Smoke → Regression gate at command level. **Not yet executed:** the
Jenkinsfile in Jenkins (the lab Jenkins requires credentials, and the project is not yet in a Git
repository). Validate it with the declarative linter and a first run once Git is set up.

## Readiness: database initialized

ParaBank creates its database lazily, on home-page requests. The container healthcheck's bare
HTTP/1.0 probe triggers that initialization but never completes it, so a freshly deployed
container reports "healthy" while registration still fails with HTTP 500 ("object not found:
SEQUENCE"); found on 2026-10-07 when a suite started right after a deploy. `scripts/environment.ts`
therefore makes one complete home-page request and then requires the application's own "Database
initialized" log line since the container started (a database kept across a restart logs neither
message and is ready at once). `deploy` returns only then, and the QA Ready / UAT Ready stages use
the same check. The log is only searched for that line, never printed or stored (it contains
credentials).
