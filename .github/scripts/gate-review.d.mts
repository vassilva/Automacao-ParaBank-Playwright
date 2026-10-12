// Types for gate-review.mjs (used by scripts/ci/tests/gate-review.test.ts).
export interface GateReviewInput {
  gateDefining?: boolean;
  reviewed?: boolean;
  autoMergeEnabled?: boolean;
  jenkinsPassed?: boolean;
  label: string;
}
export interface GateReviewDecision {
  state: 'success' | 'failure' | 'pending';
  description: string;
}
export function decideGateReview(input: GateReviewInput): GateReviewDecision;
export function gateDefiningPaths(patterns: string[], changedPaths: string[]): string[];
export function reviewedAtHead(
  reviews: unknown,
  headSha: unknown,
  phrase?: string,
): boolean | undefined;
