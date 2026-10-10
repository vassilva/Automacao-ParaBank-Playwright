/**
 * Executable model of the Jenkinsfile for tests: stages in file order, each with its own `when`
 * expression (evaluated as written, Groovy == / != mapped to JS), the flags each stage sets, and
 * the nesting of the UAT Deployment sub-stages. Stage failures, approval answers, head moves and
 * the application-image decision are injected. A model, not Jenkins: real Jenkins runs are the
 * evidence for runtime behavior (docs/ci-cd.md, Validation status).
 */
import { readFileSync } from 'node:fs';

interface Stage {
  name: string;
  when: string | null;
  sets: string[];
}

export interface Injection {
  fail?: string;
  skip?: string;
  appImage?: 'REUSE' | 'DEPLOY' | 'BUILD';
  approval?: 'approve' | 'reject' | 'timeout' | 'unauthorized' | 'superseded';
  headMovedBeforeVerify?: boolean;
}

export interface Run {
  result: string;
  ran: string[];
}

const UAT_SUBSTAGES = [
  'UAT Workspace Guard',
  'UAT Install',
  'UAT Host Lock',
  'Verify Approved Image',
  'Promote to UAT',
  'UAT Ready',
  'UAT Smoke',
  'Known Defects',
  'Deployment Record',
];

export function loadStages(file = 'Jenkinsfile'): {
  stages: Stage[];
  required: Record<string, string[]>;
} {
  const src = readFileSync(file, 'utf8');
  const stages: Stage[] = [];
  const re = /stage\('([^']+)'\)\s*\{([\s\S]*?)(?=\n\s*stage\('|\n\s*post \{|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const body = m[2] ?? '';
    const w = /when \{[\s\S]*?expression \{ ([^\n]+) \}\n/.exec(body);
    stages.push({
      name: m[1] ?? '',
      when: w?.[1] ?? null,
      sets: [...body.matchAll(/env\.(\w+) = '(true)'/g)].map((x) => x[1] ?? ''),
    });
  }
  const table = /def required = \[([\s\S]*?)\]\[env\.PIPELINE_ROLE\]/.exec(src)?.[1] ?? '';
  const required: Record<string, string[]> = {};
  for (const row of table.matchAll(/'(\w+)'\s*:\s*\[([^\]]*)\]/g)) {
    required[row[1] ?? ''] = [...(row[2] ?? '').matchAll(/'(\w+)'/g)].map((x) => x[1] ?? '');
  }
  return { stages, required };
}

/** Mirrors Build Context (role, plan flags). */
function context(branch: string, changeId: string | null): Record<string, string> {
  const env: Record<string, string> = { BRANCH_NAME: branch };
  if (changeId) env.CHANGE_ID = changeId;
  env.BUILD_MODE = changeId ? 'PULL REQUEST' : branch === 'main' ? 'MAIN' : 'PUSH';
  env.PIPELINE_ROLE =
    env.BUILD_MODE === 'PUSH'
      ? branch.startsWith('qa/')
        ? 'QA'
        : branch.startsWith('config/')
          ? 'CONFIGURATOR'
          : 'DEVELOPER'
      : env.BUILD_MODE === 'MAIN'
        ? 'CD'
        : 'CI';
  env.DEPLOYS_QA = env.PIPELINE_ROLE === 'CONFIGURATOR' ? 'false' : 'true';
  env.RUNS_SMOKE =
    env.BUILD_MODE === 'PULL REQUEST' || env.PIPELINE_ROLE === 'DEVELOPER' ? 'true' : 'false';
  env.RUNS_IMPACTED =
    env.BUILD_MODE === 'PULL REQUEST' || env.PIPELINE_ROLE === 'QA' ? 'true' : 'false';
  return env;
}

export function simulate(branch: string, changeId: string | null, inject: Injection = {}): Run {
  const { stages, required } = loadStages();
  const env = context(branch, changeId);
  const params = { ADDITIONAL_QA_SUITE: 'none', RUN_KNOWN_DEFECTS: false };
  const ran: string[] = [];
  let parentRuns = true;
  for (const s of stages) {
    const expr = s.when?.replace(/==/g, '===').replace(/!=(?!=)/g, '!==');
    // The model evaluates the Jenkinsfile's own `when` expressions (repository content, not input).
    let go = expr
      ? // eslint-disable-next-line @typescript-eslint/no-implied-eval
        (Function('env', 'params', `return (${expr});`) as (e: unknown, p: unknown) => boolean)(
          env,
          params,
        )
      : true;
    if (UAT_SUBSTAGES.includes(s.name) && !parentRuns) go = false;
    if (s.name === 'UAT Deployment') parentRuns = go;
    if (inject.skip === s.name) go = false;
    if (!go) continue;
    ran.push(s.name);
    if (inject.fail === s.name) return { result: `FAILURE at ${s.name}`, ran };
    if (s.name === 'Resolve Application Image') env.APP_IMAGE_ACTION = inject.appImage ?? 'BUILD';
    if (
      s.name === 'QA Gate' &&
      ((env.RUNS_SMOKE === 'true' && env.QA_SMOKE_PASSED !== 'true') ||
        (env.RUNS_IMPACTED === 'true' && env.QA_IMPACTED_PASSED !== 'true'))
    ) {
      return { result: 'FAILURE at QA Gate', ran };
    }
    if (s.name === 'Validation Complete') {
      const req = required[env.PIPELINE_ROLE ?? ''];
      const missing = req ? req.filter((f) => env[f] !== 'true') : ['(no plan)'];
      if (
        !req ||
        (env.BUILD_MODE === 'PULL REQUEST' && env.PIPELINE_ROLE !== 'CI') ||
        missing.length
      ) {
        return { result: `FAILURE at Validation Complete (${missing.join(',')})`, ran };
      }
    }
    if (s.name === 'UAT Approval') {
      const a = inject.approval ?? 'approve';
      if (a === 'unauthorized') return { result: 'FAILURE (approver not allowed)', ran };
      if (a === 'reject' || a === 'timeout') return { result: `ABORTED (${a})`, ran };
      if (a === 'superseded') return { result: 'NOT_BUILT (superseded at approval)', ran };
      env.UAT_APPROVED = 'true';
    }
    if (s.name === 'Verify Approved Image' && inject.headMovedBeforeVerify) {
      return { result: 'ABORTED (SUPERSEDED)', ran };
    }
    for (const f of s.sets) env[f] = 'true';
  }
  return { result: 'SUCCESS', ran };
}
