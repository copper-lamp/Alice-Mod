# AC-V39 Alice-App 构建入口缺失修复 - 需求文档

> 日期：2026-07-24
> 模块：Agent Core 发布构建
> 类型：需求文档

## 1. 背景

`Alice-App` 已能够进入 electron-builder 打包阶段，但在检查应用入口时失败，提示 `dist/main/index.js` 不存在。

## 2. 问题定义

Electron Builder 读取根 `package.json` 的 `main` 字段为 `dist/main/index.js`，但 release workflow 的构建步骤并未真正生成该文件。

## 3. 根因

`Alice-App` 采用单包铺平结构，但同步流程仍复制了 monorepo 的 `pnpm-workspace.yaml`。该 workspace 配置只包含 `packages/*`，会导致根目录的 `agent-core` 包不被递归构建纳入。

结果是：
- `pnpm -r build` 只构建 `packages/shared`
- 根目录 `agent-core` 的 `electron-vite build` 未执行
- `dist/main/index.js` 缺失

## 4. 目标

1. 确保 `Alice-App` 根目录的 `agent-core` 包参与构建
2. 保证 electron-builder 打包前已生成 `dist/main/index.js`
3. 避免 monorepo workspace 配置污染单包仓库行为

## 5. 验收标准

1. `sync-ac.yml` 不再同步 `pnpm-workspace.yaml` 到 `Alice-App`
2. `Alice-App` release workflow 构建后存在 `dist/main/index.js`
3. electron-builder 不再报应用入口文件不存在
