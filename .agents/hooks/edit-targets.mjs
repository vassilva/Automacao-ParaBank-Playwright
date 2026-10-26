// The files a tool call edits, for the hooks shared by Claude Code and Codex. Claude Code names one
// file (`file_path`, `notebook_path`); Codex edits through `apply_patch`, whose only input is the
// patch text, so its targets are read from the patch's file headers.
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// The repository root: this file lives in <root>/.agents/hooks/.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const PATCH_HEADER = /^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/gm;

/** Each edited file, repository-relative with forward slashes; files outside the repository are left out. */
export function editTargets(event) {
  const input = event.tool_input ?? {};
  const projectDir = process.env.CLAUDE_PROJECT_DIR || ROOT;
  const base = event.cwd || projectDir;
  const targets = [];
  for (const file of [input.file_path, input.notebook_path]) {
    if (typeof file === 'string') targets.push({ file, deleted: false });
  }
  if (event.tool_name === 'apply_patch' && typeof input.command === 'string') {
    for (const [, header, file] of input.command.matchAll(PATCH_HEADER)) {
      targets.push({ file: file.trim(), deleted: header === 'Delete File' });
    }
  }
  return targets
    .map(({ file, deleted }) => ({
      relative: path.relative(projectDir, path.resolve(base, file)).replaceAll('\\', '/'),
      absolute: path.resolve(base, file),
      deleted,
    }))
    .filter(
      ({ relative }) =>
        relative !== '..' && !relative.startsWith('../') && !path.isAbsolute(relative),
    );
}
