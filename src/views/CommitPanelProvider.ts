import * as vscode from 'vscode';
import type { ChangelistManager, ChangelistContentsEntry } from '../core/ChangelistManager';
import type { GitService } from '../git/GitService';
import { buildPatch } from '../core/HunkPatchBuilder';

interface CommitFileInfo {
  absolutePath: string;
  relativePath: string;
  status: string;
  checked: boolean;
  hunks: { id: string; header: string; addCount: number; delCount: number; checked: boolean }[];
}

export class CommitPanelProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  public static readonly viewType = 'gitChangelists.commitPanel';

  private view?: vscode.WebviewView;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly manager: ChangelistManager,
    private readonly gitService: GitService,
  ) {
    this.disposables.push(
      this.manager.onDidChangeState(() => {
        this.updateWebview();
      }),
    );
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage(
      async (msg) => {
        switch (msg.type) {
          case 'commit':
            await this.doCommit(
              msg.changelistId,
              msg.message,
              false,
            );
            break;
          case 'commitAndPush':
            await this.doCommit(
              msg.changelistId,
              msg.message,
              true,
            );
            break;
          case 'ready':
            this.updateWebview();
            break;
          case 'changelistSelected':
            this.sendChangelistFiles(msg.changelistId);
            break;
          case 'openDiff':
            await this.openFileDiff(msg.absolutePath, msg.line);
            break;
          case 'fileSelectionChanged':
            this.manager.toggleFileSelection(msg.filePath, msg.checked);
            break;
          case 'hunkSelectionChanged':
            this.manager.toggleHunkSelection(msg.hunkId, msg.checked);
            break;
          case 'selectAll':
            this.manager.selectAllInChangelist(msg.changelistId);
            break;
          case 'deselectAll':
            this.manager.deselectAllInChangelist(msg.changelistId);
            break;
        }
      },
      undefined,
      this.disposables,
    );
  }

  private updateWebview(): void {
    if (!this.view) {
      return;
    }

    const changelists = this.manager
      .getChangelists()
      .filter((changelist) => !changelist.isDontCommit && !changelist.isUnversioned)
      .map((changelist) => ({
        id: changelist.id,
        name: changelist.name,
        description: changelist.description,
        fileCount: this.manager.getFileCountForChangelist(changelist.id),
        isActive: changelist.isActive,
      }));

    this.view.webview.postMessage({
      type: 'update',
      changelists,
      selectedChangelistId: this.manager.getSelectedChangelistId(),
      i18n: {
        commit: vscode.l10n.t('Commit'),
        commitAndPush: vscode.l10n.t('Commit and Push'),
        placeholder: vscode.l10n.t('Enter commit message...'),
        noChangelists: vscode.l10n.t('No committable changelists'),
        files: vscode.l10n.t('{0} file(s)', '__COUNT__'),
        selectAll: vscode.l10n.t('Select All'),
        deselectAll: vscode.l10n.t('Deselect All'),
        lines: vscode.l10n.t('Lines __START__-__END__'),
        previewDiff: vscode.l10n.t('Preview diff'),
        diff: vscode.l10n.t('Diff'),
        hunk: vscode.l10n.t('Hunk'),
      },
    });

    const selectedChangelistId =
      this.manager.getSelectedChangelistId() ||
      changelists.find((changelist) => changelist.fileCount > 0)?.id;
    if (selectedChangelistId) {
      this.sendChangelistFiles(selectedChangelistId);
    }
  }

  private sendChangelistFiles(changelistId: string): void {
    if (!this.view) {
      return;
    }

    const contents = this.manager.getChangelistContents(changelistId);
    const files: CommitFileInfo[] = [];

    for (const [absolutePath, entry] of contents) {
      const hasMultiHunks = entry.hunks.length > 1;
      files.push({
        absolutePath,
        relativePath: entry.fileChange.relativePath,
        status: entry.fileChange.status,
        checked: hasMultiHunks
          ? entry.hunks.every((h) => this.manager.isHunkSelected(h.id))
          : this.manager.isFileSelected(absolutePath),
        hunks: entry.hunks.map((hunk) => ({
          id: hunk.id,
          header: hunk.header,
          addCount: hunk.lines.filter((line) => line.startsWith('+')).length,
          delCount: hunk.lines.filter((line) => line.startsWith('-')).length,
          checked: this.manager.isHunkSelected(hunk.id),
        })),
      });
    }

    files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    const changelist = this.manager.getChangelists().find((item) => item.id === changelistId);

    this.view.webview.postMessage({
      type: 'filesUpdate',
      changelistId,
      description: changelist?.description || '',
      files,
    });
  }

  private async openFileDiff(absolutePath: string, line?: number): Promise<void> {
    const fileUri = vscode.Uri.file(absolutePath);
    const fileName =
      absolutePath.split('/').pop() ||
      absolutePath.split('\\').pop() ||
      absolutePath;

    try {
      const gitUri = fileUri.with({
        scheme: 'git',
        query: JSON.stringify({ path: fileUri.fsPath, ref: 'HEAD' }),
      });
      await vscode.commands.executeCommand(
        'vscode.diff',
        gitUri,
        fileUri,
        `${fileName} (${vscode.l10n.t('Working Tree')})`,
      );
    } catch {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc);
    }

    if (line !== undefined && line > 0) {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const position = new vscode.Position(Math.max(0, line - 1), 0);
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenter,
        );
      }
    }
  }

  private async doCommit(
    changelistId: string,
    message: string,
    andPush: boolean,
  ): Promise<void> {
    if (!message.trim()) {
      vscode.window.showWarningMessage(
        vscode.l10n.t('Commit message cannot be empty'),
      );
      return;
    }

    const contents = this.manager.getChangelistContents(changelistId);
    if (contents.size === 0) {
      vscode.window.showWarningMessage(vscode.l10n.t('No changes to commit'));
      return;
    }

    const selectedFiles = this.manager.getSelectedFilesForChangelist(changelistId);
    const selectedHunks = this.manager.getSelectedHunksForChangelist(changelistId);

    const selectedFileSet = selectedFiles.length > 0 ? new Set(selectedFiles) : null;
    const selectedHunkSet = selectedHunks.length > 0 ? new Set(selectedHunks) : null;

    const repoEntries = new Map<string, ChangelistContentsEntry[]>();
    for (const [absolutePath, entry] of contents) {
      if (selectedFileSet && !selectedFileSet.has(absolutePath)) {
        continue;
      }

      let filteredEntry = entry;
      if (selectedHunkSet && entry.hunks.length > 1) {
        const filteredHunks = entry.hunks.filter((hunk) => selectedHunkSet.has(hunk.id));
        if (filteredHunks.length === 0) {
          continue;
        }
        filteredEntry = { ...entry, hunks: filteredHunks };
      }

      const repoRoot = filteredEntry.fileChange.repoRootPath;
      const entries = repoEntries.get(repoRoot) || [];
      entries.push(filteredEntry);
      repoEntries.set(repoRoot, entries);
    }

    if (repoEntries.size === 0) {
      vscode.window.showWarningMessage(vscode.l10n.t('No changes to commit'));
      return;
    }

    let totalFiles = 0;

    for (const [repoRoot, entries] of repoEntries) {
      try {
        let savedIndex = '';
        try {
          savedIndex = await this.gitService.getDiffCached(repoRoot);
        } catch {
          // Ignore empty index state.
        }

        try {
          await this.gitService.resetIndex(repoRoot);
        } catch {
          // Ignore reset errors and let the commit attempt surface the real issue.
        }

        try {
          for (const entry of entries) {
            if (
              entry.fileChange.status === '?' ||
              entry.fileChange.isBinary ||
              !entry.fileHeader
            ) {
              await this.gitService.stageFile(
                repoRoot,
                entry.fileChange.relativePath,
              );
            } else {
              const patch = buildPatch(entry.fileHeader, entry.hunks);
              if (patch) {
                await this.gitService.applyPatchToIndex(repoRoot, patch);
              }
            }
            totalFiles++;
          }

          await this.gitService.commit(repoRoot, message);

          if (andPush) {
            try {
              await this.gitService.push(repoRoot);
            } catch (pushErr) {
              vscode.window.showErrorMessage(
                vscode.l10n.t('Push failed: {0}', String(pushErr)),
              );
            }
          }
        } catch (commitErr) {
          vscode.window.showErrorMessage(
            vscode.l10n.t('Commit failed: {0}', String(commitErr)),
          );
          try {
            await this.gitService.resetIndex(repoRoot);
          } catch {
            // Best effort restore.
          }
        }

        if (savedIndex) {
          try {
            await this.gitService.applyPatchToIndex(repoRoot, savedIndex);
          } catch {
            // Best effort restore.
          }
        }
      } catch (err) {
        vscode.window.showErrorMessage(
          vscode.l10n.t('Commit failed: {0}', String(err)),
        );
      }
    }

    if (totalFiles > 0) {
      vscode.window.showInformationMessage(
        andPush
          ? vscode.l10n.t('Successfully committed and pushed {0} file(s)', totalFiles)
          : vscode.l10n.t('Successfully committed {0} file(s)', totalFiles),
      );
    }

    this.manager.clearSelectionForChangelist(changelistId);
    this.view?.webview.postMessage({ type: 'committed' });
    await this.manager.refresh();
  }

  private getHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    padding: 8px;
  }
  .select-wrap { margin-bottom: 8px; }
  select {
    width: 100%;
    padding: 4px 6px;
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 2px;
    font-size: var(--vscode-font-size);
    outline: none;
  }
  select:focus { border-color: var(--vscode-focusBorder); }
  textarea {
    width: 100%;
    min-height: 60px;
    padding: 6px 8px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    resize: vertical;
    outline: none;
    margin-bottom: 8px;
  }
  textarea:focus { border-color: var(--vscode-focusBorder); }
  textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
  .btn-row { display: flex; gap: 6px; }
  button {
    flex: 1;
    padding: 6px 12px;
    border: none;
    border-radius: 2px;
    font-size: var(--vscode-font-size);
    cursor: pointer;
    font-family: var(--vscode-font-family);
  }
  .btn-primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
  .btn-secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button:disabled { opacity: 0.5; cursor: default; }
  .empty {
    color: var(--vscode-descriptionForeground);
    font-style: italic;
    text-align: center;
    padding: 16px 0;
  }
  .file-list {
    margin-bottom: 8px;
    max-height: 300px;
    overflow-y: auto;
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, transparent));
    border-radius: 2px;
  }
  .file-item {
    display: flex;
    align-items: center;
    padding: 3px 6px;
    gap: 4px;
    cursor: pointer;
  }
  .file-item:hover { background: var(--vscode-list-hoverBackground); }
  .file-item input[type="checkbox"] { flex-shrink: 0; }
  .file-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file-status { flex-shrink: 0; font-size: 0.85em; opacity: 0.7; }
  .hunk-item {
    display: flex;
    align-items: center;
    padding: 2px 6px 2px 24px;
    gap: 4px;
    cursor: pointer;
    font-size: 0.9em;
    opacity: 0.85;
  }
  .hunk-item:hover { background: var(--vscode-list-hoverBackground); }
  .hunk-info {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hunk-stats { flex-shrink: 0; font-size: 0.85em; opacity: 0.7; }
  .diff-btn {
    flex-shrink: 0;
    display: none;
    background: none;
    border: none;
    padding: 0 2px;
    color: var(--vscode-textLink-foreground);
    cursor: pointer;
    font-size: 0.85em;
    opacity: 0.8;
    line-height: 1;
  }
  .file-item:hover .diff-btn,
  .hunk-item:hover .diff-btn { display: inline-block; }
  .diff-btn:hover { opacity: 1; text-decoration: underline; }
  .select-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-bottom: 4px;
    font-size: 0.85em;
  }
  .select-actions a {
    color: var(--vscode-textLink-foreground);
    cursor: pointer;
    text-decoration: none;
  }
  .select-actions a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <div id="root">
    <div class="empty" id="emptyMsg"></div>
    <div id="form" style="display:none">
      <div class="select-wrap"><select id="clSelect"></select></div>
      <textarea id="msgInput" rows="3"></textarea>
      <div class="select-actions" id="selectActions" style="display:none">
        <a id="selectAllBtn"></a>
        <a id="deselectAllBtn"></a>
      </div>
      <div class="file-list" id="fileList" style="display:none"></div>
      <div class="btn-row">
        <button class="btn-primary" id="commitBtn"></button>
        <button class="btn-secondary" id="pushBtn"></button>
      </div>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const clSelect = document.getElementById('clSelect');
    const msgInput = document.getElementById('msgInput');
    const commitBtn = document.getElementById('commitBtn');
    const pushBtn = document.getElementById('pushBtn');
    const form = document.getElementById('form');
    const emptyMsg = document.getElementById('emptyMsg');
    const fileList = document.getElementById('fileList');
    const selectActions = document.getElementById('selectActions');
    const selectAllBtn = document.getElementById('selectAllBtn');
    const deselectAllBtn = document.getElementById('deselectAllBtn');

    let i18n = {};
    let userEditedMessage = false;

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'update') {
        i18n = msg.i18n;
        renderChangelists(msg.changelists, msg.selectedChangelistId);
      } else if (msg.type === 'filesUpdate') {
        renderFiles(msg.files || []);
        if (!userEditedMessage) {
          msgInput.value = msg.description || '';
        }
      } else if (msg.type === 'committed') {
        msgInput.value = '';
        userEditedMessage = false;
      }
    });

    msgInput.addEventListener('input', () => {
      userEditedMessage = true;
    });

    function renderChangelists(changelists, selectedChangelistId) {
      commitBtn.textContent = i18n.commit || 'Commit';
      pushBtn.textContent = i18n.commitAndPush || 'Commit and Push';
      msgInput.placeholder = i18n.placeholder || '';
      selectAllBtn.textContent = i18n.selectAll || 'Select All';
      deselectAllBtn.textContent = i18n.deselectAll || 'Deselect All';
      const filesTpl = i18n.files || '{0} file(s)';

      if (!changelists || changelists.length === 0) {
        form.style.display = 'none';
        emptyMsg.style.display = 'block';
        emptyMsg.textContent = i18n.noChangelists || 'No changelists';
        return;
      }

      form.style.display = 'block';
      emptyMsg.style.display = 'none';
      const previousValue = clSelect.value;
      clSelect.innerHTML = '';

      for (const changelist of changelists) {
        const option = document.createElement('option');
        option.value = changelist.id;
        option.textContent =
          changelist.name + ' (' + filesTpl.replace('__COUNT__', changelist.fileCount) + ')';
        if (changelist.fileCount === 0) {
          option.disabled = true;
        }
        clSelect.appendChild(option);
      }

      const options = [...clSelect.options];
      const canSelect = (id) => id && options.some((option) => option.value === id && !option.disabled);
      let nextValue = '';
      if (canSelect(selectedChangelistId)) {
        nextValue = selectedChangelistId;
      } else if (canSelect(previousValue)) {
        nextValue = previousValue;
      } else {
        const active = changelists.find((item) => item.isActive && item.fileCount > 0);
        const first = changelists.find((item) => item.fileCount > 0);
        if (active) {
          nextValue = active.id;
        } else if (first) {
          nextValue = first.id;
        }
      }

      const selectionChanged = previousValue !== nextValue;
      if (nextValue) {
        clSelect.value = nextValue;
      }
      updateBtnState();
      if (selectionChanged) {
        requestFiles();
      }
    }

    function requestFiles() {
      const selectedId = clSelect.value;
      if (!selectedId) {
        return;
      }
      userEditedMessage = false;
      vscode.postMessage({ type: 'changelistSelected', changelistId: selectedId });
    }

    function renderFiles(files) {
      fileList.innerHTML = '';

      if (!files || files.length === 0) {
        fileList.style.display = 'none';
        selectActions.style.display = 'none';
        updateBtnState();
        return;
      }

      fileList.style.display = 'block';
      selectActions.style.display = 'flex';
      const linesTpl = i18n.lines || 'Lines __START__-__END__';

      for (const file of files) {
        const hasMultiHunks = file.hunks.length > 1;
        const fileDiv = document.createElement('div');
        fileDiv.className = 'file-item';

        const fileCb = document.createElement('input');
        fileCb.type = 'checkbox';
        fileCb.checked = file.checked;
        fileCb.dataset.filePath = file.absolutePath;
        fileCb.className = 'file-cb';

        const fileName = document.createElement('span');
        fileName.className = 'file-name';
        fileName.textContent = file.relativePath;
        fileName.title = file.absolutePath;

        const statusSpan = document.createElement('span');
        statusSpan.className = 'file-status';
        statusSpan.textContent = '[' + file.status + ']';

        const diffBtn = document.createElement('button');
        diffBtn.className = 'diff-btn';
        diffBtn.title = i18n.previewDiff || 'Preview diff';
        diffBtn.textContent = i18n.diff || 'Diff';
        diffBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          vscode.postMessage({ type: 'openDiff', absolutePath: file.absolutePath });
        });

        fileDiv.appendChild(fileCb);
        fileDiv.appendChild(fileName);
        fileDiv.appendChild(statusSpan);
        fileDiv.appendChild(diffBtn);
        fileDiv.addEventListener('click', (event) => {
          if (event.target !== fileCb && event.target !== diffBtn) {
            fileCb.checked = !fileCb.checked;
            fileCb.dispatchEvent(new Event('change'));
          }
        });
        fileList.appendChild(fileDiv);

        fileCb.addEventListener('change', () => {
          if (hasMultiHunks) {
            const hunkCbs = fileList.querySelectorAll(
              '.hunk-cb[data-parent-file="' + CSS.escape(file.absolutePath) + '"]',
            );
            hunkCbs.forEach((checkbox) => {
              checkbox.checked = fileCb.checked;
              checkbox.dispatchEvent(new Event('change'));
            });
            fileCb.indeterminate = false;
          } else {
            vscode.postMessage({
              type: 'fileSelectionChanged',
              filePath: file.absolutePath,
              checked: fileCb.checked,
            });
          }
          updateBtnState();
        });

        if (!hasMultiHunks) {
          continue;
        }

        for (const hunk of file.hunks) {
          const hunkDiv = document.createElement('div');
          hunkDiv.className = 'hunk-item';

          const hunkCb = document.createElement('input');
          hunkCb.type = 'checkbox';
          hunkCb.checked = hunk.checked;
          hunkCb.dataset.hunkId = hunk.id;
          hunkCb.dataset.parentFile = file.absolutePath;
          hunkCb.className = 'hunk-cb';

          const hunkInfo = document.createElement('span');
          hunkInfo.className = 'hunk-info';
          let hunkLine = 0;
          const match = hunk.header.match(/@@ -\\d+(?:,\\d+)? \\+(\\d+)(?:,(\\d+))? @@/);
          if (match) {
            const start = parseInt(match[1], 10);
            const count = parseInt(match[2] || '1', 10);
            hunkLine = start;
            hunkInfo.textContent = linesTpl
              .replace('__START__', String(start))
              .replace('__END__', String(start + count - 1));
          } else {
            hunkInfo.textContent = hunk.header || (i18n.hunk || 'Hunk');
          }

          const hunkStats = document.createElement('span');
          hunkStats.className = 'hunk-stats';
          hunkStats.textContent = '+' + hunk.addCount + ' -' + hunk.delCount;

          const hunkDiffBtn = document.createElement('button');
          hunkDiffBtn.className = 'diff-btn';
          hunkDiffBtn.title = i18n.previewDiff || 'Preview diff';
          hunkDiffBtn.textContent = i18n.diff || 'Diff';
          hunkDiffBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            vscode.postMessage({
              type: 'openDiff',
              absolutePath: file.absolutePath,
              line: hunkLine,
            });
          });

          hunkDiv.appendChild(hunkCb);
          hunkDiv.appendChild(hunkInfo);
          hunkDiv.appendChild(hunkStats);
          hunkDiv.appendChild(hunkDiffBtn);
          hunkDiv.addEventListener('click', (event) => {
            if (event.target !== hunkCb && event.target !== hunkDiffBtn) {
              hunkCb.checked = !hunkCb.checked;
              hunkCb.dispatchEvent(new Event('change'));
            }
          });
          fileList.appendChild(hunkDiv);

          hunkCb.addEventListener('change', () => {
            updateFileCheckFromHunks(file.absolutePath);
            vscode.postMessage({
              type: 'hunkSelectionChanged',
              hunkId: hunk.id,
              checked: hunkCb.checked,
            });
            updateBtnState();
          });
        }
      }

      fileList.querySelectorAll('.file-cb').forEach((checkbox) => {
        updateFileCheckFromHunks(checkbox.dataset.filePath);
      });
      updateBtnState();
    }

    function updateFileCheckFromHunks(filePath) {
      if (!filePath) {
        return;
      }
      const hunkCbs = fileList.querySelectorAll(
        '.hunk-cb[data-parent-file="' + CSS.escape(filePath) + '"]',  
      );
      const fileCb = fileList.querySelector(
        '.file-cb[data-file-path="' + CSS.escape(filePath) + '"]',  
      );
      if (!fileCb || hunkCbs.length === 0) {
        return;
      }
      const allChecked = [...hunkCbs].every((checkbox) => checkbox.checked);
      const someChecked = [...hunkCbs].some((checkbox) => checkbox.checked);
      fileCb.checked = someChecked;
      fileCb.indeterminate = someChecked && !allChecked;
    }

    function getSelection() {
      const selectedFiles = [];
      const selectedHunks = [];
      const fileCbs = fileList.querySelectorAll('.file-cb');

      for (const fileCb of fileCbs) {
        const filePath = fileCb.dataset.filePath;
        const hunkCbs = fileList.querySelectorAll(
          '.hunk-cb[data-parent-file="' + CSS.escape(filePath) + '"]', 
        );

        if (hunkCbs.length === 0) {
          if (fileCb.checked) {
            selectedFiles.push(filePath);
          }
          continue;
        }

        let anySelected = false;
        for (const hunkCb of hunkCbs) {
          if (hunkCb.checked) {
            selectedHunks.push(hunkCb.dataset.hunkId);
            anySelected = true;
          }
        }
        if (anySelected) {
          selectedFiles.push(filePath);
        }
      }

      return { selectedFiles, selectedHunks };
    }

    function updateBtnState() {
      const selectedOption = clSelect.options[clSelect.selectedIndex];
      const selection = getSelection();
      const hasSelection =
        selection.selectedFiles.length > 0 || selection.selectedHunks.length > 0;
      const disabled = !selectedOption || selectedOption.disabled || !hasSelection;
      commitBtn.disabled = disabled;
      pushBtn.disabled = disabled;
    }

    clSelect.addEventListener('change', () => {
      updateBtnState();
      requestFiles();
    });

    selectAllBtn.addEventListener('click', () => {
      fileList.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
        checkbox.checked = true;
        checkbox.indeterminate = false;
      });
      vscode.postMessage({ type: 'selectAll', changelistId: clSelect.value });
      updateBtnState();
    });

    deselectAllBtn.addEventListener('click', () => {
      fileList.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
        checkbox.checked = false;
        checkbox.indeterminate = false;
      });
      vscode.postMessage({ type: 'deselectAll', changelistId: clSelect.value });
      updateBtnState();
    });

    commitBtn.addEventListener('click', () => {
      const message = msgInput.value.trim();
      if (!message) {
        msgInput.focus();
        return;
      }
      vscode.postMessage({
        type: 'commit',
        changelistId: clSelect.value,
        message,
      });
    });

    pushBtn.addEventListener('click', () => {
      const message = msgInput.value.trim();
      if (!message) {
        msgInput.focus();
        return;
      }
      vscode.postMessage({
        type: 'commitAndPush',
        changelistId: clSelect.value,
        message,
      });
    });

    msgInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        commitBtn.click();
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }

  dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
  }
}
