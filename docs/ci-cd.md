# CI/CD: PR Smoke, manual merge, QA Regression, manual UAT approval, UAT Smoke

One `Jenkinsfile`, one **Multibranch Pipeline**, one pipeline at a time (held in the Jenkins queue,
see "Scheduling"). The definitive flow:

```
LOCAL DEVELOPMENT (tests written and run against QA) ─> PUSH TO A FEATURE BRANCH ─> PULL REQUEST
  ─> QUALITY GATES ─> QA SMOKE (4)                     = the required checks (failures block)
  ─> MANUAL MERGE in GitHub                           (no auto-merge, no automation merges)
  ─> QA REGRESSION (24, once, on QA)                   = the gate before UAT
  ─> MANUAL UAT APPROVAL in Jenkins                    (authorized operator only; reject,
                                                        timeout or abort: nothing deployed)
  ─> UAT PROMOTION of the validated image ─> UAT SMOKE (4) ─> SUCCESS
```

```
PUSH, by branch prefix, started manually (only main and PR-<n> build automatically):
  feature/*, others  DEVELOPER     QUALITY GATES ─> APP IMAGE ─> QA READY ─> QA SMOKE (4)
  qa/*               QA            QUALITY GATES ─> APP IMAGE ─> QA READY ─> QA IMPACTED TESTS
  config/*           CONFIGURATOR  QUALITY GATES ─> CONFIG CHECK          (no image, no deployment)

PULL REQUEST (CI)  QUALITY GATES ─> CONFIG CHECK ─> APP IMAGE ─> QA READY ─> QA SMOKE (4)
                     ─> QA IMPACTED TESTS (feature level only; a Regression-level selection is
                        deferred to main) ─> QA GATE ─> VALIDATION COMPLETE
                   = the "Jenkins" check + "pr-head" status. Never Regression, never UAT.

MAIN (CD)          QUALITY GATES ─> APP IMAGE ─> QA READY ─> QA REGRESSION (24, once)
                     ─> UAT APPROVAL (Jenkins input, PARABANK_UAT_APPROVERS only, bounded wait)
                     ─> UAT PROMOTION (main's head, image ID, revision, inputs digest; fail-closed)
                     ─> DEPLOY UAT (only if UAT does not already run that image ID)
                     ─> UAT READY (identity = validated image) ─> UAT SMOKE (4)
                     [─> KNOWN DEFECTS (optional, never gating)] ─> DEPLOYMENT RECORD
                     ─> VALIDATION COMPLETE

APP IMAGE = RESOLVE ─> [BUILD, only if no image from these inputs exists] ─> VERIFY
            ─> [DEPLOY QA, only if QA runs another image] (see "Application image")
EVERY BUILD: QUEUED while another build of the job is active (queue dispatcher) ─> RUNNING
             ─> WORKSPACE GUARD ─> PIPELINE LOCK (fallback, free) ─> ... ─> (post) RELEASE
```

