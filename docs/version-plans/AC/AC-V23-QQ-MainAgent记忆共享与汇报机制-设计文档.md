# AC-V23 — QQ Agent 与主 Agent 记忆共享与汇报机制（设计文档）

> 版本：v1.0 (Draft)
> 日期：2026-07-16
> 版本号：V23
> 关联文档：
>
> - [AC-V20-主链路组装-设计文档.md](AC-V20-主链路组装-设计文档.md)（MainAgent 主链路已就绪）
> - [AC-V14-事件触发器与QQ完善-架构文档.md](AC-V14-事件触发器与QQ完善-架构文档.md)（QQ 模块整体架构）
> - [AC-V11-记忆系统v1.md](AC-V11-记忆系统v1.md)（LTM 持久记忆）
> - [AC-V12-记忆系统v2-地图索引.md](AC-V12-记忆系统v2-地图索引.md)（地图索引记忆）
> - [AC-V13-任务系统.md](AC-V13-任务系统.md)（TaskManager 异步任务）
> - 上次调研结论（见对话记录）：V20 文档已规划"QQ Sub-Agent 重构为继承 MainAgent"（§4.10），但**记忆共享与汇报**机制未细化

---

## 第1章 背景

### 1.1 现状

V20 阶段已让"主 Agent"跑通主链路（触发 → LLM → 工具 → 历史持久化），但 QQ Sub-Agent 仍是**独立类**（[qq-sub-agent.ts:214](file:///d:/McAgent/packages/agent-core/src/main/qq-bot/qq-sub-agent.ts#L214)），存在以下问题：

| 缺口 | 现状 | 影响 |
| --- | --- | --- |
| **QQ Agent 不继承 MainAgent** | 独立类，自己调 `modelRouter.resolve` + `provider.chat` | 不复用 LlmRequestScheduler / LLMObserver / 错误分类；不写 ChatHistoryStore |
| **两套独立的对话历史** | QQ 用 `private conversation: ConversationMessage[]`（[qq-sub-agent.ts:220](file:///d:/McAgent/packages/agent-core/src/main/qq-bot/qq-sub-agent.ts#L220)），主 Agent 用 SQLite `chat_history` 表 | 玩家在游戏内 @ Alice 问"刚才 QQ 里有人让我挖矿吗"——主 Agent **完全不知道** |
| **主 Agent 看不到 QQ 来源** | `request_game_action` 只透传 `description: string`（[qq-sub-agent.ts:500-512](file:///d:/McAgent/packages/agent-core/src/main/qq-bot/qq-sub-agent.ts#L500-L512)），不含 QQ 用户、上下文 | 主 Agent 收到"挖矿指令"时无法判断来源、重要性、是否已处理 |
| **没有汇报机制** | `request_game_action` 是 Request/Response 一次性，主 Agent 完成后通过 `mainAgentTaskQueue.complete()` 回写结果 | 主 Agent 在长任务中**主动汇报**（如"开始挖第一层"、"遇到岩浆"、"已挖 32 块"）的能力缺失 |
| **没有跨 Agent 共享记忆** | QQ Agent 的 LTM 写入路径不明；主 Agent 看不到 QQ Agent 看到的玩家上下文 | 玩家在 QQ 说"我叫小明"，主 Agent 不知道；玩家在游戏内"复活"，QQ Agent 不知道 |
| **记忆可写权限不明** | 谁负责写 `memory:game_event` 实体（QQ 触发的游戏事件）？谁负责写 `memory:player_fact`（玩家在 QQ 透露的事实）？ | 双写 / 漏写 / 冲突 |
| **记忆读取路径不明** | 主 Agent 的 PromptBuilder 当前是 `memoryRecall` 钩子（[main-agent.ts:263](file:///d:/McAgent/packages/agent-core/src/main/agent/main-agent.ts#L263)），但 QQ 上下文如何注入 | QQ 上下文要么完全没注入，要么硬塞进 prompt 污染主 Agent 决策 |

### 1.2 设计目标

让"**QQ Agent ↔ 主 Agent**"形成**父子 Agent**（QQ Agent 是子，Main Agent 是父），具体三件事：

1. **共享对话历史**：同一对玩家（QQ 账号 + 游戏玩家），QQ 端和游戏端的对话**互见**——主 Agent 决策时能看见 QQ 上下文，QQ Agent 回复时能看见主 Agent 的历史动作
2. **共享 LTM 记忆**：双方向同一份 SQLite 记忆库读写，事实（`player_fact`）、事件（`game_event`）、摘要（`conversation_summary`）按 (workspaceId, agentId, key) 隔离但不重复存储
3. **子→父主动汇报**：QQ Agent 启动"游戏内操作"后，主 Agent 在执行期间 / 完成时 / 异常时**主动**生成汇报消息，QQ Agent 据此发 QQ 消息

### 1.3 范围声明

| # | 项 | 目标 |
| - | --- | --- |
| 1 | QQ Agent 重构 | `QQAgent extends MainAgent`，复用 MainAgent 主链路 |
| 2 | 共享 ChatHistory | 双 Agent 写同一 `chat_history` 表，按 `source='qq'/'game'` 区分可读 |
| 3 | 共享 LTM | 双 Agent 写同一 `memories` 表（V11），按 `owner_agent_id` 区分来源 |
| 4 | 跨 Agent 上下文注入 | PromptBuilder 加 `peerContext` 注入层，主 Agent prompt 看到 QQ 上下文，QQ Agent prompt 看到游戏上下文 |
| 5 | 汇报通道 | 引入 `AgentReportBus`（事件总线），主 Agent 在长任务阶段发 `report` 事件，QQ Agent 订阅后生成 QQ 消息 |
| 6 | 测试 | 单测覆盖共享历史 / 共享 LTM / 汇报触发；集成测试覆盖完整链路 |

### 1.4 不在本期范围（P1 留待）

- 跨 workspace 的多主 Agent 协同（V20 §2.2 已声明本期不做）
- 端云协同（V20 §2.2 已声明本期不做）
- 记忆的 TTL / 主动遗忘策略
- 多 QQ 账号对应不同玩家身份

---

## 第2章 总体架构

### 2.1 父子 Agent 视图

```
                     ┌────────────────────────────────────┐
                     │        PromptBuilder (V5+V19)      │
                     │  ┌────────────────────────────┐    │
                     │  │ 6 区段 (identity/personality)  │   │
                     │  │ + 7 区段: peer_context         │   │ ← V23 新增
                     │  │   {                          │   │
                     │  │     qq_recent: [...],        │   │
                     │  │     game_recent: [...],      │   │
                     │  │     shared_ltm: [...],       │   │
                     │  │     pending_reports: [...]   │   │
                     │  │   }                          │   │
                     │  └────────────────────────────┘    │
                     └─────────────────┬──────────────────┘
                                       │
                  ┌────────────────────┴────────────────────┐
                  │                                          │
                  ▼                                          ▼
        ┌────────────────────┐                    ┌────────────────────┐
        │   QQ Agent (子)    │                    │  Main Agent (父)   │
        │   extends MainAgent │                    │                    │
        │                    │                    │                    │
        │  source='qq'       │                    │  source='trigger'  │
        │  → 选 qqBotModel   │                    │  → 选 mainModel    │
        │  → 注入 peer       │                    │  → 注入 peer       │
        │  → 工具: qq_*      │                    │  → 工具: game_*    │
        │  → 订阅 reports    │                    │  → 发 reports      │
        └──────────┬─────────┘                    └──────────┬─────────┘
                   │                                         │
                   │         ┌─────────────────┐             │
                   └────────►│ ChatHistoryStore│◄────────────┘
                             │  SQLite (ws+aid) │
                             └────────┬────────┘
                                      │
                             ┌────────▼────────┐
                             │  LTM (V11/V12)  │
                             │ memories 表     │
                             │ map_spatial_grid│
                             └────────┬────────┘
                                      │
                             ┌────────▼────────┐
                             │  AgentReportBus │
                             │  (EventEmitter) │
                             └────────┬────────┘
                                      │
                             ┌────────▼────────┐
                             │  PlayerIdentity │
                             │  (QQ↔Game 映射) │
                             └─────────────────┘
```

### 2.2 关键设计决策

| # | 决策点 | 选项 | 结论 |
| - | --- | --- | --- |
| 1 | QQ Agent 类层级 | A) `extends MainAgent`  B) 持有一个 `MainAgent` 字段（组合） | **A**。组合导致 LLM 调用 / 历史 / 调度都要转发，多一层间接；继承天然复用 |
| 2 | ChatHistory 共享方式 | A) 同一 `chat_history` 表 + `source` 区分  B) 双表 + 互相同步 | **A**。SQLite 事务 + 索引 `idx_chat_history_lookup` 已有，单表无同步问题 |
| 3 | 共享历史可见性 | A) 主 Agent 能读 QQ source  B) QQ Agent 能读 game source  C) 双向 | **C 双向**。但加 `peer_limit` 防膨胀（默认 5 条） |
| 4 | LTM 共享 | A) 共享 `memories` 表  B) 各写各的，定期 sync | **A**。`owner_agent_id` 字段区分来源，读取时按需过滤 |
| 5 | 汇报通道 | A) EventBus  B) 轮询 SQLite  C) 共享 `reports` 表 + 通知 | **A + C 混合**。EventBus 走实时（`MemoryReport` 事件），SQLite 持久化做兜底（QQ Agent 重启后能捞起未消费的 report） |
| 6 | QQ↔Game 玩家身份映射 | A) 启动时静态配置  B) 玩家在游戏内首次 @ Alice 时通过 QQ 邀请码绑定  C) 主 Agent 自动推测 | **A**（本期）。在 `agents.qq_binding.account_id` 关联，运行时通过 `playerIdentity.bind(qqUserId, playerUuid)` 建立 |
| 7 | peer_context 注入粒度 | A) 直接拼字符串  B) 结构化片段（fragment） | **B**。复用 V19 fragment 机制，新增 `peerContextFragment` |
| 8 | 汇报触发条件 | A) 长任务每阶段  B) 完成时  C) 异常时  D) 主 Agent 主动判断重要 | **A + B + C + D**。D 留给 LLM 自己决定（`emit_report` 工具） |

