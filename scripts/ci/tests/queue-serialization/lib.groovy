// Helpers of the queue-serialization test, prepended to every step script (run.sh). Runs inside the
// throwaway Jenkins through the CLI `groovy` command. Step scripts add no imports.
import hudson.ExtensionList
import hudson.model.*
import hudson.model.queue.QueueTaskDispatcher
import jenkins.branch.*
import jenkins.model.Jenkins
import jenkins.plugins.git.GitSCMSource
import jenkins.plugins.git.traits.BranchDiscoveryTrait
import org.jenkinsci.plugins.workflow.cps.CpsFlowDefinition
import org.jenkinsci.plugins.workflow.job.WorkflowJob
import org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject

P = 'Automacao-ParaBank-Playwright'
J = Jenkins.get()
failures = 0

def folder() { J.getItemByFullName(P) }
def job(String name) { folder()?.items?.find { it.name == name || it.displayName == name } }
def ctl(String branch, String mode) { new File('/tmp/qit/ctl').mkdirs(); new File("/tmp/qit/ctl/${branch}").text = mode }
def ok(cond, String msg) {
  cond = cond as boolean
  if (cond) { println "ok   - ${msg}" } else { println "FAIL - ${msg}"; failures++ }
}
def inProject(task) { task instanceof Job && task.parent instanceof Item && task.parent.fullName == P }
def runningBuilds() {
  def r = []
  folder().items.each { jb -> jb.builds.each { b -> if (b.isBuilding()) { r << b } } }
  r
}
def queuedItems() { J.queue.items.findAll { inProject(it.task) } }
def queued(String name) { queuedItems().find { it.task.name == name } }
// Executors (flyweight or heavyweight) working for a build of the project.
def projectExecutors() {
  def r = []
  J.computers.each { c ->
    c.allExecutors.each { e ->
      def wu = e.currentWorkUnit
      if (wu && inProject(wu.work.ownerTask)) {
        r << [job: wu.work.ownerTask.name, oneOff: e instanceof OneOffExecutor]
      }
    }
  }
  r
}
def serialDispatchers() { ExtensionList.lookup(QueueTaskDispatcher).findAll { it.getClass().getName() == 'io.github.vassilva.parabank.SerialQueueDispatcher' } }
def waitFor(String what, long timeoutSec, Closure cond) {
  long end = System.currentTimeMillis() + timeoutSec * 1000
  while (System.currentTimeMillis() < end) {
    if (cond()) { return true }
    Thread.sleep(200)
  }
  println "  (timed out after ${timeoutSec}s waiting for ${what})"
  false
}
// Idle: nothing queued, nothing RUNNING, and no executor working for the project (a build that just
// left the queue has an executor before its build record exists).
def idle() { waitFor('project idle', 300) { runningBuilds().isEmpty() && queuedItems().isEmpty() && projectExecutors().isEmpty() } }
def schedule(String name) { job(name).scheduleBuild2(0, new CauseAction(new Cause.UserIdCause())) }
def buildOf(String name, int number) { job(name)?.getBuildByNumber(number) }
def next(String name) { job(name).nextBuildNumber }
def end(Run r) { r.startTimeInMillis + r.duration }
// RUNNING intervals: the later build left the queue only after the earlier one finished.
def after(Run later, Run earlier) { later != null && earlier != null && later.timeInMillis >= end(earlier) }
def buildCount(String name) { job(name)?.builds?.size() ?: 0 }
def reindex() {
  def before = folder().computation?.timestamp?.timeInMillis ?: 0
  folder().scheduleBuild(0, new Cause.UserIdCause())
  waitFor('branch indexing', 120) {
    def c = folder().computation
    c != null && c.timestamp.timeInMillis > before && c.result != null
  }
}

// Samples Jenkins every 100 ms in the background and records any moment with two project builds
// RUNNING, or executors working for two different project jobs.
def startMonitor() {
  def m = [stop: false, samples: 0, maxRunning: 0, maxQueued: 0, maxBlockedWithIdleExecutor: 0, violations: []]
  m.thread = Thread.start {
    while (!m.stop) {
      try {
        def running = runningBuilds()
        def q = queuedItems()
        def jobsOnExecutors = projectExecutors()*.job.unique()
        m.samples++
        m.maxRunning = Math.max(m.maxRunning, running.size())
        m.maxQueued = Math.max(m.maxQueued, q.size())
        if (running.size() > 1) { m.violations << "${running*.fullDisplayName} RUNNING together" }
        if (jobsOnExecutors.size() > 1) { m.violations << "executors working for ${jobsOnExecutors}" }
        if (!q.isEmpty() && J.toComputer().countIdle() > 0) {
          m.maxBlockedWithIdleExecutor = Math.max(m.maxBlockedWithIdleExecutor, q.size())
        }
      } catch (Throwable t) {
        m.violations << "monitor error: ${t}"
      }
      Thread.sleep(100)
    }
  }
  m
}
def stopMonitor(m) { m.stop = true; m.thread.join(5000); m }
