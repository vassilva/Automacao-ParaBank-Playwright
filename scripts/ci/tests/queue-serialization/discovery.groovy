// Branch triggering after a repository change made by run.sh (args[0] names it). Counts builds,
// runs branch indexing, waits until idle and checks which jobs were built automatically.
def phase = args[0]
println "# Discovery: ${phase}"
idle()
def names = { folder().items*.name }
def before = names().collectEntries { [(it): buildCount(it)] }
reindex()
Thread.sleep(3000)
idle()
def added = { String n -> buildCount(n) - (before[n] ?: 0) }
def cause = { String n -> job(n)?.lastBuild?.getCause(BranchIndexingCause) != null }
switch (phase) {
  case 'feature-push':
    ok(added('feature-x') == 0, 'a push to feature-x (no PR) triggers no build')
    break
  case 'merge-to-main':
    ok(added('main') == 1 && cause('main'), 'merging feature-x into main triggers exactly one main build (post-merge pipeline)')
    ok(added('feature-x') == 0, 'the merged feature-x branch is not built again')
    break
  case 'new-branch':
    ok(job('feature-y') != null && buildCount('feature-y') == 0, 'a newly discovered branch (feature-y) gets a job but no automatic build')
    break
  case 'pr-push':
    ok(added('PR-2') == 1, 'a new commit on PR-2 triggers exactly one PR-2 build')
    ok(added('main') == 0 && added('feature-x') == 0, 'and nothing else')
    break
  default:
    ok(false, "unknown phase ${phase}")
}
ok(names().findAll { it != 'PR-2' && it != 'main' }.every { added(it) == 0 }, "no other job was built: ${names().collectEntries { [(it): added(it)] }}")
println "RESULT discovery-${phase} failures=${failures}"
