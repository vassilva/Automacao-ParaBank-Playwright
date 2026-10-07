# CI/CD: PR Smoke, then QA Regression, then UAT Smoke

One `Jenkinsfile`, one **Multibranch Pipeline**. Every build creates the ParaBank image exactly once
and the environments run that image by ID. The test sequence is:

```
PR Smoke (QA) ─> merge ─> QA Regression (deployment gate) ─> UAT deployment ─> UAT Smoke
```

```
PULL REQUEST (CI)  QUALITY GATES ─> BUILD IMAGE ─> DEPLOY QA ─> QA READY ─> QA SMOKE (4)
MAIN (CD)          QUALITY GATES ─> BUILD IMAGE ─> DEPLOY QA ─> QA READY ─> QA REGRESSION (24)
                     ─> PROMOTE SAME IMAGE ID ─> UAT READY ─> UAT SMOKE (4)
                     [─> KNOWN DEFECTS (optional, never gating)] ─> DEPLOYMENT RECORD
```

```
QA REGRESSION ──fail──> STOP (build FAILED, nothing deployed to UAT)
      │
     pass
      ▼
PROMOTE ─> UAT READY ─> UAT SMOKE ──fail──> STOP (build FAILED, no deployment record)
                            │
                           pass ──> SUCCESS
```

Regression validates the newly built application on QA **before** anything reaches UAT. A Pull
Request never deploys to UAT and never runs Regression; the main pipeline runs no QA Smoke and
no UAT Regression.

## Repository, branches and triggers

- **Repository:** https://github.com/vassilva/Automacao-ParaBank-Playwright (public; `main` is the
  default branch).
- **Branches:** `main` is the stable integration branch and the only branch that deploys to UAT.
  Work happens on `feature/*` branches and reaches `main` through a Pull Request.
- **Jenkins job:** Multibranch Pipeline `Automacao-ParaBank-Playwright`, created in the Jenkins UI
  as a copy of the ServeRest job: GitHub Branch Source with the credential
  `github-app-qa-automation` (GitHub App "Jenkins QA Automation", installed on this repository).
- **Discovery (as configured):** branches, _excluding branches that are also filed as PRs_, and PRs
  from the repository itself, built at the **PR head revision**. A branch with an open PR is
  therefore built once, as the PR.
- **Scanning:** the local Jenkins is not reachable from GitHub, so it relies on periodic scans
  instead of webhooks. **The job currently has no periodic scan trigger**: until "Periodically if
  not otherwise run" is enabled (2 minutes recommended), new commits are only discovered by a manual
  "Scan Multibranch Pipeline Now".

| Event                                     | Jenkins build           | Test plan                                                                                                   | UAT? |
| ----------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------- | :--: |
| PR opened / updated (from this repo)      | `PR-<n>` (PULL REQUEST) | quality gates, build image, deploy QA, **QA Smoke (4)**                                                     |  no  |
| Push to a `feature/*` branch without a PR | branch job (PUSH)       | same as a PR                                                                                                |  no  |
| Merge into (or push to) `main`            | `main` (MAIN)           | quality gates, build image, deploy QA, **QA Regression (24)**, promote the same image ID, **UAT Smoke (4)** | yes  |

Recommended GitHub setting (not configured automatically): protect `main` so that changes arrive
through PRs.

## Stages, in execution order

