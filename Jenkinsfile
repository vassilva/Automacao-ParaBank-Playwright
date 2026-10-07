// Jenkins CI/CD for the ParaBank BDD project (Playwright + TypeScript + Cucumber).
// One Jenkinsfile, one Multibranch Pipeline; the build event selects the lifecycle:
//
//   PUSH (branch)   Build Image -> Deploy QA -> QA Ready -> QA Smoke
//   PULL REQUEST    Build Image -> Deploy QA -> QA Ready -> QA Smoke -> QA Regression
//   MAIN            Build Image -> Deploy QA -> QA Ready -> QA Smoke
//                   -> Promote to UAT -> UAT Ready -> UAT Smoke -> UAT Regression
//                   [-> Known Defects (optional, never gating)] -> Deployment Record
//
// BUILD ONCE, PROMOTE THE SAME IMAGE: ParaBank is built once per pipeline from the pinned official
// source commit (docker/parabank/source.env), with its own 239 tests. QA and UAT run that image by
// image ID (never by a mutable tag); the identity gate fails the promotion unless the image ID UAT
// runs equals the image ID QA validated, which equals the image ID that was built.
//
// QA (port 8090) and UAT (port 8091) are the persistent "parabank-qa" and "parabank-uat" Compose
// environments on the Jenkins Docker host (src/support/environments.ts): separate containers and
// databases. A deployment recreates the environment's container (fresh database) from the image.
//
// SMOKE GATES REGRESSION: stages run in sequence; a failed Smoke stage fails the build and every
// later stage is skipped. Regression additionally requires the Smoke stage's own success flag.
// Each suite run is validated against its approved count (scripts/ci/verify-suite-coverage.ts).
//
// Cucumber runs with ONE worker and no retries everywhere: ParaBank registration is not
// concurrency-safe (docs/qa-coverage.md). HOST LOCK: QA and UAT are shared by every job, so the
// whole build/deploy/test part holds a host-wide lock (scripts/ci/host-lock.ts), released in post.
//
// Optional Jenkins-level setting (Manage Jenkins -> System -> Global properties):
//   PARABANK_MAIN_BRANCH  branch whose builds promote to UAT (default: main)

def banner(String title, Map fields) {
  def lines = ['========================================', title, '========================================']
  fields.each { key, value -> lines << "${key}: ${value ?: '-'}" }
  lines << '========================================'
  echo lines.join('\n')
}

