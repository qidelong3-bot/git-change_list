import * as vscode from 'vscode';
import type { ChangelistManager, ChangelistContentsEntry } from '../core/ChangelistManager';
import type { GitService } from '../git/GitService';
import { buildPatch } from '../core/HunkPatchBuilder';
import type { ChangelistTreeNode } from '../types/index';

export function registerCommitCommands(
  context: vscode.ExtensionContext,
  manager: ChangelistManager,
  gitService: GitService,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitChangelists.commitChangelist',
      async (node?: ChangelistTreeNode) => {
        if (!node || node.kind !== 'changelist') return;
        await commitChangelist(manager, gitService, node.changelist.id, false);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitChangelists.commitAndPushChangelist',
      async (node?: ChangelistTreeNode) => {
        if (!node || node.kind !== 'changelist') return;
        await commitChangelist(manager, gitService, node.changelist.id, true);
      },
    ),
  );
}

async function commitChangelist(
  manager: ChangelistManager,
  gitService: GitService,
  changelistId: string,
  andPush: boolean,
): Promise<void> {
  const contents = manager.getChangelistContents(changelistId);
  if (contents.size === 0) {
    vscode.window.showWarningMessage(vscode.l10n.t('No changes to commit'));
    return;
  }

  const selectedFiles = manager.getSelectedFilesForChangelist(changelistId);
  const selectedHunks = manager.getSelectedHunksForChangelist(changelistId);

  if (selectedFiles.length === 0) {
    vscode.window.showWarningMessage(vscode.l10n.t('No changes selected to commit'));
    return;
  }

  const selectedFileSet = new Set(selectedFiles);
  const selectedHunkSet = selectedHunks.length > 0 ? new Set(selectedHunks) : null;

  const defaultMessage = manager.getChangelistDescription(changelistId);

  const message = await vscode.window.showInputBox({
    prompt: vscode.l10n.t('Enter commit message'),
    placeHolder: vscode.l10n.t('Enter commit message'),
    value: defaultMessage,
  });

  if (!message) {
    return;
  }

  // Group entries by repo, filtering by selection
  const repoEntries = new Map<string, ChangelistContentsEntry[]>();
  for (const [absolutePath, entry] of contents) {
    if (!selectedFileSet.has(absolutePath)) {
      continue;
    }

    let filteredEntry = entry;
    if (selectedHunkSet && entry.hunks.length > 1) {
      const filteredHunks = entry.hunks.filter((hunk) => selectedHunkSet.has(hunk.id));
      if (filteredHunks.length === 0) {
        continue;
      }
      filteredEntry = { ...entry, hunks: filteredHunks };
    }

    const repo = filteredEntry.fileChange.repoRootPath;
    const entries = repoEntries.get(repo) || [];
    entries.push(filteredEntry);
    repoEntries.set(repo, entries);
  }

  let totalFiles = 0;

  for (const [repoRoot, entries] of repoEntries) {
    try {
      // 1. Save current index state
      let savedIndex = '';
      try {
        savedIndex = await gitService.getDiffCached(repoRoot);
      } catch {
        // No cached diff is fine
      }

      // 2. Reset index
      try {
        await gitService.resetIndex(repoRoot);
      } catch {
        // Reset might fail if nothing staged, that's ok
      }

      try {
        // 3. Stage the changelist entries
        for (const entry of entries) {
          if (entry.fileChange.status === '?') {
            // Untracked file: just add it
            await gitService.stageFile(repoRoot, entry.fileChange.relativePath);
          } else if (entry.fileChange.isBinary || !entry.fileHeader) {
            // Binary or no diff header: stage whole file
            await gitService.stageFile(repoRoot, entry.fileChange.relativePath);
          } else {
            // Build patch for selected hunks
            const patch = buildPatch(entry.fileHeader, entry.hunks);
            if (patch) {
              await gitService.applyPatchToIndex(repoRoot, patch);
            }
          }
          totalFiles++;
        }

        // 4. Commit
        await gitService.commit(repoRoot, message);

        // 5. Push if requested
        if (andPush) {
          try {
            await gitService.push(repoRoot);
          } catch (pushErr) {
            vscode.window.showErrorMessage(
              vscode.l10n.t('Push failed: {0}', String(pushErr)),
            );
          }
        }
      } catch (commitErr) {
        vscode.window.showErrorMessage(
          vscode.l10n.t('Commit failed: {0}', String(commitErr)),
        );

        // Restore index on failure
        try {
          await gitService.resetIndex(repoRoot);
        } catch {
          // Best effort
        }
      }

      // 6. Restore previously cached changes (if any)
      if (savedIndex) {
        try {
          await gitService.applyPatchToIndex(repoRoot, savedIndex);
        } catch {
          // Best effort to restore
        }
      }
    } catch (err) {
      vscode.window.showErrorMessage(
        vscode.l10n.t('Commit failed: {0}', String(err)),
      );
    }
  }

  if (totalFiles > 0) {
    const msg = andPush
      ? vscode.l10n.t('Successfully committed and pushed {0} file(s)', totalFiles)
      : vscode.l10n.t('Successfully committed {0} file(s)', totalFiles);
    vscode.window.showInformationMessage(msg);
  }

  // Clear selection for the committed changelist
  manager.clearSelectionForChangelist(changelistId);

  // Refresh state
  await manager.refresh();
}
