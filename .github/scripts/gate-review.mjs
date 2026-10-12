// Decision of the required "gate-review" status (.github/workflows/gate-guard.yml). Pure function
// plus a small CLI; the workflow runs this file from main, never from the PR.
//
// Policy (docs/ci-cd.md): every merge into main is a manual merge by the repository owner (auto-merge
// is disabled for the repository; ruleset 24842741 admits changes to main only via a PR, and the
// owner is the only collaborator). A PR
// that changes a gate-defining file (.github/gate-defining-paths.json) is judged by the checks it
// modifies, so it also needs a human review:
//   - never mergeable without an owner review of the current head commit (reviewedAtHead); the
//     `gate-change-reviewed` label is set and removed by the guard to show that state;
//   - "success" only as the LAST required signal: after Jenkins passed on this exact head commit;
//   - defense in depth: "failure" while auto-merge is enabled on it, should auto-merge ever be
//     re-enabled for the repository.
// Any missing or unreadable input makes the status "failure" (fail closed).
// Ordinary PRs: "success" (the Jenkins checks still gate the merge).
import { readFileSync } from 'node:fs';
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
      description: `Owner: Files changed > Review changes > Comment, with a line "gate-reviewed" (${label} is then set)`,
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

/**
 * The human review signal for a gate-defining PR, bound to one commit: a pull request review
 * (GitHub's own record: reviewer, association, state and the commit it applies to) by the
 * repository owner, on exactly the current head, whose body has a line reading exactly
 * `gate-reviewed`. An owner can submit a "Comment" review on their own PR (GitHub refuses a
 * self-approval), so this works with a single maintainer. A new commit leaves every earlier review
 * on an older commit_id: a stale review never authorizes a newer commit. CI results are not an
 * input: passing checks never count as a review.
 * Returns undefined (fail closed in decideGateReview) when the input cannot be trusted.
 */
export function reviewedAtHead(reviews, headSha, phrase = 'gate-reviewed') {
  if (!Array.isArray(reviews) || typeof headSha !== 'string' || !/^[0-9a-f]{40}$/.test(headSha)) {
    return undefined;
  }
  // The phrase alone on a line; code formatting (`gate-reviewed`) and letter case are tolerated.
  const line = new RegExp(`^\\s*\`?${phrase}\`?\\s*$`, 'im');
  return reviews.some(
    (r) =>
      r !== null &&
      typeof r === 'object' &&
      r.commit_id === headSha &&
      (r.state === 'COMMENTED' || r.state === 'APPROVED') &&
      r.author_association === 'OWNER' &&
      typeof r.body === 'string' &&
      line.test(r.body),
  );
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

// CLI used by the workflow:
//   --reviewed-at-head <reviews.json> <head sha>  prints true, false or unknown (fail closed);
//   <json>                                         prints "state<TAB>description".
if (process.argv[1]?.endsWith('gate-review.mjs') && process.argv[2] === '--reviewed-at-head') {
  let result;
  try {
    result = reviewedAtHead(JSON.parse(readFileSync(process.argv[3], 'utf8')), process.argv[4]);
  } catch {
    result = undefined;
  }
  process.stdout.write(`${result === undefined ? 'unknown' : String(result)}\n`);
} else if (process.argv[1]?.endsWith('gate-review.mjs') && process.argv[2]) {
  const input = parseInput(process.argv[2]);
  const { state, description } = decideGateReview({ label: 'gate-change-reviewed', ...input });
  process.stdout.write(`${state}\t${description}\n`);
}
