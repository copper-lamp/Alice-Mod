# Adapter Core Java 版（JE）部署指南

> 版本：v1.0
> 日期：2026-07-04
> 关联文档：[00-顶层设计.md](../00-顶层设计.md)、[02-模块划分与功能简介.md](../02-模块划分与功能简介.md)、[通信协议规范.md](../protocols/01-通信协议规范.md)

---

## 第1章 概述

### 1.1 Adapter Core JE 的角色

Adapter Core JE（Java Edition）是 McAgent 系统中运行在 **Minecraft Java Edition 客户端** 上的 Fabric 模组，使用 Java 语言实现。它是整个系统的"手脚"，承担两个核心角色：

| 角色 | 说明 |
|------|------|
| **AI 执行器** | 通过 TCP 客户端与 Agent Core 通信，接收并执行 AI 的低级操作指令，包括移动、背包管理、方块操作、生物交互、生存控制等 108+ 个工具 |
| **游戏内工具** | 作为 Fabric 模组直接嵌入 Minecraft 客户端，通过 Minecraft API 实现假人控制、环境感知、状态上报等能力，将游戏世界状态转化为结构化数据供 Agent Core 处理 |

Adapter Core JE **必须运行在 Minecraft 客户端环境内**，不能独立运行。它通过 TCP 长连接与 Agent Core（桌面应用）通信，一个 Agent Core 可同时管理多个 Adapter Core 实例。

### 1.2 体系位置图

```
┌──────────────────────────────────────────────────────────────────┐
│                        Agent Core                                │
│                    Electron + TypeScript / Node.js                │
│                                                                  │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐        │
│  │  UI 界面   │ │ LLM 调度层 │ │ 工作区管理 │ │ QQ 机器人  │        │
│  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └─────┬─────┘        │
│        └──────────────┴──────────────┴──────────────┘            │
│                              │                                    │
│                    ┌─────────┴─────────┐                          │
│                    │   TCP JSON-RPC    │                          │
│                    │   桥接层 (Batch)   │                          │
│                    └─────────┬─────────┘                          │
└──────────────────────────────┼───────────────────────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │   Adapter Core JE    │
                    │   (Fabric 模组)      │
                    │                      │
                    │  ┌────────────────┐  │
                    │  │  TCP 客户端     │  │
                    │  │  (Java Socket)  │  │
                    │  └────────┬───────┘  │
                    │           │          │
                    │  ┌────────┴───────┐  │
                    │  │  工具注册模块    │  │
                    │  └────────┬───────┘  │
                    │           │          │
                    │  ┌────────┴───────┐  │
                    │  │  执行AI 引擎    │  │
                    │  │  (7 个子模块)   │  │
                    │  └────────┬───────┘  │
                    │           │          │
                    │  ┌────────┴───────┐  │
                    │  │  Minecraft API │  │
                    │  │  (Fabric 接口)  │  │
                    │  └────────────────┘  │
                    └──────────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  Minecraft Java      │
                    │  Edition 客户端      │
                    │  (1.21.x)            │
                    └──────────────────────┘
```

### 1.3 与 BE 版的差异说明

Adapter Core JE（Java 版）和 Adapter Core BE（基岩版）在功能上完全对等，但在实现上有以下差异：

| 维度 | JE（Java 版） | BE（基岩版） |
|------|--------------|-------------|
| **运行环境** | Minecraft Java Edition 客户端 | Bedrock Dedicated Server（BDS） |
| **模组框架** | Fabric Loader + Fabric API | LeviLamina 插件框架 |
| **开发语言** | Java 21 | TypeScript / Node.js |
| **部署方式** | 安装到客户端 mods/ 目录 | 安装到 BDS 服务器 plugins/ 目录 |
| **TCP 客户端** | Java Socket 自实现 | Node.js net 模块 |
| **游戏 API** | Fabric API / Minecraft API | BDS API（LeviLamina） |
| **构建工具** | Gradle / Maven | npm / pnpm |
| **运行模式** | 需启动 Minecraft 客户端（含图形界面） | 在 BDS 后台无界面运行 |
| **适用场景** | 单人游戏、局域网联机 | 多人服务器、云端部署 |
| **假人控制** | 通过 Fabric API 创建客户端假人 | 通过 BDS API 创建服务器假人 |
| **数据持久化** | SQLite JDBC | better-sqlite3 |

