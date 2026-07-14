# Alice Mod Core — 世界上下文切换（World Context）

> 版本：v1.0
> 日期：2026-07-14
> 对应需求：JE-10-§9 Agent Core 侧变更
> 关联文档：[JE-10-客户端服务端运行与多存档设计.md](../JE/JE-10-客户端服务端运行与多存档设计.md)、[AC-WS-工作区切换UI.md](AC-WS-工作区切换UI.md)

---

## 第一部分：需求文档

### 1.1 模块定位

世界上下文切换（World Context 切换）是 Agent Core 中**世界级会话管理**的可视化入口。它是工作区（Workspace）的下级粒度——一个工作区对应一个 Adapter Core 实例（一个 Minecraft 进程），而一个工作区下可以有多个世界上下文（World Context），对应同一个 Minecraft 进程中的不同存档/世界。

**核心场景：**

| 场景 | 说明 | 世界上下文数 |
|------|------|:----------:|
| 单人游戏（单个存档） | 客户端内置服务器，加载单个存档 | 1 |
| 单人游戏（切存档） | 退出当前世界 → 加载另一个存档 | 依次切换，同时 1 个 |
| 连接远程服务器 | 作为客户端连接多人游戏（客场休眠） | 0（客户端侧休眠） |
| 纯服务端（单世界） | Dedicated Server 运行单个世界 | 1 |
| 纯服务端（多世界插件） | 安装了多世界插件，同时管理多个世界 | N（同时活跃） |
| 局域网开放 | 主机开放到 LAN，游客加入 | 主机 1，游客 0 |

**核心职责：**

| 职责 | 说明 |
|------|------|
| **世界列表展示** | 在工作区详情中展示当前工作区下的所有世界上下文 |
| **世界切换** | 切换当前活跃的世界上下文，切换 LLM 会话上下文 |
| **世界状态同步** | 实时显示各世界的在线/离线状态 |
| **世界上下文隔离** | 每个世界有独立的 instance_id、工具执行上下文、对话历史 |

### 1.2 与工作区的关系

```
Agent Core
└── Workspace A（对应一个 Adapter Core 实例，即一个 Minecraft 进程）
    ├── World Context A（存档 "New World"）
    │   ├── instance_id: d4e5f6a7-...
    │   ├── world_name: "New World"
    │   ├── TCP 连接（独立）
    │   ├── BotManager（独立）
    │   └── 对话历史 / 工具调用记录
    │
    └── World Context B（存档 "Another World"）
        ├── instance_id: b8c9d0e1-...
        ├── world_name: "Another World"
        ├── TCP 连接（独立）
        ├── BotManager（独立）
        └── 对话历史 / 工具调用记录
```

| 概念 | 粒度 | 说明 |
|------|:----:|------|
| **工作区（Workspace）** | 进程级 | 一个 Minecraft 进程（一个 Adapter Core 实例） |
| **世界上下文（World Context）** | 世界级 | 一个 Minecraft 世界（存档/维度） |
| **工作区切换** | 切换进程 | 标题栏左侧 Dropdown |
| **世界切换** | 切换世界 | 标题栏右侧 Dropdown（贴在工作区切换栏旁边） |

### 1.3 启用条件

世界上下文切换**只在以下场景启用**：

| 场景 | 是否启用世界上下文 | 说明 |
|:----:|:-----------------:|------|
| 客户端模式（单人游戏） | ✅ 启用 | 客户端内置服务器，有本地 MinecraftServer 实例 |
| 多世界服务端（安装多世界插件） | ✅ 启用 | 一个 DedicatedServer 管理多个世界 |
| 标准服务端（单世界） | ❌ 不启用 | 只有一个世界，无需切换 |
| 客户端连接远程服务器 | ❌ 不启用 | 客场休眠，无本地 Server |

**判定逻辑：**
- 当 Adapter Core 上报的 `handshake` 消息中包含 `world_name` 字段时，AC 认为该连接支持世界上下文
- 当 `world_online` 通知/事件发生时，AC 根据 `world_name` 创建或切换世界上下文
- 当 `world_offline` 通知/事件发生时，AC 标记对应世界上下文为离线状态

### 1.4 功能需求列表

| 需求 ID | 需求名称 | 优先级 | 状态 |
|---------|----------|:------:|:----:|
| AC-WC-01 | 世界上下文会话管理 | P0 | 未开始 |
| AC-WC-02 | 世界切换前端入口 | P0 | 未开始 |
| AC-WC-03 | 世界状态实时同步 | P0 | 未开始 |
| AC-WC-04 | 世界切换时 LLM 上下文切换 | P1 | 未开始 |
| AC-WC-05 | 多世界数据隔离 | P1 | 未开始 |

#### AC-WC-01 世界上下文会话管理

| 子需求 | 说明 |
|--------|------|
| WorldSession 数据结构 | 每个世界上下文包含 instance_id + world_name + 连接状态 + 工具执行上下文 |
| 会话注册 | 收到 `handshake`（v2 扩展）时，创建或恢复 WorldSession |
| 会话切换 | 收到 `world_online` 通知时，切换当前活跃的 WorldSession |
| 会话下线 | 收到 `world_offline` 通知时，标记 WorldSession 为 OFFLINE |
| 会话恢复 | 相同 world_name 重新上线时，恢复之前的会话上下文 |

#### AC-WC-02 世界切换前端入口

| 子需求 | 说明 |
|--------|------|
| 标题栏入口 | 在 CustomTitleBar 中，紧贴 WorkspaceDropdown 右侧，显示世界切换下拉菜单 |
| 世界列表 | 下拉菜单展示当前工作区下的所有世界上下文 |
| 世界切换 | 点击世界条目，切换当前活跃的世界上下文 |
| 状态显示 | 每个世界条目显示状态圆点（绿色=在线、黄色=连接中、灰色=离线） |
| 空状态 | 当前工作区不支持世界上下文时，隐藏世界切换入口 |

#### AC-WC-03 世界状态实时同步

| 子需求 | 说明 |
|--------|------|
| 状态推送 | 主进程通过 IPC 事件推送世界状态变化到渲染进程 |
| 列表更新 | 状态变化时，前端世界列表中的状态圆点即时更新 |
| 世界上线通知 | 世界加载完成时，前端收到 `world:online` 事件 |
| 世界下线通知 | 世界关闭/切换时，前端收到 `world:offline` 事件 |

#### AC-WC-04 世界切换时 LLM 上下文切换

| 子需求 | 说明 |
|--------|------|
| 对话历史切换 | 世界切换时，对话面板自动切换到对应世界的对话历史 |
| 工具上下文切换 | 世界切换时，工具调用上下文切换到对应世界的 Bot 状态 |
| 系统提示更新 | 世界切换时，LLM 系统提示中更新世界名称和上下文信息 |
| 记忆上下文切换 | 世界切换时，记忆系统切换到对应世界的记忆库 |

#### AC-WC-05 多世界数据隔离

| 子需求 | 说明 |
|--------|------|
| 工具调用历史隔离 | 每个世界的工具调用记录独立存储 |
| Bot 配置隔离 | 每个世界的假人配置独立存储 |
| 任务队列隔离 | 每个世界的任务队列独立存储 |
| 状态上报历史隔离 | 每个世界的状态上报历史独立存储 |

---

## 第二部分：架构文档

