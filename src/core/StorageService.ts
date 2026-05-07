import * as vscode from 'vscode';
import { ChangelistState, Changelist, STATE_VERSION, UNVERSIONED_CHANGELIST_ID } from '../types/index';

const STORAGE_KEY = 'gitChangelists.state';

function createDefaultChangelist(): Changelist {
  return {
    id: 'default',
    name: 'Changes',
    description: '',
    isDefault: true,
    isActive: true,
    sortOrder: 0,
    isDontCommit: false,
    isUnversioned: false,
  };
}

function createUnversionedChangelist(): Changelist {
  return {
    id: UNVERSIONED_CHANGELIST_ID,
    name: 'Unversioned Files',
    description: '',
    isDefault: false,
    isActive: false,
    sortOrder: 999999,
    isDontCommit: false,
    isUnversioned: true,
  };
}

function createDefaultState(): ChangelistState {
  return {
    changelists: [createDefaultChangelist(), createUnversionedChangelist()],
    assignments: [],
    version: STATE_VERSION,
    fileHistory: {},
  };
}

export class StorageService {
  private state: ChangelistState;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.state = this.load();
  }

  private load(): ChangelistState {
    const raw = this.context.workspaceState.get<ChangelistState>(STORAGE_KEY);
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.changelists)) {
      return createDefaultState();
    }
    if (raw.version !== STATE_VERSION) {
      return this.migrate(raw);
    }
    // Ensure default changelist always exists
    const hasDefault = raw.changelists.some((c) => c.isDefault);
    if (!hasDefault) {
      raw.changelists.unshift(createDefaultChangelist());
    }
    // Ensure unversioned changelist always exists
    const hasUnversioned = raw.changelists.some((c) => c.isUnversioned);
    if (!hasUnversioned) {
      raw.changelists.push(createUnversionedChangelist());
    }
    // Ensure all changelists have description field (migration from older versions)
    for (const cl of raw.changelists) {
      if (cl.description === undefined) {
        cl.description = '';
      }
    }
    return raw;
  }

  private migrate(raw: ChangelistState): ChangelistState {
    // Currently only v1 exists; future migrations go here
    return {
      ...raw,
      version: STATE_VERSION,
      fileHistory: raw.fileHistory || {},
    };
  }

  getState(): ChangelistState {
    return this.state;
  }

  setState(state: ChangelistState): void {
    this.state = state;
    this.debouncedSave();
  }

  private debouncedSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.flush();
    }, 100);
  }

  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    this.context.workspaceState.update(STORAGE_KEY, this.state);
  }

  resetState(): void {
    this.state = createDefaultState();
    this.flush();
  }

  dispose(): void {
    this.flush();
  }
}
