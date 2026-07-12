# Alice Mod Core V14 — 事件触发器 + QQ 完善

> 版本：v1.0
> 日期：2026-07-11
> 版本号：V14（第 17 周）
> 对应需求：AC-EVT-01 ~ AC-EVT-04、AC-QQ-07
> 关联文档：[AC-01-需求文档.md](AC-01-需求文档.md)、[AC-V10-QQ机器人模块.md](AC-V10-QQ机器人模块.md)、[AC-V13-任务系统.md](AC-V13-任务系统.md)、[AC-V9-工具调用面板与日志系统.md](AC-V9-工具调用面板与日志系统.md)

---

## 第一部分：需求文档

### 1.1 模块定位

V14 是 Agent Core 的**事件驱动层**与**QQ 机器人增强版本**。它让 Alice 从"被动响应 LLM 调用"演进为"主动感知事件并自动行动"，同时补齐 QQ 机器人在群管理、远程指令和主动通知方面的能力。

| 职责 | 说明 |
|------|------|
| **事件触发器（A8）** | 统一接收、过滤、分发游戏内/外事件，并将事件转换为任务或 LLM 输入 |
| **定时任务触发** | 基于 Cron 或绝对时间的计划任务，到达后自动创建并执行 V13 任务 |
| **游戏聊天触发** | 捕获游戏内玩家聊天，按规则触发回复、任务或记忆存储 |
| **插件消息触发** | 接收 Adapter Core 推送的事件通知（如玩家受伤、发现矿石、死亡等） |
| **QQ 渠道触发** | QQ 群聊中被 @ 机器人、私聊、关键词命中时自动触发对话或任务 |
| **QQ 完善（A7）** | 群管理、远程指令、主动通知三类增强能力 |

**关键设计原则**：
- 事件触发器是**纯后端模块**，不依赖前端 UI，通过日志和工具调用记录可观测。
- 所有事件统一走 `EventBus` 进行解耦，订阅者按需消费。
- 事件触发与 V13 任务系统深度集成：事件到达后可自动生成 `conditional` / `simple` 任务。
- QQ 完善能力仅对 ADMIN / COMMAND 权限用户开放，避免滥用。

### 1.2 与已有模块的关系

| 模块 | 关系说明 |
|------|----------|
| **V13 任务系统** | 事件触发器的最终出口通常是创建任务；`task_schedule.trigger_event` 字段在 V14 被真正使用 |
| **V10 QQ 机器人** | QQ 渠道触发器基于 V10 的 OneBotClient 和 MessageHandler 扩展；QQ 完善功能直接增强 Sub-Agent 工具集 |
| **V4 Function Calling Pipeline** | 事件触发后如需 LLM 决策，通过 Pipeline 调用主 Agent 或 QQ Sub-Agent |
| **V9 日志系统** | 所有事件触发、规则匹配、动作执行过程写入日志，支持调试 |
| **V11 记忆系统** | 游戏聊天事件可选择性存储为 `social` / `player_habit` 类型记忆 |
| **V12 地图索引** | 插件事件中的位置信息可同步到地图索引 |
| **V3 工作区管理** | 事件按工作区隔离，不同 Adapter Core 实例的事件不互相影响 |

### 1.3 功能需求列表

#### 事件触发器

| 需求 ID | 需求名称 | 优先级 | 实现状态 |
|---------|----------|:------:|:--------:|
| AC-EVT-01 | 定时任务触发器（Cron / 绝对时间 / 循环间隔） | P0 | 已实现 |
| AC-EVT-02 | 游戏聊天触发器（关键词 / 正则 / @机器人） | P0 | 已实现 |
| AC-EVT-03 | 插件消息触发器（Adapter Core 事件订阅与解析） | P0 | 已实现 |
| AC-EVT-04 | QQ 渠道触发器（@机器人 / 私聊 / 关键词） | P0 | 已实现 |

#### QQ 完善

| 需求 ID | 需求名称 | 优先级 | 实现状态 |
|---------|----------|:------:|:--------:|
| AC-QQ-07 | QQ 机器人完善（群管理 / 远程指令 / 主动通知） | P1 | 已实现 |

### 1.4 详细功能需求

#### AC-EVT-01 定时任务触发器

| 子需求 | 说明 |
|--------|------|
| Cron 表达式 | 支持标准 5 字段 Cron（分 时 日 月 周），如 `0 8 * * *` 表示每天早上 8 点 |
| 绝对时间 | 支持指定未来时间戳，到达后触发一次 |
| 循环间隔 | 支持 `every N seconds/minutes/hours`，到达后触发 |
| 时区处理 | 默认使用系统本地时区，可配置为 UTC 或指定时区 |
| 触发动作 | 创建 V13 任务、直接调用工具、发送 LLM 提示词 |
| 持久化 | 触发器配置持久化到 SQLite，重启后自动恢复 |
|  missed 触发补偿 | 重启后检查错过的定时任务，可选一次性补偿执行 |

#### AC-EVT-02 游戏聊天触发器

| 子需求 | 说明 |
|--------|------|
| 事件来源 | 接收 Adapter Core 通过 TCP 发送的 `game_chat` 事件 |
| 匹配规则 | 支持关键词匹配、正则匹配、发送者 ID 白名单、@机器人检测 |
| 响应方式 | 可配置为：直接回复游戏内聊天、创建任务、调用 LLM 生成回复、存储记忆 |
| 冷却时间 | 同规则同玩家触发后进入冷却，防止刷屏 |
| 上下文注入 | 命中后可将聊天内容注入 LLM 上下文，作为用户输入 |
| 权限控制 | 区分普通玩家与管理员玩家，管理员可执行敏感操作 |

