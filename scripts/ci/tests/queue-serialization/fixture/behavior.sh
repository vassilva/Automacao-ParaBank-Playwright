#!/bin/sh
# Behavior of one fixture build, chosen by the test per branch in /tmp/qit/ctl/<branch>:
#   sleep <n>  succeed after n seconds (default: sleep 8)
#   fail       fail after 6 seconds
#   hang       sleep past the stage timeout (30 s)
mode=$(cat "/tmp/qit/ctl/$1" 2>/dev/null || echo "sleep 8")
echo "QIT behavior for $1: $mode"
case "$mode" in
  sleep*) sleep "${mode#sleep }" ;;
  fail) sleep 6; echo "QIT failing on purpose" >&2; exit 1 ;;
  hang) sleep 300 ;;
  *) echo "unknown behavior $mode" >&2; exit 2 ;;
esac
