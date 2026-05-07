import * as vscode from 'vscode';
import type { ChangelistManager } from '../core/ChangelistManager';
import type { GitService } from '../git/GitService';
import type { ChangelistTreeNode } from '../types/index';
import { buildPatch } from '../core/HunkPatchBuilder';

class ChangelistCodeLensProvider
  implements vscode.CodeLensProvider, vscode.Disposable
{
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly manager: ChangelistManager) {
    this.disposables.push(
      this.manager.onDidChangeState(() => this.emitter.fire()),
      vscode.workspace.onDidChangeTextDocument(() => this.emitter.fire()),
      vscode.window.onDidChangeActiveTextEditor(() => this.emitter.fire()),
    );
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const diff = this.manager.getDiffForFile(document.uri.fsPath);
    if (!diff) {
      return [];
    }

    return diff.hunks.map((hunk) => {
      const assignment = this.manager.getAssignmentForHunk(hunk.id);
      const changelist = assignment
        ? this.manager.getChangelistById(assignment.changelistId)
        : undefined;
      const title = changelist
        ? `Changelist: ${changelist.name}`
        : 'Move to Changelist';

      return new vscode.CodeLens(
        new vscode.Range(
          Math.max(0, hunk.newStart - 1),
          0,
          Math.max(0, hunk.newStart - 1),
          0,
        ),
        {
          title,
          tooltip: 'Switch changelist for this change block',
          command: 'gitChangelists.switchChangelistForLine',
          arguments: [document.uri, hunk.newStart],
        },
      );
    });
  }

  dispose(): void {
    this.emitter.dispose();
    this.disposables.forEach((disposable) => disposable.dispose());
  }
}

export function registerEditorCommands(
  context: vscode.ExtensionContext,
  manager: ChangelistManager,
  gitService: GitService,
): void {
  const codeLensProvider = new ChangelistCodeLensProvider(manager);
  context.subscriptions.push(codeLensProvider);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [{ scheme: 'file' }],
      codeLensProvider,
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitChangelists.switchChangelistForLine',
      async (uri?: vscode.Uri, line?: number) => {
        const editor = vscode.window.activeTextEditor;
        const targetUri = uri || editor?.document.uri;
        const targetLine =
          line ||
          (editor ? editor.selection.active.line + 1 : undefined);

        if (!targetUri || !targetLine) {
          return;
        }

        const located = manager.findHunkAtLine(targetUri.fsPath, targetLine);
        if (!located?.assignment) {
          return;
        }

        const targetChangelistId = await pickTargetChangelist(
          manager,
          located.assignment.changelistId,
        );
        if (!targetChangelistId) {
          return;
        }

        await manager.moveHunkToChangelist(located.hunk.id, targetChangelistId);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitChangelists.openSource',
      async (node?: ChangelistTreeNode) => {
        if (!node) {
          return;
        }

        let filePath: string | undefined;
        let line: number | undefined;
        if (node.kind === 'file') {
          filePath = node.fileChange.absolutePath;
          line = node.hunks[0]?.newStart;
        } else if (node.kind === 'hunk') {
          filePath = node.fileChange.absolutePath;
          line = node.hunk.newStart;
        }

        if (!filePath) {
          return;
        }

        const document = await vscode.workspace.openTextDocument(
          vscode.Uri.file(filePath),
        );
        const editor = await vscode.window.showTextDocument(document);
        if (line !== undefined) {
          const position = new vscode.Position(Math.max(0, line - 1), 0);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter,
          );
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitChangelists.revertChange',
      async (node?: ChangelistTreeNode) => {
        if (!node || (node.kind !== 'file' && node.kind !== 'hunk')) {
          return;
        }

        const title = node.kind === 'file' ? node.fileChange.relativePath : node.hunk.header;
        const answer = await vscode.window.showWarningMessage(
          node.kind === 'file'
            ? vscode.l10n.t("Revert changes in '{0}'?", title)
            : vscode.l10n.t('Revert the selected change block?'),
          { modal: true },
          vscode.l10n.t('Revert'),
          vscode.l10n.t('Cancel'),
        );
        if (answer !== vscode.l10n.t('Revert')) {
          return;
        }

        try {
          if (node.kind === 'file') {
            if (node.fileChange.status === '?') {
              await gitService.cleanFile(
                node.fileChange.repoRootPath,
                node.fileChange.relativePath,
              );
            } else {
              await gitService.restoreFile(
                node.fileChange.repoRootPath,
                node.fileChange.relativePath,
              );
            }
          } else {
            const patch = buildPatch(node.fileHeader, [node.hunk]);
            if (!patch) {
              vscode.window.showWarningMessage(
                vscode.l10n.t('This change block cannot be reverted'),
              );
              return;
            }
            await gitService.applyPatchToWorktree(
              node.fileChange.repoRootPath,
              patch,
              true,
            );
          }

          await manager.refresh();
        } catch (error) {
          vscode.window.showErrorMessage(
            vscode.l10n.t('Revert failed: {0}', String(error)),
          );
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
    .filter((changelist) => changelist.id !== excludeId);

  if (changelists.length === 0) {
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    changelists.map((changelist) => ({
      label: changelist.name,
      description: changelist.isActive ? '$(check) Active' : '',
      id: changelist.id,
    })),
    {
      placeHolder: 'Select target changelist',
    },
  );

  return picked?.id;
}