### 2.1 整体架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            Agent Core                                    │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                     主进程 (Main Process)                           │  │
│  │                                                                     │  │
│  │  ┌──────────────────────────────────────────────────────────────┐  │  │
│  │  │               WorldSession Manager (新增)                     │  │  │
│  │  │  ┌────────────────────────────────────────────────────────┐  │  │  │
│  │  │  │ WorldSession 注册表                                      │  │  │  │
│  │  │  │ ├── workspaceId → Map<worldName, WorldSession>          │  │  │  │
│  │  │  │ └── activeWorld: { workspaceId, worldName }             │  │  │  │
│  │  │  └────────────────────────────────────────────────────────┘  │  │  │
│  │  │                                                               │  │  │
│  │  │  WorldSession ── 每个世界一个                                  │  │  │
│  │  │  ├── instanceId: string                                      │  │  │  │
│  │  │  ├── worldName: string                                       │  │  │  │
│  │  │  ├── state: 'online' | 'offline' | 'connecting'              │  │  │  │
│  │  │  ├── connectedAt: number                                     │  │  │  │
│  │  │  ├── uptimeSeconds: number                                   │  │  │  │
│  │  │  ├── botCount: number                                        │  │  │  │
│  │  │  └── session: { conversationHistory, memoryContext, ... }    │  │  │  │
│  │  └──────────────────────────────────────────────────────────────┘  │  │
│  │                                                                     │  │
│  │  ┌──────────────────────────────────────────────────────────────┐  │  │
│  │  │              Workspace Manager (已有，扩展)                     │  │  │
│  │  │  ├── workspaces: Map<workspaceId, Workspace>                  │  │  │  │
│  │  │  └── 扩展: 每个 Workspace 关联 WorldSession 列表               │  │  │  │
│  │  └──────────────────────────────────────────────────────────────┘  │  │
│  │                                                                     │  │
│  │  ┌──────────────────────────────────────────────────────────────┐  │  │
│  │  │              TCP Server (已有，扩展)                            │  │  │
│  │  │  ├── 握手阶段解析 world_name 字段                               │  │  │
│  │  │  ├── 处理 world_online / world_offline 通知                     │  │  │
│  │  │  └── 通知 WorldSessionManager 更新状态                         │  │  │
│  │  └──────────────────────────────────────────────────────────────┘  │  │
│  │                                                                     │  │
│  │  ┌──────────────────────────────────────────────────────────────┐  │  │
│  │  │              IPC Handler (新增 world-handler)                   │  │  │
│  │  │  ├── world:list          → 获取工作区下的世界列表               │  │  │
│  │  │  ├── world:set-active    → 切换活跃世界                         │  │  │
│  │  │  └── 事件推送: world:online / world:offline / world:state-changed│  │  │
│  │  └──────────────────────────────────────────────────────────────┘  │  │
│  │                                                                     │  │
│  │  ┌──────────────────────────────────────────────────────────────┐  │  │
│  │  │              数据存储 (扩展)                                    │  │  │
│  │  │  └── instances/<instance_id>/world_<world_name>/               │  │  │
│  │  │       ├── tool_call_history.jsonl                              │  │  │
│  │  │       ├── bot_config.json                                      │  │  │
│  │  │       ├── task_queue.json                                      │  │  │
│  │  │       └── status_history/                                      │  │  │
│  │  └──────────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                   渲染进程 (Renderer)                                │  │
│  │                                                                    │  │
│  │  CustomTitleBar (扩展)                                             │  │
│  │  ┌────────────────────────────────────────────────────────────    │  │
│  │  │ [Alice] [WorkspaceDropdown ▾] [● WorldDropdown ▾]   [⚙] [─]  │  │
│  │  │                      ↑ 新增强: 世界切换下拉菜单                  │  │
│  │  └────────────────────────────────────────────────────────────    │  │
│  │                                                                    │  │
│  │  ┌──────────────────────────────────────────────────────────────┐  │  │
│  │  │  components/workspace/WorldDropdown.tsx (新增)                │  │  │
│  │  │  ├── HeroUI Dropdown 下拉菜单                                 │  │  │
│  │  │  ├── 显示当前工作区下的所有世界                                 │  │  │
│  │  │  └── 状态圆点 + 世界名称 + 版本信息                            │  │  │
│  │  └──────────────────────────────────────────────────────────────┘  │  │
│  │                                                                    │  │
│  │  ┌──────────────────────────────────────────────────────────────┐  │  │
│  │  │  stores/worldStore.ts (新增)                                  │  │  │
│  │  │  ├── worlds: WorldItem[]                                      │  │  │
│  │  │  ├── currentWorldId: string | null                            │  │  │
│  │  │  └── actions: 切换世界 / 状态同步                              │  │  │
│  │  └──────────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心数据模型

#### WorldSession（后端）

```typescript
/** 世界上下文会话状态 */
export enum WorldSessionState {
  Offline = 'offline',
  Connecting = 'connecting',
  Online = 'online',
}

/** 世界上下文会话 */
export interface WorldSessionData {
  instanceId: string
  worldName: string
  state: WorldSessionState
  edition: string
  gameVersion: string
  connectedAt: number | null
  lastOnlineAt: number | null
  uptimeSeconds: number
  botCount: number
  reason?: string           // offline reason
}

/** WorldSession 类 */
export class WorldSession {
  readonly instanceId: string
  readonly worldName: string
  state: WorldSessionState = WorldSessionState.Offline
  edition: string
  gameVersion: string
  connectedAt: number | null = null
  lastOnlineAt: number | null = null
  uptimeSeconds = 0
  botCount = 0

  /** 会话隔离数据 */
  readonly session: {
    conversationHistory: unknown[]
    memoryContext: Record<string, unknown>
  } = {
    conversationHistory: [],
    memoryContext: {},
  }

  // ... 状态切换方法
}
```

#### WorldItem（前端）

```typescript
/** 世界列表项（UI 展示用） */
export interface WorldItem {
  id: string                   // instanceId + ":" + worldName 复合键
  instanceId: string
  worldName: string
  state: 'online' | 'offline' | 'connecting'
  edition: 'bedrock' | 'java'
  gameVersion: string
  botCount: number
  uptimeSeconds: number
  lastOnlineAt?: number
}
```

### 2.3 后端架构

#### 2.3.1 WorldSessionManager

```typescript
/**
 * 世界上下文会话管理器
 *
 * 核心职责：
 * 1. 管理所有 WorldSession 的生命周期（创建/切换/下线）
 * 2. 维护工作区 ↔ 世界列表的映射关系
 * 3. 维护当前活跃的世界上下文
 * 4. 发出生命周期事件供上层模块监听
 */
export class WorldSessionManager extends EventEmitter {

  /** workspaceId → Map<worldName, WorldSession> */
  private readonly worldIndex: Map<string, Map<string, WorldSession>> = new Map()

  /** 当前活跃世界: { workspaceId, worldName } */
  private activeWorld: { workspaceId: string; worldName: string } | null = null

  // ── 核心 API ──

  /**
   * 注册世界上下文（handshake 或 world_online 时调用）
   * 如果 worldName 已存在，则恢复会话
   */
  registerWorld(workspaceId: string, params: {
    instanceId: string
    worldName: string
    edition: string
    gameVersion: string
  }): WorldSession

  /**
   * 标记世界上线（world_online 通知时调用）
   */
  setWorldOnline(workspaceId: string, worldName: string): WorldSession | undefined

  /**
   * 标记世界下线（world_offline 通知时调用）
   */
  setWorldOffline(workspaceId: string, worldName: string, reason?: string): WorldSession | undefined

  /**
   * 切换当前活跃世界
   */
  setActiveWorld(workspaceId: string, worldName: string): WorldSession | undefined

  /** 获取当前活跃世界 */
  getActiveWorld(): { workspaceId: string; worldName: string } | null

  /** 获取工作区下的所有世界 */
  getWorldsByWorkspace(workspaceId: string): WorldSession[]

  /** 获取工作区下指定世界 */
  getWorld(workspaceId: string, worldName: string): WorldSession | undefined

  /** 清理工作区下的所有世界（工作区删除时调用） */
  removeWorkspaceWorlds(workspaceId: string): void
}
```