---

## 第3章 详细设计

### 3.1 QQ Agent 重构：extends MainAgent

**位置**：`src/main/qq-bot/qq-agent.ts`（新） + `src/main/qq-bot/qq-sub-agent.ts`（删除或标记 deprecated）

**类签名**：

```ts
/**
 * QQ Agent — MainAgent 的子类，专职处理 QQ 消息
 *
 * 与主 Agent 共享：
 * - ChatHistory（同一 SQLite 表，按 source 区分）
 * - LTM（同一 memories 表，按 owner_agent_id 区分）
 * - PlayerIdentity（QQ 账号 ↔ 游戏玩家 UUID 映射）
 *
 * 与主 Agent 差异：
 * - 默认 source='qq'（自动选 qqBotModel）
 * - 工具集 = MainAgent 工具 ∩ {qq_send, qq_info, qq_group_manage, qq_notify, request_game_action, emit_report}
 * - 默认订阅 AgentReportBus 中的 report 事件
 */
export class QQAgent extends MainAgent {
  private client: OneBotClient | null;
  private permissionManager: PermissionManager;
  private reportSubscriber: AgentReportSubscriber;
  private currentMsg: QQMessage | null = null;

  constructor(deps: QQAgentDeps) {
    super({
      ...deps,
      // 注入 QQ 专属工具 + peerContext 注入器
      // 详见 §3.4
    });
    this.client = deps.client;
    this.permissionManager = deps.permissionManager;
    this.reportSubscriber = new AgentReportSubscriber({
      reportBus: deps.reportBus,
      onReport: (report) => this.handleIncomingReport(report),
      filter: (report) => report.targetAgentId === this.deps.agentId,
    });
  }

  // 主入口：处理一条 QQ 消息
  async handleQQMessage(msg: QQMessage): Promise<QQAgentResult> {
    this.currentMsg = msg;

    // 1. 解析玩家身份（建立/查询 QQ↔Game 映射）
    const identity = this.playerIdentity.resolveByQQ(msg.userId);

    // 2. 调父类 handle（自动选 qqBotModel、写历史、调工具）
    const result = await this.handle({
      source: 'qq',
      prompt: this.formatQQPrompt(msg, identity),
      metadata: {
        qqUserId: msg.userId,
        qqGroupId: msg.groupId,
        qqMessageId: msg.messageId,
        playerUuid: identity?.playerUuid,
      },
    });

    // 3. 提取最终文本回复（来自 finalResponse 或最近 assistant 消息）
    return {
      response: result.finalResponse,
      rounds: result.rounds,
      totalTokens: result.totalTokens,
      error: result.error,
    };
  }

  // 子→父请求游戏操作（替代 request_game_action 工具的底层实现）
  private async requestGameAction(description: string, priority: 'normal' | 'high'): Promise<GameActionResult> {
    const identity = this.currentMsg ? this.playerIdentity.resolveByQQ(this.currentMsg.userId) : null;

    // 通过 MainAgentRegistry 获取主 Agent 实例（同 workspaceId、同 playerUuid）
    const mainAgent = this.deps.mainAgentRegistry.get(
      identity?.workspaceId ?? this.deps.workspaceId,
      identity?.mainAgentId ?? this.deps.mainAgentId,
    );
    if (!mainAgent) {
      return { requestId: '', success: false, summary: '主 Agent 未找到', error: 'MAIN_AGENT_NOT_FOUND', durationMs: 0 };
    }

    // 调主 Agent（带 priority 与 context）
    const result = await mainAgent.handle({
      source: 'trigger',
      prompt: `[QQ 用户 ${this.currentMsg?.userId} 请求] ${description}`,
      metadata: {
        origin: 'qq_agent',
        qqUserId: this.currentMsg?.userId,
        qqGroupId: this.currentMsg?.groupId,
        priority,
        requestId: generateId('req'),
      },
    });

    return {
      requestId: result.metadata?.requestId ?? '',
      success: !result.error,
      summary: result.finalResponse,
      details: result.metadata?.details as string | undefined,
      error: result.error,
      durationMs: result.durationMs,
    };
  }

  // 父→子：处理主 Agent 主动汇报
  private async handleIncomingReport(report: AgentReport): Promise<void> {
    if (!this.currentMsg) return; // 没有活跃 QQ 会话，汇报暂存
    // 生成 QQ 友好格式的简短汇报
    const qqReport = this.formatReportForQQ(report);
    if (qqReport) {
      // 通过 client 发送（不阻塞 QQ Agent 主流程）
      this.client?.sendMessage(this.currentMsg.groupId ?? this.currentMsg.userId, qqReport, this.currentMsg.type).catch(err => {
        console.error('[QQAgent] 发送汇报失败:', err);
      });
    }
  }
}
```

