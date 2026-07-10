# Alice Mod Core V10 — QQ 机器人模块

> 版本：v1.0
> 日期：2026-07-10
> 版本号：V10（第 12 周）
> 对应需求：AC-QQ-01 ~ AC-QQ-06
> 关联文档：[AC-01-需求文档.md](AC-01-需求文档.md)、[AC-02-实施计划.md](AC-02-实施计划.md)、[AC-V9-工具调用面板与日志系统.md](AC-V9-工具调用面板与日志系统.md)、[12-QQ外部连接工具设计.md](../../tools/12-QQ外部连接工具设计.md)、[04-QQ机器人配置指南.md](../../deploy/04-QQ机器人配置指南.md)、[AC-V10-NapCatQQ集成分析.md](../../analysis/AC-V10-NapCatQQ集成分析.md)

---

## 第一部分：需求文档

### 1.1 模块定位

QQ 机器人模块是 McAgent Agent Core 的 **远程交互入口**，允许用户通过 QQ 群聊或私聊与 Minecraft 智能体进行交互。它是系统中**唯一的外部通信渠道**（V14 事件触发器将在此基础上扩展），承担三个核心角色：

| 角色 | 说明 |
|------|------|
| **远程控制** | 通过 QQ 消息向智能体下发指令，移动、挖掘、建造、战斗等，无需直接操作游戏 |
| **状态查询** | 实时查询智能体状态：位置、血量、饥饿度、背包、任务进度等 |
| **消息桥接** | QQ 群聊 ↔ 游戏内聊天双向同步，连接 QQ 用户与游戏玩家 |

### 1.2 与已有模块的关系

V10 引入 **双 Agent 架构**：QQ 消息由独立的 **QQ Sub-Agent** 处理，它与主 Agent（游戏 Agent）通过内部消息通道通信。两者拥有独立的 LLM 会话上下文和 AgentProfile，职责分离。

```
                          ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
                          │          Agent Core 内部                    │
                          │                                             │
                          │  ┌─────────────────────────────────────┐  │
                          │  │          主 Agent (游戏 Agent)        │  │
                          │  │  · 游戏交互 (移动/挖掘/战斗/建造)     │  │
                          │  │  · 游戏内聊天处理                     │  │
                          │  │  · 游戏内回复 → 聊天桥接              │  │
                          │  └──────────┬──────────────────────────┘  │
                          │             │ 内部消息通道                  │
                          │  ┌──────────▼──────────────────────────┐  │
                          │  │         QQ Sub-Agent                 │  │
                          │  │  · QQ 对话理解与回复生成             │  │
                          │  │  · 独立 LLM 上下文 / AgentProfile    │  │
                          │  │  · 识别需要游戏操作时 → 请求主 Agent  │  │
                          │  │  · 工具: qq_send / qq_info / request_game_action │
                          │  └─────────────────────────────────────┘  │
                          │                                             │
                          │  ┌──────────────────┐  ┌─────────────┐   │  │
                          │  │  OneBot 客户端     │  │  权限控制    │   │
                          │  │  (正向 WS 连接)    │  │  四级权限    │   │
                          │  └──────┬───────────┘  └──────┬──────┘   │  │
                          │         │ WebSocket           │            │
                          │  ┌──────▼─────────────────────▼────────┐  │
                          │  │       消息桥接层 + 消息队列          │  │
                          │  │    QQ ↔ 游戏桥接 / 指令解析         │  │
                          │  └────────────────────────────────────┘  │
                          └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
                              │
                              ▼
              ┌──────────────────────────────┐
              │         NapCatQQ             │
              │  (Shell 子进程 / 外部进程)     │
              │  OneBot v11 WebSocket         │
              └──────────────────────────────┘
```

**核心变化：**
- **不再**由主 Agent 直接处理 QQ 消息
- QQ Sub-Agent 拥有独立的 LLM 会话、独立的 AgentProfile（身份为"QQ 助手"）
- QQ Sub-Agent 需要游戏操作时，通过 `request_game_action` 工具向主 Agent 发起请求
- 主 Agent 执行完成后返回结果，QQ Sub-Agent 格式化后回复 QQ 用户

### 1.3 功能需求列表

| 需求 ID | 需求名称 | 优先级 | 开发者 | 实现状态 |
|---------|---------|:------:|:------:|:--------:|
| AC-QQ-01 | OneBot WebSocket 协议对接（连接 / 心跳 / 事件接收 / 消息发送） | P0 | B | ✅ |
| AC-QQ-02 | QQ 消息收发（群消息 / 私聊消息） | P0 | B | ✅ |
| AC-QQ-03 | QQ 消息桥接（QQ ↔ 游戏内聊天双向同步） | P1 | B | ✅ |
| AC-QQ-04 | QQ 权限控制（NONE / BASIC / COMMAND / ADMIN 四级） | P1 | B | ✅ |
| AC-QQ-05 | qq_send 工具（group_msg / private_msg / image / file） | P0 | A | ✅ |
| AC-QQ-06 | qq_info 工具（group / members / user 查询） | P0 | A | ✅ |

### 1.4 验收标准

| # | 验收条件 | 验证方法 | 测量指标 |
|---|---------|----------|----------|
| 10.1 | OneBot WebSocket 连接建立 | 启动 NapCat → Agent Core 连接 → 握手成功 | 连接状态变为 `connected` |
| 10.2 | 群消息接收 | 在 QQ 群中发送消息，Agent Core 收到事件 | 消息内容、发送者、群号正确 |
| 10.3 | 私聊消息接收 | 向机器人 QQ 发送私聊消息，Agent Core 收到事件 | 消息内容、发送者正确 |
| 10.4 | 群消息发送 | 调用 send 方法发送群消息 | QQ 群收到消息，内容一致 |
| 10.5 | 私聊消息发送 | 调用 send 方法发送私聊消息 | 用户收到私聊消息，内容一致 |
| 10.6 | 消息桥接 QQ → 游戏 | QQ 群消息被桥接到游戏内聊天 | 游戏内玩家看到 `[QQ] 用户名: 内容` |
| 10.7 | 消息桥接 游戏 → QQ | 游戏内聊天被桥接到 QQ 群 | QQ 群收到 `[游戏] 玩家名: 内容` |
| 10.8 | 权限控制生效 | BASIC 用户尝试执行 ADMIN 指令 | 返回权限不足错误，拒绝执行 |
| 10.9 | 权限等级检查 | 4 个等级分别测试 | 各等级正确匹配对应权限范围 |
| 10.10 | qq_send 群消息 | 调用工具发送群消息 | 群收到消息，返回 `success: true` + `message_id` |
| 10.11 | qq_send 私聊消息 | 调用工具发送私聊消息 | 用户收到消息，返回 `success: true` + `message_id` |
| 10.12 | qq_send 图片/文件 | 调用工具发送图片/文件 | 群收到图片/文件，`success: true` |
| 10.13 | qq_info 查询群信息 | 调用工具查询群信息 | 返回群名称、成员数、群主等 |
| 10.14 | qq_info 查询群成员 | 调用工具查询群成员列表 | 返回成员列表含 user_id、昵称、角色 |
| 10.15 | qq_info 查询用户信息 | 调用工具查询用户信息 | 返回用户昵称等基本信息 |
| 10.16 | 断线自动重连 | NapCat 退出后重启 | 30s 内自动重连，消息不丢失 |
| 10.17 | 粘包/拆包处理 | 连续发送 50 条消息 | 全部正确接收，无消息丢失或错乱 |