// Runs one suite against one environment and validates it against its approved count.
// Reports go to reports/<environment>/<suite>, so QA/UAT and Smoke/Regression never overwrite
// each other.
def runSuite(String environment, String suite, String expected) {
  def dir = "reports/${environment}/${suite}"
  withEnv([
    "TARGET_ENV=${environment}",
    "PARABANK_BASE_URL=http://parabank-${environment}-parabank-1:8080/parabank/",
    "REPORTS_DIR=${dir}",
  ]) {
    sh "npm run test:${suite}"
    sh "npm run -s ci:coverage -- --suite ${suite} --expect ${expected} ${dir}"
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
      description: 'MAIN only: after the UAT gate, run the 25 known-defect scenarios (never fails the deployment; a defect that no longer reproduces marks the build UNSTABLE).'
    )
    choice(
      name: 'ADDITIONAL_QA_SUITE',
      choices: ['none', 'sanity', 'full'],
      description: 'Run an extra suite on QA after the QA Smoke gate (manual or release use).'
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
            'PUSH'        : 'QA: Smoke',
            'PULL REQUEST': 'QA: Smoke -> Regression',
            'MAIN'        : 'QA: Smoke; UAT: Smoke -> Regression',
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

    stage('Build, Deploy and Validate') {
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

        stage('QA Smoke') {
          steps {
            script {
              runSuite('qa', 'smoke', env.SMOKE_EXPECTED)
              env.QA_SMOKE_PASSED = 'true'
            }
          }
        }

        stage('QA Regression') {
          when {
            expression { env.BUILD_MODE == 'PULL REQUEST' && env.QA_SMOKE_PASSED == 'true' }
          }
          steps {
            script {
              runSuite('qa', 'regression', env.REGRESSION_EXPECTED)
            }
          }
        }

        stage('QA Additional Suite') {
          when {
            expression { params.ADDITIONAL_QA_SUITE != 'none' && env.QA_SMOKE_PASSED == 'true' }
          }
          steps {
            script {
              def suite = params.ADDITIONAL_QA_SUITE
              runSuite('qa', suite, suite == 'sanity' ? env.SANITY_EXPECTED : env.FULL_EXPECTED)
            }
          }
        }

        // PROMOTE: the very same image ID QA validated, never a rebuild.
        stage('Promote to UAT') {
          when {
            expression { env.BUILD_MODE == 'MAIN' && env.QA_SMOKE_PASSED == 'true' }
          }
          steps {
            script {
              if (env.QA_IMAGE_ID != env.IMAGE_ID) {
                error("QA runs ${env.QA_IMAGE_ID}, but the build produced ${env.IMAGE_ID}: refusing to promote")
              }
              sh 'npm run -s env -- deploy uat "$QA_IMAGE_ID"'
              env.UAT_IMAGE_ID = sh(returnStdout: true, script: 'docker container inspect --format "{{.Image}}" parabank-uat-parabank-1').trim()
            }
          }
        }

        stage('UAT Ready') {
          when {
            expression { env.BUILD_MODE == 'MAIN' && env.UAT_IMAGE_ID != null && env.UAT_IMAGE_ID != '' }
          }
          steps {
            script {
              sh 'npm run -s env -- health uat --wait'
              // Identity gate: built == QA == UAT, read from Docker metadata.
              sh 'npm run -s env -- identity --same --expect "$IMAGE_ID"'
              banner('IMAGE IDENTITY', [
                'SOURCE COMMIT': env.SOURCE_COMMIT,
                'BUILT IMAGE ID': env.IMAGE_ID,
                'QA IMAGE ID'  : env.QA_IMAGE_ID,
                'UAT IMAGE ID' : env.UAT_IMAGE_ID,
              ])
              env.UAT_READY = 'true'
            }
          }
        }

        // The deployment gate. Smoke decides whether Regression runs at all.
        stage('UAT Smoke') {
          when {
            expression { env.BUILD_MODE == 'MAIN' && env.UAT_READY == 'true' }
          }
          steps {
            script {
              runSuite('uat', 'smoke', env.SMOKE_EXPECTED)
              env.UAT_SMOKE_PASSED = 'true'
            }
          }
        }

        stage('UAT Regression') {
          when {
            expression { env.BUILD_MODE == 'MAIN' && env.UAT_SMOKE_PASSED == 'true' }
          }
          steps {
            script {
              runSuite('uat', 'regression', env.REGRESSION_EXPECTED)
              env.UAT_REGRESSION_PASSED = 'true'
            }
          }
        }

        // Documented defects, judged by their registered proofs (docs/defects.md). Never part of
        // the deployment gate: a reproduced defect is the expected result; anything else (a defect
        // that no longer reproduces, or a failure that is not the defect) marks the build UNSTABLE.
        stage('Known Defects') {
          when {
            expression { env.BUILD_MODE == 'MAIN' && params.RUN_KNOWN_DEFECTS && env.UAT_REGRESSION_PASSED == 'true' }
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
            expression { env.BUILD_MODE == 'MAIN' && env.UAT_REGRESSION_PASSED == 'true' }
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
                "QA validation:   smoke ${env.SMOKE_EXPECTED}/${env.SMOKE_EXPECTED}",
                "UAT validation:  smoke ${env.SMOKE_EXPECTED}/${env.SMOKE_EXPECTED}, then regression ${env.REGRESSION_EXPECTED}/${env.REGRESSION_EXPECTED}",
                "Jenkins build:   ${env.JOB_NAME} #${env.BUILD_NUMBER}",
                "Build URL:       ${env.BUILD_URL ?: '(Jenkins URL not configured)'}",
                '========================================',
              ].join('\n') + '\n'
              writeFile file: 'deployment/deployment-record.txt', text: record, encoding: 'UTF-8'
              echo record
              currentBuild.description = "MAIN: UAT validated ${env.IMAGE_ID.substring(0, 19)}"
            }
          }
        }
      }

      post {
        always {
          junit testResults: 'reports/**/cucumber-junit.xml, reports/**/junit.xml', allowEmptyResults: true
          script {
            if (fileExists('node_modules')) {
              // QA and UAT stay running (persistent environments). Their logs are saved redacted
              // and the agent is detached from their networks.
              sh 'npm run -s env -- teardown qa --keep-running || true'
              if (env.UAT_IMAGE_ID) {
                sh 'npm run -s env -- teardown uat --keep-running || true'
              }
            }
            // Human-readable pointers; identity is always the image ID.
            if (env.QA_IMAGE_ID) {
              sh 'docker tag "$QA_IMAGE_ID" parabank-qa:current'
            }
            if (env.UAT_REGRESSION_PASSED == 'true') {
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
          // Traces are never produced in CI; reports are redacted (README "Security approach").
          archiveArtifacts artifacts: 'reports/**, build/**, deployment/**', allowEmptyArchive: true
        }
      }
    }
  }
}
