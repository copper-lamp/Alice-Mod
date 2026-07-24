# AC-V36 Alice-App 发布命令修复 - 执行文档

> 日期：2026-07-24
> 模块：Agent Core 发布工作流
> 类型：执行文档

## 1. 执行步骤

1. 检查 `agent-core` 是否声明 `electron-builder`
2. 确认当前 workflow 在根目录错误执行 `pnpm electron-builder`
3. 在 `agent-core` 中新增 `dist:win` 脚本
4. 将目标仓库 release workflow 改为执行：
   `pnpm --filter @mcagent/agent-core dist:win`

## 2. 当前代码修改

已在 [agent-core/package.json](file:///D:/McAgent/packages/agent-core/package.json) 新增：

- `dist:win`: `electron-builder --win --publish never`

## 3. 后续需要在目标仓库执行的修改

将 `Alice-App` release workflow 中的：

```yaml
- run: pnpm electron-builder -- --publish never
```

改为：

```yaml
- run: pnpm --filter @mcagent/agent-core dist:win
```

## 4. 验证方式

1. 触发同步到 `Alice-App`
2. 更新 `Alice-App` release workflow
3. 重新执行 workflow
4. 确认 Electron 打包阶段不再报 `Command "electron-builder" not found`
