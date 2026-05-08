import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { StorageService } from './StorageService';
import { GitService } from '../git/GitService';
import { MultiRepoManager } from '../git/MultiRepoManager';
import { parseGitDiff } from './HunkParser';
import { normalizePath } from '../utils/pathUtils';
import type {
  Changelist,
  ChangelistState,
  HunkAssignment,
  Hunk,
  FileChange,
  ParsedFileDiff,
} from '../types/index';
import { UNVERSIONED_CHANGELIST_ID } from '../types/index';

export interface ChangelistContentsEntry {
  fileChange: FileChange;
  hunks: Hunk[];
  fileHeader: string;
}

export class ChangelistManager implements vscode.Disposable {
  private state: ChangelistState;
  private currentDiffs = new Map<string, ParsedFileDiff>();
  private refreshing = false;
  private selectedChangelistId: string | undefined;

  // Selection state for commit: which files/hunks are checked
  private selectedFiles = new Set<string>();
  private selectedHunks = new Set<string>();

  private readonly _onDidChangeState = new vscode.EventEmitter<void>();
  readonly onDidChangeState = this._onDidChangeState.event;

  constructor(
    private readonly storage: StorageService,
    private readonly gitService: GitService,
    private readonly repoManager: MultiRepoManager,
  ) {
    this.state = this.storage.getState();
    this.ensureFileHistory();
  }

  /** Seed fileHistory from existing assignments if it's empty (migration for users who grouped before fileHistory existed). */
  private ensureFileHistory(): void {
    if (!this.state.fileHistory) {
      this.state.fileHistory = {};
    }
    if (
      Object.keys(this.state.fileHistory).length === 0 &&
      this.state.assignments.length > 0
    ) {
      const fileGroups = new Map<string, Map<string, number>>();
      for (const assignment of this.state.assignments) {
        if (assignment.changelistId === UNVERSIONED_CHANGELIST_ID) {
          continue;
        }
        const groups =
          fileGroups.get(assignment.fileAbsolutePath) || new Map<string, number>();
        groups.set(
          assignment.changelistId,
          (groups.get(assignment.changelistId) || 0) + 1,
        );
        fileGroups.set(assignment.fileAbsolutePath, groups);
      }
      for (const [filePath, groups] of fileGroups) {
        let bestId = '';
        let bestCount = 0;
        for (const [id, count] of groups) {
          if (count > bestCount) {
            bestId = id;
            bestCount = count;
          }
        }
        if (bestId) {
          this.state.fileHistory[filePath] = bestId;
        }
      }
      this.saveState();
    }
  }