---

## 第二部分：架构文档

### 2.1 整体架构

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                              Agent Core                                       │
│                                                                               │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │                         QQ 机器人模块 (A7)                             │   │
│  │                                                                        │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │   │
│  │  │                         QQ Sub-Agent                            │  │   │
│  │  │  (独立 LLM 会话 / 独立 AgentProfile / 独立上下文窗口)              │  │   │
│  │  │                                                                  │  │   │
│  │  │  ┌──────────────────────────────────────────────────────────┐   │  │   │
│  │  │  │  QQ Sub-Agent 核心                                        │   │  │   │
│  │  │  │  · 接收 QQ 消息 → 理解意图 → 生成回复                     │   │  │   │
│  │  │  │  · 需要游戏操作 → 调用 request_game_action 工具           │   │  │   │
│  │  │  │  · 纯 QQ 查询 → 直接调用 qq_send / qq_info 工具           │   │  │   │
│  │  │  │  · 桥接消息 → 直接转发到消息桥接层                         │   │  │   │
│  │  │  │  · 工具: qq_send, qq_info, request_game_action            │   │  │   │
│  │  │  └──────────────────────────────────────────────────────────┘   │  │   │
│  │  │                                                                  │  │   │
│  │  │  ┌──────────────────────────────────────────────────────────┐   │  │   │
│  │  │  │  QQ Sub-Agent Profile                                    │   │  │   │
│  │  │  │  name: "QQ 助手 / QQ 机器人"                              │   │  │   │
│  │  │  │  identity: "你是 McAgent 的 QQ 机器人助手..."               │   │  │   │
│  │  │  │  rules: 礼貌回复 / 不主动执行游戏操作 / 需要时请求主 Agent  │   │  │   │
│  │  │  │  tools: qq_send, qq_info, request_game_action            │   │  │   │
│  │  │  └──────────────────────────────────────────────────────────┘   │  │   │
│  │  └─────────────────────────────────────────────────────────────────┘  │   │
│  │                                                                        │   │
│  │  ┌──────────────────────┐     ┌────────────────────────────────────┐  │   │
│  │  │  OneBot 客户端        │     │  NapCat 托管管理器 (Phase 2)        │  │   │
│  │  │  OneBotClient         │     │  NapCatManager                    │  │   │
│  │  │  · WS 连接管理         │     │  · 自动下载/更新                   │  │   │
│  │  │  · 心跳维护            │     │  · 子进程生命周期管理                │  │   │
│  │  │  · 消息收发            │     │  · 配置自动注入                    │  │   │
│  │  │  · 事件监听            │     │  · 健康监控                        │  │   │
│  │  └────────┬──────────────┘     │  · 日志收集                        │  │   │
│  │           │ WebSocket          └────────────┬─────────────────────┘  │   │
│  │           │                                 │ 子进程管理              │   │
│  │           ▼                                 ▼                         │   │
│  │  ┌────────────────────────────────────────────────────────────────┐  │   │
│  │  │                    消息桥接层 + 消息队列                        │  │   │
│  │  │  MessageBridge / MessageQueue                                  │  │   │
│  │  │                                                                 │  │   │
│  │  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐    │  │   │
│  │  │  │ QQ → 游戏桥接   │  │ 游戏 → QQ 桥接  │  │ 指令解析器      │    │  │   │
│  │  │  │ (桥接消息不走   │  │ (游戏内消息     │  │ (快速指令跳过   │    │  │   │
│  │  │  │ Sub-Agent)     │  │ 直接转发到 QQ)  │  │  Sub-Agent)    │    │  │   │
│  │  │  └────────────────┘  └────────────────┘  └────────────────┘    │  │   │
│  │  │                                                                 │  │   │
│  │  │  ┌────────────────────────────────────────────────────────┐    │  │   │
│  │  │  │  MessageQueue (max 100, TTL 5min)                      │    │  │   │
│  │  │  │  · 消息去重 / 超时清理 / 排序                          │    │  │   │
│  │  │  └────────────────────────────────────────────────────────┘    │  │   │
│  │  └────────────────────────────────────────────────────────────────┘  │   │
│  │                                                                        │   │
│  │  ┌────────────────────────────────────────────────────────────────┐  │   │
│  │  │                    权限控制层                                  │  │   │
│  │  │  PermissionManager                                             │  │   │
│  │  │  · 四级权限判定 (NONE / BASIC / COMMAND / ADMIN)               │  │   │
│  │  │  · 基于 QQ 号 + 群角色 + 频率限制 / 冷却时间                    │  │   │
│  │  └────────────────────────────────────────────────────────────────┘  │   │
│  │                                                                        │   │
│  │  ┌────────────────────────────────────────────────────────────────┐  │   │
│  │  │                    配置层                                      │  │   │
│  │  │  QQConfig / 双模式支持 (managed / external)                    │  │   │
│  │  └────────────────────────────────────────────────────────────────┘  │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                                                               │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │                   主 Agent (游戏 Agent)                                │   │
│  │  (由 V5 Prompt 系统 + V6 LLM 调度 + V4 Function Calling 管线组成)      │   │
│  │                                                                        │   │
│  │  ┌────────────────────────────────────────────────────────────────┐  │   │
│  │  │  主 Agent 核心                                                  │  │   │
│  │  │  · 游戏交互 (移动/挖掘/战斗/建造/物品管理)                        │  │   │
│  │  │  · 游戏内聊天处理与回复                                         │  │   │
│  │  │  · 接收来自 QQ Sub-Agent 的 request_game_action 请求            │  │   │
│  │  │  · 执行游戏操作后返回结果给 Sub-Agent                           │  │   │
│  │  └────────────────────────────────────────────────────────────────┘  │   │
│  │                                                                        │   │
│  │  ┌────────────────────────────────────────────────────────────────┐  │   │
│  │  │  主 Agent Profile                                              │  │   │
│  │  │  name: "McAgent" / 用户自定义                                  │  │   │
│  │  │  identity: "你是 Minecraft 中的智能体..."                       │  │   │
│  │  │  tools: 全部游戏工具 (移动/挖掘/战斗/物品/建造等)                │  │   │
│  │  └────────────────────────────────────────────────────────────────┘  │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌──────────────────────────────┐
              │         NapCatQQ             │
              │  (Shell 子进程 / 外部进程)     │
              │  · OneBot v11 WebSocket      │
              │  · 消息收发 / 事件推送        │
              │  · 群管理 / 文件传输          │
              └──────────────────────────────┘