```
QA REGRESSION ──fail / skipped──> FAILURE (no approval is requested, no UAT stage runs)
      │ 24/24
      ▼
UAT APPROVAL ──reject / timeout / abort──> ABORTED (nothing deployed, no deployment record)
      │       ──approver not authorized / allow-list not configured──> FAILURE (nothing deployed)
      │ approved by an authorized operator
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
Regression, the manual UAT approval, the promotion checks, UAT readiness and UAT Smoke all passed
(Validation Complete). Nothing reaches UAT without a human approval in Jenkins.

**UAT promotion policy (deterministic):** after a passing Regression, UAT is deployed **only if it
does not already run the exact validated image ID** (healthy). A test-only or documentation merge
keeps the same application image (see "Application image"), so UAT is not redeployed; it is still
verified (identity) and smoke-tested with the merged tests. A merge that changes the application
inputs produces a new image, validated by QA Regression and then deployed to UAT. The post-merge
Regression gate always runs.

## Merge policy and GitHub protection

Repository: https://github.com/vassilva/Automacao-ParaBank-Playwright (public, owned by a user
account; `main` is the default branch). **Every merge is manual**, by a person in the GitHub
interface, once the required checks passed. Auto-merge is disabled for the repository and nothing
merges automatically. There is **no file-based special review**: every PR is gated by the same
required CI checks.

| Control                | Setting                                                                                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auto-merge             | **disabled** for the repository (`allow_auto_merge: false`)                                                                                                                                                                                     |
| Ruleset `24842741`     | [`github-ruleset-main.json`](github-ruleset-main.json): PR required; no deletion; no force-push; required `Jenkins` and `continuous-integration/jenkins/pr-head` (Jenkins GitHub App 4991392) on a branch **up to date** with `main`; no bypass |
| Ruleset `24856083`     | [`github-ruleset-main-owner-merge.json`](github-ruleset-main-owner-merge.json): "restrict updates", **disabled since 2026-10-11** (its `update` rule makes every PR merge a bypass-only action). Kept for the record; do not re-enable          |
| Collaborators          | the owner only (`vassilva`, admin)                                                                                                                                                                                                              |
| Workflow token default | read-only; workflows cannot approve PRs                                                                                                                                                                                                         |

A failed, missing or pending required check blocks the merge; nobody can bypass ruleset
`24842741`. **Automation cannot merge:** Jenkins only publishes checks and statuses (it is not a
bypass actor), `playwright.yml` is manual and read-only, and auto-merge is disabled. Who can merge
follows from repository access (today only the owner). The required signals come from Jenkins only,
so GitHub and Jenkins have no circular dependency: Jenkins never waits for a GitHub status.

**History:** from 2026-10-10 to 2026-10-13 a required `gate-review` status (GitHub Actions) added a
human review for "gate-defining" files. It was removed on 2026-10-13 by the owner's decision: every
PR is gated by the CI checks, the merge is always a manual human act, and the human control before
UAT is the Jenkins approval (see "Manual UAT approval").

### Required signals and what GitHub counts as passing

Read from the installed plugins (checks-api 402, github-branch-source 1967) and observed on real
builds:

| Jenkins result | `Jenkins` check run                         | `pr-head` commit status | Merge                                                  |
| -------------- | ------------------------------------------- | ----------------------- | ------------------------------------------------------ |
| SUCCESS        | success                                     | success                 | allowed (manual merge)                                 |
| UNSTABLE       | neutral (if configured) or failure          | failure                 | blocked (PR UNSTABLE is turned into FAILURE anyway)    |
| FAILURE        | failure                                     | error                   | blocked                                                |
| NOT_BUILT      | skipped                                     | error                   | blocked by the status (the pipeline never produces it) |
| ABORTED        | failure (observed on a superseded PR build) | error                   | blocked                                                |
| running        | in progress                                 | pending                 | blocked                                                |

GitHub counts a skipped or neutral required **check** as passing, but a commit **status** passes
only when `success`; requiring both signals closes that gap. A missing signal blocks the merge.

### Jenkins job and GitHub discovery

Multibranch Pipeline `Automacao-ParaBank-Playwright` (GitHub Branch Source, GitHub App credential
`github-app-qa-automation`, app 4991392). Discovery: branches excluding those filed as PRs; PRs
from this repository at their head revision (no fork PRs). The local Jenkins is not reachable from
GitHub, so discovery is a **periodic scan every 2 minutes**; a scan only builds heads whose revision
changed. The job discards removed branches (a merged PR's `PR-<n>` job disappears with its builds;
GitHub keeps the checks).

**Automatic triggering: only `main` and `PR-<n>`.** Branch discovery excludes a branch only
_while_ it has an open PR. So a branch was built on its own before its PR was opened (the same
commit then built again as the PR), and again right after its merge: the PR closes, the next scan
discovers the branch as a new job, and a new job's first build is triggered by indexing. The real
records show it after every merge (`main` #2–#5, each with the merged branch's #1 in the same scan,
cause `BranchIndexingCause`). The branch source therefore has the branch property **"Suppress
automatic SCM triggering"** (branch-api, no plugin) with "Branch names to trigger automatically"
`main|PR-\d+` and the strategy "For matching branches schedule all builds (nothing is suppressed)":

| Head                                     | Automatic build (indexing or event)            | Manual "Build Now"                   |
| ---------------------------------------- | ---------------------------------------------- | ------------------------------------ |
| `main`                                   | yes: the post-merge pipeline always runs       | yes                                  |
| `PR-<n>`                                 | yes: the required pre-merge validation         | yes                                  |
| any other branch (no PR, or after merge) | **no**: the job exists, nothing runs by itself | yes: the push roles below, on demand |

Isolated Jenkins (`npm run test:queue`): a push to a branch without PR builds nothing; merging it
into `main` builds `main` once and not the branch; a newly discovered branch gets a job but no build;
a new PR commit builds that PR once; a manual branch build still runs (serialized like any other).
The rule matches by name, so it is the same for GitHub events (not reproducible offline).
Deleting the head branch after a merge (GitHub "Automatically delete head branches") also removes
the leftover branch job; optional.

## Stages, in execution order

| #    | Stage                                                   |        PR         |       push       |   main    | What it does                                                                                                                                                     |
| ---- | ------------------------------------------------------- | :---------------: | :--------------: | :-------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Build Context                                           |         ✓         |        ✓         |     ✓     | Mode (`CHANGE_ID` → PR; `main` → MAIN; else PUSH), role by prefix, plan, build tag (no executor)                                                                 |
| 2    | **Serialized Pipeline**                                 |         ✓         |        ✓         |     ✓     | ONE agent block for all the work below; timeout 300 min                                                                                                          |
| 2.1  | ↳ Workspace Guard                                       |         ✓         |        ✓         |     ✓     | Clean reports, no `.env`, 1 worker, 0 retries                                                                                                                    |
| 2.2  | ↳ Acquire Pipeline Lock                                 |         ✓         |        ✓         |     ✓     | Fallback lock (free under the queue dispatcher); then superseded commit → ABORTED                                                                                |
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

## Scheduling: one pipeline at a time, enforced in the Jenkins queue

**Requirement:** across every build of the job (PRs, `main`, branches) at most **one** is RUNNING;
every other build stays **QUEUED** in Jenkins, without any executor, checkout, Docker operation or
test, until the active build finished; then exactly one queued build starts.

**Why the pipeline lock alone could not do it:** a Pipeline build is RUNNING as soon as it leaves
the Jenkins queue, before its first step runs (`agent none` stages run on the controller's
flyweight executor). Anything inside the `Jenkinsfile` (the Docker-network lock, the Lockable
Resources `lock` step, `options { lock(...) }`, a `node` waiting for an executor) can only make an
already RUNNING build wait. Real evidence (`scripts/ci/build-overlap.ts` on the real build records):
after each of the last four merges, `main` and the merged source branch became RUNNING in the same
branch-indexing pass, 11 to 63 ms apart, 0 s blocked in the queue, and were RUNNING together for
330 s to 5.2 h (`main` #5 and `ci/serialized-pipeline-auto-uat` #1: 330 s, the second one waiting
for the lock). Options compared:

| Mechanism                                      | Waiting build                               | Why (not) chosen                                                                                                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/ci/pipeline-lock.sh` (Docker network) | RUNNING, holds an executor                  | Mutual exclusion only; kept as fallback                                                                                                                                                                                        |
| Lockable Resources `lock` / `options { lock }` | RUNNING ("waiting for resource")            | Same limit (a step of a running build); plugin not installed                                                                                                                                                                   |
| `disableConcurrentBuilds()`                    | QUEUED, but only behind the **same branch** | Each branch and PR is its own job                                                                                                                                                                                              |
| Throttle Concurrent Builds (job property)      | set by the Jenkinsfile                      | Applies only after a job's first build: every new PR job's first build would escape; plugin not installed                                                                                                                      |
| Queue dispatcher as an `init.groovy.d` script  | QUEUED, until a Jenkins restart             | Tried and rejected: Jenkins loads the saved queue and runs init scripts in the same startup phase (`@Initializer(after = JOB_CONFIG_ADAPTED)`, no order); restored builds started before it existed (observed in a crash test) |
| **Queue dispatcher as a minimal plugin**       | **QUEUED, no executor, reason shown**       | **Chosen:** Jenkins core extension point, consulted before an item leaves the queue; registered with the plugins, before the queue is loaded                                                                                   |

