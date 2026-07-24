# JE Matrix Build Failure Debug

- Session: `je-matrix-build-failure`
- Status: [OPEN]
- Symptom: Alice-JE release workflow creates the 10-version matrix, but Gradle builds fail.
- Evidence run: https://github.com/copper-lamp/Alice-JE/actions/runs/30012944936

## Hypotheses

1. CI overwrites `gradle.properties` and removes required properties such as `modVersion`.
2. Loom versions are incompatible with the Gradle Wrapper or selected Java runtime.
3. Carpet/Fabric API artifacts cannot be resolved from configured repositories.
4. Source code uses Minecraft APIs that are not compatible across all target versions.
5. Java 25 is incompatible with the selected Gradle/Loom toolchain for 26.x.

## Evidence

- Workflow YAML parsing was fixed in commit `ad434b0`.
- Matrix preparation succeeded and generated all 10 requested versions.
- Failures occur specifically in `Build for MC ...` (`./gradlew build`).
- Detailed Gradle error output is not available through the unauthenticated GitHub API.

## 2026-07-23 Findings

- Masa Maven 元数据确认正式 Carpet 坐标：1.21.5 `1.4.169+v250325`、1.21.6 `1.4.176+v250617`、1.21.7 `1.4.177+v250630`、1.21.9 `1.4.185+v250930`、1.21.10 `1.4.186+v251009`、1.21.11 `1.4.194+v260107`、26.1 `v260401`、26.2 `v260616`。
- Maven 元数据不存在 1.21.8 正式 Carpet；1.21.7 构件的 `fabric.mod.json` 声明 `minecraft >=1.21.4`，因此 1.21.8 使用该构件在 Loader 语义上允许，但仍需解决二进制/API 兼容。
- 1.21.8 + Loom 1.11.8 + Gradle 8.14.3 已进入编译。首批缺失类型（SwordItem/PickaxeItem/Sheep）可改为物品标签、EntityType 或删除未使用导入；继续编译后暴露 71 个错误，包括 Inventory 字段私有化、ServerPlayer.server 私有化、SavedDataType 切换、Carpet 假人签名变化和网络 API 变化。
- Fabric 官方要求 26.1+ 使用 `net.fabricmc.fabric-loom`、Gradle 9.4、Java 25、标准 `implementation` 与 `jar`；已新增独立 `build-26.gradle` 和工作流分支，避免把旧 remap 构建伪装成成功。
- 本机仅有 Java 21，无法执行 26.x 编译；只能完成构建脚本静态检查。

## Remaining Blocker

当前共享源码横跨 1.21.4、1.21.8 和 26.x 的 Minecraft/Carpet 破坏性 API，单靠依赖坐标无法编译。下一步必须建立按 API 世代拆分的兼容源码（至少 legacy 1.21.4-1.21.7、modern 1.21.8-1.21.11、unobfuscated 26.x），逐组迁移假人、持久化、Inventory、命令和网络代码，并在 Java 25 环境实编译 26.x。发布矩阵保持 fail-fast=false，以便一次收集所有版本错误，但在这些源码端口完成前仍会真实失败，不会跳过或伪装成功。