**关键变化**：

1. `extends MainAgent` → 自动获得 `handle()` / `abort()` / `stream()` / `historyStore.append()` / `LLMObserver.wrap()` / `LlmRequestScheduler.schedule()`
2. 私有 `callLLM()` / `handleToolCalls()` / `continueAfterToolCalls()` 全部删除
3. 私有 `conversation: ConversationMessage[]` 字段删除（改为走父类 + `ChatHistoryStore`）
4. `addToConversation()` 改为调父类 / `historyStore.append()`
5. `request_game_action` 工具不再由 LLM 直接调，而是内置方法转发到 MainAgent 实例

---

### 3.2 ChatHistory 共享机制

**位置**：`src/main/chat-history/chat-history-store.ts`（已存在，仅扩展查询）

**数据形状**（现有 `ChatHistoryEntry`）：

```ts
export interface ChatHistoryEntry {
  // ... 现有字段
  source: 'trigger' | 'qq' | 'debug' | 'system';
  // V23 新增：'game' 用于主 Agent 主动生成的动作（与 'trigger' 区分）
  // 'trigger' = TriggerEngine 触发的请求
  // 'game'   = 主 Agent 在 LLM 决策中自然产生的动作
  // 'qq'     = QQ Agent 处理的消息
}
```

**扩展 SQL**（不破坏现有索引）：

```sql
-- 现有索引
CREATE INDEX idx_chat_history_lookup ON chat_history(workspace_id, agent_id, created_at DESC);

-- V23 新增索引：按 source 快速过滤
CREATE INDEX idx_chat_history_source ON chat_history(workspace_id, agent_id, source, created_at DESC);
```

**共享读取 API**（新增到 `ChatHistoryStore` 接口）：

