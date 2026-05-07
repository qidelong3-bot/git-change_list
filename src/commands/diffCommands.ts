import * as vscode from 'vscode';
import type { ChangelistTreeNode } from '../types/index';

export function registerDiffCommands(
  context: vscode.ExtensionContext,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitChangelists.openDiff',
      async (node?: ChangelistTreeNode) => {
        if (!node) return;

        let fileUri: vscode.Uri;
        let line: number | undefined;

        if (node.kind === 'file') {
          fileUri = vscode.Uri.file(node.fileChange.absolutePath);
        } else if (node.kind === 'hunk') {
          fileUri = vscode.Uri.file(node.fileChange.absolutePath);
          line = node.hunk.newStart;
        } else {
          return;
        }

        // Try to use git's diff view
        try {
          const gitUri = toGitUri(fileUri, 'HEAD');
          const title = `${fileUri.path.split('/').pop()} (Working Tree)`;
          await vscode.commands.executeCommand(
            'vscode.diff',
            gitUri,
            fileUri,
            title,
          );

          // If hunk, scroll to the line
          if (line !== undefined) {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
              const position = new vscode.Position(Math.max(0, line - 1), 0);
              editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter,
              );
            }
          }
        } catch {
          // Fallback: just open the file
          const doc = await vscode.workspace.openTextDocument(fileUri);
          const editor = await vscode.window.showTextDocument(doc);
          if (line !== undefined) {
            const position = new vscode.Position(Math.max(0, line - 1), 0);
            editor.revealRange(
              new vscode.Range(position, position),
              vscode.TextEditorRevealType.InCenter,
            );
          }
        }
      },
    ),
  );
}

/**
 * Create a git: URI that VS Code's built-in git extension can resolve.
 */
function toGitUri(uri: vscode.Uri, ref: string): vscode.Uri {
  const params = JSON.stringify({ path: uri.fsPath, ref });
  return uri.with({ scheme: 'git', path: uri.path, query: params });
}