```

### 2.2 核心组件设计

#### 2.2.1 OneBotClient — OneBot 协议客户端

负责与 NapCat 建立 WebSocket 连接，实现 OneBot v11 协议的消息收发。

```typescript
interface OneBotClient {
  // 连接管理
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): ConnectionStatus; // disconnected | connecting | connected | reconnecting

  // 消息发送
  sendGroupMsg(groupId: string, message: string): Promise<SendResult>;
  sendPrivateMsg(userId: string, message: string): Promise<SendResult>;
  sendGroupImage(groupId: string, fileUrl: string): Promise<SendResult>;
  sendGroupFile(groupId: string, fileUrl: string, name: string): Promise<SendResult>;

  // 信息查询
  getGroupInfo(groupId: string): Promise<GroupInfo>;
  getGroupMemberList(groupId: string): Promise<MemberInfo[]>;
  getStrangerInfo(userId: string): Promise<UserInfo>;

  // 事件订阅
  onMessage(handler: MessageHandler): void;
  onNotice(handler: NoticeHandler): void;
  onRequest(handler: RequestHandler): void;

  // 重连
  onReconnecting(handler: () => void): void;
  onReconnected(handler: () => void): void;
}

interface OneBotConfig {
  wsUrl: string;           // ws://127.0.0.1:3001
  accessToken?: string;    // 鉴权 Token
  reconnectInterval: number; // 重连间隔 (ms)
  maxReconnectAttempts: number; // 最大重连次数
  heartbeatInterval: number; // 心跳间隔 (ms)
}
```

**协议对应关系：**

| OneBot API | 对应方法 | 用途 |
|-----------|---------|------|
| `send_group_msg` | `sendGroupMsg` | 发送群消息 |
| `send_private_msg` | `sendPrivateMsg` | 发送私聊消息 |
| `send_group_msg` (CQ:image) | `sendGroupImage` | 发送群图片 |
| `upload_group_file` | `sendGroupFile` | 上传群文件 |
| `get_group_info` | `getGroupInfo` | 获取群信息 |
| `get_group_member_list` | `getGroupMemberList` | 获取群成员列表 |
| `get_stranger_info` | `getStrangerInfo` | 获取用户信息 |

#### 2.2.2 MessageBridge — 消息桥接层

实现 QQ 群聊与游戏内聊天的双向同步。

```typescript
interface MessageBridge {
  // 配置
  configure(bridges: BridgeConfig[]): void;

  // QQ → 游戏
  onQQMessage(msg: QQMessage): void;

  // 游戏 → QQ
  onGameMessage(msg: GameMessage): void;

  // 状态
  getBridges(): BridgeConfig[];
}

interface BridgeConfig {
  groupId: string;           // QQ 群号
  direction: 'both' | 'qq_to_game' | 'game_to_qq'; // 桥接方向
  prefix?: string;           // 消息前缀，如 "[QQ]"
  filter?: {
    keywords?: string[];     // 关键词过滤
    users?: string[];        // 用户过滤白名单
  };
}
```

**桥接流程：**

```
QQ → 游戏:
  [QQ群消息] → 检查桥接配置 → 检查过滤规则 → 格式化 → 发送到游戏聊天

游戏 → QQ:
  [游戏聊天] → 检查桥接配置 → 格式化 → 发送到所有已启用的 QQ 群
```

#### 2.2.3 PermissionManager — 权限控制

```typescript
enum QQPermission {
  NONE = 0,     // 无权限，不响应任何消息
  BASIC = 1,    // 基础权限，可查询状态
  COMMAND = 2,  // 指令权限，可执行简单指令
  ADMIN = 3,    // 管理员权限，所有操作
}

interface PermissionManager {
  checkPermission(userId: string, groupId: string | null, required: QQPermission): boolean;
  getPermissionLevel(userId: string, groupId: string | null): QQPermission;
  isAdmin(userId: string): boolean;
  isRateLimited(userId: string): boolean; // 频率限制检查
}

interface PermissionConfig {
  ownerId: string;           // 群主 QQ 号 (自动 ADMIN)
  admins: string[];          // 管理员 QQ 号列表
  whitelist: string[];       // 白名单用户 (COMMAND 权限)
  defaultPermission: QQPermission; // 默认权限
  cooldownSeconds: number;   // 冷却时间 (秒)
}
```

#### 2.2.4 NapCatManager — NapCat 托管管理器

```typescript
type NapCatStatus = 'idle' | 'downloading' | 'starting' | 'running' | 'stopping' | 'error';

interface NapCatManagerOptions {
  userDataPath: string;
  account?: string;
  executablePath?: string;
  version?: string;
  oneBotPort?: number;
  webUiPort?: number;
  webUiToken?: string;
  accessToken?: string;
  onLog?: (line: string) => void;
  onStatusChange?: (status: NapCatStatus) => void;
}

interface NapCatManager {
  // 生命周期
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;

  // 状态
  getStatus(): NapCatStatus;
  getLogs(): readonly string[];

  // 二维码与登录
  getQRCode(): Promise<{ url: string; expiresAt: number }>;
  checkLoginStatus(): Promise<{ isLogin: boolean; isOffline: boolean; qrcodeUrl?: string; loginError?: string }>;
  getLoginInfo(): Promise<{ uin: string; nickname: string; avatarUrl?: string; online?: boolean } | null>;
}
```

#### 2.2.5 QQSubAgent — QQ 子 Agent

QQ Sub-Agent 是一个独立的 LLM 会话实例，专门处理 QQ 消息。它拥有独立的 AgentProfile、独立的对话上下文和独立的工具集。

**核心设计：**

```typescript
interface QQSubAgent {
  // 生命周期
  start(): Promise<void>;
  stop(): Promise<void>;

