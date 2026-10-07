// Jenkins CI/CD for the ParaBank BDD project (Playwright + TypeScript + Cucumber).
// One Jenkinsfile, one Multibranch Pipeline. The mandatory sequence is:
//
//   Pull Request -> QA Smoke (4) -> required Jenkins check passes -> manual GitHub merge
//   -> QA Regression (24) -> manual Jenkins approval -> UAT deployment -> UAT Smoke (4)
//
//   PULL REQUEST (CI)  Build and QA:   Quality Gates -> Build Image -> Deploy QA -> QA Ready
//                                      -> QA Smoke (4). No Regression, no UAT. This build's
//                                      result is the "Jenkins" check that GitHub requires.
//   PUSH (branch)      same as PULL REQUEST (a branch with an open PR is built as the PR only)
//   MAIN (CD)          Build and QA:   Quality Gates -> Build Image -> Deploy QA -> QA Ready
//                                      -> QA Regression (24). No QA Smoke.
//                      UAT Approval:   mandatory input by an authorized approver (no agent, no
//                                      lock held while waiting); reject or timeout -> ABORTED,
//                                      nothing deployed to UAT.
//                      UAT Deployment: Verify Approved Image -> Promote to UAT (same image ID)
//                                      -> UAT Ready -> UAT Smoke (4) [-> Known Defects, optional]
//                                      -> Deployment Record. No UAT Regression.
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

