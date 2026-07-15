# Alice Mod Core V20 — 主链路组装

> 版本：v0.2 (Draft)
> 日期：2026-07-15
> 版本号：V20
> 适用范围：**仅 JE 侧（adapter-java）**。BE 侧（adapter-bedrock）适配由 BE 侧工程师另行处理，本文档不约束。
> 关联文档：
>
> - [AC-V4-FunctionCallingPipeline.md](AC-V4-FunctionCallingPipeline.md)
> - [AC-V5-PromptEngineering.md](AC-V5-PromptEngineering.md) / [AC-V5-PromptEngineering-优化文档.md](AC-V5-PromptEngineering-优化文档.md)
> - [AC-V6-LLMProvider.md](AC-V6-LLMProvider.md)
> - [AC-V17-提示词模板JSON存储-设计文档.md](AC-V17-提示词模板JSON存储-设计文档.md)
> - [AC-V18-工具注册持久化与变更检测-设计文档.md](AC-V18-工具注册持久化与变更检测-设计文档.md)
> - [AC-V19-提示词结构优化与用户配置关联-设计文档.md](AC-V19-提示词结构优化与用户配置关联-设计文档.md)
> - 上次调研结论（见对话记录）

***

## 第1章 背景

### 1.1 当前状态

V4（FCP）/ V5（Prompt）/ V6（LLM Provider ×4 + ModelRouter）/ V17 / V18 / V19 子模块均已实现且单元测试覆盖完整，但**它们没有拼成一条主链路**。具体缺口：

| 缺口                                                       | 文件                                                                                           | 影响                                      |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------- |
| chat-handler 是 mock                                      | [chat-handler.ts](../../packages/agent-core/src/main/ipc/chat-handler.ts)                    | UI 永远收不到 LLM 回复（但玩家不可 UI 对话，仅影响调试入口）    |
| ProviderRegistry 无实例                                     | [provider-registry.ts](../../packages/agent-core/src/main/llm/registry/provider-registry.ts) | 即使调 LLM 也没模型可用                          |
| FunctionCallingPipeline 未注入 dispatcher/collector         | [pipeline.ts](../../packages/agent-core/src/main/pipeline/pipeline.ts)                       | LLM 响应不走工具调用，FCP 沦为孤岛                   |
| AgentConfig → AgentProfile 无转换层                          | —                                                                                            | PromptBuilder 拿不到 wizard 写入的 persona 数据 |
| Provider 配置存于 agent.llmConfig 而非 DefaultLLMConfigManager | [model-handler.ts](../../packages/agent-core/src/main/ipc/model-handler.ts)                  | 用户在 UI 添加的模型与 LLM 调度脱节                  |
| 对话历史无持久化                                                 | —                                                                                            | 每次重启清空、跨会话无记忆                           |
| 无 LLM 限流调度                                               | —                                                                                            | 多事件并发时易触发 429/限流                        |
| Trigger send\_llm 缺 deps 注入                              | [action-executor.ts](../../packages/agent-core/src/main/trigger/action-executor.ts)          | 事件触发器无法真正调 LLM                          |
| QQ Sub-Agent 与"主 Agent"无共享                               | [qq-sub-agent.ts](../../packages/agent-core/src/main/qq-bot/qq-sub-agent.ts)                 | 两套对话历史/两套 LLM 调用，重复实现                   |

### 1.2 JE 协议对齐基线（V20 文档强约束）

> V20 主链路"工具调用"环节完全对齐 JE 侧（adapter-java）已实现且落地的协议。
> 后续若 BE 侧（adapter-bedrock）需要适配，由 BE 侧自行对齐，不在 V20 范围。

**Adapter Core 角色**：JE 侧是 [TcpClient.java](../../packages/adapter-java/src/main/java/io/alice/mod/adapter/tcp/TcpClient.java)（连 Agent Core 的 27541 端口）。Agent Core 是 Server。

**工具调用方法**：

