# CI/CD: role validation, PR checks, auto-merge, QA Regression, approval, UAT Smoke

One `Jenkinsfile`, one **Multibranch Pipeline**. Every build that deploys creates the ParaBank image
exactly once and the environments run that image by ID. The target flow is:

```
Developer / QA / Configurator ─> push ─> role-specific validation ─> Pull Request
  ─> Quality Gates + QA Smoke (4) + QA Impacted Tests  (= the required "Jenkins" check)
  ─> GitHub auto-merge (enabled per eligible PR, merges only after the check passed)
  ─> main: automatic QA deployment ─> QA Regression (24) ─> mandatory manual Jenkins approval
  ─> UAT deployment (same image ID) ─> UAT Smoke (4)
```

```
PUSH, by branch prefix (a branch with an open PR is built as the PR only):
  feature/*, others  DEVELOPER     QUALITY GATES ─> BUILD IMAGE ─> DEPLOY QA ─> QA READY ─> QA SMOKE (4)
  qa/*               QA            QUALITY GATES ─> BUILD IMAGE ─> DEPLOY QA ─> QA READY ─> QA IMPACTED TESTS
  config/*           CONFIGURATOR  QUALITY GATES ─> CONFIG CHECK          (no image, no deployment, no lock)

PULL REQUEST (CI)  QUALITY GATES ─> BUILD IMAGE ─> DEPLOY QA ─> QA READY ─> QA SMOKE (4) ─> QA IMPACTED TESTS
                   = the "Jenkins" check GitHub requires before a merge or an auto-merge

MAIN (CD)          QUALITY GATES ─> BUILD IMAGE ─> DEPLOY QA ─> QA READY ─> QA REGRESSION (24)
                     ─> UAT APPROVAL (input; authorized approver; timeout; supersedes older waiting builds)
                     ─> VERIFY APPROVED IMAGE (still main's head) ─> PROMOTE SAME IMAGE ID ─> UAT READY
                     ─> UAT SMOKE (4) [─> KNOWN DEFECTS (optional, never gating)] ─> DEPLOYMENT RECORD
```

```
QA REGRESSION ──fail──> FAILURE (no approval requested, nothing deployed to UAT)
      │ pass
      ▼
UAT APPROVAL ──reject / timeout / abort / superseded──> ABORTED (nothing deployed to UAT)
      │       ──not an authorized approver / approvers not configured──> FAILURE (nothing deployed)
      │ approved by an authorized approver
      ▼
VERIFY ──main moved on──> ABORTED "SUPERSEDED" (nothing deployed)
      │
      ▼
PROMOTE ─> UAT READY ─> UAT SMOKE ──fail──> FAILURE (no deployment record)
                            │ pass 4/4
                            ▼
                         SUCCESS
```

A Pull Request never deploys to UAT. The main pipeline runs no QA Smoke and no UAT Regression; it
is SUCCESS only if UAT Smoke and its count check pass. Auto-merge changes only **who clicks merge**
(GitHub, once the required check passed): every gate after the merge is unchanged, and nothing
reaches UAT without the manual Jenkins approval.

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
auto-merged (see the auto-merge policy).

## Repository, branches and merge protection

- **Repository:** https://github.com/vassilva/Automacao-ParaBank-Playwright (public; `main` is the
  default branch). Work happens on `feature/*` branches and reaches `main` only through a PR.
- **Required check:** the GitHub check run **`Jenkins`**, published by the GitHub App
  `jenkins-qa-automation` (app ID **4991392**) for every Jenkins build. For a PR build it carries the
  result of the whole PR pipeline: Quality Gates, Config Check, QA Smoke, QA Impacted Tests, their
  count checks, and the final **Validation Complete** stage, which fails the build unless every
  validation of the plan actually ran and passed (a skipped stage never counts as a pass). Observed
  on PR #1, together with `Tests / Build, Deploy and Validate` (named after a stage, so it changes
  when stages are renamed; not required) and the commit status
  `continuous-integration/jenkins/pr-head` (named after the PR discovery strategy). Both `Jenkins`
  and the status are posted by app 4991392 (`jenkins-qa-automation[bot]`).
