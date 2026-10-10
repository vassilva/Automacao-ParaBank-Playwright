// Jenkins CI/CD for the ParaBank BDD project (Playwright + TypeScript + Cucumber).
// One Jenkinsfile, one Multibranch Pipeline. The target flow is:
//
//   Push -> role validation -> Pull Request -> Quality Gates + QA Smoke + Impacted Tests (the
//   required "Jenkins" check) -> GitHub auto-merge (enabled per PR) -> main: QA deploy -> QA
//   Regression (24) -> manual Jenkins approval -> UAT deployment (same image) -> UAT Smoke (4)
//
//   PUSH (branch, by prefix; a branch with an open PR is built as the PR only):
//     feature/* and others  DEVELOPER     Quality Gates -> Build Image -> Deploy QA -> QA Smoke (4)
//     qa/*                  QA            Quality Gates -> Build Image -> Deploy QA -> QA Impacted
//                                         Tests (vs main)
//     config/*              CONFIGURATOR  Quality Gates -> Config Check. No image, no deployment,
//                                         no host lock.
//   PULL REQUEST (CI)  Quality Gates -> Config Check -> Build Image -> Deploy QA -> QA Ready -> QA
//                      Smoke (4) -> QA Impacted Tests (scripts/ci/impacted-tests.ts: the PR's
//                      changed files vs the target branch; shared code, environments and CI/CD
//                      tooling -> Regression (24)) -> QA Gate -> Validation Complete. No UAT. This
//                      build's result is the "Jenkins" check (and the pr-head commit status) GitHub
//                      requires before (auto-)merging.
//   MAIN (CD)          Build and QA:   Quality Gates -> Build Image -> Deploy QA -> QA Ready
//                                      -> QA Regression (24). No QA Smoke.
//                      UAT Approval:   mandatory input by an authorized approver (no agent, no
//                                      lock held while waiting); reject or timeout -> ABORTED,
//                                      nothing deployed to UAT.
//                      UAT Deployment: Verify Approved Image (still main's head) -> Promote to UAT
//                                      (same image ID) -> UAT Ready -> UAT Smoke (4)
//                                      [-> Known Defects, optional] -> Deployment Record.
//
// SUPERSEDING (no disableConcurrentBuilds): a PR or branch build checks that its commit is still
// the PR/branch head when it starts and again once it holds the host lock, and ends ABORTED
// otherwise. It never uses a milestone: a build cancelled by a milestone ends NOT_BUILT, which the
// checks plugin publishes as a "skipped" Jenkins check, and GitHub counts a skipped (or neutral)
// required check as passing. For the same reason, on PR and branch builds, UNSTABLE becomes
// FAILURE (see the pipeline post section).
// On main (milestones), builds run to QA Regression in order (host lock); a build
// that reaches the approval aborts any older build still waiting for approval, an older build can
// no longer request or pass approval once a newer one did, and a build already approved and
// deploying to UAT is never interrupted. Verify Approved Image also aborts (SUPERSEDED) unless the
// build's commit is still main's head, so only the latest validated image can reach UAT.
// A main build cancelled by the milestone ends NOT_BUILT WITHOUT running any post section
// (verified): its "Jenkins" check on that main commit shows "skipped" (main's checks gate nothing)
// and its build image tag (parabank-ci:main-<n>-*) is left behind; it can never be promoted (a
// promotion uses the build's own image ID after its own approval). Cleanup: docs/ci-cd.md.
//
// BUILD ONCE, PROMOTE THE SAME IMAGE: ParaBank is built once per pipeline from the pinned official
// source commit (docker/parabank/source.env), with its own 239 tests. QA and UAT run that image by
// image ID (never by a mutable tag); the identity gate fails the promotion unless the image ID UAT
// runs equals the image ID QA Regression validated, which equals the image ID that was built.
//
// QA (port 8090) and UAT (port 8091) are the persistent "parabank-qa" and "parabank-uat" Compose
// environments on the Jenkins Docker host (src/support/environments.ts): separate containers and
// databases. A deployment recreates the environment's container (fresh database) from the image.
//
// GATES: stages run in sequence; a failed suite or count check fails its stage and the build, and
// every later stage is skipped. In addition, each later step requires the previous gate's own
// success flag: approval requires QA_REGRESSION_PASSED, the UAT deployment requires UAT_APPROVED
// (set only after the approver was checked), and the deployment record requires UAT_SMOKE_PASSED.
//
// Cucumber runs with ONE worker and no retries everywhere: ParaBank registration is not
// concurrency-safe (docs/qa-coverage.md). HOST LOCK: QA and UAT are shared by every job, so each
// agent stage that builds, deploys or tests holds a host-wide lock (scripts/ci/host-lock.ts),
// released in its post section; it is never held while waiting for approval.
//
// Jenkins-level settings (Manage Jenkins -> System -> Global properties -> Environment variables):
//   PARABANK_UAT_APPROVERS         REQUIRED for MAIN: comma-separated Jenkins user IDs allowed to
//                                  approve UAT deployments. Unset or empty: no UAT deployment.
//   PARABANK_UAT_APPROVAL_MINUTES  approval timeout (default 60); expiry -> ABORTED, no deployment
//   PARABANK_MAIN_BRANCH           branch whose builds are the CD pipeline (default: main)