  // 消息处理
  handleMessage(msg: QQMessage): Promise<void>;

  // 状态
  getStatus(): SubAgentStatus; // idle | thinking | waiting_main_agent | error
  getConversation(): ConversationMessage[];

  // 事件
  onReply(handler: (reply: QQReply) => void): void;
  onRequestGameAction(handler: (request: GameActionRequest) => void): void;
  onBridgeMessage(handler: (msg: QQMessage) => void): void;
}

/** QQ Sub-Agent 的 AgentProfile 定义 */
const QQ_SUB_AGENT_PROFILE: AgentProfile = {
  name: 'QQ 机器人助手',
  identity: `你是 McAgent 的 QQ 机器人助手，负责处理 QQ 群聊和私聊中的消息。

你的职责：
1. 回复 QQ 用户的问题，提供友好的对话体验
2. 当用户需要游戏内操作（如查询状态、执行指令）时，使用 request_game_action 工具请求主 Agent

你的限制：
- 你无法直接操作游戏，所有游戏操作必须通过 request_game_action 请求主 Agent 执行
- 你需要将主 Agent 返回的结果以友好的方式回复给 QQ 用户
- 纯 QQ 相关的查询（如群信息、成员列表）可以直接使用 qq_info 工具`,
  personality: [
    '友好、耐心、乐于助人',
    '回复简洁明了，不啰嗦',
    '使用与 QQ 用户相同的语言回复',
    '遇到不懂的问题诚实告知，不编造答案',
  ],
  rules: {
    core: [
      '不要直接执行游戏操作，使用 request_game_action 请求主 Agent',
      '将主 Agent 返回的结果转换成自然语言回复给用户',
      '尊重用户隐私，不泄露其他用户的信息',
      '群聊中回复时 @ 对应用户',
      '工具可能失败，失败后向用户解释原因并提供替代方案',
    ],
    strategy: [],
    constraints: [],
  },
  preferences: {
    language: 'zh-CN',
    verbosity: 1,
    allowProactive: false,
    riskTolerance: 0,
  },
  fragments: [],
  fragmentsOrder: [],
};

/** 游戏操作请求（QQ Sub-Agent → 主 Agent） */
interface GameActionRequest {
  id: string;
  sourceUserId: string;           // 发起请求的 QQ 用户
  sourceGroupId?: string;         // 来源群号
  description: string;            // 用户请求的自然语言描述
  priority: 'normal' | 'high';   // 优先级
  timestamp: number;
}

/** 游戏操作响应（主 Agent → QQ Sub-Agent） */
interface GameActionResult {
  requestId: string;
  success: boolean;
  summary: string;                // 执行结果摘要（自然语言）
  details?: string;               // 详细结果
  error?: string;                 // 错误信息
  durationMs: number;
}
```

**request_game_action 工具：**

```typescript
const request_game_action_schema = {
  name: 'request_game_action',
  description: '请求主 Agent 执行游戏内的操作。当 QQ 用户需要查询游戏状态、执行游戏指令或进行任何游戏内操作时使用此工具。',
  parameters: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: '对用户请求的自然语言描述，包含所有必要信息，主 Agent 将据此理解并执行',
      },
      priority: {
        type: 'string',
        enum: ['normal', 'high'],
        description: '优先级，紧急操作（如玩家遇险）使用 high',
      },
    },
    required: ['description'],
  },
};

async function request_game_action(params: {
  description: string;
  priority?: 'normal' | 'high';
}): Promise<GameActionResult> {
  const request: GameActionRequest = {
    id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sourceUserId: currentQQMessage.userId,
    sourceGroupId: currentQQMessage.groupId,
    description: params.description,
    priority: params.priority ?? 'normal',
    timestamp: Date.now(),
  };

  // 将请求放入主 Agent 的任务队列
  const result = await mainAgentTaskQueue.submit(request);

  return result;
}
```

**QQ Sub-Agent 工作流程：**

```
QQ 消息到达
     ↓
权限检查 → 通过
     ↓
是否为快速指令 (以 / 开头)
  ├─ 是 → 指令解析器处理 → 直接回复 → 结束
  └─ 否 → 进入 QQ Sub-Agent
     ↓
QQ Sub-Agent LLM 处理
     ↓
意图判断:
  ├─ 纯 QQ 操作 (查询群信息/成员列表)
  │   └─ 调用 qq_info 工具 → 回复用户
  │
  ├─ 需要游戏操作 (查询状态/执行指令/移动/挖掘等)
  │   └─ 调用 request_game_action 工具
  │       ├─ 主 Agent 接收请求 → 在游戏上下文中处理
  │       ├─ 主 Agent 执行游戏操作 (可能调用多个游戏工具)
  │       └─ 返回结果 → QQ Sub-Agent 格式化回复 → 回复用户
  │
  ├─ 纯聊天 (问候/闲聊/问题)
  │   └─ 直接 LLM 生成回复 → 回复用户
  │
  └─ 桥接消息 (用户希望转发到游戏内)
      └─ 转发到消息桥接层 → 游戏内聊天
```

#### 2.2.6 双 Agent 通信机制

QQ Sub-Agent 与主 Agent 之间通过 **内部消息队列** 通信，不经过 TCP 外部网络：

```typescript
interface MainAgentTaskQueue {
  /** QQ Sub-Agent 提交游戏操作请求 */
  submit(request: GameActionRequest): Promise<GameActionResult>;

  /** 主 Agent 轮询待处理请求 */
  poll(): Promise<GameActionRequest | null>;

  /** 主 Agent 返回执行结果 */
  complete(requestId: string, result: GameActionResult): void;

  /** 获取队列状态 */
  getStatus(): { pending: number; processing: number; completed: number };
}
```

**通信流程：**

```
┌────────────────────────────────────────────────────────────┐
│                    QQ Sub-Agent                              │
│  request_game_action({ description: "检查一下我的背包" })    │
│       ↓                                                     │
│  MainAgentTaskQueue.submit(request) → 队列等待               │
└────────────────────────────────────────────────────────────┘
       ↓
       │ 内部消息队列 (内存中)
       ↓
