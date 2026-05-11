import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { ChangelistManager } from './ChangelistManager';

const OVERVIEW_FILENAME = 'git-changelists-overview.json';
const DETAIL_DIR = 'git-changelists';
const EXPORT_DIR = '.vscode';

export class StateExporter implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private exporting = false;

  constructor(private readonly manager: ChangelistManager) {
    this.disposables.push(
      this.manager.onDidChangeState(() => {
        this.export();
      }),
    );
    this.export();
  }

  private async export(): Promise<void> {
    if (this.exporting) {
      return;
    }
    this.exporting = true;

    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        return;
      }

      const baseDir = path.join(workspaceFolder.uri.fsPath, EXPORT_DIR);
      const detailDir = path.join(baseDir, DETAIL_DIR);
      const overviewPath = path.join(baseDir, OVERVIEW_FILENAME);

      if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
      }
      if (!fs.existsSync(detailDir)) {
        fs.mkdirSync(detailDir, { recursive: true });
      }

      const changelists = this.manager.getChangelists();
      const overviewContents: Record<string, { changelistId: string; files: Array<{ absolutePath: string; relativePath: string; repoRootPath: string; status: string; oldPath?: string; isBinary: boolean; totalHunks: number; totalAddedLines: number; totalRemovedLines: number }> }> = {};

      // Clean up stale detail files
      const existingDetailFiles = new Set(fs.readdirSync(detailDir).filter((f) => f.endsWith('.json')));
      const activeDetailFiles = new Set<string>();

      for (const cl of changelists) {
        const clContents = this.manager.getChangelistContents(cl.id);
        const safeId = this.sanitizeFilename(cl.id);
        const detailFilename = `${safeId}.json`;
        activeDetailFiles.add(detailFilename);

        const filesOverview: Array<{ absolutePath: string; relativePath: string; repoRootPath: string; status: string; oldPath?: string; isBinary: boolean; totalHunks: number; totalAddedLines: number; totalRemovedLines: number }> = [];
        const filesDetail: Array<{ absolutePath: string; relativePath: string; repoRootPath: string; status: string; oldPath?: string; isBinary: boolean; hunks: Array<{ id: string; header: string; oldStart: number; oldCount: number; newStart: number; newCount: number; contentFingerprint: string; addedLines: number; removedLines: number }> }> = [];

        if (clContents.size > 0) {
          for (const entry of clContents.values()) {
            let totalAdded = 0;
            let totalRemoved = 0;
            const hunksDetail = entry.hunks.map((hunk) => {
              const added = hunk.lines.filter((l) => l.startsWith('+')).length;
              const removed = hunk.lines.filter((l) => l.startsWith('-')).length;
              totalAdded += added;
              totalRemoved += removed;
              return {
                id: hunk.id,
                header: hunk.header,
                oldStart: hunk.oldStart,
                oldCount: hunk.oldCount,
                newStart: hunk.newStart,
                newCount: hunk.newCount,
                contentFingerprint: hunk.contentFingerprint,
                addedLines: added,
                removedLines: removed,
              };
            });

            filesOverview.push({
              absolutePath: entry.fileChange.absolutePath,
              relativePath: entry.fileChange.relativePath,
              repoRootPath: entry.fileChange.repoRootPath,
              status: entry.fileChange.status,
              oldPath: entry.fileChange.oldPath,
              isBinary: entry.fileChange.isBinary,
              totalHunks: entry.hunks.length,
              totalAddedLines: totalAdded,
              totalRemovedLines: totalRemoved,
            });

            filesDetail.push({
              absolutePath: entry.fileChange.absolutePath,
              relativePath: entry.fileChange.relativePath,
              repoRootPath: entry.fileChange.repoRootPath,
              status: entry.fileChange.status,
              oldPath: entry.fileChange.oldPath,
              isBinary: entry.fileChange.isBinary,
              hunks: hunksDetail,
            });
          }
        }

        overviewContents[cl.id] = { changelistId: cl.id, files: filesOverview };

        const detailPayload = {
          exportedAt: new Date().toISOString(),
          changelistId: cl.id,
          name: cl.name,
          description: cl.description,
          isDefault: cl.isDefault,
          isActive: cl.isActive,
          isDontCommit: cl.isDontCommit,
          isUnversioned: cl.isUnversioned,
          sortOrder: cl.sortOrder,
          files: filesDetail,
        };

        fs.writeFileSync(path.join(detailDir, detailFilename), JSON.stringify(detailPayload), 'utf-8');
      }

      // Remove stale detail files for deleted changelists
      for (const stale of existingDetailFiles) {
        if (!activeDetailFiles.has(stale)) {
          fs.unlinkSync(path.join(detailDir, stale));
        }
      }

      const overviewPayload = {
        exportedAt: new Date().toISOString(),
        changelists: changelists.map((cl) => ({
          id: cl.id,
          name: cl.name,
          description: cl.description,
          isDefault: cl.isDefault,
          isActive: cl.isActive,
          isDontCommit: cl.isDontCommit,
          isUnversioned: cl.isUnversioned,
          sortOrder: cl.sortOrder,
          fileCount: this.manager.getFileCountForChangelist(cl.id),
        })),
        contents: overviewContents,
      };

      fs.writeFileSync(overviewPath, JSON.stringify(overviewPayload), 'utf-8');
    } catch {
      // Silently ignore export errors to avoid disrupting the user experience.
    } finally {
      this.exporting = false;
    }
  }

  private sanitizeFilename(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