#### AC-EVT-03 插件消息触发器

| 子需求 | 说明 |
|--------|------|
| 事件订阅 | Agent Core 向 Adapter Core 注册感兴趣的事件类型列表 |
| 事件类型 | 支持 `player_hurt`、`player_died`、`mob_spotted`、`ore_found`、`inventory_full`、`weather_changed` 等 |
| 事件格式 | Adapter Core 通过 JSON-RPC `notify/event` 推送，含事件类型、时间戳、工作区 ID、Payload |
| 规则引擎 | 支持按事件类型 / 事件 Payload 字段 / 工作区进行过滤 |
| 响应方式 | 触发任务、发送 QQ 通知、存储记忆、更新地图索引 |
| 去重窗口 | 同一事件在 5s 内重复到达视为重复，只处理一次 |

#### AC-EVT-04 QQ 渠道触发器

| 子需求 | 说明 |
|--------|------|
| 触发条件 | 群聊中被 @ 机器人、私聊消息、群聊关键词命中 |
| 权限检查 | 触发前经过 V10 PermissionManager 校验 |
| 响应方式 | 调用 QQ Sub-Agent 生成回复、创建任务、调用工具 |
| 上下文关联 | 命中消息注入 Sub-Agent 对话上下文，作为用户输入 |
| 冷却控制 | 同群同用户进入冷却，避免高频触发 |
| 桥接排除 | 已被桥接到游戏内的消息不再触发 QQ 渠道触发器 |

#### AC-QQ-07 QQ 机器人完善

| 子需求 | 说明 |
|--------|------|
| 群管理 | 支持踢人、禁言、设置群名片、审批入群申请、撤回消息 |
| 远程指令 | 支持 ADMIN 用户通过 QQ 直接执行预定义远程指令（如 `/restart`、`/status`、`/task list`） |
| 主动通知 | 游戏内重要事件（玩家死亡、任务完成、异常状态）主动推送到指定 QQ 群 |
| 通知模板 | 支持配置通知模板，可引用事件字段 |
| 白名单 | 群管理 / 远程指令仅对 ADMIN 用户开放 |

### 1.5 验收标准

#### 事件触发器验收标准

| # | 验收条件 | 验证方法 | 测量指标 |
|---|----------|----------|----------|
| 14.1 | Cron 定时触发 | 创建 `0 * * * *` 触发器，等待整点 | 准时创建对应任务 |
| 14.2 | 绝对时间触发 | 创建 10s 后的触发器 | 到达时间后触发 |
| 14.3 | 循环间隔触发 | 创建每 5s 触发一次的触发器 | 触发 3 次时间间隔约 5s |
| 14.4 | 重启后定时任务恢复 | 创建定时触发器后重启应用 | 重启后触发器仍在，错过的任务可选补偿 |
| 14.5 | 游戏聊天关键词触发 | 游戏内发送含关键词的消息 | 触发器命中并执行配置动作 |
| 14.6 | 游戏聊天正则触发 | 游戏内发送匹配正则的消息 | 正则匹配成功并触发 |
| 14.7 | 插件事件触发 | Adapter Core 推送 `player_hurt` 事件 | 触发器接收并处理 |
| 14.8 | 插件事件去重 | 5s 内重复推送同一事件 | 只处理一次 |
| 14.9 | QQ @机器人触发 | 群聊中 @机器人 | Sub-Agent 收到输入并回复 |
| 14.10 | QQ 私聊触发 | 向机器人发送私聊 | Sub-Agent 收到输入并回复 |
| 14.11 | QQ 关键词触发 | 群聊中发送配置的关键词 | 触发器命中并执行动作 |
| 14.12 | 事件触发创建任务 | 配置事件动作为 `create_task` | V13 任务表中新增对应任务 |

#### QQ 完善验收标准

| # | 验收条件 | 验证方法 | 测量指标 |
|---|----------|----------|----------|
| 14.13 | 群管理踢人 | ADMIN 发送 `/kick @用户` | 目标用户被踢出群 |
| 14.14 | 群管理禁言 | ADMIN 发送 `/mute @用户 60` | 目标用户被禁言 60 秒 |
| 14.15 | 远程指令查询状态 | ADMIN 发送 `/status` | 返回当前 Agent Core 状态 |
| 14.16 | 远程指令查询任务 | ADMIN 发送 `/task list` | 返回任务列表摘要 |
| 14.17 | 主动通知玩家死亡 | 游戏内玩家死亡事件触发 | 指定 QQ 群收到死亡通知 |
| 14.18 | 主动通知任务完成 | 任务完成后 | 指定 QQ 群收到完成通知 |
| 14.19 | 权限不足拒绝 | BASIC 用户尝试踢人 | 返回权限不足提示 |

---

## 第二部分：架构设计

### 2.1 总体架构