- **Why two required signals.** Read from the installed plugins (checks-api 402,
  github-branch-source 1967):

  | Jenkins result | `Jenkins` check run                | `pr-head` commit status | GitHub treats it as |
  | -------------- | ---------------------------------- | ----------------------- | ------------------- |
  | SUCCESS        | success                            | success                 | pass                |
  | UNSTABLE       | neutral (if configured) or failure | failure                 | **neutral = pass**  |
  | FAILURE        | failure                            | error                   | fail                |
  | NOT_BUILT      | **skipped**                        | error                   | **skipped = pass**  |
  | ABORTED        | cancelled                          | error                   | fail                |
  | running        | in progress                        | pending                 | blocks              |

  GitHub counts a skipped or neutral required **check** as passing; a commit **status** passes only
  when `success`. The pipeline therefore never ends a PR build NOT_BUILT or UNSTABLE (no milestones
  on PR/branch builds, and `post` turns UNSTABLE into FAILURE), and the ruleset requires
  **both** the `Jenkins` check and the `continuous-integration/jenkins/pr-head` status from app
  4991392, so that even a regression of the pipeline cannot turn a non-validated build into a merge.
  Caveat: the status name follows Jenkins' PR discovery strategy; switching to "merge" would rename
  it to `pr-merge` and block every PR until the ruleset is updated (fail-safe).

- **Protection (to be applied, see the authorization runbook):** the repository ruleset
  [`github-ruleset-main.json`](github-ruleset-main.json) on the default branch requires a pull
  request, requires the `Jenkins` check and the `pr-head` status from app 4991392 to pass on a
  branch that is up to date with `main` (a failing, pending or missing check blocks the merge),
  blocks direct pushes, force-pushes and deletion, and has **no bypass actors**. It requires no
  review approval, because a single maintainer cannot approve their own PR. Rulesets and branch
  protection are available on public repositories on every GitHub plan. The repository owner can
  still edit or disable the ruleset; that is an administrative action outside any PR.
- **Up to date, not a merge queue:** merge queues are available only for organization-owned
  repositories; this repository belongs to a user account. "Require branches to be up to date"
  (`strict_required_status_checks_policy: true`) gives the same guarantee for one PR at a time: the
  `Jenkins` check must have passed on the PR head **including the current `main`**. When `main`
  moves, the PR is out of date and cannot merge (auto-merge waits) until it is updated (the "Update
  branch" button, enabled by `allow_update_branch`) and Jenkins has passed again on the new head.
  Jenkins builds PRs at their head revision, so the validated revision is exactly what merges.
- **Auto-merge policy (enabled per PR, never by default):** the repository setting
  `allow_auto_merge` only makes the option available; nothing enables it automatically. It is
  enabled intentionally, per eligible PR, by its author or a maintainer:
  `gh pr merge <n> --auto --merge` (or "Enable auto-merge" on the PR). A PR is eligible when it is
  ready for review (not a draft), targets `main`, comes from this repository, its author wants it in
  `main` as soon as it is validated, and it changes **no gate-defining file**
  (`.github/gate-defining-paths.json`: the Jenkinsfile, `scripts/ci/**`, the test-data audit, log
  and report redaction, runner configuration and dependencies, the Playwright adapter, the CI agent
  image, lint/format configs, `.github/**`, the ruleset file). Such a PR is judged by the very
  checks it modifies, so it is reviewed and merged manually.
  **Enforcement:** the console line `GATE-DEFINING CHANGE` alone prevents nothing. The enforcement
  is `.github/workflows/gate-guard.yml`: a `pull_request_target` workflow, which GitHub always
  runs from `main` (a PR cannot change the guard or its list until it is merged). On every PR
  event, including "auto-merge enabled", it reads the PR's changed paths (old and new paths of
  renames) and, if one matches `main`'s list, turns auto-merge off and comments why. It never
  checks out or runs PR code. It is not a required check, so a human can still merge manually.
  Limits: it acts only after it is on `main` and GitHub Actions is enabled; it reacts within
  seconds, so enabling auto-merge on a PR whose checks have **already** passed merges at once,
  which is a deliberate human merge rather than an unattended one; it has not run on GitHub yet.
  Merge queues and push rulesets (file-path restrictions) are not available for this
  user-owned public repository, and code-owner review would block the only maintainer.
  GitHub then merges an
  eligible PR only when every ruleset rule is satisfied: the `Jenkins` check and the `pr-head`
  status passed on an up-to-date head. A missing, pending, failing, cancelled or errored signal
  blocks the merge; a new push re-runs the check and the merge waits for it. GitHub
  disables auto-merge itself if someone without write access pushes to the PR branch or the base
  branch is changed. `gh pr merge <n> --disable-auto` cancels it.