| #   | Stage               | PR / PUSH | MAIN | What it does                                                                                                            |
| --- | ------------------- | :-------: | :--: | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | Build Context       |     ✓     |  ✓   | Build mode (`CHANGE_ID` → PR; `PARABANK_MAIN_BRANCH`, default `main` → MAIN; otherwise PUSH), build image tag           |
| 2   | Workspace Guard     |     ✓     |  ✓   | Clean `reports/`, `build/`, `deployment/`; refuse a `.env`; require 1 worker and 0 retries                              |
| 3   | Install             |     ✓     |  ✓   | `npm ci`                                                                                                                |
| 4   | Quality Gates       |     ✓     |  ✓   | lint, format, typecheck, dry run, test-data audit; **approved suite sizes**: Smoke 4, Regression 24, Sanity 10, Full 52 |
| 5   | Acquire Host Lock   |     ✓     |  ✓   | One pipeline at a time on the shared QA/UAT host (see Concurrency)                                                      |
| 6   | Build Image         |     ✓     |  ✓   | **The only build**: pinned source commit, ParaBank's own 239 tests, OCI labels; records `IMAGE_ID`                      |
| 7   | Deploy QA           |     ✓     |  ✓   | `env deploy qa <IMAGE_ID>`: fresh `parabank-qa` container (fresh database) from the image ID                            |
| 8   | QA Ready            |     ✓     |  ✓   | Container healthy + application serving + database initialized; QA runs exactly `IMAGE_ID`                              |
| 9   | QA Smoke            |     ✓     |  –   | CI gate: `test:smoke`, then 4/4 executed once and passed                                                                |
| 10  | QA Regression       |     –     |  ✓   | **Deployment gate**: `test:regression`, then 24/24 executed once and passed                                             |
| 11  | QA Additional Suite |    opt    | opt  | Parameter `ADDITIONAL_QA_SUITE` = `sanity` (10) or `full` (52), after the QA gate passed                                |
| 12  | Promote to UAT      |     –     |  ✓   | Only if QA Regression passed (`QA_REGRESSION_PASSED`): `env deploy uat <QA image ID>`; **no rebuild**                   |
| 13  | UAT Ready           |     –     |  ✓   | Container healthy + application serving + database initialized; **identity gate**: built = QA = UAT image ID            |
| 14  | UAT Smoke           |     –     |  ✓   | Post-deployment verification: `test:smoke`, then 4/4                                                                    |
| 15  | Known Defects       |     –     | opt  | Parameter `RUN_KNOWN_DEFECTS`, after UAT Smoke passed: the 25 known-defect scenarios; at most UNSTABLE                  |
| 16  | Deployment Record   |     –     |  ✓   | `deployment/deployment-record.txt`: source commit, built/QA/UAT image IDs, validation counts                            |

## Gates

1. Declarative stages run in sequence: a failing suite (or its count check) fails its stage, the
   build is FAILED, and every later stage is skipped.
2. Independently of that, promotion has a `when` guard on QA Regression's own success flag
   (`QA_REGRESSION_PASSED`), set only as the last statement of that stage, after both the suite and
   its count check passed. UAT Smoke requires UAT Ready's flag, and the Deployment Record and
   Known Defects require UAT Smoke's flag.
3. No retries (`CUCUMBER_RETRY=0`, checked by the Workspace Guard), no ignored exit codes around
   suites, and every suite run is compared with its approved size.

The conditional paths were checked by a local simulation that evaluates the Jenkinsfile's own
`when` expressions (not a Jenkins run): PR and PUSH → QA Smoke only; MAIN → QA Regression →
promote → UAT Ready → UAT Smoke → Deployment Record; a failed PR Smoke, a failed QA Regression
(nothing promoted) and a failed UAT Smoke (no deployment record) each end the build FAILED.

## Gate drills (proving the gates in Jenkins)

`GATE_DRILL` (MAIN builds only, default `none`) points one suite at a port of its container on
which nothing listens. Every scenario then fails for real, at transport level, without changing
any test or either environment:

- `fail-qa-regression`: QA Regression fails → build FAILED, **nothing deployed to UAT**.
- `fail-uat-smoke`: UAT Smoke fails → build FAILED, no deployment record.

Run a normal build afterwards to leave QA and UAT validated again.

## Suite counts and the coverage validator

`scripts/ci/verify-suite-coverage.ts --suite <smoke|sanity|regression|full> --expect <N> [dir]`
validates **one suite at a time**: the suite's inventory (Cucumber dry run of its profile) must be
exactly the approved size (`SMOKE_EXPECTED=4`, `REGRESSION_EXPECTED=24`, `SANITY_EXPECTED=10`,
`FULL_EXPECTED=52` in the Jenkinsfile, and docs/test-suites.md); with a reports directory, the run
must have executed exactly that inventory, every scenario once, all passed. It never assumes that
suites add up to another suite. The dry run writes to a relative directory under `reports/`, so it
works on Windows as well as Linux.

