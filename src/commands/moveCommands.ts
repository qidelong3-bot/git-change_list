import * as vscode from 'vscode';
import { normalizePath } from '../utils/pathUtils';
import type { ChangelistManager } from '../core/ChangelistManager';
import type { GitService } from '../git/GitService';
import type { MultiRepoManager } from '../git/MultiRepoManager';
import type { ChangelistTreeNode } from '../types/index';

export function registerMoveCommands(
  context: vscode.ExtensionContext,
  manager: ChangelistManager,
  gitService: GitService,
  repoManager: MultiRepoManager,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitChangelists.moveFileToChangelist',
      async (node?: ChangelistTreeNode) => {
        if (!node || node.kind !== 'file') return;

        const targetCl = await pickTargetChangelist(manager, node.changelistId);
        if (targetCl) {
          await manager.moveFileToChangelist(
            node.fileChange.absolutePath,
            targetCl,
          );
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitChangelists.moveHunkToChangelist',
      async (node?: ChangelistTreeNode) => {
        if (!node || node.kind !== 'hunk') return;

        const targetCl = await pickTargetChangelist(manager, node.changelistId);
        if (targetCl) {
          await manager.moveHunkToChangelist(node.hunk.id, targetCl);
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitChangelists.moveAllToChangelist',
      async (node?: ChangelistTreeNode) => {
        if (!node || node.kind !== 'changelist') return;

        const targetCl = await pickTargetChangelist(
          manager,
          node.changelist.id,
        );
        if (targetCl) {
          await manager.moveAllToChangelist(node.changelist.id, targetCl);
        }
      },
    ),
  );

  // Add file(s) to git (git add) from the Explorer context menu
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitChangelists.addFileToGit',
      async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
        // Support multi-selection: VS Code passes all selected uris as the second arg
        const targets: vscode.Uri[] = [];
        if (uris && uris.length > 0) {
          targets.push(...uris);
        } else if (uri) {
          targets.push(uri);
        }
        if (targets.length === 0) return;

        let addedCount = 0;
        const errors: string[] = [];

        for (const fileUri of targets) {
          const filePath = normalizePath(fileUri.fsPath);
          const repoInfo = repoManager.getRepoForFile(filePath);
          if (!repoInfo) {
            errors.push(vscode.l10n.t('File is not inside a git repository: {0}', filePath));
            continue;
          }
          // Calculate relative path from repo root
          const relativePath = filePath.startsWith(repoInfo.rootPath + '/')
            ? filePath.slice(repoInfo.rootPath.length + 1)
            : filePath;
          try {
            await gitService.stageFile(repoInfo.rootPath, relativePath);
            addedCount++;
          } catch (err) {
            errors.push(String(err));
          }
        }

        if (errors.length > 0) {
          vscode.window.showErrorMessage(errors.join('\n'));
        }
        if (addedCount > 0) {
          vscode.window.showInformationMessage(
            vscode.l10n.t('Added {0} file(s) to git', addedCount),
          );
          await manager.refresh();
        }
      },
    ),
  );
}

async function pickTargetChangelist(
  manager: ChangelistManager,
  excludeId: string,
): Promise<string | undefined> {
  const changelists = manager
    .getChangelists()
    .filter((cl) => cl.id !== excludeId);

  if (changelists.length === 0) return undefined;

  const items = changelists.map((cl) => ({
    label: cl.name,
    description: cl.isActive
      ? '$(check) Active'
      : cl.isDontCommit
        ? vscode.l10n.t("Don't Commit")
        : '',
    id: cl.id,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: vscode.l10n.t('Select target changelist'),
  });

  return picked?.id;
}
