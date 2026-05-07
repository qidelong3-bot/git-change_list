# Git Changelists

[![VS Code Version](https://img.shields.io/badge/VS%20Code-%5E1.85.0-blue)](https://code.visualstudio.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> PhpStorm-like changelist management for Git repositories in VS Code.

[中文文档](README.zh-cn.md)

## Features

- **Changelist Management**: Create, rename, and delete changelists to organize your Git changes.
- **File-level & Hunk-level Moves**: Move entire files or specific code hunks between changelists.
- **Drag & Drop**: Intuitive drag-and-drop support for reorganizing changes across changelists and repositories.
- **Selective Commit**: Commit only the changes in a specific changelist, similar to JetBrains IDEs.
- **Multi-Repository Support**: Visual color indicators for different repositories in multi-root workspaces.
- **Diff Preview**: Open diff views directly from the changelist tree.
- **Persistent State**: Changelist configurations are saved and restored across VS Code sessions.

## Requirements

- VS Code 1.85.0 or higher
- Built-in `vscode.git` extension (automatically installed)

## Installation

1. Open VS Code.
2. Go to the Extensions view (`Ctrl+Shift+X`).
3. Search for **Git Changelists**.
4. Click **Install**.

Or install via CLI:

```bash
code --install-extension git-changelists-0.1.0.vsix
```

## Usage

1. Open a workspace containing Git repositories.
2. Click the **Git Changelists** icon in the Activity Bar.
3. Use the toolbar buttons or context menus to:
   - Create new changelists
   - Move files/hunks between changelists
   - Commit or commit-and-push a changelist

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `gitChangelists.autoRefreshInterval` | `number` | `3000` | Polling interval for git status changes (ms) |
| `gitChangelists.showUnversioned` | `boolean` | `true` | Show unversioned/untracked files |
| `gitChangelists.confirmDeleteChangelist` | `boolean` | `true` | Ask for confirmation before deleting a changelist |

## Commands

| Command | Title |
|---------|-------|
| `gitChangelists.createChangelist` | Create Changelist |
| `gitChangelists.deleteChangelist` | Delete Changelist |
| `gitChangelists.renameChangelist` | Rename Changelist |
| `gitChangelists.moveFileToChangelist` | Move File to Changelist... |
| `gitChangelists.moveHunkToChangelist` | Move Hunk to Changelist... |
| `gitChangelists.commitChangelist` | Commit Changelist |
| `gitChangelists.commitAndPushChangelist` | Commit and Push Changelist |
| `gitChangelists.openDiff` | Open Diff |
| `gitChangelists.resetState` | Reset Extension State |

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

This project is licensed under the [MIT License](LICENSE).
