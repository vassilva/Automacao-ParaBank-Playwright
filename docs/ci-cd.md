# CI/CD: PR Smoke, manual merge, QA Regression, automatic UAT promotion, UAT Smoke

One `Jenkinsfile`, one **Multibranch Pipeline**, one pipeline at a time. The definitive flow:

```
LOCAL DEVELOPMENT (tests written and run against QA) ─> PUSH TO A FEATURE BRANCH ─> PULL REQUEST
  ─> QUALITY GATES ─> QA SMOKE (4)                     = the required checks (failures block)
  ─> MANUAL MERGE by the repository owner in GitHub    (no auto-merge, no automation merges)
  ─> QA REGRESSION (24, once, on QA)                   = the gate before UAT
  ─> AUTOMATIC UAT PROMOTION of the validated image    (no manual approval)
  ─> UAT SMOKE (4) ─> SUCCESS
```

```
PUSH, by branch prefix (a branch with an open PR is built as the PR only):
  feature/*, others  DEVELOPER     QUALITY GATES ─> APP IMAGE ─> QA READY ─> QA SMOKE (4)
  qa/*               QA            QUALITY GATES ─> APP IMAGE ─> QA READY ─> QA IMPACTED TESTS
  config/*           CONFIGURATOR  QUALITY GATES ─> CONFIG CHECK          (no image, no deployment)

PULL REQUEST (CI)  QUALITY GATES ─> CONFIG CHECK ─> APP IMAGE ─> QA READY ─> QA SMOKE (4)
                     ─> QA IMPACTED TESTS (feature level only; a Regression-level selection is
                        deferred to main) ─> QA GATE ─> VALIDATION COMPLETE
                   = the "Jenkins" check + "pr-head" status. Never Regression, never UAT.

MAIN (CD)          QUALITY GATES ─> APP IMAGE ─> QA READY ─> QA REGRESSION (24, once)
                     ─> UAT PROMOTION (main's head, image ID, revision, inputs digest; fail-closed)
                     ─> DEPLOY UAT (only if UAT does not already run that image ID)
                     ─> UAT READY (identity = validated image) ─> UAT SMOKE (4)
                     [─> KNOWN DEFECTS (optional, never gating)] ─> DEPLOYMENT RECORD
                     ─> VALIDATION COMPLETE

APP IMAGE = RESOLVE ─> [BUILD, only if no image from these inputs exists] ─> VERIFY
            ─> [DEPLOY QA, only if QA runs another image] (see "Application image")
EVERY BUILD: WORKSPACE GUARD ─> ACQUIRE PIPELINE LOCK ─> ... ─> (post) RELEASE PIPELINE LOCK
```

```
QA REGRESSION ──fail / skipped──> FAILURE (no UAT stage runs)
      │ 24/24
      ▼
UAT PROMOTION ──main moved on──> ABORTED "SUPERSEDED" (a newer main build promotes)
      │       ──head unreadable / image ID, revision or digest mismatch──> FAILURE (nothing deployed)
      ▼
DEPLOY UAT (if needed) ─> UAT READY ─> UAT SMOKE ──fail──> FAILURE (no deployment record)
                                          │ 4/4
                                          ▼
                                VALIDATION COMPLETE ─> SUCCESS
```

A Pull Request never runs the Regression suite and never deploys to UAT. `main` runs QA Regression
exactly once per promotion attempt, no QA Smoke and no UAT Regression; it is SUCCESS only when QA
Regression, the promotion checks, UAT readiness and UAT Smoke all passed (Validation Complete).

**UAT promotion policy (deterministic):** after a passing Regression, UAT is deployed **only if it
does not already run the exact validated image ID** (healthy). A test-only or documentation merge
keeps the same application image (see "Application image"), so UAT is not redeployed; it is still
verified (identity) and smoke-tested with the merged tests. A merge that changes the application
inputs produces a new image, validated by QA Regression and then deployed to UAT. The post-merge
Regression gate always runs.

## Merge policy and GitHub protection

Repository: https://github.com/vassilva/Automacao-ParaBank-Playwright (public, owned by a user
account; `main` is the default branch). Every merge into `main` is a **manual merge by the
repository owner in the GitHub interface**, after the required checks passed. Nothing merges
automatically.