| 方法                | params 形状                                         | 响应 result 形状                                              | 说明                                                                                                                                   |
| ----------------- | ------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `tool_call`       | `{tool_name, parameters}`                         | `{success, message, duration_ms, data?}`                  | 单调用；JE [WorldContext.java:235-298](../../packages/adapter-java/src/main/java/io/alice/mod/adapter/world/WorldContext.java#L235-L298) |
| `tool_call_batch` | `{calls: [{tool_name, parameters, timeout_ms?}]}` | **JSON 数组**：每个元素 `{success, message, duration_ms, data?}` | 批量调用；JE [TcpClient.java:342-405](../../packages/adapter-java/src/main/java/io/alice/mod/adapter/tcp/TcpClient.java#L342-L405)        |

**JE 侧批处理依赖规则**（由 JE 在收到 batch 后自行分析，Agent Core 侧不重复实现）：

```
1. 移动类工具（move_to / ride / dismount 前缀）一律在首批并行执行；
2. 非移动工具若无前序移动依赖，可与移动工具一起并行；
3. 非移动工具若前序有移动依赖，必须等移动完成；
4. 死锁兜底：退化为串行执行。
```

> 含义：Agent Core 侧的 [BatchScheduler](../../packages/agent-core/src/main/pipeline/batch-scheduler.ts) **继续做依赖分层**用于调度并发/超时/兜底；JE 侧再用上述规则做二次分析（"world 内约束"），最终实际执行按"两端分析的最严格约束"取并集。

**JE 侧错误格式**（`{success: false, error: "REASON", message: "..."}` 或 `{success: false, message: "..."}`）：

| JE error code    | 含义                       | Agent Core 处理                 |
| ---------------- | ------------------------ | ----------------------------- |
| `TOOL_NOT_FOUND` | toolName 不在 ToolRegistry | FallbackManager.skip（不可重试）    |
| `TIMEOUT`        | 单 call 超时                | FallbackManager.retry（重试 1 次） |
| `INTERNAL_ERROR` | JE 内部异常                  | FallbackManager.retry         |
| `TOOL_BROKEN`    | 工具执行环境错误                 | FallbackManager.degrade       |

**JE 侧世界身份**（[WorldIdentity.java](../../packages/adapter-java/src/main/java/io/alice/mod/adapter/world/WorldIdentity.java)）：

- 专用服务器：`<server>/config/mcagent/world_identity.json`
- 集成服务器：`<server>/saves/<worldName>/config/mcagent/world_identity.json`
- 字段：`instanceId`（UUID，绑 world）、`authToken`（24 字符）、`worldName`
- Agent Core 侧 [Workspace](../../packages/agent-core/src/main/workspace/workspace.ts) 通过 `instanceId` ↔ `connectionId` ↔ `workspaceId` 三角关联

**JE 侧心跳 / 重连**（不在 V20 改造范围）：

- Agent Core 发 `ping` 通知（无 id）→ JE 回 `pong` 通知
- JE 断线自动重连（指数退避）

### 1.3 关于 BE 侧

BE 侧（adapter-bedrock）`tool_call_batch` 响应是 `{success: true, data: [...], duration_ms}` 包装（[adapter-bedrock/src/index.ts:408-412](../../packages/adapter-bedrock/src/index.ts#L408-L412)），与 JE 裸数组不一致。**V20 不适配 BE**：BE 端 `tool_call_batch` 暂不工作（V20 阶段仍能跑通但解析会失败），BE 单 `tool_call` 路径不受影响。BE 端对齐由 BE 侧工程师按本节同样的 JE 协议补单测后并入。

### 1.4 设计目标

让"**触发事件 → 主 Agent 决策 → LLM 推理 → 工具执行 → 结果回流**"完整跑通，覆盖 3 条入口：

1. **游戏内玩家聊天** → game-chat-adapter → trigger → send\_llm → MainAgent
2. **定时/状态事件** → cron / plugin-event-adapter → trigger → send\_llm → MainAgent
3. **QQ 消息** → OneBot 客户端 → QQSubAgent (extends MainAgent)

> **重要约束**：玩家不可在 UI 与 Agent 直接对话（已确认），故 chat:send/chat:stream 不在本期范围。

***

## 第2章 范围

### 2.1 本期 P0 包含

| #  | 项                                          | 目标                                                               |
| -- | ------------------------------------------ | ---------------------------------------------------------------- |
| 1  | MainAgent 抽象类                              | 统一主/QQ 两套调用入口                                                    |
| 2  | AgentConfig → AgentProfile Mapper          | 把 wizard 写库的数据转换成 PromptBuilder 消费的数据                            |
| 3  | Provider 配置迁移                              | 改用 DefaultLLMConfigManager 持久化；启动时从 agent.llmConfig 聚合 bootstrap |
| 4  | chat\_history SQLite 表                     | 跨会话持久化对话历史                                                       |
| 5  | LlmRequestScheduler                        | 令牌桶限流 + 并发上限 + 优先级                                               |
| 6  | JSON-RPC Batch Client (Agent Core 侧)       | 实现 batch 协议发到 Adapter Core                                       |
| 7  | BatchToolDispatcher / BatchResultCollector | 把现有 FCP 的 dispatcher/collector 真正接到 TCP batch                    |
| 8  | Trigger send\_llm 注入 MainAgent             | V14 触发器真正能调 LLM                                                  |
| 9  | QQ Sub-Agent 重构                            | 继承 MainAgent，删除重复实现                                              |
| 10 | 集成测试                                       | 端到端串通                                                            |

### 2.2 本期 P0 不包含（保留为后续 P1）

- L2/L3 感知（环境快照 / 事件报告）
- tiktoken + 协议级 prefix cache（OpenAI `prompt_cache_key` / Anthropic `cache_control`）
- UI 面板 chat:send/chat:stream
- 分布式多 Agent Core 实例
- 端云协同（V20 假定单实例）

***

## 第3章 架构

### 3.1 整体数据流

```
┌────────────────────────────────────────────────────────────────────────┐
│                       Agent Core Main Process                          │
│                                                                        │
│  ┌─────────────────┐                                                    │
│  │ Trigger Sources │  (game-chat / cron / plugin-event / qq)            │
│  └────────┬────────┘                                                    │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────┐     ┌─────────────────┐                           │
│  │ TriggerEngine   │────→│ ActionExecutor  │                           │
│  └─────────────────┘     └────────┬────────┘                           │
│                                   │ send_llm / create_task / ...       │
│                                   ▼                                    │
│                         ┌────────────────────┐                         │
│                         │  MainAgent.handle  │ ◄──── QQSubAgent(继承)  │
│                         └─────────┬──────────┘                         │
│                                   │                                    │
│                  ┌────────────────┼────────────────┐                   │
│                  │                │                │                   │
│                  ▼                ▼                ▼                   │
│          ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│          │ LlmRequest   │ │ Prompt       │ │ MemoryRecall │            │
│          │ Scheduler    │ │ Builder      │ │ (V11/V12)    │            │
│          └──────┬───────┘ └──────┬───────┘ └──────┬───────┘            │
│                 │                │                │                    │
│                 └────────────────┴────────────────┘                    │
│                                  │                                     │
│                                  ▼                                     │
│                         ┌────────────────────┐                         │
│                         │ ModelRouter.resolve│                         │
│                         └─────────┬──────────┘                         │
│                                   │                                    │
│                         ┌─────────▼──────────┐                         │
│                         │ BaseProvider.chat  │ (或 chatStream)         │
│                         │  + LLMObserver     │                         │
│                         └─────────┬──────────┘                         │
│                                   │                                    │
│                         ┌─────────▼──────────┐                         │
│                         │ FunctionCalling    │                         │
│                         │ Pipeline.process   │                         │
│                         └─────────┬──────────┘                         │
│                                   │                                    │
│                         ┌─────────▼──────────┐                         │
│                         │ JSON-RPC Batch     │                         │
│                         │ Client  (新)       │                         │
│                         └─────────┬──────────┘                         │
│                                   │                                    │
│                         ┌─────────▼──────────┐                         │
│                         │ ChatHistoryStore   │                         │
│                         │ (持久化)           │                         │
│                         └────────────────────┘                         │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
                                   │ JSON-RPC Batch
                                   ▼
                       Adapter Core (BE / JE)
```

### 3.2 模块依赖图

```
                      ┌──────────────┐
                      │ TriggerEngine│
                      └──────┬───────┘
                             │ send_llm action
                             ▼
┌────────────┐         ┌─────────────┐         ┌──────────────┐
│  QQSubAgent│────────→│  MainAgent  │←────────│  (其他调用者) │
└────────────┘ 继承   └──────┬──────┘         └──────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐   ┌──────────────┐   ┌──────────────┐
│ LlmRequest    │   │  Prompt      │   │  Memory      │
│ Scheduler     │   │  Builder     │   │  Recall      │
│ (新)          │   │  (V5+V19)    │   │  (V11/V12)   │
└───────┬───────┘   └──────┬───────┘   └──────┬───────┘
        │                  │                  │
        └──────────────┬───┴──────────────────┘
                       ▼
              ┌─────────────────┐
              │ ModelRouter +   │
              │ ProviderReg.    │
              │ (V6)            │
              └────────┬────────┘
                       ▼
              ┌─────────────────┐
              │ FunctionCalling │
              │ Pipeline (V4)   │
              └────────┬────────┘
                       ▼
              ┌─────────────────┐
              │ JSON-RPC Batch  │
              │ Client (新)     │
              └────────┬────────┘
                       ▼
                  Adapter Core
```

***

## 第4章 详细设计

### 4.1 MainAgent

**位置**：`packages/agent-core/src/main/agent/main-agent.ts`

**职责**：

- 持有 AgentProfile、ToolRegistry、ChatHistoryStore、可选 MemoryRecall
- 主入口 `handle(event)`：单次多轮（循环到 finish\_reason=stop 或达 maxRounds）
- 流式入口 `stream(chatRequest)`：给 QQ Sub-Agent 用，逐 chunk yield
- 内部：组装 prompt → 调度 LLM → 处理 tool\_calls → 持久化历史
- **根据** **`event.source`** **选择 LLM 模型**：`'trigger' / 'system' → mainModel`，`'qq' / 'debug' → qqBotModel`，`compression` 任务用 `compressionModel`

**类签名**：

```ts
export interface MainAgentDeps {
  /** Agent 配置（wizard 写入，未做映射的原始结构） */
  agentConfig: AgentConfig
  workspaceId: string
  agentId: string
  toolRegistry: ToolRegistry
  promptBuilder: PromptBuilder
  modelRouter: IModelRouter
  providerRegistry: IProviderRegistry
  pipeline: FunctionCallingPipeline
  /** 通过 workspaceId 找到对应 TcpConnection，发 tool_call_batch（见 4.3/4.7） */
  connectionResolver: ConnectionResolver
  historyStore: ChatHistoryStore
  memoryRecall?: MemoryRecallHook  // 可选 P1
  scheduler: LlmRequestScheduler
  observer: ILLMObserver
  maxRounds?: number               // 默认 5
  abortSignal?: AbortSignal
}

export interface MainAgentEvent {
  source: 'trigger' | 'qq' | 'debug' | 'system'
  prompt: string
  metadata?: Record<string, unknown>
}

export class MainAgent {
  constructor(deps: MainAgentDeps)
  async handle(event: MainAgentEvent): Promise<MainAgentResult>
  async *stream(chatRequest: ChatRequest): AsyncIterable<LLMChunk | ToolCallEvent>
  abort(): void
}

export interface ConnectionResolver {
  /** 通过 workspaceId 找出已握手完成的 TcpConnection；找不到抛 NotConnected */
  resolve(workspaceId: string): TcpConnection
}
```

**编排流程（handle 内部）**：

```
1. 选模型：
     modelKey = source === 'qq' || source === 'debug'
                ? 'qqBotModel' : 'mainModel'
     modelSel = deps.agentConfig.llmConfig[modelKey]   // 拿 ModelSelection

2. 构造 BuildParams { workspaceId, userInput, history, state, source }
     history ← historyStore.load(workspaceId, agentId, maxRounds)
     profile ← agentProfileMapper.toProfile(agentConfig)  // 见 4.4

3. prompt = await promptBuilder.build(params)
4. messages = prompt.messages; tools = prompt.tools

5. loop (round = 0; round < maxRounds; round++):
     a. resolved = await scheduler.schedule({ providerId: modelSel.providerId }, async () => {
          return modelRouter.resolve({
            workspaceId, providerId: modelSel.providerId,
            modelId: modelSel.modelId, modelName: modelSel.modelName,
            agentId, source: event.source,
          })
        })
     b. response = await provider.chat(messages, tools, resolved.options)
        （response 由 BaseProvider 自动 wrap observer，详见 V6）
     c. historyStore.append(workspaceId, agentId, {
          role: 'assistant', content: response.message.content,
          tool_calls: response.message.tool_calls,
          finish_reason: response.finish_reason,
        })
     d. if response.finish_reason !== 'tool_calls': break
     e. pipelineResult = await pipeline.process(response, {
          workspaceId, connection: connectionResolver.resolve(workspaceId),
          abortSignal,
        })
        （pipeline 内部走 4.7 BatchToolDispatcher 发 tool_call_batch 到 JE 侧）
     f. messages = pipelineResult.messages (含 tool_result 注入)
     g. historyStore.append(...) for each tool result

6. return MainAgentResult {
     finalResponse: response.message.content,
     rounds, totalTokens, durationMs,
   }
```

**abort**：构造时接受 AbortSignal，每个 await 都检查 `signal.aborted`，通过即抛 `AbortError`。Pipeline 透传给 BatchToolDispatcher，再透传到 TcpConnection.sendRequestAndAwait，最终在 socket 写之前检查 abort。

***

### 4.2 LlmRequestScheduler

**位置**：`src/main/llm/scheduler/llm-request-scheduler.ts`

**职责**：

- 按 provider 维度的令牌桶限流（rps + burst）
- 全局并发上限
- 请求优先级（trigger > qq > debug）
- 指标采集：当前在飞数、队列长度、平均等待

**接口**：

```ts
export type SchedulePriority = 'high' | 'normal' | 'low'

export interface ScheduleRequest {
  providerId?: string
  priority?: SchedulePriority
  estimatedTokens?: number
}

export interface SchedulerStatus {
  inFlight: number
  queueLength: number
  providerStats: Record<string, { tokens: number; capacity: number; nextRefillMs: number }>
}

export interface LlmRequestScheduler {
  schedule<T>(req: ScheduleRequest, fn: () => Promise<T>): Promise<T>
  setProviderRateLimit(providerId: string, rps: number, burst: number): void
  getStatus(): SchedulerStatus
  on(event: 'enqueue' | 'dequeue' | 'reject', listener: (...args: any[]) => void): void
}
```

**实现要点**：

- 内部用一个有界队列（默认 100）+ 每个 provider 一个令牌桶
- `enqueue` 时若队列满 + 优先级 low 则 reject；否则按优先级插入
- worker 循环：取队首 → 等令牌 → 调 fn → 释放令牌
- 与 LLMObserver 联动：每次 schedule 完成 emit `dequeue` 事件，observer 监听后写 metrics

***

### 4.3 ConnectionResolver + TcpConnection.sendRequestAndAwait

> **V20 重命名**：原 V20 草稿叫"JSON-RPC Batch Client"，实际是 Agent Core 作为 **Server** 主动向已连入的 JE **client** 发 `tool_call_batch` JSON-RPC Request 并 await Response。核心改造点在 [TcpConnection](../../packages/agent-core/src/main/tcp/connection.ts) —— 现有 `send(message)` 只发不收，需要加 `sendRequestAndAwait(method, params, timeoutMs): Promise<JsonRpcResponse>`。

**位置**：

- `packages/agent-core/src/main/tcp/connection.ts`（扩展）
- `packages/agent-core/src/main/agent/connection-resolver.ts`（新）

**TcpConnection 新增方法**（改动 [connection.ts:122-133](../../packages/agent-core/src/main/tcp/connection.ts#L122-L133)）：

```ts
export interface PendingRequest {
  resolve: (resp: JsonRpcResponse) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
  method: string
}

export class TcpConnection extends EventEmitter {
  // 现有 ...
  private pendingRequests = new Map<string | number, PendingRequest>()
  private requestIdSeq = 0

  /**
   * 主动向已连入的 Adapter Core 发 JSON-RPC Request 并等待 Response。
   * 用于：tool_call / tool_call_batch / ping（带 id 形式）等 server→client 场景。
   */
  async sendRequestAndAwait(
    method: string,
    params: unknown,
    opts: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<JsonRpcResponse> {
    if (this._state !== ConnectionState.Connected) {
      throw new Error('Connection not ready')
    }
    const id = ++this.requestIdSeq
    const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }
    const timeoutMs = opts.timeoutMs ?? 30_000

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new TimeoutError(`[TcpConnection] request timeout: ${method} (${timeoutMs}ms)`))
      }, timeoutMs)

      const onAbort = () => {
        clearTimeout(timer)
        this.pendingRequests.delete(id)
        reject(new AbortError(`[TcpConnection] request aborted: ${method}`))
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })

      this.pendingRequests.set(id, { resolve, reject, timer, method })

      try {
        this.sendJson(req)   // 现有 sendJson 已实现
      } catch (err) {
        clearTimeout(timer)
        this.pendingRequests.delete(id)
        reject(err)
      }
    })
  }

  /** 复用现有 dispatchMessage 入口，在 handleResponse 时反查 pendingRequests */
  // （修改 handleResponse 内部：把 response 派发给 pendingRequests 中的 resolver）
}
```

**handleResponse 改造**（[connection.ts:223-238](../../packages/agent-core/src/main/tcp/connection.ts#L223-L238)）：

```ts
private handleResponse(response: JsonRpcResponse) {
  this.lastActivity = Date.now()
  const pending = this.pendingRequests.get(response.id as string | number)
  if (pending) {
    clearTimeout(pending.timer)
    this.pendingRequests.delete(response.id as string | number)
    if (response.error) {
      pending.reject(new Error(`[${response.error.code}] ${response.error.message}`))
    } else {
      pending.resolve(response)
    }
    return
  }
  // 兜底：未知 id 的响应写到日志
  this.emit('tcp:orphan-response', response)
}
```

**连接关闭时清理 pending**：

```ts
private handleClosed() {
  for (const [, p] of this.pendingRequests) {
    clearTimeout(p.timer)
    p.reject(new Error('Connection closed'))
  }
  this.pendingRequests.clear()
  // ... 现有清理逻辑
}
```

**ConnectionResolver**（轻量包装，复用 TcpServer 已有 API）：

```ts
// packages/agent-core/src/main/agent/connection-resolver.ts
import type { TcpServer } from '../tcp/tcp-server'
import type { TcpConnection } from '../tcp/connection'
import type { WorkspaceManager } from '../workspace/workspace-manager'

export class NotConnectedError extends Error {
  constructor(workspaceId: string) {
    super(`No connected Adapter Core for workspaceId=${workspaceId}`)
    this.name = 'NotConnectedError'
  }
}

export class ConnectionResolver {
  constructor(
    private tcpServer: TcpServer,
    private workspaceManager: WorkspaceManager,
  ) {}

  resolve(workspaceId: string): TcpConnection {
    // 1) 通过 workspaceId → connectionId（已 handshake 后 workspace.connectionId 必有）
    const ws = this.workspaceManager.getWorkspace(workspaceId)
    if (!ws?.connectionId) throw new NotConnectedError(workspaceId)
    // 2) 走 TcpServer.getConnection（已存在，[tcp-server.ts:77-79](../../packages/agent-core/src/main/tcp/tcp-server.ts#L77-L79)）
    const conn = this.tcpServer.getConnection(ws.connectionId)
    if (!conn?.isConnected) throw new NotConnectedError(workspaceId)
    return conn
  }

  /** 给 trigger 注入用：事件触发时直接通过 instanceId 解析，跳过 workspace 查表 */
  resolveByInstanceId(instanceId: string): TcpConnection | undefined {
    // 走 TcpServer.findByInstanceId（已存在，[tcp-server.ts:82](../../packages/agent-core/src/main/tcp/tcp-server.ts#L82)）
    return this.tcpServer.findByInstanceId(instanceId)
  }
}
```

> **关键现状**：[TcpConnection.handleResponse](../../packages/agent-core/src/main/tcp/connection.ts#L301-L303) 目前是空实现（只 emit 事件），**没有**反查 pendingRequests 的逻辑。§4.3 的改造是给 handleResponse 加 pendingRequests 派发 + 给 sendRequestAndAwait 加 pendingRequests 注册——两块缺一不可。

***

### 4.4 AgentConfig → AgentProfile Mapper

**位置**：`packages/agent-core/src/main/agent/agent-profile-mapper.ts`

**输入**：`AgentConfig`（[types.ts:155-167](../../packages/agent-core/src/renderer/src/lib/types.ts#L155-L167)）

**输出**：`AgentProfile`（[prompt/types.ts:49-76](../../packages/agent-core/src/main/prompt/types.ts#L49-L76)）

**字段映射表**（按 V19 + V20 真实数据形状）：

| AgentConfig 字段路径                                            | AgentProfile 字段                                       | 转换规则                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| `name`                                                      | `name`                                                | 直传                                                          |
| `persona.identity`                                          | `identity`                                            | 直传                                                          |
| `persona.expertise[]`                                       | `expertise`                                           | 直传（已为字符串数组）                                                 |
| `persona.personality[]`                                     | `personality`                                         | 直传                                                          |
| `persona.communicationStyle[]`                              | `communicationStyle`                                  | 直传（V19 字段）                                                  |
| `persona.boundaries[]`                                      | `boundaries`                                          | 直传（V19 字段）                                                  |
| `persona.behaviorRules.core[] + strategy[] + constraints[]` | `rules.core` / `rules.strategy` / `rules.constraints` | 分别映射，三块合并存                                                  |
| `persona.workflowId`                                        | `workflowDescription`                                 | 查 `WORKFLOW_TEMPLATES[workflowId].description`（V19 映射）      |
| `tools.enabledTools`                                        | (传 `excludeTools`)                                    | 取 `Object.keys(enabledTools).filter(k => !enabledTools[k])` |
| `personaPresetId`                                           | (额外 flags)                                            | 用于标记"preset 模式"，影响 rules 合并方式                               |

**容错规则**（与 V19 一致）：

- 字段缺失 → 走 `DEFAULT_AGENT_PROFILE` 对应字段
- `workflowId` 无效 → 落到 `DEFAULT_AGENT_PROFILE.workApproach`
- `behaviorRules` 不存在 → 走 `DEFAULT_AGENT_PROFILE.rules`

**API**：

```ts
import type { AgentConfig } from '../renderer/src/lib/types'
import type { AgentProfile } from '../prompt/types'
import type { WorkflowTemplate } from '../prompt/agent/workflow-templates'

export function mapAgentConfigToProfile(
  config: AgentConfig,
  templates?: { getWorkflowTemplate(id: string): WorkflowTemplate | undefined },
): AgentProfile

export function getExcludeTools(config: AgentConfig): string[]
```

**preset 模式特殊处理**：

- `personaPresetId` 不为空 → 表示用了 persona-preset-manager 内置预设，**不合并** wizard 自定义 personality（避免覆盖）
- `personaPresetId` 为空 + 高级模式 → 全部 wizard 字段生效

**测试覆盖点**：

- 字段全填 → 完整映射
- 仅必填 → 缺失字段全走 DEFAULT
- 高级模式 + preset 都不存在 → 不崩
- workflowId 命中 / 不命中 / 缺失 → 3 个分支
- behaviorRules 各项全填 / 仅 core / 缺失 → 3 个分支
- 工具 exclude 集合在 enabledTools 多种组合下正确

***

### 4.5 Provider 配置迁移 + Bootstrap

**位置**：`packages/agent-core/src/main/llm/bootstrap.ts`（新）

**职责**：启动时从 SQLite 加载所有 AgentConfig + 从 [DefaultLLMConfigManager](../../packages/agent-core/src/main/llm/config/config-manager.ts) 加载所有 ProviderConfig → 交叉引用 → 注册 Provider 实例 → 配置 ModelRouter（按 `agent.llmConfig.{mainModel|qqBotModel|compressionModel}` 三种 key 配 workspace 路由）。

**模型配置数据形状**（实际 [types.ts:353-365](../../packages/agent-core/src/renderer/src/lib/types.ts#L353-L365)）：

```ts
// 在 agents 表存的 llm_config_json 字段
interface AgentLLMConfig {
  mainModel: ModelSelection
  qqBotModel: ModelSelection
  compressionModel: ModelSelection
}
interface ModelSelection {
  providerId: string       // 引用 ProviderConfig.id
  modelId: string          // 引用 ProviderConfig.models[].id
  modelName: string        // 显示名
  sameAsMain?: boolean     // qqBotModel 可标 sameAsMain=true 复用 mainModel
}
```

**ProviderConfig 数据形状**（[DefaultLLMConfigManager](../../packages/agent-core/src/main/llm/config/config-manager.ts) 持久化）：

- 表 `provider_configs`，字段 `id, provider_type, base_url, api_key, default_model, models_json, ...`
- `models_json` 是 `Array<{id, name, contextWindow, supportsFunctionCalling}>`（详见 [model-handler.ts](../../packages/agent-core/src/main/ipc/model-handler.ts) 与 [llm-config.ts](../../packages/agent-core/src/main/llm/config/llm-config.ts)）

**Bootstrap 流程**：

```ts
export async function bootstrapLlmSystem(opts: {
  configManager: DefaultLLMConfigManager
  providerRegistry: IProviderRegistry
  modelRouter: IModelRouter
  agentConfigManager: AgentConfigManager
}): Promise<void> {
  // 1. 加载所有 ProviderConfig → 实例化 Provider
  const providerConfigs = await opts.configManager.listProviders()
  for (const pc of providerConfigs) {
    const ProviderCls = resolveProviderClass(pc.providerType)   // openai/claude/gemini/ollama
    const provider = new ProviderCls({
      baseUrl: pc.baseUrl,
      apiKey: pc.apiKey,
      defaultModel: pc.defaultModel,
      timeout: pc.timeoutMs,
      maxRetries: pc.maxRetries,
    })
    opts.providerRegistry.register(pc.id, provider)
  }

  // 2. 加载所有 AgentConfig → 配置 ModelRouter workspaces 路由
  const agents = await opts.agentConfigManager.list()
  const workspaceRoutes: Record<string, WorkspaceRouteConfig> = {}

  for (const agent of agents) {
    const cfg = (await opts.agentConfigManager.get(agent.id))!
    // 三模型路由
    workspaceRoutes[`${cfg.workspaceId ?? 'default'}:main`] = {
      providerId: cfg.llmConfig.mainModel.providerId,
      modelId: cfg.llmConfig.mainModel.modelId,
      modelName: cfg.llmConfig.mainModel.modelName,
      priority: 10,
    }
    workspaceRoutes[`${cfg.workspaceId ?? 'default'}:qq`] = {
      providerId: cfg.llmConfig.qqBotModel.providerId,
      modelId: cfg.llmConfig.qqBotModel.modelId,
      modelName: cfg.llmConfig.qqBotModel.modelName,
      priority: 5,
    }
    workspaceRoutes[`${cfg.workspaceId ?? 'default'}:compression`] = {
      providerId: cfg.llmConfig.compressionModel.providerId,
      modelId: cfg.llmConfig.compressionModel.modelId,
      modelName: cfg.llmConfig.compressionModel.modelName,
      priority: 1,
    }
  }

  opts.modelRouter.updateConfig({
    default: workspaceRoutes['default:main'],   // 兜底
    workspaces: workspaceRoutes,
    fallbacks: {},   // 留 P1
  })
}
```

**触发时机**：

- 启动 [ipc/index.ts](../../packages/agent-core/src/main/ipc/index.ts) 注册 handler **之前**
- `agent:create` / `agent:update` 后**仅增量**重跑：扫新增或更新的 agent
- `provider:create` / `provider:update` / `provider:delete` 后立即重跑
- 监听 [DefaultLLMConfigManager 的 storage 事件](../../packages/agent-core/src/main/llm/config/config-manager.ts)（如已实现）自动重跑

**修改** **[model-handler.ts](../../packages/agent-core/src/main/ipc/model-handler.ts)**：

- **删除** `mockModels` 数组（[model-handler.ts:135-185](../../packages/agent-core/src/main/ipc/model-handler.ts#L135-L185)）
- 改用 `configManager.listProviders()` 真实数据
- 模型列表查询：`configManager.getProvider(providerId).models`
- "测试连接"：`providerRegistry.get(providerId).healthCheck()`（已有）
- **不再使用** model-handler 自维护的 SQLite（`model_configs` 表），统一改用 `provider_configs`（由 V6 的 [DefaultLLMConfigManager](../../packages/agent-core/src/main/llm/config/config-manager.ts) 管理）

***

### 4.6 chat\_history SQLite 表

**位置**：`src/main/chat-history/chat-history-store.ts`

**Schema**：

```sql
CREATE TABLE IF NOT EXISTS chat_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  source TEXT NOT NULL,                  -- 'trigger' | 'qq' | 'debug' | 'system'
  event_id TEXT,                         -- 关联 trigger event id (可空)
  role TEXT NOT NULL,                    -- 'system' | 'user' | 'assistant' | 'tool'
  content TEXT NOT NULL,
  tool_calls_json TEXT,                  -- JSON
  tool_call_id TEXT,
  token_count INTEGER,
  finish_reason TEXT,                    -- 'stop' | 'length' | 'tool_calls' | 'error'
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_history_lookup
  ON chat_history(workspace_id, agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_history_event
  ON chat_history(event_id);
```

**API**：

```ts
export interface ChatHistoryEntry {
  id?: number
  workspaceId: string
  agentId: string
  source: 'trigger' | 'qq' | 'debug' | 'system'
  eventId?: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCallPart[]
  toolCallId?: string
  tokenCount?: number
  finishReason?: string
  createdAt: number
}

export interface ChatHistoryStore {
  append(entry: ChatHistoryEntry): Promise<void>
  load(workspaceId: string, agentId: string, opts?: { limit?: number; beforeId?: number }): Promise<ChatHistoryEntry[]>
  clear(workspaceId: string, agentId: string, opts?: { beforeId?: number }): Promise<number>
  getStats(workspaceId: string, agentId: string): Promise<{ total: number; oldestAt: number; totalTokens: number }>
}
```

**集成点**：

- MainAgent 启动时 `historyStore.load(...)` 取历史
- MainAgent 每轮 LLM 调用后 `historyStore.append(...)` 写 assistant
- Tool result 写完后 `historyStore.append(...)` 写 tool
- 容量控制：append 时若总数 > maxRounds\*2，触发 trim 旧记录

***

### 4.7 BatchToolDispatcher / BatchResultCollector

**位置**：

- `packages/agent-core/src/main/pipeline/batch-tool-dispatcher.ts`
- `packages/agent-core/src/main/pipeline/batch-result-collector.ts`

**BatchToolDispatcher**（实现 [pipeline/types.ts](../../packages/agent-core/src/main/pipeline/types.ts) 中的 `IToolDispatcher`，对齐 JE 协议）：

```ts
import type { IToolDispatcher, ScheduledBatch, BatchExecuteResult, ToolCallResult } from './types'
import type { ConnectionResolver } from '../agent/connection-resolver'

export class BatchToolDispatcher implements IToolDispatcher {
  constructor(private resolver: ConnectionResolver) {}

  async executeBatch(batch: ScheduledBatch, workspaceId: string): Promise<BatchExecuteResult> {
    const conn = this.resolver.resolve(workspaceId)   // 抛 NotConnectedError 若离线

    // 1. ScheduledBatch.calls[] -> JE 侧 tool_call_batch.calls[] 形状
    const jeCalls = batch.calls.map(c => ({
      tool_name: c.params.tool_name,
      parameters: c.params.parameters,
      timeout_ms: c.params.timeout_ms ?? batch.timeoutMs,
    }))

    // 2. 发 request，等响应（带 batch 层超时 + 5s 网络余量）
    const resp = await conn.sendRequestAndAwait(
      'tool_call_batch',
      { calls: jeCalls },
      { timeoutMs: batch.timeoutMs + 5_000 },
    )

    if (resp.error) {
      return {
        totalDurationMs: 0,
        results: batch.calls.map(c => ({
          id: c.id, success: false,
          error: `[${resp.error!.code}] ${resp.error!.message}`,
          errorCode: 'BATCH_ERROR', durationMs: 0,
        })),
      }
    }

    // 3. 解析 result（**按 JE 协议：裸 JSON 数组**）
    const arr = resp.result as unknown[]
    if (!Array.isArray(arr) || arr.length !== batch.calls.length) {
      throw new Error(`tool_call_batch response mismatch: expected ${batch.calls.length}, got ${arr?.length ?? 0}`)
    }

    // 4. 归一为 ToolCallResult
    const results: ToolCallResult[] = batch.calls.map((c, i) => {
      const r = (arr[i] ?? {}) as { success?: boolean; message?: string; error?: string; data?: any; duration_ms?: number }
      const isErr = r.success === false
      return {
        id: c.id,
        toolName: c.params.tool_name,
        success: !isErr,
        data: isErr ? undefined : (r.data ?? {}),
        error: isErr ? (r.message ?? r.error ?? 'unknown') : undefined,
        errorCode: isErr ? (r.error ?? 'UNKNOWN') : undefined,
        durationMs: typeof r.duration_ms === 'number' ? r.duration_ms : 0,
      }
    })

    return {
      totalDurationMs: results.reduce((s, r) => s + r.durationMs, 0),
      results,
    }
  }

  registerStrategy(_name: string, _strategy: any) {
    // V20 不引入新策略
  }
}
```

> **BE 状态说明**：V20 不适配 BE。BE 端 `tool_call_batch` 仍可调用，但响应是 `{success, data: [...], duration_ms}` 包装，§4.7 解析逻辑按 JE 裸数组处理会失败。BE 端对齐由 BE 侧工程师负责。

**BatchResultCollector**（基于 V4 已有 [result-collector.ts](../../packages/agent-core/src/main/pipeline/result-collector.ts) 改造，**不重写**）：

- 接收 `ScheduledBatch[]`，按 `level` 串行
- 对每层 batch 调 `dispatcher.executeBatch(batch, workspaceId)`
- 应用 `CollectOptions.failFast` / `interLayerDelayMs`
- 收集结果到 `CollectResult`

**集成到 FunctionCallingPipeline**（[pipeline.ts:77-78](../../packages/agent-core/src/main/pipeline/pipeline.ts#L77-L78)）：

> **现状**：`pipeline.dispatcher` 和 `pipeline.collector` 默认就是 `null`（V4 设计本身要求外部注入），只是 V20 之前**没人注入**，所以 `pipeline.process()` 在 LLM 返回 `tool_calls` 时直接抛"dispatcher 未配置"。V20 不需要"删除默认 mock"，只需要在 `bootstrapLlmSystem` 中**真正实例化并注入**即可。

```ts
// src/main/llm/bootstrap.ts
pipeline.setDispatcher(new BatchToolDispatcher(connectionResolver))
pipeline.setCollector(new BatchResultCollector())   // 基于 V4 result-collector 改造
```

- 保留 `DefaultResultInjector`（已有）和 `DefaultFallbackManager`（已有）
- `dispatcher == null` 时 `pipeline.process()` 抛 `PipelineError('DISPATCHER_NOT_CONFIGURED')`，被 MainAgent catch 后转 `MainAgentResult.error = 'DISPATCHER_NOT_CONFIGURED'`

***

### 4.8 Trigger send\_llm 注入 MainAgent

**修改**：[packages/agent-core/src/main/trigger/action-executor.ts](../../packages/agent-core/src/main/trigger/action-executor.ts) 的 `executeSendLLM`

**当前** **`SendLLMActionConfig.target`** **形状**（[trigger/types.ts:134-141](../../packages/agent-core/src/main/trigger/types.ts#L134-L141)）：

```ts
export interface SendLLMActionConfig {
  target: 'main' | 'qq_sub_agent'   // enum，非 workspaceId:agentId
  prompt: string
  includeEventContext?: boolean
}
```

**设计决策（已确认）**：

- **`target`** **保持 enum 不变**——现有 trigger 配置存于 `action_json` 字段（[trigger-store.ts:110-133](../../packages/agent-core/src/main/trigger/trigger-store.ts#L110-L133)），已用 enum 持久化，**改格式会破坏存量数据**
- **不在 action\_json 内部塞 target\_agent\_id**——`EventTrigger` 顶层加 `target_agent_id` 字段，单独列；存量数据该列 NULL 时按"取该 workspace 下任一 agent"兜底
- **`workspaceId`** **已经在** **`EventTrigger`** **顶层**（[types.ts:188-203](../../packages/agent-core/src/main/trigger/types.ts#L188-L203)），不需要再传

**target 解析规则**（`resolveTarget` 函数，注入到 ActionExecutorDeps）：

| target 值         | 解析逻辑                                                                                            | 依赖字段                                 |
| ---------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------ |
| `'main'`         | `agentConfigManager.list().find(a => a.workspaceId === event.workspaceId && a.isMain === true)` | `agents.is_main`（新增）                 |
| `'qq_sub_agent'` | `agentConfigManager.get(trigger.targetAgentId)`                                                 | `event_triggers.target_agent_id`（新增） |
| 解析失败             | `return undefined` → ActionExecutor 返回 `{success: false, error: '无法解析 target'}`                 | —                                    |

**EventTrigger 接口扩展**（[trigger/types.ts](../../packages/agent-core/src/main/trigger/types.ts)）：

```ts
export interface EventTrigger {
  // ... 现有 ...
  /** target='qq_sub_agent' 时指向具体 agent；其他 target 不使用 */
  targetAgentId?: string
}
```

**AgentConfig 接口扩展**（[types.ts:155-167](../../packages/agent-core/src/renderer/src/lib/types.ts#L155-L167)）：

```ts
export interface AgentConfig {
  // ... 现有 ...
  /** workspace 内主 agent（每个 workspace 唯一）；send_llm target='main' 时取此 agent */
  isMain?: boolean
}
```

**Deps 新增**：

```ts
export interface ActionExecutorDeps {
  // ... 现有 ...
  mainAgentProvider?: (params: { workspaceId: string; agentId: string }) => MainAgent | undefined
  resolveTarget?: (target: 'main' | 'qq_sub_agent', event: AgentEvent) => { workspaceId: string; agentId: string } | undefined
}
```

**executeSendLLM 改造**（[action-executor.ts:100-112](../../packages/agent-core/src/main/trigger/action-executor.ts#L100-L112)）：

```ts
private async executeSendLLM(config: SendLLMActionConfig, event: AgentEvent): Promise<ActionResult> {
  const resolved = this.deps.resolveTarget?.(config.target, event)
  if (!resolved) {
    return { success: false, error: `无法解析 send_llm target='${config.target}'` }
  }

  const agent = this.deps.mainAgentProvider?.(resolved)
  if (!agent) {
    return { success: false, error: `未找到 MainAgent: ${resolved.workspaceId}:${resolved.agentId}` }
  }

  // 模板渲染：支持 {{event.payload.xxx}} 占位符（V14 已有）
  const prompt = this.renderTemplate(config.prompt, event)
  const finalPrompt = config.includeEventContext !== false
    ? `${prompt}\n\n事件上下文: ${JSON.stringify(event.payload)}`
    : prompt

  const result = await agent.handle({
    source: 'trigger',
    prompt: finalPrompt,
    metadata: { eventId: event.id, eventType: event.type, triggerSource: event.source },
  })
  return { success: true, data: { response: result } }
}
```

**注册时机**：在 TriggerEngine 初始化时，把 `mainAgentProvider` 注入为 `(p) => mainAgentRegistry.get(p.workspaceId, p.agentId)`，`resolveTarget` 注入为解析函数（按 trigger.targetAgentId / agents.isMain 解析）。

**trigger-store schema 增量**（[trigger-store.ts](../../packages/agent-core/src/main/trigger/trigger-store.ts)）：

```sql
ALTER TABLE event_triggers ADD COLUMN target_agent_id TEXT;       -- target='qq_sub_agent' 时指定
ALTER TABLE agents ADD COLUMN is_main INTEGER NOT NULL DEFAULT 0;  -- 标记主 agent
```

**Schema 迁移**：在 [DatabaseManager](../../packages/agent-core/src/main/database/database-manager.ts) 启动时检测列是否存在，缺则 `ALTER TABLE`。

**存量数据迁移说明**：

- 旧 trigger 配置 `action_json.target` 已经是 enum，**无需转换**
- 旧 `event_triggers.target_agent_id = NULL` + `target='main'`：按 `is_main` 解析（启动时若 workspace 无 `is_main=1` 的 agent，由配置项 `llm.bootstrap.markMainAgentOnStart=true` 触发自动标记第一个为 is\_main）
- 旧 `event_triggers.target_agent_id = NULL` + `target='qq_sub_agent'`：返回解析失败（用户需手动配置 QQ sub-agent 绑定），记入 trigger 日志

***

### 4.9 MainAgentRegistry

**位置**：`packages/agent-core/src/main/agent/main-agent-registry.ts`（新）

**职责**：根据 `(workspaceId, agentId)` 查找/创建 MainAgent 实例；缓存避免重复构造。

```ts
export class MainAgentRegistry {
  private cache: Map<string, MainAgent> = new Map()   // key = `${workspaceId}:${agentId}`

  constructor(private deps: {
    agentConfigManager: AgentConfigManager
    mapper: typeof mapAgentConfigToProfile
    workspaceManager: WorkspaceManager
    promptBuilderFactory: (config: AgentConfig) => PromptBuilder
    modelRouter: IModelRouter
    providerRegistry: IProviderRegistry
    pipeline: FunctionCallingPipeline
    connectionResolver: ConnectionResolver
    historyStore: ChatHistoryStore
    scheduler: LlmRequestScheduler
    observer: ILLMObserver
  }) {}

  /** 命中缓存则返回；未命中则按 AgentConfig 构造并缓存 */
  get(workspaceId: string, agentId: string): MainAgent | undefined
  /** agent 配置变更后清缓存，下一次 get() 重新构造 */
  refresh(agentId: string): void
  invalidate(workspaceId: string, agentId: string): void
  /** 列出所有已缓存的 (workspaceId, agentId) */
  list(): Array<{ workspaceId: string; agentId: string }>
}
```

**注入点**：

- Trigger ActionExecutor：
  - `mainAgentProvider: (p) => registry.get(p.workspaceId, p.agentId)`
  - `resolveTarget`: 按 trigger.target\_agent\_id 字段 / agents.is\_main 字段解析
- QQ Sub-Agent 构造时：`new QQSubAgent(deps, registry.get(workspaceId, agentId))`

***

### 4.10 QQ Sub-Agent 重构

**修改**：[packages/agent-core/src/main/qq-bot/qq-sub-agent.ts](../../packages/agent-core/src/main/qq-bot/qq-sub-agent.ts)

**变化**：

- 改为 `class QQSubAgent extends MainAgent`
- 删除私有 `callLLM()`、`continueAfterToolCalls()`、`addToConversation()`（改为调父类 + 用 ChatHistoryStore）
- 构造时把 QQ 工具（[qq\_send](../../packages/agent-core/src/main/qq-bot/qq_send.ts) / [qq\_info](../../packages/agent-core/src/main/qq-bot/qq_info.ts) / [qq\_group\_manage](../../packages/agent-core/src/main/qq-bot/qq_group_manage.ts) / [qq\_notify](../../packages/agent-core/src/main/qq-bot/qq_notify.ts) / request\_game\_action）通过 `extraTools` 注入到父类
- systemPrompt = MainAgent systemPrompt + QQ 场景片段（追加 `fragments[].name='qq_scenario'`）
- **QQ Sub-Agent 调用时 MainAgent 自动选** **`qqBotModel`**（4.1 流程 step 1）
- 保留事件发射（reply / request\_game\_action）逻辑，但改为调父类 hook

```ts
export class QQSubAgent extends MainAgent {
  private client: OneBotClient | null
  private currentMsg: QQIncomingMessage | null = null

  constructor(deps: MainAgentDeps & { client: OneBotClient }) {
    super({
      ...deps,
      // 注入 QQ 场景片段
      agentConfig: {
        ...deps.agentConfig,
        persona: {
          ...deps.agentConfig.persona,
          // 把 QQ 场景片段作为一个自定义 personality 条目
          personality: [
            ...(deps.agentConfig.persona.personality ?? []),
            '你正在通过 QQ 与用户交流，回复需简洁（QQ 消息 < 500 字），善用 emoji，保持友好。',
          ],
        },
      },
    })
    this.client = deps.client
  }

  // 暴露给 message-bridge 调用；source='qq' → 自动走 qqBotModel
  async handleQQMessage(msg: QQIncomingMessage): Promise<QQSubAgentResult> {
    this.currentMsg = msg
    const result = await this.handle({
      source: 'qq',
      prompt: this.formatQQPrompt(msg),
      metadata: { userId: msg.userId, groupId: msg.groupId, messageId: msg.messageId },
    })
    return this.toQQResult(result)
  }
}
```

> **关于 tool 集合**：QQ 工具（qq\_send 等）当前是 Agent Core 内部的 [tool 实现](../../packages/agent-core/src/main/qq-bot/)，V20 需要把它们注册到对应 agent 的 `tools.enabledTools` 列表中才能被 LLM 看到（ToolRegistry 按 agent 隔离）。具体注入路径：QQ Bot 注册成功时，写 `agent.qqBinding` → `agentConfigManager.update(agentId, {tools: {enabledTools: {...enabled, qq_send: true, ...}}})`。

***

## 第5章 配置

### 5.1 AgentConfig.llmConfig 形状（实际已存在）

存于 `agents.llm_config_json` 字段（[agent-config-manager.ts:90-100](../../packages/agent-core/src/main/agent/agent-config-manager.ts#L90-L100)）。形状见 [types.ts:353-365](../../packages/agent-core/src/renderer/src/lib/types.ts#L353-L365)：

```ts
// 真实形状（V16 wizard 写入）
export interface AgentLLMConfig {
  mainModel: ModelSelection
  qqBotModel: ModelSelection
  compressionModel: ModelSelection
}
export interface ModelSelection {
  providerId: string       // 引用 ProviderConfig.id
  modelId: string          // 引用 ProviderConfig.models[].id
  modelName: string        // 显示名
  sameAsMain?: boolean     // qqBotModel 可标 sameAsMain=true 复用 mainModel
}
```

**V20 仅做使用侧改造，不改 wizard schema**：

- Bootstrap 读取时按 `mainModel/qqBotModel/compressionModel` 三 key 分别配 ModelRouter
- MainAgent 按 `event.source` 选 key（4.1 流程图 step 1）
- model-handler 删除 mockModels、改读 ProviderConfig

### 5.2 全局 KV 配置

存于 `agent_core_settings` 表（已存在）：

| key                                   | 类型   | 默认                                | 说明                                                   |
| ------------------------------------- | ---- | --------------------------------- | ---------------------------------------------------- |
| `llm.scheduler.maxConcurrent`         | int  | 10                                | 全局并发上限                                               |
| `llm.scheduler.providerRateLimits`    | JSON | `{"openai":{"rps":5,"burst":10}}` | 令牌桶配置（key 为 providerType，不是 providerId）              |
| `llm.scheduler.queueSize`             | int  | 100                               | 队列上限                                                 |
| `llm.history.maxRounds`               | int  | 30                                | 每 agent 保留轮数                                         |
| `llm.history.maxTokens`               | int  | 80000                             | 历史 token 上限                                          |
| `llm.bootstrap.autoRegisterProviders` | bool | true                              | 启动时自动注册                                              |
| `llm.pipeline.maxRounds`              | int  | 5                                 | MainAgent 单次最多 LLM 轮数                                |
| `llm.bootstrap.markMainAgentOnStart`  | bool | true                              | 启动时若某 workspace 无 is\_main agent，自动标记第一个为 is\_main=1 |

***

## 第6章 错误处理

### 6.1 错误处理矩阵

| 场景                                               | 处理路径                                                                                                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider 401/403                                 | BaseProvider 不重试，直接抛 `ProviderError` → ModelRouter 自动 fallback → MainAgent 记录到 history 标 error                                                      |
| Provider 429                                     | BaseProvider 按 Retry-After 头重试 → 仍失败则抛 → FallbackHandler 接管                                                                                         |
| Provider 超时                                      | BaseProvider 重试 3 次 → FallbackHandler 降级                                                                                                            |
| Scheduler 队列满 + low 优先级                          | reject 抛 `SchedulerRejectError` → Trigger 记录到 trigger 事件日志                                                                                          |
| World 离线（ConnectionResolver 抛 NotConnectedError） | Pipeline 整批失败 → MainAgent 记录到 history + return `MainAgentResult.error = 'WORLD_OFFLINE'` → Trigger 标记到日志                                            |
| JE 侧 Tool `TIMEOUT`                              | FallbackManager.retry 1 次                                                                                                                           |
| JE 侧 Tool `TOOL_NOT_FOUND`                       | FallbackManager.skip（不可重试），注入 tool\_result `{success: false, error: 'TOOL_NOT_FOUND'}`                                                              |
| JE 侧 Tool `INTERNAL_ERROR`                       | FallbackManager.retry 1 次，仍失败 degrade                                                                                                               |
| JE 侧 Tool `TOOL_BROKEN`                          | FallbackManager.degrade 一次，仍失败 skip                                                                                                                 |
| Tool 调用超时（batch 层）                               | BatchResultCollector 标记 `cancelled: true` → Pipeline 继续                                                                                             |
| Tool 调用失败                                        | FallbackManager 重试 → Degrade → skip                                                                                                                 |
| JSON 解析失败                                        | ValidatorMiddleware 拒绝并要求 LLM 重试                                                                                                                    |
| LLM 返回 length 截断                                 | finish\_reason='length' → MainAgent 决定续写（默认不续，标 truncated=true）                                                                                     |
| LLM 返回 tool\_calls 含 tool 已被 JE 侧拒绝              | `success=false` 注入到 messages，LLM 下一轮决定如何继续                                                                                                          |
| 用户强制停止                                           | AbortSignal 穿透：MainAgent → BaseProvider.chat → Pipeline → BatchToolDispatcher → TcpConnection.sendRequestAndAwait；任一 await 检查到 abort 立刻抛 AbortError |

### 6.2 JE 协议错误码（BatchToolDispatcher 映射）

| JE 响应字段                                         | Agent Core 处理                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| `resp.error.code = -32601` METHOD\_NOT\_FOUND   | **整批失败**：所有 call 标 errorCode='METHOD\_NOT\_FOUND'（不应发生，V20 启动时握手校验） |
| `resp.error.code = -32005` TOOL\_TIMEOUT        | 与"Tool TIMEOUT"等价                                                   |
| `resp.error.code = -32603` INTERNAL\_ERROR      | 整批失败：所有 call 标 errorCode='INTERNAL\_ERROR'                          |
| `resp.error.code = -32002` NOT\_AUTHENTICATED   | 整批失败：触发 ConnectionResolver 标记此 connection 为待重连                      |
| `resp.error.code` 其他                            | 整批失败：error 透传                                                       |
| 单元素 `{success: false, error: 'TIMEOUT'}`        | 该 call 单独标 timeout                                                  |
| 单元素 `{success: false, error: 'TOOL_NOT_FOUND'}` | 该 call 单独标 not\_found                                               |
| 单元素 `{success: false, error: 'INTERNAL_ERROR'}` | 该 call 单独标 internal\_error                                          |
| 单元素 `{success: true, data: null}`               | 该 call 视为成功（data=空）                                                 |

### 6.3 AbortError 类型

```ts
export class AbortError extends Error { name = 'AbortError' }
export class TimeoutError extends Error { name = 'TimeoutError' }
export class NotConnectedError extends Error { name = 'NotConnectedError' }
```

统一在 `packages/agent-core/src/main/tcp/errors.ts` 导出（新增），所有模块通过这个区分 abort/timeout/not-connected。

***

## 第7章 测试策略

### 7.1 单元测试

| 模块                      | 覆盖点                              |
| ----------------------- | -------------------------------- |
| `LlmRequestScheduler`   | 令牌桶、并发上限、优先级排队、限流拒绝              |
| `JSON-RPC Batch Client` | codec、超时、重试、并发 batch、错误关联        |
| `AgentProfileMapper`    | 字段映射、缺失 fallback、workflowId 解析   |
| `ChatHistoryStore`      | append/load/clear 边界、容量控制        |
| `BatchToolDispatcher`   | 单/多 call、超时透传、错误格式               |
| `BatchResultCollector`  | batch 切分、并发调度、结果归集               |
| `MainAgent`             | 多轮迭代、abort、history 持久化、prompt 拼接 |
| `QQSubAgent`            | 继承父类、QQ 工具合并、事件发射                |

### 7.2 集成测试

- 启动 → bootstrapLlmSystem → 验证 Provider 实例已注册、Router 配置已加载
- Trigger send\_llm → MainAgent → mock LLM → 验证 chat\_history 落库、Tool 走 batch 通道
- QQSubAgent.handleQQMessage → 验证 tool\_calls 走父类 + 事件正确发射
- AbortSignal 透传：发起后立即 abort，验证所有 await 快速抛 AbortError

### 7.3 E2E（mock Adapter Core TCP server）

- 起一个 mock TCP server 模拟 BE 端 batch 协议
- 触发 cron → send\_llm → MainAgent → mock LLM 返回 tool\_call → batch 发送 → mock server 响应 → history 落库 → MainAgent 返回

***

## 第8章 实施分阶段

| 阶段      | 内容                                                                 | 验收                             |
| ------- | ------------------------------------------------------------------ | ------------------------------ |
| **9.1** | AgentProfileMapper + ChatHistoryStore + bootstrapLlmSystem         | 单测全过；启动加载 1 个 mock agent 不报错   |
| **9.2** | LlmRequestScheduler                                                | 单测覆盖令牌桶、并发、优先级；集成到 MainAgent   |
| **9.3** | JSON-RPC Batch Client + BatchToolDispatcher + BatchResultCollector | 与 mock TCP server 端到端联通        |
| **9.4** | MainAgent 主体                                                       | 多轮迭代 + history 持久化 + abort 透传  |
| **9.5** | Trigger send\_llm 注入 MainAgent + MainAgentRegistry                 | cron 触发后能看到 LLM 调 + history 落库 |
| **9.6** | QQSubAgent 重构继承 MainAgent                                          | 现有 QQ 测试全过；新增测试覆盖 QQ 场景        |
| **9.7** | 集成测试 + E2E                                                         | 启动 → 触发 → 工具执行 → 落库全跑通         |

***

## 第9章 文件清单

### 9.1 新增

| 文件                                                               | 职责                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| `src/main/agent/main-agent.ts`                                   | MainAgent 抽象类                                                       |
| `src/main/agent/main-agent-registry.ts`                          | MainAgent 实例缓存与查找                                                   |
| `src/main/agent/agent-profile-mapper.ts`                         | AgentConfig → AgentProfile 转换                                       |
| `src/main/agent/connection-resolver.ts`                          | workspaceId → TcpConnection 解析                                      |
| `src/main/llm/scheduler/llm-request-scheduler.ts`                | 限流调度器                                                               |
| `src/main/llm/scheduler/types.ts`                                | 调度器类型                                                               |
| `src/main/llm/bootstrap.ts`                                      | 启动时 Provider/Router bootstrap                                       |
| `src/main/chat-history/chat-history-store.ts`                    | chat\_history 表 + DAO                                               |
| `src/main/chat-history/schema.sql`                               | 表结构（合并到主 schema）                                                    |
| `src/main/pipeline/batch-tool-dispatcher.ts`                     | FCP Dispatcher 实现（对齐 JE 协议）                                         |
| `src/main/pipeline/batch-result-collector.ts`                    | FCP Collector 实现                                                    |
| `src/main/tcp/errors.ts`                                         | AbortError / TimeoutError / NotConnectedError                       |
| `src/main/agent/__tests__/main-agent.test.ts`                    | 单测                                                                  |
| `src/main/agent/__tests__/agent-profile-mapper.test.ts`          | 单测                                                                  |
| `src/main/agent/__tests__/connection-resolver.test.ts`           | 单测                                                                  |
| `src/main/llm/scheduler/__tests__/llm-request-scheduler.test.ts` | 单测                                                                  |
| `src/main/llm/__tests__/bootstrap.test.ts`                       | 单测                                                                  |
| `src/main/chat-history/__tests__/chat-history-store.test.ts`     | 单测                                                                  |
| `src/main/tcp/__tests__/connection-send-request.test.ts`         | 单测 TcpConnection.sendRequestAndAwait                                |
| `src/main/pipeline/__tests__/batch-tool-dispatcher.test.ts`      | 单测（mock TcpConnection）                                              |
| `src/main/__tests__/integration/main-pipeline.test.ts`           | 集成测试                                                                |
| `src/main/__tests__/integration/je-mock-tcp-server.ts`           | E2E 用 mock JE server                                                |
| `src/main/__tests__/integration/je-mock-tcp-server.test.ts`      | E2E：cron → send\_llm → tool\_call\_batch → mock server → history 落库 |

### 9.2 修改

| 文件                                          | 变更                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------- |
| `src/main/tcp/connection.ts`                | 加 `sendRequestAndAwait` 方法 + `handleResponse` 派发 + `handleClosed` 清理 |
| `src/main/ipc/index.ts`                     | 注册 bootstrapLlmSystem + ConnectionResolver                           |
| `src/main/llm/index.ts`                     | 导出 scheduler                                                         |
| `src/main/ipc/model-handler.ts`             | 删除 mockModels，改用 DefaultLLMConfigManager                             |
| `src/main/trigger/action-executor.ts`       | executeSendLLM 走 MainAgent + resolveTarget                           |
| `src/main/trigger/types.ts`                 | ActionExecutorDeps 加 mainAgentProvider + resolveTarget               |
| `src/main/trigger/trigger-store.ts`         | 加 target\_agent\_id 字段 + EventTrigger 接口                             |
| `src/main/agent/agent-config-manager.ts`    | 加 is\_main 字段读取/写入；ensureLoaded 加载                                   |
| `src/main/database/database-manager.ts`     | schema 迁移：ALTER TABLE 加 is\_main / target\_agent\_id                 |
| `src/main/qq-bot/qq-sub-agent.ts`           | 改为 extends MainAgent，删除私有 callLLM                                    |
| `src/main/qq-bot/integration.ts`            | 注入 MainAgentRegistry                                                 |
| `src/main/pipeline/index.ts`                | 导出 BatchToolDispatcher / BatchResultCollector                        |
| `src/main/pipeline/pipeline.ts`             | 移除默认 mock dispatcher，强制要求 setDispatcher                              |
| `src/main/prompt/builder/prompt-builder.ts` | 接受 historyStore 注入（可选）                                               |
| `src/main/workspace/workspace-manager.ts`   | 暴露 connectionId 关联（已有）                                               |

***

## 第10章 风险与未决

| 风险                                                  | 缓解                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| AgentConfig 老数据字段缺失                                 | mapper 容错 + 完整单测覆盖                                                |
| Provider 限流参数估算不准                                   | 启动时按 providerType 默认值 + 允许 dry-run 探测                             |
| **JE 协议响应 vs BE 协议响应差异**                            | V20 阶段对齐 JE（裸数组）；BE 端 `tool_call_batch` 暂不工作；BE 单 `tool_call` 仍可用 |
| **TcpConnection.sendRequestAndAwait 是新基础设施**        | 完整单测覆盖：正常响应、超时、abort、orphan response、连接断开                         |
| chat\_history 增长                                    | 按 workspace+agent 滚动清理，超过 maxRounds 删除                            |
| MainAgent 缓存失效                                      | agent:create/update 后调 registry.refresh 清缓存；Bootstrap 重跑时整体重建     |
| 限流 + 优先级组合复杂度                                       | 单测覆盖关键组合；行为出问题可临时关闭优先级                                            |
| QQ Sub-Agent 继承破坏现有逻辑                               | 保留旧 QQSubAgent 公共 API（`callLLM` 标记 deprecated），类内重写而非删字段          |
| **`is_main`** **标记在多 agent 冲突**                     | 启动时检查 workspace 内 is\_main 唯一性，重复时报警 + 取第一个                       |
| **`target_agent_id`** **与** **`is_main`** **状态不同步** | Bootstrap 时校验：所有 trigger.target\_agent\_id 引用合法 agentId           |
| **同步** **`qqBinding → enabledTools`** **注入**        | QQ Bot 注册/解绑时原子更新 agent.qqBinding 和 tools，避免脏读                    |
| **abort 跨多个 await 透传**                              | 顶层 AbortController 一次性透传；每个 await 都检查 signal.aborted              |
| **chat\_history append 与并发**                        | SQLite WAL 模式 + 单 connection 串行 append                            |

***

## 第11章 后续 P1（本期不做）

- L2/L3 感知（环境快照 + 事件报告）
- tiktoken + 协议级 prefix cache（OpenAI `prompt_cache_key` / Anthropic `cache_control`）
- UI 面板 chat:send/chat:stream（玩家无法 UI 对话已确认）
- 端云协同 / 多 Agent Core 实例分布式
- 主动决策型 trigger（状态变化自动决策 LLM）的可观测面板

***

## 第12章 验收清单

| #  | 项                                              | 验证方法                             |
| -- | ---------------------------------------------- | -------------------------------- |
| 1  | 启动后 ProviderRegistry 含所有 agent 配置的 provider    | `providerRegistry.getAll()` 输出非空 |
| 2  | cron 触发 → send\_llm → MainAgent 调 LLM          | 单测 mock LLM + E2E mock TCP       |
| 3  | LLM 返回 tool\_call → batch 发送到 mock server      | E2E                              |
| 4  | chat\_history 落库可查                             | sqlite3 CLI 查询                   |
| 5  | 同一 provider rps 超限时排队                          | 限流单测                             |
| 6  | 玩家聊天 → game-chat-adapter → trigger → send\_llm | E2E                              |
| 7  | QQ 消息 → QQSubAgent → 复用 MainAgent              | 集成测试                             |
| 8  | 强制停止时所有 await 快速抛 AbortError                   | abort 单测                         |
| 9  | 限流配置可在 agent\_core\_settings 表修改并生效            | 配置单测                             |
| 10 | AgentConfig 缺字段时 mapper 不崩、走到 fallback         | mapper 单测                        |

***

## 第13章 已确认决策（替代原"待确认问题"）

| # | 原问题                                 | 结论                                                                                                                                                                                                                                                                                                                                                                   |
| - | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | JSON-RPC Batch 协议是否已与 BE 端对齐？       | **未对齐**。BE 端 `tool_call_batch` 响应是 `{success, data: [...], duration_ms}` 包装（[adapter-bedrock/src/index.ts:408-412](../../packages/adapter-bedrock/src/index.ts#L408-L412)），JE 是裸数组。V20 文档强约束对齐 JE；BE 端对齐由 BE 侧工程师负责，本文档不约束。                                                                                                                                          |
| 2 | MainAgent 单例策略？                     | 按 **(workspaceId, agentId) 单例**。通过 `MainAgentRegistry` 缓存 key = `${workspaceId}:${agentId}`，构造在 `registry.get()` 内部按 `agentConfig` 重新走 `promptBuilderFactory`，无配置变更则复用缓存实例。                                                                                                                                                                                          |
| 3 | trigger `send_llm` 的 `target` 字段格式？ | 查实：[SendLLMActionConfig.target](../../packages/agent-core/src/main/trigger/types.ts#L134-L141) 已经是 enum `'main' \| 'qq_sub_agent'`，已存于 `action_json` 列。**不改 enum 格式**；`EventTrigger` 顶层加 `targetAgentId` 列，`AgentConfig` 加 `isMain` 列。`target='main'` 解析为 `workspaceId + isMain=true` 的 agent；`target='qq_sub_agent'` 解析为 `trigger.targetAgentId` 指向的 agent。详见 §4.8。 |

