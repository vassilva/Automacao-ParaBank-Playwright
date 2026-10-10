// Decision of the required "gate-review" status (.github/workflows/gate-guard.yml). Pure function
// plus a small CLI; the workflow runs this file from main, never from the PR.
//
// Policy (docs/ci-cd.md): a PR that changes a gate-defining file (.github/gate-defining-paths.json)
// is judged by the checks it modifies, so it needs a human review AND a human merge:
//   - never mergeable while auto-merge is enabled on it (auto-merge must not be the action that
//     merges it, even after review);
//   - never mergeable without the review label;
//   - "success" only as the LAST required signal: after Jenkins passed on this exact head commit,
//     with the label present and auto-merge off. GitHub refuses to enable auto-merge on a PR that
//     is already mergeable, so from then on only a human merge is possible.
// Any missing or unreadable input makes the status "failure" (fail closed).
// Ordinary PRs: "success" (auto-merge stays available; Jenkins checks still gate the merge).
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