| Control                | Setting (verified through the GitHub API)                                                                                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auto-merge             | **disabled** for the repository (`allow_auto_merge: false`): it cannot be enabled on any PR                                                                                                                                                                                                     |
| Ruleset `24842741`     | [`github-ruleset-main.json`](github-ruleset-main.json): PR required; no deletion; no force-push; required `Jenkins` and `continuous-integration/jenkins/pr-head` (app 4991392) and `gate-review` (GitHub Actions, app 15368) on a branch **up to date** with `main`; no bypass (owner: `never`) |
| Ruleset `24856083`     | [`github-ruleset-main-owner-merge.json`](github-ruleset-main-owner-merge.json): **restrict updates** of `main`; only repository admins bypass it, and only through a PR (owner: `pull_requests_only`)                                                                                           |
| Collaborators          | the owner only (`vassilva`, admin)                                                                                                                                                                                                                                                              |
| Workflow token default | read-only; workflows cannot approve PRs                                                                                                                                                                                                                                                         |

Two rulesets on purpose: a bypass applies per ruleset, so the owner's PR-only bypass of "restrict
updates" never lets anyone skip the required checks of the other ruleset. Together: no direct or
force push to `main`; a merge needs a PR with all three required signals passed on an up-to-date
head; and only a repository admin (today: only the owner) can perform it. **Automation cannot
merge:** Jenkins never merges (its GitHub App only publishes checks and statuses, and it is not a
bypass actor); `gate-guard.yml` has no write access to code; `playwright.yml` is manual and
read-only; there are no other workflows and no other apps with a bypass.

**Limits (stated, not hidden):** GitHub enforces "repository admins", not a named person: today the
owner is the only admin, and adding another admin would give that person the same merge right.
Required approving reviews stay at 0, because a single maintainer cannot approve their own PR.
The owner can still edit or disable rulesets (an administrative action outside any PR).

### Required signals and what GitHub counts as passing

Read from the installed plugins (checks-api 402, github-branch-source 1967) and observed on real
builds:

| Jenkins result | `Jenkins` check run                         | `pr-head` commit status | Merge                                                  |
| -------------- | ------------------------------------------- | ----------------------- | ------------------------------------------------------ |
| SUCCESS        | success                                     | success                 | allowed (with `gate-review`)                           |
| UNSTABLE       | neutral (if configured) or failure          | failure                 | blocked (PR UNSTABLE is turned into FAILURE anyway)    |
| FAILURE        | failure                                     | error                   | blocked                                                |
| NOT_BUILT      | skipped                                     | error                   | blocked by the status (the pipeline never produces it) |
| ABORTED        | failure (observed on a superseded PR build) | error                   | blocked                                                |
| running        | in progress                                 | pending                 | blocked                                                |

GitHub counts a skipped or neutral required **check** as passing, but a commit **status** passes
only when `success`; requiring both signals closes that gap. A missing signal blocks the merge.

### gate-review: human review for gate-defining changes

`.github/workflows/gate-guard.yml` runs from `main` (`pull_request_target`, and `status` when
Jenkins reports `pr-head`; a PR cannot change it) and sets the required status `gate-review` with
`.github/scripts/gate-review.mjs`:

| PR                                                                                             | review label `gate-change-reviewed` | Jenkins on this commit | `gate-review`          |
| ---------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------- | ---------------------- |
| ordinary                                                                                       | –                                   | –                      | success                |
| gate-defining                                                                                  | absent                              | any                    | failure (needs review) |
| gate-defining                                                                                  | present                             | not yet passed         | pending                |
| gate-defining                                                                                  | present                             | passed                 | success                |
| guard cannot read the PR (API, permission)                                                     | –                                   | –                      | failure (fail closed)  |
| gate-defining with auto-merge enabled (defense in depth, should auto-merge ever be re-enabled) | any                                 | any                    | failure                |

Gate-defining files are listed in `.github/gate-defining-paths.json` (Jenkinsfile, `scripts/ci/**`,
`.github/**`, ruleset files, redaction and test-data controls, runner configuration and
dependencies, the Playwright adapter, the CI agent image, lint and format configuration). Every new
commit removes the label. **Permission finding:** the earlier guard tried to turn auto-merge off and
GitHub answered "Resource not accessible by integration (disablePullRequestAutoMerge)": that
mutation needs `contents: write`, which this `pull_request_target` workflow deliberately does not
get. The obsolete operation was removed; protection comes from the required status, the disabled
auto-merge and the "restrict updates" ruleset, not from a token permission. Residual limit: anyone
with write access (today only the owner) can add the label or write a workflow that posts a
`gate-review` status; this protects against unattended changes, not against a malicious admin.

