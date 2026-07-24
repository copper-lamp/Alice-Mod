# AC-V37 Alice-App 单包铺平发布命令修正 - 架构文档

> 日期：2026-07-24
> 模块：Agent Core 发布工作流
> 类型：架构文档

## 1. 结构差异

### 源仓库 McAgent

- monorepo 根目录包含 workspace 定义
- `agent-core` 位于 `packages/agent-core`

### 目标仓库 Alice-App

- 通过 `sync-ac.yml` 同步后，`agent-core` 文件直接落在仓库根目录
- 不再保留 `packages/agent-core` 目录层级

## 2. 命令影响

因此两边命令应区分：

### 源仓库
可使用：
- `pnpm dist:win`（根脚本自动识别 monorepo 结构并转发到 `packages/agent-core`）
- 或 `pnpm --filter @mcagent/agent-core dist:win`

### 目标仓库
应使用：
- `pnpm dist:win`

因为目标仓库根目录本身就是同步后的 `agent-core` 包，根脚本会直接在当前目录执行 electron-builder。

## 3. 设计原则

1. 命令必须与目录结构一致
2. 不在单包仓库中使用 workspace filter 定位不存在的包路径
3. 保持同步策略与发布命令配套