#### 2.3.2 WorkspaceManager 扩展

在现有 `WorkspaceManager` 中增加对世界上下文的引用：

```typescript
// WorkspaceManager 新增方法
export class WorkspaceManager extends EventEmitter {
  // ... 已有方法

  /** 获取工作区下的活跃世界数量 */
  getWorldCount(workspaceId: string): number

  /** 获取工作区是否支持世界上下文（即是否有多个世界） */
  hasMultipleWorlds(workspaceId: string): boolean
}
```

#### 2.3.3 TCP 握手与通知处理

**握手阶段（v2 扩展）：**

`TcpConnection` 在 `handleRequest` 中处理 `handshake` 方法时，解析 `world_name` 字段：

```typescript
// 在 TcpConnection.handleRequest 中扩展
if (request.method === 'handshake') {
  const result = this.handshake.validate(request.params)
  // ... 现有逻辑 ...
  if (result.valid && result.instanceId) {
    // 新增: 解析世界信息
    const params = request.params as Record<string, unknown>
    const worldName = typeof params.world_name === 'string' ? params.world_name : undefined
    const worldOnline = typeof params.world_online === 'boolean' ? params.world_online : true

    this.instanceId = result.instanceId
    this.worldName = worldName ?? null    // 新增字段
    this.worldOnline = worldOnline        // 新增字段

    this.transitionTo(ConnectionState.Connected)
    this.heartbeat.start(() => this.sendPing())
  }
}
```

**world_online / world_offline 通知处理：**

```typescript
// 在 TcpConnection.handleNotification 中扩展
if (notification.method === 'world_online') {
  const params = notification.params as Record<string, unknown> | undefined
  if (params) {
    this.emit(ConnectionEvent.WorldOnline, {
      instanceId: params.instance_id,
      worldName: params.world_name,
      botCount: params.bot_count,
    })
  }
  return
}

if (notification.method === 'world_offline') {
  const params = notification.params as Record<string, unknown> | undefined
  if (params) {
    this.emit(ConnectionEvent.WorldOffline, {
      instanceId: params.instance_id,
      worldName: params.world_name,
      uptimeSeconds: params.uptime_seconds,
      botCount: params.bot_count,
      reason: params.reason,
    })
  }
  return
}
```

#### 2.3.4 TcpServer 事件转发

`TcpServer` 监听 `ConnectionEvent.WorldOnline` 和 `ConnectionEvent.WorldOffline`，转发到上层：

```typescript
// TcpServer 扩展
connection.on(ConnectionEvent.WorldOnline, (data) => {
  this.emit(ServerEvent.WorldOnline, { clientId: connection.id, ...data })
})

connection.on(ConnectionEvent.WorldOffline, (data) => {
  this.emit(ServerEvent.WorldOffline, { clientId: connection.id, ...data })
})
```

#### 2.3.5 IPC Handler（world-handler.ts）

新增 `world-handler.ts`，注册以下 IPC Channel：

| Channel | 方向 | 用途 | 请求参数 | 返回值 |
|---------|:----:|------|----------|--------|
| `world:list` | R→M | 获取工作区下的世界列表 | `{ workspaceId }` | `WorldItem[]` |
| `world:set-active` | R→M | 切换活跃世界 | `{ workspaceId, worldName }` | `{ success }` |
| `world:get-active` | R→M | 获取当前活跃世界 | `{ workspaceId }` | `WorldItem \| null` |

事件推送：

| Channel | 方向 | 用途 | 推送数据 |
|---------|:----:|------|----------|
| `world:online` | M→R | 世界上线 | `{ workspaceId, instanceId, worldName, botCount }` |
| `world:offline` | M→R | 世界下线 | `{ workspaceId, instanceId, worldName, reason }` |
| `world:state-changed` | M→R | 世界状态变化 | `{ workspaceId, worldName, state, oldState }` |
| `world:active-changed` | M→R | 活跃世界切换 | `{ workspaceId, worldName }` |

### 2.4 前端架构

#### 2.4.1 标题栏布局（扩展后）

```
┌──────────────────────────────────────────────────────────────────┐
│ Alice  [● 本地测试服 ▾]  [● New World ▾]              [⚙] [─] [□] [×]│
│         ↑ WorkspaceDropdown    ↑ WorldDropdown                      │
│         └──── 实例层 ────┘    └──── 世界层 ────┘                    │
└──────────────────────────────────────────────────────────────────┘
```

- 左侧："Alice" 文字（静态）
- 左侧-中部：`WorkspaceDropdown`（实例切换，已有）
- 中部：`WorldDropdown`（世界切换，**新增**，紧贴 WorkspaceDropdown）
- 右侧：设置按钮 + 窗口控制按钮

#### 2.4.2 WorldDropdown 组件

```
WorldDropdown — 世界切换下拉菜单
├── 仅在当前工作区有多个世界上下文时显示
├── Trigger: [状态圆点] [世界名称 ▾]
│   ├── 状态圆点: 绿色=在线、黄色=连接中、灰色=离线
│   └── 世界名称: 当前活跃世界的名称
│
├── Dropdown 展开:
│   ├── Header: "世界" + 当前工作区名称
│   ├── Separator
│   └── Section "世界列表"
│       └── Dropdown.Item × N
│           ├── 状态圆点 (online/offline/connecting)
│           ├── 世界名称
│           └── 版本信息 (JE 1.21.4)
│
└── 空状态/隐藏: 当前工作区不支持世界上下文时，不渲染
```

#### 2.4.3 worldStore（Zustand）

```typescript
interface WorldState {
  // 数据
  worlds: WorldItem[]
  currentWorldId: string | null      // instanceId:worldName 复合键
  loading: boolean

  // Actions: 列表
  refreshWorlds: (workspaceId: string) => Promise<void>
  setActiveWorld: (workspaceId: string, worldName: string) => Promise<void>

  // Actions: 事件
  handleWorldOnline: (event: { workspaceId: string; worldName: string; instanceId: string }) => void
  handleWorldOffline: (event: { workspaceId: string; worldName: string }) => void
  handleStateChange: (event: { workspaceId: string; worldName: string; state: string }) => void
  handleActiveChanged: (event: { workspaceId: string; worldName: string }) => void
}
```

### 2.5 协议扩展

#### 2.5.1 Handshake v2 扩展