```
                              ┌─────────────────────────────────────┐
                              │          外部事件源                  │
                              │  Adapter Core │ NapCatQQ │ 系统时钟 │
                              └─────────┬───────────────┬───────────┘
                                        │               │
                     game_chat /        │  group_msg /  │ cron
                     plugin event       │  private_msg  │
                                        ▼               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Agent Core                                       │
│                                                                               │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │                          事件触发器模块 (A8)                           │   │
│  │                                                                        │   │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────────────┐   │   │
│  │  │   EventBus     │  │ TriggerEngine  │  │     TriggerStore       │   │   │
│  │  │  · 统一事件总线 │  │  · 规则匹配     │  │  · SQLite 持久化        │   │   │
│  │  │  · 订阅/发布    │  │  · 条件求值     │  │  · 触发器/日志/调度     │   │   │
│  │  └───────┬────────┘  └───────┬────────┘  └────────────────────────┘   │   │
│  │          │                   │                                         │   │
│  │  ┌───────▼───────────────────▼────────────────────────────────┐       │   │
│  │  │                    TriggerStore (SQLite)                    │       │   │
│  │  │  event_triggers · trigger_logs · trigger_schedule           │       │   │
│  │  └────────────────────────────────────────────────────────────┘       │   │
│  │                                                                        │   │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐    │   │
│  │  │ 定时触发器适配器  │  │ 游戏聊天触发器    │  │ 插件事件触发器    │    │   │
│  │  │ CronAdapter      │  │ GameChatAdapter   │  │ PluginEventAdapter│    │   │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘    │   │
│  │  ┌──────────────────────────────────────────────────────────────┐    │   │
│  │  │                   QQ 渠道触发器 (QQTriggerAdapter)            │    │   │
│  │  └──────────────────────────────────────────────────────────────┘    │   │
│  │                                                                        │   │
│  │  ┌──────────────────────────────────────────────────────────────┐    │   │
│  │  │                    ActionExecutor 动作执行器                  │    │   │
│  │  │  create_task · call_tool · send_llm · send_qq · store_memory │    │   │
│  │  └──────────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────┬─────────────────────────────────────┘   │
│                                    │                                          │
│                                    ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │                          V13 任务系统                                  │   │
│  │  TaskManager · TaskScheduler · 四种执行器                              │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                                                               │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │                          V10 QQ 机器人模块                             │   │
│  │  QQ Sub-Agent · OneBotClient · 消息桥接 · 权限控制                     │   │
│  │  + V14 新增：群管理工具 · 远程指令解析器 · 主动通知器                   │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心数据流

#### 事件触发到任务创建

```
事件到达（游戏聊天 / 插件事件 / QQ 消息 / 定时器）
    ↓
EventBus.publish(event)
    ↓
TriggerEngine 遍历已注册触发器
    ↓
规则匹配（type / source / payload / workspace / time）
    ↓
命中触发器
    ↓
ActionExecutor 执行动作
    ├─ create_task → TaskManager.create() → TaskScheduler 调度
    ├─ call_tool   → Function Calling Pipeline
    ├─ send_llm    → 主 Agent / QQ Sub-Agent
    ├─ send_qq     → OneBotClient.sendGroupMsg()
    └─ store_memory → MemoryManager.store()
    ↓
写入 trigger_logs 记录触发结果
```

#### QQ 渠道触发

```
QQ 消息到达
    ↓
OneBotClient → MessageHandler
    ↓
过滤：是否桥接消息？是 → 桥接流程结束
    ↓
QQTriggerAdapter 检查触发规则
    ├─ @机器人 / 私聊 / 关键词命中
    ↓
权限检查（PermissionManager）
    ↓
命中后交给 QQ Sub-Agent 或创建任务
    ↓
