export type FileStatus = 'M' | 'A' | 'D' | 'R' | 'C' | '?' | 'U';

export interface Hunk {
  id: string;
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
  contentFingerprint: string;
}

export interface FileChange {
  absolutePath: string;
  relativePath: string;
  repoRootPath: string;
  status: FileStatus;
  oldPath?: string;
  isBinary: boolean;
}

export interface ParsedFileDiff {
  fileChange: FileChange;
  hunks: Hunk[];
  fileHeader: string;
}

export interface HunkAssignment {
  fileAbsolutePath: string;
  repoRootPath: string;
  hunkId: string;
  changelistId: string;
}

export interface Changelist {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  isDontCommit: boolean;
  isUnversioned: boolean;
}

export const UNVERSIONED_CHANGELIST_ID = 'unversioned';

export interface ChangelistState {
  changelists: Changelist[];
  assignments: HunkAssignment[];
  version: number;
  /** Map of fileAbsolutePath -> last assigned changelistId (survives diff clears) */
  fileHistory?: Record<string, string>;
}

export const STATE_VERSION = 1;

export type ChangelistTreeNodeKind = 'changelist' | 'repo' | 'file' | 'hunk';

export interface ChangelistNode {
  kind: 'changelist';
  changelist: Changelist;
  fileCount: number;
}

export interface RepoNode {
  kind: 'repo';
  repoRootPath: string;
  repoName: string;
  branch: string;
  changelistId: string;
  fileCount: number;
  colorIndex: number;
}

export interface FileNode {
  kind: 'file';
  fileChange: FileChange;
  hunks: Hunk[];
  changelistId: string;
  fileHeader: string;
}

export interface HunkNode {
  kind: 'hunk';
  hunk: Hunk;
  fileChange: FileChange;
  changelistId: string;
  fileHeader: string;
}

export type ChangelistTreeNode = ChangelistNode | RepoNode | FileNode | HunkNode;
