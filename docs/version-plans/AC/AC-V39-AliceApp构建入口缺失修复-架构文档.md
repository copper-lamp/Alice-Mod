# AC-V39 Alice-App 构建入口缺失修复 - 架构文档

> 日期：2026-07-24
> 模块：Agent Core 发布构建
> 类型：架构文档

## 1. 结构冲突

### Alice-App 当前结构
- 根目录：同步后的 `agent-core` 包
- `packages/shared`：共享包

### 被错误同步的文件
- `pnpm-workspace.yaml`（来源于 monorepo）

该文件只声明：
- `packages/*`

因此在 Alice-App 中会产生错误语义：
- 根目录不是 workspace 成员
- `packages/shared` 才是 workspace 成员

## 2. 结果

构建命令 `pnpm -r build` 在该结构下只会递归到 `packages/shared`，而不会构建根目录 `agent-core`。

## 3. 修复策略

1. 停止同步 `pnpm-workspace.yaml`
2. release workflow 构建步骤优先显式运行根目录 `pnpm build`
3. 如需 shared 包参与构建，可单独执行 `pnpm --dir packages/shared build`

## 4. 设计原则

单包目标仓库不应携带 monorepo workspace 描述文件，否则会让工具链错误推断包边界与构建入口。
