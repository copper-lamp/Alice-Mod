# AC-V36 Alice-App 发布命令修复 - 架构文档

> 日期：2026-07-24
> 模块：Agent Core 发布工作流
> 类型：架构文档

## 1. 命令上下文问题

pnpm 在 workspace 中执行可执行文件时，依赖当前包上下文。

当前失败链路：
1. workflow 在仓库根执行 `pnpm electron-builder -- --publish never`
2. 根包并不声明 `electron-builder`
3. `electron-builder` 只存在于 `@mcagent/agent-core` 的 devDependencies
4. pnpm 在根上下文中找不到该二进制命令

## 2. 修复策略

将发布命令下沉为包级脚本：
- 在 `@mcagent/agent-core` 中定义 `dist:win`
- 由 workflow 使用 `pnpm --filter @mcagent/agent-core dist:win` 调用

## 3. 优势

1. 命令与依赖归属一致
2. 不依赖目标仓库根 package.json 的额外封装
3. 本地和 CI 统一使用同一脚本
