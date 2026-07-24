# AC-V40-AliceApp安装目录自动追加修复-执行文档

## 执行
1. 在 `packages/agent-core/src/res/installer.nsh` 增加 `customLeaveDir` 宏。
2. 在 `packages/agent-core/package.json` 的 `build.nsis` 中配置 `include`。
3. 重新打包 Windows 安装器。
4. 安装时选择目录，确认最终路径自动追加 `AliceApp`。

## 验证
- 选择 `D:\Programs`，最终安装目录应为 `D:\Programs\AliceApp`。
- 安装完成后程序可正常启动。