```ts
export interface ChatHistoryStore {
  // ... 现有
  /**
   * 加载 agent 自身历史 + peer 历史的合并结果
   * @param peerSource 对端 source（QQ Agent 调用时传 'game'，主 Agent 调用时传 'qq'）
   * @param peerLimit 对端历史条数上限（避免膨胀）
   */
  loadWithPeer(
    workspaceId: string,
    agentId: string,
    opts: { selfLimit?: number; peerSource?: ChatHistoryEntry['source']; peerLimit?: number } & ChatHistoryLoadOptions,
  ): Promise<{
    self: ChatHistoryEntry[];
    peer: ChatHistoryEntry[];
  }>;

  /**
   * 加载跨 source 的连续上下文（用于 peer_context 注入）
   * 返回的合并结果按时间排序，self / peer 通过 source 区分但顺序保留
   */
  loadMerged(
    workspaceId: string,
    agentId: string,
    opts: { selfLimit?: number; peerSource?: ChatHistoryEntry['source']; peerLimit?: number; mergeWindowMs?: number } & ChatHistoryLoadOptions,
  ): Promise<ChatHistoryEntry[]>;
}
```

**实现要点**：

```ts
// loadWithPeer：两次独立查询（避免复杂 JOIN）
async loadWithPeer(workspaceId, agentId, opts) {
  const selfLimit = opts.selfLimit ?? 20;
  const peerLimit = opts.peerLimit ?? 5;
  const peerSource = opts.peerSource;

  const [self, peer] = await Promise.all([
    this.load(workspaceId, agentId, { ...opts, limit: selfLimit }),
    peerSource
      ? this.loadBySource(workspaceId, agentId, peerSource, { ...opts, limit: peerLimit })
      : Promise.resolve([]),
  ]);

  return { self, peer };
}

// loadBySource（私有辅助）
private async loadBySource(ws, aid, source, opts) {
  return this.db.prepare(`
    SELECT * FROM chat_history
    WHERE workspace_id = ? AND agent_id = ? AND source = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(ws, aid, source, opts.limit ?? 5).reverse().map(rowToEntry);
}
```

**MainAgent / QQAgent 集成**：

- `MainAgent.handle({source:'trigger'})` → 调 `loadMerged(ws, aid, {selfLimit: 20, peerSource: 'qq', peerLimit: 5})`
- `QQAgent.handleQQMessage` → 调 `loadMerged(ws, aid, {selfLimit: 20, peerSource: 'game', peerLimit: 5})`
- peer 上下文以 fragment 形式注入到 PromptBuilder（见 §3.4）

---

### 3.3 LTM 共享机制

**位置**：`src/main/memory/memory-store.ts`（V11 已有）+ `src/main/memory/memory-recall.ts`（V11 已有）

**V11 现状**（[AC-V11-记忆系统v1.md §3.1](file:///d:/McAgent/docs/version-plans/AC/AC-V11-记忆系统v1.md)）：

```sql
CREATE TABLE memories (
  id INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  owner_agent_id TEXT,       -- 已支持 agent 隔离
  key TEXT NOT NULL,
  content TEXT NOT NULL,
  memory_type TEXT,          -- 'player_fact' / 'game_event' / 'conversation_summary'
  importance REAL,
  created_at INTEGER,
  last_accessed_at INTEGER,
  -- ... 其他字段
);
```

**V23 共享策略**：

| memory_type | 写入者 | 读取者 | 共享范围 |
| --- | --- | --- | --- |
| `player_fact` | 任意 Agent | 所有 Agent | 同 workspaceId 下所有 agent |
| `game_event` | MainAgent | QQAgent（peer context 注入） | 同 workspaceId |
| `qq_event` | QQAgent | MainAgent（peer context 注入） | 同 workspaceId |
| `conversation_summary` | 任意 Agent | 同 owner_agent_id | 单 Agent |
| `map_feature` | MainAgent | MainAgent | 单 Agent（V12 地图索引） |

**新增辅助 API**（在 `MemoryStore` 上加，不改 V11 已有 API）：

```ts
export interface MemoryStore {
  // ... V11 已有
  /**
   * 加载 peer 记忆（按 type 过滤、按 importance 排序）
   */
  loadPeerMemories(
    workspaceId: string,
    excludeAgentId: string,
    opts: { types?: string[]; minImportance?: number; limit?: number },
  ): Promise<Memory[]>;

  /**
   * 玩家事实去重查询（player_fact 类型）
   * 同一 key 只返回 importance 最高的一条
   */
  loadPlayerFacts(workspaceId: string, opts: { keys?: string[]; limit?: number }): Promise<Memory[]>;
}
```

**写入规则**：

- `player_fact` 写入时**全局唯一 key**（如 `player_name` / `favorite_food`），QQAgent 在 QQ 中得知的玩家事实与 MainAgent 写入的去重
- `qq_event` / `game_event` 写入时**带 source_agent_id**，读取时按 source 过滤
- `map_feature` 仅 MainAgent 写、读（V12 现状不变）

---

### 3.4 peer_context 注入层

**位置**：`src/main/prompt/builder/prompt-builder.ts`（V5/V19 已有，需扩展）

**V19 Prompt 结构回顾**（[AC-V19 §3.2](file:///d:/McAgent/docs/version-plans/AC/AC-V19-提示词结构优化与用户配置关联-设计文档.md)）：

```
# 6 区段
[1] identity         — 身份
[2] personality      — 个性
[3] behavior_rules   — 行为规则
[4] workflow         — 工作流
[5] tools            — 工具定义
[6] communication    — 沟通边界
```

**V23 在 §6 之后新增 §7**：

```
[7] peer_context     — 跨 Agent 上下文（V23 新增）
    ├─ peer_history  — 对端最近 5 条对话
    ├─ shared_ltm    — 共享玩家事实（player_fact type）
    └─ pending_reports — 待消费的汇报（仅 QQAgent 看到）