```json
{
  "jsonrpc": "2.0",
  "method": "handshake",
  "params": {
    "instance_id": "d4e5f6a7-...",
    "auth_token": "mct_a1b2c3d4...",
    "version": {
      "protocol": "1.0.0",
      "edition": "java"
    },
    "mod_name": "alice-mod",
    "world_name": "New World",         // 新增: 当前世界名称
    "world_online": true,              // 新增: 当前世界是否在线
    "edition": "java",                 // 新增: 游戏版本
    "game_version": "1.21.4"           // 新增: 游戏版本号
  }
}
```

#### 2.5.2 world_online 通知

```json
{
  "jsonrpc": "2.0",
  "method": "world_online",
  "params": {
    "instance_id": "d4e5f6a7-...",
    "world_name": "Another World",
    "bot_count": 0
  }
}
```

#### 2.5.3 world_offline 通知

```json
{
  "jsonrpc": "2.0",
  "method": "world_offline",
  "params": {
    "instance_id": "d4e5f6a7-...",
    "world_name": "New World",
    "uptime_seconds": 5400,
    "bot_count": 3,
    "reason": "world_switch"
  }
}
```

### 2.6 事件流时序

#### 2.6.1 世界切换流程（单工作区）

```
Adapter Core                     TcpServer           WorldSessionManager        Renderer
────────────                     ──────────           ──────────────────        ────────
handshake {instance_id_A,       → handleRequest
  world_name: "New World",        → 解析 world_name
  world_online: true}             → 标记 connection.worldName
                                  → emit ConnectionEvent.Connected
                                                                  ↓
                                  setWorldOnline(wsId, "New World")
                                  → create/restore WorldSession
                                  → emit "world:online"               → IPC → worldStore
                                  → setActiveWorld(wsId, "New World")   → 世界列表更新
                                  → emit "world:active-changed"         → 标题栏更新
```

#### 2.6.2 服务器内切存档

```
Adapter Core                        TcpServer            WorldSessionManager        Renderer
────────────                        ──────────            ──────────────────        ────────
world_offline {instance_id_A,      → handleNotification
  world_name: "New World",          → emit WorldOffline
  reason: "world_switch"}                                 → setWorldOffline(wsId, "New World")
                                                            → emit "world:offline"    → IPC → worldStore
                                                                                       → 世界标记为离线

world_online {instance_id_A,       → handleNotification
  world_name: "Another World",      → emit WorldOnline
  bot_count: 0}                                         → setWorldOnline(wsId, "Another World")
                                                          → registerWorld if new
                                                          → setActiveWorld(wsId, "Another World")
                                                          → emit "world:online"      → IPC → worldStore
                                                          → emit "world:active-changed" → 标题栏切换
```

#### 2.6.3 前端切换世界

```
用户点击 WorldDropdown 中的世界条目
    │
    ▼
worldStore.setActiveWorld(workspaceId, worldName)
    │
    ├── 调用 IPC: world:set-active
    │   │
    │   ├── WorldSessionManager.setActiveWorld(wsId, worldName)
    │   │   ├── 更新 activeWorld 指针
    │   │   ├── emit "world:active-changed"
    │   │   │   └── 通知 LLM 引擎: 世界上下文已切换
    │   │   └── 返回 { success: true }
    │   │
    │   └── 返回前端
    │
    ├── worldStore 更新 currentWorldId
    ├── 标题栏更新世界名称
    ├── 触发对话面板切换对话历史
    └── 触发状态面板切换状态数据
```

### 2.7 数据隔离

#### 2.7.1 存储路径

```
Agent Core Storage
└── instances/
    └── <instance_id>/
        ├── meta.json                          ← 所有世界的索引
        │                                       { worlds: ["New World", "Another World"] }
        │
        ├── world_New World/
        │   ├── tool_call_history.jsonl         ← 该世界的工具调用历史
        │   ├── bot_config.json                 ← 该世界的假人配置
        │   ├── task_queue.json                 ← 该世界的任务队列
        │   └── status_history/                 ← 该世界的状态上报历史
        │
        └── world_Another World/
            ├── tool_call_history.jsonl
            ├── bot_config.json
            ├── task_queue.json
            └── status_history/
```

#### 2.7.2 SQLite 表扩展

在 `workspace_meta` 表的基础上，新增 `world_meta` 表：

```sql
CREATE TABLE IF NOT EXISTS world_meta (
  id TEXT PRIMARY KEY,              -- instanceId + ":" + worldName 复合键
  workspace_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  world_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'offline',
  edition TEXT,
  game_version TEXT,
  connected_at INTEGER,
  last_online_at INTEGER,
  bot_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace_meta(id)
);

CREATE UNIQUE INDEX idx_world_meta_workspace_world
  ON world_meta(workspace_id, world_name);
```

### 2.8 与已有模块的集成

| 已有模块 | 集成方式 |
|----------|----------|
| WorkspaceManager | 扩展：获取工作区下的世界列表、世界数量查询 |
| WorkspaceStore | 扩展：新增 `world_meta` 表持久化 |
| TcpConnection | 扩展：新增 `worldName`/`worldOnline` 字段 + `world_online`/`world_offline` 通知处理 |
| TcpServer | 扩展：转发 WorldOnline/WorldOffline 事件 |
| HandshakeHandler | 扩展：v2 handshake 解析 `world_name`/`world_online`/`edition`/`game_version` |
| CustomTitleBar | 扩展：在 WorkspaceDropdown 右侧嵌入 WorldDropdown |
| ChatPanel | 世界切换时触发对话历史切换 |
| 状态面板 | 世界切换时更新状态数据 |
| LLM Context 构建 | 世界切换时更新系统提示中的世界信息 |

---

## 第三部分：执行文档

### 3.1 新增文件清单

#### 主进程

| 文件路径 | 用途 |
|----------|------|
| `src/main/workspace/world-session.ts` | WorldSession 数据类 |
| `src/main/workspace/world-session-manager.ts` | WorldSessionManager 管理器 |
| `src/main/ipc/world-handler.ts` | 世界上下文 IPC Handler |

#### 渲染进程

| 文件路径 | 用途 |
|----------|------|
| `src/renderer/src/components/workspace/WorldDropdown.tsx` | 标题栏世界切换下拉菜单 |
| `src/renderer/src/stores/worldStore.ts` | 世界上下文状态管理 |

### 3.2 修改文件清单

| 文件路径 | 修改内容 |
|----------|----------|
| `src/main/tcp/connection.ts` | 新增 `worldName`/`worldOnline` 字段；新增 `WorldOnline`/`WorldOffline` 事件 |
| `src/main/tcp/tcp-server.ts` | 转发 `WorldOnline`/`WorldOffline` 事件 |
| `src/main/tcp/handshake.ts` | 扩展 `HandshakeParams` 接口（v2）；新增 `world_name`/`world_online`/`edition`/`game_version` 可选字段 |
| `src/main/workspace/workspace-manager.ts` | 新增 `getWorldCount()`/`hasMultipleWorlds()` 方法 |
| `src/main/workspace/workspace-store.ts` | 新增 `world_meta` 表的 CRUD 操作 |
| `src/renderer/src/components/layout/CustomTitleBar.tsx` | 右侧嵌入 `WorldDropdown` 组件 |
| `src/renderer/src/lib/ipc.ts` | 添加 `worldApi`（3 个 IPC 方法） |
| `src/renderer/src/lib/types.ts` | 添加 `WorldItem` 类型 |
| `src/renderer/src/App.tsx` | 注册 `world:online`/`world:offline` 等 IPC 事件监听 |