**Mechanism:** the plugin
[`jenkins/parabank-serial-queue-plugin`](../jenkins/parabank-serial-queue-plugin) (one class,
[`SerialQueueDispatcher`](../jenkins/parabank-serial-queue-plugin/src/main/java/io/github/vassilva/parabank/SerialQueueDispatcher.java),
Jenkins core APIs only, no plugin dependency) registers a `QueueTaskDispatcher` on the controller.
For a queue item whose task is a build of a
job inside `Automacao-ParaBank-Playwright`, it answers "blocked" while the project is busy, judged by
three independent signals (no gap between "left the queue" and "build record exists"): an item of
the project already released by the queue (pending or buildable), an executor (flyweight or
heavyweight) working for a build of the project, or a build of the project that has not finished
(also a build resumed after a restart). The queue shows the reason: "ParaBank serial queue: waiting
for Automacao-ParaBank-Playwright » main #6 to finish". The queue's maintenance is single-threaded
and a released build is pending at once, so the next item checked in the same pass is blocked (no
race). Never blocked: branch indexing, the executor requests of the running build (its `node`
blocks), resumption after a restart, and every other Jenkins job. If the check itself fails, the
build stays queued (fail closed) and the reason says so. Jenkins writes the queue to disk only on a
clean shutdown, so the dispatcher saves it (off the queue lock) as soon as it starts holding a new
build: held builds survive a crash (without the save they were observed lost).

