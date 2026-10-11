#!/bin/sh
# Queue-level serialization test in a THROWAWAY Jenkins (never the real instance):
#   npm run test:queue
#
# Starts a container from the real Jenkins image (JENKINS_IMAGE) with --network none, a memory cap
# and a copy of the plugins of the real Jenkins container (SOURCE_CONTAINER, read only), creates a
# Multibranch project with the real project's name on a local Git repository (fixture/), and checks
# with real Jenkins scheduling:
#   - without the dispatcher, builds of the project run together (negative control);
#   - with the plugin jenkins/parabank-serial-queue-plugin (deployed without a restart, as an
#     administrator would): one project build RUNNING at a time, the others QUEUED without
#     executors, released one by one after SUCCESS, FAILURE, ABORT and TIMEOUT, oldest first,
#     unrelated jobs untouched; across repeated Jenkins restarts and crashes;
#   - the branch property strategy (only main and PR-<n> triggered automatically);
#   - no overlapping RUNNING intervals in the build records (scripts/ci/build-overlap.ts).
# Evidence: reports/queue-serialization/. KEEP=1 keeps the container for inspection.
set -eu
export MSYS_NO_PATHCONV=1

HERE=$(cd "$(dirname "$0")" && { pwd -W 2>/dev/null || pwd; })
ROOT=$(cd "$HERE/../../../.." && { pwd -W 2>/dev/null || pwd; })
NAME=${QIT_CONTAINER:-parabank-queue-it}
IMAGE=${JENKINS_IMAGE:-jenkins-jenkins}
SOURCE=${SOURCE_CONTAINER:-jenkins}
OUT="$ROOT/reports/queue-serialization"
LOG="$OUT/run.log"
HPI="$ROOT/jenkins/parabank-serial-queue-plugin/target/parabank-serial-queue.hpi"
RESTARTS=${QIT_RESTARTS:-2}
CRASHES=${QIT_CRASHES:-3}
mkdir -p "$OUT"
: >"$LOG"
failed=0