pipeline {
  agent none

  options {
    buildDiscarder(logRotator(numToKeepStr: '20'))
    timestamps()
    // One build at a time per branch/PR job; the host lock serializes builds of different jobs.
    disableConcurrentBuilds()
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
          // <branch, 12 chars max>-<build number>-<hash of the full BUILD_TAG>: unique across jobs.
          def branchPart = (env.BRANCH_NAME ?: 'build').toLowerCase().replaceAll('[^a-z0-9]+', '-').replaceAll('^-+', '')
          if (branchPart.length() > 12) {
            branchPart = branchPart.substring(0, 12)
          }
          branchPart = branchPart.replaceAll('-+$', '') ?: 'build'
          def tagHash = ((env.BUILD_TAG ?: "local-${env.BUILD_NUMBER}").hashCode() & 0x7fffffff) % 100000
          env.IMAGE_TAG = "parabank-ci:${branchPart}-${env.BUILD_NUMBER}-${tagHash}"
          def plan = [
            'PUSH'        : 'QA: Smoke (no Regression, no UAT)',
            'PULL REQUEST': 'QA: Smoke (no Regression, no UAT) -> required check for merge',
            'MAIN'        : 'QA: Regression (gate) -> manual approval -> promote same image -> UAT: Smoke',
          ][env.BUILD_MODE]
          banner('PARABANK PIPELINE', [
            'BUILD MODE'      : env.BUILD_MODE,
            'TEST PLAN'       : plan,
            'BRANCH'          : env.BRANCH_NAME,
            'PULL REQUEST'    : env.CHANGE_ID ? "#${env.CHANGE_ID} (${env.CHANGE_BRANCH} -> ${env.CHANGE_TARGET})" : 'no',
            'MAIN BRANCH'     : mainBranch,
            'IMAGE TAG'       : env.IMAGE_TAG,
            'SUITE SIZES'     : "smoke ${env.SMOKE_EXPECTED}, regression ${env.REGRESSION_EXPECTED}",
            'CUCUMBER WORKERS': env.CUCUMBER_PARALLEL,
          ])
          currentBuild.description = env.BUILD_MODE
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
              npm run -s ci:coverage -- --suite smoke --expect "$SMOKE_EXPECTED"
              npm run -s ci:coverage -- --suite regression --expect "$REGRESSION_EXPECTED"
              npm run -s ci:coverage -- --suite sanity --expect "$SANITY_EXPECTED"
              npm run -s ci:coverage -- --suite full --expect "$FULL_EXPECTED"
            '''
          }
        }

        stage('Acquire Host Lock') {
          steps {
            sh 'npm run -s ci:lock -- acquire "$BUILD_TAG"'
          }
        }

        // BUILD ONCE: the only image build of the pipeline. QA and UAT receive this image ID.
        stage('Build Image') {
          steps {
            script {
              sh 'PARABANK_IMAGE_TAG="$IMAGE_TAG" PARABANK_BUILD_FRESH=true npm run app:build'
              env.IMAGE_ID = sh(returnStdout: true, script: 'docker image inspect --format "{{.Id}}" "$IMAGE_TAG"').trim()
              env.IMAGE_REVISION = sh(returnStdout: true, script: 'docker image inspect --format "{{index .Config.Labels \\"org.opencontainers.image.revision\\"}}" "$IMAGE_TAG"').trim()
              env.SOURCE_COMMIT = sh(returnStdout: true, script: "sed -n 's/^PARABANK_SOURCE_COMMIT=//p' docker/parabank/source.env").trim()
              env.SOURCE_REPO = sh(returnStdout: true, script: "sed -n 's/^PARABANK_SOURCE_REPO=//p' docker/parabank/source.env").trim()
              if (!(env.IMAGE_ID ==~ /sha256:[0-9a-f]{64}/)) {
                error("Build produced no usable image ID: '${env.IMAGE_ID}'")
              }
              if (env.IMAGE_REVISION != env.SOURCE_COMMIT) {
                error("Image revision label ${env.IMAGE_REVISION} does not match the pinned source commit ${env.SOURCE_COMMIT}")
              }
              banner('APPLICATION BUILD (BUILD ONCE)', [
                'SOURCE REPO'  : env.SOURCE_REPO,
                'SOURCE COMMIT': env.SOURCE_COMMIT,
                'IMAGE TAG'    : env.IMAGE_TAG,
                'IMAGE ID'     : env.IMAGE_ID,
              ])
            }
          }
        }

        stage('Deploy QA') {
          steps {
            script {
              sh 'npm run -s env -- deploy qa "$IMAGE_ID"'
              env.QA_IMAGE_ID = sh(returnStdout: true, script: 'docker container inspect --format "{{.Image}}" parabank-qa-parabank-1').trim()
              banner('QA DEPLOYED', ['PROJECT': 'parabank-qa', 'IMAGE ID': env.QA_IMAGE_ID])
            }
          }
        }

        stage('QA Ready') {
          steps {
            sh 'npm run -s env -- health qa --wait'
            sh 'npm run -s env -- identity qa --expect "$IMAGE_ID"'
          }
        }

        // CI (pull requests and branch pushes): the candidate image must pass Smoke on QA. For a
        // pull request, this build's result is the required "Jenkins" check on GitHub.
        stage('QA Smoke') {
          when {
            expression { env.BUILD_MODE != 'MAIN' }
          }
          steps {
            script {
              runSuite('qa', 'smoke', env.SMOKE_EXPECTED)
              env.QA_GATE_PASSED = 'true'
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
            if (fileExists('node_modules')) {
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
            if (!awaitingApproval) {
              sh '''
                if docker image inspect "$IMAGE_TAG" >/dev/null 2>&1; then
                  docker image rm "$IMAGE_TAG"
                fi
              '''
            }
            if (fileExists('node_modules')) {
              sh 'npm run -s ci:lock -- release "$BUILD_TAG"'
            }
          }
          // Traces are never produced in CI; reports and logs are redacted (docs/ci-cd.md).
          archiveArtifacts artifacts: 'reports/**, build/**', allowEmptyArchive: true
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
        // from the pinned commit.
        stage('Verify Approved Image') {
          steps {
            sh '''
              set -eu
              test -n "$IMAGE_ID"
              test "$IMAGE_ID" = "$QA_IMAGE_ID"
              docker image inspect "$IMAGE_ID" >/dev/null
              revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE_ID")
              test "$revision" = "$SOURCE_COMMIT"
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
  }
}