**Fallback (kept):** all the work still runs in one agent block that takes the Docker-network lock
first and releases it in its `post` section on SUCCESS, FAILURE, ABORTED and timeout (owner-scoped,
idempotent, bounded wait `PARABANK_LOCK_WAIT_MINUTES` 180, stale after 330 min; `npm run test:lock`).
With the dispatcher installed it is always free; a build that has to wait for it logs
`WARNING: two builds are RUNNING together`, which means the dispatcher is missing. It is removed only
after the dispatcher has been validated on the real Jenkins over several merges (a separate PR).
Superseding is unchanged: after taking the lock, a build whose commit is no longer the head of its
PR or branch ends ABORTED, and `main`'s head is checked again before UAT, so a long-queued older
build never promotes an outdated image.

**Order and fairness:** blocked builds are released in queue order (oldest first): nobody starves,
and `main` is never skipped (it waits like any build; its post-merge pipeline always runs). Repeated
triggers of one branch while it is queued fold into one queue item. A queued build waits without a
time limit (it uses nothing); the RUNNING build is bounded by its 300-min timeout.

### Validation of the scheduling

**Isolated throwaway Jenkins** (`npm run test:queue`): same image (2.541.2; for 2.580.1 see "Validation status") and plugin set as the real
Jenkins, `--network none`, memory-capped, 2 executors; a Multibranch project with the real project's
name on a local Git repository; a fixture `Jenkinsfile` with the real shape (`agent none`, a
controller stage, one agent block with a stage timeout). Real Jenkins scheduling, sampled every
100 ms (1,860 samples in the final run) and checked again on the build records:

| Check                                                                                | Result                                                                                               |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Negative control, **without** the dispatcher                                         | 4 builds of the project RUNNING together (the real problem reproduced)                               |
| Plugin deployed without a restart (CLI `install-plugin -deploy`, as "Deploy Plugin") | active and enabled, no dependency, exactly one dispatcher registered                                 |
| `main` RUNNING, a PR triggered                                                       | PR QUEUED (blocked, reason names `main`), no build record, no executor, although an executor is idle |
| PR RUNNING, `main` triggered                                                         | `main` QUEUED, then ran to SUCCESS                                                                   |
| 3 PRs and `main` competing                                                           | one at a time, released in queue order                                                               |
| Manual branch build vs PR build (both directions)                                    | the second one QUEUED until the first finished                                                       |
| Holder ends SUCCESS / FAILURE / ABORTED / stage timeout                              | the next queued build starts, every time                                                             |
| Jenkins restart ×2 (JVM exit + `unless-stopped` policy, as the real container)       | plugin active again at start; queued builds kept, none started during startup; then one at a time    |
| Crash ×3 (`docker restart -t 0`)                                                     | same; the queued builds survive thanks to the queue save                                             |
| Unrelated job                                                                        | runs concurrently (not held)                                                                         |
| Three triggers of one queued PR                                                      | one queue item, one build                                                                            |
| Monitor over all scenarios                                                           | max RUNNING 1, no executor used by two project jobs, 0 violations                                    |
| `build-overlap.ts` on the build records after installation                           | 38 builds, **0** overlapping RUNNING intervals                                                       |

Not covered by the isolated run: GitHub events and pull-request discovery (no network; PRs are
simulated by branches named `PR-<n>`) and the real `Jenkinsfile`'s Docker work. On the real Jenkins
the evidence is the build records: `build-overlap.ts` (RUNNING intervals) and the metrics plugin's
blocked time per build.

### Installation and rollback (Jenkins administrator)

Install while no build of the project is running. The old and the new `Jenkinsfile` both keep the
fallback lock, so no installation order can create concurrency:

1. Build it: `sh jenkins/parabank-serial-queue-plugin/build.sh` (Maven in Docker; parent POM 5.9,
   Jenkins 2.541.2, Java 17) → `jenkins/parabank-serial-queue-plugin/target/parabank-serial-queue.hpi`.
2. Deploy it, no restart needed: **Manage Jenkins → Plugins → Advanced settings → Deploy Plugin**,
   choose the `.hpi`, **Deploy**. Jenkins loads it at once; from then on it loads with the plugins
   at every start, before the queue.
