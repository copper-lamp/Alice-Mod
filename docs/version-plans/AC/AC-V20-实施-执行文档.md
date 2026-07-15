# AC-V20 主链路组装 — 实施执行文档

> 版本：v1.0
> 日期：2026-07-16
> 关联设计文档：[AC-V20-主链路组装-设计文档.md](AC-V20-主链路组装-设计文档.md)
> 本期实施范围：§4.1 MainAgent + §4.5 bootstrap + §4.9 MainAgentRegistry + ipc 接线
> 本文档合并需求/架构/执行三件套，作为本轮编码的单一权威执行参考。

***

## 第1章 需求

### 1.1 本期目标

让"触发事件 → 主 Agent 决策 → LLM 推理 → 工具执行 → 结果回流"主链路的**中枢环节**落地，补齐设计文档 §8 实施分阶段中的 9.1（bootstrap 收尾）、9.4（MainAgent 主体）、9.5（MainAgentRegistry）三阶段，让 9.7 集成测试具备可跑条件。

### 1.2 范围

| # | 模块 | 文件 | 关键职责 |
| - | --- | --- | --- |
| 1 | bootstrapLlmSystem | `src/main/llm/bootstrap.ts`（新） | 启动时从 ProviderConfig 加载 → 实例化 Provider → 注册到 ProviderRegistry → 配置 ModelRouter workspace 路由 |
| 2 | MainAgent | `src/main/agent/main-agent.ts`（新） | 主链路中枢：组装 prompt → 调度 LLM → 处理 tool_calls → 持久化历史 |
| 3 | MainAgentRegistry | `src/main/agent/main-agent-registry.ts`（新） | (workspaceId, agentId) → MainAgent 实例缓存与查找 |
| 4 | ipc/index.ts 接线 | 修改 | 注册 bootstrap + Registry，让启动流程真正调通 |
| 5 | 单元测试 | `__tests__/{agent,llm}/**` | MainAgent / Registry / bootstrap 关键路径覆盖 |

### 1.3 不在本期范围

- §4.10 QQSubAgent 重构（继承 MainAgent）— 留待下一轮，避免一次性改动过大破坏现有 QQ 测试
- §4.5 model-handler.ts mockModels 清理 — 独立 PR 处理，避免与 UI 渲染层耦合
- §4.7 集成测试 / E2E mock JE server — 留待下一轮

### 1.4 关键约束（来自 V20 设计文档与 project_memory）

- JE 协议对齐：`tool_call_batch` 响应是**裸 JSON 数组**（已在 BatchToolDispatcher 实现）
- 玩家不可在 UI 与 Agent 直接对话，故 chat:send/chat:stream 不在范围
- AbortSignal 必须跨多个 await 透传到 TcpConnection.sendRequestAndAwait
- chat_history 按 (workspaceId, agentId) 隔离，WAL 模式 + 单 connection 串行 append
- AgentConfig 缺字段时 mapper 不崩，走 DEFAULT_AGENT_PROFILE fallback

***

## 第2章 架构

### 2.1 模块依赖图（本期相关）

```
┌─────────────────────────────────────────────────────────────┐
│  ipc/index.ts (启动入口)                                     │
│  └─> bootstrapLlmSystem(configManager, registry, router,    │
│                         agentConfigManager)                 │
│  └─> new MainAgentRegistry({                                │
│        agentConfigManager, mapper, promptBuilderFactory,    │
│        modelRouter, providerRegistry, pipeline,             │
│        connectionResolver, historyStore, scheduler,         │
│        observer })                                          │
└────────────────────────┬────────────────────────────────────┘
                         │ 注入到
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  TriggerEngine → ActionExecutor                             │
│  deps.mainAgentProvider = (p) => registry.get(p.ws, p.id)   │
│  deps.resolveTarget     = 按 trigger.target_agent_id /      │
│                            agents.is_main 解析              │
└────────────────────────┬────────────────────────────────────┘
                         │ 调用
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  MainAgent.handle(event)                                    │
│  ├─> historyStore.load(workspaceId, agentId, maxRounds)     │
│  ├─> promptBuilder.build({ workspaceId, userInput, history, │
│  │                          state, source })                │
│  ├─> scheduler.schedule({providerId}, async () => {         │
│  │      provider = providerRegistry.get(modelSel.providerId)│
│  │      response = provider.chat(messages, tools, options)  │
│  │    })                                                     │
│  ├─> historyStore.append(assistant message)                 │
│  ├─> if finish_reason == 'tool_calls':                      │
│  │     pipeline.process(response, workspaceId, conversation,│
│  │                     processOpts, abortSignal)            │
│  │       └─> BatchToolDispatcher.executeBatch               │
│  │             └─> connectionResolver.resolve(workspaceId)  │
│  │             └─> conn.sendRequestAndAwait('tool_call_batch'│
│  │                                   , {calls}, {timeoutMs})│
│  │     historyStore.append(tool results)                    │
│  └─> loop until finish_reason != 'tool_calls' 或达 maxRounds│
└─────────────────────────────────────────────────────────────┘
```