## Environments

|                 | QA                                             | UAT                                             |
| --------------- | ---------------------------------------------- | ----------------------------------------------- |
| Compose project | `parabank-qa`                                  | `parabank-uat`                                  |
| Local URL       | `http://localhost:8090/parabank/`              | `http://localhost:8091/parabank/`               |
| From the agent  | `http://parabank-qa-parabank-1:8080/parabank/` | `http://parabank-uat-parabank-1:8080/parabank/` |
| Database        | own container, fresh per deploy                | own container, fresh per deploy                 |
| Deployed by     | every build (PR, push and main)                | MAIN builds that passed QA Regression           |
| Tested with     | Smoke (PR, push) or Regression (main)          | Smoke                                           |
| After the build | left running                                   | left running                                    |

QA is shared: after a PR build it runs that PR's candidate image, while UAT keeps the last image
promoted from `main`. Both are defined once in `src/support/environments.ts` and managed by
`scripts/environment.ts` (`npm run qa:deploy|start|stop|status|health`, the same for `uat:`, and
`npm run env:identity`). The same tests target either one by configuration only (`TARGET_ENV`);
Jenkins also sets `PARABANK_BASE_URL` to the container address.

## Build once, promote the same image

- The image is built once per pipeline; its ID (`sha256:…`) is the identity. Tags are only pointers
  for humans (`parabank-ci:<build>`, removed after the build; `parabank-qa:current` and
  `parabank-uat:current`).
- `compose.yaml` has **no default image**: QA and UAT can only be started with an explicit image ID.
- Promotion deploys the image ID QA runs, after checking it equals the built ID; UAT Ready then
  reads the image ID of both running containers from Docker and fails unless built = QA = UAT.

## Known defects in CI

The 25 known-defect scenarios document confirmed product defects (docs/defects.md) and are not
part of any gate. On MAIN, `RUN_KNOWN_DEFECTS=true` runs them on UAT after UAT Smoke passed; a
scenario that no longer reproduces, or fails for another reason, marks the build UNSTABLE (never
FAILED). Their Playwright report goes to `reports/uat/known-defects/`.

## Reporting and evidence

Reports are separated per environment and suite: `reports/qa/smoke` (PR, push),
`reports/qa/regression` (main), `reports/qa/<sanity|full>` (optional), `reports/uat/smoke`,
`reports/uat/known-defects` (optional), plus `reports/logs/qa.log` and `reports/logs/uat.log`.
Published: JUnit of every run; archived: the reports, the redacted container logs, the application
build log and provenance record (`build/`), and the deployment record (`deployment/`). Failure
messages, attachments and Playwright step titles are redacted, screenshots are masked before
capture, and Playwright traces are never produced in CI.

**Logs the project does not author** go through `scripts/log-redaction.ts` line by line before they
are written anywhere: the ParaBank container logs (which print every customer's username, password
and SSN) and the ParaBank image build output (whose upstream tests print the vendor demo customer
and sample SSNs), which reaches both the Jenkins console and `build/parabank-build.log`. Credential
fields (`username`, `password`, `ssn`, also as JSON), session ids, authorization headers, the
shapes of this suite's generated credentials and every SSN-shaped value are masked; a line that
still looks like a credential is withheld. Replayed on the logs of the first two Jenkins builds:
0 credential values remain, and all 73 "Tests run" lines (used for the test totals) are kept.

### Artifacts archived before the log-redaction fix

The first two builds ran before `scripts/log-redaction.ts`. Their console logs and archived logs
contain unredacted synthetic usernames and the vendor demo credentials (counts, values not shown):

| Build     | File                       | username | password | SSN-shaped | generated usernames |
| --------- | -------------------------- | -------: | -------: | ---------: | ------------------: |
| `main` #1 | console log                |       61 |       61 |         25 |                   0 |
| `main` #1 | `build/parabank-build.log` |       61 |       61 |         25 |                   0 |
| `main` #1 | `reports/logs/qa.log`      |        6 |        0 |          0 |                   6 |
| `main` #1 | `reports/logs/uat.log`     |       46 |        0 |          0 |                  47 |
| `PR-1` #1 | console log                |       61 |       61 |         25 |                   0 |
| `PR-1` #1 | `build/parabank-build.log` |       61 |       61 |         25 |                   0 |
| `PR-1` #1 | `reports/logs/qa.log`      |       46 |        0 |          0 |                  47 |