3. Check: **Manage Jenkins → Plugins → Installed** lists "ParaBank serial queue" 1.0.0, enabled; the
   Jenkins log has `ParaBank serial queue active for [Automacao-ParaBank-Playwright]`; with one build
   running, a second one is listed in the Build Queue with the reason above and has no build number.

Rollback: **Manage Jenkins → Plugins → Installed → ParaBank serial queue → Uninstall**, then restart
Jenkins while idle (or untick it to disable it). Builds are then serialized by the fallback lock only
(two RUNNING, one of them waiting), as before.

**Limits:** the dispatcher is controller configuration, not part of the build. A Jenkins without it
(or a renamed job: system property `parabank.serialQueue.projects`) falls back to the lock, which
the `WARNING` makes visible. An administrator can uninstall it. It is a private plugin of this
repository (not from the Jenkins update center): it uses only long-stable core APIs
(`QueueTaskDispatcher`, `Queue`, `Executor`, `Job`, `Run`), and is rebuilt only if those change.

### Audit of the plugin (2026-10-11)

| Area           | Result                                                                                                                                                                                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attack surface | No HTTP endpoint, form, permission, credential, network access, script evaluation or file I/O of its own (only Jenkins' `Queue.save()`); runs inside the queue maintenance, on no user input                                                                                                                                        |
| Dependencies   | Bundles nothing (the `.hpi` holds only its own jar: two classes); direct dependencies `jenkins-core` 2.541.2, `jakarta.servlet-api`, `commons-logging`, all `provided` by Jenkins. The build verifies every download's checksum (`mvn -C`)                                                                                          |
| Compatibility  | Manifest `Jenkins-Version: 2.541.2` (the minimum; the real Jenkins runs 2.580.1 since 2026-10-12), bytecode Java 17 (the real Jenkins runs Java 21), no plugin dependency; core APIs stable for many years. After a Jenkins upgrade: run `npm run test:queue` with the new image before relying on it                               |
| Concurrency    | `canRun` reads queue and executor snapshots; its own state is a synchronized set and an atomic flag; the queue save runs on Jenkins' timer, outside the queue lock, at most one at a time                                                                                                                                           |
| Failure modes  | Check error: the ParaBank build stays queued (fail closed, reason shown). Plugin missing, disabled or the job renamed: builds are serialized by the fallback lock only, with the `WARNING`. A ParaBank build that started another ParaBank build and waited for it would wait until its timeout (the `Jenkinsfile` never does this) |
| Exposure       | Queue reasons name the holding build (visible to logged-in users, as the queue already is); log line names the serialized project                                                                                                                                                                                                   |

**Artifact:** the build is not byte-reproducible (jar timestamps), so record the SHA-256 of the exact
`.hpi` you deploy (`sha256sum jenkins/parabank-serial-queue-plugin/target/parabank-serial-queue.hpi`);
its classes are identical across rebuilds of the same source.

**Evidence retention:** the job prunes removed branches, which deletes their build records; a
branch job removed after its PR was opened takes its builds with it (seen with
`ci/queue-level-serialization` #1, which `PR-8` #1 waited for). With the branch property such builds
no longer start; `build-overlap.ts` judges the records that remain.

## Gates

1. Stages run in sequence: a failing suite or count check fails its stage and the build; every
   later stage is skipped.
2. Each later step requires the previous gate's own flag, set only as the last statement of its
   stage: UAT Approval requires `QA_REGRESSION_PASSED`; UAT Promotion requires `UAT_APPROVED`; Deploy UAT and UAT Ready require
   `UAT_PROMOTION_VERIFIED`; UAT Smoke requires `UAT_READY`; the record requires
   `UAT_SMOKE_PASSED`; Validation Complete requires every flag of the plan.
3. No retries (`CUCUMBER_RETRY=0`), one worker, no ignored exit codes around suites, every suite run
   compared with its approved size.

## Gate drills (proving the gates in Jenkins)

`GATE_DRILL` (MAIN builds only, default `none`) points one suite at a port of its container on which
nothing listens; every scenario then fails for real, without changing any test or environment:

- `fail-qa-regression`: QA Regression fails → FAILURE, **nothing deployed to UAT**;
- `fail-uat-smoke`: after the operator approves UAT, UAT Smoke fails → FAILURE, no deployment
  record.

The QA drill never reaches the approval; the UAT drill needs the approval like any `main` build.

Run a normal `main` build afterwards so that QA and UAT end validated.

## Configuration

| Item                            | Where                   | Default | Meaning                                                                            |
| ------------------------------- | ----------------------- | ------- | ---------------------------------------------------------------------------------- |
| `PARABANK_MAIN_BRANCH`          | Jenkins global property | `main`  | Branch whose builds are the CD pipeline                                            |
| `PARABANK_LOCK_WAIT_MINUTES`    | Jenkins global property | `180`   | Maximum wait for the pipeline lock                                                 |
| `PARABANK_UAT_APPROVERS`        | Jenkins global property | (none)  | Jenkins user IDs allowed to approve UAT; **required** (empty: nothing reaches UAT) |
| `PARABANK_UAT_APPROVAL_MINUTES` | Jenkins global property | `60`    | Approval wait before ABORTED (bounded to 1–120)                                    |
| `RUN_KNOWN_DEFECTS`             | Build parameter (MAIN)  | `false` | Run the known defects on UAT after UAT Smoke                                       |
| `ADDITIONAL_QA_SUITE`           | Build parameter         | `none`  | `sanity` or `full` on QA after the QA gate                                         |
| `GATE_DRILL`                    | Build parameter (MAIN)  | `none`  | `fail-qa-regression` or `fail-uat-smoke`                                           |

## Manual UAT approval

After QA Regression passed on `main`, the build stops at **UAT Approval** (Jenkins input: "Deploy
to UAT" or "Abort", on the build page and in the stage view). Only the Jenkins users listed in
`PARABANK_UAT_APPROVERS` may approve; the answering user is checked again after the input, because
a Jenkins administrator can answer any input. Nothing approves it automatically: no stored
credential, script, bot or agent answers it.

- **Approve:** UAT Promotion verifies main's head and the image, deploys it if UAT does not already
  run it, then UAT Ready and UAT Smoke; the deployment record names the approver.
- **Abort, timeout (`PARABANK_UAT_APPROVAL_MINUTES`, default 60) or build cancellation:** ABORTED;
  no UAT stage runs, nothing is deployed, no deployment record.
- **Answer by a user outside the list, or empty list:** FAILURE; nothing is deployed.
- **While waiting** the build holds the pipeline lock and its executor; other ParaBank builds stay
  QUEUED (the queue dispatcher allows one active build anyway). The wait is bounded.
- **main moved on during the wait:** UAT Promotion aborts (SUPERSEDED); the newer `main` build asks
  for its own approval.

Verified on an isolated Jenkins 2.580.1 (no network, sandbox on) with the stage code extracted from
the Jenkinsfile (2026-10-13): authorized approval → promotion ran, SUCCESS; reject → ABORTED;
1-minute timeout → ABORTED; administrator outside the list → accepted by Jenkins, then refused by
the stage → FAILURE, no promotion; empty list → FAILURE before asking.

## Roles: push validation by branch prefix

Push builds run only when started manually (Build Now on the branch job): only `main` and `PR-<n>`
are triggered automatically (see "Jenkins job and GitHub discovery").

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
| GitHub workflows (`.github/**`), lint, format and ignore rules (checked by the Quality Gates)                                                                                                                                                                                  | nothing beyond Smoke            |
| documentation (`docs/**`, `*.md`), `.gitignore`, `.env.example` (never loaded in CI)                                                                                                                                                                                           | nothing beyond Smoke            |
| anything the map does not know (e.g. a new page object)                                                                                                                                                                                                                        | **Regression (24)** (fail-safe) |

**On pull requests the full Regression never runs:** a Regression-level selection (shared code or
high-risk files) is recorded in `selection.json` and deferred to the post-merge QA
Regression, which runs exactly once per promotion as the gate before UAT; feature-level selections
still run on the PR. `qa/*` pushes run the selection in full.

Known-defect scenarios are never selected (the `full` profile excludes them); a selection that
contains only known defects runs nothing and does not gate. After the run, the coverage validator
checks that exactly the selected scenarios ran, once each, and passed (`--paths` for a feature
selection, `--expect 24` for Regression). The selection is archived as
`reports/qa/impacted/selection.json`. The map lives in the script (`RULES`); a new domain needs a
new rule, and until then its files select Regression. Renames list both the old and the new path
(`--no-renames`), so moving shared code into a domain file still selects Regression.

Jenkins validates a PR with **the PR's own Jenkinsfile and scripts**, so a PR that changes the
pipeline or its scripts can change the checks that judge it. The human control for that is the
manual merge (read the diff before merging); after the merge, `main` is validated with its own
Jenkinsfile and nothing reaches UAT without the manual Jenkins approval.

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

|                 | QA                                                        | UAT                                              |
| --------------- | --------------------------------------------------------- | ------------------------------------------------ |
| Compose project | `parabank-qa`                                             | `parabank-uat`                                   |
| Local URL       | `http://localhost:8090/parabank/`                         | `http://localhost:8091/parabank/`                |
| From the agent  | `http://parabank-qa-parabank-1:8080/parabank/`            | `http://parabank-uat-parabank-1:8080/parabank/`  |
| Database        | own container, fresh per deploy                           | own container, fresh per deploy                  |
| Deployed by     | builds whose app image is new to QA (DEPLOY/BUILD)        | MAIN builds after QA Regression and UAT Approval |
| Tested with     | Smoke and/or Impacted Tests (PR, push), Regression (main) | Smoke                                            |
| After the build | left running                                              | left running                                     |

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
Container log scope (`scripts/log-capture.ts`): a build that is still SUCCESS at teardown archives
only its own window (`--logs-since-ms` = the build start), because QA and UAT are persistent and a
whole log would repeat every earlier build; a FAILURE, UNSTABLE or ABORTED build archives the whole
log, so a fault that began before the build is kept. An invalid or future start, or an empty
window, falls back to the whole log with a warning. Every path is redacted. (The result is read in
the agent block's `post`, where it is already final for every stage of that block; the later
"Validation Complete" stage only checks flags.)
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

1. **Merging:** a person merges each PR in GitHub once its required checks passed. Never automatic.
2. **UAT deployment:** an operator listed in `PARABANK_UAT_APPROVERS` approves each `main` build at
   its UAT Approval stage (or aborts it). Never automatic.
3. **Jenkins administrator, once:** install the queue dispatcher (see "Installation and
   rollback") and set the branch property "Suppress automatic SCM triggering" (`main|PR-\d+`, see
   "Jenkins job and GitHub discovery"). Done: both verified on the real Jenkins on 2026-10-13
   (`parabank-serial-queue` 1.0.0 installed, property set).
4. **Optional:** enable "Automatically delete head branches" in GitHub (removes leftover branch
   jobs); delete the stale `feature/ci-jenkins-pipeline` branch; delete `main` #1 (unredacted
   synthetic data, see "Artifacts archived before the log-redaction fix").
5. **Security updates:** the advisories found on 2026-10-11 (Jenkins 2.541.2 core, Script
   Security, Pipeline: Multibranch, Pipeline: Groovy Libraries) are resolved: the controller runs
   Jenkins 2.580.1 on Java 21 since 2026-10-12, and on 2026-10-13 none of the update center's
   security warnings matched the core or any of the 98 installed plugins. Re-check after each
   update-center refresh (Manage Jenkins shows the warnings). After any Jenkins upgrade, run
   `npm run test:queue` against the new image before relying on the serial-queue plugin; on
   2.580.1 the harness first needs the Jenkins URL configured in its throwaway instance (see
   "Validation status").

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
- **A build is QUEUED ("ParaBank serial queue: waiting for … to finish"):** normal; it starts when
  the named build finishes. Never cancel the running build to make room.
- **A build waits for the pipeline lock** (`WARNING: two builds are RUNNING together`): the queue
  dispatcher is not active (Jenkins without the init script, or removed); reinstall it. The waiter
  still fails after 180 min; a lock older than 330 min (holder died) is removed by the next waiter.
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

Records are dated; each describes the policy in force at that time (until 2026-10-13: the
`gate-review` check and automatic UAT promotion).

**Manual merge only, manual UAT approval (2026-10-13):** pipeline model tests (approval pending →
no UAT stage; rejected or timed out → ABORTED, nothing deployed; unauthorized or unconfigured →
FAILURE; Regression failure → no approval requested; CD success requires `UAT_APPROVED`); the
approval stage code run on an isolated Jenkins 2.580.1 (see "Manual UAT approval"); the Jenkinsfile
accepted by the 2.580.1 Declarative linter. Real `main` build with a human approval: `main` #13
(2026-10-13, merge of #16, `3bd9042`): Quality Gates (CI tests 115/115), QA Regression 24/24, UAT
Approval requested and approved by the authorized operator, UAT Promotion verified (deployment not
required: UAT already ran the validated image `sha256:ce686b92…`, same as QA), UAT Smoke 4/4,
Validation Complete, SUCCESS. Not yet exercised for real: an approved build that redeploys UAT
(the next `main` build bringing a new application image).

**Real Jenkins and GitHub (2026-10-10), previous designs of this pipeline:**

| Evidence                                    | Result                                                                                                                                                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PR-2` #1 (gate-defining PR)                | SUCCESS: Quality Gates, Config Check, QA Smoke 4/4, Regression 24/24 (then still run on PRs), Validation Complete; checks from app 4991392; merge blocked while missing and pending, CLEAN only after success; 0 unredacted values in console and 13 archived files |
| `main` #3, `main` #4                        | SUCCESS: image built once, QA Regression 24/24, (then manual) approval by `viamerico`, same image ID on UAT, UAT Smoke 4/4                                                                                                                                          |
| `PR-3` #1 superseded by a new commit        | ABORTED after taking the lock; `Jenkins` check failure, `pr-head` error (non-passing)                                                                                                                                                                               |
| `PR-4` #1 (deliberate formatting violation) | FAILURE in Quality Gates, nothing deployed, lock untouched; status rollup FAILURE; closed, never merged                                                                                                                                                             |
| `gate-review`                               | success on ordinary PRs, failure on an unreviewed gate-defining PR, posted by GitHub Actions (app 15368)                                                                                                                                                            |
| Repository settings and rulesets            | auto-merge disabled; ruleset `24842741` (checks) and `24856083` (restrict updates) active; owner bypass: `never` / `pull_requests_only`                                                                                                                             |

**Serialized pipeline with automatic UAT promotion (PR #7):** real `main` #5 SUCCESS (QA Regression,
automatic UAT promotion, UAT Smoke); the same scan also started the merged branch
`ci/serialized-pipeline-auto-uat` #1, RUNNING alongside it and waiting for the lock: the defect
"Scheduling" fixes.

**Queue-level scheduling (plugin) and branch triggering on the real Jenkins (2026-10-13):** the
plugin is installed and the branch property is set (verified in `$JENKINS_HOME`). Updating PRs #14
and #13 together queued `PR-14` #5 and `PR-13` #5 at the same time: `PR-13` #5 got its build record
(left the queue) 4.4 s after `PR-14` #5 finished and acquired the fallback lock at once (no lock
wait), i.e. it was held in the queue, not on an executor. `scripts/ci/build-overlap.ts` on the real build records (copied 2026-10-13, judged since the
upgrade window 2026-10-12T17:33Z): 18 builds judged, 0 overlapping RUNNING pairs; the queued builds
carry their measured time blocked in the queue (`PR-13` #5 364 s, `PR-17` #1 542 s, `PR-18` #1
1,506 s). Those PRs were later closed without merging (owner's change of scope); their builds
remain valid scheduling evidence.

**`npm run test:queue` on Jenkins 2.580.1:** the harness in this repository was written for 2.541.2.
Jenkins 2.580.1 refuses CLI connections until the Jenkins URL is configured, so the throwaway
instance must get a `jenkins.model.JenkinsLocationConfiguration.xml` (`http://localhost:8080/`)
before it starts. With that local, unmerged adjustment the harness passed on the 2.580.1 image on
2026-10-12 (0 failed steps, 0 overlapping builds); without it, it cannot drive a 2.580.1 instance.

**Isolated throwaway Jenkins** (same image and plugin set, no network): the official Declarative
linter validates this `Jenkinsfile`; earlier runs there proved the sandboxed flag lookup, UNSTABLE →
FAILURE and the head-check ABORTED result.

**Local:** `npm run test:ci` (pipeline order and gates on the Jenkinsfile's own stage conditions,
serialization structure, automatic promotion and its fail-closed checks, the application-image
decision, PR Regression deferral, the gate-review policy including fail-closed), `npm run test:lock`
(lock concurrency on the local Docker daemon), lint, format, typecheck, dry run, test-data audit,
BDD structure, suite inventories, config check, actionlint, Groovy parse; `npm run test:queue`
(queue-level scheduling and branch triggering in an isolated Jenkins, see "Scheduling").

## Readiness: database initialized

ParaBank creates its database lazily, on home-page requests. The container healthcheck's bare
HTTP/1.0 probe triggers that initialization but never completes it, so a freshly deployed
container reports "healthy" while registration still fails with HTTP 500 ("object not found:
SEQUENCE"). `scripts/environment.ts` therefore makes one complete home-page request and then
requires the application's own "Database initialized" log line since the container started (a
database kept across a restart logs neither message and is ready at once). `deploy` returns only
then, and the QA Ready / UAT Ready stages use the same check. The log is only searched for that
line, never printed or stored.
