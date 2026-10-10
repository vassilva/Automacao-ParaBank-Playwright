// Jenkins CI/CD for the ParaBank BDD project (Playwright + TypeScript + Cucumber).
// One Jenkinsfile, one Multibranch Pipeline. The definitive flow (docs/ci-cd.md):
//
//   local development -> push to a feature branch -> Pull Request -> Quality Gates -> QA Smoke (4)
//   -> MANUAL merge by the repository owner in GitHub (no auto-merge) -> main: QA Regression (24)
//   -> automatic UAT promotion of the validated image -> UAT Smoke (4) -> SUCCESS
//
//   PUSH (branch, by prefix; a branch with an open PR is built as the PR only):
//     feature/* and others  DEVELOPER     Quality Gates -> app image -> QA Smoke (4)
//     qa/*                  QA            Quality Gates -> app image -> QA Impacted Tests (vs main)
//     config/*              CONFIGURATOR  Quality Gates -> Config Check (no image, no deployment)
//   PULL REQUEST (CI)  Quality Gates -> Config Check -> app image -> QA Ready -> QA Smoke (4) -> QA
//                      Impacted Tests (feature level; a Regression-level selection is deferred to
//                      main) -> QA Gate -> Validation Complete. Never Regression, never UAT. Its
//                      result is the required "Jenkins" check and pr-head status.
//   MAIN (CD)          Quality Gates -> app image -> QA Ready -> QA Regression (24, once)
//                      -> UAT Promotion (main's head, image ID, revision, inputs digest)
//                      -> Deploy UAT (only if UAT does not already run that image ID) -> UAT Ready
//                      -> UAT Smoke (4) [-> Known Defects, optional] -> Deployment Record
//                      -> Validation Complete. No manual approval, no UAT Regression.
//
// STRICT SERIALIZATION: every build of this job (PR, main, branch push) runs all its work inside
// ONE agent block whose first step after the workspace guard is the global pipeline lock
// (scripts/ci/pipeline-lock.sh), released in that block's post section on every outcome. So only
// one pipeline executes at a time, a PR can never change QA while main runs Regression, and a lock
// holder never needs a second executor (no deadlock with builds waiting for the lock). Waiting is
// bounded (PARABANK_LOCK_WAIT_MINUTES, 180); a waiting build occupies one executor (no lock plugin
// is installed); others stay in the Jenkins queue.
//
// SUPERSEDING: after taking the lock, a build whose commit is no longer the head of its PR or
// branch (main included) ends ABORTED ("cancelled"/"error" on GitHub, never "skipped"); before UAT
// the main head is checked again, fail-closed. No milestones (a milestone-cancelled build ends
// NOT_BUILT, published as a "skipped" check that GitHub counts as passing). On PR and branch
// builds UNSTABLE becomes FAILURE (pipeline post).
//
// APPLICATION IMAGE: a function of the application build inputs only (scripts/ci/app-image.ts):
// reused when QA already runs it, deployed when it exists, built once otherwise. The image ID
// validated by QA Regression is the only one UAT can receive (verified again before promotion).
//
// QA (port 8090) and UAT (port 8091) are the persistent "parabank-qa" and "parabank-uat" Compose
// environments on the Jenkins Docker host (src/support/environments.ts): separate containers and
// databases. A deployment recreates the environment's container (fresh database) from the image.
//
// Cucumber runs with ONE worker and no retries everywhere: ParaBank registration is not
// concurrency-safe (docs/qa-coverage.md).
//
// Jenkins-level settings (Manage Jenkins -> System -> Global properties -> Environment variables):
//   PARABANK_MAIN_BRANCH        branch whose builds are the CD pipeline (default: main)
//   PARABANK_LOCK_WAIT_MINUTES  maximum wait for the pipeline lock (default 180)

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