```

**实现**：

```ts
// PromptBuilder 新增 BuildParams 字段
export interface BuildParams {
  // ... V19 已有
  peerContext?: {
    /** 对端 source */
    peerSource: 'game' | 'qq';
    /** 对端历史（来自 ChatHistoryStore.loadWithPeer().peer） */
    peerHistory?: ChatHistoryEntry[];
    /** 共享玩家事实（来自 MemoryStore.loadPlayerFacts） */
    sharedFacts?: Memory[];
    /** 待消费汇报（仅 QQAgent，来自 AgentReportBus.consume） */
    pendingReports?: AgentReport[];
  };
}

// PromptBuilder.build 内部追加 fragment
if (params.peerContext) {
  fragments.push({
    name: 'peer_context',
    content: this.formatPeerContext(params.peerContext),
    priority: 7,
    cacheable: false,  // 跨调变化大，不入 prefix cache
    tokenEstimate: this.estimatePeerContextTokens(params.peerContext),
  });
}

private formatPeerContext(ctx: BuildParams['peerContext']): string {
  const parts: string[] = ['## 跨 Agent 上下文\n'];

  if (ctx.peerHistory && ctx.peerHistory.length > 0) {
    parts.push(`### 对端（${ctx.peerSource}）最近对话\n`);
    for (const entry of ctx.peerHistory.slice(-5)) {
      parts.push(`[${formatTime(entry.createdAt)}] ${entry.role}: ${truncate(entry.content, 200)}`);
    }
  }

  if (ctx.sharedFacts && ctx.sharedFacts.length > 0) {
    parts.push(`\n### 共享玩家事实\n`);
    for (const fact of ctx.sharedFacts) {
      parts.push(`- ${fact.key}: ${fact.content}`);
    }
  }

  if (ctx.pendingReports && ctx.pendingReports.length > 0) {
    parts.push(`\n### 待消费汇报\n`);
    for (const report of ctx.pendingReports) {
      parts.push(`- [${report.reportType}] ${truncate(report.summary, 200)}`);
    }
  }

  return parts.join('\n');
}
```

---

### 3.5 汇报机制

**位置**：`src/main/agent/agent-report-bus.ts`（新）

**EventBus 设计**：

```ts
/** 汇报类型 */
export type ReportType =
  | 'task_started'      // 任务开始
  | 'task_progress'     // 任务进行中（带百分比）
  | 'task_milestone'    // 任务阶段（如"已挖到第一层基岩"）
  | 'task_completed'    // 任务完成
  | 'task_failed'       // 任务失败
  | 'task_warning'      // 任务警告（如"耐久度低"）
  | 'player_event'      // 玩家事件（玩家进入/退出/死亡）
  | 'world_event';      // 世界事件（昼夜切换、天气）

export interface AgentReport {
  id: string;                          // UUID
  sourceAgentId: string;               // 主 Agent id
  targetAgentId: string;               // 目标 Agent（QQAgent）id
  workspaceId: string;
  reportType: ReportType;
  summary: string;                     // 简要摘要（QQ 友好）
  details?: string;                    // 详细描述（仅调试）
  metadata?: Record<string, unknown>;  // 自定义数据
  timestamp: number;
  /** 关联的 GameActionRequest id（来自 request_game_action 工具） */
  requestId?: string;
}

export class AgentReportBus extends EventEmitter {
  private sqliteStore: ReportStore;    // SQLite 持久化

  /** 主 Agent 发汇报 */
  emit(report: AgentReport): void;

  /** QQAgent 订阅（按 targetAgentId 过滤） */
  subscribe(
    targetAgentId: string,
    handler: (report: AgentReport) => void,
  ): () => void;  // 返回 unsubscribe

  /** 拉取未消费汇报（QQAgent 重启时） */
  async consumePending(targetAgentId: string, opts?: { limit?: number; sinceTs?: number }): Promise<AgentReport[]>;

  /** 标记已消费 */
  async markConsumed(reportIds: string[]): Promise<void>;
}
```

**SQLite 表**（`reports`，合并到主 schema）：

```sql
CREATE TABLE IF NOT EXISTS agent_reports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_agent_id TEXT NOT NULL,
  target_agent_id TEXT NOT NULL,
  report_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  details TEXT,
  metadata_json TEXT,
  request_id TEXT,
  timestamp INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reports_target
  ON agent_reports(target_agent_id, consumed_at, timestamp DESC);
```

**主 Agent 触发汇报**：

```ts
// MainAgent.handle 内部（接在 tool_calls 完成后、长任务进行中）
private emitReportIfNeeded(type: ReportType, summary: string, details?: string): void {
  this.deps.reportBus.emit({
    id: generateId('rpt'),
    sourceAgentId: this.deps.agentId,
    targetAgentId: this.deps.qqAgentId,  // 配置项
    workspaceId: this.deps.workspaceId,
    reportType: type,
    summary,
    details,
    metadata: this.currentRequestMetadata,
    timestamp: Date.now(),
  });
}
```

**LLM 主动汇报**（`emit_report` 工具）：

```ts
// 新增工具（仅 MainAgent 工具集）
{
  name: 'emit_report',
  description: '当玩家在 QQ 端委托了任务且当前状态需要玩家知晓时调用。' +
               '调用此工具后，QQ 端会自动收到汇报消息。',
  input_schema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['task_started', 'task_progress', 'task_milestone', 'task_completed', 'task_failed', 'task_warning', 'player_event', 'world_event'],
      },
      summary: { type: 'string', description: 'QQ 友好摘要，< 100 字' },
      details: { type: 'string', description: '可选详细描述' },
    },
    required: ['type', 'summary'],
  },
}
```

**实现路径**（对齐 V20 §4.7 BatchToolDispatcher 模式）：

```ts
class EmitReportTool {
  static readonly SCHEMA = { /* 上述 schema */ };

