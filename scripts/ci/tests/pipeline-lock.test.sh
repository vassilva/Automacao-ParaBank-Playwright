#!/bin/sh
# Controlled tests of scripts/ci/pipeline-lock.sh against the local Docker daemon, on a throwaway
# lock name (never the real one). Run: npm run test:lock
set -u
LOCK_SH="$(dirname "$0")/../pipeline-lock.sh"
export PARABANK_LOCK_NAME="parabank-lock-test-$$"
export PARABANK_LOCK_POLL_SECONDS=1
TMP=$(mktemp -d)
failures=0
pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; failures=$((failures + 1)); }
cleanup() { docker network rm "$PARABANK_LOCK_NAME" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

# 1. A second pipeline waits until the first releases, then proceeds.
sh "$LOCK_SH" acquire A >/dev/null
( PARABANK_LOCK_WAIT_MINUTES=1 sh "$LOCK_SH" acquire B >"$TMP/b.out" 2>&1; echo $? >"$TMP/b.rc" ) &
sleep 3
if [ ! -f "$TMP/b.rc" ] && grep -q "Waiting for the pipeline lock held by A" "$TMP/b.out"; then
  pass "B waits while A holds the lock"
else
  fail "B did not wait for A"
fi
sh "$LOCK_SH" release A >/dev/null
wait
if [ "$(cat "$TMP/b.rc")" = "0" ] && grep -q "acquired by B" "$TMP/b.out"; then
  pass "B acquires after A releases"
else
  fail "B did not acquire after release"
fi

# 2. Release is owner-scoped: another owner cannot release B's lock.
sh "$LOCK_SH" release intruder >"$TMP/r.out"
holder=$(docker network inspect "$PARABANK_LOCK_NAME" --format '{{index .Labels "parabank.lock.owner"}}' 2>/dev/null)
if [ "$holder" = "B" ] && grep -q "left untouched" "$TMP/r.out"; then
  pass "a non-owner release leaves the lock untouched"
else
  fail "non-owner release changed the lock"
fi

# 3. Bounded wait: no indefinite waiting.
if PARABANK_LOCK_WAIT_MINUTES=0 sh "$LOCK_SH" acquire C >"$TMP/c.out" 2>&1; then
  fail "C acquired a held lock"
else
  grep -q "not acquired within 0 min" "$TMP/c.out" && pass "waiting is bounded (exit 1 after the limit)" || fail "unexpected timeout message"
fi
sh "$LOCK_SH" release B >/dev/null

# 4. Stale lock of a dead build is removed, a live one is not.
docker network create --internal --label parabank.lock.owner=dead-build \
  --label "parabank.lock.since=$(( $(date +%s) - 400 * 60 ))" "$PARABANK_LOCK_NAME" >/dev/null
if PARABANK_LOCK_WAIT_MINUTES=1 sh "$LOCK_SH" acquire D >"$TMP/d.out" 2>&1 && grep -q "stale, removing it" "$TMP/d.out"; then
  pass "a lock older than the stale limit is removed and re-acquired"
else
  fail "stale lock not recovered"
fi
sh "$LOCK_SH" release D >/dev/null

# 5. Five concurrent pipelines: never two inside the critical section at once.
for i in 1 2 3 4 5; do
  (
    PARABANK_LOCK_WAIT_MINUTES=2 sh "$LOCK_SH" acquire "P$i" >/dev/null 2>&1 || exit 1
    echo "start P$i $(date +%s%N)" >>"$TMP/timeline"
    sleep 1
    echo "end P$i $(date +%s%N)" >>"$TMP/timeline"
    sh "$LOCK_SH" release "P$i" >/dev/null
  ) &
done
wait
if awk '{ if ($1 == "start") { depth++; if (depth > max) max = depth } else depth-- } END { exit !(max == 1 && NR == 10) }' "$TMP/timeline"; then
  pass "5 concurrent pipelines ran strictly one at a time"
else
  fail "overlap or missing pipelines: $(cat "$TMP/timeline" | tr '\n' ' ')"
fi

if docker network inspect "$PARABANK_LOCK_NAME" >/dev/null 2>&1; then
  fail "lock left behind after all releases"
else
  pass "no lock left behind"
fi
echo "failures: $failures"
exit "$failures"
