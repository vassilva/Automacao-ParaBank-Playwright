// Decision of the required "gate-review" status (.github/workflows/gate-guard.yml). Pure function
// plus a small CLI; the workflow runs this file from main, never from the PR.
//
// Policy (docs/ci-cd.md): every merge into main is a manual merge by the repository owner (auto-merge
// is disabled for the repository; a "restrict updates" ruleset admits only admins, via a PR). A PR
// that changes a gate-defining file (.github/gate-defining-paths.json) is judged by the checks it
// modifies, so it also needs a human review:
//   - never mergeable without the review label;
//   - "success" only as the LAST required signal: after Jenkins passed on this exact head commit;
//   - defense in depth: "failure" while auto-merge is enabled on it, should auto-merge ever be
//     re-enabled for the repository.
// Any missing or unreadable input makes the status "failure" (fail closed).
// Ordinary PRs: "success" (the Jenkins checks still gate the merge).
import process from 'node:process';

/**
 * @param {{
 *   gateDefining: boolean | undefined,
 *   reviewed: boolean | undefined,
 *   autoMergeEnabled: boolean | undefined,
 *   jenkinsPassed: boolean | undefined,
 *   label: string,
 * }} input
 * @returns {{ state: 'success' | 'failure' | 'pending', description: string }}
 */
export function decideGateReview({
  gateDefining,
  reviewed,
  autoMergeEnabled,
  jenkinsPassed,
  label,
}) {
  const known = (v) => typeof v === 'boolean';
  if (
    !known(gateDefining) ||
    !known(reviewed) ||
    !known(autoMergeEnabled) ||
    !known(jenkinsPassed)
  ) {
    return {
      state: 'failure',
      description: 'Guard could not read the PR state; blocked (fail closed)',
    };
  }
  if (!gateDefining) return { state: 'success', description: 'No gate-defining file changed' };
  if (autoMergeEnabled) {
    return {
      state: 'failure',
      description: 'Gate-defining change: auto-merge not allowed; disable it and merge manually',
    };
  }
  if (!reviewed) {
    return {
      state: 'failure',
      description: `Gate-defining change: needs human review (label ${label})`,
    };
  }
  if (!jenkinsPassed) {
    return {
      state: 'pending',
      description: 'Reviewed; waiting for Jenkins on this commit, then merge manually',
    };
  }
  return { state: 'success', description: 'Gate-defining change reviewed; merge manually' };
}

/** Gate-defining paths among the changed ones, with main's pattern list. */
export function gateDefiningPaths(patterns, changedPaths) {
  const regexes = patterns.map((p) => new RegExp(p));
  return changedPaths.filter((f) => regexes.some((r) => r.test(f)));
}

/** Unparseable input yields an empty object, which decideGateReview() fails closed on. */
function parseInput(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// CLI used by the workflow: reads a JSON object from argv[2], prints "state<TAB>description".
if (process.argv[1]?.endsWith('gate-review.mjs') && process.argv[2]) {
  const input = parseInput(process.argv[2]);
  const { state, description } = decideGateReview({ label: 'gate-change-reviewed', ...input });
  process.stdout.write(`${state}\t${description}\n`);
}
