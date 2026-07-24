# AC-V35 Alice-App 发布工作流锁文件修复 - 执行文档

> 日期：2026-07-24
> 模块：Agent Core 发布同步与 GitHub Actions
> 类型：执行文档

## 1. 执行步骤

1. 检查当前仓库中的 workflow 与根级锁文件位置
2. 确认 `Alice-App` 报错发生在 `setup-node` 的 pnpm 缓存阶段
3. 检查 `sync-ac.yml` 是否同步 `pnpm-lock.yaml`
4. 在同步逻辑中补充复制 `pnpm-lock.yaml` 与根级 `package.json`
5. 保留现有 `packages/agent-core` 与 `packages/shared` 同步逻辑不变

## 2. 修改内容

已更新 [sync-ac.yml](file:///D:/McAgent/.github/workflows/sync-ac.yml)，补充以下根级文件复制：

- `pnpm-lock.yaml`
- `package.json`

并保留原有：
- `pnpm-workspace.yaml`
- `.npmrc`
- `tsconfig.json`

## 3. 验证方式

1. 触发一次 `sync-ac.yml`
2. 检查 `Alice-App` 仓库根目录是否出现 `pnpm-lock.yaml`
3. 重新触发 `Alice-App` release workflow
4. 确认 `actions/setup-node@v4` 不再报 `Dependency lock file is not found`

## 4. 风险说明

1. 如果 `Alice-App` release workflow 还额外指定了错误的 `cache-dependency-path`，仍可能失败
2. 如果目标仓库 release workflow 使用的工作目录不是根目录，也需要同步检查对应路径
3. Node 20 弃用提示当前不是主因，但后续仍建议把目标 workflow 中的 Node 版本明确设为 22 或 24
