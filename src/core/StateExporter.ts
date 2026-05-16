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
      const overviewContents: Record<string, string[]> = {};

      // Clean up stale detail files
      const existingDetailFiles = new Set(fs.readdirSync(detailDir).filter((f) => f.endsWith('.json')));
      const activeDetailFiles = new Set<string>();

      for (const cl of changelists) {
        const clContents = this.manager.getChangelistContents(cl.id);
        const detailFilename = `${this.sanitizeFilename(cl.name)}.json`;
        activeDetailFiles.add(detailFilename);

        const filesOverview: string[] = [];
        const filesDetail: Array<{ path: string; status: string }> = [];

        if (clContents.size > 0) {
          for (const entry of clContents.values()) {
            filesOverview.push(entry.fileChange.relativePath);
            filesDetail.push({
              path: entry.fileChange.relativePath,
              status: entry.fileChange.status,
            });
          }
        }

        overviewContents[cl.id] = filesOverview;

        const detailPayload = filesDetail;

        fs.writeFileSync(path.join(detailDir, detailFilename), JSON.stringify(detailPayload, null, 2), 'utf-8');
      }

      // Remove stale detail files for deleted changelists
      for (const stale of existingDetailFiles) {
        if (!activeDetailFiles.has(stale)) {
          fs.unlinkSync(path.join(detailDir, stale));
        }
      }

      const overviewPayload: Record<string, string[]> = {};
      for (const cl of changelists) {
        overviewPayload[cl.name] = overviewContents[cl.id] || [];
      }

      fs.writeFileSync(overviewPath, JSON.stringify(overviewPayload, null, 2), 'utf-8');
    } catch {
      // Silently ignore export errors to avoid disrupting the user experience.
    } finally {
      this.exporting = false;
    }
  }

  private sanitizeFilename(name: string): string {
    // Remove characters invalid in Windows filenames: < > : " / \ | ? * and control chars
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
