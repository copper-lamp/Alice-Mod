# AC-V38 Alice-App 根包覆盖修复 - 架构文档

> 日期：2026-07-24
> 模块：Agent Core 发布同步与构建
> 类型：架构文档

## 1. 同步链路

当前同步顺序：
1. 将 `packages/agent-core/*` 复制到 `Alice-App` 根目录
2. 将 `packages/shared` 复制到 `Alice-App/packages/shared`
3. 将部分 monorepo 根文件复制到 `Alice-App` 根目录

## 2. 架构问题

步骤 3 中如果复制根 `package.json`，会破坏步骤 1 刚建立的单包根结构。

根目录会从：
- `@mcagent/agent-core` 包定义

变成：
- `mcagent` monorepo 根定义

这会导致：
- 根脚本发生变化
- devDependencies 丢失 `electron-builder`
- 打包命令运行上下文错误

## 3. 修复策略

保留以下根级同步文件：
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `.npmrc`
- `tsconfig.json`

移除以下覆盖行为：
- 不再复制 monorepo 根 `package.json`

这样目标仓库根目录将保持为同步后的 `agent-core` 包，同时仍可使用 pnpm 锁文件与工作区辅助配置。
