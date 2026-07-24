# AC-V36 Alice-App 发布命令修复 - 需求文档

> 日期：2026-07-24
> 模块：Agent Core 发布工作流
> 类型：需求文档

## 1. 背景

`Alice-App` 的 GitHub Actions 在构建完成后继续执行 Electron 打包。

## 2. 问题定义

当前发布命令为 `pnpm electron-builder -- --publish never`，在目标仓库中报错：`Command "electron-builder" not found`。

## 3. 根因

`electron-builder` 定义在 [agent-core/package.json](file:///D:/McAgent/packages/agent-core/package.json) 的 `devDependencies` 中，而不是目标仓库根包的依赖。

因此在仓库根目录直接执行 `pnpm electron-builder` 时，pnpm 无法从根包上下文解析出该命令。

## 4. 目标

1. 为 `agent-core` 提供明确的 Windows 打包脚本
2. 让目标仓库 release workflow 在 `agent-core` 包上下文执行该脚本
3. 避免依赖根目录命令解析行为

## 5. 验收标准

1. `packages/agent-core/package.json` 存在 `dist:win` 脚本
2. 目标仓库 release workflow 改为调用 `pnpm --filter @mcagent/agent-core dist:win`
3. GitHub Actions 不再报 `electron-builder not found`
