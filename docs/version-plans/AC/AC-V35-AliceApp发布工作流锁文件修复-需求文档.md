# AC-V35 Alice-App 发布工作流锁文件修复 - 需求文档

> 日期：2026-07-24
> 模块：Agent Core 发布同步与 GitHub Actions
> 类型：需求文档

## 1. 背景

Agent Core 通过 `sync-ac.yml` 同步到目标仓库 `Alice-App`，再由目标仓库的 release workflow 进行 Windows 打包发布。

## 2. 问题定义

目标仓库发布任务报错：`Dependency lock file is not found`。报错发生在 `actions/setup-node@v4` 的 pnpm 缓存阶段。

虽然日志中提到了 Node 20 弃用提示，但实际运行节点版本是 Node 22，真正导致失败的是工作目录中缺少 `pnpm-lock.yaml`。

## 3. 根因

当前 `sync-ac.yml` 只同步了 `packages/agent-core`、`packages/shared` 和部分根级文件，但刻意没有同步 monorepo 根级 `pnpm-lock.yaml` 与 `package.json`。

而 `Alice-App` 的 release workflow 使用了 `actions/setup-node@v4` 的 `cache: pnpm`，该缓存策略会在仓库中查找 `pnpm-lock.yaml`，缺失时直接失败。

## 4. 目标

1. 同步 `pnpm-lock.yaml` 到 `Alice-App`
2. 同步根级 `package.json`，保证 pnpm 工作区根信息完整
3. 保持 `Alice-App` release workflow 在 GitHub Actions 中能正常执行 pnpm 缓存与安装

## 5. 验收标准

1. `sync-ac.yml` 会复制 `pnpm-lock.yaml` 到目标仓库根目录
2. `sync-ac.yml` 会复制根级 `package.json` 到目标仓库根目录
3. `Alice-App` release workflow 不再因 lockfile 缺失而失败