say() { echo "$*" | tee -a "$LOG"; }
in_it() { docker exec "$NAME" sh -c "$1"; }
cleanup() {
  if [ "${KEEP:-0}" != "1" ]; then
    docker rm -f -v "$NAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

wait_up() {
  tries=0
  until in_it 'curl -sf -o /dev/null http://localhost:8080/login' 2>/dev/null; do
    tries=$((tries + 1))
    if [ "$tries" -gt 100 ]; then
      say "Jenkins did not come up"
      exit 1
    fi
    sleep 3
  done
  in_it 'test -s /tmp/cli.jar || curl -sf -o /tmp/cli.jar http://localhost:8080/jnlpJars/jenkins-cli.jar'
}

cli() { docker exec -i "$NAME" java -jar /tmp/cli.jar -s http://localhost:8080/ "$@"; }

# Runs lib.groovy + one step script; the step must print "RESULT <step> failures=0".
step() {
  script=$1
  shift
  out=$(cat "$HERE/lib.groovy" "$HERE/$script" | cli groovy = "$@" 2>&1) || true
  echo "$out" | tee -a "$LOG"
  if ! echo "$out" | grep -q '^RESULT .* failures=0$'; then
    failed=$((failed + 1))
  fi
}

git_in_it() { in_it "cd /tmp/qit/work && git -c user.name=qit -c user.email=qit@localhost.invalid $1 >/dev/null"; }
commit_push() { git_in_it "checkout -q $1" && git_in_it "commit -q --allow-empty -m '$2'" && git_in_it "push -q origin $1"; }

if [ ! -s "$HPI" ]; then
  sh "$ROOT/jenkins/parabank-serial-queue-plugin/build.sh"
fi

say "== Throwaway Jenkins $NAME from image $IMAGE (plugins from $SOURCE, --network none)"
docker rm -f -v "$NAME" >/dev/null 2>&1 || true
# Same restart policy as the real container (unless-stopped): a Jenkins restart exits the JVM.
docker create --name "$NAME" --network none --memory 900m --restart unless-stopped \
  -e JAVA_OPTS="-Xmx512m -Djenkins.install.runSetupWizard=false -Dhudson.plugins.git.GitSCM.ALLOW_LOCAL_CHECKOUT=true" \
  "$IMAGE" >/dev/null
docker exec "$SOURCE" tar -C /var/jenkins_home -cf - plugins | docker cp - "$NAME:/var/jenkins_home/"
docker start "$NAME" >/dev/null
# docker cp extracts as root: give the plugins back to the jenkins user (plugin deployment writes
# there).
docker exec -u root "$NAME" chown -R jenkins:jenkins /var/jenkins_home/plugins
wait_up
say "Jenkins $(cli version)"
if cli declarative-linter <"$ROOT/Jenkinsfile" | tee -a "$LOG" | grep -q 'Jenkinsfile successfully validated'; then
  say "ok   - the real Jenkinsfile passes the Declarative linter of this Jenkins"
else
  say "FAIL - the real Jenkinsfile does not pass the Declarative linter"
  failed=$((failed + 1))
fi

# Fixture repository: main, PR-1..3 (named like pull-request jobs) and feature-x.
in_it 'mkdir -p /tmp/qit/ctl /tmp/qit/work'
docker cp "$HERE/fixture/Jenkinsfile" "$NAME:/tmp/qit/work/Jenkinsfile"
docker cp "$HERE/fixture/behavior.sh" "$NAME:/tmp/qit/behavior.sh"
in_it 'git init -q --bare /tmp/qit/repo.git && cd /tmp/qit/work && git init -q -b main && git remote add origin /tmp/qit/repo.git'
git_in_it 'add Jenkinsfile'
git_in_it "commit -q -m fixture"
git_in_it 'push -q origin main'
for b in PR-1 PR-2 PR-3 feature-x; do
  git_in_it "push -q origin main:$b"
done

step setup.groovy

say "== Deploy the plugin without a restart (as Manage Jenkins -> Plugins -> Advanced -> Deploy plugin)"
INSTALLED_AT=$(in_it 'date +%s%3N')
if ! cli install-plugin = -deploy <"$HPI" >>"$LOG" 2>&1; then
  say "FAIL - the plugin could not be deployed (see the log); no scenario is meaningful without it"
  exit 1
fi
step plugin-check.groovy
if ! tail -1 "$LOG" | grep -q '^RESULT plugin-check failures=0$'; then
  say "FAIL - the plugin is not active; stopping before the scenarios"
  exit 1
fi

step scenarios.groovy

i=1
while [ "$i" -le "$RESTARTS" ]; do
  say "== Jenkins restart $i/$RESTARTS with a build RUNNING and two QUEUED"
  step restart-before.groovy restart
  # Jenkins exits (code 5) and the restart policy starts the container again.
  cli restart 2>&1 | tee -a "$LOG" || true
  sleep 10
  wait_up
  step restart-after.groovy restart
  i=$((i + 1))
done
i=1
while [ "$i" -le "$CRASHES" ]; do
  say "== Crash $i/$CRASHES (container killed and restarted) with a build RUNNING and two QUEUED"
  step restart-before.groovy crash
  docker restart -t 0 "$NAME" >/dev/null
  wait_up
  step restart-after.groovy crash
  i=$((i + 1))
done

say "== Branch discovery and triggering"
commit_push feature-x 'feature work'
step discovery.groovy feature-push
git_in_it 'checkout -q main'
git_in_it 'merge -q --no-ff -m merge-feature-x feature-x'
git_in_it 'push -q origin main'
step discovery.groovy merge-to-main
git_in_it 'push -q origin main:feature-y'
step discovery.groovy new-branch
commit_push PR-2 'pr update'
step discovery.groovy pr-push

say "== RUNNING intervals from the build records (scripts/ci/build-overlap.ts)"
rm -rf "$OUT/branches"
mkdir -p "$OUT/branches"
in_it 'cd /var/jenkins_home/jobs/Automacao-ParaBank-Playwright/branches && find . -path "*/builds/*/build.xml" | tar -cf - -T -' | tar -C "$OUT/branches" -xf -
cd "$ROOT"
if npx ts-node scripts/ci/build-overlap.ts "$OUT/branches" --since "$INSTALLED_AT" | tee -a "$LOG"; then
  say "ok   - no overlapping RUNNING builds after the dispatcher was installed"
else
  say "FAIL - overlapping RUNNING builds after the dispatcher was installed"
  failed=$((failed + 1))
fi

say "== $failed failed step(s); evidence in reports/queue-serialization/run.log"
[ "$failed" -eq 0 ]