**关键差异说明**：

- **运行模式**：JE 版必须运行在完整的 Minecraft 客户端中，适合开发调试和单机使用；BE 版可运行在无头 BDS 服务器上，适合生产环境部署
- **假人实现**：JE 版假人生成需依赖客户端进入世界，假人是客户端实体；BE 版假人是服务器实体，管理更灵活
- **工具实现**：虽然接口定义一致，但由于底层游戏 API 不同，JE 和 BE 的工具实现代码完全独立

---

## 第2章 环境要求

### 2.1 软件要求

| 依赖 | 最低版本 | 推荐版本 | 说明 |
|------|----------|----------|------|
| **操作系统** | Windows 10 / macOS 12 / Linux Kernel 5.x | Windows 11 / macOS 14 / Ubuntu 22.04 | 支持主流桌面操作系统 |
| **Minecraft Java Edition** | 1.21 | 1.21.4 | 仅支持 1.21.x 系列版本 |
| **Fabric Loader** | 0.16.0 | 0.16.9+ | 模组加载器 |
| **Fabric API** | 0.105.0 | 0.105.5+ | Fabric 模组 API |
| **Java** | 21 | **JDK 21 LTS**（如 Amazon Corretto 21、Eclipse Temurin 21） | 必须使用 Java 21，不支持更低版本 |
| **内存（Minecraft 独占）** | 4 GB | 8 GB | 含 Minecraft 客户端本身的内存消耗 |
| **磁盘空间** | 500 MB | 2 GB | 含模组、存档和日志 |

