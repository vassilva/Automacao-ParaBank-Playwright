#!/bin/sh
# Global pipeline lock for every build of the ParaBank Multibranch job (PRs, main, branch pushes).
#
#   sh scripts/ci/pipeline-lock.sh acquire <owner>
#   sh scripts/ci/pipeline-lock.sh release <owner>
#
# One pipeline at a time: the Jenkinsfile takes this lock as the first thing in its single agent
# block and releases it in that block's post section (success, failure, abort, timeout). Plain sh
# and the Docker CLI only, so it also works when `npm ci` failed.
#
# How: creating a Docker network is atomic in the daemon (verified: 60 concurrent creates of one
# name -> exactly one network), so the build that creates it holds the lock. Labels record the
# owner (Jenkins BUILD_TAG) and the time. Same name and labels as the former scripts/ci/host-lock.ts,
# so both interoperate.
#   - waiters poll every PARABANK_LOCK_POLL_SECONDS (15) for at most PARABANK_LOCK_WAIT_MINUTES (180),
#     naming the holder, then fail (no indefinite waiting);
#   - a lock older than PARABANK_LOCK_STALE_MINUTES (330, longer than the pipeline's whole timeout)
#     can only belong to a build that died without its post section: it is removed loudly;
#   - release is idempotent and only removes a lock held by the given owner.
# PARABANK_LOCK_NAME overrides the network name (tests only).
set -eu

LOCK=${PARABANK_LOCK_NAME:-parabank-ci-host-lock}
OWNER_LABEL=parabank.lock.owner
SINCE_LABEL=parabank.lock.since
WAIT_MINUTES=${PARABANK_LOCK_WAIT_MINUTES:-180}
STALE_MINUTES=${PARABANK_LOCK_STALE_MINUTES:-330}
POLL_SECONDS=${PARABANK_LOCK_POLL_SECONDS:-15}

command=${1:-}
owner=${2:-}
if [ -z "$command" ] || [ -z "$owner" ]; then
  echo "Usage: pipeline-lock.sh acquire|release <owner>" >&2
  exit 2
fi

holder() { docker network inspect "$LOCK" --format "{{index .Labels \"$OWNER_LABEL\"}}" 2>/dev/null || true; }
since() { docker network inspect "$LOCK" --format "{{index .Labels \"$SINCE_LABEL\"}}" 2>/dev/null || true; }

case "$command" in
  acquire)
    deadline=$(( $(date +%s) + WAIT_MINUTES * 60 ))
    reported=""
    while :; do
      if docker network create --internal --label "$OWNER_LABEL=$owner" \
        --label "$SINCE_LABEL=$(date +%s)" "$LOCK" >/dev/null 2>&1; then
        echo "PIPELINE LOCK acquired by $owner"
        exit 0
      fi
      current=$(holder)
      if [ "$current" = "$owner" ]; then
        echo "PIPELINE LOCK already held by $owner"
        exit 0
      fi
      started=$(since)
      if [ -n "$current" ] && [ -n "$started" ]; then
        age=$(( ($(date +%s) - started) / 60 ))
        if [ "$age" -gt "$STALE_MINUTES" ]; then
          echo "PIPELINE LOCK held by $current for $age min (> $STALE_MINUTES): stale, removing it" >&2
          docker network rm "$LOCK" >/dev/null 2>&1 || true
          continue
        fi
      fi
      if [ "$current" != "$reported" ]; then
        echo "Waiting for the pipeline lock held by ${current:-unknown} (up to $WAIT_MINUTES min)"
        reported=$current
      fi
      if [ "$(date +%s)" -ge "$deadline" ]; then
        echo "Pipeline lock not acquired within $WAIT_MINUTES min (held by ${current:-unknown})" >&2
        exit 1
      fi
      sleep "$POLL_SECONDS"
    done
    ;;
  release)
    current=$(holder)
    if [ -z "$current" ]; then
      echo "PIPELINE LOCK not held by anyone; nothing to release"
    elif [ "$current" != "$owner" ]; then
      echo "PIPELINE LOCK held by $current, not by $owner; left untouched"
    else
      docker network rm "$LOCK" >/dev/null
      echo "PIPELINE LOCK released by $owner"
    fi
    ;;
  *)
    echo "Usage: pipeline-lock.sh acquire|release <owner>" >&2
    exit 2
    ;;
esac