### 2.2 关键设计决策（与设计文档对齐 + 现状修正）

| # | 决策点 | 设计文档原文 | 实际现状修正 |
| - | --- | --- | --- |
| 1 | Provider 实例化来源 | `configManager.listProviders()` 返回带 `providerType` 的数组 | 实际 `DefaultLLMConfigManager.getProviderConfigs()` 返回 `Record<string, ProviderConfig>`，无 `providerType` 字段。**修正**：bootstrap 需要从 `providerConfig` 的 `baseUrl/apiKey/defaultModel` 推断 provider 类型，或在 ProviderConfig 上扩展 `providerType` 字段（V20 选择前者，按 baseUrl 关键字匹配） |
| 2 | ModelRouter 路由配置 | `modelRouter.updateConfig({default, workspaces: {'ws:main': {...}}, fallbacks})` | 实际 `RouterConfig` 形状是 `{default: ResolvedModel, workspaces?: Record<wsId, ResolvedModel>, taskTypes?, fallback: FallbackStrategy}`。**修正**：用 `workspaces[workspaceId]` 配置每个 workspace 的主模型；qqBotModel 与 compressionModel 不通过 router 区分，而由 MainAgent 按 `event.source` 直接选 providerId（更简单且符合 §4.1 step 1） |
| 3 | MainAgent 选模型方式 | `modelRouter.resolve({workspaceId, providerId, modelId, modelName, agentId, source})` | 实际 `RouterContext` 不接受 providerId/modelId。**修正**：MainAgent **直接**从 `agentConfig.llmConfig.{mainModel\|qqBotModel}` 拿 `ModelSelection`，再 `providerRegistry.get(providerId)` 取 Provider 实例。ModelRouter 仅作为可选 fallback 路径（本期不启用） |
| 4 | Provider.chat 传模型名 | `provider.chat(messages, tools, resolved.options)` | 实际 `BaseProvider.chat` 从 `options.extra.model` 读取模型名。**修正**：MainAgent 构造 `ChatOptions = { extra: { model: modelSel.modelName }, timeout, retryCount }` |
| 5 | ConnectionResolver | 已实现 ✅ | 直接复用 |
| 6 | ChatHistoryStore | 已实现 ✅ | 直接复用 |
| 7 | BatchToolDispatcher | 已实现 ✅ | 直接复用；MainAgent 调 `pipeline.process(response, workspaceId, conversation, opts, abortSignal)` |

### 2.3 数据流（MainAgent.handle 单次调用）

