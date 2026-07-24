# AC-V34 AgentCore 打包图标修复 - 执行文档

> 日期：2026-07-24
> 模块：Agent Core 桌面客户端打包图标
> 类型：执行文档

## 1. 执行步骤

1. 检查 `src/res/aliceIcon` 中导出的多倍率 PNG 原图
2. 确认最大图尺寸可作为统一源图
3. 生成标准化 `src/res/icon.png`
4. 生成多尺寸 `src/res/icon.ico`
5. 将 `package.json` 中的 `build.win.icon` 更新为 `src/res/icon.ico`
6. 删除 `src/res/aliceIcon` 目录
7. 检查生成结果和配置引用

## 2. 产出物

- `packages/agent-core/src/res/icon.png`
- `packages/agent-core/src/res/icon.ico`
- 更新后的 `packages/agent-core/package.json`
- 删除后的原始导出目录 `packages/agent-core/src/res/aliceIcon`

## 3. 验证方式

1. 检查 `src/res/icon.ico` 是否存在
2. 检查 `package.json` 是否引用 `src/res/icon.ico`
3. 重新执行 Windows 打包
4. 检查安装器、安装目录中的 `Alice.exe`、桌面快捷方式图标是否一致
5. 若图标仍未刷新，清理 Windows 图标缓存后再次核对

## 4. 风险说明

1. Windows 资源管理器可能缓存旧图标，导致已修复但显示未立即更新
2. 如果后续重新更换品牌图标，需要重新生成 `.ico`，不能只替换单一 PNG
