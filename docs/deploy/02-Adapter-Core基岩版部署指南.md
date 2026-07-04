# Alice Mod Adapter Core 基岩版（BE）部署指南

> 版本：v1.0  
> 日期：2026-07-04  
> 适用于：BDS 1.21.x / LeviLamina 0.12.x / Node.js 20 LTS+

---

## 第1章 概述

### 1.1 Adapter Core BE 的角色

Adapter Core BE 是 Alice Mod 三层解耦架构中的**接入核心（基岩版）**，作为运行在 Minecraft Bedrock Dedicated Server（BDS）上的 LeviLamina 插件，负责：

- **执行 AI 低级操作**：将 Agent Core 下发的 JSON-RPC 2.0 指令转换为游戏内的具体操作（移动、挖掘、放置、战斗等）
- **游戏内工具集**：提供 108+ 游戏内工具，涵盖感知、移动、背包、战斗、方块、交互、生存、对话等类别
- **状态数据上报**：实时采集假人的位置、血量、饥饿度、背包内容等状态，通过 TCP 连接上报给 Agent Core
- **工具热注册**：插件启动时自动扫描 tools/ 目录，动态注册工具到 Agent Core，支持运行时热更新

### 1.2 体系位置图

```
┌─────────────────────────────────────────────────────────────────┐
│                     Agent Core（智能体核心）                        │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐   │
│  │ LLM 调度层 │  │ 工作区管理  │  │ 记忆系统   │  │ QQ 机器人  │   │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘   │
│        └───────────────┴───────────────┴───────────────┘        │
│                           │                                      │
│                    TCP 服务端（JSON-RPC 2.0）                     │
│                   端口：21000（默认）                              │
└──────────────────────────┬──────────────────────────────────────┘
                           │ TCP 长连接
                           │ （心跳保活 / 批量调用 / 工具注册）
                           │
┌──────────────────────────┴──────────────────────────────────────┐
│                 Adapter Core BE（接入核心 · 基岩版）                │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              LeviLamina 插件（mcagent-adapter-be）        │   │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │   │
│  │  │ TCP 客户端│ │ 工具管理器 │ │ 假人控制器 │ │ 状态上报器  │  │   │
│  │  └────┬────┘ └────┬─────┘ └────┬─────┘ └──────┬─────┘  │   │
│  │       └───────────┴────────────┴───────────────┘        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                      │
│                    LeviLamina 加载器                              │
│                           │                                      │
│              Minecraft Bedrock Dedicated Server                  │
│                    BDS 1.21.x                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 通信流程

1. **启动连接**：Adapter Core BE 启动后，通过 TCP 客户端向 Agent Core 发起连接
2. **握手认证**：发送握手消息，包含版本号、插件版本、认证令牌
3. **工具注册**：自动扫描并上报所有可用工具列表（JSON Schema 格式）
4. **心跳保活**：每 10 秒发送心跳包，检测连接状态
5. **指令执行**：接收 Agent Core 下发的工具调用请求，执行并返回结果
6. **状态上报**：定期上报假人状态（位置、血量、背包等）

---

## 第2章 环境要求

### 2.1 软件要求

| 组件 | 版本要求 | 说明 |
|------|---------|------|
| 操作系统 | Windows Server 2019+ 或 Linux（Ubuntu 22.04+） | 推荐使用 Windows Server 2022 |
| Minecraft Bedrock Dedicated Server（BDS） | 1.21.x | 需与 LeviLamina 版本兼容 |
| LeviLamina | 0.12.x+ | BDS 插件加载器 |
| Node.js | 20 LTS+ | 用于 TCP 客户端和工具注册运行环境 |
| 内存 | ≥ 2GB（推荐 4GB） | BDS 本身约占用 1-2GB |

**Windows 额外要求**：

- Visual C++ Redistributable（2015-2022）
- 若使用 Linux，需安装 Wine 或直接运行 Linux 版 BDS

**Linux 额外要求**：

- libc6 2.31+
- libstdc++ 6
- zlib1g

### 2.2 网络要求

| 项目 | 说明 |
|------|------|
| 网络拓扑 | 与 Agent Core 在同一局域网或公网可达 |
| TCP 端口 | 默认 21000（可在 config.json 中配置） |
| 防火墙 | 需开放 TCP 端口，允许 Adapter Core 向 Agent Core 发起连接 |
| 延迟 | 建议 < 50ms，过高延迟会影响工具响应速度 |
| 带宽 | ≥ 10Mbps，用于状态数据上报 |

### 2.3 端口说明

| 端口 | 方向 | 用途 |
|------|------|------|
| 21000（默认） | 出站（Adapter Core → Agent Core） | TCP 通信连接 |
| 19132（默认） | 入站 | BDS 游戏端口（玩家连接） |

---

## 第3章 安装

### 3.1 安装 BDS

#### 3.1.1 下载 BDS

**方法一：官方下载**

访问 [Minecraft 官方下载页面](https://www.minecraft.net/zh-hans/download/server/bedrock) 下载最新 BDS 1.21.x 版本。

**方法二：使用 bdsdown 工具（推荐）**

若已安装 LeviLamina，可使用自带的 `bdsdown.exe` 工具自动下载：

```bash
# 在 BDS 根目录执行
.\bdsdown.exe --version 1.21.0
```

#### 3.1.2 目录结构说明

BDS 解压后的目录结构如下：

```
bedrock_server/
├── bedrock_server.exe          # Windows 版 BDS 启动器
├── bedrock_server_mod.exe      # LeviLamina 修改版启动器（安装 LeviLamina 后出现）
├── bedrock_server_how_to.html  # 官方说明文档
├── server.properties            # 服务器配置文件
├── permissions.json             # 权限配置文件
├── allowlist.json               # 白名单配置
├── worlds/                      # 存档目录
│   └── Bedrock level/           # 默认存档
│       ├── level.dat            # 存档数据
│       ├── level.dat_old        # 存档备份
│       ├── levelname.txt        # 存档名称
│       └── db/                  # 存档数据库
├── behavior_packs/              # 行为包目录
├── resource_packs/              # 资源包目录
├── plugins/                     # 插件目录（安装 LeviLamina 后自动创建）
├── config/                      # 配置文件目录
├── logs/                        # 日志目录
│   └── latest.log               # 最新日志
└── data/                        # 数据目录
```

#### 3.1.3 首次启动 BDS

解压后先启动一次 BDS，让其生成必要的配置文件和存档：

```bash
# Windows
.\bedrock_server.exe

