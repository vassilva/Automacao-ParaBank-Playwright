// After the restart: the dispatcher plugin is active (loaded before the persisted queue), main
// resumes and finishes, the queue still holds the PRs, and they run one at a time afterwards. The
// build records are judged too: a PR that started during the startup would overlap main.
def mode = args ? args[0] : 'restart'
println "# Restart (${mode}): after"
def (m, a, b) = new File('/tmp/qit/restart.txt').text.tokenize()*.toInteger()
ok(serialDispatchers().size() == 1, 'the dispatcher plugin is active after the start')
def monitor = startMonitor()
ok(buildOf('PR-1', a) == null || after(buildOf('PR-1', a), buildOf('main', m)), 'PR-1 did not start while main was active')
ok(buildOf('PR-2', b) == null || after(buildOf('PR-2', b), buildOf('main', m)), 'PR-2 did not start while main was active')
if (buildOf('main', m)?.isBuilding()) {
  ok(queued('PR-1')?.isBlocked() && queued('PR-2')?.isBlocked(), 'after the restart the persisted queue still holds PR-1 and PR-2 (QUEUED)')
}
idle()
stopMonitor(monitor)
def holder = buildOf('main', m)
// In a container, a Jenkins restart also ends the build's shell processes: the resumed main build
// finishes (whatever its result) and must release the queue.
ok(holder.result != null, "main resumed after the ${mode} and ended ${holder.result}")
def prs = [buildOf('PR-1', a), buildOf('PR-2', b)]
ok(prs.every { it?.result == Result.SUCCESS }, 'both PRs ran to SUCCESS afterwards (nothing lost from the queue, no deadlock)')
if (prs.every { it != null }) {
  prs = prs.sort { it.timeInMillis }
  ok(after(prs[0], holder) && after(prs[1], prs[0]), 'main, then the PRs, one at a time')
}
ok(monitor.violations.isEmpty() && monitor.maxRunning <= 1, "monitor after ${mode}: max RUNNING ${monitor.maxRunning}, violations ${monitor.violations.take(5)}")
println "RESULT restart-after failures=${failures}"