### 3.3 详细实现

#### 3.3.1 WorldSession 类

```typescript
// src/main/workspace/world-session.ts

import crypto from 'node:crypto'

export enum WorldSessionState {
  Offline = 'offline',
  Connecting = 'connecting',
  Online = 'online',
}

export interface WorldSessionData {
  id: string
  instanceId: string
  worldName: string
  state: WorldSessionState
  edition: string
  gameVersion: string
  connectedAt: number | null
  lastOnlineAt: number | null
  uptimeSeconds: number
  botCount: number
  createdAt: number
  updatedAt: number
}

export class WorldSession {
  readonly id: string                      // instanceId + ":" + worldName
  readonly instanceId: string
  readonly worldName: string
  readonly createdAt: number

  state: WorldSessionState = WorldSessionState.Offline
  edition: string
  gameVersion: string
  connectedAt: number | null = null
  lastOnlineAt: number | null = null
  uptimeSeconds = 0
  botCount = 0
  updatedAt: number

  /** 会话隔离数据 */
  readonly session: {
    conversationHistory: unknown[]
    memoryContext: Record<string, unknown>
  } = {
    conversationHistory: [],
    memoryContext: {},
  }

  constructor(params: {
    instanceId: string
    worldName: string
    edition: string
    gameVersion: string
  }) {
    this.id = `${params.instanceId}:${params.worldName}`
    this.instanceId = params.instanceId
    this.worldName = params.worldName
    this.edition = params.edition
    this.gameVersion = params.gameVersion
    this.createdAt = Date.now()
    this.updatedAt = Date.now()
  }

  get isOnline(): boolean {
    return this.state === WorldSessionState.Online
  }

  goOnline(): void {
    this.state = WorldSessionState.Online
    this.connectedAt = Date.now()
    this.updatedAt = Date.now()
  }

  goOffline(): void {
    this.state = WorldSessionState.Offline
    this.lastOnlineAt = Date.now()
    this.uptimeSeconds = this.connectedAt
      ? Math.floor((Date.now() - this.connectedAt) / 1000)
      : 0
    this.updatedAt = Date.now()
  }

  toJSON(): WorldSessionData {
    return {
      id: this.id,
      instanceId: this.instanceId,
      worldName: this.worldName,
      state: this.state,
      edition: this.edition,
      gameVersion: this.gameVersion,
      connectedAt: this.connectedAt,
      lastOnlineAt: this.lastOnlineAt,
      uptimeSeconds: this.uptimeSeconds,
      botCount: this.botCount,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    }
  }
}
```

#### 3.3.2 WorldSessionManager

```typescript
// src/main/workspace/world-session-manager.ts

import { EventEmitter } from 'node:events'
import { WorldSession, WorldSessionState } from './world-session'
import { WorldStore } from './world-store'

export enum WorldSessionEvent {
  Registered = 'world:registered',
  Online = 'world:online',
  Offline = 'world:offline',
  StateChanged = 'world:state-changed',
  ActiveChanged = 'world:active-changed',
}

export interface WorldSessionEventData {
  type: WorldSessionEvent
  workspaceId: string
  instanceId: string
  worldName: string
  timestamp: number
  metadata?: Record<string, unknown>
}

export class WorldSessionManager extends EventEmitter {
  /** workspaceId → Map<worldName, WorldSession> */
  private readonly worldIndex: Map<string, Map<string, WorldSession>> = new Map()

  /** 当前活跃世界: { workspaceId, worldName } */
  private activeWorld: { workspaceId: string; worldName: string } | null = null

  private readonly store: WorldStore

  constructor(enablePersistence: boolean = true) {
    super()
    this.store = enablePersistence ? new WorldStore() : (null as any)
  }

  // ── 注册 ──

  registerWorld(workspaceId: string, params: {
    instanceId: string
    worldName: string
    edition: string
    gameVersion: string
  }): WorldSession {
    let worlds = this.worldIndex.get(workspaceId)
    if (!worlds) {
      worlds = new Map()
      this.worldIndex.set(workspaceId, worlds)
    }

    let session = worlds.get(params.worldName)
    if (session) {
      // 恢复已有会话
      session.edition = params.edition
      session.gameVersion = params.gameVersion
    } else {
      // 创建新会话
      session = new WorldSession({
        instanceId: params.instanceId,
        worldName: params.worldName,
        edition: params.edition,
        gameVersion: params.gameVersion,
      })
      worlds.set(params.worldName, session)
    }

    this.emitEvent(WorldSessionEvent.Registered, workspaceId, params.instanceId, params.worldName)
    return session
  }

  // ── 状态管理 ──

  setWorldOnline(workspaceId: string, worldName: string): WorldSession | undefined {
    const session = this.getWorld(workspaceId, worldName)
    if (!session) return undefined

    const oldState = session.state
    session.goOnline()
    this.store?.save(session.toJSON())

    this.emitEvent(WorldSessionEvent.Online, workspaceId, session.instanceId, worldName)
    if (oldState !== WorldSessionState.Online) {
      this.emitEvent(WorldSessionEvent.StateChanged, workspaceId, session.instanceId, worldName, {
        oldState,
        newState: WorldSessionState.Online,
      })
    }

    // 自动设为活跃世界
    this.setActiveWorld(workspaceId, worldName)

    return session
  }

  setWorldOffline(workspaceId: string, worldName: string, reason?: string): WorldSession | undefined {
    const session = this.getWorld(workspaceId, worldName)
    if (!session) return undefined

    const oldState = session.state
    session.goOffline()
    this.store?.save(session.toJSON())

    this.emitEvent(WorldSessionEvent.Offline, workspaceId, session.instanceId, worldName, { reason })
    if (oldState !== WorldSessionState.Offline) {
      this.emitEvent(WorldSessionEvent.StateChanged, workspaceId, session.instanceId, worldName, {
        oldState,
        newState: WorldSessionState.Offline,
        reason,
      })
    }

    // 如果当前活跃世界下线，清空活跃标记
    if (this.activeWorld?.workspaceId === workspaceId && this.activeWorld?.worldName === worldName) {
      this.activeWorld = null
    }

    return session
  }

  setActiveWorld(workspaceId: string, worldName: string): WorldSession | undefined {
    const session = this.getWorld(workspaceId, worldName)
    if (!session) return undefined

    this.activeWorld = { workspaceId, worldName }
    this.emitEvent(WorldSessionEvent.ActiveChanged, workspaceId, session.instanceId, worldName)
    return session
  }

  // ── 查询 ──

  getActiveWorld(): { workspaceId: string; worldName: string } | null {
    return this.activeWorld
  }

  getActiveWorldSession(): WorldSession | null {
    if (!this.activeWorld) return null
    return this.getWorld(this.activeWorld.workspaceId, this.activeWorld.worldName) ?? null
  }

  getWorldsByWorkspace(workspaceId: string): WorldSession[] {
    const worlds = this.worldIndex.get(workspaceId)
    if (!worlds) return []
    return Array.from(worlds.values())
  }

  getWorld(workspaceId: string, worldName: string): WorldSession | undefined {
    return this.worldIndex.get(workspaceId)?.get(worldName)
  }

  getWorldCount(workspaceId: string): number {
    return this.worldIndex.get(workspaceId)?.size ?? 0
  }

  hasMultipleWorlds(workspaceId: string): boolean {
    return this.getWorldCount(workspaceId) > 1
  }

  removeWorkspaceWorlds(workspaceId: string): void {
    const worlds = this.worldIndex.get(workspaceId)
    if (worlds) {
      for (const [name, session] of worlds) {
        this.store?.delete(session.id)
      }
      this.worldIndex.delete(workspaceId)
    }

    if (this.activeWorld?.workspaceId === workspaceId) {
      this.activeWorld = null
    }
  }

  // ── 持久化 ──

  loadPersistedWorlds(workspaceId: string): void {
    const persisted = this.store?.getByWorkspace(workspaceId) ?? []
    for (const data of persisted) {
      const session = new WorldSession({
        instanceId: data.instanceId,
        worldName: data.worldName,
        edition: data.edition,
        gameVersion: data.gameVersion,
      })
      session.state = WorldSessionState.Offline
      session.lastOnlineAt = data.lastOnlineAt
      session.uptimeSeconds = data.uptimeSeconds
      session.botCount = data.botCount

      let worlds = this.worldIndex.get(workspaceId)
      if (!worlds) {
        worlds = new Map()
        this.worldIndex.set(workspaceId, worlds)
      }
      worlds.set(data.worldName, session)
    }
  }

  // ── 内部 ──

  private emitEvent(
    type: WorldSessionEvent,
    workspaceId: string,
    instanceId: string,
    worldName: string,
    metadata?: Record<string, unknown>,
  ): void {
    const event: WorldSessionEventData = {
      type,
      workspaceId,
      instanceId,
      worldName,
      timestamp: Date.now(),
      metadata,
    }
    this.emit(type, event)
    this.emit('world:event', event)
  }
}

// ════════════════════════════════════════════════════════════════
// 全局单例
// ════════════════════════════════════════════════════════════════

let sessionManagerInstance: WorldSessionManager | null = null

export function getWorldSessionManager(): WorldSessionManager {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new WorldSessionManager()
  }
  return sessionManagerInstance
}

export function setWorldSessionManager(manager: WorldSessionManager): void {
  sessionManagerInstance = manager
}

export function resetWorldSessionManager(): void {
  sessionManagerInstance = null
}
```

