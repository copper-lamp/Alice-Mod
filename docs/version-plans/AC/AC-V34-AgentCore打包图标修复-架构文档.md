# AC-V34 AgentCore 打包图标修复 - 架构文档

> 日期：2026-07-24
> 模块：Agent Core 桌面客户端打包图标
> 类型：架构文档

## 1. 输入与输出

输入：设计导出的多倍率 PNG 原图，位于 `packages/agent-core/src/res/aliceIcon`

输出：
- `packages/agent-core/build/icon.png`
- `packages/agent-core/build/icon.ico`
- `packages/agent-core/package.json` 中更新后的 Windows 打包引用

## 2. 资源转换策略

原始导出尺寸为 161、321、481、641，存在非标准 1px 偏差，不能直接作为 Windows 图标尺寸集合。

采用策略：
1. 选择最大尺寸 PNG 作为源图
2. 先规范化缩放到 512x512 PNG
3. 再生成包含 16/24/32/48/64/128/256 多尺寸条目的 `.ico`

这样可以兼容 Windows 安装器、可执行文件和快捷方式的不同取图场景。

## 3. 配置链路

`electron-builder` 读取 `packages/agent-core/package.json` 中 `build.win.icon`。

更新后链路如下：

1. 打包读取 `build/icon.ico`
2. NSIS 安装器使用该图标资源
3. 生成的 `exe` 和快捷方式从同一图标源派生

## 4. 清理策略

`src/res/aliceIcon` 仅作为外部导出的临时素材目录，不再参与运行时或打包流程。

在标准化资源生成完成后，删除整个目录，避免后续维护时出现多个图标来源。