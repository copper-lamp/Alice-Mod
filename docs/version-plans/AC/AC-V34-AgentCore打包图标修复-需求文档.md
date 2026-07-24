# AC-V34 AgentCore 打包图标修复 - 需求文档

> 日期：2026-07-24
> 模块：Agent Core 桌面客户端打包图标
> 类型：需求文档

## 1. 背景

Agent Core 使用 Electron + electron-builder 打包 Windows 安装包。当前打包后未显示预期应用图标，表现为安装包、可执行文件或快捷方式图标与设计稿不一致。

## 2. 问题定义

当前 Windows 打包配置引用 `build/icon.png`。这在部分链路下可以参与资源生成，但对 Windows 安装器、`exe` 和快捷方式图标而言，稳定方案应提供多尺寸 `icon.ico`。

同时，设计原图散落在 `src/res/aliceIcon` 的多倍图目录中，不直接适合作为打包输入。

## 3. 目标

1. 生成可直接用于 Windows 打包的 `build/icon.ico`
2. 保留一份标准化 `build/icon.png` 作为通用资源
3. 更新 electron-builder 的 Windows 图标引用
4. 删除临时原图目录 `src/res/aliceIcon`
5. 让后续打包产物使用统一图标来源

## 4. 非目标

1. 不修改应用内部 UI 图标体系
2. 不调整安装器文案、名称和签名策略
3. 不处理 macOS `.icns` 或 Linux 图标链路

## 5. 验收标准

1. `packages/agent-core/build/icon.ico` 存在
2. `packages/agent-core/package.json` 的 `build.win.icon` 指向 `build/icon.ico`
3. `src/res/aliceIcon` 目录被删除
4. 重新打包后，Windows 安装器和应用图标来源一致