#### 3.3.3 WorldStore（持久化）

```typescript
// src/main/workspace/world-store.ts

import type Database from 'better-sqlite3'
import { getDatabaseManager } from '../database'
import type { WorldSessionData } from './world-session'

interface WorldMetaRow {
  id: string
  workspace_id: string
  instance_id: string
  world_name: string
  state: string
  edition: string | null
  game_version: string | null
  connected_at: number | null
  last_online_at: number | null
  bot_count: number
  created_at: number
  updated_at: number
}

export class WorldStore {
  private get db(): Database.Database {
    return getDatabaseManager().getDb()
  }

  save(session: WorldSessionData): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO world_meta
        (id, workspace_id, instance_id, world_name, state, edition, game_version,
         connected_at, last_online_at, bot_count, created_at, updated_at)
      VALUES
        (@id, @workspace_id, @instance_id, @world_name, @state, @edition, @game_version,
         @connected_at, @last_online_at, @bot_count, @created_at, @updated_at)
    `).run({
      id: session.id,
      workspace_id: '',  // 需要外部传入 workspaceId
      instance_id: session.instanceId,
      world_name: session.worldName,
      state: session.state,
      edition: session.edition,
      game_version: session.gameVersion,
      connected_at: session.connectedAt,
      last_online_at: session.lastOnlineAt,
      bot_count: session.botCount,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
    })
  }

  getByWorkspace(workspaceId: string): WorldSessionData[] {
    const rows = this.db.prepare<unknown[], WorldMetaRow>(
      'SELECT * FROM world_meta WHERE workspace_id = ? ORDER BY updated_at DESC',
    ).all(workspaceId)
    return rows.map(rowToSessionData)
  }

  getById(id: string): WorldSessionData | null {
    const row = this.db.prepare<unknown[], WorldMetaRow | undefined>(
      'SELECT * FROM world_meta WHERE id = ?',
    ).get(id) as WorldMetaRow | undefined
    return row ? rowToSessionData(row) : null
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM world_meta WHERE id = ?').run(id)
  }
}
```

#### 3.3.4 WorldDropdown 组件

```tsx
// src/renderer/src/components/workspace/WorldDropdown.tsx

import React from 'react'
import { Dropdown, Separator, Header } from '@heroui/react'
import { ChevronDown } from 'lucide-react'
import { useWorldStore } from '../../stores/worldStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'