回复 / 执行动作
```

### 2.3 数据库设计

#### 新增 SQLite 表结构

```sql
-- 事件触发器配置表
CREATE TABLE IF NOT EXISTS event_triggers (
  id TEXT PRIMARY KEY,                              -- UUID v4
  workspace_id TEXT NOT NULL DEFAULT '',            -- 所属工作区，空字符串表示全局
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,               -- 0/1
  source TEXT NOT NULL CHECK(source IN ('cron', 'game_chat', 'plugin_event', 'qq')),
  priority INTEGER NOT NULL DEFAULT 5,              -- 1-10，越大越优先
  rule_json TEXT NOT NULL,                          -- 匹配规则 JSON
  action_json TEXT NOT NULL,                        -- 执行动作 JSON
  cooldown_seconds INTEGER NOT NULL DEFAULT 0,
  max_trigger_count INTEGER,                        -- 最大触发次数，NULL 表示无限制
  trigger_count INTEGER NOT NULL DEFAULT 0,
  last_triggered_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_event_triggers_workspace ON event_triggers(workspace_id);
CREATE INDEX IF NOT EXISTS idx_event_triggers_source ON event_triggers(source);
CREATE INDEX IF NOT EXISTS idx_event_triggers_enabled ON event_triggers(enabled);

-- 触发器执行日志表
CREATE TABLE IF NOT EXISTS trigger_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_payload TEXT,                               -- JSON
  action_json TEXT NOT NULL,                        -- 执行的动作
  success INTEGER NOT NULL DEFAULT 1,               -- 0/1
  error TEXT,
  triggered_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (trigger_id) REFERENCES event_triggers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_trigger_logs_trigger ON trigger_logs(trigger_id);
CREATE INDEX IF NOT EXISTS idx_trigger_logs_event_type ON trigger_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_trigger_logs_triggered_at ON trigger_logs(triggered_at);

-- 定时触发器调度表（与 task_schedule 语义类似，独立管理 cron/interval）
CREATE TABLE IF NOT EXISTS trigger_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_id TEXT NOT NULL UNIQUE,
  schedule_type TEXT NOT NULL CHECK(schedule_type IN ('cron', 'at', 'interval')),
  cron_expression TEXT,
  scheduled_at INTEGER,
  interval_seconds INTEGER,
  last_scheduled_at INTEGER,
  next_scheduled_at INTEGER,
  FOREIGN KEY (trigger_id) REFERENCES event_triggers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_trigger_schedule_next ON trigger_schedule(next_scheduled_at);
```

#### 配置表新增

```sql
INSERT INTO config (key, value, value_type, description) VALUES
('trigger_default_cooldown', '5', 'number', '默认触发冷却时间（秒）'),
('trigger_max_logs_per_trigger', '1000', 'number', '单个触发器最大日志保留数'),
('trigger_log_retention_days', '30', 'number', '触发器日志保留天数'),
('qq_remote_commands_enabled', '1', 'boolean', '是否启用 QQ 远程指令'),
('qq_proactive_notifications_enabled', '1', 'boolean', '是否启用 QQ 主动通知'),
('qq_proactive_target_groups', '[]', 'json', '主动通知目标群列表');
```

### 2.4 模块接口设计

#### EventBus 接口

```typescript
interface EventBus {
  publish(event: AgentEvent): void;
  subscribe(filter: EventFilter, handler: EventHandler): () => void;
  on(eventType: string, handler: EventHandler): () => void;
  clear(): void;
}

interface AgentEvent {
  id: string;                    -- UUID v4
  type: string;                  -- 事件类型
  source: 'cron' | 'game_chat' | 'plugin_event' | 'qq' | 'system';
  workspaceId: string;           -- 工作区 ID
  timestamp: number;             -- 事件时间戳
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}
```

#### TriggerEngine 接口

```typescript
interface TriggerEngine {
  start(): void;
  stop(): void;
  register(trigger: EventTrigger): void;
  unregister(triggerId: string): void;
  list(options?: ListTriggerOptions): EventTrigger[];
  evaluate(event: AgentEvent): Promise<TriggerMatch[]>;
}

interface EventTrigger {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  enabled: boolean;
  source: 'cron' | 'game_chat' | 'plugin_event' | 'qq';
  priority: number;
  rule: TriggerRule;
  action: TriggerAction;
  cooldownSeconds: number;
  maxTriggerCount?: number;
  triggerCount: number;
  lastTriggeredAt?: number;
  createdAt: number;
  updatedAt: number;
}

interface TriggerRule {
  type: 'keyword' | 'regex' | 'event_type' | 'payload_field' | 'at_bot' | 'private_msg' | 'cron' | 'interval' | 'composite';
  value?: unknown;
  conditions?: TriggerRule[];
  operator?: 'and' | 'or';
}

interface TriggerAction {
  type: 'create_task' | 'call_tool' | 'send_llm' | 'send_qq' | 'store_memory' | 'none';
  config: Record<string, unknown>;
}
```

#### Trigger Adapters 接口

```typescript
interface TriggerAdapter {
  readonly source: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  handle(rawEvent: unknown): AgentEvent | null;
}

// 定时适配器
class CronTriggerAdapter implements TriggerAdapter {
  readonly source = 'cron';
  start(): Promise<void> { /* 启动调度循环 */ }
  stop(): Promise<void> { /* 清理定时器 */ }
  handle(rawEvent: unknown): AgentEvent | null { return null; }
}

// 游戏聊天适配器
class GameChatTriggerAdapter implements TriggerAdapter {
  readonly source = 'game_chat';
  handle(rawEvent: GameChatPayload): AgentEvent | null;
}

// 插件事件适配器
class PluginEventTriggerAdapter implements TriggerAdapter {
  readonly source = 'plugin_event';
  handle(rawEvent: PluginEventPayload): AgentEvent | null;
}

// QQ 渠道触发器适配器
class QQTriggerAdapter implements TriggerAdapter {
  readonly source = 'qq';
  handle(rawEvent: QQMessage): AgentEvent | null;
}
```

#### ActionExecutor 接口

```typescript
interface ActionExecutor {
  execute(action: TriggerAction, event: AgentEvent): Promise<ActionResult>;
}

interface ActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}
```

#### QQ 完善新增工具 Schema

```typescript
// qq_group_manage 工具 Schema
const QQ_GROUP_MANAGE_TOOL: ToolDefinition = {
  name: 'qq_group_manage',
  description: 'QQ 群管理操作：踢人、禁言、设置群名片、审批入群、撤回消息（仅 ADMIN 权限）',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['kick', 'mute', 'set_card', 'approve_join', 'recall'],
        description: '群管理动作',
      },
      group_id: { type: 'string', description: '群号' },
      user_id: { type: 'string', description: '目标用户 QQ 号' },
      duration: { type: 'number', description: '禁言时长（秒）' },
      card: { type: 'string', description: '群名片' },
      flag: { type: 'string', description: '入群申请标识' },
      message_id: { type: 'string', description: '消息 ID' },
    },
    required: ['action', 'group_id'],
  },
};

// qq_notify 工具 Schema
const QQ_NOTIFY_TOOL: ToolDefinition = {
  name: 'qq_notify',
  description: '向指定 QQ 群发送主动通知消息',
  input_schema: {
    type: 'object',
    properties: {
      group_id: { type: 'string', description: '目标群号' },
      content: { type: 'string', description: '通知内容' },
      template: { type: 'string', description: '模板名称（可选）' },
    },
    required: ['group_id', 'content'],
  },
};
```

### 2.5 关键类型定义

```typescript
// ==========================================
// V14 新增类型：事件触发器
// ==========================================

/** 触发器来源 */
export type TriggerSource = 'cron' | 'game_chat' | 'plugin_event' | 'qq';

/** 触发器动作类型 */
export type TriggerActionType = 'create_task' | 'call_tool' | 'send_llm' | 'send_qq' | 'store_memory' | 'none';

/** 游戏聊天事件 Payload */
export interface GameChatPayload {
  playerId: string;
  playerName: string;
  message: string;
  rawMessage: string;
  isAtBot: boolean;
  timestamp: number;
  workspaceId: string;
}