  async execute(args, ctx): Promise<ToolResult> {
    // 1. 解析 reportType
    const report: AgentReport = {
      id: generateId('rpt'),
      sourceAgentId: ctx.agentId,
      targetAgentId: ctx.qqAgentId,  // 从当前 task 上下文取
      workspaceId: ctx.workspaceId,
      reportType: args.type,
      summary: args.summary,
      details: args.details,
      requestId: ctx.requestId,
      timestamp: Date.now(),
    };

    // 2. 写 SQLite（持久化）
    await this.reportStore.append(report);

    // 3. 发 EventBus（实时）
    this.reportBus.emit('report', report);

    return { success: true, data: { reportId: report.id } };
  }
}
```

**QQAgent 接收汇报**：

```ts
class AgentReportSubscriber {
  private buffer: AgentReport[] = [];  // 当前活跃会话 buffer
  private currentMsg: QQMessage | null = null;

  constructor(opts: { reportBus, onReport, filter }) {
    this.unsubscribe = opts.reportBus.subscribe(opts.filter, (report) => {
      if (opts.filter(report)) {
        this.buffer.push(report);
        opts.onReport(report);
      }
    });
  }

  /** PromptBuilder 调用：取出当前会话已 buffer 但未发送的汇报 */
  consumeForPrompt(): AgentReport[] {
    const reports = this.buffer;
    this.buffer = [];
    return reports;
  }

  setCurrentMsg(msg: QQMessage | null) {
    this.currentMsg = msg;
  }
}
```

---

### 3.6 PlayerIdentity（QQ↔Game 玩家映射）

**位置**：`src/main/agent/player-identity.ts`（新）

**数据形状**：

```ts
export interface PlayerIdentity {
  workspaceId: string;
  playerUuid: string;        // Minecraft 玩家 UUID
  playerName: string;        // 当前玩家名
  qqUserId?: string;         // 绑定的 QQ 账号
  qqGroupIds?: string[];     // 绑定的 QQ 群
  mainAgentId: string;       // 该玩家对应的主 Agent id
  qqAgentId: string;         // 该玩家对应的 QQ Agent id
  boundAt: number;
}

export class PlayerIdentityStore {
  /** 通过 QQ 解析玩家身份 */
  resolveByQQ(qqUserId: string): PlayerIdentity | null;

  /** 通过游戏 UUID 解析 */
  resolveByPlayer(playerUuid: string): PlayerIdentity | null;

  /** 建立绑定（启动时静态配置 / 玩家游戏内 @ Alice 通过邀请码） */
  bind(workspaceId: string, qqUserId: string, playerUuid: string, playerName: string): void;

  /** 解绑 */
  unbind(qqUserId: string): void;
}
```

**存储**（SQLite `player_identities` 表，合并到主 schema）：

```sql
CREATE TABLE IF NOT EXISTS player_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  player_uuid TEXT NOT NULL,
  player_name TEXT NOT NULL,
  qq_user_id TEXT,
  qq_group_ids TEXT,           -- JSON 数组
  main_agent_id TEXT NOT NULL,
  qq_agent_id TEXT NOT NULL,
  bound_at INTEGER NOT NULL,
  UNIQUE(workspace_id, player_uuid),
  UNIQUE(workspace_id, qq_user_id)
);
CREATE INDEX IF NOT EXISTS idx_player_identities_qq
  ON player_identities(qq_user_id);
```

**AgentConfig 关联**：

`AgentConfig.qqBinding.accountId`（V14 已有）扩展为 `playerIdentityMainAgentId` 字段：

```ts
// AgentConfig 新增（V23）
interface AgentConfig {
  // ... V20 已有
  /** V23：QQ Agent 配置：绑定的玩家身份（玩家 UUID） */
  playerIdentity?: {
    /** 该 Agent 关联的玩家（QQ Agent 模式下：关联到游戏玩家） */
    boundPlayerUuid: string;
    /** 同 workspace 的主 Agent id（用于 request_game_action 转发） */
    mainAgentId: string;
  };
}
```

---

## 第4章 数据流

### 4.1 QQ Agent 处理消息（完整链路）

```
┌─────────────────────────────────────────────────────────────┐
│ 1. OneBot 收到 QQ 消息                                      │
│    → MessageHandler 解析为 QQMessage                         │
│    → 调 QQAgent.handleQQMessage(msg)                        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. QQAgent.handleQQMessage                                  │
│    ├─ playerIdentity.resolveByQQ(msg.userId) → 玩家身份     │
│    ├─ reportSubscriber.setCurrentMsg(msg)                   │
│    ├─ super.handle({source:'qq', prompt, metadata})         │
│    │   ├─ ModelRouter.resolve → qqBotModel                   │
│    │   ├─ historyStore.loadMerged(ws, aid, peerSource='game')│
│    │   ├─ memoryStore.loadPlayerFacts(ws) + loadPeerMemories │
│    │   ├─ reportSubscriber.consumeForPrompt() → pendingReports│
│    │   ├─ PromptBuilder.build({..., peerContext})            │
│    │   └─ LLM 调用 → 工具（含 request_game_action, emit_report）│
│    └─ return {response, rounds, totalTokens}                │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. request_game_action 工具执行                              │
│    → QQAgent.requestGameAction(description, priority)         │
│    → mainAgentRegistry.get(ws, mainAgentId) → MainAgent    │
│    → mainAgent.handle({source:'trigger', prompt, metadata}) │
│    → 返回 GameActionResult                                   │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. MainAgent 在长任务中（处理 request_game_action 期间）       │
│    → emit_report 工具被 LLM 主动调用                          │
│    → AgentReportBus.emit(report) + ReportStore.append()     │
│    → ReportSubscriber 收到 → 调 handleIncomingReport          │
│    → QQAgent.handleIncomingReport → client.sendMessage      │
│    → 玩家在 QQ 端实时看到"Alice: 已开始挖第一层"               │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. GameAction 完成                                           │
│    → MainAgent 返回 MainAgentResult                          │
│    → QQAgent 收到 result → 注入 LLM 上下文（tool result）     │
│    → LLM 第二轮生成最终回复                                   │
│    → historyStore.append(assistant message, source='qq')    │
│    → client.sendMessage 回复玩家                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 MainAgent 处理 trigger 事件（看到 QQ 上下文）

