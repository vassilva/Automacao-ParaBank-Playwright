// PreToolUse guard for AGENTS.md rules 6 and 8: blocks edits to infrastructure files and the
// commands only a human may run. Exit code 2 refuses the tool call and tells the agent why.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const INFRA_FILES = ['jenkinsfile', 'compose.yaml'];
const INFRA_DIRS = ['docker/', 'jenkins/', '.github/'];

// One command segment (no pipe, separator or newline) between the words that matter.
const SEG = '[^|;&\\n]*';
const FORBIDDEN_COMMANDS = [
  { pattern: new RegExp(`\\bnpm\\b${SEG}\\buat:deploy\\b`), name: 'npm run uat:deploy' },
  {
    pattern: new RegExp(`\\bnpm\\b${SEG}\\benv\\b${SEG}\\s--\\s${SEG}\\bdeploy\\s+uat\\b`),
    name: 'npm run env -- deploy uat',
  },
  {
    pattern: new RegExp(`scripts[\\\\/]environment(\\.ts)?${SEG}\\bdeploy\\s+uat\\b`),
    name: 'scripts/environment.ts deploy uat',
  },
  { pattern: /\bgit(\s+-[cC]\s+\S+|\s+--?[\w-]+(=\S+)?)*\s+push\b/, name: 'git push' },
  { pattern: /\bgh\s+pr\s+merge\b/, name: 'gh pr merge' },
];

function refuse(reason) {
  process.stderr.write(
    `Blocked by .claude/hooks/guard.mjs: ${reason} (AGENTS.md rules 6 and 8). Ask the human.\n`,
  );
  process.exit(2);
}

const event = JSON.parse(readFileSync(0, 'utf8'));
const input = event.tool_input ?? {};
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? event.cwd ?? process.cwd();

const target = input.file_path ?? input.notebook_path;
if (typeof target === 'string') {
  const relative = path
    .relative(projectDir, path.resolve(projectDir, target))
    .replaceAll('\\', '/')
    .toLowerCase();
  if (INFRA_FILES.includes(relative) || INFRA_DIRS.some((dir) => relative.startsWith(dir))) {
    refuse(`editing infrastructure file "${relative}" needs explicit human approval`);
  }
}

if (typeof input.command === 'string') {
  const forbidden = FORBIDDEN_COMMANDS.find(({ pattern }) => pattern.test(input.command));
  if (forbidden) refuse(`"${forbidden.name}" is reserved for the human owner`);
}