┌────────────────────────────────────────────────────────────┐
│                    主 Agent (游戏 Agent)                     │
│                                                             │
│  1. 主 Agent 轮询到新请求                                    │
│  2. 将请求描述作为用户输入注入主 Agent 对话上下文              │
│  3. 主 Agent LLM 理解 → 调用游戏工具 (如 get_inventory)      │
│  4. 工具执行 → 收集结果                                      │
│  5. 将结果摘要返回给 QQ Sub-Agent                            │
│                                                             │
│  MainAgentTaskQueue.complete(requestId, result)              │
└────────────────────────────────────────────────────────────┘
       ↓
       │ 结果返回
       ↓
┌────────────────────────────────────────────────────────────┐
│                    QQ Sub-Agent                              │
│  收到 GameActionResult                                     │
│  → 格式化回复: "你的背包里有：钻石 x5, 铁锭 x32, ..."       │
│  → OneBotClient.sendGroupMsg() → QQ 群回复                  │
└────────────────────────────────────────────────────────────┘
```

**关键设计约束：**

| 约束 | 说明 |
|------|------|
| **异步通信** | QQ Sub-Agent 提交请求后不阻塞，可继续处理其他消息 |
| **超时处理** | 主 Agent 30s 内未回复 → 告知用户"正在处理中，请稍候" |
| **并发限制** | 同一群同一用户同时只能有一个待处理请求 |
| **上下文隔离** | Sub-Agent 和主 Agent 的 LLM 上下文完全独立，互不干扰 |
| **模型复用** | 两个 Agent 共享同一套 V6 ModelRouter 配置，可使用不同模型 |

### 2.3 消息格式

#### 2.3.1 OneBot 事件消息格式

```typescript
// 群消息事件
interface GroupMessageEvent {
  post_type: 'message';
  message_type: 'group';
  sub_type: 'normal' | 'anonymous' | 'notice';
  group_id: number;
  user_id: number;
  message: MessageSegment[];
  raw_message: string;
  font: number;
  sender: {
    user_id: number;
    nickname: string;
    card: string;
    role: 'owner' | 'admin' | 'member';
  };
  time: number;
  self_id: number;
}

// 私聊消息事件
interface PrivateMessageEvent {
  post_type: 'message';
  message_type: 'private';
  sub_type: 'friend' | 'group' | 'other';
  user_id: number;
  message: MessageSegment[];
  raw_message: string;
  font: number;
  sender: {
    user_id: number;
    nickname: string;
  };
  time: number;
  self_id: number;
}

// 消息段
interface MessageSegment {
  type: 'text' | 'image' | 'face' | 'at' | 'reply' | 'file';
  data: Record<string, string>;
}
```

#### 2.3.2 内部消息格式

```typescript
// QQ 消息（内部统一格式）
interface QQMessage {
  id: string;                    // 消息 ID
  type: 'group' | 'private';    // 消息类型
  groupId?: string;             // 群号 (群消息时)
  userId: string;               // 发送者 QQ 号
  userName: string;             // 发送者昵称
  content: string;              // 纯文本内容
  rawContent: string;           // 原始消息内容 (含 CQ 码)
  segments: MessageSegment[];   // 消息段数组
  timestamp: number;
  read: boolean;                // 是否已读
}

// 发送结果
interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}
```

### 2.4 双模式配置

支持「托管模式 (managed)」和「外部模式 (external)」，兼容现有用户和未来演进：

```typescript
interface QQBotConfig {
  enabled: boolean;
  mode: 'managed' | 'external';  // 托管模式 / 外部模式

  // 托管模式 (Phase 2)
  managed?: {
    account: string;             // QQ 号
    autoStart: boolean;          // 随 Agent Core 自动启动
    autoUpdate: boolean;         // 自动更新 NapCat
  };

  // 外部模式 (Phase 1)
  external?: {
    wsHost: string;              // WebSocket 主机
    wsPort: number;              // WebSocket 端口
    wsProtocol: 'ws' | 'wss';   // 协议
    accessToken: string;         // 鉴权 Token
  };

  // 权限配置
  authorization: {
    admins: string[];            // 管理员 QQ 号列表
    allowedGroups: string[];     // 允许的群组列表
    allowPrivate: boolean;       // 是否允许私聊
    defaultPermission: QQPermission; // 默认权限
    cooldownSeconds: number;     // 冷却时间
  };

  // 桥接配置
  bridges: BridgeConfig[];

  // 行为配置
  behavior: {
    replyPrefix: string;         // 回复前缀
    maxHistory: number;          // 消息历史上限
  };
}
```

---

## 第三部分：执行文档

### 3.1 文件结构

```
src/main/qq-bot/
├── index.ts                    # 模块入口
├── types.ts                    # 类型定义
├── config.ts                   # 配置管理
│
├── qq-sub-agent.ts             # QQ Sub-Agent 核心
│   ├── AgentProfile 定义 (QQ_SUB_AGENT_PROFILE)
│   ├── LLM 会话管理 (独立对话上下文)
│   ├── handleMessage 入口
│   ├── 意图判断路由
│   └── 回复生成与发送
│
├── request_game_action.ts      # request_game_action 工具
│   ├── 工具 schema 定义
│   ├── 提交请求到主 Agent 队列
│   └── 等待结果并返回
│
├── main-agent-queue.ts         # 双 Agent 通信队列
│   ├── submit / poll / complete
│   ├── 超时管理 (30s)
│   ├── 并发限制 (同群同用户单请求)
│   └── 状态查询
│
├── onebot-client.ts            # AC-QQ-01 OneBot 协议客户端
│   ├── connect/disconnect
│   ├── heartbeat
│   ├── sendGroupMsg / sendPrivateMsg
│   ├── getGroupInfo / getGroupMemberList / getStrangerInfo
│   └── 事件转发 (message / notice / request)
│
├── message-handler.ts          # AC-QQ-02 消息处理
│   ├── 群消息处理 → 权限检查 → 路由到 Sub-Agent / 桥接 / 指令
│   ├── 私聊消息处理 → 权限检查 → 路由到 Sub-Agent
│   ├── 消息队列管理
│   └── 消息格式转换
│
├── message-bridge.ts           # AC-QQ-03 消息桥接
│   ├── QQ → 游戏桥接 (桥接消息不走 Sub-Agent)
│   ├── 游戏 → QQ 桥接 (游戏内消息直接转发到 QQ)
│   ├── 桥接配置管理
│   └── 过滤规则引擎
│
├── permission.ts               # AC-QQ-04 权限控制
│   ├── 四级权限判定
│   ├── 频率限制
│   ├── 管理员/白名单管理
│   └── 冷却时间控制
│
├── message-queue.ts            # 消息队列
│   ├── 消息存储 (max 100)
│   ├── TTL 过期清理 (5min)
│   └── 未读消息查询
│
├── tool-registrar.ts           # 工具注册 (Phase 2)
│   └── 注册 qq_send / qq_info / request_game_action 到 Sub-Agent 工具列表
│
├── napcat-manager.ts           # AC-QQ-01 NapCat 托管管理器 (Phase 2)
│   ├── 二进制下载/校验
│   ├── 子进程管理 (spawn/stop)
│   ├── 配置自动生成
│   ├── 健康监控
│   └── 日志收集