# Linux
./bedrock_server
```

首次启动后，确认控制台输出正常，然后输入 `stop` 停止服务器。

### 3.2 安装 LeviLamina

#### 3.2.1 下载 LeviLamina

访问 [LeviLamina GitHub Releases](https://github.com/LiteLDev/LeviLamina/releases) 下载适用于 BDS 1.21.x 的版本（0.12.x+）。

#### 3.2.2 安装步骤

1. 将下载的 LeviLamina 压缩包解压到 BDS 根目录
2. 覆盖所有文件，LeviLamina 会自动替换 `bedrock_server.exe` 为 `bedrock_server_mod.exe`

#### 3.2.3 验证安装

确认以下文件存在：

```bash
# 检查 LeviLamina 加载器主文件
ls bedrock_server_mod.exe       # Windows
ls LeviLamina.dll               # Windows 动态链接库
ls plugins/LeviLamina/          # LeviLamina 插件目录
```

如果 `bedrock_server_mod.exe` 存在，说明 LeviLamina 安装成功。

#### 3.2.4 安装 LeviLamina 依赖插件

Adapter Core BE 需要以下 LeviLamina 基础插件：

- **LegacyRemoteCall**：跨插件远程调用接口（已在 plugins/ 目录中自动安装）
- **LeviLamina**：核心加载器

确认 `plugins/` 目录下包含这两个插件子目录。

### 3.3 安装 Adapter Core 插件

#### 3.3.1 获取插件包

将 `mcagent-adapter-be` 插件包复制到 BDS 的 `plugins/` 目录下。

#### 3.3.2 最终目录结构

安装完成后，BDS 目录结构如下：

```
bedrock_server/
├── bedrock_server.exe                  # 原版 BDS 启动器
├── bedrock_server_mod.exe              # LeviLamina 修改版启动器（用于启动）
├── plugins/                            # 插件目录
│   ├── LeviLamina/                     # LeviLamina 核心插件
│   │   ├── LeviLamina.dll
│   │   ├── CrashLogger.exe
│   │   ├── manifest.json
│   │   └── config/
│   ├── LegacyRemoteCall/               # 远程调用依赖
│   │   └── manifest.json
│   └── mcagent-adapter-be/             # ★ Adapter Core 插件目录
│       ├── manifest.json               # LeviLamina 插件清单
│       ├── index.js                    # 插件入口文件
│       ├── package.json                # Node.js 依赖配置
│       ├── config.json                 # 插件配置文件
│       ├── tools/                      # 工具模块（自动扫描注册）
│       │   ├── movement/               # 移动工具
│       │   │   ├── index.js
│       │   │   └── manifest.json
│       │   ├── inventory/              # 背包工具
│       │   │   ├── index.js
│       │   │   └── manifest.json
│       │   ├── combat/                 # 战斗工具
│       │   │   ├── index.js
│       │   │   └── manifest.json
│       │   ├── block/                  # 方块工具
│       │   │   ├── index.js
│       │   │   └── manifest.json
│       │   ├── interaction/            # 交互工具
│       │   │   ├── index.js
│       │   │   └── manifest.json
│       │   └── survival/               # 生存工具
│       │       ├── index.js
│       │       └── manifest.json
│       └── custom_tools/               # 用户自定义工具目录（可选）
├── worlds/                             # 存档目录
│   └── Bedrock level/
├── mcagent_instance.json               # ★ 实例配置文件（插件首次启动时自动生成）
├── server.properties                   # BDS 服务器配置
├── allowlist.json                      # 白名单
└── permissions.json                    # 权限配置
```

#### 3.3.3 插件安装验证

启动 BDS 后，在控制台日志中看到以下内容即表示插件安装成功：

```
[McAgent] Loading McAgent Adapter BE plugin...
[McAgent] Tools registered: 108 tools loaded
[McAgent] Connecting to Agent Core at 127.0.0.1:21000...
[McAgent] TCP connection established
```

---

## 第4章 配置

### 4.1 config.json 配置

`config.json` 位于 `plugins/mcagent-adapter-be/` 目录下，是插件的主要配置文件。

#### 4.1.1 完整配置示例

```json
{
  "agent_core": {
    "host": "127.0.0.1",
    "port": 21000,
    "reconnect_interval": 5000,
    "heartbeat_interval": 10000,
    "auth_token": ""
  },
  "bot": {
    "name": "Alice",
    "auto_spawn": true,
    "spawn_position": {
      "x": 0,
      "y": 64,
      "z": 0
    },
    "respawn_on_death": true,
    "skin": "steve"
  },
  "tools": {
    "auto_scan": true,
    "custom_tools_dir": "custom_tools",
    "scan_interval": 30000
  },
  "network": {
    "max_retries": 5,
    "timeout": 30000,
    "buffer_size": 65536
  },
  "logging": {
    "level": "info",
    "file": "logs/mcagent.log",
    "max_size": 10485760,
    "max_files": 5
  }
}
```

#### 4.1.2 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `agent_core.host` | string | `"127.0.0.1"` | Agent Core 的 TCP 服务端地址 |
| `agent_core.port` | number | `21000` | Agent Core 的 TCP 服务端端口 |
| `agent_core.reconnect_interval` | number | `5000` | 断线重连间隔（毫秒） |
| `agent_core.heartbeat_interval` | number | `10000` | 心跳包发送间隔（毫秒） |
| `agent_core.auth_token` | string | `""` | 认证令牌（空表示不认证） |
| `bot.name` | string | `"Alice"` | 假人名称 |
| `bot.auto_spawn` | boolean | `true` | 是否在插件加载时自动生成假人 |
| `bot.spawn_position` | object | `{x:0, y:64, z:0}` | 假人生成坐标 |
| `bot.respawn_on_death` | boolean | `true` | 假人死亡后是否自动重生 |
| `bot.skin` | string | `"steve"` | 假人皮肤（steve/alex 或自定义） |
| `tools.auto_scan` | boolean | `true` | 是否自动扫描 tools/ 目录注册工具 |
| `tools.custom_tools_dir` | string | `"custom_tools"` | 自定义工具目录名称 |
| `tools.scan_interval` | number | `30000` | 工具目录扫描间隔（毫秒） |
| `network.max_retries` | number | `5` | 最大重试次数 |
| `network.timeout` | number | `30000` | 网络超时时间（毫秒） |
| `network.buffer_size` | number | `65536` | 接收缓冲区大小（字节） |
| `logging.level` | string | `"info"` | 日志级别（debug/info/warn/error） |
| `logging.file` | string | `"logs/mcagent.log"` | 日志文件路径 |
| `logging.max_size` | number | `10485760` | 单个日志文件最大大小（字节） |
| `logging.max_files` | number | `5` | 保留的日志文件数量 |

### 4.2 mcagent_instance.json（自动生成）

#### 4.2.1 文件生成时机

`mcagent_instance.json` 位于 BDS 根目录，由 Adapter Core 插件在**首次加载成功**时自动生成。

#### 4.2.2 文件内容示例

```json
{
  "instance_id": "be-7a3f8c21-9b4d-4e6f-a1c5-2d8e3f7a0b6c",
  "world_id": "bedrock-level-7a3f8c21",
  "server_name": "McAgent BE Server",
  "game_version": "1.21.0",
  "platform": "bedrock",
  "adapter_type": "levilamina",
  "host": "127.0.0.1",
  "port": 21000,
  "db_path": "./plugins/mcagent-adapter-be/data",
  "tools_count": 108,
  "created_at": "2026-07-04T12:00:00Z",
  "updated_at": "2026-07-04T12:00:00Z"
}
```

#### 4.2.3 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `instance_id` | string | 实例唯一标识符（UUID） |
| `world_id` | string | 当前存档的标识符 |
| `server_name` | string | 服务器名称（从 server.properties 读取） |
| `game_version` | string | BDS 游戏版本 |
| `platform` | string | 平台标识（固定为 "bedrock"） |
| `adapter_type` | string | 适配器类型（固定为 "levilamina"） |
| `host` | string | Agent Core 地址 |
| `port` | number | Agent Core 端口 |
| `db_path` | string | 插件数据存储路径 |
| `tools_count` | number | 已注册的工具数量 |
| `created_at` | string | 实例创建时间 |
| `updated_at` | string | 实例最后更新时间 |

#### 4.2.4 Agent Core 发现机制

Agent Core 通过扫描 `mcagent_instance.json` 文件来发现可用的游戏实例：

1. 用户在 Agent Core UI 中添加实例路径
2. Agent Core 读取 `mcagent_instance.json` 获取连接信息
3. Agent Core 根据 `host` 和 `port` 建立 TCP 连接
4. 连接建立后，Adapter Core 自动上报工具列表

### 4.3 安全配置

#### 4.3.1 白名单模式

在 BDS 的 `allowlist.json` 中启用白名单，仅允许指定玩家和假人加入：

```json
[
  {
    "name": "Alice",
    "xuid": "2535458596252273"
  }
]
```

在 `server.properties` 中启用白名单：

```properties
allow-list=true
```

#### 4.3.2 操作权限控制

在 `permissions.json` 中配置假人权限：

```json
[
  {
    "permission": "operator",
    "xuid": "2535458596252273"
  }
]
```

建议将假人设为 `operator` 权限，以确保工具能够正常执行所有操作（如设置方块、生成实体等）。

#### 4.3.3 命令黑名单

在 `config.json` 中配置禁止执行的命令列表：

```json
{
  "security": {
    "command_blacklist": [
      "kick",
      "ban",
      "op",
      "deop",
      "stop",
      "reload",
      "difficulty peaceful",
      "gamerule doDaylightCycle false",
      "time set",
      "weather"
    ],
    "blocked_operations": [
      "setblock ~ ~ ~ air",
      "fill ~ ~ ~ ~ ~ ~ air",
      "kill @e"
    ]
  }
}
```

黑名单中的命令和操作将被 Adapter Core 拦截，不会执行。

#### 4.3.4 网络加密

若需要加密 TCP 通信，可在 `config.json` 中启用 TLS：

```json
{
  "agent_core": {
    "use_tls": true,
    "tls_cert": "path/to/cert.pem",
    "tls_key": "path/to/key.pem"
  }
}
```

---

## 第5章 运行与验证

### 5.1 启动顺序

正确的启动顺序至关重要。请严格按照以下步骤操作：

```
步骤1：启动 Agent Core（TCP 服务端）
        ↓