def banner(String title, Map fields) {
  def lines = ['========================================', title, '========================================']
  fields.each { key, value -> lines << "${key}: ${value ?: '-'}" }
  lines << '========================================'
  echo lines.join('\n')
}

// Runs one suite against one environment and validates it against its approved count.
// Reports go to reports/<environment>/<suite>, so QA/UAT and Smoke/Regression never overwrite
// each other.
def runSuite(String environment, String suite, String expected, String baseUrl = '') {
  def dir = "reports/${environment}/${suite}"
  def url = baseUrl ?: "http://parabank-${environment}-parabank-1:8080/parabank/"
  withEnv([
    "TARGET_ENV=${environment}",
    "PARABANK_BASE_URL=${url}",
    "REPORTS_DIR=${dir}",
  ]) {
    sh "npm run test:${suite}"
    sh "npm run -s ci:coverage -- --suite ${suite} --expect ${expected} ${dir}"
  }
}

// Removes this build's image tag where no agent workspace exists any more (approval rejected,
// timed out or aborted). The controller has the Docker CLI and the host socket. The image itself
// is kept while QA still runs it; only the build's tag goes away.
def removeBuildImageTag() {
  if (!env.IMAGE_TAG) {
    return
  }
  timeout(time: 5, unit: 'MINUTES') {
    node('built-in') {
      sh '''
        if docker image inspect "$IMAGE_TAG" >/dev/null 2>&1; then
          docker image rm "$IMAGE_TAG"
        fi
      '''
    }
  }
}

// PR and branch builds: a build whose commit is no longer the head of its PR or branch is
// pointless; it ends ABORTED (GitHub check "cancelled", commit status "error": never passing).
// Not a milestone: see SUPERSEDING in the header. If the head cannot be read the build simply
// continues: finishing a build is always safe, only wasteful.
def abortIfSuperseded() {
  if (env.BUILD_MODE == 'MAIN' || !env.GIT_COMMIT) {
    return
  }
  def ref = env.CHANGE_ID ? "refs/pull/${env.CHANGE_ID}/head" : "refs/heads/${env.BRANCH_NAME}"
  def head = ''
  withEnv(["SUPERSEDE_REF=${ref}"]) {
    // The remote URL is never traced (set +x).
    head = sh(returnStdout: true, script: '''
      set +x
      url=$(git -c safe.directory='*' config --get remote.origin.url)
      git ls-remote "$url" "$SUPERSEDE_REF" 2>/dev/null | cut -f1 || true
    ''').trim()
  }
  if (!(head ==~ /[0-9a-f]{40}/)) {
    echo "Could not read ${ref}; continuing (superseding is only an optimization)."
    return
  }
  if (head != env.GIT_COMMIT) {
    currentBuild.result = 'ABORTED'
    error("SUPERSEDED: ${ref} is now at ${head}; this build validates ${env.GIT_COMMIT}. The newer commit has its own build.")
  }
}

