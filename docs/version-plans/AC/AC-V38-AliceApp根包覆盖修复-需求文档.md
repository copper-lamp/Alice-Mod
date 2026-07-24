# AC-V38 Alice-App 根包覆盖修复 - 需求文档

> 日期：2026-07-24
> 模块：Agent Core 发布同步与构建
> 类型：需求文档

## 1. 背景

`sync-ac.yml` 会将 `packages/agent-core` 同步到 `Alice-App` 仓库根目录，并由 `Alice-App` 的 release workflow 在根目录执行打包。

## 2. 问题定义

虽然 `agent-core/package.json` 已包含 `electron-builder` 依赖和 `dist:win` 脚本，但目标仓库执行 `pnpm dist:win` 时依然提示 `electron-builder` 不存在。

## 3. 根因

同步流程先把 `packages/agent-core/*` 复制到目标仓库根目录，随后又把 monorepo 根 `package.json` 覆盖到同一路径。

结果：
1. `Alice-App` 根目录最终不再是 `agent-core` 包
2. 根目录缺失 `electron-builder` 依赖定义
3. `pnpm dist:win` 落到错误的根包上下文执行，导致命令找不到

## 4. 目标

1. 保证 `Alice-App` 根目录的 `package.json` 保持为 `agent-core` 自身定义
2. 保留 lockfile 等辅助文件，并生成适配 Alice-App 的专用 workspace 配置
3. 让 `Alice-App` release workflow 可直接执行 `pnpm dist:win`

## 5. 验收标准

1. `sync-ac.yml` 不再复制 monorepo 根 `package.json` 到 `Alice-App`
2. `Alice-App` 根目录保留 `agent-core/package.json` 的内容
3. `pnpm dist:win` 能在目标仓库找到 `electron-builder`
