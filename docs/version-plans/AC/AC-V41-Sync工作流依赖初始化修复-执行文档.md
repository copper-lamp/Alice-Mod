# AC-V41-Sync工作流依赖初始化修复-执行文档

## 执行
1. 在 `sync-ac.yml` 中增加 pnpm 环境初始化步骤。
2. 增加 Node 22 配置与 pnpm cache。
3. 在预构建 shared 前执行 `pnpm install --no-frozen-lockfile`。
4. 保留已有的 `Build shared before sync` 与后续同步逻辑。

## 验证
- 重新触发 sync workflow。
- 确认 `Build shared before sync` 前不再报缺少 pnpm。
- 确认 Alice-App 同步结果包含 `packages/shared/dist`。
