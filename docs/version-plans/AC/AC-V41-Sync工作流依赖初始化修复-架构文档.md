# AC-V41-Sync工作流依赖初始化修复-架构文档

## 架构
- `sync-ac.yml` 在检测到需要同步后，先初始化 CI 环境：
  - `pnpm/action-setup@v4`
  - `actions/setup-node@v4`
  - `pnpm install --no-frozen-lockfile`
- 环境就绪后再执行 `packages/shared` 的预构建。
- 最后再同步产物到 Alice-App。

## 影响范围
- 仅影响同步工作流。
- 不改变 Alice-App release workflow 逻辑。