/** 插件事件 Payload */
export interface PluginEventPayload {
  eventType: string;
  workspaceId: string;
  entityId?: string;
  position?: { x: number; y: number; z: number; dimension: string };
  data: Record<string, unknown>;
}

/** 触发器匹配结果 */
export interface TriggerMatch {
  trigger: EventTrigger;
  event: AgentEvent;
  matchedRule: TriggerRule;
}

/** 触发器日志 */
export interface TriggerLog {
  id: number;
  triggerId: string;
  eventType: string;
  eventPayload?: Record<string, unknown>;
  action: TriggerAction;
  success: boolean;
  error?: string;
  triggeredAt: number;
}
```

### 2.6 关键设计决策

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| **事件总线** | 全局 EventEmitter / RxJS / 自实现 EventBus | **自实现 EventBus** | 轻量、类型安全、无需引入额外依赖 |
| **定时调度** | node-cron / later / 自实现 Cron 解析 | **node-cron** | 稳定成熟，支持标准 Cron 表达式，减少自研成本 |
| **规则引擎** | 硬编码 / 规则 DSL / JSON 规则 | **JSON 规则 + 组合条件** | 可持久化、可动态配置、LLM 可生成 |
| **动作执行** | 同步执行 / 异步队列 | **异步队列** | 避免事件处理阻塞主流程 |
| **事件去重** | 内存缓存 / Redis / SQLite | **内存 LRU 缓存** | 单机应用，5s 去重窗口内存足够 |
| **QQ 远程指令** | 独立解析器 / 复用 Sub-Agent | **独立解析器 + Sub-Agent 兜底** | 常用指令快速响应，复杂指令交给 LLM |
| **主动通知** | 轮询检查 / 事件订阅 | **事件订阅** | 实时性高，避免无效轮询 |
| **持久化策略** | 全量持久化 / 仅配置持久化 | **配置 + 日志持久化，运行时状态内存化** | 触发器配置和日志需要回溯，运行时状态可重建 |

---

## 第三部分：实施计划

### 3.1 实施顺序

```
Step 1: SQLite 触发器表 DDL + 类型定义
  ↓
Step 2: EventBus 事件总线
  ↓
Step 3: TriggerEngine 规则引擎 + TriggerStore
  ↓
Step 4: CronTriggerAdapter 定时触发器
  ↓
Step 5: GameChatTriggerAdapter 游戏聊天触发器
  ↓
Step 6: PluginEventTriggerAdapter 插件事件触发器
  ↓
Step 7: QQTriggerAdapter QQ 渠道触发器
  ↓
Step 8: ActionExecutor 动作执行器
  ↓
Step 9: QQ 完善（群管理工具 + 远程指令 + 主动通知）
  ↓
Step 10: 集成测试
```

### 3.2 详细实施步骤

#### Step 1: SQLite 触发器表 DDL + 类型定义

**文件**：
- `packages/agent-core/src/main/database/database-manager.ts`（修改：追加表 DDL）
- `packages/agent-core/src/main/trigger/types.ts`（新增）

**任务**：
1. 在 `database-manager.ts` 中追加 `event_triggers`、`trigger_logs`、`trigger_schedule` 三张表的 DDL 与索引
2. 创建 `types.ts`，定义 `AgentEvent`、`EventTrigger`、`TriggerRule`、`TriggerAction`、`TriggerLog` 等类型
3. 定义默认配置常量 `DEFAULT_TRIGGER_CONFIG`

**预估工时**：2h

#### Step 2: EventBus 事件总线

**文件**：`packages/agent-core/src/main/trigger/event-bus.ts`（新增）

**任务**：
1. 实现 `publish(event)` 发布事件
2. 实现 `subscribe(filter, handler)` 按条件订阅
3. 实现 `on(eventType, handler)` 按类型订阅
4. 实现事件传递的异步处理，不阻塞发布方

**关键实现要点**：

```typescript
class EventBus {
  private handlers: Array<{ filter: EventFilter; handler: EventHandler }> = [];
  private typeHandlers = new Map<string, Set<EventHandler>>();

