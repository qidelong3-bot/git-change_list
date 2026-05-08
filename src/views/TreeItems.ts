import * as vscode from 'vscode';
import * as path from 'path';
import type {
  ChangelistTreeNode,
  ChangelistNode,
  RepoNode,
  FileNode,
  HunkNode,
  Changelist,
  FileChange,
  Hunk,
} from '../types/index';

export function createChangelistTreeItem(
  node: ChangelistNode,
  checked: boolean,
): vscode.TreeItem {
  const cl = node.changelist;
  const label = cl.name;
  const item = new vscode.TreeItem(
    label,
    vscode.TreeItemCollapsibleState.Expanded,
  );

  item.description = cl.description
    ? `${cl.description} · ${vscode.l10n.t('{0} file(s)', node.fileCount)}`
    : vscode.l10n.t('{0} file(s)', node.fileCount);

  if (cl.isActive) {
    item.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
  } else if (cl.isUnversioned) {
    item.iconPath = new vscode.ThemeIcon('file-directory', new vscode.ThemeColor('gitDecoration.untrackedResourceForeground'));
  } else if (cl.isDontCommit) {
    item.iconPath = new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('gitDecoration.ignoredResourceForeground'));
  } else {
    item.iconPath = new vscode.ThemeIcon('list-tree');
  }

  // Context value for menu contributions
  if (cl.isDefault) {
    item.contextValue = 'changelist.default';
  } else if (cl.isUnversioned) {
    item.contextValue = 'changelist.unversioned';
  } else if (cl.isDontCommit) {
    item.contextValue = 'changelist.dontcommit';
  } else {
    item.contextValue = 'changelist';
  }

  if (node.fileCount > 0) {
    item.checkboxState = checked
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
  }

  return item;
}

export function createRepoTreeItem(
  node: RepoNode,
  checked: boolean,
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    node.repoName,
    vscode.TreeItemCollapsibleState.Expanded,
  );

  item.description = `${node.fileCount} · ${node.branch}`;
  item.iconPath = new vscode.ThemeIcon(
    'primitive-square',
    new vscode.ThemeColor(`gitChangelists.repoColor${node.colorIndex}`),
  );
  item.contextValue = 'repo';

  if (node.fileCount > 0) {
    item.checkboxState = checked
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
  }

  return item;
}

export function createFileTreeItem(
  node: FileNode,
  checked: boolean,
): vscode.TreeItem {
  const fc = node.fileChange;
  const fileName = path.basename(fc.relativePath);
  const dirPath = path.dirname(fc.relativePath);

  const item = new vscode.TreeItem(
    fileName,
    node.hunks.length > 1
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None,
  );

  const statusLabel = getStatusLabel(fc.status);
  item.description = `${dirPath !== '.' ? dirPath + ' ' : ''}${statusLabel}`;
  item.iconPath = getFileStatusIcon(fc.status);
  item.contextValue = 'file';
  item.tooltip = fc.absolutePath;

  // Click to open diff
  item.command = {
    command: 'gitChangelists.openDiff',
    title: 'Open Diff',
    arguments: [node],
  };

  item.resourceUri = vscode.Uri.file(fc.absolutePath);
  item.checkboxState = checked
    ? vscode.TreeItemCheckboxState.Checked
    : vscode.TreeItemCheckboxState.Unchecked;

  return item;
}

export function createHunkTreeItem(
  node: HunkNode,
  checked: boolean,
): vscode.TreeItem {
  const hunk = node.hunk;
  const label = hunk.header
    ? vscode.l10n.t('Lines {0}-{1}', hunk.newStart, hunk.newStart + hunk.newCount - 1)
    : vscode.l10n.t('Lines {0}-{1}', 1, 1);

  const item = new vscode.TreeItem(
    label,
    vscode.TreeItemCollapsibleState.None,
  );

  const addCount = hunk.lines.filter((l) => l.startsWith('+')).length;
  const delCount = hunk.lines.filter((l) => l.startsWith('-')).length;
  item.description = `+${addCount} -${delCount}`;

  item.iconPath = new vscode.ThemeIcon('diff');
  item.contextValue = 'hunk';

  item.command = {
    command: 'gitChangelists.openDiff',
    title: 'Open Diff',
    arguments: [node],
  };

  item.checkboxState = checked
    ? vscode.TreeItemCheckboxState.Checked
    : vscode.TreeItemCheckboxState.Unchecked;

  return item;
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'M': return '[M]';
    case 'A': return '[A]';
    case 'D': return '[D]';
    case 'R': return '[R]';
    case 'C': return '[C]';
    case '?': return '[?]';
    case 'U': return '[U]';
    default: return '';
  }
}

function getFileStatusIcon(status: string): vscode.ThemeIcon {
  switch (status) {
    case 'M':
      return new vscode.ThemeIcon('diff-modified', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
    case 'A':
      return new vscode.ThemeIcon('diff-added', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
    case 'D':
      return new vscode.ThemeIcon('diff-removed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
    case 'R':
      return new vscode.ThemeIcon('diff-renamed', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
    case '?':
      return new vscode.ThemeIcon('question', new vscode.ThemeColor('gitDecoration.untrackedResourceForeground'));
    case 'U':
      return new vscode.ThemeIcon('warning', new vscode.ThemeColor('gitDecoration.conflictingResourceForeground'));
    default:
      return new vscode.ThemeIcon('file');
  }
}
