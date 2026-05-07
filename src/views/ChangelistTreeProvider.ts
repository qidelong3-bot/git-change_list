import * as vscode from 'vscode';
import type { ChangelistManager, ChangelistContentsEntry } from '../core/ChangelistManager';
import type { MultiRepoManager } from '../git/MultiRepoManager';
import type { ChangelistTreeNode, FileNode } from '../types/index';
import {
  createChangelistTreeItem,
  createRepoTreeItem,
  createFileTreeItem,
  createHunkTreeItem,
} from './TreeItems';
import { getRepoName, getRepoColorIndex } from '../utils/pathUtils';

const DRAG_MIME = 'application/vnd.code.tree.gitchangelists';

export class ChangelistTreeProvider
  implements
    vscode.TreeDataProvider<ChangelistTreeNode>,
    vscode.TreeDragAndDropController<ChangelistTreeNode>,
    vscode.Disposable
{
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<ChangelistTreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly disposables: vscode.Disposable[] = [];

  // --- TreeDragAndDropController ---
  readonly dropMimeTypes = [DRAG_MIME];
  readonly dragMimeTypes = [DRAG_MIME];

  constructor(
    private readonly manager: ChangelistManager,
    private readonly repoManager: MultiRepoManager,
  ) {
    this.disposables.push(
      this.manager.onDidChangeState(() => {
        this._onDidChangeTreeData.fire();
      }),
    );
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  // --- Drag ---

  handleDrag(
    source: readonly ChangelistTreeNode[],
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken,
  ): void {
    // Allow dragging changelist, repo, file and hunk nodes
    const draggable = source.filter(
      (n) => n.kind === 'changelist' || n.kind === 'repo' || n.kind === 'file' || n.kind === 'hunk',
    );
    if (draggable.length === 0) return;

    dataTransfer.set(
      DRAG_MIME,
      new vscode.DataTransferItem(draggable),
    );
  }

  // --- Drop ---

  async handleDrop(
    target: ChangelistTreeNode | undefined,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const transferItem = dataTransfer.get(DRAG_MIME);
    if (!transferItem) return;

    const draggedNodes: ChangelistTreeNode[] = transferItem.value;
    if (!draggedNodes || draggedNodes.length === 0) return;

    // --- Case 1: Reorder changelists ---
    // When a single changelist node is dropped onto another changelist node
    if (
      draggedNodes.length === 1 &&
      draggedNodes[0].kind === 'changelist' &&
      target?.kind === 'changelist'
    ) {
      const draggedId = draggedNodes[0].changelist.id;
      const targetId = target.changelist.id;
      this.manager.reorderChangelist(draggedId, targetId);
      return;
    }

    // --- Case 2: Move repo to a changelist ---
    // When one or more repo nodes are dragged onto a changelist or another repo node
    const repoNodes = draggedNodes.filter((n) => n.kind === 'repo');
    if (repoNodes.length > 0 && repoNodes.length === draggedNodes.length) {
      const targetChangelistId = this.resolveTargetChangelistId(target);
      if (!targetChangelistId) return;
      for (const node of repoNodes) {
        if (node.kind === 'repo' && node.changelistId !== targetChangelistId) {
          await this.manager.moveRepoToChangelist(
            node.repoRootPath,
            node.changelistId,
            targetChangelistId,
          );
        }
      }
      return;
    }

    // --- Case 3: Move file/hunk to a changelist ---
    // Determine the target changelist ID
    const targetChangelistId = this.resolveTargetChangelistId(target);
    if (!targetChangelistId) return;

    for (const node of draggedNodes) {
      if (node.kind === 'file') {
        await this.manager.moveFileToChangelist(
          node.fileChange.absolutePath,
          targetChangelistId,
        );
      } else if (node.kind === 'hunk') {
        await this.manager.moveHunkToChangelist(
          node.hunk.id,
          targetChangelistId,
        );
      }
    }
  }

  private resolveTargetChangelistId(
    target: ChangelistTreeNode | undefined,
  ): string | undefined {
    if (!target) return undefined;
    switch (target.kind) {
      case 'changelist':
        return target.changelist.id;
      case 'repo':
        return target.changelistId;
      case 'file':
        return target.changelistId;
      case 'hunk':
        return target.changelistId;
    }
  }

  // --- TreeDataProvider ---

  getTreeItem(element: ChangelistTreeNode): vscode.TreeItem {
    switch (element.kind) {
      case 'changelist':
        return createChangelistTreeItem(
          element,
          this.manager.isChangelistFullySelected(element.changelist.id),
        );
      case 'repo':
        return createRepoTreeItem(
          element,
          this.manager.isRepoFullySelected(element.changelistId, element.repoRootPath),
        );
      case 'file': {
        const checked =
          element.hunks.length <= 1
            ? this.manager.isFileSelected(element.fileChange.absolutePath)
            : element.hunks.every((h) => this.manager.isHunkSelected(h.id));
        return createFileTreeItem(element, checked);
      }
      case 'hunk':
        return createHunkTreeItem(
          element,
          this.manager.isHunkSelected(element.hunk.id),
        );
    }
  }

  getChildren(
    element?: ChangelistTreeNode,
  ): ChangelistTreeNode[] | undefined {
    if (!element) {
      return this.getRootChildren();
    }

    switch (element.kind) {
      case 'changelist':
        return this.getChangelistChildren(element.changelist.id);
      case 'repo':
        return this.getRepoChildren(element.changelistId, element.repoRootPath);
      case 'file':
        return this.getFileChildren(element);
      case 'hunk':
        return undefined;
    }
  }

  private getRootChildren(): ChangelistTreeNode[] {
    const changelists = this.manager.getChangelists();
    return changelists.map((cl) => ({
      kind: 'changelist' as const,
      changelist: cl,
      fileCount: this.manager.getFileCountForChangelist(cl.id),
    }));
  }

  private getChangelistChildren(
    changelistId: string,
  ): ChangelistTreeNode[] {
    const contents = this.manager.getChangelistContents(changelistId);
    if (contents.size === 0) return [];

    const isMultiRepo = this.repoManager.isMultiRepo();

    if (isMultiRepo) {
      // Group by repo
      const repoMap = new Map<string, ChangelistContentsEntry[]>();

      for (const [, entry] of contents) {
        const repoRoot = entry.fileChange.repoRootPath;
        const entries = repoMap.get(repoRoot) || [];
        entries.push(entry);
        repoMap.set(repoRoot, entries);
      }

      const repoNodes: ChangelistTreeNode[] = [];
      for (const [repoRoot, entries] of repoMap) {
        const repoInfo = this.repoManager.getRepos().get(repoRoot);
        const branch =
          repoInfo?.repository.state.HEAD?.name || 'unknown';

        const repoName = getRepoName(repoRoot);
        repoNodes.push({
          kind: 'repo',
          repoRootPath: repoRoot,
          repoName,
          branch,
          changelistId,
          fileCount: entries.length,
          colorIndex: getRepoColorIndex(repoName),
        });
      }
      return repoNodes;
    }

    // Single repo: return files directly
    return this.getFileNodes(changelistId, contents);
  }

  private getRepoChildren(
    changelistId: string,
    repoRootPath: string,
  ): ChangelistTreeNode[] {
    const contents = this.manager.getChangelistContents(changelistId);
    const filtered = new Map(
      [...contents].filter(
        ([, entry]) => entry.fileChange.repoRootPath === repoRootPath,
      ),
    );
    return this.getFileNodes(changelistId, filtered);
  }

  private getFileNodes(
    changelistId: string,
    contents: Map<string, ChangelistContentsEntry>,
  ): ChangelistTreeNode[] {
    const nodes: FileNode[] = [];
    for (const [, entry] of contents) {
      nodes.push({
        kind: 'file',
        fileChange: entry.fileChange,
        hunks: entry.hunks,
        changelistId,
        fileHeader: entry.fileHeader,
      });
    }
    // Sort by file path
    nodes.sort((a, b) =>
      a.fileChange.relativePath.localeCompare(b.fileChange.relativePath),
    );
    return nodes;
  }

  private getFileChildren(fileNode: FileNode): ChangelistTreeNode[] | undefined {
    if (fileNode.hunks.length <= 1) return undefined;

    return fileNode.hunks.map((hunk) => ({
      kind: 'hunk' as const,
      hunk,
      fileChange: fileNode.fileChange,
      changelistId: fileNode.changelistId,
      fileHeader: fileNode.fileHeader,
    }));
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