步骤2：启动 BDS 服务器（LeviLamina 加载器）
        ↓
步骤3：等待 Adapter Core 插件自动加载
        ↓
步骤4：验证 TCP 连接状态
```

#### 5.1.1 启动 Agent Core

确保 Agent Core 已启动并开始监听 TCP 端口：

```bash
# Agent Core 启动命令（示例）
cd /path/to/agent-core
npm start
```

确认 Agent Core 控制台输出：

```
[Agent Core] TCP Server listening on port 21000
[Agent Core] Waiting for Adapter Core connections...
```

#### 5.1.2 启动 BDS 服务器

使用 `bedrock_server_mod.exe`（而非 `bedrock_server.exe`）启动服务器：

```bash
# Windows
.\bedrock_server_mod.exe

# Linux
./bedrock_server_mod
```

**注意**：必须使用 `bedrock_server_mod.exe`，原版 `bedrock_server.exe` 不会加载 LeviLamina 插件。

#### 5.1.3 等待插件加载

BDS 启动后，LeviLamina 会自动加载 `plugins/` 目录下的所有插件，包括 `mcagent-adapter-be`。

观察控制台输出，按顺序应看到以下日志：

```
[LeviLamina] Loading plugins...
[LeviLamina] Loaded plugin: LegacyRemoteCall
[LeviLamina] Loaded plugin: mcagent-adapter-be
[McAgent] =========================================
[McAgent]  McAgent Adapter BE v1.0.0
[McAgent]  Loading plugin...
[McAgent] =========================================
[McAgent] Scanning tools directory...
[McAgent] Found 108 tools in 6 categories
[McAgent] TCP Client connecting to 127.0.0.1:21000...
[McAgent] Handshake sent, waiting for response...
```

### 5.2 验证

#### 5.2.1 验证 TCP 连接状态

**方法一：查看服务器日志**

在 BDS 控制台中看到以下日志表示连接成功：

```
[McAgent] ✅ McAgent Adapter BE connected to Agent Core
[McAgent] Tools registered: 108 tools
[McAgent] Bot "Alice" spawned at (0, 64, 0)
[McAgent] Heartbeat started (interval: 10000ms)
```

**方法二：查看 Agent Core 日志**

在 Agent Core 端看到：

```
[Agent Core] New connection from 127.0.0.1:54321
[Agent Core] Handshake received: adapter=be, version=1.0.0
[Agent Core] Tools registered: 108 tools from adapter
[Agent Core] Workspace "Alice" (be-7a3f8c21-...) is online
```

**方法三：Agent Core UI 验证**

在 Agent Core 的 Web UI 中，工作区状态应显示为 **"已连接"**，并显示工具列表和假人状态信息。

#### 5.2.2 测试基本工具

**测试移动工具**

在 Agent Core 端发送移动指令，假人应移动到指定位置：

```json
// 请求
{
  "jsonrpc": "2.0",
  "method": "move_to",
  "params": {
    "x": 10,
    "y": 64,
    "z": 20
  },
  "id": 1
}