  getChangelists(): Changelist[] {
    return [...this.state.changelists].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  getActiveChangelist(): Changelist {
    return (
      this.state.changelists.find((c) => c.isActive) ||
      this.state.changelists.find((c) => c.isDefault) ||
      this.state.changelists[0]
    );
  }

  getDefaultChangelist(): Changelist {
    return (
      this.state.changelists.find((c) => c.isDefault) ||
      this.state.changelists[0]
    );
  }

  getUnversionedChangelist(): Changelist | undefined {
    return this.state.changelists.find((c) => c.isUnversioned);
  }

  getChangelistById(id: string): Changelist | undefined {
    return this.state.changelists.find((c) => c.id === id);
  }

  setSelectedChangelist(id: string | undefined): void {
    if (this.selectedChangelistId === id) {
      return;
    }
    this.selectedChangelistId = id;
    this._onDidChangeState.fire();
  }

  getSelectedChangelistId(): string | undefined {
    return this.selectedChangelistId;
  }

  // --- Selection state for commit ---

  isFileSelected(filePath: string): boolean {
    return this.selectedFiles.has(filePath);
  }

  isHunkSelected(hunkId: string): boolean {
    return this.selectedHunks.has(hunkId);
  }

  toggleFileSelection(filePath: string, selected?: boolean): void {
    const next = selected !== undefined ? selected : !this.selectedFiles.has(filePath);
    if (next) {
      this.selectedFiles.add(filePath);
    } else {
      this.selectedFiles.delete(filePath);
    }
    this._onDidChangeState.fire();
  }

  toggleHunkSelection(hunkId: string, selected?: boolean): void {
    const next = selected !== undefined ? selected : !this.selectedHunks.has(hunkId);
    if (next) {
      this.selectedHunks.add(hunkId);
    } else {
      this.selectedHunks.delete(hunkId);
    }
    this._onDidChangeState.fire();
  }

  selectAllInChangelist(changelistId: string): void {
    const contents = this.getChangelistContents(changelistId);
    for (const [path, entry] of contents) {
      this.selectedFiles.add(path);
      for (const hunk of entry.hunks) {
        this.selectedHunks.add(hunk.id);
      }
    }
    this._onDidChangeState.fire();
  }

  deselectAllInChangelist(changelistId: string): void {
    const contents = this.getChangelistContents(changelistId);
    for (const [path, entry] of contents) {
      this.selectedFiles.delete(path);
      for (const hunk of entry.hunks) {
        this.selectedHunks.delete(hunk.id);
      }
    }
    this._onDidChangeState.fire();
  }

  getSelectedFilesForChangelist(changelistId: string): string[] {
    const contents = this.getChangelistContents(changelistId);
    const result: string[] = [];
    for (const [path, entry] of contents) {
      if (entry.hunks.length <= 1) {
        if (this.selectedFiles.has(path)) {
          result.push(path);
        }
      } else {
        // Multi-hunk file: include if any hunk is selected
        const anySelected = entry.hunks.some((h) => this.selectedHunks.has(h.id));
        if (anySelected) {
          result.push(path);
        }
      }
    }
    return result;
  }

  getSelectedHunksForChangelist(changelistId: string): string[] {
    const contents = this.getChangelistContents(changelistId);
    const result: string[] = [];
    for (const [, entry] of contents) {
      if (entry.hunks.length > 1) {
        for (const hunk of entry.hunks) {
          if (this.selectedHunks.has(hunk.id)) {
            result.push(hunk.id);
          }
        }
      }
    }
    return result;
  }

  clearSelectionForChangelist(changelistId: string): void {
    const contents = this.getChangelistContents(changelistId);
    for (const [path, entry] of contents) {
      this.selectedFiles.delete(path);
      for (const hunk of entry.hunks) {
        this.selectedHunks.delete(hunk.id);
      }
    }
    this._onDidChangeState.fire();
  }

  /** Returns true if every file/hunk in the changelist is selected */
  isChangelistFullySelected(changelistId: string): boolean {
    const contents = this.getChangelistContents(changelistId);
    if (contents.size === 0) return false;
    for (const [path, entry] of contents) {
      if (entry.hunks.length <= 1) {
        if (!this.selectedFiles.has(path)) return false;
      } else {
        for (const hunk of entry.hunks) {
          if (!this.selectedHunks.has(hunk.id)) return false;
        }
      }
    }
    return true;
  }

  /** Returns true if the repo within a changelist is fully selected */
  isRepoFullySelected(changelistId: string, repoRootPath: string): boolean {
    const contents = this.getChangelistContents(changelistId);
    let hasAny = false;
    for (const [path, entry] of contents) {
      if (entry.fileChange.repoRootPath !== repoRootPath) continue;
      hasAny = true;
      if (entry.hunks.length <= 1) {
        if (!this.selectedFiles.has(path)) return false;
      } else {
        for (const hunk of entry.hunks) {
          if (!this.selectedHunks.has(hunk.id)) return false;
        }
      }
    }
    return hasAny;
  }

  selectAllInRepo(changelistId: string, repoRootPath: string): void {
    const contents = this.getChangelistContents(changelistId);
    for (const [path, entry] of contents) {
      if (entry.fileChange.repoRootPath !== repoRootPath) continue;
      this.selectedFiles.add(path);
      for (const hunk of entry.hunks) {
        this.selectedHunks.add(hunk.id);
      }
    }
    this._onDidChangeState.fire();
  }

  deselectAllInRepo(changelistId: string, repoRootPath: string): void {
    const contents = this.getChangelistContents(changelistId);
    for (const [path, entry] of contents) {
      if (entry.fileChange.repoRootPath !== repoRootPath) continue;
      this.selectedFiles.delete(path);
      for (const hunk of entry.hunks) {
        this.selectedHunks.delete(hunk.id);
      }
    }
    this._onDidChangeState.fire();
  }

  getChangelistContents(
    changelistId: string,
  ): Map<string, ChangelistContentsEntry> {
    const result = new Map<string, ChangelistContentsEntry>();
    const assignments = this.state.assignments.filter(
      (assignment) => assignment.changelistId === changelistId,
    );

    for (const assignment of assignments) {
      const diff = this.currentDiffs.get(assignment.fileAbsolutePath);
      if (!diff) {
        continue;
      }

      const existingEntry = result.get(assignment.fileAbsolutePath);
      const matchingHunk = diff.hunks.find((hunk) => hunk.id === assignment.hunkId);

      if (existingEntry) {
        if (
          matchingHunk &&
          !existingEntry.hunks.find((hunk) => hunk.id === matchingHunk.id)
        ) {
          existingEntry.hunks.push(matchingHunk);
        }
        continue;
      }

      result.set(assignment.fileAbsolutePath, {
        fileChange: diff.fileChange,
        hunks: matchingHunk ? [matchingHunk] : [],
        fileHeader: diff.fileHeader,
      });
    }

    return result;
  }

  getAllContents(): Map<string, Map<string, ChangelistContentsEntry[]>> {
    const result = new Map<string, Map<string, ChangelistContentsEntry[]>>();

    for (const changelist of this.state.changelists) {
      const contents = this.getChangelistContents(changelist.id);
      const repoGrouped = new Map<string, ChangelistContentsEntry[]>();

      for (const [, entry] of contents) {
        const repoEntries = repoGrouped.get(entry.fileChange.repoRootPath) || [];
        repoEntries.push(entry);
        repoGrouped.set(entry.fileChange.repoRootPath, repoEntries);
      }

      if (repoGrouped.size > 0) {
        result.set(changelist.id, repoGrouped);
      }
    }

    return result;
  }

  getFileCountForChangelist(changelistId: string): number {
    return this.getChangelistContents(changelistId).size;
  }

  getDiffForFile(filePath: string): ParsedFileDiff | undefined {
    return this.currentDiffs.get(normalizePath(filePath));
  }

  getAssignmentForHunk(hunkId: string): HunkAssignment | undefined {
    return this.state.assignments.find((assignment) => assignment.hunkId === hunkId);
  }

  findHunkAtLine(
    filePath: string,
    line: number,
  ): {
    diff: ParsedFileDiff;
    hunk: Hunk;
    assignment: HunkAssignment | undefined;
    changelist: Changelist | undefined;
  } | undefined {
    const normalizedPath = normalizePath(filePath);
    const diff = this.currentDiffs.get(normalizedPath);
    if (!diff) {
      return undefined;
    }

    let matchedHunk = diff.hunks.find((hunk) => {
      const start = hunk.newStart || 1;
      const count = Math.max(hunk.newCount, 1);
      const end = start + count - 1;
      return line >= start && line <= end;
    });

    if (!matchedHunk && diff.hunks.length === 1) {
      matchedHunk = diff.hunks[0];
    }
    if (!matchedHunk) {
      return undefined;
    }

    const assignment = this.state.assignments.find(
      (item) =>
        item.fileAbsolutePath === normalizedPath && item.hunkId === matchedHunk.id,
    );
    const changelist = assignment
      ? this.getChangelistById(assignment.changelistId)
      : undefined;

    return {
      diff,
      hunk: matchedHunk,
      assignment,
      changelist,
    };
  }

  async refresh(): Promise<void> {
    if (this.refreshing) {
      return;
    }
    this.refreshing = true;

    try {
      const previousDiffs = this.currentDiffs;
      const nextDiffs = new Map<string, ParsedFileDiff>();

      for (const [, repoInfo] of this.repoManager.getRepos()) {
        try {
          let rawDiff = '';
          try {
            rawDiff = await this.gitService.getDiffAgainstHead(repoInfo.rootPath);
          } catch {
            rawDiff = await this.gitService.getDiff(repoInfo.rootPath);
          }

          const parsed = parseGitDiff(rawDiff, repoInfo.rootPath);
          for (const [path, diff] of parsed) {
            nextDiffs.set(path, diff);
          }

          const status = await this.gitService.getStatus(repoInfo.rootPath);
          for (const file of status) {
            if (file.status === '?' && !nextDiffs.has(file.absolutePath)) {
              nextDiffs.set(file.absolutePath, {
                fileChange: file,
                hunks: [
                  {
                    id: this.syntheticHunkId(file.absolutePath),
                    header: '',
                    oldStart: 0,
                    oldCount: 0,
                    newStart: 1,
                    newCount: 0,
                    lines: [],
                    contentFingerprint: this.syntheticHunkId(file.absolutePath),
                  },
                ],
                fileHeader: '',
              });
            }
          }
        } catch {
          // Skip repos in transient/bad states.
        }
      }

      this.reconcile(previousDiffs, nextDiffs);
      this.currentDiffs = nextDiffs;
      this.syncSelectionState();
      this.saveState();
      this._onDidChangeState.fire();
    } finally {
      this.refreshing = false;
    }
  }

  private syntheticHunkId(filePath: string): string {
    return crypto
      .createHash('sha1')
      .update(`synthetic:${filePath}`)
      .digest('hex')
      .substring(0, 12);
  }

  private reconcile(
    previousDiffs: Map<string, ParsedFileDiff>,
    nextDiffs: Map<string, ParsedFileDiff>,
  ): void {
    // If there are no current changes, preserve existing assignments so that
    // future edits can inherit the user's grouping (instead of resetting to Changes).
    if (nextDiffs.size === 0) {
      return;
    }

    const allCurrentHunkIds = new Set<string>();
    const currentHunksByFileAndFingerprint = new Map<
      string,
      { hunkId: string; filePath: string }[]
    >();
    const previousAssignmentsByFile = new Map<string, HunkAssignment[]>();
    const previousHunksById = new Map<string, Hunk>();

    for (const [filePath, diff] of nextDiffs) {
      for (const hunk of diff.hunks) {
        allCurrentHunkIds.add(hunk.id);
        const key = `${filePath}::${hunk.contentFingerprint}`;
        const existing = currentHunksByFileAndFingerprint.get(key) || [];
        existing.push({ hunkId: hunk.id, filePath });
        currentHunksByFileAndFingerprint.set(key, existing);
      }
    }

    for (const assignment of this.state.assignments) {
      const fileAssignments =
        previousAssignmentsByFile.get(assignment.fileAbsolutePath) || [];
      fileAssignments.push(assignment);
      previousAssignmentsByFile.set(assignment.fileAbsolutePath, fileAssignments);

      const previousDiff = previousDiffs.get(assignment.fileAbsolutePath);
      const previousHunk = previousDiff?.hunks.find((hunk) => hunk.id === assignment.hunkId);
      if (previousHunk) {
        previousHunksById.set(assignment.hunkId, previousHunk);
      }
    }

    const newAssignments: HunkAssignment[] = [];
    const matchedNewHunkIds = new Set<string>();
    const matchedOldAssignmentKeys = new Set<string>();

    for (const assignment of this.state.assignments) {
      if (!allCurrentHunkIds.has(assignment.hunkId)) {
        continue;
      }

      newAssignments.push(assignment);
      matchedNewHunkIds.add(assignment.hunkId);
      matchedOldAssignmentKeys.add(this.getAssignmentKey(assignment));
    }

    const unmatchedOldAssignments = this.state.assignments.filter(
      (assignment) => !allCurrentHunkIds.has(assignment.hunkId),
    );

    for (const assignment of unmatchedOldAssignments) {
      const previousHunk = previousHunksById.get(assignment.hunkId);
      if (!previousHunk) {
        continue;
      }

      const candidates = currentHunksByFileAndFingerprint.get(
        `${assignment.fileAbsolutePath}::${previousHunk.contentFingerprint}`,
      );
      const candidate = candidates?.find((item) => !matchedNewHunkIds.has(item.hunkId));
      if (!candidate) {
        continue;
      }

      newAssignments.push({
        fileAbsolutePath: candidate.filePath,
        repoRootPath: assignment.repoRootPath,
        hunkId: candidate.hunkId,
        changelistId: assignment.changelistId,
      });
      matchedNewHunkIds.add(candidate.hunkId);
      matchedOldAssignmentKeys.add(this.getAssignmentKey(assignment));
    }

    const activeChangelist = this.getActiveChangelist();
    for (const [filePath, diff] of nextDiffs) {
      const previousAssignments = previousAssignmentsByFile.get(filePath) || [];
      const inheritedChangelistId = this.getPreferredChangelistIdForFile(
        previousAssignments,
        matchedOldAssignmentKeys,
      );

      for (const hunk of diff.hunks) {
        if (matchedNewHunkIds.has(hunk.id)) {
          continue;
        }

        let targetId: string;
        if (diff.fileChange.status === '?') {
          targetId = UNVERSIONED_CHANGELIST_ID;
        } else {
          const historyId = this.state.fileHistory?.[filePath];
          const fileHistoryId =
            historyId && this.getChangelistById(historyId) ? historyId : undefined;
          targetId = inheritedChangelistId || fileHistoryId || activeChangelist.id;
        }

        newAssignments.push({
          fileAbsolutePath: filePath,
          repoRootPath: diff.fileChange.repoRootPath,
          hunkId: hunk.id,
          changelistId: targetId,
        });
        matchedNewHunkIds.add(hunk.id);
      }
    }

    this.state.assignments = newAssignments;
  }

  private getAssignmentKey(assignment: HunkAssignment): string {
    return `${assignment.fileAbsolutePath}::${assignment.hunkId}::${assignment.changelistId}`;
  }

  private getPreferredChangelistIdForFile(
    previousAssignments: HunkAssignment[],
    matchedOldAssignmentKeys: Set<string>,
  ): string | undefined {
    if (previousAssignments.length === 0) {
      return undefined;
    }

    const counts = new Map<string, number>();
    for (const assignment of previousAssignments) {
      if (matchedOldAssignmentKeys.has(this.getAssignmentKey(assignment))) {
        continue;
      }
      counts.set(
        assignment.changelistId,
        (counts.get(assignment.changelistId) || 0) + 1,
      );
    }

    if (counts.size === 0) {
      for (const assignment of previousAssignments) {
        counts.set(
          assignment.changelistId,
          (counts.get(assignment.changelistId) || 0) + 1,
        );
      }
    }

    let bestId: string | undefined;
    let bestCount = -1;
    for (const [changelistId, count] of counts) {
      if (count > bestCount) {
        bestId = changelistId;
        bestCount = count;
      }
    }

    return bestId;
  }

  createChangelist(name: string, description: string = ''): Changelist {
    const maxOrder = Math.max(
      0,
      ...this.state.changelists
        .filter((changelist) => !changelist.isUnversioned)
        .map((changelist) => changelist.sortOrder),
    );
    const newChangelist: Changelist = {
      id: crypto.randomUUID(),
      name,
      description,
      isDefault: false,
      isActive: false,
      sortOrder: maxOrder + 1,
      isDontCommit: false,
      isUnversioned: false,
    };
    this.state.changelists.push(newChangelist);
    this.saveState();
    this._onDidChangeState.fire();
    return newChangelist;
  }

  renameChangelist(id: string, newName: string): boolean {
    const changelist = this.state.changelists.find((item) => item.id === id);
    if (!changelist || changelist.isUnversioned) {
      return false;
    }
    changelist.name = newName;
    this.saveState();
    this._onDidChangeState.fire();
    return true;
  }

  deleteChangelist(id: string): boolean {
    const changelist = this.state.changelists.find((item) => item.id === id);
    if (!changelist || changelist.isDefault || changelist.isUnversioned) {
      return false;
    }

    const defaultChangelist = this.getDefaultChangelist();
    for (const assignment of this.state.assignments) {
      if (assignment.changelistId === id) {
        assignment.changelistId = defaultChangelist.id;
        this.updateFileHistory(assignment.fileAbsolutePath, defaultChangelist.id);
      }
    }

    this.state.changelists = this.state.changelists.filter((item) => item.id !== id);

    if (changelist.isActive) {
      defaultChangelist.isActive = true;
    }

    this.saveState();
    this._onDidChangeState.fire();
    return true;
  }

  setActiveChangelist(id: string): void {
    for (const changelist of this.state.changelists) {
      changelist.isActive = changelist.id === id;
    }
    this.saveState();
    this._onDidChangeState.fire();
  }

  toggleDontCommit(id: string): void {
    const changelist = this.state.changelists.find((item) => item.id === id);
    if (!changelist) {
      return;
    }
    changelist.isDontCommit = !changelist.isDontCommit;
    this.saveState();
    this._onDidChangeState.fire();
  }

  reorderChangelist(draggedId: string, targetId: string): void {
    if (draggedId === targetId) {
      return;
    }

    const dragged = this.state.changelists.find((item) => item.id === draggedId);
    const target = this.state.changelists.find((item) => item.id === targetId);
    if (!dragged || !target || dragged.isUnversioned || target.isUnversioned) {
      return;
    }

    const sorted = [...this.state.changelists]
      .filter((item) => !item.isUnversioned)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const withoutDragged = sorted.filter((item) => item.id !== draggedId);
    const targetIndex = withoutDragged.findIndex((item) => item.id === targetId);
    if (targetIndex === -1) {
      return;
    }

    withoutDragged.splice(targetIndex, 0, dragged);
    withoutDragged.forEach((item, index) => {
      item.sortOrder = index;
    });

    const unversioned = this.state.changelists.find((item) => item.isUnversioned);
    if (unversioned) {
      unversioned.sortOrder = 999999;
    }

    this.saveState();
    this._onDidChangeState.fire();
  }

  setChangelistDescription(id: string, description: string): void {
    const changelist = this.state.changelists.find((item) => item.id === id);
    if (!changelist) {
      return;
    }
    changelist.description = description;
    this.saveState();
    this._onDidChangeState.fire();
  }

  getChangelistDescription(id: string): string {
    const changelist = this.state.changelists.find((item) => item.id === id);
    return changelist?.description || '';
  }

  async moveFileToChangelist(
    filePath: string,
    targetChangelistId: string,
  ): Promise<void> {
    let stagedUntrackedFiles = false;
    const currentAssignment = this.state.assignments.find(
      (assignment) => assignment.fileAbsolutePath === filePath,
    );
    if (currentAssignment) {
      const sourceIsUnversioned =
        currentAssignment.changelistId === UNVERSIONED_CHANGELIST_ID;
      const targetIsUnversioned = targetChangelistId === UNVERSIONED_CHANGELIST_ID;

      if (sourceIsUnversioned && !targetIsUnversioned) {
        const diff = this.currentDiffs.get(filePath);
        if (diff && diff.fileChange.status === '?') {
          await this.gitService.stageFile(
            diff.fileChange.repoRootPath,
            diff.fileChange.relativePath,
          );
          stagedUntrackedFiles = true;
        }
      }
    }

    for (const assignment of this.state.assignments) {
      if (assignment.fileAbsolutePath === filePath) {
        assignment.changelistId = targetChangelistId;
      }
    }
    this.updateFileHistory(filePath, targetChangelistId);
    this.saveState();
    this._onDidChangeState.fire();

    if (stagedUntrackedFiles) {
      await this.refresh();
    }
  }

  async moveHunkToChangelist(
    hunkId: string,
    targetChangelistId: string,
  ): Promise<void> {
    const assignment = this.state.assignments.find((item) => item.hunkId === hunkId);
    if (!assignment) {
      return;
    }

    let stagedUntrackedFiles = false;
    const sourceIsUnversioned = assignment.changelistId === UNVERSIONED_CHANGELIST_ID;
    const targetIsUnversioned = targetChangelistId === UNVERSIONED_CHANGELIST_ID;

    if (sourceIsUnversioned && !targetIsUnversioned) {
      const diff = this.currentDiffs.get(assignment.fileAbsolutePath);
      if (diff && diff.fileChange.status === '?') {
        await this.gitService.stageFile(
          diff.fileChange.repoRootPath,
          diff.fileChange.relativePath,
        );
        stagedUntrackedFiles = true;
      }
    }

    assignment.changelistId = targetChangelistId;
    this.updateFileHistory(assignment.fileAbsolutePath, targetChangelistId);
    this.saveState();
    this._onDidChangeState.fire();

    if (stagedUntrackedFiles) {
      await this.refresh();
    }
  }

  async moveRepoToChangelist(
    repoRootPath: string,
    sourceChangelistId: string,
    targetChangelistId: string,
  ): Promise<void> {
    if (sourceChangelistId === targetChangelistId) {
      return;
    }

    const sourceIsUnversioned = sourceChangelistId === UNVERSIONED_CHANGELIST_ID;
    const targetIsUnversioned = targetChangelistId === UNVERSIONED_CHANGELIST_ID;
    let stagedUntrackedFiles = false;

    const filePaths = new Set<string>();
    for (const assignment of this.state.assignments) {
      if (
        assignment.changelistId === sourceChangelistId &&
        assignment.repoRootPath === repoRootPath
      ) {
        filePaths.add(assignment.fileAbsolutePath);
      }
    }

    if (sourceIsUnversioned && !targetIsUnversioned) {
      for (const filePath of filePaths) {
        const diff = this.currentDiffs.get(filePath);
        if (diff && diff.fileChange.status === '?') {
          await this.gitService.stageFile(
            diff.fileChange.repoRootPath,
            diff.fileChange.relativePath,
          );
          stagedUntrackedFiles = true;
        }
      }
    }

    for (const assignment of this.state.assignments) {
      if (
        assignment.changelistId === sourceChangelistId &&
        assignment.repoRootPath === repoRootPath
      ) {
        assignment.changelistId = targetChangelistId;
        this.updateFileHistory(assignment.fileAbsolutePath, targetChangelistId);
      }
    }

    this.saveState();
    this._onDidChangeState.fire();

    if (stagedUntrackedFiles) {
      await this.refresh();
    }
  }

  async moveAllToChangelist(
    sourceChangelistId: string,
    targetChangelistId: string,
  ): Promise<void> {
    const sourceIsUnversioned = sourceChangelistId === UNVERSIONED_CHANGELIST_ID;
    const targetIsUnversioned = targetChangelistId === UNVERSIONED_CHANGELIST_ID;
    let stagedUntrackedFiles = false;

    if (sourceIsUnversioned && !targetIsUnversioned) {
      const filePaths = new Set<string>();
      for (const assignment of this.state.assignments) {
        if (assignment.changelistId === sourceChangelistId) {
          filePaths.add(assignment.fileAbsolutePath);
        }
      }

      for (const filePath of filePaths) {
        const diff = this.currentDiffs.get(filePath);
        if (diff && diff.fileChange.status === '?') {
          await this.gitService.stageFile(
            diff.fileChange.repoRootPath,
            diff.fileChange.relativePath,
          );
          stagedUntrackedFiles = true;
        }
      }
    }

    for (const assignment of this.state.assignments) {
      if (assignment.changelistId === sourceChangelistId) {
        assignment.changelistId = targetChangelistId;
        this.updateFileHistory(assignment.fileAbsolutePath, targetChangelistId);
      }
    }

    this.saveState();
    this._onDidChangeState.fire();

    if (stagedUntrackedFiles) {
      await this.refresh();
    }
  }

  private seenFiles = new Set<string>();
  private seenHunks = new Set<string>();

  private syncSelectionState(): void {
    const currentFilePaths = new Set<string>();
    const currentHunkIds = new Set<string>();

    for (const [, diff] of this.currentDiffs) {
      currentFilePaths.add(diff.fileChange.absolutePath);
      for (const hunk of diff.hunks) {
        currentHunkIds.add(hunk.id);
      }
    }

    // Remove selections for files/hunks that no longer exist
    for (const path of Array.from(this.selectedFiles)) {
      if (!currentFilePaths.has(path)) {
        this.selectedFiles.delete(path);
      }
    }
    for (const id of Array.from(this.selectedHunks)) {
      if (!currentHunkIds.has(id)) {
        this.selectedHunks.delete(id);
      }
    }

    // Add newly-discovered files/hunks as selected by default,
    // but do NOT re-select files the user has explicitly deselected.
    for (const path of currentFilePaths) {
      if (!this.seenFiles.has(path)) {
        this.seenFiles.add(path);
        this.selectedFiles.add(path);
      }
    }
    for (const id of currentHunkIds) {
      if (!this.seenHunks.has(id)) {
        this.seenHunks.add(id);
        this.selectedHunks.add(id);
      }
    }
  }

  private saveState(): void {
    this.storage.setState(this.state);
  }

  private updateFileHistory(filePath: string, changelistId: string): void {
    if (!this.state.fileHistory) {
      this.state.fileHistory = {};
    }
    this.state.fileHistory[filePath] = changelistId;
  }

  dispose(): void {
    this._onDidChangeState.dispose();
  }
}