const WorldDropdown: React.FC = () => {
  const {
    worlds,
    currentWorldId,
    setActiveWorld,
  } = useWorldStore()

  const { currentWorkspaceId } = useWorkspaceStore()

  // 只在当前工作区支持多世界时显示
  const currentWorkspace = useWorkspaceStore(s =>
    s.workspaces.find(w => w.id === currentWorkspaceId)
  )

  // 如果没有工作区或者不支持多世界，不渲染
  if (!currentWorkspaceId || worlds.length <= 1) {
    return null
  }

  const currentWorld = worlds.find(w => w.id === currentWorldId)
  const statusDotClass = (state: string) => {
    switch (state) {
      case 'online': return 'bg-green-400'
      case 'connecting': return 'bg-yellow-400'
      default: return 'bg-gray-400'
    }
  }

  return (
    <Dropdown>
      <Dropdown.Trigger>
        <div
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-200/60 cursor-pointer transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <span className={`w-2 h-2 rounded-full ${statusDotClass(currentWorld?.state ?? 'offline')}`} />
          <span>{currentWorld?.worldName || '未选择世界'}</span>
          <ChevronDown size={12} className="text-gray-400" />
        </div>
      </Dropdown.Trigger>

      <Dropdown.Popover className="min-w-[220px]">
        <Dropdown.Menu
          onAction={(key) => {
            const ks = key as string
            const world = worlds.find(w => w.id === ks)
            if (world) {
              setActiveWorld(currentWorkspaceId, world.worldName)
            }
          }}
        >
          <Header>世界 · {currentWorkspace?.name}</Header>
          <Separator />

          <Dropdown.Section>
            {worlds.map(world => (
              <Dropdown.Item
                key={world.id}
                id={world.id}
                textValue={world.worldName}
              >
                <div className="flex items-center gap-2 w-full">
                  <span className={`w-2 h-2 rounded-full ${statusDotClass(world.state)} flex-shrink-0`} />
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-xs font-medium text-gray-700 truncate">
                      {world.worldName}
                    </span>
                    <span className="text-[10px] text-gray-400 truncate leading-tight">
                      {world.edition === 'java' ? 'JE' : 'BE'} {world.gameVersion}
                    </span>
                  </div>
                  {world.botCount > 0 && (
                    <span className="text-[10px] text-gray-400 flex-shrink-0">
                      {world.botCount} 假人
                    </span>
                  )}
                </div>
              </Dropdown.Item>
            ))}
          </Dropdown.Section>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

export default WorldDropdown
```

#### 3.3.5 worldStore（Zustand）

```typescript
// src/renderer/src/stores/worldStore.ts

import { create } from 'zustand'
import type { WorldItem } from '../lib/types'
import { worldApi } from '../lib/ipc'

interface WorldState {
  worlds: WorldItem[]
  currentWorldId: string | null
  loading: boolean

  refreshWorlds: (workspaceId: string) => Promise<void>
  setActiveWorld: (workspaceId: string, worldName: string) => Promise<void>

  handleWorldOnline: (event: { workspaceId: string; worldName: string; instanceId: string }) => void
  handleWorldOffline: (event: { workspaceId: string; worldName: string }) => void
  handleStateChange: (event: { workspaceId: string; worldName: string; state: string }) => void
  handleActiveChanged: (event: { workspaceId: string; worldName: string }) => void
}

export const useWorldStore = create<WorldState>((set, get) => ({
  worlds: [],
  currentWorldId: null,
  loading: false,

  refreshWorlds: async (workspaceId: string) => {
    set({ loading: true })
    try {
      const list = await worldApi.list(workspaceId)
      const currentId = get().currentWorldId
      const stillExists = currentId ? list.some(w => w.id === currentId) : false
      set({
        worlds: list,
        currentWorldId: stillExists ? currentId : (list[0]?.id ?? null),
        loading: false,
      })
    } catch {
      set({ loading: false })
    }
  },

  setActiveWorld: async (workspaceId: string, worldName: string) => {
    try {
      await worldApi.setActive(workspaceId, worldName)
      const worldId = `${workspaceId}:${worldName}`
      set({ currentWorldId: worldId })
      window.dispatchEvent(new CustomEvent('world:changed', {
        detail: { workspaceId, worldName },
      }))
    } catch (err) {
      console.error('Failed to set active world:', err)
    }
  },

  handleWorldOnline: (event) => {
    set(state => {
      const worldId = `${event.workspaceId}:${event.worldName}`
      const exists = state.worlds.some(w => w.id === worldId)
      if (exists) {
        return {
          worlds: state.worlds.map(w =>
            w.id === worldId ? { ...w, state: 'online' as const } : w
          ),
        }
      }
      // 新增世界
      return {
        worlds: [...state.worlds, {
          id: worldId,
          instanceId: event.instanceId,
          worldName: event.worldName,
          state: 'online' as const,
          edition: 'java' as const,
          gameVersion: '',
          botCount: 0,
          uptimeSeconds: 0,
        }],
        currentWorldId: state.currentWorldId ?? worldId,
      }
    })
  },

  handleWorldOffline: (event) => {
    set(state => ({
      worlds: state.worlds.map(w =>
        w.id === `${event.workspaceId}:${event.worldName}`
          ? { ...w, state: 'offline' as const }
          : w
      ),
    }))
  },

  handleStateChange: (event) => {
    set(state => ({
      worlds: state.worlds.map(w =>
        w.id === `${event.workspaceId}:${event.worldName}`
          ? { ...w, state: event.state as WorldItem['state'] }
          : w
      ),
    }))
  },

  handleActiveChanged: (event) => {
    const worldId = `${event.workspaceId}:${event.worldName}`
    set({ currentWorldId: worldId })
  },
}))
```

#### 3.3.6 CustomTitleBar 扩展

```tsx
// src/renderer/src/components/layout/CustomTitleBar.tsx（修改）
// 在 WorkspaceDropdown 右侧添加 WorldDropdown

import React from 'react'
import WorkspaceDropdown from '../workspace/WorkspaceDropdown'
import WorldDropdown from '../workspace/WorldDropdown'    // 新增

// ...

<div className="flex items-center gap-2">
  <span className="text-sm font-semibold text-gray-700 ml-1 tracking-wide">Alice</span>
  <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
    <WorkspaceDropdown />
  </div>
  <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
    <WorldDropdown />           {/* 新增: 世界切换 */}
  </div>
</div>
```

#### 3.3.7 IPC 封装

```typescript
// src/renderer/src/lib/ipc.ts（新增）

export const worldApi = {
  list: (workspaceId: string) =>
    window.electronAPI.invoke('world:list', { workspaceId }) as Promise<WorldItem[]>,

  setActive: (workspaceId: string, worldName: string) =>
    window.electronAPI.invoke('world:set-active', { workspaceId, worldName }) as Promise<{ success: boolean }>,

  getActive: (workspaceId: string) =>
    window.electronAPI.invoke('world:get-active', { workspaceId }) as Promise<WorldItem | null>,
}
```

#### 3.3.8 类型定义

```typescript
// src/renderer/src/lib/types.ts（新增）

/** 世界列表项（UI 展示用） */
export interface WorldItem {
  id: string                    // 复合键: workspaceId:worldName
  instanceId: string
  worldName: string
  state: 'online' | 'offline' | 'connecting'
  edition: 'bedrock' | 'java'
  gameVersion: string
  botCount: number
  uptimeSeconds: number
  lastOnlineAt?: number
}
```

#### 3.3.9 TCP 握手扩展

```typescript
// src/main/tcp/handshake.ts（扩展）
// HandshakeParams 接口新增字段

export interface HandshakeParams {
  instance_id: string
  auth_token: string
  version: {
    protocol: string
    edition: 'bedrock' | 'java'
  }
  mod?: string
  // ---- v2 新增字段 ----
  world_name?: string          // 当前世界名称
  world_online?: boolean       // 当前世界是否在线
  edition?: string             // 游戏版本
  game_version?: string        // 游戏版本号
}
```

#### 3.3.10 TcpConnection 扩展

```typescript
// src/main/tcp/connection.ts（扩展）
// 新增字段和事件

export enum ConnectionEvent {
  // ... 已有事件 ...
  WorldOnline = 'world:online',       // 新增
  WorldOffline = 'world:offline',     // 新增
}

// 在 TcpConnection 类中新增字段
export class TcpConnection extends EventEmitter {
  // ... 已有字段 ...
  public worldName: string | null = null    // 新增
  public worldOnline: boolean = true        // 新增

  // 在 handleNotification 中扩展
  private handleNotification(notification: JsonRpcNotification): void {
    // ... 已有逻辑 ...

    if (notification.method === 'world_online') {
      const params = notification.params as Record<string, unknown> | undefined
      if (params) {
        this.emit(ConnectionEvent.WorldOnline, {
          instanceId: this.instanceId,
          worldName: params.world_name,
          botCount: params.bot_count ?? 0,
        })
      }
      return
    }

    if (notification.method === 'world_offline') {
      const params = notification.params as Record<string, unknown> | undefined
      if (params) {
        this.emit(ConnectionEvent.WorldOffline, {
          instanceId: this.instanceId,
          worldName: params.world_name,
          uptimeSeconds: params.uptime_seconds ?? 0,
          botCount: params.bot_count ?? 0,
          reason: params.reason,
        })
      }
      return
    }
  }
}
```

### 3.4 事件监听初始化

在 `App.tsx` 中注册世界上下文事件监听：

```typescript
// src/renderer/src/App.tsx（扩展）
useEffect(() => {
  // ... 已有监听 ...

  // 监听世界上下文事件
  const unsubscribeWorldOnline = window.electronAPI.on('world:online', (event) => {
    handleWorldOnline(event as { workspaceId: string; worldName: string; instanceId: string })
  })

  const unsubscribeWorldOffline = window.electronAPI.on('world:offline', (event) => {
    handleWorldOffline(event as { workspaceId: string; worldName: string })
  })

  const unsubscribeWorldState = window.electronAPI.on('world:state-changed', (event) => {
    handleWorldStateChange(event as { workspaceId: string; worldName: string; state: string })
  })

  const unsubscribeWorldActive = window.electronAPI.on('world:active-changed', (event) => {
    handleWorldActiveChanged(event as { workspaceId: string; worldName: string })
  })

  return () => {
    // ... 已有清理 ...
    unsubscribeWorldOnline()
    unsubscribeWorldOffline()
    unsubscribeWorldState()
    unsubscribeWorldActive()
  }
}, [])
```

### 3.5 边界情况处理

| 场景 | 处理方式 |
|------|----------|
| 工作区不支持世界上下文 | WorldDropdown 不渲染，隐藏 |
| 工作区只有单个世界 | WorldDropdown 不渲染（无需切换） |
| 世界列表为空 | 显示"未选择世界" |
| 当前活跃世界下线 | 标题栏状态圆点变为灰色，自动切换到下一个在线世界（如有） |
| 所有世界下线 | 标题栏显示"未选择世界"，LLM 暂停工具调用 |
| 世界上线但无对应会话 | 自动创建新 WorldSession |
| 世界重新上线（相同 world_name） | 恢复之前的 WorldSession 上下文 |
| 工作区被删除 | 同时清理该工作区下的所有 WorldSession |
| TCP 连接断开 | 所有世界标记为离线，保留离线状态供恢复 |
| 快速切世界（< 1 秒） | sequential 处理，前一个 world_offline 处理完才处理下一个 world_online |

### 3.6 前置条件与依赖

| 依赖项 | 说明 | 状态 |
|--------|------|:----:|
| HeroUI v3 Dropdown | 下拉菜单组件 | ✅ 已有 |
| lucide-react | SVG 图标库（ChevronDown） | ✅ 已安装 |
| Zustand | 状态管理 | ✅ 已有 |
| Electron IPC | 进程通信 | ✅ 已有 |
| WorldSessionManager | 新增 | 待实现 |
| WorldStore | 新增（world_meta 表） | 待实现 |

### 3.7 开发顺序

| 阶段 | 内容 | 产出 |
|:----:|------|------|
| 1 | 后端数据模型 + WorldSession | `world-session.ts`, `world-session-manager.ts`, `world-store.ts` |
| 2 | TCP 协议扩展 | `handshake.ts` 扩展, `connection.ts` 扩展, `tcp-server.ts` 扩展 |
| 3 | IPC Handler | `world-handler.ts`（3 个 channel + 4 个事件推送） |
| 4 | 前端类型 + IPC 封装 | `types.ts` 扩展, `ipc.ts` 扩展 |
| 5 | worldStore | `worldStore.ts` 状态管理 |
| 6 | WorldDropdown 组件 | `WorldDropdown.tsx` 下拉菜单 |
| 7 | CustomTitleBar 集成 | 右侧嵌入 WorldDropdown |
| 8 | 事件监听 + App.tsx 集成 | 事件注册 + 工作区切换联动 |
| 9 | 对话/状态面板联动 | 世界切换时更新对话历史和状态数据 |

### 3.8 验收标准

| # | 验收条件 | 验证方法 |
|---|----------|----------|
| 1 | 世界切换入口显示 | 工作区连接后，标题栏 WorkspaceDropdown 右侧显示世界切换按钮 |
| 2 | 单世界不显示 | 工作区只有一个世界时，世界切换按钮隐藏 |
| 3 | 世界列表展示 | 展开世界 Dropdown，显示所有世界及状态 |
| 4 | 世界切换 | 点击世界条目，标题栏更新为新的世界名称 |
| 5 | 状态实时同步 | 世界上线/下线，列表中的状态圆点即时更新 |
| 6 | 世界下线自动切换 | 当前活跃世界下线后，自动切换到下一个在线世界 |
| 7 | 会话隔离 | 不同世界的对话历史/工具调用记录互不干扰 |
| 8 | 工作区删除联动 | 删除工作区后，对应的世界列表清空 |
| 9 | 持久化恢复 | 重启后，`world_meta` 表中的世界数据恢复为离线状态 |
| 10 | 标题栏拖拽不冲突 | 点击世界切换按钮不触发窗口拖拽 |

---

## 第四部分：附录

### 4.1 新增/修改文件清单

#### 新增文件

| 文件路径 | 用途 |
|----------|------|
| `src/main/workspace/world-session.ts` | 世界上下文数据类 |
| `src/main/workspace/world-session-manager.ts` | 世界上下文管理器 |
| `src/main/workspace/world-store.ts` | 世界上下文持久化存储 |
| `src/main/ipc/world-handler.ts` | 世界上下文 IPC Handler |
| `src/renderer/src/components/workspace/WorldDropdown.tsx` | 标题栏世界切换下拉菜单 |
| `src/renderer/src/stores/worldStore.ts` | 世界上下文状态管理 |

#### 修改文件

| 文件路径 | 修改内容 |
|----------|----------|
| `src/main/tcp/connection.ts` | 新增 `worldName`/`worldOnline` 字段；新增 `WorldOnline`/`WorldOffline` 事件处理 |
| `src/main/tcp/tcp-server.ts` | 转发 `WorldOnline`/`WorldOffline` 事件 |
| `src/main/tcp/handshake.ts` | 扩展 `HandshakeParams` 接口（v2） |
| `src/main/workspace/workspace-manager.ts` | 新增 `getWorldCount()`/`hasMultipleWorlds()` 方法 |
| `src/main/workspace/workspace-store.ts` | 新增 `world_meta` 表创建 |
| `src/renderer/src/components/layout/CustomTitleBar.tsx` | 右侧嵌入 WorldDropdown 组件 |
| `src/renderer/src/lib/ipc.ts` | 添加 `worldApi`（3 个方法） |
| `src/renderer/src/lib/types.ts` | 添加 `WorldItem` 类型 |
| `src/renderer/src/App.tsx` | 注册世界上下文 IPC 事件监听 |

### 4.2 数据库迁移

```sql
-- 创建 world_meta 表
CREATE TABLE IF NOT EXISTS world_meta (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  world_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'offline',
  edition TEXT,
  game_version TEXT,
  connected_at INTEGER,
  last_online_at INTEGER,
  bot_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace_meta(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_world_meta_workspace_world
  ON world_meta(workspace_id, world_name);
```

### 4.3 与 JE-10 文档的对应关系

| JE-10 §9 章节 | 本文档对应章节 | 说明 |
|--------------|---------------|------|
| §9.1 概念变化 | §1.2, §2.1 | 从"Mod 会话"到"World 会话" |
| §9.2 协议变更 | §2.5 | Handshake v2 + world_online/offline 通知 |
| §9.3 AC 侧的会话映射 | §2.3.1, §2.2 | WorldSessionManager + 双层映射 |
| §9.4 世界切换时的 AC 行为 | §2.6 | 时序图 |
| §9.5 数据隔离要求 | §2.7 | 存储路径 + SQLite 表 |
| §9.6 对外 API 变更 | §2.3.5 | IPC Handler |
| §9.7 多连接场景 | §1.3 | 启用条件判定 |