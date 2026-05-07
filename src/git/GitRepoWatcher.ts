import * as vscode from 'vscode';
import type { MultiRepoManager } from './MultiRepoManager';

export class GitRepoWatcher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly repoManager: MultiRepoManager) {}

  start(): void {
    // Watch file system for changes within workspace
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    this.disposables.push(
      watcher.onDidChange(() => this.debouncedFire()),
      watcher.onDidCreate(() => this.debouncedFire()),
      watcher.onDidDelete(() => this.debouncedFire()),
      watcher,
    );

    // Also listen for repo state changes from git extension
    for (const [, info] of this.repoManager.getRepos()) {
      this.disposables.push(
        info.repository.state.onDidChange(() => this.debouncedFire()),
      );
    }

    // Listen for new repos
    this.disposables.push(
      this.repoManager.onDidChangeRepos(() => {
        // Re-register state listeners for any new repos
        for (const [, info] of this.repoManager.getRepos()) {
          this.disposables.push(
            info.repository.state.onDidChange(() => this.debouncedFire()),
          );
        }
        this.debouncedFire();
      }),
    );

    // Periodic polling as fallback
    const interval = vscode.workspace
      .getConfiguration('gitChangelists')
      .get<number>('autoRefreshInterval', 3000);

    this.pollTimer = setInterval(() => {
      this._onDidChange.fire();
    }, interval);
  }

  private debouncedFire(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this._onDidChange.fire();
    }, 300);
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
    this._onDidChange.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
