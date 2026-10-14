#!/bin/sh
# Drill of the proposed Jenkins matrix authorization in a THROWAWAY Jenkins (never the real one):
#   npm run test:matrix-auth
#
# Same image as the real controller (jenkins-jenkins:latest), --network none, memory cap, its own
# named volume; removed on exit. init/01-security.groovy recreates today's model once ("Logged-in
# users can do anything", anonymous read denied) with the account IDs of the real controller plus a
# plain "reader"; their passwords are random, held in this shell only, never printed. Then:
#   - today's exposure: any logged-in user reaches Manage Jenkins and the script console;
#   - backup with the documented command, apply matrix-strategy.xml (the exact block proposed for
#     the real controller, docs/security-hardening.md), restart;
#   - the proposed model: owner administers; "admin" read-only (not disabled); reader read-only;
#     anonymous denied; a pipeline input limited to the owner (like UAT Approval) can only be
#     approved by the owner (others: refused, build still waiting);
#   - rollback with the documented command (container stopped), the previous model is back.
set -eu
export MSYS_NO_PATHCONV=1
HERE=$(cd "$(dirname "$0")" && { pwd -W 2>/dev/null || pwd; })
C=pb-matrix-drill
V=pb-matrix-drill-home
IMAGE=jenkins-jenkins:latest
PW_OWNER=$(openssl rand -hex 16); PW_ADMIN=$(openssl rand -hex 16); PW_READER=$(openssl rand -hex 16)
fail=0
ok() { echo "ok   - $*"; }
bad() { echo "FAIL - $*"; fail=$((fail + 1)); }
cleanup() { docker rm -f "$C" >/dev/null 2>&1 || true; docker volume rm "$V" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

in_c() { docker exec "$C" sh -c "$1"; }
wait_up() {
  i=0
  until in_c 'curl -sf -o /dev/null http://localhost:8080/login' 2>/dev/null; do
    i=$((i + 1)); [ "$i" -gt 100 ] && { echo "Jenkins did not come up"; exit 1; }; sleep 3
  done
}
# HTTP status for user (or "anon") on a path, GET.
code() {
  if [ "$1" = anon ]; then in_c "curl -s -o /dev/null -w '%{http_code}' http://localhost:8080$2"
  else in_c "curl -s -o /dev/null -w '%{http_code}' -u '$1:$2' http://localhost:8080$3"; fi
}
# POST with a crumb (session cookie) as user; prints the HTTP status.
post() {
  user=$1; pw=$2; path=$3; shift 3
  in_c "rm -f /tmp/jar; crumb=\$(curl -s -c /tmp/jar -u '$user:$pw' 'http://localhost:8080/crumbIssuer/api/xml?xpath=concat(//crumbRequestField,\":\",//crumb)'); curl -s -o /dev/null -w '%{http_code}' -b /tmp/jar -u '$user:$pw' -H \"\$crumb\" $* -X POST 'http://localhost:8080$path'"
}

echo "== throwaway Jenkins $C ($IMAGE, --network none, volume $V)"
docker volume create "$V" >/dev/null
docker create --name "$C" --network none --memory 900m -v "$V:/var/jenkins_home" \
  -e JAVA_OPTS="-Xmx512m -Djenkins.install.runSetupWizard=false" \
  -e PW_OWNER="$PW_OWNER" -e PW_ADMIN="$PW_ADMIN" -e PW_READER="$PW_READER" "$IMAGE" >/dev/null
docker cp "$HERE/init" "$C:/var/jenkins_home/init.groovy.d"
docker start "$C" >/dev/null
wait_up
echo "Jenkins $(in_c 'curl -s -I http://localhost:8080/login | grep -i x-jenkins: | tr -d "\r"')"

echo "== current live model: logged-in users can do anything"
[ "$(code reader "$PW_READER" /manage/)" = 200 ] && ok "reader reaches Manage Jenkins (current exposure)" || bad "reader /manage"
[ "$(code reader "$PW_READER" /script)" = 200 ] && ok "reader reaches the script console (current exposure)" || bad "reader /script"
[ "$(code anon /)" = 403 ] && ok "anonymous denied" || bad "anonymous /"

echo "== backup (documented command) and apply the proposed matrix strategy"
STAMP=drill
docker exec "$C" cp /var/jenkins_home/config.xml /var/jenkins_home/config.xml.bak-$STAMP-before-matrix
docker exec "$C" sh -c "[ ! -f /var/jenkins_home/users/users.xml ] || cp /var/jenkins_home/users/users.xml /var/jenkins_home/users/users.xml.bak-$STAMP-before-matrix"
docker cp "$HERE/matrix-strategy.xml" "$C:/tmp/matrix-strategy.xml"
docker cp "$HERE/job.xml" "$C:/tmp/job.xml"
docker exec -u 0 "$C" perl -0pi -e 'BEGIN{local $/; open F,"/tmp/matrix-strategy.xml"; $new=<F>; close F; chomp $new} s#<authorizationStrategy .*?</authorizationStrategy>#$new#s' /var/jenkins_home/config.xml
docker restart "$C" >/dev/null
wait_up
in_c 'grep -c GlobalMatrixAuthorizationStrategy /var/jenkins_home/config.xml' | grep -q '^1$' && ok "config.xml holds the matrix strategy after restart" || bad "strategy not persisted"

echo "== proposed model"
[ "$(code viamerico "$PW_OWNER" /manage/)" = 200 ] && ok "owner (viamerico) administers" || bad "owner /manage"
[ "$(code viamerico "$PW_OWNER" /script)" = 200 ] && ok "owner reaches the script console" || bad "owner /script"
[ "$(code admin "$PW_ADMIN" /manage/)" = 403 ] && ok "admin (read-only variant) cannot administer" || bad "admin /manage"
[ "$(code admin "$PW_ADMIN" /api/json)" = 200 ] && ok "admin can still log in and read (not disabled)" || bad "admin read"
[ "$(code reader "$PW_READER" /manage/)" = 403 ] && ok "reader cannot reach Manage Jenkins" || bad "reader /manage"
[ "$(code reader "$PW_READER" /script)" = 403 ] && ok "reader cannot reach the script console" || bad "reader /script"
[ "$(code reader "$PW_READER" /api/json)" = 200 ] && ok "reader can read" || bad "reader read"
[ "$(code anon /)" = 403 ] && ok "anonymous still denied" || bad "anonymous /"

echo "== UAT-style approval: input restricted to the owner"
s=$(post viamerico "$PW_OWNER" '/createItem?name=approval-drill' "-H 'Content-Type: application/xml' --data-binary @/tmp/job.xml" 2>/dev/null || true)
[ "$s" = 200 ] && ok "owner creates a pipeline job" || bad "createItem ($s)"
[ "$(post reader "$PW_READER" /job/approval-drill/build)" = 403 ] && ok "reader cannot start builds" || bad "reader build"
s=$(post viamerico "$PW_OWNER" /job/approval-drill/build); case "$s" in 200|201) ok "owner starts the build";; *) bad "owner build ($s)";; esac
i=0; until in_c "curl -s -u 'viamerico:$PW_OWNER' http://localhost:8080/job/approval-drill/1/consoleText | grep -q 'or Abort'"; do i=$((i + 1)); [ "$i" -gt 60 ] && break; sleep 2; done
[ "$i" -le 60 ] && ok "build waits at the input" || bad "input not reached"
pending() { in_c "curl -s -u 'viamerico:$PW_OWNER' http://localhost:8080/job/approval-drill/1/api/json | grep -q '\"building\":true'"; }
s=$(post reader "$PW_READER" /job/approval-drill/1/input/Approve/proceedEmpty); sleep 3
if pending; then ok "reader cannot approve (HTTP $s; build still waiting)"; else bad "reader approved (HTTP $s)"; fi
s=$(post admin "$PW_ADMIN" /job/approval-drill/1/input/Approve/proceedEmpty); sleep 3
if pending; then ok "read-only admin cannot approve (HTTP $s; build still waiting)"; else bad "admin approved (HTTP $s)"; fi
post viamerico "$PW_OWNER" /job/approval-drill/1/input/Approve/proceedEmpty >/dev/null
i=0; until in_c "curl -s -u 'viamerico:$PW_OWNER' http://localhost:8080/job/approval-drill/1/api/json | grep -q '\"result\":\"SUCCESS\"'"; do i=$((i + 1)); [ "$i" -gt 60 ] && break; sleep 2; done
[ "$i" -le 60 ] && ok "owner approves; build SUCCESS" || bad "owner approval"

echo "== rollback (documented command, container stopped)"
docker stop "$C" >/dev/null
docker run --rm --network none --user 0 --entrypoint cp -v "$V:/var/jenkins_home" "$IMAGE" \
  -p /var/jenkins_home/config.xml.bak-$STAMP-before-matrix /var/jenkins_home/config.xml
docker start "$C" >/dev/null
wait_up
in_c 'grep -c FullControlOnceLoggedInAuthorizationStrategy /var/jenkins_home/config.xml' | grep -q '^1$' && ok "previous strategy restored in config.xml" || bad "rollback config"
[ "$(code reader "$PW_READER" /manage/)" = 200 ] && ok "previous behavior back (reader administers again)" || bad "rollback behavior"
[ "$(code viamerico "$PW_OWNER" /manage/)" = 200 ] && ok "owner still administers after rollback" || bad "owner after rollback"

echo "== $fail failed check(s)"
[ "$fail" -eq 0 ]