(The single "password" match in each archived `cucumber-report.html` is the report viewer's own
JavaScript, `…number:!0,password:!0`, not data.)

**Recommended cleanup (manual, not automated; needs the job owner's approval):**

1. Merge this fix and confirm one new `main` build and one new PR build are green, so that clean
   history exists before anything is removed.
2. Check the new builds' archives and console logs with the counts above (expected: all zero).
3. Delete the two affected builds in the Jenkins UI: _Automacao-ParaBank-Playwright → main → #1 →
   Delete build_, and _→ Pull Requests → PR-1 → #1 → Delete build_ (PR-1's whole branch job also
   disappears once Jenkins prunes the merged PR). Deleting the build removes its console log and
   archive together; Jenkins has no UI to delete only one archived file, and editing files in the
   Jenkins home is not recommended.
4. Nothing else needs cleaning: the values are synthetic customers of throwaway environments and
   the vendor's public demo customer; no real credentials were involved.

## Concurrency

QA and UAT are shared by every job of the host, so the build, deploy and test part of a pipeline
holds a **host-wide lock** (`scripts/ci/host-lock.ts`): an atomic Docker network labelled with the
owner (`BUILD_TAG`); waiters poll for at most 60 min (`PARABANK_LOCK_WAIT_MINUTES`); a lock older
than 150 min (`PARABANK_LOCK_STALE_MINUTES`) is removed loudly; it is released in `post`, also on
failure or abort. `disableConcurrentBuilds()` covers one branch/PR job. Cucumber always runs with
one worker and no retries (checked by the Workspace Guard).

## Configuration

| Item                   | Default | Meaning                                                                       |
| ---------------------- | ------- | ----------------------------------------------------------------------------- |
| `PARABANK_MAIN_BRANCH` | `main`  | Global property: builds of this branch promote to UAT                         |
| `RUN_KNOWN_DEFECTS`    | `false` | Build parameter (MAIN): run the known defects on UAT after UAT Smoke          |
| `ADDITIONAL_QA_SUITE`  | `none`  | Build parameter: `sanity` or `full` on QA after the QA gate                   |
| `GATE_DRILL`           | `none`  | Build parameter (MAIN): `fail-qa-regression` or `fail-uat-smoke` (see drills) |

Agent requirements: a Docker-capable Jenkins with the Docker Pipeline plugin and access to the
host Docker socket; host ports 8090 and 8091 free for QA and UAT.

## Validation status

**Real Jenkins builds (previous pipeline design, PR Smoke + Regression / main QA Smoke + UAT Smoke

- Regression):** `main` #1 SUCCESS (image `sha256:c0cfd5a7…` built once, QA Smoke 4/4, same image
  ID promoted to UAT, UAT Smoke 4/4, UAT Regression 24/24) and `PR-1` #1 SUCCESS (QA Smoke 4/4, QA
  Regression 24/24, no UAT stage), 2026-10-07.

**Not yet executed in Jenkins:** the current design (PR Smoke only; main QA Regression → UAT
Smoke), the test-data audit gate, both gate drills and the log redaction. The design was checked
locally: static checks, and the stage-path simulation above. Validate it with one PR build, one
`main` build, both drills and a final normal `main` build.

## Readiness: database initialized

ParaBank creates its database lazily, on home-page requests. The container healthcheck's bare
HTTP/1.0 probe triggers that initialization but never completes it, so a freshly deployed
container reports "healthy" while registration still fails with HTTP 500 ("object not found:
SEQUENCE"). `scripts/environment.ts` therefore makes one complete home-page request and then
requires the application's own "Database initialized" log line since the container started (a
database kept across a restart logs neither message and is ready at once). `deploy` returns only
then, and the QA Ready / UAT Ready stages use the same check. The log is only searched for that
line, never printed or stored.