> **注意**：Minecraft 1.21.x 强制要求 Java 21，请确保系统中已安装正确的 JDK 版本。建议使用 [Eclipse Temurin JDK 21](https://adoptium.net/) 或 [Amazon Corretto 21](https://aws.amazon.com/corretto/)。

### 2.2 网络要求

| 需求 | 说明 |
|------|------|
| **与 Agent Core 连通性** | 必须与 Agent Core 在同一局域网或公网可达 |
| **TCP 端口** | 默认端口 `21001`（可配置），需确保防火墙已放行该端口 |
| **网络延迟** | 建议与 Agent Core 之间的延迟 < 50ms，过高延迟会影响工具调用响应速度 |
| **带宽** | 最低 1 Mbps，工具调用数据量较小，普通网络即可满足 |

**部署场景说明**：

- **同机部署**：Agent Core 和 Minecraft 客户端运行在同一台电脑上，使用 `127.0.0.1:21001` 连接，无需额外网络配置
- **局域网部署**：Agent Core 和 Minecraft 客户端在不同电脑上但处于同一局域网，使用局域网 IP 连接
- **远程部署**：Minecraft 客户端与 Agent Core 通过公网连接，需确保双方网络可达，建议使用 VPN 或内网穿透工具

---

## 第3章 安装

### 3.1 安装 Fabric

Fabric 是 Minecraft Java Edition 的轻量级模组加载器，Adapter Core JE 依赖 Fabric 加载运行。

#### 步骤一：下载 Fabric Installer

1. 访问 Fabric 官方下载页面：https://fabricmc.net/use/
2. 下载最新版本的 **Fabric Installer**（`fabric-installer-<version>.exe` 或 `.jar`）

#### 步骤二：选择 Minecraft 版本和 Loader 版本

1. 运行 Fabric Installer
2. 选择 **Minecraft Version**：`1.21.x`（推荐 `1.21.4`）
3. 选择 **Loader Version**：`0.16.x`（推荐最新稳定版，如 `0.16.9`）
4. 选择安装类型为 **Client**（客户端）

#### 步骤三：安装客户端

1. 点击 **Install** 按钮
2. 安装完成后，Fabric Loader 会出现在 Minecraft 启动器的版本列表中
3. 在 Minecraft 启动器中可以看到名为 `fabric-loader-0.16.x-1.21.x` 的新版本

**验证安装**：

```bash
# 通过查看 Minecraft 目录确认安装成功
# Windows 默认路径
%APPDATA%\.minecraft\versions\
# 目录下应包含 fabric-loader-0.16.x-1.21.x 文件夹
```

### 3.2 安装 Adapter Core 模组

#### 步骤一：定位 Minecraft 目录

Minecraft 目录位置因操作系统而异：

| 操作系统 | 默认路径 |
|----------|----------|
| **Windows** | `%APPDATA%\.minecraft\` |
| **macOS** | `~/Library/Application Support/minecraft/` |
| **Linux** | `~/.minecraft/` |

#### 步骤二：创建 mods 目录（如不存在）

```
.minecraft/
└── mods/           # 如果不存在则手动创建
```

#### 步骤三：放置模组 jar 文件

将 Adapter Core JE 模组的 jar 文件放入 `mods/` 目录：

```
.minecraft/
├── versions/
│   └── fabric-loader-0.16.x-1.21.x/
├── mods/
│   ├── fabric-api-0.105.x.jar          # Fabric API（必装）
│   └── mcagent-adapter-je-x.x.x.jar    # Adapter Core 模组
├── config/
│   └── mcagent-adapter.json            # 模组配置文件（首次启动后自动生成）
├── saves/                              # 存档目录
│   └── <world_name>/
│       └── mcagent_instance.json       # 实例配置文件（自动生成）
└── logs/
    └── latest.log                      # Minecraft 运行日志
```

> **说明**：`config/mcagent-adapter.json` 在首次启动模组时会自动生成默认配置。`mcagent_instance.json` 在首次进入世界时自动生成。

#### 步骤四：完整目录结构说明

| 路径 | 说明 |
|------|------|
| `.minecraft/versions/` | Fabric Loader 版本目录 |
| `.minecraft/mods/` | 存放所有 Fabric 模组 jar 文件 |
| `.minecraft/config/mcagent-adapter.json` | Adapter Core 模组配置文件 |
| `.minecraft/saves/<world_name>/mcagent_instance.json` | 实例入口文件，自动生成 |
| `.minecraft/logs/latest.log` | Minecraft 运行日志 |

### 3.3 安装 Fabric API

Fabric API 是 Fabric 生态的核心库，提供大量游戏接口，Adapter Core JE 依赖 Fabric API 实现游戏交互。

#### 步骤一：下载 Fabric API

1. 访问 Fabric API 发布页面：https://modrinth.com/mod/fabric-api 或 https://www.curseforge.com/minecraft/mc-mods/fabric-api
2. 选择与 Minecraft 1.21.x 兼容的版本（`0.105.x` 系列）
3. 下载 `.jar` 文件

#### 步骤二：放入 mods 目录

将下载的 `fabric-api-0.105.x.jar` 放入 `.minecraft/mods/` 目录：

```
.minecraft/mods/
├── fabric-api-0.105.x.jar
└── mcagent-adapter-je-x.x.x.jar
```

> **注意**：Fabric API 是 Adapter Core JE 的必需依赖，缺少它将导致模组无法正常加载。请确保下载的 Fabric API 版本与 Minecraft 版本和 Fabric Loader 版本兼容。

---

## 第4章 配置

### 4.1 mcagent-adapter.json 配置

模组配置文件位于 `.minecraft/config/mcagent-adapter.json`，在首次启动模组时会自动生成。用户可手动编辑该文件进行配置。

#### 完整配置示例

```json
{
  "agent_core": {
    "host": "127.0.0.1",
    "port": 21001,
    "reconnect_interval": 5000
  },
  "bot": {
    "name": "Alice",
    "auto_spawn": true,
    "spawn_on_join": true
  },
  "tools": {
    "auto_scan": true,
    "custom_tools_dir": "config/mcagent-custom-tools"
  },
  "debug": false
}
```

#### 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| **agent_core.host** | string | `"127.0.0.1"` | Agent Core 的 TCP 服务端地址。同机部署使用 `127.0.0.1`，远程部署填写 Agent Core 所在机器的 IP 地址 |
| **agent_core.port** | integer | `21001` | Agent Core 的 TCP 服务端端口，需与 Agent Core 配置一致 |
| **agent_core.reconnect_interval** | integer | `5000` | 断线重连间隔（毫秒）。断线后每隔此时间尝试重新连接 |
| **bot.name** | string | `"Alice"` | AI 假人的游戏内名称 |
| **bot.auto_spawn** | boolean | `true` | 是否在模组加载后自动生成假人 |
| **bot.spawn_on_join** | boolean | `true` | 是否在进入世界时自动生成假人 |
| **tools.auto_scan** | boolean | `true` | 是否自动扫描并注册所有内置工具 |
| **tools.custom_tools_dir** | string | `"config/mcagent-custom-tools"` | 自定义工具 jar 文件存放目录，相对于 `.minecraft/` 目录 |
| **debug** | boolean | `false` | 是否启用调试模式。启用后输出更详细的日志信息 |

#### 配置修改示例

**场景一：远程连接 Agent Core**

```json
{
  "agent_core": {
    "host": "192.168.1.100",
    "port": 21001,
    "reconnect_interval": 3000
  }
}
```

**场景二：使用自定义假人名称**

```json
{
  "bot": {
    "name": "Steve",
    "auto_spawn": true,
    "spawn_on_join": true
  }
}
```

**场景三：启用调试模式**

```json
{
  "debug": true
}
```

> **注意**：修改配置文件后需重启游戏或执行 `/mcagent reload` 命令使配置生效。

### 4.2 mcagent_instance.json（自动生成）

`mcagent_instance.json` 是 Adapter Core JE 自动生成的实例入口文件，Agent Core 通过读取该文件发现并管理实例。

#### 生成时机

- **首次进入世界时**：当玩家首次进入一个世界（单人游戏或服务器），模组会自动在存档目录下生成 `mcagent_instance.json`
- **每次启动时**：模组会在每次加载时更新该文件，确保其中的连接信息为最新状态

#### 文件位置

```
.minecraft/saves/<world_name>/mcagent_instance.json
```

例如：
```
.minecraft/saves/New World/mcagent_instance.json
```

#### 文件内容示例

```json
{
  "world_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "server_name": "Singleplayer",
  "game_version": "1.21.4",
  "adapter_type": "je",
  "adapter_version": "1.0.0",
  "tcp": {
    "host": "127.0.0.1",
    "port": 21001
  },
  "db_path": ".minecraft/saves/New World/mcagent",
  "online": true,
  "generated_at": "2026-07-04T12:00:00.000Z"
}
```

#### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| **world_id** | string | 世界唯一标识符，UUID 格式，用于 Agent Core 区分不同实例 |
| **server_name** | string | 服务器名称，单人游戏为 `"Singleplayer"`，多人游戏为服务器地址 |
| **game_version** | string | Minecraft 游戏版本号 |
| **adapter_type** | string | 适配器类型，固定为 `"je"` |
| **adapter_version** | string | Adapter Core 模组版本号 |
| **tcp.host** | string | TCP 连接地址，与 `mcagent-adapter.json` 中的配置一致 |
| **tcp.port** | integer | TCP 连接端口 |
| **db_path** | string | 实例数据库文件路径（相对于 Minecraft 目录） |
| **online** | boolean | 当前是否在线（模组是否正在运行并连接中） |
| **generated_at** | string | 文件生成时间（ISO 8601 格式） |

> **注意**：该文件由模组自动管理，**不建议手动编辑**。如需修改连接配置，请编辑 `mcagent-adapter.json`。

### 4.3 控制台命令

Adapter Core JE 提供以下游戏内命令，用于控制模组运行状态：

#### 命令列表

| 命令 | 权限 | 说明 |
|------|------|------|
| `/mcagent connect` | OP / 单人游戏 | 手动连接 Agent Core |
| `/mcagent disconnect` | OP / 单人游戏 | 断开与 Agent Core 的连接 |
| `/mcagent status` | 所有人 | 查看当前连接状态和模组信息 |
| `/mcagent reload` | OP / 单人游戏 | 重载所有工具（包括自定义工具） |
| `/mcagent debug` | OP / 单人游戏 | 切换调试模式开关 |

#### 命令使用示例

```
# 查看连接状态
/mcagent status

# 输出示例
[McAgent] ====== Adapter Core JE Status ======
[McAgent] 连接状态: 已连接 (127.0.0.1:21001)
[McAgent] 假人名称: Alice
[McAgent] 假人状态: 活动中
[McAgent] 已注册工具: 108
[McAgent] 调试模式: 关闭
[McAgent] 模组版本: 1.0.0
[McAgent] ====================================
```

```
# 手动连接 Agent Core
/mcagent connect

# 输出示例
[McAgent] 正在连接 Agent Core (127.0.0.1:21001)...
[McAgent] 连接成功！
```

```
# 断开连接
/mcagent disconnect

# 输出示例
[McAgent] 已断开与 Agent Core 的连接
```

```
# 重载工具
/mcagent reload

# 输出示例
[McAgent] 正在重载工具...
[McAgent] 已注册 108 个内置工具
[McAgent] 已注册 2 个自定义工具
[McAgent] 工具重载完成
```

```
# 切换调试模式
/mcagent debug

# 输出示例
[McAgent] 调试模式: 已开启
```

---

## 第5章 运行与验证

### 5.1 启动步骤

#### 步骤一：配置 Minecraft 启动器

使用支持 Fabric 的启动器（如官方启动器、Prism Launcher、MultiMC）配置 Fabric 版本：

**官方启动器**：

1. 启动 Minecraft 官方启动器
2. 在左下角版本选择下拉菜单中选择 **fabric-loader-0.16.x-1.21.x**
3. 点击 **启动** 按钮

**Prism Launcher 示例**：

1. 打开 Prism Launcher
2. 点击 **添加实例**
3. 选择 **Vanilla** → 选择 Minecraft 版本 **1.21.x**
4. 在实例设置中，选择 **Fabric** 作为加载器，Loader 版本选择 **0.16.x**
5. 右键点击实例 → **编辑** → **Mod 文件夹**
6. 将 `fabric-api-0.105.x.jar` 和 `mcagent-adapter-je-x.x.x.jar` 拖入 mod 文件夹
7. 点击 **启动** 按钮

#### 步骤二：选择 Fabric 版本

在启动器中确认选择的版本为 Fabric 版本，而不是原版 Minecraft 或其他模组加载器版本。

#### 步骤三：启动游戏

1. 点击启动按钮
2. 等待 Minecraft 客户端加载完成
3. 观察右下角是否显示 Fabric 模组加载信息

#### 步骤四：进入世界

1. 选择 **单人游戏**
2. 创建新世界或加载已有存档
3. 等待世界加载完成
4. 观察聊天栏是否有模组启动信息

#### 步骤五：验证连接

1. 确保 Agent Core 已在运行并监听 TCP 端口
2. 在游戏聊天栏中执行 `/mcagent status` 查看连接状态
3. 如果显示"未连接"，执行 `/mcagent connect` 手动连接

### 5.2 验证方法

#### 验证一：聊天栏提示

成功连接后，聊天栏会显示：

```
[McAgent] Adapter Core JE connected to Agent Core
[McAgent] 已注册 108 个工具
```

#### 验证二：使用 /mcagent status 命令

```
/mcagent status

[McAgent] ====== Adapter Core JE Status ======
[McAgent] 连接状态: 已连接 (127.0.0.1:21001)
[McAgent] 假人名称: Alice
[McAgent] 假人状态: 活动中
[McAgent] 已注册工具: 108
[McAgent] 调试模式: 关闭
[McAgent] 模组版本: 1.0.0
[McAgent] ====================================
```

#### 验证三：Agent Core UI 工作区状态

在 Agent Core 桌面应用中，对应工作区应显示为 **"已连接"** 状态，并显示已注册的工具数量。

#### 验证四：日志验证

查看 `.minecraft/logs/latest.log`，应包含以下内容：

```
[xx:xx:xx] [main/INFO] (mcagent) Loading McAgent Adapter JE v1.0.0
[xx:xx:xx] [main/INFO] (mcagent) Registered 108 tools
[xx:xx:xx] [main/INFO] (mcagent) TCP Client connecting to 127.0.0.1:21001...
[xx:xx:xx] [main/INFO] (mcagent) Connected to Agent Core
```

#### 验证五：端到端工具调用测试

在 Agent Core 中发送一个简单的工具调用，如 `get_status`，观察返回结果中是否包含正确的游戏状态信息。

---

## 第6章 自定义工具开发

Adapter Core JE 支持通过注解方式开发自定义工具，并支持热重载。用户可以根据自己的需求扩展工具集。

### 6.1 使用 @ToolModule 和 @ToolMethod 注解

自定义工具使用两个核心注解：

| 注解 | 作用 | 使用位置 |
|------|------|----------|
| `@ToolModule` | 标记一个类为工具模块，定义工具分类和描述 | 类级别 |
| `@ToolMethod` | 标记一个方法为具体工具，定义工具名称、描述和参数 | 方法级别 |

#### 注解定义

```java
package io.mcagent.adapter.tool.annotation;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface ToolModule {
    String category();
    String description();
}
```

```java
package io.mcagent.adapter.tool.annotation;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface ToolMethod {
    String name();
    String description();
    ToolParam[] parameters() default {};
}

@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
public @interface ToolParam {
    String name();
    String type();
    String description();
    boolean required() default true;
}
```

### 6.2 自定义工具 Java 示例

以下示例展示如何开发一个自定义的"查询附近生物"工具：

```java
package io.mcagent.adapter.tool.custom;

import io.mcagent.adapter.tool.annotation.ToolMethod;
import io.mcagent.adapter.tool.annotation.ToolModule;
import io.mcagent.adapter.tool.annotation.ToolParam;

import java.util.List;
import java.util.stream.Collectors;

@ToolModule(category = "perception", description = "自定义感知工具")
public class CustomPerceptionTools {

    @ToolMethod(
        name = "nearby_mobs",
        description = "查询指定范围内的怪物列表",
        parameters = {
            @ToolParam(name = "radius", type = "number", description = "搜索半径（方块）"),
            @ToolParam(name = "include_passive", type = "boolean", description = "是否包含被动生物", required = false)
        }
    )
    public NearbyMobsResult nearbyMobs(NearbyMobsParams params) {
        int radius = params.radius();
        boolean includePassive = params.includePassive();

        // 使用 Minecraft API 获取附近实体
        List<Entity> entities = getEntitiesInRadius(radius);

        // 过滤生物
        List<MobInfo> mobs = entities.stream()
            .filter(e -> includePassive || isHostile(e))
            .map(e -> new MobInfo(e.getName(), e.getType(), e.getPosition()))
            .collect(Collectors.toList());

        return new NearbyMobsResult(mobs, mobs.size());
    }

    private List<Entity> getEntitiesInRadius(int radius) {
        // 通过 Minecraft API 获取实体列表
        // 实际实现依赖于 Fabric API 的实体查询接口
        return MinecraftClient.getInstance().world.getEntities()
            .filter(e -> e instanceof MobEntity)
            .filter(e -> e.squaredDistanceTo(MinecraftClient.getInstance().player) <= radius * radius)
            .collect(Collectors.toList());
    }

    private boolean isHostile(Entity entity) {
        return entity instanceof HostileEntity;
    }
}

// 参数类
record NearbyMobsParams(int radius, boolean includePassive) {}

// 结果类
record NearbyMobsResult(List<MobInfo> mobs, int count) {}
record MobInfo(String name, String type, Vec3 position) {}
```

### 6.3 编译打包为 jar

#### 使用 Gradle 构建

```groovy
// build.gradle
plugins {
    id 'java'
    id 'fabric-loom' version '1.7.x'
}

sourceCompatibility = JavaVersion.VERSION_21
targetCompatibility = JavaVersion.VERSION_21

version = "1.0.0"

repositories {
    mavenCentral()
    maven { url "https://maven.fabricmc.net/" }
}

dependencies {
    // 引入 Adapter Core JE 的 API 依赖
    compileOnly "io.mcagent:mcagent-adapter-je-api:1.0.0"
    compileOnly "net.fabricmc:fabric-loader:0.16.9"
    compileOnly "net.fabricmc:fabric-api:0.105.5+1.21.4"
}

jar {
    manifest {
        attributes(
            'McAgent-Tool-Module': 'true',
            'McAgent-Tool-Version': project.version
        )
    }
}
```

#### 打包命令

```bash
# 使用 Gradle 构建
./gradlew build

# 构建产物位于
build/libs/custom-perception-tools-1.0.0.jar
```

### 6.4 放入 custom_tools_dir 目录

将编译好的 jar 文件放入自定义工具目录：

```
.minecraft/
└── config/
    └── mcagent-custom-tools/          # 对应 mcagent-adapter.json 中的 custom_tools_dir
        └── custom-perception-tools-1.0.0.jar
```

### 6.5 热重载

在游戏内执行以下命令，无需重启游戏即可加载新工具：

```
/mcagent reload
```

成功加载后，聊天栏会显示：

```
[McAgent] 正在重载工具...
[McAgent] 已注册 108 个内置工具
[McAgent] 已注册 3 个自定义工具
[McAgent] 工具重载完成
```

> **注意**：热重载会重新扫描所有内置工具和自定义工具目录。如果自定义工具 jar 文件有更新，只需替换 jar 文件后执行 `/mcagent reload` 即可生效，无需重启游戏。

---

## 第7章 常见问题

### 7.1 Fabric 加载失败

**现象**：启动游戏时崩溃或 Fabric 模组列表为空。

**可能原因及解决方案**：

| 原因 | 解决方案 |
|------|----------|
| **Fabric Loader 版本不兼容** | 确认使用的 Fabric Loader 版本（0.16.x）与 Minecraft 版本（1.21.x）兼容。查看 [Fabric 版本兼容性列表](https://fabricmc.net/versions/) |
| **Minecraft 版本不匹配** | 确保 Fabric Loader、Fabric API 和 Adapter Core 模组都使用同一 Minecraft 版本（如 1.21.4） |
| **Java 版本过低** | 确认使用 Java 21 或更高版本。在命令行执行 `java -version` 检查 |
| **Fabric Installer 安装失败** | 重新运行 Fabric Installer，选择正确的 Minecraft 版本和 Loader 版本 |

### 7.2 模组冲突

**现象**：启动游戏后出现异常行为或崩溃，日志中显示类冲突或模组加载失败。

**可能原因及解决方案**：

| 原因 | 解决方案 |
|------|----------|
| **其他模组与 Adapter Core 冲突** | 尝试移除其他模组，逐一排查冲突源。常见冲突模组包括：OptiFine、Sodium 等渲染优化模组 |
| **Fabric API 版本不匹配** | 确保 Fabric API 版本与 Minecraft 版本和 Fabric Loader 版本兼容 |
| **多个版本的 Adapter Core 模组共存** | 移除 `mods/` 目录下所有旧版本的 Adapter Core 模组文件，只保留一个最新版本 |

### 7.3 Java 版本不兼容

**现象**：启动游戏时提示 "Java 版本过低" 或 "Unsupported major.minor version"。

**解决方案**：

1. 检查当前 Java 版本：
   ```bash
   java -version
   # 应输出类似：openjdk version "21.0.x"
   ```

2. 如版本低于 21，安装 JDK 21 LTS：
   - 下载 [Eclipse Temurin JDK 21](https://adoptium.net/)
   - 或 [Amazon Corretto 21](https://aws.amazon.com/corretto/)

3. 在 Minecraft 启动器中设置正确的 Java 路径：
   - **官方启动器**：启动选项 → 选择 Fabric 版本 → Java 可执行文件 → 浏览选择 JDK 21 的 `javaw.exe`
   - **Prism Launcher**：编辑实例 → 设置 → Java 路径

### 7.4 TCP 连接重置

**现象**：聊天栏显示 "Connection reset" 或 "连接被重置"，`/mcagent status` 显示未连接。

**可能原因及解决方案**：

| 原因 | 解决方案 |
|------|----------|
| **Agent Core 未启动** | 确认 Agent Core 正在运行，并且 TCP 服务端已启动 |
| **端口不匹配** | 检查 `mcagent-adapter.json` 中的 `agent_core.port` 是否与 Agent Core 配置一致 |
| **防火墙拦截** | 在防火墙中放行 TCP 端口（默认 `21001`） |
| **地址配置错误** | 确认 `agent_core.host` 配置正确。同机部署使用 `127.0.0.1`，远程部署使用正确的 IP 地址 |
| **网络不稳定** | 检查网络连接，确保与 Agent Core 之间的网络可达。可尝试使用 `ping` 或 `telnet` 测试连通性 |

### 7.5 假人控制问题

**现象**：假人未生成或假人行为异常。

**可能原因及解决方案**：

| 原因 | 解决方案 |
|------|----------|
| **auto_spawn 未启用** | 检查 `mcagent-adapter.json` 中 `bot.auto_spawn` 是否为 `true` |
| **未进入世界** | 假人只有在进入世界后才会生成，确保已加载世界 |
| **假人名称冲突** | 修改 `bot.name` 为一个在游戏中不重复的名称 |
| **权限不足（多人游戏）** | 在多人服务器中需要 OP 权限才能生成假人 |

### 7.6 权限不足

**现象**：在多人游戏中使用 `/mcagent` 命令时提示 "你没有权限执行此命令"。

**解决方案**：

1. 确保你在服务器中拥有 OP 权限：
   ```
   # 在服务器控制台或聊天栏中
   /op <你的游戏名>
   ```

2. 如果使用局域网开放功能，需要先在单人游戏中打开局域网开放：
   - 按 `ESC` → **对局域网开放**
   - 确保 **允许作弊** 设为 **开**

3. 在单人游戏中，如果开启了作弊功能，通常拥有所有权限

---

## 第8章 更新与卸载

### 8.1 更新模组

#### 更新步骤

1. **下载新版本**：从发布页面下载最新版本的 `mcagent-adapter-je-x.x.x.jar`

2. **替换 jar 文件**：
   - 关闭 Minecraft 客户端
   - 将新版本的 jar 文件复制到 `.minecraft/mods/` 目录，覆盖旧文件
   - 或先删除旧版本文件，再放入新版本文件

3. **更新配置文件**（如需）：
   - 检查新版本是否有配置变更，如有需要更新 `mcagent-adapter.json`
   - 新版本通常会兼容旧版配置，但建议查看更新日志

4. **更新 Fabric Loader**（如需）：
   - 如果新版本要求更新 Fabric Loader，重新运行 Fabric Installer
   - 选择新的 Loader 版本进行安装

5. **更新 Fabric API**（如需）：
   - 下载与新版模组兼容的 Fabric API 版本
   - 替换 `mods/` 目录下的 `fabric-api-*.jar`

6. **启动游戏验证**：
   - 启动 Minecraft 客户端
   - 检查聊天栏显示的模组版本是否为最新

#### 更新注意事项

- **备份配置**：更新前建议备份 `mcagent-adapter.json` 配置文件
- **备份存档**：更新前建议备份存档目录，特别是 `mcagent_instance.json`
- **查看更新日志**：每次更新前查看发布说明，了解变更内容和兼容性说明
- **版本兼容性**：大版本更新可能需要重新生成 `mcagent_instance.json`

### 8.2 卸载模组

#### 卸载步骤

1. **关闭 Minecraft 客户端**

2. **移除模组 jar 文件**：
   - 删除 `.minecraft/mods/mcagent-adapter-je-x.x.x.jar`
   - 如需完全干净卸载，也可删除 `.minecraft/mods/fabric-api-0.105.x.jar`

3. **（可选）删除配置文件**：
   - 删除 `.minecraft/config/mcagent-adapter.json`
   - 该文件删除后不影响 Minecraft 正常运行

4. **（可选）删除 Fabric Loader**：
   - 如果不再需要使用 Fabric，可在 Minecraft 启动器的版本列表中选择移除 Fabric 版本
   - 或运行 Fabric Installer，选择 **Uninstall** 选项

5. **启动游戏验证**：
   - 启动 Minecraft 客户端
   - 确认不再显示 McAgent 模组的相关信息
   - 确认聊天栏中不再出现 McAgent 的提示信息

### 8.3 清理 mcagent_instance.json

`mcagent_instance.json` 文件在卸载模组后不会自动删除，如需清理：

#### 删除位置

```
# 单人游戏存档目录
.minecraft/saves/<world_name>/mcagent_instance.json
```

#### 清理步骤

1. 关闭 Minecraft 客户端
2. 打开存档目录：`.minecraft/saves/<world_name>/`
3. 删除 `mcagent_instance.json` 文件
4. （可选）删除关联的数据库文件（如果存在）：
   - `.minecraft/saves/<world_name>/mcagent/` 目录下的数据库文件

> **注意**：删除 `mcagent_instance.json` 不会影响 Minecraft 存档，只是 Agent Core 将无法自动发现该实例。如果后续重新安装模组，模组会重新生成该文件。