// 响应
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "position": { "x": 10, "y": 64, "z": 20 },
    "time_cost": 3500,
    "hunger_cost": 2
  },
  "id": 1
}
```

**测试查看背包**

```json
// 请求
{
  "jsonrpc": "2.0",
  "method": "get_inventory",
  "params": {},
  "id": 2
}

// 响应
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "inventory": {
      "mainhand": { "id": "minecraft:diamond_pickaxe", "count": 1 },
      "offhand": { "id": "minecraft:torch", "count": 10 },
      "hotbar": [
        { "slot": 0, "id": "minecraft:dirt", "count": 32 },
        { "slot": 1, "id": "minecraft:apple", "count": 5 }
      ],
      "armor": {
        "head": null,
        "chest": { "id": "minecraft:iron_chestplate", "count": 1 },
        "legs": null,
        "feet": null
      }
    }
  },
  "id": 2
}
```

#### 5.2.3 验证状态上报

确认 Agent Core 能定期收到假人状态更新：

```
[Agent Core] State update: Alice | HP: 20/20 | Hunger: 20/20 | Pos: (10, 64, 20) | Dim: overworld
```

---

## 第6章 自定义工具开发

### 6.1 工具目录结构

自定义工具位于 `plugins/mcagent-adapter-be/tools/` 目录下，每个工具类别为一个子目录：

```
tools/
├── movement/              # 移动工具
│   ├── manifest.json      # 工具元数据
│   └── index.js           # 工具实现
├── inventory/             # 背包工具
│   ├── manifest.json
│   └── index.js
├── combat/                # 战斗工具
│   ├── manifest.json
│   └── index.js
├── block/                 # 方块工具
│   ├── manifest.json
│   └── index.js
├── interaction/           # 交互工具
│   ├── manifest.json
│   └── index.js
└── survival/              # 生存工具
    ├── manifest.json
    └── index.js