- **Jenkins job:** Multibranch Pipeline `Automacao-ParaBank-Playwright` (GitHub Branch Source,
  credential `github-app-qa-automation`), created in the Jenkins UI as a copy of the ServeRest job.
  Discovery: branches excluding those filed as PRs; PRs from the repository itself at the PR head
  revision. The local Jenkins is not reachable from GitHub, so it relies on periodic scans; **the
  job currently has no periodic scan trigger** (see the authorization runbook).

| Event                                | Jenkins build           | What runs                                                                                               | UAT?           |
| ------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------- | -------------- |
| Push to a branch without a PR        | branch job (PUSH)       | by prefix: `feature/*` Smoke, `qa/*` Impacted Tests, `config/*` Config Check (see Roles)                | no             |
| PR opened / updated (from this repo) | `PR-<n>` (PULL REQUEST) | quality gates, build image, deploy QA, **QA Smoke (4)**, **QA Impacted Tests**; = the `Jenkins` check   | no             |
| Merge into `main` (auto or manual)   | `main` (MAIN)           | quality gates, build image, deploy QA, **QA Regression (24)**, **approval**, promote, **UAT Smoke (4)** | after approval |

## Stages, in execution order

| #   | Stage                                 | PR / PUSH | MAIN | What it does                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------- | :-------: | :--: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Build Context                         |     ✓     |  ✓   | Build mode (`CHANGE_ID` → PR; `PARABANK_MAIN_BRANCH`, default `main` → MAIN; otherwise PUSH), push role by prefix, build image tag                                                                                                                                                                                 |
| 2   | **Build and QA** (agent, host lock)   |     ✓     |  ✓   | Workspace Guard (1 worker, 0 retries, no `.env`; PR/branch: superseded → ABORTED) → Install → Quality Gates → [Config Check: PR and `config/*`; `config/*` stops here] → Acquire Host Lock (then superseded → ABORTED) → Build Image (once) → Deploy QA → QA Ready (healthy, database initialized, exact image ID) |
| 2a  | ↳ QA Smoke                            |  PR, dev  |  –   | CI gate: `test:smoke`, then 4/4 executed once and passed                                                                                                                                                                                                                                                           |
| 2b  | ↳ QA Impacted Tests                   |  PR, qa   |  –   | `ci:impacted run`: the change's selection (see above), then exactly the selected scenarios executed once and passed                                                                                                                                                                                                |
| 2c  | ↳ QA Gate                             |     ✓     |  –   | Fails unless every suite the role requires ran and passed; then sets `QA_GATE_PASSED` (not for `config/*`)                                                                                                                                                                                                         |
| 2d  | ↳ QA Regression                       |     –     |  ✓   | **Deployment gate**: `test:regression`, then 24/24 executed once and passed                                                                                                                                                                                                                                        |
| 2e  | ↳ QA Additional Suite                 |    opt    | opt  | Parameter `ADDITIONAL_QA_SUITE` = `sanity` (10) or `full` (52), after the QA gate passed                                                                                                                                                                                                                           |
| 2f  | **Validation Complete** (no agent)    |     ✓     |  –   | Fails unless every flag of the plan is set (PR: Config Check, Smoke, Impacted Tests, QA Gate); a skipped stage never counts as a pass                                                                                                                                                                              |
| 3   | **UAT Approval** (no agent, no lock)  |     –     |  ✓   | Only if QA Regression passed. Milestone (supersedes older waiting builds), mandatory `input` restricted to `PARABANK_UAT_APPROVERS`, timeout `PARABANK_UAT_APPROVAL_MINUTES` (default 60), approver re-checked, milestone "UAT approved"                                                                           |
| 4   | **UAT Deployment** (agent, host lock) |     –     |  ✓   | Only after an authorized approval: Workspace Guard → Install → Host Lock → Verify Approved Image (commit still main's head, same image ID) → Promote to UAT (same image ID, no rebuild) → UAT Ready (healthy, database initialized, identity = approved)                                                           |
| 4a  | ↳ UAT Smoke                           |     –     |  ✓   | Post-deployment verification: `test:smoke`, then 4/4                                                                                                                                                                                                                                                               |
| 4b  | ↳ Known Defects                       |     –     | opt  | Parameter `RUN_KNOWN_DEFECTS`, after UAT Smoke passed: 25 known-defect scenarios; at most UNSTABLE                                                                                                                                                                                                                 |
| 4c  | ↳ Deployment Record                   |     –     |  ✓   | `deployment/deployment-record.txt`: source commit, built/QA/UAT image IDs, approver, validation counts                                                                                                                                                                                                             |

The approval runs between two agent stages on purpose: while it waits, the pipeline holds **no
executor, workspace or host lock**, so other pipelines (PR builds, other jobs) keep running. The
host lock is released after QA and acquired again for UAT; the approved image is checked again
before promotion (same ID as the one QA Regression validated, still present, built from the pinned
commit). The build's image tag is kept only while an approval is pending; a reject, timeout or abort
removes it (pipeline `post`), so a rejected image can never be promoted later by mistake.

## Approval: who can approve

- `PARABANK_UAT_APPROVERS` (Jenkins global property, **required**): comma-separated Jenkins user
  IDs. If it is unset or empty, the approval stage fails and nothing is deployed.
- The `input` is restricted to those users (`submitter`), and the pipeline **checks the approver
  again** after the input returns (`submitterParameter`), failing without deploying if the approver
  is not in the list.
- Why both: this Jenkins uses "Logged-in users can do anything", so every account (`admin`,
  `noreply`, `viamerico`) is a Jenkins administrator, and Jenkins lets administrators answer any
  input regardless of `submitter`. The pipeline-side check still refuses to deploy for anyone not in
  `PARABANK_UAT_APPROVERS`. To stop other accounts from even clicking, restrict Jenkins
  authorization (Matrix-based security) or disable the unused accounts: a Jenkins setting outside
  this repository. The approver for this installation is `viamerico` (your account, matched by its
  e-mail address; not yet configured).
- Verified on the isolated Jenkins: an identity outside the allow-list could answer the input, and
  the pipeline then failed with "not an authorized UAT approver … Nothing is deployed to UAT"; an
  allow-listed identity succeeded; `input` returns the approver ID as a String.
- Reject, timeout (default 60 minutes) or abort end the build ABORTED with no UAT stage executed
  (reject and timeout verified on the isolated Jenkins). Supersession by a newer `main` build ends
  it NOT_BUILT, also before any UAT stage.

## Gates

1. Stages run in sequence: a failing suite (or its count check) fails its stage, the build is FAILED,
   and every later stage is skipped.
2. Each later step also requires the previous gate's own flag, set only as the last statement of
   that stage: the approval requires `QA_REGRESSION_PASSED`; the UAT deployment requires
   `UAT_APPROVED` (set only after the approver check); UAT Smoke requires `UAT_READY`; the
   deployment record and known defects require `UAT_SMOKE_PASSED`.
3. No retries (`CUCUMBER_RETRY=0`, checked by both Workspace Guards), no ignored exit codes around
   suites, and every suite run is compared with its approved size.

Checked locally (not a Jenkins run): the Jenkinsfile parses with the Groovy runtime bundled in the
lab Jenkins (a deliberately broken copy does not), and a simulation that evaluates the Jenkinsfile's
own `when` expressions gives: PR → QA Smoke → QA Impacted Tests → QA Gate; `feature/*` and other
pushes → QA Smoke → QA Gate; `qa/*` → QA Impacted Tests → QA Gate; `config/*` → Quality Gates →
Config Check, with no lock, image, deployment or QA teardown; MAIN → QA Regression → approval →
verify → promote → UAT Ready → UAT Smoke → deployment record; failed QA Regression → FAILURE, no
approval; reject or timeout → ABORTED before any UAT stage; unauthorized or unconfigured approver →
FAILURE before any UAT stage; failed verification, UAT readiness or UAT Smoke → FAILURE, no
deployment record.

## Gate drills (proving the gates in Jenkins)

`GATE_DRILL` (MAIN builds only, default `none`) points one suite at a port of its container on
which nothing listens. Every scenario then fails for real, at transport level, without changing
any test or either environment:

- `fail-qa-regression`: QA Regression fails → FAILURE, **no approval requested, nothing deployed to
  UAT**.
- `fail-uat-smoke` (approve when asked): UAT Smoke fails → FAILURE, no deployment record.

The approval gate itself is proven by rejecting (or letting time out) one normal MAIN build:
ABORTED, UAT untouched. Run a normal build afterwards to leave QA and UAT validated again.

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

|                 | QA                                                        | UAT                                                     |
| --------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| Compose project | `parabank-qa`                                             | `parabank-uat`                                          |
| Local URL       | `http://localhost:8090/parabank/`                         | `http://localhost:8091/parabank/`                       |
| From the agent  | `http://parabank-qa-parabank-1:8080/parabank/`            | `http://parabank-uat-parabank-1:8080/parabank/`         |
| Database        | own container, fresh per deploy                           | own container, fresh per deploy                         |
| Deployed by     | every build except `config/*` pushes                      | MAIN builds that passed QA Regression and were approved |
| Tested with     | Smoke and/or Impacted Tests (PR, push), Regression (main) | Smoke                                                   |
| After the build | left running                                              | left running                                            |

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
failure or abort, and only by its owner. Cucumber always runs with one worker and no retries
(checked by the Workspace Guard). The atomicity was checked on the lab daemon (Docker 29.7.2):
5 rounds of 12 simultaneous `docker network create` of one name produced exactly one network each.

What the lock covers, per build: Build Image → Deploy QA → QA Ready → suites → QA teardown (PR,
`feature/*`, `qa/*`, `main`), and separately UAT promotion → UAT Smoke (`main`, after approval).
`config/*` pushes take no lock. The approval wait holds no lock, executor or workspace.

**Superseding.** `disableConcurrentBuilds()` is gone: it would make a newer `main` build wait behind
an older one sitting at the approval.

- **PR and branch builds use no milestone.** A build cancelled by a milestone ends NOT_BUILT, which
  the checks plugin publishes as a _skipped_ `Jenkins` check, and GitHub counts skipped required
  checks as passing (see "Why two required signals"). Instead, the build compares its commit with
  the PR/branch head (`git ls-remote`, URL never traced) in the Workspace Guard and again right
  after acquiring the lock (the long wait), and ends **ABORTED** ("SUPERSEDED", check
  _cancelled_, status _error_) if a newer commit exists. If the head cannot be read it continues:
  finishing a build is always safe. Two builds of the same commit both run to their own result.
- **`main` uses milestones** (decoded from the installed plugin 138.v78ca_76831a_43: passing ordinal
  _N_ aborts every older running build of the job whose last milestone is lower, and aborts the
  build itself if a newer one already passed _N_ or more). `main` builds run up to QA Regression in
  order (host lock). At the approval each passes ordinal = build number, which aborts any **older
  build still waiting for approval**, and aborts this build if a **newer** one already asked. After
  the approval each passes ordinal 1 000 000 000: a build already approved and deploying is never
  aborted by a newer one, and an older build approved after a newer one was approved is aborted.
  A `main` build cancelled by the milestone ends **NOT_BUILT without running any `post` section**
  (verified on an isolated Jenkins with the same plugins): its check on that `main` commit shows
  "skipped" (`main`'s checks gate nothing) and its build tag `parabank-ci:main-<n>-*` is left
  behind. That image can never be promoted (promotion uses the build's own image ID after its own
  approval); see "Recovery" for the tag cleanup.
- Verify Approved Image reads `main`'s head: if `main` moved on since this build's commit, the build
  ends ABORTED "SUPERSEDED" before anything is deployed. Only the latest validated image can reach
  UAT.

**Shared QA risks and how they are handled:**

| Risk                                                             | Handling                                                                                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two builds deploy or test QA at the same time                    | Host lock around build, deploy and test; one Cucumber worker                                                                                      |
| A PR build replaces the image QA Regression is testing           | Impossible while the lock is held; QA Regression runs inside the lock                                                                             |
| QA runs a PR candidate after the main build moved on to approval | Expected: approval and UAT use the image **ID**, not QA's current state; Verify Approved Image checks the image still exists and its revision     |
| Several PRs auto-merge in a row                                  | Each merge starts a `main` build; they validate in order; the newest reaching approval supersedes older waiting ones; the head check blocks older |
| A PR validated against an old `main`                             | Required check is strict (up to date): out-of-date PRs cannot merge until updated and re-validated                                                |
| A superseded PR build reports a passing check                    | No milestones on PR builds (head check → ABORTED); UNSTABLE → FAILURE; the ruleset also requires the `pr-head` status (success only)              |
| PR checks wait while another build holds QA                      | Bounded lock wait (60 min) and stage timeouts; superseded builds stop after the wait; the approval holds no lock                                  |

**Expected bottleneck.** Everything that deploys is serialized by the lock. Measured in the two
real builds, the ParaBank image build alone took 280 s and 315 s (it compiles the pinned source and
runs ParaBank's own 239 tests, `PARABANK_BUILD_FRESH=true`); locally, Regression (24) ran in 27 s
and one feature in 8 s; deploy + readiness are estimated at 1–2 minutes (not measured separately).
A PR or `main` build therefore holds the lock for an **estimated 7–10 minutes**, most of it in the
image build (whole builds: `main` #1 11.6 min, `PR-1` #1 19.9 min, earlier pipeline designs). Builds queue one after
another: about 6 builds waiting at once reach the 60-minute lock wait and fail (a failed check
blocks the merge: safe, but noisy). Auto-merge adds one `main` build per merged PR, and the strict
up-to-date rule makes every other open PR re-validate after each merge, so N open PRs cost roughly
N² / 2 builds when merged one by one.

**Not changed, on purpose:** the image build stays inside the lock. It does not touch QA, but the
lock was introduced because two pipelines building and testing ParaBank at once exhausted the lab's
Docker VM (3.7 GiB) and every Smoke step timed out (`scripts/ci/host-lock.ts`). Moving it out would
reintroduce that failure on this host.

**Future scaling (not implemented):**

1. Reuse the application image across PRs: the application is the pinned upstream commit, so a PR
   that does not touch `docker/parabank/**` could deploy an image already built from the same
   inputs (content-addressed tag, verified by revision label and image ID), cutting ~5 min from the
   lock. `main` keeps building fresh for provenance. Needs a decision on the "build once per
   pipeline" rule.
2. A larger Docker VM, then a separate build lock (CPU/memory) and QA lock (environment).
3. Ephemeral per-PR environments (one Compose project per PR on its own port) with a capacity
   limit; QA stays the shared integration environment for `main`.
4. A merge queue (if the repository moves to an organization) instead of strict up-to-date, so
   queued PRs are validated together once instead of re-validated after every merge.

## Configuration

| Item                            | Where                   | Default | Meaning                                                                    |
| ------------------------------- | ----------------------- | ------- | -------------------------------------------------------------------------- |
| `PARABANK_UAT_APPROVERS`        | Jenkins global property | (none)  | **Required for MAIN**: Jenkins user IDs allowed to approve UAT deployments |
| `PARABANK_UAT_APPROVAL_MINUTES` | Jenkins global property | `60`    | Approval timeout; expiry → ABORTED, nothing deployed                       |
| `PARABANK_MAIN_BRANCH`          | Jenkins global property | `main`  | Branch whose builds are the CD pipeline                                    |
| `RUN_KNOWN_DEFECTS`             | Build parameter (MAIN)  | `false` | Run the known defects on UAT after UAT Smoke                               |
| `ADDITIONAL_QA_SUITE`           | Build parameter         | `none`  | `sanity` or `full` on QA after the QA gate                                 |
| `GATE_DRILL`                    | Build parameter (MAIN)  | `none`  | `fail-qa-regression` or `fail-uat-smoke` (see drills)                      |

Agent requirements: a Docker-capable Jenkins with the Docker Pipeline, Pipeline: Input Step and
Pipeline: Milestone Step plugins, git in the agent image (the Playwright base image has it), access
to the host Docker socket, a `built-in` node with executors (removing a build's
image tag after a rejected approval), and host ports 8090 and 8091 free for QA and UAT.

## First real integration: authorization runbook

Nothing below has been done. Each step is a separate authorization, in this order
(`R` = `vassilva/Automacao-ParaBank-Playwright`).

1. **Apply the ruleset** — `gh api -X POST repos/R/rulesets --input docs/github-ruleset-main.json`.
   - _Changes:_ `main` requires a PR and the `Jenkins` check + `pr-head` status (app 4991392) on an
     up-to-date head; no direct or force pushes, no deletion, no bypass actors.
   - _Risk:_ a required signal never arrives (e.g. the status is not attributed to the app) and every
     PR is blocked; direct pushes to `main` stop working (intended).
   - _Verify:_ `gh api repos/R/rules/branches/main`; on the first PR both signals show as required and
     the merge is blocked while they are pending.
   - _Revert:_ `gh api -X DELETE repos/R/rulesets/<id>` (or set enforcement to "disabled").
2. **Jenkins global property** `PARABANK_UAT_APPROVERS=viamerico` (optionally
   `PARABANK_UAT_APPROVAL_MINUTES`) — Manage Jenkins → System → Global properties.
   - _Why:_ without it the `main` pipeline stops at the approval. `viamerico` is your account
     (matched by its e-mail address, read-only).
   - _Risk:_ global properties are visible to every job (the other jobs do not read this one).
   - _Verify:_ the "UAT APPROVAL REQUIRED" banner lists `viamerico`. _Revert:_ remove the property.
3. **Push the branch and open the PR at once** — `git push -u origin feature/ci-pr-smoke-main-regression`,
   `gh pr create --base main`.
   - _Changes:_ publishes the commits (public repository; the diff was scanned: no secrets).
   - _Risk:_ a scan between push and PR also builds the branch job (Developer plan; harmless, uses QA).
   - _Verify:_ PR page; `git status -sb` shows the branch in sync. _Revert:_ close the PR, delete the
     remote branch.
4. **PR discovery** — the job's "Scan Multibranch Pipeline Now", then the trigger "Periodically if
   not otherwise run" every 2 minutes (the local Jenkins is not reachable from GitHub: no webhook).
   - _Risk:_ every pushed branch or PR gets built (QA use, serialized by the lock); the scans use a
     small part of the App's API quota.
   - _Verify:_ the scan log lists `PR-<n>` and its build starts. _Revert:_ untick the trigger.
5. **Inspect the PR build** (read-only): Quality Gates (incl. BDD structure), Config Check, QA Smoke
   4/4, QA Impacted Tests = Regression 24/24 (this PR is gate-defining), QA Gate, Validation Complete.
   GitHub must show `Jenkins` = success and `pr-head` = success from `jenkins-qa-automation[bot]`.
6. **Pending blocks the merge** (read-only, during step 5): `gh pr view <n> --json mergeStateStatus`
   is `BLOCKED` while the build runs, `CLEAN` after it passed.
7. **Superseding drill** — push one empty commit (`git commit --allow-empty`) while the PR build runs.
   - _Proves:_ the older build ends ABORTED ("SUPERSEDED"; check "cancelled", status "error"), never
     "skipped"; the new build validates the new head. _Cost:_ one extra build.
8. **Manual merge of this PR** (gate-defining, never auto-merged) — `gh pr merge <n> --merge` once
   everything is green.
   - _Changes:_ starts the `main` pipeline and puts the gate guard on `main`.
   - _Revert:_ a revert PR (`git revert -m 1 <merge sha>`) through the normal flow.
9. **`main` pipeline** (automatic after the scan): Quality Gates → build once → deploy QA → QA
   Regression 24/24 → approval request. A failure ends FAILURE with nothing deployed to UAT.
10. **Approve in Jenkins as `viamerico`** — same image ID promoted to UAT, UAT Smoke 4/4, deployment
    record ("Approved by: viamerico", built = QA = UAT image ID). On failure see Recovery.
11. **Gate drills**, one authorized build each ("Build with Parameters" on `main`):
    `fail-qa-regression` (FAILURE, no approval); a normal build whose approval is rejected (ABORTED);
    `fail-uat-smoke`, approved (FAILURE); then one normal build (SUCCESS, UAT fully validated again).
12. **Enable auto-merge availability** —
    `gh api -X PATCH repos/R -F allow_auto_merge=true -F allow_update_branch=true`.
    - _Changes:_ auto-merge becomes **available**; it stays off on every PR until someone enables it
      on that PR. "Update branch" lets out-of-date PRs catch up with `main`.
    - _Revert:_ the same call with `=false`.
13. **Auto-merge trials** — a documentation-only PR with auto-merge enabled (must merge only after
    the checks pass); a gate-defining PR with auto-merge enabled (the guard must turn it off and
    comment). If the workflow token cannot disable auto-merge, keep `allow_auto_merge` off.
14. **Delete the two old builds** with unredacted synthetic data (`main` #1, `PR-1` #1; inventory
    above), only after new builds are green and their archives were checked clean. Irreversible.

Optional hardening (separate decision): Jenkins Matrix-based security (or disabling the unused
`admin` and `noreply` accounts) so that only `viamerico` can answer the approval at all. Today every
logged-in account is an administrator, and the pipeline's own allow-list check is what refuses
anyone else (verified on the isolated Jenkins).

## Failure, rollback and recovery

- **PR check fails:** the merge stays blocked. Read the console and JUnit, fix, push (the new build
  supersedes the old one). No retries: a flaky failure is a defect to investigate, not to re-run
  blindly.
- **`main` QA Regression fails:** FAILURE, no approval, UAT untouched, but `main` holds a commit QA
  rejected. Revert the merge through a PR (`git revert -m 1 <merge sha>`) or fix forward through a
  PR; the next `main` build re-validates.
- **UAT readiness or UAT Smoke fails after promotion:** FAILURE, no deployment record, and UAT runs
  the new image. Roll UAT back to the last image whose UAT Smoke passed (authorized operation):
  `docker image inspect parabank-uat:current --format '{{.Id}}'`, then
  `npm run -s env -- deploy uat <that ID>`, `npm run uat:health` and
  `TARGET_ENV=uat npm run test:smoke`. Then fix forward through a PR.
- **Approval rejected, timed out or superseded:** ABORTED (superseded: NOT_BUILT), UAT untouched.
  A superseded build leaves its build tag (next item).
- **Leftover build tags:** `docker image ls parabank-ci`; for a tag whose build has finished,
  `docker image rm parabank-ci:<tag>` (never for a running build; an image QA or UAT runs stays).
- **Host lock left behind** (Jenkins or agent crash): waiting builds name the owner; the lock is
  removed automatically after 150 minutes, or, once no build is running,
  `npm run -s ci:lock -- release <owner>`.
- **QA or UAT down** (e.g. after a reboot; Docker Desktop is started manually): `npm run qa:start` /
  `npm run uat:start` (same image ID, no rebuild), then `npm run qa:health` / `npm run uat:health`.
- **The ruleset blocks every PR** (a required signal never arrives): compare the PR's check runs and
  statuses (name and app) with the ruleset; correct it (`gh api -X PUT repos/R/rulesets/<id>`) or set
  its enforcement to "disabled" temporarily (authorized).

## Validation status

Three kinds of evidence, never to be confused:

**1. Real Jenkins builds (your Jenkins, earlier pipeline designs):** `main` #1 SUCCESS (image
`sha256:c0cfd5a7…` built once, QA Smoke 4/4, same image ID promoted to UAT, UAT Smoke 4/4, UAT
Regression 24/24) and `PR-1` #1 SUCCESS (QA Smoke 4/4, QA Regression 24/24, no UAT), 2026-10-07.
**The current design has not run on the real Jenkins yet.**

**2. Isolated throwaway Jenkins** (same image `jenkins-jenkins` 2.541.2 and a copy of the same
plugin set, security off, `--network none`, deleted afterwards; 2026-10-10). Not your Jenkins and
not the real pipeline, but real Jenkins semantics:

| Check                                                                                       | Result                                                                                  |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Official Declarative linter (`declarative-linter`) on this `Jenkinsfile`                    | "Jenkinsfile successfully validated"; a broken control file is rejected                 |
| `Validation Complete` flag lookup (`env."${flag}"`) in the Groovy sandbox, one flag missing | FAILURE "VALIDATION INCOMPLETE (CI): QA_IMPACTED_PASSED not set" (set flags were read)  |
| `post { unstable }` conversion                                                              | UNSTABLE build finished FAILURE                                                         |
| Head-check supersession (`currentBuild.result = 'ABORTED'` + `error`)                       | ABORTED                                                                                 |
| Milestone cancellation (approval milestone, build N+1 passes a higher ordinal)              | older build NOT_BUILT, **no `post` section ran** (with or without a `notBuilt` handler) |
| Approval answered by an identity not in the allow-list (Jenkins let it answer)              | FAILURE "'anonymous' is not an authorized UAT approver … Nothing is deployed to UAT."   |
| Approval answered by an allow-listed identity                                               | SUCCESS; `input` returns the approver ID as a String                                    |
| Approval rejected                                                                           | ABORTED ("Rejected")                                                                    |
| Approval timeout                                                                            | ABORTED ("Timeout has been exceeded")                                                   |

The milestone finding corrected the design: the `notBuilt` handler added earlier never runs and
was removed; superseded `main` builds leave their build tag (see Recovery).

**3. Local checks (this repository):** lint, format, typecheck, strict Cucumber dry run (52), test
data audit, suite inventories 4/10/24/52, BDD structure (77 scenarios, 25 known defects; 4
deliberate violations each detected), config check (positive, and negative: unpinned commit,
unknown key, retries ≠ 0), impact map on 30 change sets (configurator files, CI/CD tooling,
gate-defining files, a rename) and `--no-renames` on a real rename, `ci:impacted run` against the
local QA environment (Regression 24/24, one feature 4/4, known-defect-only selection, missing
base fails closed), Groovy parse, the stage-path simulation with fault injection (every required
PR or push stage forced to skip → FAILURE), the result → GitHub mapping read from the installed
checks-api and github-branch-source plugins, the host-lock primitive under 60 concurrent creates,
`actionlint` on both workflows and the gate guard's matcher on sample file lists.

## Readiness: database initialized

ParaBank creates its database lazily, on home-page requests. The container healthcheck's bare
HTTP/1.0 probe triggers that initialization but never completes it, so a freshly deployed
container reports "healthy" while registration still fails with HTTP 500 ("object not found:
SEQUENCE"). `scripts/environment.ts` therefore makes one complete home-page request and then
requires the application's own "Database initialized" log line since the container started (a
database kept across a restart logs neither message and is ready at once). `deploy` returns only
then, and the QA Ready / UAT Ready stages use the same check. The log is only searched for that
line, never printed or stored.
