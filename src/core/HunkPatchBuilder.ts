import { Hunk } from '../types/index';

/**
 * Build a valid unified diff patch from a file header and selected hunks.
 * The resulting patch can be applied with `git apply --cached`.
 */
export function buildPatch(fileHeader: string, hunks: Hunk[]): string {
  if (hunks.length === 0) {
    return '';
  }

  // Sort hunks by their original position (oldStart) to maintain order
  const sorted = [...hunks].sort((a, b) => a.oldStart - b.oldStart);

  const parts: string[] = [fileHeader];

  for (const hunk of sorted) {
    parts.push(hunk.header);
    parts.push(...hunk.lines);
  }

  // Ensure trailing newline - git apply requires it
  let patch = parts.join('\n');
  if (!patch.endsWith('\n')) {
    patch += '\n';
  }

  return patch;
}

/**
 * Build patches for multiple files, grouped by repo.
 * Returns a map of repoRoot -> combined patch string.
 */
export function buildPatchesForCommit(
  entries: Array<{
    fileHeader: string;
    hunks: Hunk[];
    repoRootPath: string;
  }>,
): Map<string, string> {
  const repoPatches = new Map<string, string[]>();

  for (const entry of entries) {
    const patch = buildPatch(entry.fileHeader, entry.hunks);
    if (!patch) continue;

    const existing = repoPatches.get(entry.repoRootPath) || [];
    existing.push(patch);
    repoPatches.set(entry.repoRootPath, existing);
  }

  const result = new Map<string, string>();
  for (const [repo, patches] of repoPatches) {
    result.set(repo, patches.join(''));
  }

  return result;
}