```

每个工具模块的 `manifest.json` 定义了工具的元信息和 JSON Schema：

```json
{
  "name": "move_to",
  "description": "移动假人到指定坐标位置",
  "category": "movement",
  "version": "1.0.0",
  "params": {
    "type": "object",
    "properties": {
      "x": { "type": "number", "description": "目标 X 坐标" },
      "y": { "type": "number", "description": "目标 Y 坐标" },
      "z": { "type": "number", "description": "目标 Z 坐标" }
    },
    "required": ["x", "y", "z"]
  }
}
```

### 6.2 自定义工具示例

下面是一个自定义工具的完整实现示例：

**plugins/mcagent-adapter-be/custom_tools/hello/index.js**

```javascript
// 自定义工具：向游戏内发送打招呼消息
module.exports = {
  // 工具元数据（自动合并到工具列表）
  manifest: {
    name: "say_hello",
    description: "向游戏内发送打招呼消息",
    category: "custom",
    version: "1.0.0",
    params: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "打招呼的目标名称"
        }
      },
      required: ["target"]
    }
  },

  // 工具执行函数
  async execute(params, context) {
    const { target } = params;
    const message = `Hello, ${target}! I am ${context.bot_name}.`;

    // 调用游戏内发送消息接口
    context.sendMessage(message);

    return {
      success: true,
      message: message,
      target: target
    };
  }
};
```

**plugins/mcagent-adapter-be/custom_tools/hello/manifest.json**

```json
{
  "name": "say_hello",
  "description": "向游戏内发送打招呼消息",
  "category": "custom",
  "version": "1.0.0",
  "params": {
    "type": "object",
    "properties": {
      "target": {
        "type": "string",
        "description": "打招呼的目标名称"
      }
    },
    "required": ["target"]
  }
}
```

### 6.3 优先级规则

工具注册时的优先级规则如下：

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 最高 | `custom_tools/` | 用户自定义工具，覆盖同名内置工具 |
| 中 | `tools/` | 内置工具模块 |
| 低 | 硬编码注册 | 插件代码中硬编码注册的工具 |

**优先级覆盖规则**：

- 若 `custom_tools/` 的 `movement/` 目录下存在同名工具，将覆盖 `tools/movement/` 中的内置实现
- 若 `custom_tools/` 中定义了新的工具类别，将自动注册到 Agent Core 的工具列表
- Agent Core 端以工具名称（`name`）为唯一标识，同名的工具以后注册的为准

### 6.4 热重载

修改 `tools/` 或 `custom_tools/` 目录下的工具文件后，无需重启 BDS 即可重新加载：

**方法一：自动热重载**

在 `config.json` 中启用自动扫描：

```json
{
  "tools": {
    "auto_scan": true,
    "scan_interval": 30000
  }
}
```

插件将每隔 30 秒扫描工具目录，检测到变化后自动重新注册。

**方法二：手动触发重载**

在 BDS 控制台执行命令：

```
/reload-tools
```

执行后，控制台输出：

```
[McAgent] Reloading tools...
[McAgent] Scanned tools directory: 109 tools found (1 new)
[McAgent] Tools re-registered with Agent Core
```

**方法三：通过 Agent Core 触发**

在 Agent Core 端发送重新加载指令：

```json
{
  "jsonrpc": "2.0",
  "method": "reload_tools",
  "params": {},
  "id": 3
}
```

---

## 第7章 常见问题

### 7.1 TCP 连接失败

**现象**：日志显示 `[McAgent] TCP connection failed, retrying in 5000ms...`

**可能原因和解决方法**：

| 原因 | 解决方法 |
|------|---------|
| Agent Core 未启动 | 先启动 Agent Core，确保 TCP 服务端正在监听端口 |
| 端口配置错误 | 检查 `config.json` 中 `agent_core.port` 是否与 Agent Core 配置一致 |
| 防火墙阻止连接 | 检查防火墙规则，确保允许出站 TCP 连接到目标端口 |
| 网络不可达 | 使用 `ping` 和 `telnet` 测试 Agent Core 地址和端口的连通性 |
| Agent Core 地址错误 | 检查 `agent_core.host` 配置，确保使用正确的 IP 地址 |

**诊断命令**：

```bash
# 测试 TCP 端口连通性（Windows）
Test-NetConnection -ComputerName 127.0.0.1 -Port 21000

