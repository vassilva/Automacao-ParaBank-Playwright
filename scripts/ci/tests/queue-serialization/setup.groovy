// Creates the Multibranch project (same full name as the real one) on the local fixture repository,
// with the branch property strategy proposed for the real job: only main and PR-<n> are triggered
// automatically; every other branch can only be built manually. Plus one unrelated job.
// The first indexing builds main and the PR-* branches WITHOUT the dispatcher: the negative control.

println '# Setup and negative control (no queue dispatcher)'
ok(serialDispatchers().isEmpty(), 'no serial-queue dispatcher is registered yet')
['main', 'PR-1', 'PR-2', 'PR-3'].each { ctl(it, 'sleep 12') }

def project = J.createProject(WorkflowMultiBranchProject, P)
def source = new GitSCMSource('file:///tmp/qit/repo.git')
source.setTraits([new BranchDiscoveryTrait()])
def property = new NoTriggerBranchProperty()
property.setTriggeredBranchesRegex('main|PR-\\d+')
property.setStrategy(NoTriggerMultiBranchQueueDecisionHandler.SuppressionStrategy.NONE)
def branchSource = new BranchSource(source)
branchSource.setStrategy(new DefaultBranchPropertyStrategy([property] as BranchProperty[]))
project.getSourcesList().add(branchSource)
project.save()

def other = J.createProject(WorkflowJob, 'unrelated-job')
other.setDefinition(new CpsFlowDefinition("node { sh 'sleep 6' }", true))
other.save()

def monitor = startMonitor()
reindex()
waitFor('initial builds RUNNING', 60) { runningBuilds().size() >= 2 }
idle()
stopMonitor(monitor)
ok(monitor.maxRunning >= 2, "without the dispatcher, ${monitor.maxRunning} project builds were RUNNING together (problem reproduced)")
ok(['main', 'PR-1', 'PR-2', 'PR-3'].every { buildCount(it) == 1 }, 'indexing built main and PR-1..3 once each')
ok(job('feature-x') != null && buildCount('feature-x') == 0, 'feature-x was discovered but not built (not main or PR-<n>)')
println "RESULT setup failures=${failures}"
