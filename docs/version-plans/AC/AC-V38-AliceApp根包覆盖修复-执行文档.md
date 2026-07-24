# AC-V38 Alice-App 根包覆盖修复 - 执行文档

> 日期：2026-07-24
> 模块：Agent Core 发布同步与构建
> 类型：执行文档

## 1. 执行步骤

1. 检查 `sync-ac.yml` 的复制顺序
2. 确认 `packages/agent-core/*` 已先复制到 `Alice-App` 根目录
3. 识别出 monorepo 根 `package.json` 被再次复制并覆盖根包定义
4. 删除该覆盖步骤
5. 保留 lockfile 与 workspace 辅助文件同步

## 2. 当前修改

已更新 [sync-ac.yml](file:///D:/McAgent/.github/workflows/sync-ac.yml)：

- 生成：`pnpm-workspace.yaml`（包含 `.` 与 `packages/*`）
- 保留：`pnpm-lock.yaml`
- 保留：`.npmrc`
- 保留：`tsconfig.json`
- 移除：复制 monorepo 根 `package.json`

## 3. 目标仓库最终执行方式

`Alice-App` release workflow 继续使用：

```yaml
- run: pnpm dist:win
```

前提是先让新的 `sync-ac.yml` 生效，把正确的根 `package.json` 同步过去。

## 4. 验证方式

1. 重新触发 `sync-ac.yml`
2. 检查 `Alice-App` 根目录的 `package.json` 是否为 `@mcagent/agent-core` 包定义
3. 重新运行 release workflow
4. 确认 `pnpm dist:win` 不再报 `electron-builder` 不存在
