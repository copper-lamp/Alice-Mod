# AC-V40-AliceApp安装目录自动追加修复-架构文档

## 架构
- `electron-builder` 继续负责生成 NSIS 安装器。
- 通过 NSIS `include` 注入自定义宏，在目录页结束时处理 `$INSTDIR`。
- 新增脚本放在 `packages/agent-core/src/res/installer.nsh`，确保同步到 Alice-App 时可被保留。

## 实现点
- `package.json` 的 `build.nsis.include` 指向 `src/res/installer.nsh`。
- `installer.nsh` 只做路径归一化，不修改其他安装逻辑。

## 影响范围
- 仅影响 Windows NSIS 安装阶段。
- 不影响 Electron 主进程、渲染进程和 workspace 构建。