```
Input: MainAgentEvent { source, prompt, metadata }
  │
  ├─ 1. 选模型 key
  │    source ∈ {'trigger','system'} → mainModel
  │    source ∈ {'qq','debug'}      → qqBotModel
  │    metadata.taskType == 'compression' → compressionModel
  │
  ├─ 2. 加载历史
  │    history = historyStore.load(workspaceId, agentId, {limit: maxRounds*2})
  │
  ├─ 3. 构造 BuildParams
  │    params = { workspaceId, userInput: event.prompt, history,
  │               state: DEFAULT_EMPTY_STATE, source: mapSource(event.source) }
  │    extraContext = { excludeTools: getExcludeTools(agentConfig) }
  │
  ├─ 4. prompt = await promptBuilder.build(params)
  │    messages = prompt.messages  (ConversationMessage[])
  │    tools    = prompt.tools     (ToolPromptDefinition[])
  │
  ├─ 5. for round in [0, maxRounds):
  │    a. provider = providerRegistry.get(modelSel.providerId)
  │       if !provider: throw → MainAgentResult.error = 'PROVIDER_NOT_FOUND'
  │    b. options = { extra: { model: modelSel.modelName },
  │                   timeout: 60_000, retryCount: 3,
  │                   requestId: generateId() }
  │    c. response = await scheduler.schedule({providerId}, () =>
  │                    provider.chat(toLLMMessages(messages),
  │                                  toToolDefs(tools), options))
  │       (scheduler 内部令牌桶 + 并发上限；abortSignal 透传到 schedule 内部 await)
  │    d. historyStore.append({ role:'assistant', content: response.message.content,
  │                             toolCalls: response.message.tool_calls,
  │                             finishReason: response.finishReason, ... })
  │    e. if response.finishReason != 'tool_calls': break
  │    f. pipelineResult = await pipeline.process(response, workspaceId,
  │                            { messages }, { requestId }, abortSignal)
  │       (pipeline 内部调 BatchToolDispatcher → conn.sendRequestAndAwait)
  │    g. for each toolResult in pipelineResult.toolResults:
  │         historyStore.append({ role:'tool', content: JSON.stringify(result),
  │                                toolCallId: result.toolCallId, ... })
  │    h. messages = pipelineResult.messages ?? messages (含 tool_result 注入)
  │       (若 pipeline 未回注到 conversation，MainAgent 自行把 tool_result 追加到 messages)
  │
  └─ 6. return MainAgentResult {
         finalResponse: response.message.content,
         rounds, totalTokens, durationMs,
         finishReason: response.finishReason,
         error: undefined }
```

### 2.4 错误处理矩阵（本期覆盖部分）

| 场景 | 处理 |
| --- | --- |
| Provider 未注册 | MainAgent.handle catch → `MainAgentResult.error = 'PROVIDER_NOT_FOUND'` |
| Provider 调用抛错（401/超时/网络） | scheduler.schedule 透传异常 → MainAgent catch → 记录到 history（role=assistant, finishReason=error） → 返回 error |
| World 离线（ConnectionResolver 抛 NotConnectedError） | pipeline.process 内部抛 → MainAgent catch → `MainAgentResult.error = 'WORLD_OFFLINE'` |
| AbortSignal 触发 | 每个 await 后检查 `signal.aborted`，触发即抛 AbortError；scheduler/pipeline/sendRequestAndAwait 已支持 |
| Pipeline dispatcher 未配置 | pipeline.process 抛 → MainAgent catch → `MainAgentResult.error = 'DISPATCHER_NOT_CONFIGURED'` |
| 达 maxRounds 仍有 tool_calls | break 循环，返回 `MainAgentResult.finishReason = 'max_rounds_reached'` |

***

## 第3章 执行

### 3.1 文件清单

#### 新增

| 文件 | 职责 |
| --- | --- |
| `packages/agent-core/src/main/llm/bootstrap.ts` | bootstrapLlmSystem 启动入口 |
| `packages/agent-core/src/main/agent/main-agent.ts` | MainAgent 主体 |
| `packages/agent-core/src/main/agent/main-agent-registry.ts` | (workspaceId, agentId) → MainAgent 缓存 |
| `packages/agent-core/src/main/agent/index.ts` | agent 模块导出聚合 |
| `packages/agent-core/__tests__/agent/main-agent.test.ts` | MainAgent 单测 |
| `packages/agent-core/__tests__/agent/main-agent-registry.test.ts` | Registry 单测 |
| `packages/agent-core/__tests__/llm/bootstrap.test.ts` | bootstrap 单测 |

#### 修改

| 文件 | 变更 |
| --- | --- |
| `packages/agent-core/src/main/ipc/index.ts` | 启动时调 `bootstrapLlmSystem()`；构造 `MainAgentRegistry` 并注入到 `TriggerEngine`/`ActionExecutor` |
| `packages/agent-core/src/main/llm/index.ts` | 导出 `bootstrapLlmSystem` |

### 3.2 实施步骤

#### Step 1: bootstrap.ts