  publish(event: AgentEvent): void {
    // 异步分发，不阻塞发布方
    setImmediate(() => {
      for (const { filter, handler } of this.handlers) {
        if (this.matchesFilter(event, filter)) {
          handler(event).catch(err => logger.error('Event handler error', err));
        }
      }
      const typeHandlers = this.typeHandlers.get(event.type);
      if (typeHandlers) {
        for (const handler of typeHandlers) {
          handler(event).catch(err => logger.error('Event handler error', err));
        }
      }
    });
  }
}
```

**预估工时**：2h

#### Step 3: TriggerEngine 规则引擎 + TriggerStore

**文件**：
- `packages/agent-core/src/main/trigger/trigger-engine.ts`（新增）
- `packages/agent-core/src/main/trigger/trigger-store.ts`（新增）

**任务**：
1. 实现 `TriggerStore`：CRUD、加载、日志写入、日志清理
2. 实现 `TriggerEngine`：注册/注销触发器、启动/停止、事件评估
3. 实现规则匹配：keyword / regex / event_type / payload_field / composite
4. 实现冷却检查、最大触发次数检查
5. 事件命中后调用 ActionExecutor

**预估工时**：6h

#### Step 4: CronTriggerAdapter 定时触发器

**文件**：`packages/agent-core/src/main/trigger/adapters/cron-adapter.ts`（新增）

**任务**：
1. 使用 `node-cron` 解析和执行 Cron 表达式
2. 支持绝对时间和间隔调度
3. 重启后从 `trigger_schedule` 表恢复调度
4. 错过的任务可选补偿

**预估工时**：3h

#### Step 5: GameChatTriggerAdapter 游戏聊天触发器

**文件**：`packages/agent-core/src/main/trigger/adapters/game-chat-adapter.ts`（新增）

**任务**：
1. 监听 TCP Server 的 `game_chat` 事件
2. 转换为 `AgentEvent` 并发布到 EventBus
3. 支持 `@机器人` 检测（通过 payload.isAtBot）

**预估工时**：2h

#### Step 6: PluginEventTriggerAdapter 插件事件触发器

**文件**：`packages/agent-core/src/main/trigger/adapters/plugin-event-adapter.ts`（新增）

**任务**：
1. 监听 TCP Server 的 `notify/event` 消息
2. 向 Adapter Core 注册感兴趣的事件类型列表
3. 实现 5s 去重窗口
4. 转换为 `AgentEvent` 并发布

**预估工时**：3h

#### Step 7: QQTriggerAdapter QQ 渠道触发器

**文件**：`packages/agent-core/src/main/trigger/adapters/qq-trigger-adapter.ts`（新增）

**任务**：
1. 在 V10 MessageHandler 中增加触发器入口
2. 桥接消息直接跳过触发器
3. 检测 @机器人、私聊、关键词
4. 权限检查后发布事件

**预估工时**：2h

#### Step 8: ActionExecutor 动作执行器

**文件**：`packages/agent-core/src/main/trigger/action-executor.ts`（新增）

**任务**：
1. 实现 `create_task` 动作：调用 TaskManager.create()
2. 实现 `call_tool` 动作：调用 Pipeline 工具
3. 实现 `send_llm` 动作：调用主 Agent 或 QQ Sub-Agent
4. 实现 `send_qq` 动作：调用 OneBotClient 发送群消息
5. 实现 `store_memory` 动作：调用 MemoryManager.store()
6. 所有动作执行后写入 `trigger_logs`

**预估工时**：4h

#### Step 9: QQ 完善

**文件**：
- `packages/agent-core/src/main/qq-bot/tools/qq_group_manage.ts`（新增）
- `packages/agent-core/src/main/qq-bot/tools/qq_notify.ts`（新增）
- `packages/agent-core/src/main/qq-bot/remote-command-parser.ts`（新增）
- `packages/agent-core/src/main/qq-bot/proactive-notifier.ts`（新增）
- `packages/agent-core/src/main/qq-bot/qq-sub-agent.ts`（修改：注册新工具）

**任务**：
1. 实现 `qq_group_manage` 工具，对接 OneBot 群管理 API
2. 实现 `qq_notify` 工具，支持主动通知
3. 实现远程指令解析器，支持 `/status`、`/task list`、`/restart` 等
4. 实现主动通知器，订阅游戏事件并推送到 QQ 群
5. 在 QQ Sub-Agent 中注册新工具

**预估工时**：8h

#### Step 10: 集成测试

**文件**：
- `packages/agent-core/__tests__/trigger/trigger-engine.test.ts`（新增）
- `packages/agent-core/__tests__/trigger/adapters.test.ts`（新增）
- `packages/agent-core/__tests__/trigger/action-executor.test.ts`（新增）
- `packages/agent-core/__tests__/trigger/qq-integration.test.ts`（新增）

**任务**：
1. 编写 TriggerEngine 规则匹配测试
2. 编写各 Adapter 事件转换测试
3. 编写 ActionExecutor 动作执行测试
4. 编写 QQ 完善功能测试

**预估工时**：5h

### 3.3 任务分配

#### 开发者 A 任务

| # | 任务 | 产出物 | 预计工时 |
|---|------|--------|:--------:|
| A14.1 | EventBus 事件总线 | `src/main/trigger/event-bus.ts` | 2h |
| A14.2 | CronTriggerAdapter | `src/main/trigger/adapters/cron-adapter.ts` | 3h |
| A14.3 | GameChatTriggerAdapter | `src/main/trigger/adapters/game-chat-adapter.ts` | 2h |
| A14.4 | QQTriggerAdapter | `src/main/trigger/adapters/qq-trigger-adapter.ts` | 2h |
| A14.5 | QQ 群管理工具 | `src/main/qq-bot/tools/qq_group_manage.ts` | 3h |
| A14.6 | QQ 主动通知器 | `src/main/qq-bot/proactive-notifier.ts` | 3h |

#### 开发者 B 任务

| # | 任务 | 产出物 | 预计工时 |
|---|------|--------|:--------:|
| B14.1 | SQLite DDL + 类型定义 | `src/main/trigger/schema.sql` + `types.ts` | 2h |
| B14.2 | TriggerStore | `src/main/trigger/trigger-store.ts` | 3h |
| B14.3 | TriggerEngine 规则引擎 | `src/main/trigger/trigger-engine.ts` | 5h |
| B14.4 | PluginEventAdapter + 事件订阅 | `src/main/trigger/adapters/plugin-event-adapter.ts` | 3h |
| B14.5 | ActionExecutor | `src/main/trigger/action-executor.ts` | 4h |
| B14.6 | QQ 远程指令解析器 | `src/main/qq-bot/remote-command-parser.ts` | 2h |
| B14.7 | QQ Sub-Agent 注册新工具 | `src/main/qq-bot/qq-sub-agent.ts` | 1h |
| B14.8 | 模块入口 + 初始化 | `src/main/trigger/index.ts` + `src/main/index.ts` | 1h |

**实施顺序**：B14.1 → A14.1 → B14.2 → B14.3 → A14.2 → A14.3 → B14.4 → A14.4 → B14.5 → A14.5 → A14.6 → B14.6 → B14.7 → B14.8

---

## 第四部分：文件变更清单

### 4.1 新增文件

```
packages/agent-core/src/main/trigger/
├── index.ts                            # 模块导出
├── types.ts                            # 触发器类型定义
├── event-bus.ts                        # 事件总线
├── trigger-engine.ts                   # 规则引擎
├── trigger-store.ts                    # 触发器存储
├── action-executor.ts                  # 动作执行器
└── adapters/
    ├── index.ts                        # 适配器统一导出
    ├── cron-adapter.ts                 # 定时触发器
    ├── game-chat-adapter.ts            # 游戏聊天触发器
    ├── plugin-event-adapter.ts         # 插件事件触发器
    └── qq-trigger-adapter.ts           # QQ 渠道触发器

