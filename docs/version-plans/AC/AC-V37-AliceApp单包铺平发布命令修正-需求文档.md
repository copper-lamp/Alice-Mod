# AC-V37 Alice-App 单包铺平发布命令修正 - 需求文档

> 日期：2026-07-24
> 模块：Agent Core 发布工作流
> 类型：需求文档

## 1. 背景

`sync-ac.yml` 会将 `packages/agent-core` 的内容直接复制到 `Alice-App` 仓库根目录，而不是保留 `packages/agent-core` 层级。

## 2. 问题定义

在这种单包铺平结构下，`pnpm --filter @mcagent/agent-core dist:win` 会报：`No projects matched the filters`。

## 3. 根因

目标仓库目录结构与源 monorepo 不一致：
- 源仓库：`packages/agent-core`
- 目标仓库：`agent-core` 内容直接位于根目录

因此目标仓库 release workflow 不能再使用 workspace filter 方式定位 `@mcagent/agent-core`。

## 4. 目标

1. 让 release workflow 使用与目标仓库结构一致的根目录命令
2. 保持源仓库与目标仓库各自命令语义清晰

## 5. 验收标准

1. 目标仓库 release workflow 不再使用 `--filter @mcagent/agent-core`
2. 目标仓库可以直接在根目录执行 Windows 打包脚本
3. GitHub Actions 不再报 `No projects matched the filters`
