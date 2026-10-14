// Throwaway drill only: mirror the live security model once (first boot), then leave config.xml
// alone so later restarts keep whatever strategy the drill applies.
import jenkins.model.Jenkins
import jenkins.model.JenkinsLocationConfiguration
import hudson.security.HudsonPrivateSecurityRealm
import hudson.security.FullControlOnceLoggedInAuthorizationStrategy

def marker = new File(Jenkins.get().rootDir, 'drill-initialized')
if (marker.exists()) return

def realm = new HudsonPrivateSecurityRealm(false)
realm.createAccount('viamerico', System.getenv('PW_OWNER'))
realm.createAccount('admin', System.getenv('PW_ADMIN'))
realm.createAccount('reader', System.getenv('PW_READER'))
def j = Jenkins.get()
j.setSecurityRealm(realm)
def strategy = new FullControlOnceLoggedInAuthorizationStrategy()
strategy.setAllowAnonymousRead(false)
j.setAuthorizationStrategy(strategy)
j.save()
JenkinsLocationConfiguration.get().setUrl('http://localhost:8080/')
marker.text = 'done'
