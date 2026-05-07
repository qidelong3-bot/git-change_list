import { execFile } from 'child_process';
import { normalizePath } from '../utils/pathUtils';
import type { FileChange, FileStatus } from '../types/index';

export class GitService {
  constructor(private readonly gitPath: string) {}

  /**
   * Run a git command and return stdout.
   */
  private exec(
    args: string[],
    cwd: string,
    input?: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = execFile(
        this.gitPath,
        args,
        {
          cwd,
          maxBuffer: 50 * 1024 * 1024, // 50MB for large diffs
          timeout: 30000,
          encoding: 'utf-8',
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`git ${args[0]} failed: ${stderr || error.message}`));
          } else {
            resolve(stdout);
          }
        },
      );
      if (input && proc.stdin) {
        proc.stdin.write(input);
        proc.stdin.end();
      }
    });
  }

  /**
   * Get working tree diff against HEAD so staged and unstaged tracked changes
   * are visible in one view.
   */
  async getDiffAgainstHead(repoRoot: string): Promise<string> {
    return this.exec(['diff', 'HEAD', '--no-color', '-U3'], repoRoot);
  }

  /**
   * Get unstaged diff for a repo.
   */
  async getDiff(repoRoot: string): Promise<string> {
    return this.exec(['diff', '--no-color', '-U3'], repoRoot);
  }

  /**
   * Get staged diff for a repo.
   */
  async getDiffCached(repoRoot: string): Promise<string> {
    return this.exec(['diff', '--cached', '--no-color', '-U3'], repoRoot);
  }

  /**
   * Get working tree status as FileChange[].
   */
  async getStatus(repoRoot: string): Promise<FileChange[]> {
    const output = await this.exec(
      ['status', '--porcelain=v1', '-uall'],
      repoRoot,
    );
    const normalizedRoot = normalizePath(repoRoot);
    const changes: FileChange[] = [];

    for (const line of output.split('\n')) {
      if (!line || line.length < 4) continue;

      const xy = line.substring(0, 2);
      let filePart = line.substring(3);

      let oldPath: string | undefined;
      // Handle renames: "R  old -> new"
      const renameMatch = filePart.match(/^(.+) -> (.+)$/);
      if (renameMatch) {
        oldPath = renameMatch[1].trim();
        filePart = renameMatch[2].trim();
      }

      // Remove surrounding quotes if present
      if (filePart.startsWith('"') && filePart.endsWith('"')) {
        filePart = filePart.slice(1, -1);
      }

      const status = this.parseStatus(xy);
      const relativePath = normalizePath(filePart);
      const absolutePath = normalizePath(normalizedRoot + '/' + filePart);

      changes.push({
        absolutePath,
        relativePath,
        repoRootPath: normalizedRoot,
        status,
        oldPath: oldPath ? normalizePath(oldPath) : undefined,
        isBinary: false, // Will be updated by diff parsing
      });
    }

    return changes;
  }

  private parseStatus(xy: string): FileStatus {
    const x = xy[0];
    const y = xy[1];
    // Prioritize working tree status for our purposes
    if (y === 'M' || x === 'M') return 'M';
    if (y === 'D' || x === 'D') return 'D';
    if (x === 'A') return 'A';
    if (x === 'R') return 'R';
    if (x === 'C') return 'C';
    if (x === '?' && y === '?') return '?';
    if (x === 'U' || y === 'U') return 'U';
    return 'M';
  }

  /**
   * Apply a patch to the index (staging area).
   */
  async applyPatchToIndex(repoRoot: string, patch: string): Promise<void> {
    await this.exec(['apply', '--cached', '--unidiff-zero'], repoRoot, patch);
  }

  /**
   * Apply a patch to the working tree.
   */
  async applyPatchToWorktree(
    repoRoot: string,
    patch: string,
    reverse: boolean = false,
  ): Promise<void> {
    const args = ['apply', '--unidiff-zero'];
    if (reverse) {
      args.push('-R');
    }
    await this.exec(args, repoRoot, patch);
  }

  /**
   * Stage a file completely.
   */
  async stageFile(repoRoot: string, filePath: string): Promise<void> {
    await this.exec(['add', '--', filePath], repoRoot);
  }

  /**
   * Revert a tracked file in the working tree back to HEAD.
   */
  async restoreFile(repoRoot: string, filePath: string): Promise<void> {
    try {
      await this.exec(['restore', '--source=HEAD', '--worktree', '--', filePath], repoRoot);
    } catch {
      await this.exec(['checkout', '--', filePath], repoRoot);
    }
  }

  /**
   * Remove an untracked file from the working tree.
   */
  async cleanFile(repoRoot: string, filePath: string): Promise<void> {
    await this.exec(['clean', '-f', '--', filePath], repoRoot);
  }

  /**
   * Unstage everything (reset index).
   */
  async resetIndex(repoRoot: string): Promise<void> {
    await this.exec(['reset'], repoRoot);
  }

  /**
   * Commit staged changes.
   */
  async commit(repoRoot: string, message: string): Promise<void> {
    await this.exec(['commit', '-m', message], repoRoot);
  }

  /**
   * Push to remote.
   */
  async push(repoRoot: string): Promise<void> {
    await this.exec(['push'], repoRoot);
  }

  /**
   * Get current branch name.
   */
  async getCurrentBranch(repoRoot: string): Promise<string> {
    const output = await this.exec(
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      repoRoot,
    );
    return output.trim();
  }
}