src/main/tools/qq/              # 工具实现 (Sub-Agent 工具集)
├── qq_send.ts                  # AC-QQ-05 qq_send 工具
│   ├── group_msg (群消息)
│   ├── private_msg (私聊)
│   ├── image (图片)
│   └── file (文件)
│
└── qq_info.ts                  # AC-QQ-06 qq_info 工具
    ├── group (群信息)
    ├── members (群成员)
    └── user (用户信息)

src/renderer/src/components/qq-bot/  # UI 面板 (后续版本)
├── QQBotPanel.tsx              # QQ 机器人配置面板
└── QQBotStatus.tsx             # QQ 连接状态指示器
```

### 3.2 实施顺序与依赖

```
Phase 1 (V10 基础):
  ① B10.1 OneBot 客户端 (onebot-client.ts)    ← 无依赖
       ↓
  ② B10.2 消息处理 (message-handler.ts)       ← 依赖 ①
       ↓
  ③ B10.5 权限控制 (permission.ts)            ← 依赖 ②
       ↓
  ④ B10.6 双 Agent 通信队列 (main-agent-queue.ts) ← 无依赖
       ↓
  ⑤ B10.7 QQ Sub-Agent 核心 (qq-sub-agent.ts) ← 依赖 ② + ④
   │ 包含 request_game_action 工具              ← 依赖 ④
   │
   ├→ ⑥ A10.1 qq_send 工具 (qq_send.ts)      ← 注册到 Sub-Agent
   ├→ ⑦ A10.2 qq_info 工具 (qq_info.ts)      ← 注册到 Sub-Agent
   │
   ↓
  ⑧ B10.3 消息桥接 (message-bridge.ts)        ← 依赖 ② + ③
  ⑨ B10.8 工具注册 (tool-registrar.ts)        ← 依赖 ⑤

Phase 2 (V10.1+):
  ⑩ NapCat 托管管理器 (napcat-manager.ts)     ← 依赖 ①
```

### 3.3 核心接口定义

#### 3.3.1 OneBotClient

```typescript
export class OneBotClient {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private reconnectAttempts = 0;
  private readonly config: OneBotConfig;
  private messageHandlers: Set<MessageHandler> = new Set();
  private noticeHandlers: Set<NoticeHandler> = new Set();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(config: OneBotConfig) {
    this.config = {
      reconnectInterval: 5000,
      maxReconnectAttempts: 5,
      heartbeatInterval: 10000,
      ...config,
    };
  }

  async connect(): Promise<void> {
    this.status = 'connecting';
    const url = `${this.config.wsUrl}${this.config.accessToken ? `?access_token=${this.config.accessToken}` : ''}`;

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.status = 'connected';
      this.reconnectAttempts = 0;
      this.startHeartbeat();
    });

    this.ws.on('message', (data: string) => {
      this.handleMessage(JSON.parse(data));
    });

    this.ws.on('close', () => {
      this.status = 'disconnected';
      this.stopHeartbeat();
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[QQBot] WebSocket error:', err);
    });
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this.status = 'disconnected';
  }

  async sendGroupMsg(groupId: string, message: string): Promise<SendResult> {
    return this.callApi('send_group_msg', {
      group_id: parseInt(groupId),
      message,
    });
  }

  async sendPrivateMsg(userId: string, message: string): Promise<SendResult> {
    return this.callApi('send_private_msg', {
      user_id: parseInt(userId),
      message,
    });
  }

  async getGroupInfo(groupId: string): Promise<GroupInfo> {
    const result = await this.callApi('get_group_info', {
      group_id: parseInt(groupId),
    });
    return result.data;
  }

  async getGroupMemberList(groupId: string): Promise<MemberInfo[]> {
    const result = await this.callApi('get_group_member_list', {
      group_id: parseInt(groupId),
    });
    return result.data;
  }

  async getStrangerInfo(userId: string): Promise<UserInfo> {
    const result = await this.callApi('get_stranger_info', {
      user_id: parseInt(userId),
    });
    return result.data;
  }

  private async callApi(action: string, params: any): Promise<any> {
    if (!this.ws || this.status !== 'connected') {
      throw new Error('OneBot 未连接');
    }

    const echo = `${Date.now()}_${Math.random()}`;
    const request = {
      action,
      params,
      echo,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`API 调用超时: ${action}`));
      }, 10000);

      const handler = (data: any) => {
        if (data.echo === echo) {
          clearTimeout(timeout);
          this.ws?.off('message', handler);
          if (data.status === 'ok') {
            resolve(data);
          } else {
            reject(new Error(data.retcode ? `错误码: ${data.retcode}` : 'API 调用失败'));
          }
        }
      };

      this.ws!.on('message', handler);
      this.ws!.send(JSON.stringify(request));
    });
  }

  private handleMessage(data: any): void {
    // 心跳响应
    if (data.status === 'ok' && !data.echo) return;
    if (data.retcode !== undefined) return; // API 响应由 callApi 处理

    // 事件推送
    if (data.post_type === 'message') {
      this.messageHandlers.forEach(h => h(this.toQQMessage(data)));
    } else if (data.post_type === 'notice') {
      this.noticeHandlers.forEach(h => h(data));
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.ws?.send(JSON.stringify({ action: 'get_status', echo: 'heartbeat' }));
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('[QQBot] 已达最大重连次数');
      return;
    }

    this.status = 'reconnecting';
    this.reconnectAttempts++;

    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1),
      30000
    );

    setTimeout(() => this.connect(), delay);
  }

  private toQQMessage(event: GroupMessageEvent | PrivateMessageEvent): QQMessage {
    // 转换 OneBot 事件为内部格式
    const isGroup = event.message_type === 'group';
    const groupEvent = event as GroupMessageEvent;

    return {
      id: `${event.time}_${event.user_id}_${Math.random()}`,
      type: isGroup ? 'group' : 'private',
      groupId: isGroup ? String(groupEvent.group_id) : undefined,
      userId: String(event.user_id),
      userName: event.sender.nickname,
      content: this.extractText(event.message),
      rawContent: event.raw_message,
      segments: event.message,
      timestamp: event.time,
      read: false,
    };
  }

  private extractText(segments: MessageSegment[]): string {
    return segments
      .filter(s => s.type === 'text')
      .map(s => s.data.text)
      .join('')
      .trim();
  }
}
```

#### 3.3.2 qq_send 工具

```typescript
// Tool Schema (Function Calling 格式)
const qq_send_schema = {
  name: 'qq_send',
  description: '发送 QQ 消息，支持群消息、私聊、图片、文件四种方式',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['group_msg', 'private_msg', 'image', 'file'],
        description: '发送类型',
      },
      target: {
        type: 'string',
        description: '目标 ID（群号或 QQ 号）',
      },
      content: {
        type: 'string',
        description: '消息内容（文本消息时必填）',
      },
      file_url: {
        type: 'string',
        description: '文件/图片 URL（图片或文件时必填）',
      },
      file_name: {
        type: 'string',
        description: '文件名（文件类型时必填）',
      },
    },
    required: ['type', 'target'],
  },
};

