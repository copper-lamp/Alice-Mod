# Alice Mod Core V14 — 事件触发器 + QQ 完善（架构文档）

> 版本：v1.0
> 日期：2026-07-12
> 版本号：V14（第 17 周）
> 对应需求：AC-EVT-01 ~ AC-EVT-04、AC-QQ-07
> 关联文档：[AC-V14-事件触发器与QQ完善.md](AC-V14-事件触发器与QQ完善.md)、[AC-V13-任务系统.md](AC-V13-任务系统.md)、[AC-V10-QQ机器人模块.md](AC-V10-QQ机器人模块.md)

---

## 1. 总体架构

V14 在 Agent Core 内部新增**事件触发器模块（A8）**，并与 V10 QQ 机器人模块、V13 任务系统深度集成。所有外部事件（游戏聊天、插件事件、QQ 消息、定时器）统一经 EventBus 解耦分发，由 TriggerEngine 规则引擎评估匹配，最终通过 ActionExecutor 执行动作。

```
                              ┌─────────────────────────────────────┐
                              │          外部事件源                  │
                              │  Adapter Core │ NapCatQQ │ 系统时钟 │
                              └─────────┬───────────────┬───────────┘
                                        │               │
                     game_chat /        │  group_msg /  │ cron
                     plugin_event       │  private_msg  │
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
│  │  │                    ActionExecutor 动作执行器                │       │   │
│  │  │  create_task · call_tool · send_llm · send_qq · store_memory│       │   │
│  │  └────────────────────────────────────────────────────────────┘       │   │
│  │                                                                        │   │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐    │   │
│  │  │ CronTriggerAdapter│  │ GameChatAdapter │  │ PluginEventAdapter│    │   │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘    │   │
│  │  ┌──────────────────────────────────────────────────────────────┐    │   │
│  │  │                   QQTriggerAdapter                            │    │   │
│  │  └──────────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────┬─────────────────────────────────────┘   │
│                                    │                                          │
│                                    ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │                          V13 任务系统                                  │   │
│  │  TaskManager · TaskScheduler · 执行器                                 │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                                                               │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │                          V10 QQ 机器人模块                             │   │
│  │  OneBotClient · MessageHandler · QQSubAgent · PermissionManager       │   │
│  │  + V14 新增：qq_group_manage · qq_notify · RemoteCommandParser        │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 核心模块职责

| 模块 | 文件 | 职责 |
|------|------|------|
| **EventBus** | `src/main/trigger/event-bus.ts` | 统一事件发布/订阅，支持按类型/来源/工作区过滤，异步分发不阻塞发布方 |
| **TriggerEngine** | `src/main/trigger/trigger-engine.ts` | 加载触发器、评估事件与规则、执行命中动作、处理冷却与最大触发次数 |
| **TriggerStore** | `src/main/trigger/trigger-store.ts` | SQLite CRUD、触发器日志、调度配置持久化 |
| **ActionExecutor** | `src/main/trigger/action-executor.ts` | 执行 create_task / call_tool / send_llm / send_qq / store_memory / none |
| **CronTriggerAdapter** | `src/main/trigger/adapters/cron-adapter.ts` | 基于 node-cron 实现 cron / at / interval 三种调度，支持 missed 补偿 |
| **GameChatTriggerAdapter** | `src/main/trigger/adapters/game-chat-adapter.ts` | 将 Adapter Core 推送的游戏聊天事件转换为 AgentEvent |
| **PluginEventTriggerAdapter** | `src/main/trigger/adapters/plugin-event-adapter.ts` | 将插件事件转换为 AgentEvent |
| **QQTriggerAdapter** | `src/main/trigger/adapters/qq-trigger-adapter.ts` | 将 QQ 消息转换为 AgentEvent，检测 @机器人 / 私聊 |
| **TriggerModule** | `src/main/trigger/index.ts` | 模块入口，组装以上组件，对外提供统一 API |
| **qq_group_manage** | `src/main/qq-bot/tools/qq_group_manage.ts` | QQ 群管理工具：踢人、禁言、设置群名片、审批入群、撤回消息 |
| **qq_notify** | `src/main/qq-bot/tools/qq_notify.ts` | QQ 主动通知工具，支持模板渲染 |
| **RemoteCommandParser** | `src/main/qq-bot/remote-command-parser.ts` | 解析 /status、/task list、/restart、/help 远程指令 |
| **ProactiveNotifier** | `src/main/qq-bot/proactive-notifier.ts` | 订阅事件并推送游戏内重要事件到 QQ 群 |

---

## 3. 核心数据流

### 3.1 事件触发到动作执行

```
事件到达（游戏聊天 / 插件事件 / QQ 消息 / 定时器）
    ↓
TriggerAdapter.handle(rawEvent) → AgentEvent
    ↓
EventBus.publish(event)
    ↓
TriggerEngine.handleEvent(event)
    ↓
遍历触发器 → 规则匹配（source / workspace / rule）
    ↓
命中触发器
    ↓
冷却检查 → 最大触发次数检查
    ↓
ActionExecutor.execute(action, event)
    ├─ create_task → TaskManager.create()
    ├─ call_tool   → ToolDispatcher.callTool()
    ├─ send_llm    → LLM Provider / QQ Sub-Agent
    ├─ send_qq     → OneBotClient.sendGroupMsg()
    └─ store_memory → MemoryManager.store()
    ↓
TriggerStore.logExecution() 写入日志
```

### 3.2 QQ 渠道触发

```
QQ 消息到达
    ↓
OneBotClient → MessageHandler
    ↓
桥接消息？是 → MessageBridge 处理并结束
    ↓
