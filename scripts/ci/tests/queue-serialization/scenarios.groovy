// Scheduling scenarios WITH the serial-queue dispatcher registered. A background monitor samples
// Jenkins every 100 ms during all of them: no moment may show two project builds RUNNING.

println '# Scheduling scenarios (dispatcher registered)'
ok(serialDispatchers().size() == 1, 'exactly one serial-queue dispatcher is registered')
idle()
def monitor = startMonitor()

// 1. main RUNNING, a PR QUEUED (no build record, no executor) although an executor is free.
println '## 1. main running, PR queued'
ctl('main', 'sleep 15'); ctl('PR-1', 'sleep 3')
int m1 = next('main'), p1 = next('PR-1')
schedule('main')
waitFor('main RUNNING', 60) { buildOf('main', m1)?.isBuilding() }
schedule('PR-1')
Thread.sleep(4000)
def item = queued('PR-1')
ok(buildOf('main', m1)?.isBuilding(), 'main is RUNNING')
ok(item != null && item.isBlocked(), 'PR-1 is QUEUED (blocked in the Jenkins queue)')
ok(item?.why?.contains('ParaBank serial queue: waiting for'), "queue reason names the holder: ${item?.why}")
ok(buildOf('PR-1', p1) == null, 'PR-1 has no build record: it is not RUNNING')
ok(projectExecutors().every { it.job == 'main' }, "only main uses executors: ${projectExecutors()}")
ok(J.toComputer().countIdle() >= 1, "an executor is idle (${J.toComputer().countIdle()}) and the queued PR still does not take it")
idle()
ok(after(buildOf('PR-1', p1), buildOf('main', m1)), 'PR-1 left the queue only after main finished')

// 2. A PR RUNNING, main QUEUED.
println '## 2. PR running, main queued'
ctl('PR-1', 'sleep 12'); ctl('main', 'sleep 3')
p1 = next('PR-1'); m1 = next('main')
schedule('PR-1')
waitFor('PR-1 RUNNING', 60) { buildOf('PR-1', p1)?.isBuilding() }
schedule('main')
Thread.sleep(3000)
ok(queued('main')?.isBlocked() && buildOf('main', m1) == null, 'main is QUEUED while PR-1 runs')
idle()
ok(after(buildOf('main', m1), buildOf('PR-1', p1)), 'main left the queue only after PR-1 finished, and then ran')
ok(buildOf('main', m1)?.result == Result.SUCCESS, 'main ran to SUCCESS (never dropped)')

// 3. Several PRs and main competing: one at a time, released oldest first.
println '## 3. multiple PRs and main competing'
['PR-1': 'sleep 8', 'PR-2': 'sleep 4', 'PR-3': 'sleep 4', 'main': 'sleep 4'].each { b, mode -> ctl(b, mode) }
def n = ['PR-1', 'PR-2', 'PR-3', 'main'].collectEntries { [(it): next(it)] }
schedule('PR-1')
waitFor('PR-1 RUNNING', 60) { buildOf('PR-1', n['PR-1'])?.isBuilding() }
['PR-2', 'PR-3', 'main'].each { schedule(it); Thread.sleep(700) }
Thread.sleep(2000)
ok(['PR-2', 'PR-3', 'main'].every { queued(it)?.isBlocked() }, 'PR-2, PR-3 and main are all QUEUED while PR-1 runs')
idle()
def order = n.collect { b, num -> buildOf(b, num) }.sort { it.timeInMillis }
ok(order*.parent*.name == ['PR-1', 'PR-2', 'PR-3', 'main'], "released in queue order: ${order*.parent*.name}")
ok((1..<order.size()).every { after(order[it], order[it - 1]) }, 'each build left the queue only after the previous one finished')

// 4. A manual branch build competing with a PR build, both directions.
println '## 4. branch build vs PR build'
ctl('feature-x', 'sleep 10'); ctl('PR-2', 'sleep 3')
int f = next('feature-x'), p2 = next('PR-2')
schedule('feature-x')
waitFor('feature-x RUNNING', 60) { buildOf('feature-x', f)?.isBuilding() }
schedule('PR-2')
Thread.sleep(3000)
ok(queued('PR-2')?.isBlocked() && buildOf('PR-2', p2) == null, 'PR-2 is QUEUED while the manual feature-x build runs')
idle()
ok(after(buildOf('PR-2', p2), buildOf('feature-x', f)), 'PR-2 ran after feature-x finished')
ctl('PR-2', 'sleep 10'); ctl('feature-x', 'sleep 2')
p2 = next('PR-2'); f = next('feature-x')
schedule('PR-2')
waitFor('PR-2 RUNNING', 60) { buildOf('PR-2', p2)?.isBuilding() }
schedule('feature-x')
Thread.sleep(3000)
ok(queued('feature-x')?.isBlocked(), 'the manual feature-x build is QUEUED while PR-2 runs')
idle()
ok(after(buildOf('feature-x', f), buildOf('PR-2', p2)), 'feature-x ran after PR-2 finished')