async function qq_send(params: {
  type: 'group_msg' | 'private_msg' | 'image' | 'file';
  target: string;
  content?: string;
  file_url?: string;
  file_name?: string;
}): Promise<{ success: boolean; message_id?: string; error?: string }> {
  const client = getOneBotClient();

  switch (params.type) {
    case 'group_msg':
      if (!params.content) return { success: false, error: '群消息内容不能为空' };
      return client.sendGroupMsg(params.target, params.content);

    case 'private_msg':
      if (!params.content) return { success: false, error: '私聊消息内容不能为空' };
      return client.sendPrivateMsg(params.target, params.content);

    case 'image':
      if (!params.file_url) return { success: false, error: '图片 URL 不能为空' };
      return client.sendGroupImage(params.target, params.file_url);

    case 'file':
      if (!params.file_url || !params.file_name) return { success: false, error: '文件和文件名不能为空' };
      return client.sendGroupFile(params.target, params.file_url, params.file_name);

    default:
      return { success: false, error: `不支持的发送类型: ${params.type}` };
  }
}
```

#### 3.3.3 qq_info 工具

```typescript
const qq_info_schema = {
  name: 'qq_info',
  description: '查询 QQ 群信息、群成员列表或用户信息',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['group', 'members', 'user'],
        description: '查询类型',
      },
      target_id: {
        type: 'string',
        description: '目标 ID（群号或 QQ 号）',
      },
    },
    required: ['type', 'target_id'],
  },
};

async function qq_info(params: {
  type: 'group' | 'members' | 'user';
  target_id: string;
}): Promise<{
  success: boolean;
  data?: any;
  error?: string;
}> {
  const client = getOneBotClient();

  switch (params.type) {
    case 'group': {
      const info = await client.getGroupInfo(params.target_id);
      return {
        success: true,
        data: {
          group_id: String(info.group_id),
          group_name: info.group_name,
          member_count: info.member_count,
          max_member_count: info.max_member_count,
          owner_id: String(info.owner_id),
        },
      };
    }

    case 'members': {
      const members = await client.getGroupMemberList(params.target_id);
      return {
        success: true,
        data: {
          members: members.map(m => ({
            user_id: String(m.user_id),
            user_name: m.nickname,
            role: m.role,
          })),
        },
      };
    }

    case 'user': {
      const info = await client.getStrangerInfo(params.target_id);
      return {
        success: true,
        data: {
          user_id: String(info.user_id),
          user_name: info.nickname,
        },
      };
    }

    default:
      return { success: false, error: `不支持的查询类型: ${params.type}` };
  }
}
```

#### 3.3.4 权限判定

```typescript
export class PermissionManager {
  private config: PermissionConfig;
  private rateLimitMap: Map<string, number> = new Map(); // userId -> lastTimestamp

  constructor(config: PermissionConfig) {
    this.config = config;
  }

  checkPermission(userId: string, groupId: string | null, required: QQPermission): boolean {
    const level = this.getPermissionLevel(userId, groupId);
    return level >= required;
  }

  getPermissionLevel(userId: string, groupId: string | null): QQPermission {
    // 群主自动 ADMIN
    if (this.config.ownerId === userId) return QQPermission.ADMIN;

    // 管理员 ADMIN
    if (this.config.admins.includes(userId)) return QQPermission.ADMIN;

    // 白名单 COMMAND
    if (this.config.whitelist.includes(userId)) return QQPermission.COMMAND;

    // 默认权限
    return this.config.defaultPermission;
  }

  isRateLimited(userId: string): boolean {
    const now = Date.now();
    const last = this.rateLimitMap.get(userId);

    if (last && now - last < this.config.cooldownSeconds * 1000) {
      return true; // 在冷却中
    }

    // 管理员不受限
    if (this.getPermissionLevel(userId, null) >= QQPermission.ADMIN) {
      return false;
    }

    this.rateLimitMap.set(userId, now);
    return false;
  }
}
```

### 3.4 消息处理流程

#### 3.4.1 QQ 消息处理流程

```
用户发送消息到 QQ 群
       ↓
NapCat 接收 → 封装为 OneBot 事件 → WebSocket 推送
       ↓
OneBotClient.onMessage() 收到事件
       ↓
转为内部 QQMessage 格式
       ↓
PermissionManager.checkPermission() → 检查权限
  ├─ 无权限 → 静默丢弃
  └─ 有权限 → 继续
       ↓
isRateLimited() → 检查频率限制
  ├─ 受限 → 静默丢弃
  └─ 正常 → 继续
       ↓
MessageQueue.add() → 存入消息队列
       ↓
