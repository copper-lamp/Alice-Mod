# AC-V39 Alice-App 构建入口缺失修复 - 执行文档

> 日期：2026-07-24
> 模块：Agent Core 发布构建
> 类型：执行文档

## 1. 执行步骤

1. 检查 electron-builder 报错中的缺失入口路径
2. 对照 `agent-core` 的 `main` 字段与 `electron.vite.config.ts` 输出目录
3. 检查 `Alice-App` 的构建步骤是否真正执行根包 `build`
4. 识别 `pnpm-workspace.yaml` 对单包铺平结构的干扰
5. 从同步流程中移除 `pnpm-workspace.yaml`

## 2. 当前修改

已更新 [sync-ac.yml](file:///D:/McAgent/.github/workflows/sync-ac.yml)：
- 不再同步 `pnpm-workspace.yaml`
- 保留 `pnpm-lock.yaml`
- 保留 `.npmrc`
- 保留 `tsconfig.json`

## 3. 目标仓库 workflow 建议

将构建步骤改为显式执行：

```yaml
- name: Build app
  run: pnpm build

- name: Build shared
  run: pnpm --dir packages/shared build
```

如果 `pnpm build` 已足够带上 shared 依赖链，也可以仅保留根构建，并在验证通过后删掉单独的 shared 构建步骤。

## 4. 验证方式

1. 重新触发 `sync-ac.yml`
2. 确认 `Alice-App` 根目录不存在 `pnpm-workspace.yaml`
3. 重新运行 release workflow
4. 在打包前检查 `dist/main/index.js` 是否已生成
5. 确认 electron-builder 不再报入口文件不存在