```
┌─────────────────────────────────────────────────────────────┐
│ 1. TriggerEngine 收到 cron / game_chat 事件                  │
│    → ActionExecutor.executeSendLLM({target:'main'})         │
│    → resolveTarget → mainAgentRegistry.get(ws, isMainAgent) │
│    → mainAgent.handle({source:'trigger', prompt, metadata}) │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. MainAgent.handle（V23 增强）                              │
│    ├─ ModelRouter.resolve → mainModel                        │
│    ├─ historyStore.loadMerged(ws, aid, peerSource='qq')     │
│    │   → 拿到 QQ 端最近 5 条消息                               │
│    ├─ memoryStore.loadPlayerFacts(ws) → 玩家事实             │
│    ├─ PromptBuilder.build({..., peerContext: {              │
│    │     peerSource: 'qq',                                    │
│    │     peerHistory: [...],                                  │
│    │     sharedFacts: [...],                                  │
│    │   }})                                                   │
│    └─ LLM 调用 → 看到 "刚才 QQ 里小明问我有没有铁矿"           │
│       → 决策：主动报告矿储量 / 调用工具挖矿                    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. LLM 决策产出 report（重要事件）                            │
│    → emit_report 工具被调用                                   │
│    → AgentReportBus.emit(report, targetAgentId='qqAgent-1') │
│    → QQAgent 收到（如果在 handleQQMessage 期间）               │
│    → 玩家在 QQ 端实时收到"Alice: 矿脉已发现，储量 23 块"       │
└─────────────────────────────────────────────────────────────┘
```

---

## 第5章 实施分阶段

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| **10.1** | 共享 ChatHistory（loadWithPeer / loadMerged + source 索引） | 单测覆盖；同表 + source 区分可读 |
| **10.2** | 共享 LTM（loadPlayerFacts / loadPeerMemories） | 单测覆盖；player_fact 全局去重 |
| **10.3** | peer_context 注入层（PromptBuilder 扩展 §7） | 单测覆盖；peer 上下文格式正确 |
| **10.4** | AgentReportBus + ReportStore | 单测覆盖；emit / subscribe / consume / persist |
| **10.5** | QQ Agent extends MainAgent | 现有 QQ 测试全过；新增继承测试 |
| **10.6** | PlayerIdentity 映射 | 单测覆盖；bind / resolve 双向 |
| **10.7** | 集成测试 + E2E | 完整链路：QQ 消息 → 主 Agent 决策 → report → QQ 回复 |

---

## 第6章 文件清单

### 6.1 新增

| 文件 | 职责 |
| --- | --- |
| `src/main/qq-bot/qq-agent.ts` | QQ Agent 主类（extends MainAgent） |
| `src/main/agent/agent-report-bus.ts` | 汇报事件总线 |
| `src/main/agent/report-store.ts` | 汇报 SQLite 持久化 |
| `src/main/agent/player-identity.ts` | QQ↔Game 玩家身份映射 |
| `src/main/agent/tools/emit-report-tool.ts` | emit_report 工具实现 |
| `__tests__/agent/agent-report-bus.test.ts` | 单测 |
| `__tests__/agent/player-identity.test.ts` | 单测 |
| `__tests__/qq-bot/qq-agent.test.ts` | 单测（继承父类 + 汇报） |
| `__tests__/chat-history/load-with-peer.test.ts` | 单测 |
| `__tests__/integration/qq-main-shared.test.ts` | 集成测试 |

### 6.2 修改

| 文件 | 变更 |
| --- | --- |
| `src/main/agent/main-agent.ts` | `handle` 内部支持 peer_context 注入 + report emit 钩子 |
| `src/main/chat-history/chat-history-store.ts` | 加 `loadWithPeer` / `loadMerged` + `idx_chat_history_source` |
| `src/main/memory/memory-store.ts` | 加 `loadPeerMemories` / `loadPlayerFacts` |
| `src/main/prompt/builder/prompt-builder.ts` | 加 §7 peer_context 注入层 + `peerContext` BuildParams 字段 |
| `src/main/prompt/types.ts` | `ChatHistoryEntry.source` 加 `'game'` 字面量 |
| `src/main/qq-bot/qq-sub-agent.ts` | 标记 deprecated；保留兼容层 1 个版本 |
| `src/main/qq-bot/integration.ts` | `QQBotIntegration.start` 创建 `QQAgent`（替换 `QQSubAgent`） |
| `src/main/database/database-manager.ts` | 加 `agent_reports` / `player_identities` 表迁移 |
| `src/renderer/src/lib/types.ts` | `AgentConfig.playerIdentity?` 字段 |

### 6.3 删除