```ts
export interface BootstrapDeps {
  configManager: DefaultLLMConfigManager
  providerRegistry: ProviderRegistry
  modelRouter: DefaultModelRouter
  agentConfigManager: AgentConfigManager
}

export async function bootstrapLlmSystem(deps: BootstrapDeps): Promise<{
  registeredProviders: string[]
  workspaceRoutes: Record<string, ResolvedModel>
}> {
  // 1. 加载所有 ProviderConfig
  const configs = await deps.configManager.getProviderConfigs()
  // 2. 实例化 + 注册（按 baseUrl 推断类型）
  for (const [id, cfg] of Object.entries(configs)) {
    if (deps.providerRegistry.has(id)) continue  // 幂等
    const ProviderCls = resolveProviderClass(cfg.baseUrl)
    const provider = new ProviderCls(cfg)
    deps.providerRegistry.register(id, provider)
  }
  // 3. 加载所有 AgentConfig → 配置 ModelRouter workspaces
  const agents = await deps.agentConfigManager.list()
  const workspaceRoutes: Record<string, ResolvedModel> = {}
  for (const summary of agents) {
    const cfg = await deps.agentConfigManager.get(summary.id)
    if (!cfg?.llmConfig?.mainModel) continue
    const ws = cfg.workspaceId ?? 'default'
    workspaceRoutes[ws] = {
      providerId: cfg.llmConfig.mainModel.providerId,
      model: cfg.llmConfig.mainModel.modelName,
      options: { temperature: 0.7, maxTokens: 4096 },
    }
  }
  // 4. 更新 Router 配置（保留 fallback 不动）
  const currentCfg = deps.modelRouter.getConfig()
  deps.modelRouter.updateConfig({
    default: workspaceRoutes['default'] ?? currentCfg.default,
    workspaces: workspaceRoutes,
  })
  return { registeredProviders: [...configs.keys()], workspaceRoutes }
}

function resolveProviderClass(baseUrl: string): typeof BaseProvider {
  const u = baseUrl.toLowerCase()
  if (u.includes('anthropic')) return ClaudeProvider
  if (u.includes('generativelanguage.googleapis') || u.includes('gemini')) return GeminiProvider
  if (u.includes('127.0.0.1:11434') || u.includes('/ollama')) return OllamaProvider
  return OpenAIProvider  // 默认 OpenAI 兼容
}
```

#### Step 2: main-agent.ts（核心，~250 行）

关键接口：

```ts
export interface MainAgentDeps {
  agentConfig: AgentConfig
  workspaceId: string
  agentId: string
  promptBuilder: IPromptBuilder
  providerRegistry: IProviderRegistry
  pipeline: FunctionCallingPipeline
  connectionResolver: ConnectionResolver  // 注入给 pipeline 的 dispatcher
  historyStore: ChatHistoryStore
  scheduler: LlmRequestScheduler
  observer?: ILLMObserver
  maxRounds?: number  // 默认 5
}

export interface MainAgentEvent {
  source: 'trigger' | 'qq' | 'debug' | 'system'
  prompt: string
  metadata?: Record<string, unknown>
}

export interface MainAgentResult {
  finalResponse: string
  rounds: number
  totalTokens: number
  durationMs: number
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error' | 'max_rounds_reached' | 'aborted'
  error?: string
}

export class MainAgent {
  constructor(deps: MainAgentDeps)
  async handle(event: MainAgentEvent, opts?: { abortSignal?: AbortSignal }): Promise<MainAgentResult>
  abort(): void
}
```

实现要点：
- 构造时把 `pipeline.setDispatcher(new BatchToolDispatcher(connectionResolver))` + `pipeline.setCollector(new BatchResultCollector())` 完成注入（幂等）
- `handle` 内部按 §2.3 数据流执行
- `abort()` 调用 `AbortController.abort()`，下次 await 检查到 aborted 抛 AbortError
- history 加载用 `maxRounds*2` 条（assistant + tool 一对算一轮）

#### Step 3: main-agent-registry.ts

```ts
export class MainAgentRegistry {
  private cache = new Map<string, MainAgent>()  // key = `${workspaceId}:${agentId}`

  constructor(private deps: {
    agentConfigManager: AgentConfigManager
    workspaceManager: WorkspaceManager
    tcpServer: TcpServer
    promptBuilderFactory: (config: AgentConfig) => IPromptBuilder
    providerRegistry: IProviderRegistry
    pipelineFactory: () => FunctionCallingPipeline  // 每 agent 独立 pipeline 实例
    historyStore: ChatHistoryStore
    scheduler: LlmRequestScheduler
    observer?: ILLMObserver
  }) {}

  async get(workspaceId: string, agentId: string): Promise<MainAgent | undefined>
  refresh(agentId: string): void  // agent 配置变更后清缓存
  invalidate(workspaceId: string, agentId: string): void
  list(): Array<{ workspaceId: string; agentId: string }>
}
```