packages/agent-core/src/main/qq-bot/
├── tools/
│   ├── qq_group_manage.ts              # 群管理工具
│   └── qq_notify.ts                    # 主动通知工具
├── remote-command-parser.ts            # 远程指令解析器
└── proactive-notifier.ts               # 主动通知器

packages/agent-core/__tests__/trigger/
├── trigger-engine.test.ts              # 规则引擎 / EventBus / TriggerStore 测试
├── trigger-adapters.test.ts            # 四种适配器测试
├── action-executor.test.ts             # 动作执行器测试
└── trigger-module.test.ts              # TriggerModule 集成测试

packages/agent-core/__tests__/qq-bot/
├── remote-command-parser.test.ts       # 远程指令解析器测试
└── tools-group-manage.test.ts          # 群管理工具与主动通知工具测试
```

### 4.2 修改文件

| 文件 | 修改内容 |
|------|----------|
| `packages/agent-core/src/main/database/database-manager.ts` | 追加 `event_triggers`、`trigger_logs`、`trigger_schedule` 三张表 DDL 与索引 |
| `packages/agent-core/src/main/qq-bot/qq-sub-agent.ts` | 注册 `qq_group_manage`、`qq_notify` 工具 |
| `packages/agent-core/src/main/qq-bot/message-handler.ts` | 增加 QQ 渠道触发器入口，桥接消息跳过触发器，远程指令路由与权限检查 |
| `packages/agent-core/src/main/qq-bot/onebot-client.ts` | 新增群管理 API（踢人、禁言、设置群名片、审批入群、撤回消息） |
| `packages/agent-core/src/main/index.ts` | 初始化 TriggerModule、设置 `register_tools` / `game_chat` / `event` TCP 通知路由 |
| `packages/agent-core/__tests__/workspace/workspace-manager.test.ts` | 禁用持久化以避免数据库依赖 |
| `packages/agent-core/__tests__/workspace/workspace-handler.test.ts` | 修正实例名称断言 |

---

## 第五部分：测试计划

### 5.1 TriggerEngine 单元测试

| # | 测试用例 | 输入 | 预期结果 |
|---|---------|------|----------|
| 1.1 | 关键词规则匹配 | 事件 payload.message = 'hello'，规则 keyword='hello' | 命中 |
| 1.2 | 正则规则匹配 | 事件 payload.message = 'kill 5 zombies'，规则 regex='kill (\d+) zombies' | 命中并提取数字 |
| 1.3 | 事件类型匹配 | 事件 type='player_hurt'，规则 event_type='player_hurt' | 命中 |
| 1.4 | Payload 字段匹配 | 事件 payload.health=5，规则 payload_field={key:'health', op:'lt', value:10} | 命中 |
| 1.5 | 组合 AND 规则 | 两个条件都满足 | 命中 |
| 1.6 | 组合 OR 规则 | 一个条件满足 | 命中 |
| 1.7 | 冷却检查 | 同一触发器 1s 内触发两次 | 第二次不执行 |
| 1.8 | 最大触发次数 | 设置 maxTriggerCount=3 | 第 4 次不执行 |
| 1.9 | 优先级排序 | 多个触发器命中 | 按 priority 从高到低执行 |
| 1.10 | 禁用触发器 | enabled=false | 不命中 |

### 5.2 Adapter 单元测试

| # | 测试用例 | 适配器 | 输入 | 预期结果 |
|---|---------|--------|------|----------|
| 2.1 | Cron 表达式解析 | Cron | `0 * * * *` | 下一小时整点触发 |
| 2.2 | 绝对时间调度 | Cron | 未来 5s | 5s 后触发 |
| 2.3 | 间隔调度 | Cron | interval=2s | 每 2s 触发 |
| 2.4 | 游戏聊天事件转换 | GameChat | GameChatPayload | AgentEvent source='game_chat' |
| 2.5 | @机器人检测 | GameChat | message 含 '@Alice' | payload.isAtBot=true |
| 2.6 | 插件事件转换 | PluginEvent | PluginEventPayload | AgentEvent source='plugin_event' |
| 2.7 | 插件事件去重 | PluginEvent | 同一事件 3s 内重复 | 只处理一次 |
| 2.8 | QQ @机器人转换 | QQ | @机器人的 QQMessage | AgentEvent source='qq' |
| 2.9 | QQ 私聊转换 | QQ | private 类型 QQMessage | AgentEvent source='qq' |
| 2.10 | 桥接消息跳过 | QQ | 桥接消息 | 不发布事件 |

### 5.3 ActionExecutor 单元测试

| # | 测试用例 | 动作 | 输入 | 预期结果 |
|---|---------|------|------|----------|
| 3.1 | 创建任务 | create_task | action.config 含 task 参数 | TaskManager.create 被调用 |
| 3.2 | 调用工具 | call_tool | action.config 含 toolName | Pipeline 工具被调用 |
| 3.3 | 发送 LLM | send_llm | action.config 含 prompt | LLM 被调用 |
| 3.4 | 发送 QQ | send_qq | action.config 含 group_id | OneBotClient.sendGroupMsg 被调用 |
| 3.5 | 存储记忆 | store_memory | action.config 含 content | MemoryManager.store 被调用 |
| 3.6 | 执行失败记录 | create_task 失败 | TaskManager 抛出异常 | trigger_logs 记录 success=false |

### 5.4 QQ 完善测试

| # | 测试用例 | 功能 | 输入 | 预期结果 |
|---|---------|------|------|----------|
| 4.1 | 踢人 | 群管理 | ADMIN 调用 qq_group_manage kick | OneBot 调用 set_group_kick |
| 4.2 | 禁言 | 群管理 | ADMIN 调用 qq_group_manage mute duration=60 | OneBot 调用 set_group_ban |
| 4.3 | 设置群名片 | 群管理 | ADMIN 调用 qq_group_manage set_card | OneBot 调用 set_group_card |
| 4.4 | 远程指令 status | 远程指令 | ADMIN 发送 /status | 返回状态文本 |
| 4.5 | 远程指令 task list | 远程指令 | ADMIN 发送 /task list | 返回任务列表 |
| 4.6 | 权限不足 | 权限 | BASIC 用户调用 kick | 返回错误 |
| 4.7 | 主动通知 | 通知 | 玩家死亡事件 | 目标群收到通知 |
| 4.8 | 通知模板 | 通知 | 模板 `玩家 {playerName} 死亡` | 正确替换字段 |

### 5.5 集成测试

| # | 测试场景 | 步骤 | 预期结果 |
|---|---------|------|----------|
| 5.1 | 定时触发创建任务 | 1. 创建 cron 触发器<br>2. 等待触发<br>3. 查询任务 | V13 任务表中新增任务 |
| 5.2 | 游戏聊天触发回复 | 1. 配置关键词触发器<br>2. 游戏内发送关键词<br>3. 检查动作 | ActionExecutor 执行 send_qq |
| 5.3 | 插件事件触发通知 | 1. Adapter Core 推送 player_died<br>2. 检查 QQ 群 | 目标群收到死亡通知 |
| 5.4 | QQ @机器人触发任务 | 1. 群聊 @机器人<br>2. 配置触发器创建任务 | 任务表中新增任务 |
| 5.5 | 事件去重 | 1. 5s 内重复推送同一事件<br>2. 检查日志 | trigger_logs 只有一条 |
| 5.6 | 远程指令执行 | 1. ADMIN 发送 /task list<br>2. 检查回复 | 返回任务列表 |

---

## 第六部分：集成检查点

- [x] `event_triggers` / `trigger_logs` / `trigger_schedule` 表创建成功
- [x] EventBus 支持发布/订阅，异步分发不阻塞
- [x] TriggerEngine 支持 keyword / regex / event_type / payload_field / composite 规则
- [x] CronTriggerAdapter 支持 Cron / 绝对时间 / 间隔三种定时方式
- [x] GameChatTriggerAdapter 正确转换游戏聊天事件并检测 @机器人
- [x] PluginEventTriggerAdapter 正确订阅、接收、去重插件事件
- [x] QQTriggerAdapter 正确过滤桥接消息，触发 @机器人 / 私聊 / 关键词
- [x] ActionExecutor 支持 create_task / call_tool / send_llm / send_qq / store_memory
- [x] 触发器配置和日志持久化到 SQLite
- [x] 重启后定时触发器自动恢复
- [x] qq_group_manage 工具可执行踢人、禁言、设置群名片
- [x] 远程指令解析器支持 /status、/task list、/restart
- [x] 主动通知器可将游戏事件推送到指定 QQ 群
- [x] QQ 完善功能仅对 ADMIN / COMMAND 用户开放
- [x] 所有事件触发流程写入日志系统

---

## 第七部分：风险与应对

| 风险 | 影响 | 概率 | 应对措施 |
|------|------|:----:|----------|
| Cron 任务 missed 补偿导致重启后大量任务堆积 | 系统负载突增 | 中 | 补偿数量上限 10 个，超出部分丢弃并记录日志 |
| 事件规则配置错误导致高频触发 | 任务队列爆满 / QQ 刷屏 | 中 | 默认冷却 5s，最大触发次数限制，高频触发自动禁用 |
| QQ 群管理 API 权限不足 | 操作失败 | 中 | 调用前检查机器人群角色，失败时返回明确错误 |
| 插件事件格式不兼容 | 触发器解析失败 | 中 | Adapter Core 与 Agent Core 约定 schema，解析失败时记录日志并丢弃 |
| 事件处理阻塞主流程 | UI 卡顿 / TCP 响应慢 | 低 | 所有事件处理走 setImmediate / Promise，ActionExecutor 使用异步队列 |
| 远程指令被恶意利用 | 安全风险 | 低 | 严格权限控制，敏感指令二次确认，操作日志完整记录 |
| 主动通知消息过多 | QQ 群骚扰 | 低 | 通知合并窗口（5s 内同类事件合并），可配置通知白名单 |
| 触发器与任务系统集成复杂 | 开发延期 | 中 | 先实现 create_task 动作，其他动作逐步扩展 |
