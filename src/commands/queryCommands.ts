import * as vscode from 'vscode';
import type { ChangelistManager } from '../core/ChangelistManager';

export function registerQueryCommands(
  context: vscode.ExtensionContext,
  manager: ChangelistManager,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitChangelists.getChangelists',
      () => {
        const changelists = manager.getChangelists();
        return changelists.map((cl) => ({
          id: cl.id,
          name: cl.name,
          description: cl.description,
          isDefault: cl.isDefault,
          isActive: cl.isActive,
          isDontCommit: cl.isDontCommit,
          isUnversioned: cl.isUnversioned,
          sortOrder: cl.sortOrder,
          fileCount: manager.getFileCountForChangelist(cl.id),
        }));
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitChangelists.getChangelistContents',
      (changelistId: string) => {
        if (!changelistId) {
          return undefined;
        }
        const contents = manager.getChangelistContents(changelistId);
        if (contents.size === 0) {
          return { changelistId, files: [] };
        }

        const files = Array.from(contents.values()).map((entry) => ({
          absolutePath: entry.fileChange.absolutePath,
          relativePath: entry.fileChange.relativePath,
          repoRootPath: entry.fileChange.repoRootPath,
          status: entry.fileChange.status,
          oldPath: entry.fileChange.oldPath,
          isBinary: entry.fileChange.isBinary,
          fileHeader: entry.fileHeader,
          hunks: entry.hunks.map((hunk) => ({
            id: hunk.id,
            header: hunk.header,
            oldStart: hunk.oldStart,
            oldCount: hunk.oldCount,
            newStart: hunk.newStart,
            newCount: hunk.newCount,
            contentFingerprint: hunk.contentFingerprint,
            lines: hunk.lines,
          })),
        }));

        return { changelistId, files };
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitChangelists.getAllContents',
      () => {
        const allContents = manager.getAllContents();
        const result: Record<string, Record<string, Array<{ absolutePath: string; relativePath: string; repoRootPath: string; status: string; oldPath?: string; isBinary: boolean; hunks: Array<{ id: string; header: string; oldStart: number; oldCount: number; newStart: number; newCount: number; contentFingerprint: string; lines: string[] }>; fileHeader: string }>>> = {};

        for (const [changelistId, repoMap] of allContents) {
          result[changelistId] = {};
          for (const [repoRoot, entries] of repoMap) {
            result[changelistId][repoRoot] = entries.map((entry) => ({
              absolutePath: entry.fileChange.absolutePath,
              relativePath: entry.fileChange.relativePath,
              repoRootPath: entry.fileChange.repoRootPath,
              status: entry.fileChange.status,
              oldPath: entry.fileChange.oldPath,
              isBinary: entry.fileChange.isBinary,
              hunks: entry.hunks.map((hunk) => ({
                id: hunk.id,
                header: hunk.header,
                oldStart: hunk.oldStart,
                oldCount: hunk.oldCount,
                newStart: hunk.newStart,
                newCount: hunk.newCount,
                contentFingerprint: hunk.contentFingerprint,
                lines: hunk.lines,
              })),
              fileHeader: entry.fileHeader,
            }));
          }
        }

        return result;
      },
    ),
  );
}
