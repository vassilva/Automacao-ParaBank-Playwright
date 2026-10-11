// The plugin is deployed, active, and its dispatcher is registered, before any scenario runs.
println '# Plugin check'
def plugin = J.pluginManager.getPlugin('parabank-serial-queue')
ok(plugin != null && plugin.isActive() && plugin.isEnabled(), "plugin parabank-serial-queue ${plugin?.version} is installed, enabled and active (deployed without a restart)")
ok(plugin?.dependencies?.isEmpty(), "it depends on no other plugin: ${plugin?.dependencies*.shortName}")
ok(serialDispatchers().size() == 1, 'exactly one SerialQueueDispatcher is registered')
ok(serialDispatchers()[0]?.projects == [P] as Set, "it serializes ${serialDispatchers()[0]?.projects}")
println "RESULT plugin-check failures=${failures}"
