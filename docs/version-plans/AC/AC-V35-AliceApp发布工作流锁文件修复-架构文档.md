# AC-V35 Alice-App 发布工作流锁文件修复 - 架构文档

> 日期：2026-07-24
> 模块：Agent Core 发布同步与 GitHub Actions
> 类型：架构文档

## 1. 相关链路

1. `McAgent` 仓库 tag / push 触发 [sync-ac.yml](file:///D:/McAgent/.github/workflows/sync-ac.yml)
2. `sync-ac.yml` 将 Agent Core 相关文件同步到 `Alice-App`
3. `Alice-App` 仓库 release workflow 执行 `actions/setup-node`、`pnpm install`、Electron 打包

## 2. 失败点

`actions/setup-node@v4` 配置了 `cache: pnpm` 时，会先在 checkout 后的工作目录寻找 `pnpm-lock.yaml`。

如果目标仓库根目录没有锁文件：
- pnpm 缓存初始化失败
- 后续安装与打包不会继续

## 3. 修复策略

在同步阶段补齐目标仓库根级构建元信息：
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `package.json`
- `.npmrc`
- `tsconfig.json`

这样可保证：
- GitHub Actions 缓存层能找到 lockfile
- pnpm workspace 根配置完整
- 目标仓库与源仓库依赖解析保持一致

## 4. 设计约束

1. 不修改 `Alice-App` 子仓库自己的 `.github` 目录
2. 不依赖临时环境变量绕过 Node 20 提示
3. 优先修复真实失败点，而不是处理无关告警
