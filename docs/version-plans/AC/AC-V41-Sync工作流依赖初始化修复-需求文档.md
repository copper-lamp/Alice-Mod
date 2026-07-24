# AC-V41-Sync工作流依赖初始化修复-需求文档

## 需求
- `sync-ac.yml` 在同步前需要构建 `packages/shared`。
- GitHub Actions runner 上必须先安装 pnpm、Node 和工作区依赖，避免 `pnpm: command not found`。

## 目标
- `Build shared before sync` 能在 CI 中稳定运行。
- 同步到 Alice-App 的 shared 包始终包含最新 dist 产物。

## 验收
- sync workflow 不再出现 `pnpm: command not found`。
- `packages/shared/dist` 能被成功构建并同步。
