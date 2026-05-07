import * as vscode from 'vscode';
import type { API, Repository, GitExtension } from '../types/git';
import { normalizePath, getRepoName } from '../utils/pathUtils';

export interface RepoInfo {
  rootPath: string;
  name: string;
  repository: Repository;
}

export class MultiRepoManager implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private repos = new Map<string, RepoInfo>();
  private gitApi: API | undefined;

  private readonly _onDidChangeRepos = new vscode.EventEmitter<void>();
  readonly onDidChangeRepos = this._onDidChangeRepos.event;

  async initialize(): Promise<void> {
    const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!gitExtension) {
      return;
    }

    if (!gitExtension.isActive) {
      await gitExtension.activate();
    }

    const ext = gitExtension.exports;
    if (!ext.enabled) {
      return;
    }

    this.gitApi = ext.getAPI(1);

    // Add existing repos
    for (const repo of this.gitApi.repositories) {
      this.addRepo(repo);
    }

    this.disposables.push(
      this.gitApi.onDidOpenRepository((repo) => {
        this.addRepo(repo);
        this._onDidChangeRepos.fire();
      }),
    );

    this.disposables.push(
      this.gitApi.onDidCloseRepository((repo) => {
        const rootPath = normalizePath(repo.rootUri.fsPath);
        this.repos.delete(rootPath);
        this._onDidChangeRepos.fire();
      }),
    );
  }

  private addRepo(repo: Repository): void {
    const rootPath = normalizePath(repo.rootUri.fsPath);
    this.repos.set(rootPath, {
      rootPath,
      name: getRepoName(rootPath),
      repository: repo,
    });
  }

  getRepos(): Map<string, RepoInfo> {
    return this.repos;
  }

  getGitPath(): string {
    return this.gitApi?.git.path || 'git';
  }

  isMultiRepo(): boolean {
    return this.repos.size > 1;
  }

  getRepoForFile(filePath: string): RepoInfo | undefined {
    const normalized = normalizePath(filePath);
    // Find the most specific (longest) repo root that contains this file
    let bestMatch: RepoInfo | undefined;
    let bestLength = 0;
    for (const [rootPath, info] of this.repos) {
      if (normalized.startsWith(rootPath + '/') || normalized === rootPath) {
        if (rootPath.length > bestLength) {
          bestLength = rootPath.length;
          bestMatch = info;
        }
      }
    }
    return bestMatch;
  }

  dispose(): void {
    this._onDidChangeRepos.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
