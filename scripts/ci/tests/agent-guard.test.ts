// The PreToolUse guard shared by Claude Code and Codex (.agents/hooks/guard.mjs, AGENTS.md rules 6
// and 8): run as the agents run it, with the hook event on stdin; exit code 2 refuses the call.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const GUARD = path.join(ROOT, '.agents', 'hooks', 'guard.mjs');

interface Run {
  status: number | null;
  stderr: string;
}

/** Claude Code sets CLAUDE_PROJECT_DIR; Codex does not and sends the session cwd instead. */
function guard(
  agent: 'claude' | 'codex',
  toolName: string,
  toolInput: Record<string, unknown>,
  cwd = ROOT,
): Run {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  if (agent === 'claude') env.CLAUDE_PROJECT_DIR = ROOT;
  const result = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      cwd,
      tool_name: toolName,
      tool_input: toolInput,
    }),
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
  return { status: result.status, stderr: result.stderr };
}

function patch(...lines: string[]): { command: string } {
  return { command: ['*** Begin Patch', ...lines, '*** End Patch'].join('\n') };
}

function assertBlocked(run: Run, reason: string): void {
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stderr, new RegExp(reason));
  assert.match(run.stderr, /^Blocked by the project guard \(\.agents\/hooks\/guard\.mjs\)/);
}

function assertAllowed(run: Run): void {
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, '');
}

// Built at run time so this file never holds the command line the guard refuses.
const PUSH = ['git', 'push'].join(' ');

describe('agent guard: Claude Code', () => {
  it('refuses edits to infrastructure files, whatever the case or the edit tool', () => {
    assertBlocked(
      guard('claude', 'Edit', { file_path: path.join(ROOT, 'Jenkinsfile') }),
      '"jenkinsfile"',
    );
    assertBlocked(guard('claude', 'Write', { file_path: 'Compose.yaml' }), '"compose.yaml"');
    assertBlocked(
      guard('claude', 'MultiEdit', { file_path: path.join(ROOT, 'docker', 'parabank', 'x') }),
      '"docker/parabank/x"',
    );
    assertBlocked(
      guard('claude', 'Write', { file_path: '.github/workflows/new.yml' }),
      'infrastructure file',
    );
    assertBlocked(
      guard('claude', 'NotebookEdit', { notebook_path: 'jenkins/x.ipynb' }),
      'infrastructure file',
    );
  });

  it('allows edits to test code, docs and files outside the repository', () => {
    assertAllowed(guard('claude', 'Edit', { file_path: path.join(ROOT, 'docs', 'ci-cd.md') }));
    assertAllowed(guard('claude', 'Write', { file_path: 'src/pages/jenkins.page.ts' }));
    assertAllowed(guard('claude', 'Write', { file_path: path.resolve(ROOT, '..', 'Jenkinsfile') }));
  });

  it('refuses the commands reserved for the human, in Bash and PowerShell', () => {
    assertBlocked(guard('claude', 'Bash', { command: `${PUSH} origin x` }), '"git push"');
    assertBlocked(guard('claude', 'Bash', { command: 'git -C . push -u origin x' }), '"git push"');
    assertBlocked(guard('claude', 'PowerShell', { command: `cd x; ${PUSH}` }), '"git push"');
    assertBlocked(guard('claude', 'Bash', { command: 'gh pr merge 34' }), '"gh pr merge"');
    assertBlocked(guard('claude', 'Bash', { command: 'npm run uat:deploy' }), 'uat:deploy');
    assertBlocked(
      guard('claude', 'Bash', { command: 'npm run env -- deploy uat' }),
      'env -- deploy uat',
    );
    assertBlocked(
      guard('claude', 'Bash', { command: 'npx ts-node scripts/environment.ts deploy uat' }),
      'environment.ts deploy uat',
    );
  });

  it('allows ordinary commands, including ones that only mention a push', () => {
    assertAllowed(guard('claude', 'Bash', { command: 'git status --short' }));
    assertAllowed(guard('claude', 'Bash', { command: 'git log --grep push' }));
    assertAllowed(guard('claude', 'Bash', { command: 'npm run qa:health' }));
  });
});

describe('agent guard: Codex', () => {
  it('refuses apply_patch on infrastructure files (update, add, delete, move)', () => {
    assertBlocked(
      guard('codex', 'apply_patch', patch('*** Update File: Jenkinsfile', '@@', '-a', '+b')),
      '"jenkinsfile"',
    );
    assertBlocked(
      guard('codex', 'apply_patch', patch('*** Add File: .github/workflows/new.yml', '+on: push')),
      '".github/workflows/new.yml"',
    );
    assertBlocked(
      guard('codex', 'apply_patch', patch('*** Delete File: docker/ci-agent/Dockerfile')),
      '"docker/ci-agent/dockerfile"',
    );
    assertBlocked(
      guard(
        'codex',
        'apply_patch',
        patch('*** Update File: docs/notes.md', '*** Move to: jenkins/notes.md', '@@', '+x'),
      ),
      '"jenkins/notes.md"',
    );
  });

  it('refuses the first infrastructure file of a patch that also edits allowed files', () => {
    assertBlocked(
      guard(
        'codex',
        'apply_patch',
        patch('*** Update File: README.md', '@@', '+x', '*** Update File: compose.yaml', '@@'),
      ),
      '"compose.yaml"',
    );
  });

  it('resolves patch paths against the session cwd, not only the repository root', () => {
    assertBlocked(
      guard(
        'codex',
        'apply_patch',
        patch('*** Update File: ../Jenkinsfile'),
        path.join(ROOT, 'docs'),
      ),
      '"jenkinsfile"',
    );
    assertAllowed(
      guard('codex', 'apply_patch', patch('*** Update File: ci-cd.md'), path.join(ROOT, 'docs')),
    );
  });

  it('allows a patch whose text quotes the reserved commands (documentation)', () => {
    assertAllowed(
      guard(
        'codex',
        'apply_patch',
        patch(
          '*** Update File: AGENTS.md',
          '@@',
          `+Never run ${PUSH}, gh pr merge or npm run uat:deploy from an agent.`,
        ),
      ),
    );
    assertAllowed(
      guard('codex', 'apply_patch', patch('*** Add File: src/utils/x.ts', '+export {};')),
    );
  });

  it('refuses the reserved commands in its shell tool', () => {
    assertBlocked(guard('codex', 'Bash', { command: `${PUSH} origin x` }), '"git push"');
    assertBlocked(guard('codex', 'Bash', { command: 'npm run uat:deploy' }), 'uat:deploy');
    assertAllowed(guard('codex', 'Bash', { command: 'npm run test:ci' }));
  });
});