// Current head of this build's PR or branch (40 hex), or '' if it cannot be read. The remote URL is
// never traced (set +x).
def remoteHead() {
  def ref = env.CHANGE_ID ? "refs/pull/${env.CHANGE_ID}/head" : "refs/heads/${env.BRANCH_NAME}"
  def head = ''
  withEnv(["SUPERSEDE_REF=${ref}"]) {
    head = sh(returnStdout: true, script: '''
      set +x
      url=$(git -c safe.directory='*' config --get remote.origin.url)
      git ls-remote "$url" "$SUPERSEDE_REF" 2>/dev/null | cut -f1 || true
    ''').trim()
  }
  return (head ==~ /[0-9a-f]{40}/) ? head : ''
}

// A build whose commit is no longer the head of its PR or branch is pointless: it ends ABORTED
// (GitHub check "cancelled"/"failure", commit status "error": never passing). If the head cannot be
// read the build continues: finishing it is safe (UAT promotion re-checks fail-closed).
def abortIfSuperseded() {
  if (!env.GIT_COMMIT) {
    return
  }
  def head = remoteHead()
  if (!head) {
    echo 'Could not read the remote head; continuing (superseding here is only an optimization).'
    return
  }
  if (head != env.GIT_COMMIT) {
    currentBuild.result = 'ABORTED'
    error("SUPERSEDED: the head is now ${head}; this build validates ${env.GIT_COMMIT}. The newer commit has its own build.")
  }
}

