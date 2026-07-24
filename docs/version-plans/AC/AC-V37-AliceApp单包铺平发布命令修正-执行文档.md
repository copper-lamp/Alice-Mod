# AC-V37 Alice-App 单包铺平发布命令修正 - 执行文档

> 日期：2026-07-24
> 模块：Agent Core 发布工作流
> 类型：执行文档

## 1. 执行步骤

1. 检查 `sync-ac.yml` 的同步目录布局
2. 确认 `agent-core` 内容被铺平复制到 `Alice-App` 根目录
3. 停止在 `Alice-App` 中使用 `--filter @mcagent/agent-core`
4. 将 `Alice-App` release workflow 改为直接执行根目录脚本：`pnpm dist:win`

## 2. 当前代码修改

- 在 [agent-core/package.json](file:///D:/McAgent/packages/agent-core/package.json) 中保留 `dist:win`
- 在 [package.json](file:///D:/McAgent/package.json) 中新增源仓库侧辅助脚本 `dist:win`，用于本地从 monorepo 根调用
- 在 [sync-ac.yml](file:///D:/McAgent/.github/workflows/sync-ac.yml) 注释中明确说明 Alice-App 为单包铺平结构

## 3. 目标仓库应使用的命令

将 `Alice-App` release workflow 中的：

```yaml
- run: pnpm --filter @mcagent/agent-core dist:win
```

改为：

```yaml
- run: pnpm dist:win
```

## 4. 验证方式

1. 触发同步到 `Alice-App`
2. 确认同步后的根目录包含 `package.json`、`dist:win` 脚本和 Electron 配置
3. 重新运行 release workflow
4. 确认不再报 `No projects matched the filters`