权限检查（PermissionManager.checkPermission）
    ↓
MessageHandler.route() → command / sub_agent
    ↓
QQTriggerAdapter.handle(msg) → AgentEvent
    ↓
EventBus.publish(event) → TriggerEngine 评估
    ↓
命中后执行动作（回复 / 创建任务 / 调用工具）
```

### 3.3 远程指令处理

```
QQ 消息以 / 开头
    ↓
MessageHandler.route() → type='command'
    ↓
MessageHandler.executeCommand()
    ↓
PermissionManager.checkPermission(COMMAND)
    ↓
RemoteCommandParser.execute(command, args, msg)
    ├─ status  → 返回 Agent Core 运行状态
    ├─ task    → 返回任务列表摘要
    ├─ restart → 返回重启提示
    └─ help    → 返回指令列表
```

---

## 4. 数据库设计

### 4.1 新增表

```sql
-- 事件触发器配置表
CREATE TABLE IF NOT EXISTS event_triggers (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL CHECK(source IN ('cron', 'game_chat', 'plugin_event', 'qq')),
  priority INTEGER NOT NULL DEFAULT 5,
  rule_json TEXT NOT NULL,
  action_json TEXT NOT NULL,
  cooldown_seconds INTEGER NOT NULL DEFAULT 0,
  max_trigger_count INTEGER,
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
  event_payload TEXT,
  action_json TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  triggered_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (trigger_id) REFERENCES event_triggers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_trigger_logs_trigger ON trigger_logs(trigger_id);
CREATE INDEX IF NOT EXISTS idx_trigger_logs_event_type ON trigger_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_trigger_logs_triggered_at ON trigger_logs(triggered_at);

-- 定时触发器调度表
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

---

## 5. 关键接口定义

### 5.1 事件总线

```typescript
export interface IEventBus {
  publish(event: AgentEvent): void;
  subscribe(filter: EventFilter, handler: EventHandler): () => void;
  on(eventType: string, handler: EventHandler): () => void;
  clear(): void;
}

export interface AgentEvent {
  id: string;
  type: string;
  source: EventSource;
  workspaceId: string;
  timestamp: number;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}
```

### 5.2 触发器规则

```typescript
export type TriggerRuleType =
  | 'keyword'
  | 'regex'
  | 'event_type'
  | 'payload_field'
  | 'at_bot'
  | 'private_msg'
  | 'cron'
  | 'interval'
  | 'composite'
  | 'always';

export interface TriggerRule {
  type: TriggerRuleType;
  value?: unknown;
  field?: PayloadFieldRule;
  conditions?: TriggerRule[];
  operator?: 'and' | 'or';
}
```

### 5.3 触发器动作

```typescript
export type TriggerActionType =
  | 'create_task'
  | 'call_tool'
  | 'send_llm'
  | 'send_qq'
  | 'store_memory'
  | 'none';

export interface TriggerAction {
  type: TriggerActionType;
  config: Record<string, unknown>;
}
```

### 5.4 触发器适配器

```typescript
export interface TriggerAdapter {
  readonly source: TriggerSource;
  start(): Promise<void>;
  stop(): Promise<void>;
  handle(rawEvent: unknown): AgentEvent | null;
}
```

### 5.5 TriggerModule 对外 API

```typescript
export class TriggerModule {
  async start(): Promise<void>;
  async stop(): Promise<void>;
  publishEvent(event: AgentEvent): void;
  handleRawEvent(source: TriggerSource, rawEvent: unknown): void;
  createTrigger(params: CreateTriggerParams, schedule?: TriggerSchedule): EventTrigger;
  updateTrigger(id: string, params: UpdateTriggerParams): EventTrigger | null;
  deleteTrigger(id: string): boolean;
  getTrigger(id: string): EventTrigger | null;
  listTriggers(options?: ListTriggerOptions): EventTrigger[];
  getTriggerLogs(triggerId: string, limit?: number): TriggerLog[];
  registerTransient(trigger: EventTrigger): void;
}
```

---

## 6. 关键设计决策

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| 事件总线 | 全局 EventEmitter / 自实现 EventBus | **自实现 EventBus** | 轻量、类型安全、支持按 filter 订阅 |
| 定时调度 | node-cron / later / 自实现 | **node-cron** | 稳定成熟，支持时区 |
| 规则引擎 | 硬编码 / JSON 规则 DSL | **JSON 规则 + 组合条件** | 可持久化、LLM 可生成 |
| 动作执行 | 同步 / 异步 | **异步** | 避免阻塞主流程 |
| 插件事件去重 | 内存 / Redis / SQLite | **内存 Map** | 5s 窗口，单机足够 |
| QQ 远程指令 | 独立解析器 / 复用 Sub-Agent | **独立解析器** | 常用指令快速响应 |
| 主动通知 | 轮询 / 事件订阅 | **事件订阅** | 实时性高 |
| 持久化 | 全量持久化 / 仅配置 | **配置 + 日志持久化** | 运行时状态可重建 |

---

## 7. 安全与权限

- QQ 群管理、远程指令等敏感操作仅对 `ADMIN` / `COMMAND` 权限用户开放。
- `MessageHandler.executeCommand` 在调用处理器前再次校验 `COMMAND` 权限。
- 触发器动作 `send_qq` / `call_tool` 等通过依赖注入控制，避免未授权访问。

---

## 8. 可观测性

- 所有触发器执行记录写入 `trigger_logs`，包含事件类型、事件 payload、动作、执行结果、错误信息、触发时间。
- 日志支持按触发器、事件类型、时间范围查询。
- TriggerModule 内置 logger 接口，支持 info / warn / error 分级日志。