### Jenkins job and GitHub discovery

Multibranch Pipeline `Automacao-ParaBank-Playwright` (GitHub Branch Source, GitHub App credential
`github-app-qa-automation`, app 4991392). Discovery: branches excluding those filed as PRs; PRs
from this repository at their head revision (no fork PRs). The local Jenkins is not reachable from
GitHub, so discovery is a **periodic scan every 2 minutes**; a scan only builds heads whose revision
changed. The job discards removed branches (a merged PR's `PR-<n>` job disappears with its builds;
GitHub keeps the checks).

## Stages, in execution order

| #    | Stage                                                   |        PR         |       push       |   main    | What it does                                                                                                                                                     |
| ---- | ------------------------------------------------------- | :---------------: | :--------------: | :-------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Build Context                                           |         ✓         |        ✓         |     ✓     | Mode (`CHANGE_ID` → PR; `main` → MAIN; else PUSH), role by prefix, plan, build tag (no executor)                                                                 |
| 2    | **Serialized Pipeline**                                 |         ✓         |        ✓         |     ✓     | ONE agent block for all the work below; timeout 300 min                                                                                                          |
| 2.1  | ↳ Workspace Guard                                       |         ✓         |        ✓         |     ✓     | Clean reports, no `.env`, 1 worker, 0 retries                                                                                                                    |
| 2.2  | ↳ Acquire Pipeline Lock                                 |         ✓         |        ✓         |     ✓     | Global lock (bounded wait); then superseded commit → ABORTED                                                                                                     |
| 2.3  | ↳ Install, Quality Gates                                |         ✓         |        ✓         |     ✓     | `npm ci`; lint, format, typecheck, strict dry run, test-data audit, `test:ci` (pipeline/merge-policy tests), BDD structure (77/25), suite inventories 4/10/24/52 |
| 2.4  | ↳ Config Check                                          |         ✓         |     config/*     |     –     | Compose for QA/UAT, `source.env`, `.env.example`                                                                                                                 |
| 2.5  | ↳ Resolve / Build / Verify Application Image, Deploy QA |         ✓         | ✓ (not config/*) |     ✓     | REUSE / DEPLOY / BUILD (see "Application image"); revision and inputs digest checked                                                                             |
| 2.6  | ↳ QA Ready                                              |         ✓         |        ✓         |     ✓     | Healthy, database initialized, QA runs exactly the image ID                                                                                                      |
| 2.7  | ↳ QA Smoke                                              |         ✓         |    feature/*     |     –     | 4/4 executed once and passed                                                                                                                                     |
| 2.8  | ↳ QA Impacted Tests                                     | ✓ (feature level) |       qa/*       |     –     | Selection from the changed files; Regression-level deferred on PRs                                                                                               |
| 2.9  | ↳ QA Gate                                               |         ✓         |        ✓         |     –     | Fails unless the role's suites ran                                                                                                                               |
| 2.10 | ↳ QA Regression                                         |         –         |        –         |     ✓     | 24/24 executed once and passed: the gate before UAT                                                                                                              |
| 2.11 | ↳ UAT Promotion                                         |         –         |        –         |     ✓     | Fail-closed checks; decides whether UAT needs the deployment                                                                                                     |
| 2.12 | ↳ Deploy UAT                                            |         –         |        –         | if needed | Same image ID, no rebuild                                                                                                                                        |
| 2.13 | ↳ UAT Ready, UAT Smoke                                  |         –         |        –         |     ✓     | Identity = validated image; 4/4                                                                                                                                  |
| 2.14 | ↳ Known Defects                                         |         –         |        –         |    opt    | `RUN_KNOWN_DEFECTS`; at most UNSTABLE                                                                                                                            |
| 2.15 | ↳ Deployment Record                                     |         –         |        –         |     ✓     | `deployment/deployment-record.txt` (deployed or already running)                                                                                                 |
| post | release the lock                                        |         ✓         |        ✓         |     ✓     | Junit, environment logs (redacted), pointers, build tag removal, **lock release**, archive                                                                       |
| 3    | Validation Complete                                     |         ✓         |        ✓         |     ✓     | Fails unless every flag of the plan is set (main: Regression, promotion, UAT ready, UAT Smoke)                                                                   |

## Strict serialization (one pipeline at a time)

Every build of the job (PR, `main`, branch push) runs all its work inside one agent block whose
first step after the workspace guard is the **global pipeline lock**
(`scripts/ci/pipeline-lock.sh`), released in that block's `post` section on SUCCESS, FAILURE,
ABORTED and timeout. Therefore:

- only one pipeline executes at a time, across all branches and PRs (a per-branch lock would not
  be enough); a PR can never change QA while `main` runs Regression or promotes UAT;
- the holder never needs a second executor (QA and UAT run in the same agent block, nothing
  allocates a node after the lock), so builds waiting for the lock cannot deadlock it;
- **queueing:** a build waiting for the lock occupies one executor (the built-in node has 2) and
  polls every 15 s, naming the holder; further builds stay in the Jenkins queue without an
  executor. Waiting is bounded (`PARABANK_LOCK_WAIT_MINUTES`, 180): then the build fails;
- **release:** plain `sh` + Docker CLI, so it works even when `npm ci` failed; owner-scoped (a build
  can only release its own lock); idempotent;
- **stale locks:** a lock older than 330 min (longer than the 300-min pipeline timeout) can only
  belong to a build that died without its `post` section (Jenkins crash, hard kill); the next
  waiter removes it loudly. Nobody needs to remove an active lock by hand;
- **outdated images:** after taking the lock, a build whose commit is no longer the head of its PR
  or branch ends ABORTED; before UAT, `main`'s head is checked again (fail-closed), so a queued
  older `main` build can never promote an outdated image.

The lock is an atomic Docker network (60 concurrent creates of one name produced exactly one) with
owner and time labels, compatible with the previous `host-lock.ts`. Not covered: Jenkins builds the
small CI agent image (`docker/ci-agent`, normally cached) before entering the agent block. A
Jenkins-native alternative (Lockable Resources plugin, `options { lock(...) }`, waiting without an
executor) would need a plugin installation by the Jenkins administrator; it is not installed.
Tested locally (`npm run test:lock`, on a throwaway lock name): waiting, release, owner-only
release, bounded wait, stale recovery, and 5 concurrent pipelines strictly one at a time.

## Gates

1. Stages run in sequence: a failing suite or count check fails its stage and the build; every
   later stage is skipped.
2. Each later step requires the previous gate's own flag, set only as the last statement of its
   stage: UAT Promotion requires `QA_REGRESSION_PASSED`; Deploy UAT and UAT Ready require
   `UAT_PROMOTION_VERIFIED`; UAT Smoke requires `UAT_READY`; the record requires
   `UAT_SMOKE_PASSED`; Validation Complete requires every flag of the plan.
3. No retries (`CUCUMBER_RETRY=0`), one worker, no ignored exit codes around suites, every suite run
   compared with its approved size.

## Gate drills (proving the gates in Jenkins)

`GATE_DRILL` (MAIN builds only, default `none`) points one suite at a port of its container on which
nothing listens; every scenario then fails for real, without changing any test or environment:

- `fail-qa-regression`: QA Regression fails → FAILURE, **nothing deployed to UAT**;
- `fail-uat-smoke`: UAT Smoke fails → FAILURE, no deployment record.

Run a normal `main` build afterwards so that QA and UAT end validated.

## Configuration

| Item                         | Where                   | Default | Meaning                                      |
| ---------------------------- | ----------------------- | ------- | -------------------------------------------- |
| `PARABANK_MAIN_BRANCH`       | Jenkins global property | `main`  | Branch whose builds are the CD pipeline      |
| `PARABANK_LOCK_WAIT_MINUTES` | Jenkins global property | `180`   | Maximum wait for the pipeline lock           |
| `RUN_KNOWN_DEFECTS`          | Build parameter (MAIN)  | `false` | Run the known defects on UAT after UAT Smoke |
| `ADDITIONAL_QA_SUITE`        | Build parameter         | `none`  | `sanity` or `full` on QA after the QA gate   |
| `GATE_DRILL`                 | Build parameter (MAIN)  | `none`  | `fail-qa-regression` or `fail-uat-smoke`     |

The former `PARABANK_UAT_APPROVERS` and `PARABANK_UAT_APPROVAL_MINUTES` global properties are no
longer read (the manual approval was removed); they can be deleted from Jenkins once this version
is on `main`.

## Roles: push validation by branch prefix

| Branch      | Role         | Validation on push (no PR yet)                                           | Deploys QA? |
| ----------- | ------------ | ------------------------------------------------------------------------ | :---------: |
| `feature/*` | Developer    | Quality Gates, build image, deploy QA, **QA Smoke (4)**                  |     yes     |
| `qa/*`      | QA           | Quality Gates, build image, deploy QA, **QA Impacted Tests** (vs `main`) |     yes     |
| `config/*`  | Configurator | Quality Gates, **Config Check** (`scripts/ci/config-check.ts`)           |     no      |
| other       | Developer    | as `feature/*`                                                           |     yes     |

**Quality Gates (every push and PR, before anything is built):** lint, format, typecheck, strict
Cucumber dry run (undefined or ambiguous steps fail), test-data audit, **BDD structure check**
(`scripts/ci/verify-bdd-structure.ts`: 77 scenarios and 25 known defects; one area and one priority
tag per scenario; known tags only; Smoke ⊂ Regression; every `@known-defect` has exactly one
`@PB-nn` registered in docs/defects.md with a registered proof, and no suite tag), and the four suite
inventories (4/10/24/52). This project has no unit tests; for a Developer push the static checks
above are the build validation, followed by QA Smoke (the approved Developer plan).

The Config Check renders `compose.yaml` for QA and UAT exactly as `scripts/environment.ts` would,
and fails unless each renders with its own Compose project and its own loopback port, the image is
the one passed in, and Compose refuses to render without an image (no silent default image). It
also validates `docker/parabank/source.env` (exactly the official HTTPS repository and a full
40-hex commit, never a branch) and `.env.example` (only keys the code reads; 1 worker, 0 retries,
no traces, a known environment), without printing values. ParaBank's business rules are not
configurable from this repository, so there is no business-rule configuration to validate. It
needs no lock and never touches QA or UAT, so a `config/*` push is never queued behind a QA build
(measured locally: Quality Gates + Config Check ≈ 75 s, plus `npm ci` and the agent start).

**A `config/*` push is not the configuration's validation.** Once a PR is open, every branch,
whatever its prefix, is validated by the full PR plan: Quality Gates, Config Check, build, deploy
QA, **QA Smoke (4)** and **QA Impacted Tests**. Jenkins discovers branches "excluding those filed as
PRs", so an open PR is never built with the lighter push plan, and the PR check is the one GitHub
requires. Configuration files select the whole Regression (24): `compose.yaml`,
`src/support/environments.ts`, `src/support/config.ts`, `docker/parabank/**` (application version
and build), `cucumber.js`, `package*.json`, `tsconfig.json`, Playwright configs, the Jenkinsfile,
`scripts/**` and the CI agent image. No configuration-specific business tests are added: ParaBank's
behaviour is covered by the existing scenarios, and Regression is the strongest set that runs on QA.

## QA Impacted Tests (pull requests and `qa/*` pushes)

`scripts/ci/impacted-tests.ts` compares the change with its target (`origin/$CHANGE_TARGET` for a
PR, `origin/main` for a push) at the **merge base**, so later commits on `main` do not count. Jenkins
PR checkouts fetch only the PR ref, so the script fetches the target branch anonymously from the
(public) repository when it is missing; if it cannot, the stage fails (fail-closed).

| Changed files                                                                                                                                                                                                                                                                  | Runs                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| a feature file                                                                                                                                                                                                                                                                 | that feature                    |
| a domain's steps or page object (e.g. `transfer.steps.ts`, `bill-pay.page.ts`)                                                                                                                                                                                                 | that domain's features          |
| shared code: `src/support`, `src/api`, `src/factories`, `src/utils`, shared steps (customer, feedback, ledger) and pages (home, menu, feedback, index), `playwright/`, Playwright configs, `cucumber.js`, `package*.json`, `tsconfig.json`, `docker/parabank/`, `compose.yaml` | **Regression (24)**             |
| CI/CD tooling (high risk): `Jenkinsfile`, `scripts/**`, `docker/ci-agent/**`, `.gitattributes`                                                                                                                                                                                 | **Regression (24)**             |
| any gate-defining file (`.github/gate-defining-paths.json`, incl. `.github/**`, lint/format configs, the ruleset file)                                                                                                                                                         | **Regression (24)**             |
| documentation (`docs/**`, `*.md`), `.gitignore`, `.env.example` (never loaded in CI)                                                                                                                                                                                           | nothing beyond Smoke            |
| anything the map does not know (e.g. a new page object)                                                                                                                                                                                                                        | **Regression (24)** (fail-safe) |

**On pull requests the full Regression never runs:** a Regression-level selection (shared code,
high-risk or gate-defining files) is recorded in `selection.json` and deferred to the post-merge QA
Regression, which runs exactly once per promotion as the gate before UAT; feature-level selections
still run on the PR. `qa/*` pushes run the selection in full.

Known-defect scenarios are never selected (the `full` profile excludes them); a selection that
contains only known defects runs nothing and does not gate. After the run, the coverage validator
checks that exactly the selected scenarios ran, once each, and passed (`--paths` for a feature
selection, `--expect 24` for Regression). The selection is archived as
`reports/qa/impacted/selection.json`. The map lives in the script (`RULES`); a new domain needs a
new rule, and until then its files select Regression. Renames list both the old and the new path
(`--no-renames`), so moving shared code into a domain file still selects Regression.

**Gate-defining changes** (`GATE_DEFINING`: the Jenkinsfile, `scripts/ci/**`, the test-data audit,
`cucumber.js`, `package*.json`, `tsconfig.json`, the Playwright adapter and configs, the CI agent
image, lint/format configs, the ruleset file) are reported in the console and in `selection.json`
as `GATE-DEFINING CHANGE`. Jenkins validates a PR with **the PR's own Jenkinsfile and scripts**, so
such a PR can weaken the checks that judge it; it is merged manually after review, never
auto-merged (see Merge policy).

## Suite counts and the coverage validator

`scripts/ci/verify-suite-coverage.ts --suite <smoke|sanity|regression|full> --expect <N> [dir]`
validates **one suite at a time**: the suite's inventory (Cucumber dry run of its profile) must be
exactly the approved size (`SMOKE_EXPECTED=4`, `REGRESSION_EXPECTED=24`, `SANITY_EXPECTED=10`,
`FULL_EXPECTED=52` in the Jenkinsfile, and docs/test-suites.md); with a reports directory, the run
must have executed exactly that inventory, every scenario once, all passed. For impacted tests,
`--paths <a.feature,b.feature>` replaces `--expect`: the inventory is the suite's profile restricted
to those files, which has no approved size but must not be empty. It never assumes that
suites add up to another suite. The dry run writes to a relative directory under `reports/`, so it
works on Windows as well as Linux.

## Environments

|                 | QA                                                        | UAT                                                |
| --------------- | --------------------------------------------------------- | -------------------------------------------------- |
| Compose project | `parabank-qa`                                             | `parabank-uat`                                     |
| Local URL       | `http://localhost:8090/parabank/`                         | `http://localhost:8091/parabank/`                  |
| From the agent  | `http://parabank-qa-parabank-1:8080/parabank/`            | `http://parabank-uat-parabank-1:8080/parabank/`    |
| Database        | own container, fresh per deploy                           | own container, fresh per deploy                    |
| Deployed by     | builds whose app image is new to QA (DEPLOY/BUILD)        | MAIN builds whose QA Regression passed (automatic) |
| Tested with     | Smoke and/or Impacted Tests (PR, push), Regression (main) | Smoke                                              |
| After the build | left running                                              | left running                                       |

QA is shared, one pipeline at a time: it runs the current application image and changes only
when a PR or `main` build brings different application inputs; UAT runs the last image a `main`
build validated and promoted. Both are defined once in `src/support/environments.ts` and managed by
`scripts/environment.ts` (`npm run qa:deploy|start|stop|status|health`, the same for `uat:`, and
`npm run env:identity`). The same tests target either one by configuration only (`TARGET_ENV`);
Jenkins also sets `PARABANK_BASE_URL` to the container address.

## Application image: reuse, deploy or build (explicit, deterministic)

This repository is mostly test automation. The ParaBank image is a function of its **build inputs**
only: `docker/parabank/**` (Dockerfile, pinned source commit) and `scripts/build-parabank-image.ts`.
Their SHA-256 is the **inputs digest**, recorded on every image built by this project (label
`parabank.inputs.digest`). Under the host lock, "Resolve Application Image"
(`scripts/ci/app-image.ts`) decides:

| Action | When                                                                       | Effect                                                                  |
| ------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| REUSE  | QA runs, is healthy, and its image has this digest and the pinned revision | no build, no deployment; QA is re-verified (health, database, identity) |
| DEPLOY | an image with this digest exists, but QA runs another one or is unhealthy  | deploy it to QA, no build                                               |
| BUILD  | no image with this digest exists (e.g. the application version changed)    | build once, deploy                                                      |

Images without the label (built before it existed) are never reused. Whatever the action, "Verify
Application Image" checks the pinned revision and the digest, QA Ready checks that QA runs exactly
that image ID, and on `main` that same ID is the only one QA Regression validates and the automatic
UAT promotion can deploy (UAT Promotion checks ID, revision and digest again). A test-only or
documentation change therefore never promotes a different or unvalidated application version.

## Build once, promote the same image

- An application image is built at most once (BUILD), only when no image from the current
  application inputs exists; otherwise the existing one is reused. Its ID (`sha256:…`) is the
  identity. Tags are only pointers for humans (`parabank-ci:<build>`, removed after the build;
  `parabank-qa:current` and `parabank-uat:current`).
- `compose.yaml` has **no default image**: QA and UAT can only be started with an explicit image ID.
- UAT receives only the image ID that QA Ready verified and QA Regression validated in the same
  build (checked again before promotion: ID, revision, inputs digest); UAT Ready reads the running
  container's image ID from Docker and fails unless it equals the validated one.

## Known defects in CI

The 25 known-defect scenarios document confirmed product defects (docs/defects.md) and are not
part of any gate. On MAIN, `RUN_KNOWN_DEFECTS=true` runs them on UAT after UAT Smoke passed; a
scenario that no longer reproduces, or fails for another reason, marks the build UNSTABLE (never
FAILED). Their Playwright report goes to `reports/uat/known-defects/`.

## Reporting and evidence

Reports are separated per environment and suite: `reports/qa/smoke` (PR, push),
`reports/qa/impacted` (PR, `qa/*`; with `selection.json`),
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
   Delete build_. (`PR-1` #1 no longer exists: Jenkins pruned the merged PR's job,
   with its builds, on 2026-10-10.) Deleting the build removes its console log and
   archive together; Jenkins has no UI to delete only one archived file, and editing files in the
   Jenkins home is not recommended.
4. Nothing else needs cleaning: the values are synthetic customers of throwaway environments and
   the vendor's public demo customer; no real credentials were involved.

## Operations: what remains manual

1. **Merging:** the repository owner merges each PR in GitHub once its required checks passed (and,
   for gate-defining changes, after reviewing it and adding the label `gate-change-reviewed`).
2. **After this version is on `main`:** delete the obsolete Jenkins global properties
   `PARABANK_UAT_APPROVERS` and `PARABANK_UAT_APPROVAL_MINUTES` (Manage Jenkins → System → Global
   properties); nothing reads them any more.
3. **Optional:** install the Lockable Resources plugin if waiting builds should not occupy an
   executor; enable "Automatically delete head branches" to avoid one branch build after each
   merge; delete the stale `feature/ci-jenkins-pipeline` branch; delete `main` #1 (unredacted
   synthetic data, see "Artifacts archived before the log-redaction fix").

## Failure, rollback and recovery

- **PR check fails:** the merge stays blocked. Read the console and JUnit, fix, push (the new commit
  supersedes the old build). No retries: a flaky failure is a defect to investigate.
- **`main` QA Regression fails:** FAILURE, nothing deployed to UAT, but `main` holds a commit QA
  rejected. Revert the merge through a PR (`git revert -m 1 <merge sha>`) or fix forward through a
  PR; the next `main` build re-validates.
- **UAT readiness or UAT Smoke fails after a deployment:** FAILURE, no deployment record; UAT runs
  the new image. Roll UAT back to the last image whose UAT Smoke passed (authorized operation):
  `docker image inspect parabank-uat:current --format '{{.Id}}'`, then
  `npm run -s env -- deploy uat <that ID>`, `npm run uat:health`, `TARGET_ENV=uat npm run test:smoke`.
  Then fix forward through a PR.
- **A build waits for the lock:** its console names the holder. Normal: let the holder finish. A
  waiter fails after 180 min; a lock older than 330 min (holder died) is removed by the next waiter.
  Never remove an active lock by hand.
- **Leftover build tags:** `docker image ls parabank-ci`; for a tag whose build has finished,
  `docker image rm parabank-ci:<tag>` (an image QA or UAT runs stays).
- **QA or UAT down** (e.g. after a reboot; Docker Desktop is started manually): `npm run qa:start` /
  `npm run uat:start` (same image ID, no rebuild), then `npm run qa:health` / `npm run uat:health`.
- **A hard-killed build kept an executor** ("Still waiting to schedule task"): restart Jenkins once
  it is idle; prefer a normal abort to "Hard kill".
- **The ruleset blocks every PR** (a required signal never arrives): compare the PR's check runs and
  statuses (name and app) with the ruleset; correct it or set its enforcement to "disabled"
  temporarily (authorized).

## Validation status

**Real Jenkins and GitHub (2026-10-10), previous designs of this pipeline:**

| Evidence                                    | Result                                                                                                                                                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PR-2` #1 (gate-defining PR)                | SUCCESS: Quality Gates, Config Check, QA Smoke 4/4, Regression 24/24 (then still run on PRs), Validation Complete; checks from app 4991392; merge blocked while missing and pending, CLEAN only after success; 0 unredacted values in console and 13 archived files |
| `main` #3, `main` #4                        | SUCCESS: image built once, QA Regression 24/24, (then manual) approval by `viamerico`, same image ID on UAT, UAT Smoke 4/4                                                                                                                                          |
| `PR-3` #1 superseded by a new commit        | ABORTED after taking the lock; `Jenkins` check failure, `pr-head` error (non-passing)                                                                                                                                                                               |
| `PR-4` #1 (deliberate formatting violation) | FAILURE in Quality Gates, nothing deployed, lock untouched; status rollup FAILURE; closed, never merged                                                                                                                                                             |
| `gate-review`                               | success on ordinary PRs, failure on an unreviewed gate-defining PR, posted by GitHub Actions (app 15368)                                                                                                                                                            |
| Repository settings and rulesets            | auto-merge disabled; ruleset `24842741` (checks) and `24856083` (restrict updates) active; owner bypass: `never` / `pull_requests_only`                                                                                                                             |

**This version (serialized pipeline, automatic UAT promotion, no approval) has not run on the real
Jenkins yet.** Its first real runs are the PR that introduces it and the `main` build after the
owner merges it.

**Isolated throwaway Jenkins** (same image and plugin set, no network): the official Declarative
linter validates this `Jenkinsfile`; earlier runs there proved the sandboxed flag lookup, UNSTABLE →
FAILURE and the head-check ABORTED result.

**Local:** `npm run test:ci` (pipeline order and gates on the Jenkinsfile's own stage conditions,
serialization structure, automatic promotion and its fail-closed checks, the application-image
decision, PR Regression deferral, the gate-review policy including fail-closed), `npm run test:lock`
(lock concurrency on the local Docker daemon), lint, format, typecheck, dry run, test-data audit,
BDD structure, suite inventories, config check, actionlint, Groovy parse.

## Readiness: database initialized

ParaBank creates its database lazily, on home-page requests. The container healthcheck's bare
HTTP/1.0 probe triggers that initialization but never completes it, so a freshly deployed
container reports "healthy" while registration still fails with HTTP 500 ("object not found:
SEQUENCE"). `scripts/environment.ts` therefore makes one complete home-page request and then
requires the application's own "Database initialized" log line since the container started (a
database kept across a restart logs neither message and is ready at once). `deploy` returns only
then, and the QA Ready / UAT Ready stages use the same check. The log is only searched for that
line, never printed or stored.
