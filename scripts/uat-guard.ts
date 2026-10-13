/**
 * UAT changes outside the approved path (scripts/environment.ts). UAT receives an image only from a
 * `main` build after its manual UAT Approval (Jenkinsfile, docs/ci-cd.md): the Jenkinsfile sets
 * UAT_APPROVER once an authorized user approved, and Jenkins exports it to the later steps. Any other
 * `deploy uat`, or a `teardown uat` that removes the environment, is refused unless the repository
 * owner explicitly takes the break-glass path (PARABANK_UAT_BREAK_GLASS=owner), e.g. the documented
 * rollback.
 *
 * This prevents accidental and automated UAT changes (a local `npm run uat:deploy`, a script, an AI
 * agent). It is NOT a security boundary: whoever can reach the Docker daemon can change UAT with
 * `docker compose` directly. The boundary is Docker and Jenkins access (docs/ci-cd.md, "UAT changes
 * outside Jenkins").
 */

export const BREAK_GLASS_VARIABLE = 'PARABANK_UAT_BREAK_GLASS';
const BREAK_GLASS_VALUE = 'owner';

export type UatGuardDecision =
  | { allowed: true; via: 'not-a-uat-change' | 'jenkins-approval' | 'owner-break-glass' }
  | { allowed: false; reason: string };

/** Whether this command changes UAT, and if so whether this process may do it. */
export function uatGuard(
  command: string,
  environment: string,
  options: { keepRunning?: boolean },
  env: NodeJS.ProcessEnv,
): UatGuardDecision {
  const changesUat =
    environment === 'uat' &&
    (command === 'deploy' || (command === 'teardown' && !options.keepRunning));
  if (!changesUat) return { allowed: true, via: 'not-a-uat-change' };

  // A Jenkins build (BUILD_TAG is set in every build step) whose UAT Approval stage recorded an approver.
  if (env.BUILD_TAG?.trim() && env.UAT_APPROVER?.trim()) {
    return { allowed: true, via: 'jenkins-approval' };
  }
  if (env[BREAK_GLASS_VARIABLE] === BREAK_GLASS_VALUE) {
    return { allowed: true, via: 'owner-break-glass' };
  }
  return {
    allowed: false,
    reason:
      `REFUSED: "${command} uat" changes UAT outside the approved path. UAT receives an image only ` +
      'from a main build after its manual UAT Approval in Jenkins (docs/ci-cd.md). Repository owner ' +
      `only, for the documented rollback or recovery: set ${BREAK_GLASS_VARIABLE}=${BREAK_GLASS_VALUE} ` +
      'for that one command.',
  };
}
