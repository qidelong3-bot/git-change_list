import * as vscode from 'vscode';
import type { GitExtension } from './types/git';
import { StorageService } from './core/StorageService';
import { GitService } from './git/GitService';
import { MultiRepoManager } from './git/MultiRepoManager';
import { GitRepoWatcher } from './git/GitRepoWatcher';
import { ChangelistManager } from './core/ChangelistManager';
import { ChangelistTreeProvider } from './views/ChangelistTreeProvider';
import { CommitPanelProvider } from './views/CommitPanelProvider';
import { registerChangelistCommands } from './commands/changelistCommands';
import { registerMoveCommands } from './commands/moveCommands';
import { registerCommitCommands } from './commands/commitCommands';
import { registerDiffCommands } from './commands/diffCommands';
import { registerEditorCommands } from './commands/editorCommands';

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  // 1. Initialize multi-repo manager and discover Git repos
  const repoManager = new MultiRepoManager();
  await repoManager.initialize();
  context.subscriptions.push(repoManager);

  if (repoManager.getRepos().size === 0) {
    // No repos found, still register the tree view (empty) and commands
    // so the extension doesn't crash if repos are added later
  }

  // 2. Get git binary path
  const gitPath = repoManager.getGitPath();
  const gitService = new GitService(gitPath);

  // 3. Initialize storage
  const storage = new StorageService(context);
  context.subscriptions.push({ dispose: () => storage.dispose() });

  // 4. Initialize changelist manager
  const manager = new ChangelistManager(storage, gitService, repoManager);
  context.subscriptions.push(manager);

  // 5. Create tree view
  const treeProvider = new ChangelistTreeProvider(manager, repoManager);
  context.subscriptions.push(treeProvider);

  const treeView = vscode.window.createTreeView('gitChangelists.changelists', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
    dragAndDropController: treeProvider,
    manageCheckboxStateManually: true,
  });
  context.subscriptions.push(treeView);

  // Listen to tree view selection changes to sync the selected changelist with the commit panel
  context.subscriptions.push(
    treeView.onDidChangeSelection((e) => {
      const selected = e.selection[0];
      if (selected && selected.kind === 'changelist') {
        manager.setSelectedChangelist(selected.changelist.id);
      } else if (!selected) {
        manager.setSelectedChangelist(undefined);
      }
      // If a non-changelist node is selected, keep the last changelist selection
    }),
  );

  // Handle checkbox state changes in the tree view
  context.subscriptions.push(
    treeView.onDidChangeCheckboxState((e) => {
      for (const [node, state] of e.items) {
        const checked = state === vscode.TreeItemCheckboxState.Checked;
        switch (node.kind) {
          case 'changelist':
            if (checked) {
              manager.selectAllInChangelist(node.changelist.id);
            } else {
              manager.deselectAllInChangelist(node.changelist.id);
            }
            break;
          case 'repo':
            if (checked) {
              manager.selectAllInRepo(node.changelistId, node.repoRootPath);
            } else {
              manager.deselectAllInRepo(node.changelistId, node.repoRootPath);
            }
            break;
          case 'file': {
            const filePath = node.fileChange.absolutePath;
            if (node.hunks.length <= 1) {
              manager.toggleFileSelection(filePath, checked);
            } else {
              // Multi-hunk file: toggle all hunks
              for (const hunk of node.hunks) {
                manager.toggleHunkSelection(hunk.id, checked);
              }
            }
            break;
          }
          case 'hunk':
            manager.toggleHunkSelection(node.hunk.id, checked);
            break;
        }
      }
    }),
  );

  // 5b. Create commit panel webview
  const commitPanel = new CommitPanelProvider(
    context.extensionUri,
    manager,
    gitService,
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      CommitPanelProvider.viewType,
      commitPanel,
    ),
  );
  context.subscriptions.push(commitPanel);

  // 6. Register all commands
  registerChangelistCommands(context, manager, storage);
  registerMoveCommands(context, manager, gitService, repoManager);
  registerCommitCommands(context, manager, gitService);
  registerDiffCommands(context);
  registerEditorCommands(context, manager, gitService);

  // Refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('gitChangelists.refresh', async () => {
      await manager.refresh();
    }),
  );

  // 7. Set up file watcher for auto-refresh
  const watcher = new GitRepoWatcher(repoManager);
  context.subscriptions.push(watcher);

  watcher.onDidChange(async () => {
    await manager.refresh();
  });

  watcher.start();

  // 8. Initial refresh
  await manager.refresh();
}

export function deactivate(): void {
  // All cleanup handled via disposables
}