# 测试 TCP 端口连通性（Linux）
telnet 127.0.0.1 21000
```

### 7.2 插件加载失败

**现象**：BDS 启动时未看到 `[McAgent]` 相关日志，或出现错误堆栈。

**可能原因和解决方法**：

| 原因 | 解决方法 |
|------|---------|
| LeviLamina 版本不兼容 | 确认 LeviLamina 版本为 0.12.x+，与 BDS 1.21.x 兼容 |
| Node.js 未安装或版本过低 | 安装 Node.js 20 LTS+，确认 `node --version` 输出正确 |
| 插件 manifest.json 格式错误 | 检查 `manifest.json` 的 JSON 格式是否正确 |
| 依赖插件缺失 | 确保 `LegacyRemoteCall` 等依赖插件已安装 |
| 文件权限不足 | 检查插件目录和文件的读写权限 |

**诊断步骤**：

1. 检查 BDS 日志文件 `logs/latest.log` 中的错误信息
2. 确认 `plugins/mcagent-adapter-be/manifest.json` 格式正确
3. 确认 `bedrock_server_mod.exe` 存在且可执行
4. 尝试手动运行 Node.js 检查语法错误：`node --check plugins/mcagent-adapter-be/index.js`

### 7.3 工具注册失败

**现象**：插件加载成功，但 Agent Core 未收到工具列表。

**可能原因和解决方法**：

| 原因 | 解决方法 |
|------|---------|
| tools/ 目录为空或不存在 | 确认 `tools/` 目录下包含至少一个工具模块 |
| 工具 manifest.json 格式错误 | 检查每个工具目录下的 `manifest.json` 格式 |
| 工具执行函数导出错误 | 检查工具 `index.js` 是否正确导出了 `execute` 函数 |
| TCP 连接未建立 | 先解决 TCP 连接问题（见 7.1） |

**诊断步骤**：

1. 检查 BDS 日志中是否有 `[McAgent] Scanning tools directory...` 的输出
2. 确认工具目录结构完整，每个子目录都包含 `manifest.json` 和 `index.js`
3. 在 Agent Core 端查看工具列表是否为空

### 7.4 假人无法生成

**现象**：插件加载成功，TCP 连接正常，但游戏中没有假人实体。

**可能原因和解决方法**：

| 原因 | 解决方法 |
|------|---------|
| `auto_spawn` 设置为 false | 将 `config.json` 中 `bot.auto_spawn` 改为 `true` |
| 世界未完全加载 | 等待 BDS 完全启动后，假人会自动生成 |
| 生成位置不可用 | 修改 `spawn_position` 为安全坐标（如出生点上方） |
| 玩家数量已达上限 | 在 `server.properties` 中调高 `max-players` |
| 假人名称冲突 | 确保 `bot.name` 不与已有玩家或其他假人重名 |

**手动生成假人**：

在 BDS 控制台执行命令：

```
/spawn-bot
```

或在 Agent Core 端发送指令：

```json
{
  "jsonrpc": "2.0",
  "method": "spawn_bot",
  "params": {
    "name": "Alice",
    "position": { "x": 0, "y": 64, "z": 0 }
  },
  "id": 4
}
```

### 7.5 权限不足

**现象**：工具执行时返回 `"success": false`，错误信息包含 "permission denied"。

**可能原因和解决方法**：

| 原因 | 解决方法 |
|------|---------|
| 假人不是 OP 权限 | 在 `permissions.json` 中将假人设为 operator |
| 命令被黑名单拦截 | 检查 `config.json` 中的 `command_blacklist` 配置 |
| BDS 权限限制 | 确保假人拥有执行对应操作所需的游戏权限 |
| 操作被其他插件拦截 | 检查是否有其他 LeviLamina 插件拦截了操作 |

### 7.6 心跳超时断开

**现象**：连接建立后，一段时间后自动断开，日志显示 `Heartbeat timeout`。

**可能原因和解决方法**：

| 原因 | 解决方法 |
|------|---------|
| 网络不稳定 | 检查网络质量，确保延迟稳定 |
| 心跳间隔不一致 | 确认 Adapter Core 和 Agent Core 的 `heartbeat_interval` 配置一致 |
| BDS 服务器过载 | 降低 BDS 的视距和实体数量，减少服务器负载 |
| 防火墙超时 | 检查防火墙的连接超时策略，适当延长超时时间 |

---

## 第8章 更新与卸载

### 8.1 更新插件

#### 8.1.1 更新前准备

1. **备份配置**：备份 `plugins/mcagent-adapter-be/config.json`
2. **备份自定义工具**：备份 `plugins/mcagent-adapter-be/custom_tools/` 目录
3. **记录版本**：记录当前插件版本号

#### 8.1.2 更新步骤

1. 停止 BDS 服务器（在控制台输入 `stop`）
2. 删除旧的插件目录：`plugins/mcagent-adapter-be/`
3. 解压新版本的 `mcagent-adapter-be` 到 `plugins/` 目录
4. 恢复备份的 `config.json` 配置文件
5. 恢复备份的 `custom_tools/` 自定义工具目录
6. 启动 BDS 服务器（`bedrock_server_mod.exe`）
7. 验证插件版本和工具数量

#### 8.1.3 更新后验证

```bash
# 检查插件版本
# 在 BDS 控制台执行
/version

