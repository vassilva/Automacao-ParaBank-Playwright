// PreToolUse guard for AGENTS.md rules 6 and 8, shared by Claude Code (.claude/settings.json) and
// Codex (.codex/hooks.json): blocks edits to infrastructure files and the commands only a human may
// run. Exit code 2 refuses the tool call and tells the agent why.
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { editTargets } from './edit-targets.mjs';

const INFRA_FILES = ['jenkinsfile', 'compose.yaml'];
const INFRA_DIRS = ['docker/', 'jenkins/', '.github/'];

// Only shell tools run commands. Codex's apply_patch also carries a `command` (the patch text),
// which may quote these commands in documentation and must not be refused for it.
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

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
    `Blocked by the project guard (.agents/hooks/guard.mjs): ${reason} (AGENTS.md rules 6 and 8). Ask the human.\n`,
  );
  process.exit(2);
}

const event = JSON.parse(readFileSync(0, 'utf8'));

for (const { relative } of editTargets(event)) {
  const file = relative.toLowerCase();
  if (INFRA_FILES.includes(file) || INFRA_DIRS.some((dir) => file.startsWith(dir))) {
    refuse(`editing infrastructure file "${file}" needs explicit human approval`);
  }
}

const command = event.tool_input?.command;
if (SHELL_TOOLS.has(event.tool_name) && typeof command === 'string') {
  const forbidden = FORBIDDEN_COMMANDS.find(({ pattern }) => pattern.test(command));
  if (forbidden) refuse(`"${forbidden.name}" is reserved for the human owner`);
}