| 文件 | 时机 |
| --- | --- |
| `src/main/qq-bot/qq-sub-agent.ts` | 10.5 完成后，集成测试通过后下一版本删除 |
| `src/main/qq-bot/main-agent-queue.ts` | 10.5（被 `requestGameAction` 替代） |

---

## 第7章 风险与未决

| 风险 | 缓解 |
| --- | --- |
| QQ Agent 继承后，私有 `currentMsg` 状态与父类并发安全冲突 | 父类 `handle` 不可重入（用 `inflight` Promise 锁），QQ Agent 串行调用 `handleQQMessage` |
| peer_context 膨胀导致 token 超限 | `peerLimit=5` + `mergeWindowMs=30000`（只取 30s 内对端历史） |
| 主 Agent 决策被 QQ 上下文污染（如"刚才 QQ 里有人骂我"） | peer_context 标注"对端上下文"提示词，让 LLM 区分；新增 `peerContextInfluenceLevel: 'low'\|'high'` 配置（默认 low） |
| report 频发刷屏 QQ | 合并策略：同一 `requestId` 的 `task_progress` 在 5s 内只发最新一条 |
| SQLite 双写竞态（QQ Agent 与 MainAgent 同时写同 agentId） | `chat_history` 用 WAL 模式 + 单 connection 串行 append（V20 §10 已确认） |
| PlayerIdentity 静态配置启动复杂 | 启动时若无绑定，QQ Agent 只处理直接发给"机器人账号"的 QQ 消息，不关联游戏玩家 |
| emit_report 工具被 LLM 滥用（每条都报） | system prompt 明确"仅在玩家需要知道时调用"；加 rate limit（每 session 最多 3 条/min） |
| 旧 QQSubAgent 测试用例迁移成本 | 保留兼容层 1 个版本，标注 deprecated，新旧类并存期间跑两套测试 |

---

## 第8章 验收清单

| # | 项 | 验证方法 |
| - | --- | --- |
| 1 | QQ Agent extends MainAgent | `QQAgent instanceof MainAgent === true` |
| 2 | QQ 与主 Agent 写同一 `chat_history` 表 | 单元测试：QQ Agent 写 → Main Agent 读 → 能看到 |
| 3 | 主 Agent 看到 QQ 最近 5 条 | 单元测试：写 QQ 消息 → 调 MainAgent.handle → prompt 含 QQ 内容 |
| 4 | QQ Agent 看到 game 最近 5 条 | 单元测试：写 game 消息 → 调 QQAgent.handleQQMessage → prompt 含 game 内容 |
| 5 | player_fact 双写去重 | 单元测试：QQ 写 `{key:'name', content:'小明'}` + Main 写同样 → DB 只 1 条 |
| 6 | report emit 实时推送到 QQ | 单元测试：mainAgent 调用 emit_report → mock client.sendMessage 被调 |
| 7 | report 持久化（QQ Agent 重启可拉取） | 单元测试：emit → simulate 重启 → consumePending 返回未消费 |
| 8 | PlayerIdentity bind / resolve 双向 | 单元测试 |
| 9 | 完整链路 E2E | 集成测试：QQ msg → QQAgent → request_game_action → MainAgent → emit_report → QQAgent.sendMessage |
| 10 | 旧 QQSubAgent 兼容层 | 现有 V14 QQ 测试全过 |

---

## 第9章 已确认决策

| # | 原问题 | 结论 |
| - | --- | --- |
| 1 | QQ Agent 类层级（继承 vs 组合）？ | **继承**。MainAgent 主链路已就绪，继承零成本复用；组合需要转发每个方法，引入额外间接层。详见 §3.1 |
| 2 | ChatHistory 共享方式（同表 vs 双表同步）？ | **同表 + source 区分**。SQLite 事务保证一致性；双表 + 同步会引入竞态窗口。详见 §3.2 |
| 3 | LTM 共享粒度？ | **同表 + owner_agent_id 区分**。`player_fact` 全局去重（同 key 取 importance 最高），`game_event` / `qq_event` 按 source 过滤，`conversation_summary` 不共享。详见 §3.3 |
| 4 | 汇报通道（EventBus vs 轮询 vs 共享表）？ | **EventBus + SQLite 持久化混合**。EventBus 走实时；SQLite 兜底 QQ Agent 重启后能拉取未消费的 report。详见 §3.5 |
| 5 | QQ↔Game 玩家身份映射方式？ | **静态配置 + 启动时绑定**（本期）。`player_identities` 表 + `AgentConfig.playerIdentity` 字段。运行时通过 `bind` API 扩展。详见 §3.6 |
| 6 | peer_context 注入粒度？ | **结构化 fragment**（复用 V19 机制），新增 §7 `peer_context` 区段。详见 §3.4 |
| 7 | 汇报触发条件？ | **LLM 主动（emit_report 工具）+ 系统自动（task_started/completed/failed）**。LLM 决定"重要"事件汇报；系统在任务边界自动汇报。详见 §3.5 |
| 8 | 旧 QQSubAgent 兼容策略？ | **保留兼容层 1 个版本**，标注 deprecated；新测试覆盖新类，10.5 完成后下一版本删除旧类。详见 §7 |

---

## 第10章 后续 P1（本期不做）

- 玩家在游戏内通过邀请码绑定 QQ 账号（本期仅静态配置）
- 端云协同（V20 §2.2 已声明本期不做）
- 跨 workspace 的多主 Agent 协同
- 记忆的 TTL / 主动遗忘策略
- 多 QQ 账号对应不同玩家身份
- report 频次智能去重（语义合并："开始挖" + "已挖 5 块" + "已挖 10 块" → "已挖 10 块"）
- PlayerIdentity 的反查 API（按游戏事件反查是否需要通知 QQ）