# 期望输出
[McAgent] McAgent Adapter BE v1.1.0
[McAgent] 108 tools registered
```

### 8.2 卸载插件

#### 8.2.1 卸载步骤

1. 停止 BDS 服务器
2. 删除 `plugins/mcagent-adapter-be/` 目录
3. 可选：清理自动生成的实例配置文件

#### 8.2.2 卸载后检查

- 确认 `plugins/` 目录下不再包含 `mcagent-adapter-be/`
- 确认 BDS 启动时不再加载 McAgent 相关日志
- 确认 `mcagent_instance.json` 已被清理或不再使用

### 8.3 清理 mcagent_instance.json

卸载插件后，建议手动删除 `mcagent_instance.json` 文件，以避免 Agent Core 尝试连接已不存在的实例：

```bash
# 删除 BDS 根目录下的实例配置文件
rm bedrock_server/mcagent_instance.json
```

若希望保留实例配置以便后续重新安装后复用，可保留该文件。

### 8.4 完全清理

如需完全清除 McAgent 在 BDS 上的所有痕迹，按以下步骤操作：

1. 停止 BDS 服务器
2. 删除 `plugins/mcagent-adapter-be/` 插件目录
3. 删除 `mcagent_instance.json` 实例配置文件
4. 删除 `logs/mcagent.log` 日志文件（如有）
5. 删除 `plugins/mcagent-adapter-be/data/` 数据目录（如有）
6. 在 Agent Core 中移除对应的实例配置

---

## 附录

### A. 配置文件索引

| 文件 | 路径 | 自动生成 |
|------|------|---------|
| config.json | `plugins/mcagent-adapter-be/config.json` | 否（手动配置） |
| mcagent_instance.json | `bedrock_server/mcagent_instance.json` | 是（首次加载时） |
| server.properties | `bedrock_server/server.properties` | 是（BDS 首次启动时） |
| permissions.json | `bedrock_server/permissions.json` | 是（BDS 首次启动时） |
| allowlist.json | `bedrock_server/allowlist.json` | 否（手动配置） |

### B. 端口速查表

| 端口 | 协议 | 用途 | 配置位置 |
|------|------|------|---------|
| 21000 | TCP | Agent Core ↔ Adapter Core 通信 | config.json → agent_core.port |
| 19132 | UDP | BDS 游戏端口 | server.properties → server-port |

### C. 日志文件位置

| 日志文件 | 路径 | 用途 |
|----------|------|------|
| BDS 日志 | `bedrock_server/logs/latest.log` | BDS 和所有插件的运行日志 |
| McAgent 日志 | `bedrock_server/logs/mcagent.log` | McAgent 插件专用日志 |
| Agent Core 日志 | Agent Core 目录下的日志文件 | Agent Core 端日志 |

### D. 快速启动命令（Windows）

```powershell
# 1. 启动 Agent Core（新终端）
cd C:\agent-core
npm start

# 2. 启动 BDS 服务器（新终端）
cd D:\McAgent\bds26.10
.\bedrock_server_mod.exe
```

### E. 快速启动命令（Linux）

```bash
# 1. 启动 Agent Core
cd /opt/agent-core
npm start &

# 2. 启动 BDS 服务器
cd /opt/minecraft/bedrock_server
./bedrock_server_mod
```