注入到 TriggerEngine 时：
```ts
actionExecutor.setDeps({
  mainAgentProvider: (p) => registry.getSync(p.workspaceId, p.agentId),
  resolveTarget: resolveTargetFactory(agentConfigManager),
})
```

注：`get` 异步（需读 AgentConfig）；为兼容 `mainAgentProvider` 同步签名，Registry 内部维护同步缓存 `getSync`，若未命中则返回 undefined（trigger 下次再触发时已构造好）。

#### Step 4: ipc/index.ts 接线

在 `registerAllIpcHandlers` 之前添加：
```ts
import { bootstrapLlmSystem } from '../llm/bootstrap'
import { MainAgentRegistry } from '../agent/main-agent-registry'

export async function bootstrapAndWireAgents(): Promise<MainAgentRegistry> {
  const configManager = getLLMConfigManager()
  const registry = ProviderRegistry.getInstance()
  const router = getModelRouter()
  const agentConfigManager = getAgentConfigManager()

  await bootstrapLlmSystem({ configManager, providerRegistry: registry, modelRouter: router, agentConfigManager })

  const agentRegistry = new MainAgentRegistry({ ... })
  // 注入到 trigger action executor
  return agentRegistry
}
```

### 3.3 测试策略

#### MainAgent 单测覆盖点

1. **基本流程**：mock provider 返回 finish_reason='stop' → 验证 1 轮结束、history 落 1 条 assistant
2. **工具调用**：mock provider 第 1 轮返回 tool_calls，第 2 轮返回 stop → 验证 2 轮、history 落 3 条（assistant+tool+assistant）、pipeline 被调
3. **maxRounds 截断**：mock provider 始终返回 tool_calls → 验证 rounds == maxRounds、finishReason='max_rounds_reached'
4. **abort 透传**：发起后立即 abort → 验证抛 AbortError、finishReason='aborted'
5. **Provider 未注册**：providerId 不存在 → 验证 error='PROVIDER_NOT_FOUND'
6. **World 离线**：connectionResolver.resolve 抛 NotConnectedError → 验证 error='WORLD_OFFLINE'

#### Registry 单测覆盖点

1. **缓存命中**：二次 get 返回同一实例
2. **refresh 失效**：refresh 后再 get 返回新实例
3. **list 列出缓存**
4. **未命中返回 undefined**

#### bootstrap 单测覆盖点

1. **Provider 注册**：mock 2 个 ProviderConfig → 验证 registry.register 被调 2 次
2. **幂等**：二次调 bootstrap 不重复注册
3. **workspace 路由配置**：1 个 agent 配 mainModel → 验证 modelRouter.updateConfig 收到 workspaces[wsId]
4. **Provider 类型推断**：anthropic / googleapis / 127.0.0.1:11434 / 其他 → 4 个分支

### 3.4 验收清单

| # | 项 | 验证方法 |
| - | --- | --- |
| 1 | bootstrapLlmSystem 启动后 ProviderRegistry 含所有配置的 Provider | 单测 + 启动日志 |
| 2 | MainAgent.handle 单轮 stop 场景 history 落 1 条 | 单测 |
| 3 | MainAgent.handle 工具调用场景 history 落 3 条 + pipeline 被调 | 单测 |
| 4 | MainAgent.abort 快速抛 AbortError | 单测 |
| 5 | MainAgentRegistry 缓存命中 / refresh 失效 | 单测 |
| 6 | ipc/index.ts 启动时调 bootstrap + 构造 Registry | typecheck + 启动测试 |
| 7 | 所有单测通过 | `npm test` |

***

## 第4章 风险

| 风险 | 缓解 |
| --- | --- |
| ProviderConfig 无 `providerType` 字段，需按 baseUrl 推断 | 4 个分支覆盖主流 Provider；未知 baseUrl 默认 OpenAI 兼容 |
| MainAgent 直接绕过 ModelRouter，丢失 fallback 能力 | V20 阶段接受；fallback 留 P1（MainAgent 可后续加 router.resolve 作为 try-catch fallback） |
| Registry 同步缓存 vs 异步构造的竞态 | 首次 get 异步构造完成后填入同步缓存；trigger 第二次触发时已就绪 |
| pipeline 实例共享 vs 每 agent 独立 | 本期选择**每 agent 独立 pipeline 实例**（pipelineFactory），避免 dispatcher/collector 状态串扰 |
| AgentConfig 缺 llmConfig 字段 | MainAgent 构造时校验，缺字段抛错（registry 跳过该 agent） |
