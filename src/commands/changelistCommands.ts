import * as vscode from 'vscode';
import type { ChangelistManager } from '../core/ChangelistManager';
import type { StorageService } from '../core/StorageService';
import type { ChangelistTreeNode } from '../types/index';

export function registerChangelistCommands(
  context: vscode.ExtensionContext,
  manager: ChangelistManager,
  storage: StorageService,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitChangelists.createChangelist',
      async () => {
        const name = await vscode.window.showInputBox({
          prompt: vscode.l10n.t('Enter changelist name'),
          placeHolder: vscode.l10n.t('Enter changelist name'),
        });
        if (name) {
          manager.createChangelist(name);
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitChangelists.renameChangelist',
      async (node?: ChangelistTreeNode) => {
        if (!node || node.kind !== 'changelist') return;
        if (node.changelist.isUnversioned) {
          vscode.window.showWarningMessage(
            vscode.l10n.t('Cannot rename Unversioned Files changelist'),
          );
          return;
        }
        const newName = await vscode.window.showInputBox({
          prompt: vscode.l10n.t('Enter new name'),
          value: node.changelist.name,
        });
        if (newName) {
          manager.renameChangelist(node.changelist.id, newName);
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitChangelists.deleteChangelist',
      async (node?: ChangelistTreeNode) => {
        if (!node || node.kind !== 'changelist') return;
        const cl = node.changelist;

        if (cl.isDefault || cl.isUnversioned) {
          vscode.window.showWarningMessage(
            cl.isUnversioned
              ? vscode.l10n.t('Cannot delete Unversioned Files changelist')
              : vscode.l10n.t('Cannot delete default changelist'),
          );
          return;
        }

        const confirmDelete = vscode.workspace
          .getConfiguration('gitChangelists')
          .get<boolean>('confirmDeleteChangelist', true);

        if (confirmDelete) {
          const answer = await vscode.window.showWarningMessage(
            vscode.l10n.t(
              "Are you sure you want to delete changelist '{0}'?",
              cl.name,
            ),
            { detail: vscode.l10n.t('All files will be moved to the default changelist.') },
            vscode.l10n.t('Delete'),
            vscode.l10n.t('Cancel'),
          );
          if (answer !== vscode.l10n.t('Delete')) return;
        }

        manager.deleteChangelist(cl.id);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitChangelists.setActiveChangelist',
      (node?: ChangelistTreeNode) => {
        if (!node || node.kind !== 'changelist') return;
        manager.setActiveChangelist(node.changelist.id);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitChangelists.toggleDontCommit',
      (node?: ChangelistTreeNode) => {
        if (!node || node.kind !== 'changelist') return;
        manager.toggleDontCommit(node.changelist.id);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitChangelists.resetState',
      async () => {
        const answer = await vscode.window.showWarningMessage(
          vscode.l10n.t('This will reset all changelists and assignments to default. This cannot be undone.'),
          { modal: true },
          vscode.l10n.t('Reset'),
          vscode.l10n.t('Cancel'),
        );
        if (answer !== vscode.l10n.t('Reset')) return;
        storage.resetState();
        await manager.refresh();
        vscode.window.showInformationMessage(vscode.l10n.t('Git Changelists state has been reset.'));
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitChangelists.editDescription',
      async (node?: ChangelistTreeNode) => {
        if (!node || node.kind !== 'changelist') return;
        const currentDesc = manager.getChangelistDescription(node.changelist.id);
        const newDesc = await vscode.window.showInputBox({
          prompt: vscode.l10n.t('Enter changelist description (used as default commit message)'),
          value: currentDesc,
          placeHolder: vscode.l10n.t('Enter changelist description (used as default commit message)'),
        });
        if (newDesc !== undefined) {
          manager.setChangelistDescription(node.changelist.id, newDesc);
        }
      },
    ),
  );
}
