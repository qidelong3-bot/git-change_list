import * as path from 'path';

/**
 * Normalize a file path for consistent comparison:
 * - Convert backslashes to forward slashes
 * - Lowercase drive letter on Windows
 */
export function normalizePath(p: string): string {
  let normalized = p.replace(/\\/g, '/');
  // Lowercase Windows drive letter: C:/... -> c:/...
  if (/^[A-Z]:\//.test(normalized)) {
    normalized = normalized[0].toLowerCase() + normalized.slice(1);
  }
  return normalized;
}

/**
 * Get relative path from a repo root to a file, normalized.
 */
export function getRelativePath(repoRoot: string, filePath: string): string {
  const rel = path.relative(repoRoot, filePath);
  return normalizePath(rel);
}

/**
 * Extract the directory/repo name from a root path.
 */
export function getRepoName(repoRoot: string): string {
  const normalized = normalizePath(repoRoot);
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

/**
 * Generate a stable color index (0-9) for a repository name.
 */
export function getRepoColorIndex(repoName: string): number {
  let hash = 0;
  for (let i = 0; i < repoName.length; i++) {
    hash = ((hash << 5) - hash) + repoName.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 10;
}