pipeline {
  agent none

  options {
    buildDiscarder(logRotator(numToKeepStr: '20'))
    timestamps()
    // No disableConcurrentBuilds(): superseding is done by head checks (PR, branch) and milestones
    // (main approval), see the header; the host lock serializes every build that builds, deploys
    // or tests.
  }

  parameters {
    booleanParam(
      name: 'RUN_KNOWN_DEFECTS',
      defaultValue: false,
      description: 'MAIN only: after UAT Smoke passed, run the 25 known-defect scenarios on UAT (never fails the deployment; a defect that no longer reproduces, or a failure that is not the defect, marks the build UNSTABLE).'
    )
    choice(
      name: 'ADDITIONAL_QA_SUITE',
      choices: ['none', 'sanity', 'full'],
      description: 'Run an extra suite on QA after the QA gate passed (manual or release use).'
    )
    choice(
      name: 'GATE_DRILL',
      choices: ['none', 'fail-qa-regression', 'fail-uat-smoke'],
      description: 'MAIN only, proves a deployment gate without changing any test or environment: fail-qa-regression runs QA Regression, fail-uat-smoke runs UAT Smoke, against an unreachable port of that container, so the suite fails for real (transport errors). Expected: build FAILURE; with fail-qa-regression no approval is requested and nothing is deployed to UAT.'
    )
  }

  environment {
    CI = 'true'
    // Mandatory: ParaBank registration has a confirmed concurrency defect.
    CUCUMBER_PARALLEL = '1'
    CUCUMBER_RETRY = '0'
    HEADLESS = 'true'
    // Traces would capture synthetic credentials (ParaBank sends passwords in requests).
    PW_TRACE_ON_FAILURE = 'false'
    NET_DIAG = 'false'
    // Approved suite sizes of Functional Automation Baseline v2 (docs/test-suites.md). A tag
    // change that alters a suite fails the Quality Gates stage until these are reviewed with it.
    SMOKE_EXPECTED = '4'
    REGRESSION_EXPECTED = '24'
    SANITY_EXPECTED = '10'
    FULL_EXPECTED = '52'
    // Whole inventory (Full + known defects) and the known defects, for the BDD structure check.
    TOTAL_SCENARIOS_EXPECTED = '77'
    KNOWN_DEFECTS_EXPECTED = '25'
  }

  stages {
    stage('Build Context') {
      steps {
        script {
          def mainBranch = env.PARABANK_MAIN_BRANCH ?: 'main'
          if (env.CHANGE_ID) {
            env.BUILD_MODE = 'PULL REQUEST'
          } else if (env.BRANCH_NAME == mainBranch) {
            env.BUILD_MODE = 'MAIN'
          } else {
            env.BUILD_MODE = 'PUSH'
          }
          // Role-specific validation of a push, by branch prefix. PRs and main have their own plan.
          if (env.BUILD_MODE == 'PUSH') {
            def branch = env.BRANCH_NAME ?: ''
            env.PIPELINE_ROLE = branch.startsWith('qa/') ? 'QA' : (branch.startsWith('config/') ? 'CONFIGURATOR' : 'DEVELOPER')
          } else {
            env.PIPELINE_ROLE = env.BUILD_MODE == 'MAIN' ? 'CD' : 'CI'
          }
          env.DEPLOYS_QA = env.PIPELINE_ROLE == 'CONFIGURATOR' ? 'false' : 'true'
          env.RUNS_SMOKE = (env.BUILD_MODE == 'PULL REQUEST' || env.PIPELINE_ROLE == 'DEVELOPER') ? 'true' : 'false'
          env.RUNS_IMPACTED = (env.BUILD_MODE == 'PULL REQUEST' || env.PIPELINE_ROLE == 'QA') ? 'true' : 'false'
          // <branch, 12 chars max>-<build number>-<hash of the full BUILD_TAG>: unique across jobs.
          def branchPart = (env.BRANCH_NAME ?: 'build').toLowerCase().replaceAll('[^a-z0-9]+', '-').replaceAll('^-+', '')
          if (branchPart.length() > 12) {
            branchPart = branchPart.substring(0, 12)
          }
          branchPart = branchPart.replaceAll('-+$', '') ?: 'build'
          def tagHash = ((env.BUILD_TAG ?: "local-${env.BUILD_NUMBER}").hashCode() & 0x7fffffff) % 100000
          env.IMAGE_TAG = "parabank-ci:${branchPart}-${env.BUILD_NUMBER}-${tagHash}"
          def plan = [
            'DEVELOPER'   : 'QA: Smoke (no Regression, no UAT)',
            'QA'          : 'QA: Impacted Tests vs main (no UAT)',
            'CONFIGURATOR': 'Quality Gates + Config Check (no image, no deployment)',
            'CI'          : 'QA: Smoke + Impacted Tests (no UAT) -> required check for (auto-)merge',
            'CD'          : 'QA: Regression (gate) -> manual approval -> promote same image -> UAT: Smoke',
          ][env.PIPELINE_ROLE]
          banner('PARABANK PIPELINE', [
            'BUILD MODE'      : env.BUILD_MODE,
            'ROLE'            : env.PIPELINE_ROLE,
            'TEST PLAN'       : plan,
            'BRANCH'          : env.BRANCH_NAME,
            'PULL REQUEST'    : env.CHANGE_ID ? "#${env.CHANGE_ID} (${env.CHANGE_BRANCH} -> ${env.CHANGE_TARGET})" : 'no',
            'MAIN BRANCH'     : mainBranch,
            'IMAGE TAG'       : env.IMAGE_TAG,
            'SUITE SIZES'     : "smoke ${env.SMOKE_EXPECTED}, regression ${env.REGRESSION_EXPECTED}",
            'CUCUMBER WORKERS': env.CUCUMBER_PARALLEL,
          ])
          currentBuild.description = env.BUILD_MODE == 'PUSH' ? "PUSH (" + env.PIPELINE_ROLE + ")" : env.BUILD_MODE
        }
      }
    }

    stage('Build and QA') {
      agent {
        dockerfile {
          dir 'docker/ci-agent'
          filename 'Dockerfile'
          // Host Docker daemon (build ParaBank, run QA/UAT); --ipc=host for Chromium.
          args '--ipc=host -v /var/run/docker.sock:/var/run/docker.sock'
        }
      }
      // Includes a bounded wait (60 min) for the host lock.
      options { timeout(time: 150, unit: 'MINUTES') }

      stages {
        stage('Workspace Guard') {
          steps {
            sh '''
              set -eu
              # Workspaces are reused: never publish a previous build's results or images.
              rm -rf reports build deployment
              if [ -e .env ]; then
                echo "A .env file exists in the workspace; CI never loads local configuration." >&2
                exit 1
              fi
              test "$CUCUMBER_PARALLEL" = "1"
              test "$CUCUMBER_RETRY" = "0"
            '''
            script {
              abortIfSuperseded()
            }
          }
        }

        stage('Install') {
          steps {
            sh 'npm ci'
          }
        }

        // Static checks and the approved suite sizes, before anything is built or deployed.
        stage('Quality Gates') {
          steps {
            sh '''
              set -eu
              npm run lint
              npm run format:check
              npm run typecheck
              npm run test:dry-run
              npm run -s audit:test-data
              npm run -s test:ci
              npm run -s ci:bdd -- --total "$TOTAL_SCENARIOS_EXPECTED" --known-defects "$KNOWN_DEFECTS_EXPECTED"
              npm run -s ci:coverage -- --suite smoke --expect "$SMOKE_EXPECTED"
              npm run -s ci:coverage -- --suite regression --expect "$REGRESSION_EXPECTED"
              npm run -s ci:coverage -- --suite sanity --expect "$SANITY_EXPECTED"
              npm run -s ci:coverage -- --suite full --expect "$FULL_EXPECTED"
            '''
          }
        }

        // CONFIGURATOR pushes (config/*) and every pull request: the environment configuration
        // renders for QA and UAT, requires an image ID, and keeps their projects and ports distinct.
        // Needs no lock and touches no environment.
        stage('Config Check') {
          when {
            expression { env.PIPELINE_ROLE == 'CONFIGURATOR' || env.BUILD_MODE == 'PULL REQUEST' }
          }
          steps {
            script {
              sh 'npm run -s ci:config-check'
              env.CONFIG_CHECK_PASSED = 'true'
            }
          }
        }

        stage('Acquire Host Lock') {
          when {
            expression { env.DEPLOYS_QA == 'true' }
          }
          steps {
            sh 'npm run -s ci:lock -- acquire "$BUILD_TAG"'
            // The wait for the lock can be long: do not build, deploy and test a superseded commit.
            script {
              abortIfSuperseded()
            }
          }
        }

        // APPLICATION IMAGE, decided explicitly (scripts/ci/app-image.ts): the image is a function of
        // the application build inputs (docker/parabank/**, the build script), recorded on every
        // image as label parabank.inputs.digest. Test or documentation changes do not change it:
        //   REUSE   QA already runs a healthy image from these inputs -> no build, no deployment
        //   DEPLOY  such an image exists locally but QA runs another one -> deploy it, no build
        //   BUILD   none exists -> build once, then deploy
        // Under the host lock, so QA cannot change between this decision and the validation.
        stage('Resolve Application Image') {
          when {
            expression { env.DEPLOYS_QA == 'true' }
          }
          steps {
            script {
              def out = sh(returnStdout: true, script: 'npm run -s ci:app-image -- resolve').trim()
              def kv = [:]
              out.split('\n').each { line ->
                def i = line.indexOf('=')
                if (i > 0) { kv[line.substring(0, i)] = line.substring(i + 1) }
              }
              env.APP_IMAGE_ACTION = kv.APP_IMAGE_ACTION ?: ''
              env.APP_INPUTS_DIGEST = kv.APP_INPUTS_DIGEST ?: ''
              if (!(env.APP_IMAGE_ACTION == 'REUSE' || env.APP_IMAGE_ACTION == 'DEPLOY' || env.APP_IMAGE_ACTION == 'BUILD') ||!(env.APP_INPUTS_DIGEST ==~ /sha256:[0-9a-f]{64}/)) {
                error("Could not decide the application image: ${out}")
              }
              if (env.APP_IMAGE_ACTION != 'BUILD') {
                env.IMAGE_ID = kv.APP_IMAGE_ID ?: ''
                if (!(env.IMAGE_ID ==~ /sha256:[0-9a-f]{64}/)) {
                  error("Resolver chose ${env.APP_IMAGE_ACTION} without a usable image ID: '${env.IMAGE_ID}'")
                }
                // The build tag keeps a reference to the image for this pipeline (removed in post).
                sh 'docker tag "$IMAGE_ID" "$IMAGE_TAG"'
              }
              banner('APPLICATION IMAGE DECISION', [
                'ACTION'       : env.APP_IMAGE_ACTION,
                'REASON'       : kv.APP_IMAGE_REASON,
                'INPUTS DIGEST': env.APP_INPUTS_DIGEST,
                'IMAGE ID'     : env.IMAGE_ID ?: '(to be built)',
              ])
            }
          }
        }

        // BUILD ONCE, only when no image from these application inputs exists. QA and UAT receive
        // this image ID.
        stage('Build Image') {
          when {
            expression { env.DEPLOYS_QA == 'true' && env.APP_IMAGE_ACTION == 'BUILD' }
          }
          steps {
            script {
              sh 'PARABANK_IMAGE_TAG="$IMAGE_TAG" PARABANK_BUILD_FRESH=true npm run app:build'
              env.IMAGE_ID = sh(returnStdout: true, script: 'docker image inspect --format "{{.Id}}" "$IMAGE_TAG"').trim()
              if (!(env.IMAGE_ID ==~ /sha256:[0-9a-f]{64}/)) {
                error("Build produced no usable image ID: '${env.IMAGE_ID}'")
              }
            }
          }
        }

        // Whatever the action, the image must come from the pinned commit and these inputs.
        stage('Verify Application Image') {
          when {
            expression { env.DEPLOYS_QA == 'true' }
          }
          steps {
            script {
              env.IMAGE_REVISION = sh(returnStdout: true, script: 'docker image inspect --format "{{index .Config.Labels \\"org.opencontainers.image.revision\\"}}" "$IMAGE_ID"').trim()
              def imageDigest = sh(returnStdout: true, script: 'docker image inspect --format "{{index .Config.Labels \\"parabank.inputs.digest\\"}}" "$IMAGE_ID"').trim()
              env.SOURCE_COMMIT = sh(returnStdout: true, script: "sed -n 's/^PARABANK_SOURCE_COMMIT=//p' docker/parabank/source.env").trim()
              env.SOURCE_REPO = sh(returnStdout: true, script: "sed -n 's/^PARABANK_SOURCE_REPO=//p' docker/parabank/source.env").trim()
              if (env.IMAGE_REVISION != env.SOURCE_COMMIT) {
                error("Image revision label ${env.IMAGE_REVISION} does not match the pinned source commit ${env.SOURCE_COMMIT}")
              }
              if (imageDigest != env.APP_INPUTS_DIGEST) {
                error("Image inputs digest ${imageDigest} does not match this commit's application inputs ${env.APP_INPUTS_DIGEST}")
              }
              banner('APPLICATION IMAGE', [
                'ACTION'       : env.APP_IMAGE_ACTION,
                'SOURCE REPO'  : env.SOURCE_REPO,
                'SOURCE COMMIT': env.SOURCE_COMMIT,
                'INPUTS DIGEST': env.APP_INPUTS_DIGEST,
                'IMAGE TAG'    : env.IMAGE_TAG,
                'IMAGE ID'     : env.IMAGE_ID,
              ])
            }
          }
        }

        stage('Deploy QA') {
          when {
            expression { env.DEPLOYS_QA == 'true' && (env.APP_IMAGE_ACTION == 'BUILD' || env.APP_IMAGE_ACTION == 'DEPLOY') }
          }
          steps {
            script {
              sh 'npm run -s env -- deploy qa "$IMAGE_ID"'
            }
          }
        }

        stage('QA Ready') {
          when {
            expression { env.DEPLOYS_QA == 'true' }
          }
          steps {
            script {
              // Deployed or reused, QA must be healthy and run exactly this image.
              sh 'npm run -s env -- health qa --wait'
              sh 'npm run -s env -- identity qa --expect "$IMAGE_ID"'
              env.QA_IMAGE_ID = sh(returnStdout: true, script: 'docker container inspect --format "{{.Image}}" parabank-qa-parabank-1').trim()
              banner('QA READY', ['PROJECT': 'parabank-qa', 'IMAGE ID': env.QA_IMAGE_ID, 'ACTION': env.APP_IMAGE_ACTION])
            }
          }
        }

        // CI (pull requests and DEVELOPER pushes): the candidate image must pass Smoke on QA.
        stage('QA Smoke') {
          when {
            expression { env.RUNS_SMOKE == 'true' }
          }
          steps {
            script {
              runSuite('qa', 'smoke', env.SMOKE_EXPECTED)
              env.QA_SMOKE_PASSED = 'true'
            }
          }
        }

        // Pull requests (after Smoke) and QA pushes: the scenarios the change can affect, chosen
        // from its changed files against the target branch (scripts/ci/impacted-tests.ts; shared
        // code, environments and CI/CD tooling -> the whole Regression suite, documentation ->
        // nothing more; gate-defining changes are reported for manual merge), then
        // checked to have run exactly, once, and passed. With Smoke, this is the PR's "Jenkins"
        // check that GitHub requires before a merge or an auto-merge.
        stage('QA Impacted Tests') {
          when {
            expression { env.RUNS_IMPACTED == 'true' && (env.RUNS_SMOKE != 'true' || env.QA_SMOKE_PASSED == 'true') }
          }
          steps {
            withEnv([
              'TARGET_ENV=qa',
              'PARABANK_BASE_URL=http://parabank-qa-parabank-1:8080/parabank/',
              // Pull requests never run the full Regression: it runs once, after the merge, as
              // the pre-UAT gate. Feature-level selections still run here.
              "IMPACTED_SCOPE=${env.BUILD_MODE == 'PULL REQUEST' ? 'features' : 'all'}",
            ]) {
              sh 'npm run -s ci:impacted -- run'
            }
            script {
              env.QA_IMPACTED_PASSED = 'true'
            }
          }
        }

        // The QA gate of a CI build: every validation its role requires actually ran and passed
        // (a skipped stage must never count as a pass).
        stage('QA Gate') {
          when {
            expression { env.BUILD_MODE != 'MAIN' && env.DEPLOYS_QA == 'true' }
          }
          steps {
            script {
              if (env.RUNS_SMOKE == 'true' && env.QA_SMOKE_PASSED != 'true') {
                error('QA GATE: QA Smoke is required for this build and did not pass.')
              }
              if (env.RUNS_IMPACTED == 'true' && env.QA_IMPACTED_PASSED != 'true') {
                error('QA GATE: QA Impacted Tests are required for this build and did not pass.')
              }
              env.QA_GATE_PASSED = 'true'
              echo "QA GATE PASSED (${env.PIPELINE_ROLE}): smoke ${env.RUNS_SMOKE}, impacted tests ${env.RUNS_IMPACTED}"
            }
          }
        }

        // CD (main): the deployment gate. No approval is even requested unless the newly built
        // image passes the whole Regression suite on QA.
        stage('QA Regression') {
          when {
            expression { env.BUILD_MODE == 'MAIN' }
          }
          steps {
            script {
              def drillUrl = ''
              if (params.GATE_DRILL == 'fail-qa-regression') {
                // Nothing listens on port 1: every scenario fails at transport level, for real.
                drillUrl = 'http://parabank-qa-parabank-1:1/parabank/'
                banner('GATE DRILL', ['QA REGRESSION TARGET': drillUrl, 'EXPECTED': 'Regression fails; no approval, nothing deployed to UAT; build FAILURE'])
              }
              runSuite('qa', 'regression', env.REGRESSION_EXPECTED, drillUrl)
              env.QA_REGRESSION_PASSED = 'true'
              env.QA_GATE_PASSED = 'true'
            }
          }
        }

        stage('QA Additional Suite') {
          when {
            expression { params.ADDITIONAL_QA_SUITE != 'none' && env.QA_GATE_PASSED == 'true' }
          }
          steps {
            script {
              def suite = params.ADDITIONAL_QA_SUITE
              runSuite('qa', suite, suite == 'sanity' ? env.SANITY_EXPECTED : env.FULL_EXPECTED)
            }
          }
        }
      }

      post {
        always {
          junit testResults: 'reports/qa/**/cucumber-junit.xml', allowEmptyResults: true
          script {
            // CONFIGURATOR builds never touch QA (no lock is held for it).
            if (env.DEPLOYS_QA == 'true' && fileExists('node_modules')) {
              // QA stays running (persistent environment). Its log is saved redacted and the agent
              // is detached from its network.
              sh 'npm run -s env -- teardown qa --keep-running || true'
            }
            // Human-readable pointer; identity is always the image ID.
            if (env.QA_IMAGE_ID) {
              sh 'docker tag "$QA_IMAGE_ID" parabank-qa:current'
            }
            // The build's tag survives only while this image may still be approved for UAT.
            def awaitingApproval = env.BUILD_MODE == 'MAIN' && env.QA_REGRESSION_PASSED == 'true'
            if (!awaitingApproval && env.DEPLOYS_QA == 'true') {
              sh '''
                if docker image inspect "$IMAGE_TAG" >/dev/null 2>&1; then
                  docker image rm "$IMAGE_TAG"
                fi
              '''
            }
            if (env.DEPLOYS_QA == 'true' && fileExists('node_modules')) {
              sh 'npm run -s ci:lock -- release "$BUILD_TAG"'
            }
          }
          // Traces are never produced in CI; reports and logs are redacted (docs/ci-cd.md).
          archiveArtifacts artifacts: 'reports/**, build/**', allowEmptyArchive: true
        }
      }
    }

    // PR and branch builds: the build may end SUCCESS (for a PR: a passing "Jenkins" check, which
    // can trigger an auto-merge) only if every validation of its plan ran and passed. Each flag is
    // set only as the last statement of its stage, so a skipped or failed stage leaves it unset.
    stage('Validation Complete') {
      when {
        expression { env.BUILD_MODE != 'MAIN' }
      }
      steps {
        script {
          def required = [
            'DEVELOPER'   : ['QA_SMOKE_PASSED', 'QA_GATE_PASSED'],
            'QA'          : ['QA_IMPACTED_PASSED', 'QA_GATE_PASSED'],
            'CONFIGURATOR': ['CONFIG_CHECK_PASSED'],
            'CI'          : ['CONFIG_CHECK_PASSED', 'QA_SMOKE_PASSED', 'QA_IMPACTED_PASSED', 'QA_GATE_PASSED'],
          ][env.PIPELINE_ROLE]
          if (required == null || (env.BUILD_MODE == 'PULL REQUEST' && env.PIPELINE_ROLE != 'CI')) {
            error("VALIDATION INCOMPLETE: no validation plan for ${env.BUILD_MODE} / ${env.PIPELINE_ROLE}.")
          }
          def missing = []
          for (String flag : required) {
            if (env."${flag}" != 'true') {
              missing << flag
            }
          }
          if (!missing.isEmpty()) {
            error("VALIDATION INCOMPLETE (${env.PIPELINE_ROLE}): ${missing.join(', ')} not set.")
          }
          echo "VALIDATION COMPLETE (${env.BUILD_MODE}, ${env.PIPELINE_ROLE}): ${required.join(', ')}"
        }
      }
    }

    // No agent, no workspace and no host lock while waiting for a human. Only the Jenkins users in
    // PARABANK_UAT_APPROVERS may approve; the approver is checked again after the input (Jenkins
    // administrators can answer any input). Reject, timeout or abort -> ABORTED: no UAT stage runs.
    stage('UAT Approval') {
      agent none
      when {
        beforeAgent true
        expression { env.BUILD_MODE == 'MAIN' && env.QA_REGRESSION_PASSED == 'true' }
      }
      steps {
        script {
          def approvers = (env.PARABANK_UAT_APPROVERS ?: '').split(',').collect { it.trim() }.findAll { it }
          if (approvers.isEmpty()) {
            error('UAT approval is not configured: set the Jenkins global property PARABANK_UAT_APPROVERS to the Jenkins user ID(s) allowed to approve. Nothing is deployed to UAT.')
          }
          def minutes = (env.PARABANK_UAT_APPROVAL_MINUTES ?: '60') as Integer
          // SUPERSEDING (pipeline-milestone-step): passing ordinal N cancels every older running
          // build whose last milestone is lower, and cancels this build if a newer one already
          // passed N or more. Ordinal = build number here: an older build waiting for approval is
          // aborted, and this build is aborted if a newer one already asked for approval.
          milestone(ordinal: Integer.parseInt(env.BUILD_NUMBER), label: 'UAT approval requested')
          banner('UAT APPROVAL REQUIRED', [
            'IMAGE ID'        : env.IMAGE_ID,
            'SOURCE COMMIT'   : env.SOURCE_COMMIT,
            'QA VALIDATION'   : "regression ${env.REGRESSION_EXPECTED}/${env.REGRESSION_EXPECTED} passed",
            'APPROVERS'       : approvers.join(', '),
            'TIMEOUT (MINUTES)': minutes,
          ])
          def answer = null
          timeout(time: minutes, unit: 'MINUTES') {
            answer = input(
              id: 'ApproveUatDeployment',
              message: "QA Regression passed (${env.REGRESSION_EXPECTED}/${env.REGRESSION_EXPECTED}) for image ${env.IMAGE_ID}. Deploy this exact image to UAT and run UAT Smoke?",
              ok: 'Deploy to UAT',
              submitter: approvers.join(','),
              submitterParameter: 'APPROVER'
            )
          }
          // With only submitterParameter the step returns the approver's user ID (a Map on some
          // plugin versions); either way it is checked against the allow-list again.
          def approver = ((answer instanceof Map) ? answer.APPROVER : answer)?.toString()?.trim() ?: ''
          if (!approvers.contains(approver)) {
            error("'${approver}' is not an authorized UAT approver (PARABANK_UAT_APPROVERS). Nothing is deployed to UAT.")
          }
          // Higher than any build number: a build approved and deploying is never cancelled by a
          // newer build reaching the approval, and an older build approved after a newer one was
          // approved is aborted here.
          milestone(ordinal: 1000000000, label: 'UAT approved')
          env.UAT_APPROVER = approver
          env.UAT_APPROVED = 'true'
          echo "UAT deployment approved by ${approver}"
        }
      }
    }

    stage('UAT Deployment') {
      agent {
        dockerfile {
          dir 'docker/ci-agent'
          filename 'Dockerfile'
          args '--ipc=host -v /var/run/docker.sock:/var/run/docker.sock'
        }
      }
      when {
        beforeAgent true
        expression { env.BUILD_MODE == 'MAIN' && env.UAT_APPROVED == 'true' }
      }
      // Includes a bounded wait (60 min) for the host lock.
      options { timeout(time: 120, unit: 'MINUTES') }

      stages {
        stage('UAT Workspace Guard') {
          steps {
            sh '''
              set -eu
              # Only this stage's own results are published from here.
              rm -rf reports/uat deployment
              test "$CUCUMBER_PARALLEL" = "1"
              test "$CUCUMBER_RETRY" = "0"
            '''
          }
        }

        stage('UAT Install') {
          steps {
            sh 'npm ci'
          }
        }

        stage('UAT Host Lock') {
          steps {
            sh 'npm run -s ci:lock -- acquire "$BUILD_TAG"'
          }
        }

        // The image approved is the image QA Regression validated: same ID, still present, built
        // from the pinned commit, and the build's commit is still main's head (otherwise a newer
        // main build supersedes it: ABORTED, nothing deployed).
        stage('Verify Approved Image') {
          steps {
            script {
              // The remote URL is never traced (set +x).
              def head = sh(returnStdout: true, script: '''
                set +x
                url=$(git -c safe.directory='*' config --get remote.origin.url)
                git ls-remote "$url" "refs/heads/$BRANCH_NAME" | cut -f1
              ''').trim()
              if (!(head ==~ /[0-9a-f]{40}/)) {
                error("Could not read the head of ${env.BRANCH_NAME}; nothing is deployed to UAT.")
              }
              if (head != env.GIT_COMMIT) {
                currentBuild.result = 'ABORTED'
                error("SUPERSEDED: ${env.BRANCH_NAME} is now at ${head}, this build validated ${env.GIT_COMMIT}. Only the latest validated image may reach UAT; nothing is deployed.")
              }
            }
            sh '''
              set -eu
              test -n "$IMAGE_ID"
              test "$IMAGE_ID" = "$QA_IMAGE_ID"
              docker image inspect "$IMAGE_ID" >/dev/null
              revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE_ID")
              test "$revision" = "$SOURCE_COMMIT"
              digest=$(docker image inspect --format '{{index .Config.Labels "parabank.inputs.digest"}}' "$IMAGE_ID")
              test "$digest" = "$APP_INPUTS_DIGEST"
              echo "Approved image $IMAGE_ID (revision $revision), validated by QA Regression, approved by $UAT_APPROVER"
            '''
          }
        }

        // PROMOTE: the very same image ID QA Regression validated, never a rebuild.
        stage('Promote to UAT') {
          steps {
            script {
              sh 'npm run -s env -- deploy uat "$IMAGE_ID"'
              env.UAT_IMAGE_ID = sh(returnStdout: true, script: 'docker container inspect --format "{{.Image}}" parabank-uat-parabank-1').trim()
            }
          }
        }

        stage('UAT Ready') {
          steps {
            script {
              sh 'npm run -s env -- health uat --wait'
              // Identity gate: UAT runs exactly the built (and QA-validated, approved) image ID.
              sh 'npm run -s env -- identity uat --expect "$IMAGE_ID"'
              if (env.UAT_IMAGE_ID != env.IMAGE_ID) {
                error("IMAGE IDENTITY MISMATCH: UAT runs ${env.UAT_IMAGE_ID}, approved ${env.IMAGE_ID}")
              }
              banner('IMAGE IDENTITY', [
                'SOURCE COMMIT'    : env.SOURCE_COMMIT,
                'BUILT IMAGE ID'   : env.IMAGE_ID,
                'QA VALIDATED ID'  : env.QA_IMAGE_ID,
                'UAT IMAGE ID'     : env.UAT_IMAGE_ID,
                'APPROVED BY'      : env.UAT_APPROVER,
              ])
              env.UAT_READY = 'true'
            }
          }
        }

        // Post-deployment verification of UAT: Smoke only (Regression already validated this exact
        // image on QA). A failure fails the deployment pipeline.
        stage('UAT Smoke') {
          when {
            expression { env.UAT_READY == 'true' }
          }
          steps {
            script {
              def drillUrl = ''
              if (params.GATE_DRILL == 'fail-uat-smoke') {
                // Nothing listens on port 1: every scenario fails at transport level, for real.
                drillUrl = 'http://parabank-uat-parabank-1:1/parabank/'
                banner('GATE DRILL', ['UAT SMOKE TARGET': drillUrl, 'EXPECTED': 'UAT Smoke fails; build FAILURE; no Deployment Record'])
              }
              runSuite('uat', 'smoke', env.SMOKE_EXPECTED, drillUrl)
              env.UAT_SMOKE_PASSED = 'true'
            }
          }
        }

        // Documented defects, judged by their registered proofs (docs/defects.md). Never part of
        // the deployment gate: a reproduced defect is the expected result; anything else (a defect
        // that no longer reproduces, or a failure that is not the defect) marks the build UNSTABLE.
        stage('Known Defects') {
          when {
            expression { params.RUN_KNOWN_DEFECTS && env.UAT_SMOKE_PASSED == 'true' }
          }
          steps {
            catchError(buildResult: 'UNSTABLE', stageResult: 'UNSTABLE') {
              withEnv([
                'TARGET_ENV=uat',
                'PARABANK_BASE_URL=http://parabank-uat-parabank-1:8080/parabank/',
                'REPORTS_DIR=reports/uat/known-defects',
              ]) {
                sh 'npm run test:known-defects'
              }
            }
          }
        }

        stage('Deployment Record') {
          when {
            expression { env.UAT_SMOKE_PASSED == 'true' }
          }
          steps {
            script {
              def record = [
                '========================================',
                'UAT DEPLOYMENT (persistent Compose environment parabank-uat)',
                '========================================',
                "Application:     ParaBank (source-built)",
                "Source:          ${env.SOURCE_REPO} @ ${env.SOURCE_COMMIT}",
                "Image tag:       ${env.IMAGE_TAG} (build tag; identity is the image ID)",
                "Built image ID:  ${env.IMAGE_ID}",
                "QA image ID:     ${env.QA_IMAGE_ID}",
                "UAT image ID:    ${env.UAT_IMAGE_ID}",
                "Identity:        MATCH (verified from Docker metadata)",
                "QA validation:   regression ${env.REGRESSION_EXPECTED}/${env.REGRESSION_EXPECTED} (deployment gate)",
                "Approved by:     ${env.UAT_APPROVER}",
                "UAT validation:  smoke ${env.SMOKE_EXPECTED}/${env.SMOKE_EXPECTED} (post-deployment)",
                "Jenkins build:   ${env.JOB_NAME} #${env.BUILD_NUMBER}",
                "Build URL:       ${env.BUILD_URL ?: '(Jenkins URL not configured)'}",
                '========================================',
              ].join('\n') + '\n'
              writeFile file: 'deployment/deployment-record.txt', text: record, encoding: 'UTF-8'
              echo record
              currentBuild.description = "MAIN: UAT validated ${env.IMAGE_ID.substring(0, 19)} (approved by ${env.UAT_APPROVER})"
            }
          }
        }
      }

      post {
        always {
          junit testResults: 'reports/uat/**/cucumber-junit.xml, reports/uat/**/junit.xml', allowEmptyResults: true
          script {
            if (fileExists('node_modules')) {
              // UAT stays running (persistent environment). Its log is saved redacted and the agent
              // is detached from its network.
              sh 'npm run -s env -- teardown uat --keep-running || true'
            }
            if (env.UAT_SMOKE_PASSED == 'true') {
              sh 'docker tag "$UAT_IMAGE_ID" parabank-uat:current'
            }
            sh '''
              if docker image inspect "$IMAGE_TAG" >/dev/null 2>&1; then
                docker image rm "$IMAGE_TAG"
              fi
            '''
            if (fileExists('node_modules')) {
              sh 'npm run -s ci:lock -- release "$BUILD_TAG"'
            }
          }
          archiveArtifacts artifacts: 'reports/uat/**, reports/logs/uat.log, deployment/**', allowEmptyArchive: true
        }
      }
    }
  }

  post {
    // Approval rejected, timed out or aborted, or the approver check failed: no agent stage removed
    // the build's image tag, so it is removed here and can never be promoted later by mistake.
    aborted {
      script {
        removeBuildImageTag()
      }
    }
    failure {
      script {
        if (env.QA_REGRESSION_PASSED == 'true' && env.UAT_IMAGE_ID == null) {
          removeBuildImageTag()
        }
      }
    }
    // The checks plugin publishes UNSTABLE as "neutral" (when so configured) and NOT_BUILT as
    // "skipped"; GitHub counts both as a passing required check. A PR or branch build is either
    // validated (SUCCESS) or not: UNSTABLE becomes FAILURE (a worse result, so Jenkins accepts it).
    unstable {
      script {
        if (env.BUILD_MODE != 'MAIN') {
          currentBuild.result = 'FAILURE'
        }
      }
    }
    // No 'notBuilt' handler: a build cancelled by a milestone (the only source of NOT_BUILT here,
    // main builds at the approval) is interrupted without running any post section, as verified on
    // a Jenkins with these plugins; such a handler would never run. See SUPERSEDING in the header.
  }
}
