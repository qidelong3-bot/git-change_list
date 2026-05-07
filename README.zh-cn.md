# Git 变更列表

[![VS Code Version](https://img.shields.io/badge/VS%20Code-%5E1.85.0-blue)](https://code.visualstudio.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> 在 VS Code 中实现类似 PhpStorm 的 Git 变更分组管理。

[English README](README.md)

## 功能特性

- **变更列表管理**：创建、重命名和删除变更列表，以组织您的 Git 变更。
- **文件级与代码块级移动**：在变更列表之间移动整个文件或特定的代码块。
- **拖拽交互**：直观的拖拽支持，可在变更列表和仓库之间重新组织变更。
- **选择提交**：仅提交特定变更列表中的更改，类似于 JetBrains IDE 的体验。
- **多仓库支持**：在多根工作区中为不同仓库提供可视化颜色标识。
- **差异预览**：直接从变更列表树打开差异对比视图。
- **状态持久化**：变更列表配置在 VS Code 会话之间保存和恢复。

## 环境要求

- VS Code 1.85.0 或更高版本
- 内置的 `vscode.git` 扩展（自动安装）

## 安装方式

1. 打开 VS Code。
2. 进入扩展视图（`Ctrl+Shift+X`）。
3. 搜索 **Git 变更列表**。
4. 点击 **安装**。

或通过命令行安装：

```bash
code --install-extension git-changelists-0.1.0.vsix
```

## 使用方法

1. 打开包含 Git 仓库的工作区。
2. 点击活动栏中的 **Git 变更列表** 图标。
3. 使用工具栏按钮或右键菜单来：
   - 创建新的变更列表
   - 在变更列表之间移动文件或代码块
   - 提交或提交并推送变更列表

## 配置项

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `gitChangelists.autoRefreshInterval` | `number` | `3000` | Git 状态变更的轮询间隔（毫秒） |
| `gitChangelists.showUnversioned` | `boolean` | `true` | 显示未纳入版本管理的文件 |
| `gitChangelists.confirmDeleteChangelist` | `boolean` | `true` | 删除变更列表前是否需要确认 |

## 可用命令

| 命令 | 标题 |
|------|------|
| `gitChangelists.createChangelist` | 创建变更列表 |
| `gitChangelists.deleteChangelist` | 删除变更列表 |
| `gitChangelists.renameChangelist` | 重命名变更列表 |
| `gitChangelists.moveFileToChangelist` | 移动文件到变更列表... |
| `gitChangelists.moveHunkToChangelist` | 移动代码块到变更列表... |
| `gitChangelists.commitChangelist` | 提交变更列表 |
| `gitChangelists.commitAndPushChangelist` | 提交并推送变更列表 |
| `gitChangelists.openDiff` | 打开差异对比 |
| `gitChangelists.resetState` | 重置扩展状态 |

## 参与贡献

欢迎提交 Issue 或 Pull Request 参与贡献！

## 开源协议

本项目基于 [MIT 协议](LICENSE) 开源。
