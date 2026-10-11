// Before a Jenkins restart (or crash): main RUNNING in its work stage, two PRs QUEUED behind it.
println "# Restart (${args ? args[0] : 'restart'}): before"
idle()
ctl('main', 'sleep 40'); ctl('PR-1', 'sleep 2'); ctl('PR-2', 'sleep 2')
int m = next('main'), a = next('PR-1'), b = next('PR-2')
schedule('main')
waitFor('main in its work stage', 60) { buildOf('main', m)?.log?.contains('QIT behavior') }
schedule('PR-1'); Thread.sleep(700); schedule('PR-2'); Thread.sleep(2000)
ok(buildOf('main', m)?.isBuilding(), 'main is RUNNING')
ok(queued('PR-1')?.isBlocked() && queued('PR-2')?.isBlocked(), 'PR-1 and PR-2 are QUEUED behind main')
new File('/tmp/qit/restart.txt').text = "${m} ${a} ${b}"
println "RESULT restart-before failures=${failures}"