pipeline {
  agent none

  options {
    buildDiscarder(logRotator(numToKeepStr: '20'))
    timestamps()
    // No disableConcurrentBuilds(): serialization across ALL branches and PRs of this job is the
    // global pipeline lock (see the header); superseding is done by head checks.
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
      description: 'MAIN only, proves a deployment gate without changing any test or environment: fail-qa-regression runs QA Regression, fail-uat-smoke runs UAT Smoke, against an unreachable port of that container, so the suite fails for real (transport errors). Expected: build FAILURE; with fail-qa-regression nothing is deployed to UAT.'
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
            'CI'          : 'QA: Smoke (+ feature-level impacted tests); no Regression, no UAT -> required checks; manual merge',
            'CD'          : 'QA: Regression (24, once) -> automatic UAT promotion of the validated image -> UAT: Smoke (4)',
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

    // THE WHOLE PIPELINE, SERIALIZED: one agent block (one executor, never re-allocated) that takes
    // the global pipeline lock first and releases it in its post section.
    stage('Serialized Pipeline') {
      agent {
        dockerfile {
          dir 'docker/ci-agent'
          filename 'Dockerfile'
          // Host Docker daemon (build ParaBank, run QA/UAT); --ipc=host for Chromium.
          args '--ipc=host -v /var/run/docker.sock:/var/run/docker.sock'
        }
      }
      // Bounded: lock wait (180 min) plus the work. The lock's stale limit (330 min) is longer.
      options { timeout(time: 300, unit: 'MINUTES') }

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
          }
        }

        // One pipeline at a time across every PR, branch and main build of this job.
        stage('Acquire Pipeline Lock') {
          steps {
            sh 'sh scripts/ci/pipeline-lock.sh acquire "$BUILD_TAG"'
            script {
              env.PIPELINE_LOCK_HELD = 'true'
              // The wait can be long: do not validate a commit that is no longer the head.
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
        // Touches no environment.
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


        // CD (main): the gate before UAT. Runs once per promotion attempt, on QA, against the image
        // QA Ready just verified. Nothing reaches UAT unless all 24 scenarios pass.
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
                banner('GATE DRILL', ['QA REGRESSION TARGET': drillUrl, 'EXPECTED': 'Regression fails; nothing deployed to UAT; build FAILURE'])
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

        // AUTOMATIC UAT PROMOTION (no human approval), fail-closed: main's head must still be this
        // commit (otherwise a newer main build promotes), and the image must be the one QA Regression
        // validated (same ID, present, pinned revision, same application inputs). Then the policy:
        // deploy only if UAT does not already run that exact image ID (a test-only or documentation
        // merge keeps the same image: UAT is not redeployed, only verified by UAT Smoke).
        stage('UAT Promotion') {
          when {
            expression { env.BUILD_MODE == 'MAIN' && env.QA_REGRESSION_PASSED == 'true' }
          }
          steps {
            script {
              def head = remoteHead()
              if (!head) {
                error("Could not read the head of ${env.BRANCH_NAME}; nothing is deployed to UAT.")
              }
              if (head != env.GIT_COMMIT) {
                currentBuild.result = 'ABORTED'
                error("SUPERSEDED: ${env.BRANCH_NAME} is now at ${head}, this build validated ${env.GIT_COMMIT}. Only the latest validated image may reach UAT; nothing is deployed.")
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
                echo "Validated image $IMAGE_ID (revision $revision), QA Regression ${REGRESSION_EXPECTED}/${REGRESSION_EXPECTED}"
              '''
              def uatImage = sh(returnStdout: true, script: 'docker container inspect --format "{{.Image}}" parabank-uat-parabank-1 2>/dev/null || true').trim()
              def uatHealth = sh(returnStdout: true, script: 'docker container inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{end}}" parabank-uat-parabank-1 2>/dev/null || true').trim()
              env.UAT_DEPLOY_REQUIRED = (uatImage == env.IMAGE_ID && uatHealth == 'healthy') ? 'false' : 'true'
              banner('UAT PROMOTION', [
                'VALIDATED IMAGE ID': env.IMAGE_ID,
                'UAT RUNS'          : uatImage ?: '(nothing)',
                'UAT HEALTH'        : uatHealth ?: '-',
                'DEPLOYMENT'        : env.UAT_DEPLOY_REQUIRED == 'true' ? 'required: promoting the validated image' : 'not required: UAT already runs the validated image',
              ])
              env.UAT_PROMOTION_VERIFIED = 'true'
            }
          }
        }

        // PROMOTE: the very same image ID QA Regression validated, never a rebuild.
        stage('Deploy UAT') {
          when {
            expression { env.UAT_PROMOTION_VERIFIED == 'true' && env.UAT_DEPLOY_REQUIRED == 'true' }
          }
          steps {
            sh 'npm run -s env -- deploy uat "$IMAGE_ID"'
          }
        }

        stage('UAT Ready') {
          when {
            expression { env.UAT_PROMOTION_VERIFIED == 'true' }
          }
          steps {
            script {
              sh 'npm run -s env -- health uat --wait'
              // Identity gate: UAT runs exactly the image QA Regression validated.
              sh 'npm run -s env -- identity uat --expect "$IMAGE_ID"'
              env.UAT_IMAGE_ID = sh(returnStdout: true, script: 'docker container inspect --format "{{.Image}}" parabank-uat-parabank-1').trim()
              if (env.UAT_IMAGE_ID != env.IMAGE_ID) {
                error("IMAGE IDENTITY MISMATCH: UAT runs ${env.UAT_IMAGE_ID}, validated ${env.IMAGE_ID}")
              }
              banner('IMAGE IDENTITY', [
                'SOURCE COMMIT'  : env.SOURCE_COMMIT,
                'QA VALIDATED ID': env.QA_IMAGE_ID,
                'UAT IMAGE ID'   : env.UAT_IMAGE_ID,
                'UAT DEPLOYED'   : env.UAT_DEPLOY_REQUIRED == 'true' ? 'yes (this build)' : 'no (already running)',
              ])
              env.UAT_READY = 'true'
            }
          }
        }

        // Post-deployment verification of UAT: Smoke only (Regression already validated this exact
        // image on QA). A failure fails the pipeline.
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
                'UAT PROMOTION (persistent Compose environment parabank-uat)',
                '========================================',
                "Application:     ParaBank (source-built)",
                "Source:          ${env.SOURCE_REPO} @ ${env.SOURCE_COMMIT}",
                "Inputs digest:   ${env.APP_INPUTS_DIGEST}",
                "Image decision:  ${env.APP_IMAGE_ACTION} (REUSE/DEPLOY/BUILD on QA)",
                "QA image ID:     ${env.QA_IMAGE_ID}",
                "UAT image ID:    ${env.UAT_IMAGE_ID}",
                "Identity:        MATCH (verified from Docker metadata)",
                "QA validation:   regression ${env.REGRESSION_EXPECTED}/${env.REGRESSION_EXPECTED} (gate before UAT)",
                "UAT deployment:  ${env.UAT_DEPLOY_REQUIRED == 'true' ? 'performed by this build (automatic)' : 'not required (UAT already ran this image)'}",
                "UAT validation:  smoke ${env.SMOKE_EXPECTED}/${env.SMOKE_EXPECTED}",
                "Main commit:     ${env.GIT_COMMIT}",
                "Jenkins build:   ${env.JOB_NAME} #${env.BUILD_NUMBER}",
                '========================================',
              ].join('\n') + '\n'
              writeFile file: 'deployment/deployment-record.txt', text: record, encoding: 'UTF-8'
              echo record
              currentBuild.description = "MAIN: UAT ${env.UAT_DEPLOY_REQUIRED == 'true' ? 'promoted' : 'verified'} ${env.IMAGE_ID.substring(0, 19)}"
            }
          }
        }
      }

      post {
        always {
          junit testResults: 'reports/qa/**/cucumber-junit.xml, reports/uat/**/cucumber-junit.xml, reports/uat/**/junit.xml', allowEmptyResults: true
          script {
            if (env.PIPELINE_LOCK_HELD == 'true' && fileExists('node_modules')) {
              // QA and UAT stay running (persistent environments). Their logs are saved redacted and
              // the agent is detached from their networks.
              if (env.DEPLOYS_QA == 'true') {
                sh 'npm run -s env -- teardown qa --keep-running || true'
              }
              if (env.UAT_PROMOTION_VERIFIED == 'true') {
                sh 'npm run -s env -- teardown uat --keep-running || true'
              }
            }
            // Human-readable pointers; identity is always the image ID.
            if (env.QA_IMAGE_ID) {
              sh 'docker tag "$QA_IMAGE_ID" parabank-qa:current || true'
            }
            if (env.UAT_SMOKE_PASSED == 'true') {
              sh 'docker tag "$UAT_IMAGE_ID" parabank-uat:current || true'
            }
            sh '''
              if docker image inspect "$IMAGE_TAG" >/dev/null 2>&1; then
                docker image rm "$IMAGE_TAG" || true
              fi
            '''
            // Always last, on every outcome; plain sh (works even if npm ci failed). Owner-scoped:
            // releases only this build's lock.
            sh 'sh scripts/ci/pipeline-lock.sh release "$BUILD_TAG"'
          }
          // Traces are never produced in CI; reports and logs are redacted (docs/ci-cd.md).
          archiveArtifacts artifacts: 'reports/**, build/**, deployment/**', allowEmptyArchive: true
        }
      }
    }

    // Every build may end SUCCESS only if every validation of its plan ran and passed. Each flag is
    // set only as the last statement of its stage, so a skipped or failed stage leaves it unset.
    // For a PR this is what the required "Jenkins" check reports; for main it guarantees that UAT
    // was promoted (or verified) and smoke-tested after a passing Regression.
    stage('Validation Complete') {
      steps {
        script {
          def required = [
            'DEVELOPER'   : ['QA_SMOKE_PASSED', 'QA_GATE_PASSED'],
            'QA'          : ['QA_IMPACTED_PASSED', 'QA_GATE_PASSED'],
            'CONFIGURATOR': ['CONFIG_CHECK_PASSED'],
            'CI'          : ['CONFIG_CHECK_PASSED', 'QA_SMOKE_PASSED', 'QA_IMPACTED_PASSED', 'QA_GATE_PASSED'],
            'CD'          : ['QA_REGRESSION_PASSED', 'UAT_PROMOTION_VERIFIED', 'UAT_READY', 'UAT_SMOKE_PASSED'],
          ][env.PIPELINE_ROLE]
          if (required == null || (env.BUILD_MODE == 'PULL REQUEST' && env.PIPELINE_ROLE != 'CI') || (env.BUILD_MODE == 'MAIN' && env.PIPELINE_ROLE != 'CD')) {
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
  }

  post {
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
  }
}