// 5-7. The next build is released after FAILURE, ABORT and TIMEOUT of the holder.
['FAILURE': 'fail', 'ABORT': 'hang', 'TIMEOUT': 'hang'].each { outcome, mode ->
  println "## release after ${outcome}"
  ctl('PR-1', mode); ctl('PR-3', 'sleep 2')
  int a = next('PR-1'), b = next('PR-3')
  schedule('PR-1')
  waitFor('PR-1 RUNNING', 60) { buildOf('PR-1', a)?.isBuilding() }
  schedule('PR-3')
  Thread.sleep(3000)
  ok(queued('PR-3')?.isBlocked(), "PR-3 is QUEUED behind PR-1 (${outcome})")
  if (outcome == 'ABORT') {
    waitFor('PR-1 in its work stage', 30) { buildOf('PR-1', a).log.contains('QIT behavior') }
    buildOf('PR-1', a).executor.interrupt(Result.ABORTED)
  }
  idle()
  def holder = buildOf('PR-1', a)
  def expected = outcome == 'FAILURE' ? [Result.FAILURE] : [Result.ABORTED, Result.FAILURE]
  ok(holder.result in expected, "PR-1 ended ${holder.result}")
  if (outcome == 'TIMEOUT') {
    ok(holder.log.contains('Timeout has been exceeded'), 'PR-1 was stopped by the stage timeout')
  }
  ok(after(buildOf('PR-3', b), holder) && buildOf('PR-3', b).result == Result.SUCCESS, "PR-3 ran to SUCCESS after the ${outcome}")
}

// 8. Other Jenkins jobs are never held by the ParaBank dispatcher.
println '## 8. unrelated job not blocked'
ctl('PR-1', 'sleep 12')
int u = J.getItem('unrelated-job').nextBuildNumber; p1 = next('PR-1')
schedule('PR-1')
waitFor('PR-1 RUNNING', 60) { buildOf('PR-1', p1)?.isBuilding() }
J.getItem('unrelated-job').scheduleBuild2(0)
ok(waitFor('unrelated job RUNNING', 20) { J.getItem('unrelated-job').getBuildByNumber(u)?.isBuilding() }, 'an unrelated job runs while PR-1 runs')
idle()
waitFor('unrelated job done', 60) { !J.getItem('unrelated-job').isBuilding() }

// 9. Repeated triggers of one branch while busy: one queue item (no duplicate builds).
println '## 9. repeated triggers collapse'
ctl('main', 'sleep 10'); ctl('PR-2', 'sleep 2')
m1 = next('main'); p2 = next('PR-2')
schedule('main')
waitFor('main RUNNING', 60) { buildOf('main', m1)?.isBuilding() }
3.times { schedule('PR-2'); Thread.sleep(300) }
ok(queuedItems().count { it.task.name == 'PR-2' } == 1, 'three triggers of PR-2 make one queue item')
ok(queued('PR-2')?.isBlocked() && buildOf('main', m1)?.isBuilding(), 'PR-2 is QUEUED behind main')
idle()
ok(buildCount('PR-2') > 0 && buildOf('PR-2', p2 + 1) == null, 'PR-2 built once for the three triggers')

stopMonitor(monitor)
ok(monitor.violations.isEmpty(), "monitor: ${monitor.samples} samples, max RUNNING ${monitor.maxRunning}, max QUEUED ${monitor.maxQueued}, violations ${monitor.violations.take(5)}")
ok(monitor.maxRunning == 1, 'never more than one project build RUNNING')
ok(monitor.maxBlockedWithIdleExecutor >= 1, "builds stayed QUEUED while an executor was idle (up to ${monitor.maxBlockedWithIdleExecutor} at once)")
println "RESULT scenarios failures=${failures}"