message-handler.ts 路由判断:
  ├─ 桥接消息 (群聊中的普通聊天) → MessageBridge → 游戏内聊天
  │
  ├─ 快速指令 (以 / 开头) → 指令解析器 → 直接回复
  │
  └─ 需要 AI 处理 → QQ Sub-Agent
       ↓
  ┌─────────────────────────────────────────────────────┐
  │  QQ Sub-Agent 处理                                   │
  │                                                     │
  │  1. 将消息注入 Sub-Agent 的 LLM 对话上下文            │
  │  2. Sub-Agent LLM 调用 (使用 Sub-Agent 的 Profile)   │
  │  3. 意图判断:                                        │
  │     ├─ 纯 QQ 操作 → 调用 qq_info 工具 → 回复         │
  │     ├─ 需要游戏操作 → request_game_action            │
  │     │   ├─ 提交到 MainAgentTaskQueue                 │
  │     │   ├─ 主 Agent 轮询 → 处理 → 返回结果           │
  │     │   └─ 格式化结果 → 回复用户                     │
  │     ├─ 纯聊天 → LLM 直接生成回复 → 回复              │
  │     └─ 桥接消息 → 转发到 MessageBridge              │
  │                                                     │
  │  4. OneBotClient.sendGroupMsg() → 回复到 QQ 群       │
  └─────────────────────────────────────────────────────┘
```

#### 3.4.2 游戏消息 → QQ 桥接

```
游戏内玩家发送聊天消息
       ↓
Adapter Core → TCP JSON-RPC → Agent Core 收到
       ↓
MessageBridge.onGameMessage()
       ↓
检查桥接配置 (direction / filter)
       ↓
格式化消息 "[游戏] 玩家名: 内容"
       ↓
遍历所有已启用的桥接 → 分别发送到对应 QQ 群
```

### 3.5 配置示例

```json
{
  "qq_bot": {
    "enabled": true,
    "mode": "external",

    "external": {
      "ws_host": "127.0.0.1",
      "ws_port": 3001,
      "ws_protocol": "ws",
      "access_token": ""
    },

    "authorization": {
      "admins": ["100001"],
      "allowed_groups": ["200001", "200002"],
      "allow_private": true,
      "default_permission": 1,
      "cooldown_seconds": 3
    },

    "bridges": [
      {
        "group_id": "200001",
        "direction": "both",
        "prefix": "[QQ]",
        "filter": {
          "keywords": [],
          "users": []
        }
      }
    ],

    "behavior": {
      "reply_prefix": "[McAgent] ",
      "max_history": 20
    }
  }
}
```

---

## 第四部分：非功能需求

### 4.1 性能指标

| 指标 | 目标 | 测量方式 |
|------|------|----------|
| 消息端到端延迟 | < 500ms（从 QQ 收到到 LLM 开始处理） | 计时日志 |
| WebSocket 心跳间隔 | 10s | 配置可调 |
| 消息队列容量 | 100 条 | 固定上限 |
| 消息 TTL | 5 分钟 | 自动清理过期消息 |
| 单连接吞吐 | > 50 msg/s | 压力测试 |

### 4.2 可靠性指标

| 指标 | 目标 | 说明 |
|------|------|------|
| 断线重连 | < 30s 恢复 | 指数退避，最多 5 次 |
| 消息不丢失 | 队列满时丢弃最旧消息 | 环形缓冲区策略 |
| 崩溃恢复 | 重启后自动恢复连接 | 配置持久化，重连自动触发 |
| 频率限制 | 单用户 3s 冷却 | 管理员不受限 |

### 4.3 安全要求

| 要求 | 说明 |
|------|------|
| 权限隔离 | 四级权限体系，未经授权用户无法执行敏感操作 |
| API Key 安全 | OneBot Token 不在日志中明文输出 |
| 私聊保护 | 可通过 `allow_private` 开关控制私聊是否启用 |
| 群白名单 | 仅允许配置的群组与机器人交互 |
| 敏感操作确认 | 涉及游戏内重大变更的操作要求二次确认 |

### 4.4 内存约束

| 场景 | 内存上限 | 说明 |
|------|----------|------|
| QQ 机器人空闲 | < 5MB | 仅 WebSocket 连接 + 心跳 |
| 正常消息处理 | < 20MB | 含消息队列 (100条) + 权限缓存 |
| 消息桥接全负荷 | < 30MB | 含双向桥接 + 过滤规则 |

### 4.5 测试要求

| 测试类型 | 覆盖范围 | 最低通过率 |
|---------|---------|:----------:|
| 单元测试 | OneBot 客户端、消息处理、权限控制、桥接逻辑 | 100% |
| 集成测试 | 完整消息收发流程、桥接流程、权限校验 | 100% |
| 压力测试 | 连续 100 条消息、50 并发 | 消息不丢失 |
| 断线重连测试 | 多次断开重连 | 30s 内恢复 |

---

## 第五部分：Phase 2 规划（V10.1+）

### 5.1 NapCat 托管管理器

```typescript
// 在 Phase 1 基础上增加 NapCat 子进程管理
// 目录结构：{userData}/napcat/
//   ├── napcat.exe          # NapCat 主程序
//   ├── config/             # 配置文件
//   │   └── napcat.json     # 自动生成
//   └── logs/               # NapCat 日志

class NapCatManager {
  async start(): Promise<void> {
    // 1. 检查 NapCat 二进制是否存在
    // 2. 不存在则从 GitHub Releases 下载
    // 3. 自动生成 napcat.json
    // 4. spawn 子进程
    // 5. 等待 WebSocket 就绪
    // 6. 触发 OneBotClient.connect()
  }

  async stop(): Promise<void> {
    // 1. 断开 OneBot 连接
    // 2. 发送 SIGTERM 给子进程
    // 3. 等待进程退出
    // 4. 清理资源
  }

  private async ensureBinary(): Promise<string> {
    // 检测平台 → 下载对应二进制
    // 校验 SHA256
    // 解压到目标目录
  }

  private async generateConfig(): Promise<void> {
    // 生成 napcat.json
    // 端口: 3001
    // accessToken: 自动生成 UUID
    // webui: { enabled: false }
    // account: 用户输入的 QQ 号
  }
}
```

### 5.2 演进路线

| 阶段 | 版本 | 功能 | 状态 |
|------|:----:|------|:----:|
| Phase 1 | V10 | 外部模式 + OneBot 客户端 + QQ 工具 + 桥接 + 权限 | ✅ |
| Phase 2 | V10 | NapCat 托管管理器（自动下载/子进程管理/配置注入/二维码获取） | ✅ |
| Phase 3 | V10 | 进程监控 + 自动恢复 + 登录状态轮询 | ✅ |
| Phase 4 | V10.1 | 自动更新 + 多实例支持 | 规划中 |

> 详细 NapCat 集成方案参见 [AC-V10-NapCatQQ集成分析.md](../../analysis/AC-V10-NapCatQQ集成分析.md)