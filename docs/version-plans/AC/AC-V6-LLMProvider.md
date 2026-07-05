# Alice Mod Core V6 — LLM Provider ×4 + ModelRouter

> 版本：v1.0
> 日期：2026-07-05
> 版本号：V6（第 7-8 周）
> 对应需求：AC-LLM-01 ~ AC-LLM-08、AC-LLM-11
> 关联文档：[AC-01-需求文档.md](AC-01-需求文档.md)、[AC-02-实施计划.md](AC-02-实施计划.md)、[AC-V5-PromptEngineering.md](AC-V5-PromptEngineering.md)、[01-LLM抽象层接口规范.md](../../api/01-LLM抽象层接口规范.md)

---

## 第一部分：需求文档

### 1.1 模块定位

LLM Provider 模块是 Agent Core 中连接 **提示词系统（V5）** 与 **Function Calling 管线（V4）** 的桥梁。它负责统一管理多个 LLM 服务商，提供透明的模型路由和自动降级能力。

**核心职责**：

| 职责 | 说明 |
|------|------|
| **Provider 统一封装** | 为 4 种 LLM 服务商（OpenAI / Claude / Gemini / Ollama）提供统一调用接口 |
| **注册管理** | ProviderRegistry 负责 Provider 的注册、获取、生命周期管理 |
| **智能路由** | ModelRouter 根据工作区配置、任务类型、可用性自动选择最优模型 |
| **自动降级** | 主模型不可用时，按策略自动切换到次级模型 |
| **配置持久化** | Provider 配置和路由规则存储在 SQLite 中，重启后生效 |
| **调用可观测** | 记录每次 LLM 调用的 tokens 消耗、耗时、模型名称 |

### 1.2 与 V4 / V5 的关系

```
┌─────────────────────────────────────────────────────────────────────┐
│                        V6 LLM Provider 模块                          │
│                                                                     │
│  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │  Provider 接口层   │    │   路由管理层      │    │   观测层       │  │
│  │                  │    │                  │    │               │  │
│  │  OpenAIProvider  │    │  ModelRouter     │    │  LLMObserver  │  │
│  │  ClaudeProvider  │◄───│  · 工作区路由     │    │  · tokens 统计 │  │
│  │  GeminiProvider  │    │  · 任务类型路由   │    │  · 耗时记录    │  │
│  │  OllamaProvider  │    │  · 降级策略       │    │  · 日志输出    │  │
│  └────────┬─────────┘    └────────┬─────────┘    └───────┬───────┘  │
│           │                      │                       │          │
│           └──────────────────────┼───────────────────────┘          │
│                                  │                                  │
│  ┌───────────────────────────────▼──────────────────────────────┐   │
│  │                    ProviderRegistry                           │   │
│  │  注册 / 获取 / 注销 / 生命周期管理 / healthCheck 聚合         │   │
│  └───────────────────────────────┬──────────────────────────────┘   │
│                                  │                                  │
│  ┌───────────────────────────────▼──────────────────────────────┐   │
│  │                    ConfigManager                              │   │
│  │  Provider 配置持久化 / 路由配置持久化 / 运行时配置热更新        │   │
│  └──────────────────────────────────────────────────────────────┘   │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ resolve(providerId, model) → LLMResponse
                            ▼
              ┌─────────────────────────────┐
              │  V5 提示词工程模块            │
              │  PromptBuilder.build()       │
              │  → messages[] + tools[]      │
              └─────────────┬───────────────┘
                            │
                            ▼
              ┌─────────────────────────────┐
              │  V6 ModelRouter.resolve()   │
              │  → 选择 Provider + 模型      │
              └─────────────┬───────────────┘
                            │ provider.chat()
                            ▼
              ┌─────────────────────────────┐
              │  V4 Function Calling 管线    │
              │  解析 → 依赖分析 → 分发 → 收集 │
              └─────────────────────────────┘
```

### 1.3 功能需求列表

| 需求 ID | 需求名称 | 优先级 | 实现状态 |
|---------|---------|:------:|:--------:|
| AC-LLM-01 | Provider 统一接口定义（chat / chatStream / healthCheck） | P0 | ⏳ |
| AC-LLM-02 | OpenAI Provider 实现（兼容 OpenAI / Azure OpenAI / DeepSeek） | P0 | ⏳ |
| AC-LLM-03 | Claude Provider 实现（Anthropic Messages API） | P0 | ⏳ |
| AC-LLM-04 | Gemini Provider 实现（Google Gemini API） | P0 | ⏳ |
| AC-LLM-05 | Ollama Provider 实现（本地 Ollama 部署模型） | P0 | ⏳ |
| AC-LLM-06 | ProviderRegistry 注册管理（注册 / 获取 / 注销 / healthCheck 聚合） | P0 | ⏳ |
| AC-LLM-07 | ModelRouter 路由选择（工作区路由 / 任务类型路由 / 降级） | P0 | ⏳ |
| AC-LLM-08 | 配置管理服务（Provider 配置 / 模型选择持久化 / 运行时热更新） | P0 | ⏳ |
| AC-LLM-11 | LLM 调用可观测（tokens 消耗 / 耗时 / 模型名称记录） | P1 | ⏳ |

### 1.4 验收标准

| # | 验收条件 | 验证方法 | 测量指标 |
|---|---------|----------|----------|
| 6.1 | OpenAI Provider 可调用 | 使用有效 API Key 调用 `chat()` | 返回 LLMResponse，status=200 |
| 6.2 | Claude Provider 可调用 | 使用有效 API Key 调用 `chat()` | 返回 LLMResponse |
| 6.3 | Gemini Provider 可调用 | 使用有效 API Key 调用 `chat()` | 返回 LLMResponse |
| 6.4 | Ollama Provider 可调用 | 本地 Ollama 运行 qwen2.5:7b | 返回 LLMResponse |
| 6.5 | 4 个 Provider 均支持流式 | 调用 `chatStream()` | 逐 chunk 返回，isLast=true 时结束 |
| 6.6 | Provider 切换 | 从 openai 切换到 claude | 后续请求使用 claude |
| 6.7 | ModelRouter 路由 | RouterContext.requiresTools=true | 路由到支持 Function Calling 的模型 |
| 6.8 | 降级策略生效 | OpenAI 返回 500 错误 | 自动切换到 fallback（ollama） |
| 6.9 | 配置持久化 | 保存 Provider 配置后重启 | 配置不变 |
| 6.10 | healthCheck | 检查 4 个 Provider 连通性 | 返回 available=true/false 和 latencyMs |
| 6.11 | 调用可观测 | 执行 10 次 LLM 调用 | 日志记录 10 条记录，含 tokens/耗时/模型 |
| 6.12 | 流式中断可恢复 | 流式过程中断网络 | 自动重连继续接收 |

---

## 第二部分：架构文档

### 2.1 整体架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       V6 LLM Provider 模块                                │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    1. Provider 接口层                             │   │
│  │                                                                  │   │
│  │  ┌─────────────────────────────────────────────────────────┐    │   │
│  │  │              LLMProvider (统一接口)                       │    │   │
│  │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │    │   │
│  │  │  │  chat()  │ │chatStream│ │ embed()  │ │healthCheck│    │    │   │
│  │  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘    │    │   │
│  │  └─────────────────────────────────────────────────────────┘    │   │
│  │                                                                  │   │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────┐  │   │
│  │  │    OpenAI    │ │    Claude    │ │    Gemini    │ │ Ollama │  │   │
│  │  │  Provider    │ │  Provider    │ │  Provider    │ │Provider│  │   │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └────────┘  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    2. 注册管理层                                  │   │
│  │                                                                  │   │
│  │  ┌──────────────────────────────────────────────────────────┐   │   │
│  │  │                    ProviderRegistry                      │   │   │
│  │  │  register() → get() → getAll() → unregister() → has()   │   │   │
│  │  │  aggregateHealthCheck() → listAvailable()                │   │   │
│  │  └──────────────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    3. 路由管理层                                  │   │
│  │                                                                  │   │
│  │  ┌──────────────────────────────────────────────────────────┐   │   │
│  │  │                      ModelRouter                         │   │   │
│  │  │                                                         │   │   │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐ │   │   │
│  │  │  │ 工作区路由     │  │ 任务类型路由   │  │ 降级策略       │ │   │   │
│  │  │  │ · 按工作区    │  │ · complex    │  │ · 连续失败     │ │   │   │
│  │  │  │ · 按 Provider│  │ · simple     │  │ · 超时降级     │ │   │   │
│  │  │  │ · 按模型     │  │ · chat       │  │ · 恢复检查     │ │   │   │
│  │  │  │              │  │ · planning   │  │ · 自定义规则   │ │   │   │
│  │  │  └──────────────┘  └──────────────┘  └────────────────┘ │   │   │
│  │  └──────────────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    4. 配置管理层                                  │   │
│  │                                                                  │   │
│  │  ┌──────────────────────────────────────────────────────────┐   │   │
│  │  │                    ConfigManager                         │   │   │
│  │  │  · Provider 配置读写（SQLite config 表）                 │   │   │
│  │  │  · 路由配置持久化                                        │   │   │
│  │  │  · 运行时配置热更新（事件通知）                           │   │   │
│  │  └──────────────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    5. 观测层                                     │   │
│  │                                                                  │   │
│  │  ┌──────────────────────────────────────────────────────────┐   │   │
│  │  │                     LLMObserver                          │   │   │
│  │  │  · 每次调用记录 { requestId, provider, model, tokens,   │   │   │
│  │  │    durationMs, success, finishReason, timestamp }        │   │   │
│  │  │  · 聚合统计（按 Provider/模型/时间段）                   │   │   │
│  │  │  · 日志输出（每次调用结束后写入）                         │   │   │
│  │  └──────────────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 数据流

```
V5 PromptBuilder              V6 核心流程                     V4 Pipeline
     │                           │                              │
     ▼                           │                              │
┌──────────────┐                 │                              │
│  build()     │                 │                              │
│  → messages  │                 │                              │
│  → tools     │                 │                              │
└──────┬───────┘                 │                              │
       │                         │                              │
       ▼                         │                              │
┌──────────────────────────┐     │                              │
│  ModelRouter.resolve()   │     │                              │
│                          │     │                              │
│  1. 检查工作区配置         │     │                              │
│     → 有指定 Provider     │     │                              │
│     → 使用指定模型         │     │                              │
│     → 无指定 → 2          │     │                              │
│                           │     │                              │
│  2. 检查任务类型           │     │                              │
│     → complex → GPT-4o   │     │                              │
│     → simple  → 4o-mini  │     │                              │
│     → chat    → Gemini   │     │                              │
│     → 无类型 → 3         │     │                              │
│                           │     │                              │
│  3. 使用默认路由           │     │                              │
│     → default Provider    │     │                              │
└──────────┬───────────────┘     │                              │
           │                     │                              │
           ▼                     │                              │
┌──────────────────────────┐     │                              │
│  ProviderRegistry        │     │                              │
│  .get(providerId)        │     │                              │
│  → 获取 Provider 实例    │     │                              │
└──────────┬───────────────┘     │                              │
           │                     │                              │
           ▼                     │                              │
┌──────────────────────────┐     │                              │
│  LLMObserver.wrap()      │     │                              │
│  → 包装调用，记录日志      │     │                              │
└──────────┬───────────────┘     │                              │
           │                     │                              │
           ▼                     │                              │
┌──────────────────────────┐     │                              │
│  Provider.chat()         │     │                              │
│  → 调用 LLM API          │     │                              │
│  → 返回 LLMResponse      │◄────│──── 失败触发降级             │
└──────────┬───────────────┘     │                              │
           │                     │                              │
           ▼                     │                              │
┌──────────────────────────┐     │                              │
│  LLMObserver.record()    │     │                              │
│  → 写入调用记录           │     │                              │
└──────────┬───────────────┘     │                              │
           │                     │                              │
           ▼                     ▼                              │
    ┌────────────────────────────────────────────────────┐      │
    │  V4 FunctionCallingPipeline.process(response)     │      │
    │  解析 → 依赖分析 → Batch 发送 → 收集 → 回注       │      │
    └────────────────────────────────────────────────────┘      │
```

### 2.3 降级流程

```
LLM 调用请求
    │
    ▼
┌──────────────────────┐
│  ModelRouter         │
│  .resolve()          │──→ 返回 { providerId, model }
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Provider.chat()     │──→ 成功 → 返回 LLMResponse
│  OpenAI              │
└──────────┬───────────┘
           │ 失败（网络错误 / 500 / 超时）
           ▼
┌──────────────────────┐
│  降级决策             │
│                      │
│  1. 检查失败次数       │──→ 连续失败 < 3 次 → 重试
│                      │
│  2. 检查降级列表       │──→ 有 fallback → 切换到次级
│                      │
│  3. 检查是否超过阈值   │──→ 超过 → 触发降级
│                      │
│  4. 记录降级事件       │──→ 写入降级日志
└──────────┬───────────┘
           │ 切换到 fallback
           ▼
┌──────────────────────┐
│  Provider.chat()     │──→ 成功 → 返回 LLMResponse
│  OpenAI (4o-mini)    │
└──────────┬───────────┘
           │ 仍失败
           ▼
┌──────────────────────┐
│  二级降级             │──→ 切换到 Ollama (本地)
│  Ollama Provider     │
└──────────┬───────────┘
           │ 仍失败
           ▼
┌──────────────────────┐
│  返回 LLM_006 错误    │
│  所有 Provider 降级   │
│  后仍失败              │
└──────────────────────┘
```

### 2.4 核心接口设计

#### 2.4.1 LLMProvider — Provider 统一接口

```typescript
/**
 * LLM Provider 统一接口
 * 所有 LLM 服务商必须实现此接口
 */
interface LLMProvider {
  /** Provider 元数据 */
  readonly metadata: ProviderMetadata;

  /** 发送消息并获取完整响应 */
  chat(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<LLMResponse>;

  /** 流式聊天，逐 chunk 返回 */
  chatStream(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): AsyncIterable<LLMChunk>;

  /** 生成嵌入向量（可选） */
  embed?(text: string): Promise<number[]>;

  /** 检查 Provider 可用性 */
  healthCheck(): Promise<HealthCheckResult>;
}

interface ProviderMetadata {
  /** Provider 标识符 */
  id: string;                    // 'openai' | 'claude' | 'gemini' | 'ollama'
  /** 显示名称 */
  displayName: string;
  /** 支持的模型列表 */
  supportedModels: string[];
  /** 是否支持流式输出 */
  supportsStreaming: boolean;
  /** 是否支持 Function Calling */
  supportsFunctionCalling: boolean;
  /** 是否支持嵌入向量 */
  supportsEmbedding: boolean;
  /** Provider 版本 */
  version: string;
}

interface ChatOptions {
  /** 温度 */
  temperature?: number;          // default: 0.7
  /** 最大输出 tokens */
  maxTokens?: number;            // default: 4096
  /** top_p */
  topP?: number;                 // default: 1.0
  /** 停止标记 */
  stop?: string[];
  /** 额外 Provider 参数 */
  extra?: Record<string, unknown>;
  /** 超时时间（ms） */
  timeout?: number;              // default: 60000
  /** 重试次数 */
  retryCount?: number;           // default: 3
  /** 请求标签（用于追踪和日志） */
  requestId?: string;
}
```

#### 2.4.2 LLMResponse — 响应格式

```typescript
interface LLMResponse {
  /** 响应消息 */
  message: AssistantMessage;
  /** Token 消耗统计 */
  usage: TokenUsage;
  /** 模型名称 */
  model: string;
  /** 请求 ID */
  requestId: string;
  /** 实际耗时（ms） */
  durationMs: number;
  /** 是否被截断 */
  truncated: boolean;
  /** 结束原因 */
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
}

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** 缓存命中 tokens（仅支持缓存的 Provider） */
  cachedTokens?: number;
}

interface LLMChunk {
  /** chunk 内容（文本片段） */
  content: string;
  /** 工具调用增量（部分 JSON，仅在流式 Function Calling 时出现） */
  toolCallDelta?: string;
  /** 当前已累积的 tokens */
  usage?: TokenUsage;
  /** 是否最后一个 chunk */
  isLast: boolean;
  /** 结束原因（仅在 isLast=true 时有值） */
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'error';
}

interface HealthCheckResult {
  available: boolean;
  latencyMs: number;
  model: string;
  error?: string;
}
```

#### 2.4.3 ProviderRegistry — 注册管理器

```typescript
/**
 * Provider 注册管理器
 * 管理所有 Provider 实例的注册、获取、生命周期
 */
interface IProviderRegistry {
  /** 注册一个 Provider */
  register(id: string, provider: LLMProvider): void;

  /** 获取已注册的 Provider */
  get(id: string): LLMProvider | undefined;

  /** 获取所有已注册的 Provider */
  getAll(): Map<string, LLMProvider>;

  /** 获取所有可用 Provider（healthCheck 通过的） */
  getAvailable(): Promise<Array<{ id: string; provider: LLMProvider; latencyMs: number }>>;

  /** 注销 Provider */
  unregister(id: string): void;

  /** 检查 Provider 是否已注册 */
  has(id: string): boolean;

  /** 聚合 healthCheck */
  aggregateHealthCheck(): Promise<Record<string, HealthCheckResult>>;
}
```

#### 2.4.4 ModelRouter — 路由选择器

```typescript
/**
 * 模型路由选择器
 * 根据上下文选择最优 Provider + 模型
 */
interface IModelRouter {
  /** 根据上下文选择最优 Provider + 模型 */
  resolve(context: RouterContext): Promise<ResolvedModel>;

  /** 注册自定义路由规则 */
  registerRule(rule: RouterRule): void;

  /** 获取当前路由配置 */
  getConfig(): RouterConfig;

  /** 更新路由配置（热更新） */
  updateConfig(config: Partial<RouterConfig>): void;

  /** 获取路由统计 */
  getStats(): RouterStats;
}

interface RouterContext {
  /** 工作区 ID */
  workspaceId: string;
  /** 当前任务类型 */
  taskType?: 'complex' | 'simple' | 'chat' | 'planning';
  /** 估计需要的 tokens 数 */
  estimatedTokens?: number;
  /** 是否需要 Function Calling */
  requiresTools: boolean;
  /** 是否需要流式输出 */
  requiresStreaming: boolean;
}

interface ResolvedModel {
  providerId: string;
  model: string;
  options: ChatOptions;
}

interface RouterRule {
  /** 规则名称 */
  name: string;
  /** 匹配条件 */
  match: (context: RouterContext) => boolean;
  /** 路由目标 */
  target: ResolvedModel | 'fallback';
  /** 优先级（数字越大越先匹配） */
  priority: number;
}

interface RouterConfig {
  /** 默认路由 */
  default: ResolvedModel;
  /** 按工作区指定的路由（覆盖默认） */
  workspaces?: Record<string, ResolvedModel>;
  /** 按任务类型指定的路由（覆盖默认） */
  taskTypes?: Record<string, ResolvedModel>;
  /** 降级策略 */
  fallback: FallbackStrategy;
}

interface FallbackStrategy {
  /** 降级顺序列表 */
  fallbacks: ResolvedModel[];
  /** 降级条件 */
  conditions: {
    /** 连续失败次数超过此值触发降级 */
    maxConsecutiveFailures: number;   // default: 3
    /** 超时时间超过此值触发降级（ms） */
    timeoutThreshold: number;          // default: 120000
  };
  /** 降级后恢复检查间隔（ms） */
  recoveryCheckIntervalMs: number;    // default: 300000 (5min)
}

interface RouterStats {
  totalResolves: number;
  routeDistribution: Record<string, number>;  // providerId → count
  fallbackCount: number;
  fallbackReasons: Record<string, number>;     // reason → count
  avgLatencyMs: number;
}
```

#### 2.4.5 ConfigManager — 配置管理

```typescript
/**
 * LLM 配置管理器
 * 负责 Provider 配置和路由配置的读写、持久化、热更新
 */
interface ILLMConfigManager {
  /** 获取所有 Provider 配置 */
  getProviderConfigs(): Promise<Record<string, ProviderConfig>>;

  /** 获取指定 Provider 的配置 */
  getProviderConfig(id: string): Promise<ProviderConfig | undefined>;

  /** 更新 Provider 配置 */
  updateProviderConfig(id: string, config: Partial<ProviderConfig>): Promise<void>;

  /** 删除 Provider 配置 */
  removeProviderConfig(id: string): Promise<void>;

  /** 获取路由配置 */
  getRouterConfig(): Promise<RouterConfig>;

  /** 更新路由配置 */
  updateRouterConfig(config: Partial<RouterConfig>): Promise<void>;

  /** 监听配置变更 */
  onConfigChanged(callback: (event: ConfigChangeEvent) => void): void;
}

interface ProviderConfig {
  /** API 基础地址 */
  baseUrl: string;
  /** API Key（可选，Ollama 不需要） */
  apiKey?: string;
  /** 默认模型 */
  defaultModel: string;
  /** 可选模型列表 */
  models?: string[];
  /** API 版本 */
  apiVersion?: string;
  /** 额外请求头 */
  headers?: Record<string, string>;
  /** 超时配置（ms） */
  timeout?: number;
  /** 最大重试次数 */
  maxRetries?: number;
}

type ConfigChangeEvent = {
  type: 'provider_added' | 'provider_updated' | 'provider_removed' | 'router_updated';
  providerId?: string;
  timestamp: number;
};
```

#### 2.4.6 LLMObserver — 调用观测

```typescript
/**
 * LLM 调用观测器
 * 记录每次 LLM 调用的关键指标
 */
interface ILLMObserver {
  /** 包装 Provider 调用，自动记录观测数据 */
  wrap<T>(providerId: string, model: string, call: () => Promise<T>): Promise<T>;

  /** 手动记录一次调用 */
  record(callRecord: LLMCallRecord): void;

  /** 查询调用记录 */
  query(filter?: CallRecordFilter): LLMCallRecord[];

  /** 获取聚合统计 */
  getStats(timeRange?: { start: number; end: number }): CallStats;

  /** 导出调用记录 */
  export(): LLMCallRecord[];

  /** 监听观测事件 */
  onCallRecorded(callback: (record: LLMCallRecord) => void): void;
}

interface LLMCallRecord {
  /** 请求 ID */
  requestId: string;
  /** Provider ID */
  providerId: string;
  /** 模型名称 */
  model: string;
  /** Prompt tokens */
  promptTokens: number;
  /** 输出 tokens */
  completionTokens: number;
  /** 总 tokens */
  totalTokens: number;
  /** 缓存命中 tokens */
  cachedTokens?: number;
  /** 实际耗时（ms） */
  durationMs: number;
  /** 是否成功 */
  success: boolean;
  /** 结束原因 */
  finishReason: string;
  /** 错误信息（success=false 时） */
  error?: string;
  /** 调用时间戳 */
  timestamp: number;
}

interface CallStats {
  totalCalls: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCachedTokens: number;
  avgDurationMs: number;
  successRate: number;
  byProvider: Record<string, ProviderCallStats>;
  byModel: Record<string, ModelCallStats>;
}

interface ProviderCallStats {
  callCount: number;
  totalTokens: number;
  avgDurationMs: number;
  successRate: number;
}

interface ModelCallStats {
  callCount: number;
  totalTokens: number;
  avgDurationMs: number;
  successRate: number;
}

interface CallRecordFilter {
  providerId?: string;
  model?: string;
  success?: boolean;
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}
```

### 2.5 各 Provider 差异分析

| 维度 | OpenAI | Claude | Gemini | Ollama |
|------|--------|--------|--------|--------|
| API 格式 | OpenAI Chat Completions | Anthropic Messages | Google Generative AI | OpenAI 兼容 |
| 流式方式 | SSE (server-sent events) | SSE (event stream) | SSE (stream generate) | SSE (OpenAI 兼容) |
| 工具格式 | `tools` 参数 | `tools` 参数 | `tools.function_declarations` | 同 OpenAI |
| 系统提示词 | `messages[].role=system` | `system` 顶层字段 | `system_instruction` 字段 | 同 OpenAI |
| 图片输入 | `content[].type=image_url` | `content[].type=image` (base64) | `content[].type=image` (base64) | 通常不支持 |
| 多模态 | ✅ | ✅ | ✅ | ❌ |
| 嵌入向量 | ✅ (text-embedding-3) | ❌ | ✅ (embedding-001) | ✅ (nomic-embed-text) |
| API Key | 必填 | 必填 | 必填 | 不需要 |
| 默认地址 | api.openai.com | api.anthropic.com | generativelanguage.googleapis.com | localhost:11434 |

---

## 第三部分：执行文档

### 3.1 文件结构

```
src/main/llm/
├── index.ts                              ─ 模块入口，统一导出
├── types.ts                              ─ 类型定义（所有接口）
├── provider-interface.ts                 ─ LLMProvider 统一接口定义
│
├── registry/
│   └── provider-registry.ts              ─ ProviderRegistry 实现
│
├── router/
│   ├── model-router.ts                   ─ ModelRouter 主类
│   ├── router-rules.ts                   ─ 内置路由规则
│   └── fallback-handler.ts              ─ 降级策略处理器
│
├── providers/
│   ├── base-provider.ts                  ─ 基础 Provider 抽象类
│   ├── openai.ts                         ─ OpenAI Provider
│   ├── claude.ts                         ─ Claude Provider
│   ├── gemini.ts                         ─ Gemini Provider
│   └── ollama.ts                         ─ Ollama Provider
│
├── config/
│   ├── config-manager.ts                 ─ ConfigManager 实现
│   └── llm-config.ts                     ─ LLM 配置项定义 + 默认值
│
├── observer/
│   ├── llm-observer.ts                   ─ LLMObserver 实现
│   └── observer-store.ts                 ─ 观测记录存储（内存 + 可选持久化）
│
└── __tests__/
    ├── provider-interface.test.ts
    ├── provider-registry.test.ts
    ├── model-router.test.ts
    ├── fallback-handler.test.ts
    ├── openai.test.ts
    ├── claude.test.ts
    ├── gemini.test.ts
    ├── ollama.test.ts
    ├── config-manager.test.ts
    ├── llm-observer.test.ts
    └── integration/
        └── full-llm-flow.test.ts         ─ 全流程集成测试
```

### 3.2 核心类实现说明

#### BaseProvider（providers/base-provider.ts）

```typescript
/**
 * 基础 Provider 抽象类
 * 提供通用的请求发送、重试、错误处理逻辑
 */
abstract class BaseProvider implements LLMProvider {
  abstract readonly metadata: ProviderMetadata;

  protected baseUrl: string;
  protected apiKey?: string;
  protected config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.config = config;
  }

  /**
   * 发送 HTTP 请求并处理响应
   * 内置重试逻辑和超时控制
   */
  protected async request<T>(
    path: string,
    body: unknown,
    options?: { timeout?: number; retryCount?: number },
  ): Promise<T> {
    const timeout = options?.timeout ?? this.config.timeout ?? 60000;
    const maxRetries = options?.retryCount ?? this.config.maxRetries ?? 3;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.getAuthHeaders(),
            ...this.config.headers,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw await this.parseErrorResponse(response);
        }

        return await response.json() as T;
      } catch (error: any) {
        lastError = error;

        // 认证错误不重试
        if (error.status === 401 || error.status === 403) {
          throw error;
        }

        // 限流错误等待后重试
        if (error.status === 429 && attempt < maxRetries) {
          const retryAfter = parseInt(error.headers?.['retry-after'] || '5', 10);
          await this.delay(retryAfter * 1000);
          continue;
        }

        // 最后一次尝试失败则抛出
        if (attempt === maxRetries) {
          throw error;
        }

        // 指数退避
        await this.delay(Math.min(1000 * Math.pow(2, attempt), 16000));
      }
    }

    throw lastError || new Error('Unexpected error');
  }

  /**
   * 流式请求
   * 返回 AsyncIterable，逐 chunk 处理
   */
  protected async *streamRequest(
    path: string,
    body: unknown,
    options?: { timeout?: number },
  ): AsyncIterable<string> {
    const timeout = options?.timeout ?? this.config.timeout ?? 60000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
          ...this.config.headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw await this.parseErrorResponse(response);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            yield line.slice(6);
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** 获取认证头（子类实现） */
  protected abstract getAuthHeaders(): Record<string, string>;

  /** 解析错误响应（子类实现） */
  protected abstract parseErrorResponse(response: Response): Promise<Error>;

  abstract chat(messages: Message[], tools?: ToolDefinition[], options?: ChatOptions): Promise<LLMResponse>;
  abstract chatStream(messages: Message[], tools?: ToolDefinition[], options?: ChatOptions): AsyncIterable<LLMChunk>;
  abstract healthCheck(): Promise<HealthCheckResult>;

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

#### OpenAIProvider（providers/openai.ts）

```typescript
class OpenAIProvider extends BaseProvider {
  readonly metadata: ProviderMetadata = {
    id: 'openai',
    displayName: 'OpenAI',
    supportedModels: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'gpt-4.1', 'gpt-4.1-mini'],
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsEmbedding: true,
    version: '1.0.0',
  };

  protected getAuthHeaders(): Record<string, string> {
    return { 'Authorization': `Bearer ${this.apiKey}` };
  }

  protected parseErrorResponse(response: Response): Error {
    // 解析 OpenAI 错误格式
    // { error: { message, type, code, param } }
    return new Error(`OpenAI API error: ${response.status}`);
  }

  async chat(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    const body = this.buildRequestBody(messages, tools, options);
    const data = await this.request('/chat/completions', body, {
      timeout: options?.timeout,
      retryCount: options?.retryCount,
    });

    const choice = data.choices[0];
    return {
      message: {
        role: 'assistant',
        content: choice.message?.content || '',
        tool_calls: this.parseToolCalls(choice.message?.tool_calls),
      },
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
        cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens,
      },
      model: data.model,
      requestId: data.id,
      durationMs: Date.now() - startTime,
      truncated: choice.finish_reason === 'length',
      finishReason: choice.finish_reason === 'tool_calls' ? 'tool_calls'
        : choice.finish_reason === 'stop' ? 'stop'
        : choice.finish_reason === 'length' ? 'length'
        : 'error',
    };
  }

  async *chatStream(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): AsyncIterable<LLMChunk> {
    const body = this.buildRequestBody(messages, tools, { ...options, stream: true });

    for await (const line of this.streamRequest('/chat/completions', body)) {
      if (line === '[DONE]') {
        yield { content: '', isLast: true, finishReason: 'stop' };
        break;
      }

      const data = JSON.parse(line);
      const delta = data.choices?.[0]?.delta;
      const finishReason = data.choices?.[0]?.finish_reason;

      if (finishReason) {
        yield {
          content: delta?.content || '',
          toolCallDelta: delta?.tool_calls?.[0]?.function?.arguments,
          isLast: true,
          finishReason: finishReason === 'tool_calls' ? 'tool_calls'
            : finishReason === 'length' ? 'length' : 'stop',
        };
      } else {
        yield {
          content: delta?.content || '',
          toolCallDelta: delta?.tool_calls?.[0]?.function?.arguments,
          isLast: false,
        };
      }
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      await this.request('/models', undefined, { timeout: 5000 });
      return {
        available: true,
        latencyMs: Date.now() - startTime,
        model: this.config.defaultModel,
      };
    } catch (e: any) {
      return {
        available: false,
        latencyMs: Date.now() - startTime,
        model: this.config.defaultModel,
        error: e.message,
      };
    }
  }

  private buildRequestBody(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions & { stream?: boolean },
  ): Record<string, unknown> {
    return {
      model: options?.extra?.model || this.config.defaultModel,
      messages: this.convertMessages(messages),
      tools: tools ? this.convertTools(tools) : undefined,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
      top_p: options?.topP ?? 1.0,
      stop: options?.stop,
      stream: options?.stream ?? false,
    };
  }

  private convertMessages(messages: Message[]): unknown[] {
    return messages.map(m => {
      if (m.role === 'system' && typeof m.content === 'string') {
        return { role: 'system', content: m.content };
      }
      if (m.role === 'user') {
        return { role: 'user', content: typeof m.content === 'string'
          ? m.content : this.convertContentParts(m.content) };
      }
      if (m.role === 'assistant') {
        const msg: any = { role: 'assistant', content: typeof m.content === 'string' ? m.content : '' };
        if ((m as AssistantMessage).tool_calls) {
          msg.tool_calls = (m as AssistantMessage).tool_calls!.map(tc => ({
            id: tc.toolCallId,
            type: 'function',
            function: { name: tc.toolName, arguments: JSON.stringify(tc.arguments) },
          }));
        }
        return msg;
      }
      if (m.role === 'tool') {
        const tc = m.content as ToolResultContent;
        return { role: 'tool', tool_call_id: tc.toolCallId, content: JSON.stringify(tc.result) };
      }
      return m;
    });
  }

  private convertTools(tools: ToolDefinition[]): unknown[] {
    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  private parseToolCalls(toolCalls?: any[]): ToolCallContent[] | undefined {
    if (!toolCalls?.length) return undefined;
    return toolCalls.map(tc => ({
      type: 'tool_call',
      toolCallId: tc.id,
      toolName: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));
  }

  private convertContentParts(content: MessageContent[]): unknown[] {
    return content.map(c => {
      if (c.type === 'text') return { type: 'text', text: (c as TextContent).text };
      if (c.type === 'image') {
        const img = c as ImageContent;
        return { type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } };
      }
      return c;
    });
  }
}
```

#### ClaudeProvider（providers/claude.ts）

```typescript
class ClaudeProvider extends BaseProvider {
  readonly metadata: ProviderMetadata = {
    id: 'claude',
    displayName: 'Claude (Anthropic)',
    supportedModels: [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-opus-4-20250514',
      'claude-sonnet-4-20250514',
    ],
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsEmbedding: false,
    version: '1.0.0',
  };

  private apiVersion: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.apiVersion = config.apiVersion || '2023-06-01';
  }

  protected getAuthHeaders(): Record<string, string> {
    return {
      'x-api-key': this.apiKey!,
      'anthropic-version': this.apiVersion,
    };
  }

  protected parseErrorResponse(response: Response): Error {
    // 解析 Claude 错误格式
    // { error: { type, message } }
    return new Error(`Claude API error: ${response.status}`);
  }

  async chat(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    const body = this.buildRequestBody(messages, tools, options);
    const data = await this.request('/messages', body, {
      timeout: options?.timeout,
      retryCount: options?.retryCount,
    });

    return this.parseResponse(data, startTime);
  }

  async *chatStream(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): AsyncIterable<LLMChunk> {
    const body = this.buildRequestBody(messages, tools, { ...options, stream: true });

    for await (const line of this.streamRequest('/messages', body)) {
      const event = this.parseSSEEvent(line);
      if (!event) continue;

      switch (event.type) {
        case 'content_block_delta':
          if (event.delta?.type === 'text_delta') {
            yield { content: event.delta.text, isLast: false };
          } else if (event.delta?.type === 'input_json_delta') {
            yield { content: '', toolCallDelta: event.delta.partial_json, isLast: false };
          }
          break;
        case 'message_delta':
          if (event.delta?.stop_reason) {
            yield {
              content: '',
              isLast: true,
              finishReason: event.delta.stop_reason === 'tool_use' ? 'tool_calls'
                : event.delta.stop_reason === 'max_tokens' ? 'length'
                : 'stop',
              usage: event.usage,
            };
          }
          break;
        case 'message_stop':
          yield { content: '', isLast: true, finishReason: 'stop' };
          break;
        case 'error':
          yield { content: '', isLast: true, finishReason: 'error' };
          break;
      }
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      const body = {
        model: this.config.defaultModel,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }],
      };
      await this.request('/messages', body, { timeout: 5000 });
      return {
        available: true,
        latencyMs: Date.now() - startTime,
        model: this.config.defaultModel,
      };
    } catch (e: any) {
      return {
        available: false,
        latencyMs: Date.now() - startTime,
        model: this.config.defaultModel,
        error: e.message,
      };
    }
  }

  private buildRequestBody(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions & { stream?: boolean },
  ): Record<string, unknown> {
    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');

    return {
      model: options?.extra?.model || this.config.defaultModel,
      system: typeof systemMsg?.content === 'string' ? systemMsg.content : undefined,
      messages: this.convertMessages(nonSystemMsgs),
      tools: tools ? this.convertTools(tools) : undefined,
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      top_p: options?.topP ?? 1.0,
      stop_sequences: options?.stop,
      stream: options?.stream ?? false,
    };
  }

  private convertMessages(messages: Message[]): unknown[] {
    // Claude 消息格式转换
    return messages.map(m => {
      if (m.role === 'user') {
        return { role: 'user', content: typeof m.content === 'string'
          ? m.content : this.convertContentParts(m.content) };
      }
      if (m.role === 'assistant') {
        const msg: any = { role: 'assistant' };
        const toolCalls = (m as AssistantMessage).tool_calls;
        if (toolCalls?.length) {
          msg.content = [
            { type: 'text', text: typeof m.content === 'string' ? m.content : '' },
            ...toolCalls.map(tc => ({
              type: 'tool_use',
              id: tc.toolCallId,
              name: tc.toolName,
              input: tc.arguments,
            })),
          ];
        } else {
          msg.content = typeof m.content === 'string' ? m.content : '';
        }
        return msg;
      }
      if (m.role === 'tool') {
        const tc = m.content as ToolResultContent;
        return {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: tc.toolCallId,
            content: JSON.stringify(tc.result),
            is_error: !tc.success,
          }],
        };
      }
      return m;
    });
  }

  private convertTools(tools: ToolDefinition[]): unknown[] {
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));
  }

  private parseResponse(data: any, startTime: number): LLMResponse {
    const content = data.content || [];
    const textContent = content.find((c: any) => c.type === 'text');
    const toolUseContent = content.filter((c: any) => c.type === 'tool_use');

    return {
      message: {
        role: 'assistant',
        content: textContent?.text || '',
        tool_calls: toolUseContent.length > 0
          ? toolUseContent.map((tc: any) => ({
              type: 'tool_call',
              toolCallId: tc.id,
              toolName: tc.name,
              arguments: tc.input,
            } as ToolCallContent))
          : undefined,
      },
      usage: {
        promptTokens: data.usage?.input_tokens || 0,
        completionTokens: data.usage?.output_tokens || 0,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
        cachedTokens: data.usage?.cache_creation_input_tokens || data.usage?.cache_read_input_tokens,
      },
      model: data.model,
      requestId: data.id,
      durationMs: Date.now() - startTime,
      truncated: data.stop_reason === 'max_tokens',
      finishReason: data.stop_reason === 'tool_use' ? 'tool_calls'
        : data.stop_reason === 'end_turn' ? 'stop'
        : data.stop_reason === 'max_tokens' ? 'length'
        : 'error',
    };
  }

  private parseSSEEvent(line: string): { type: string; delta?: any; usage?: any } | null {
    if (!line.startsWith('event:') && !line.startsWith('data:')) return null;

    // 处理 Anthropic SSE 格式
    // event: message_start
    // data: {...}
    try {
      if (line.startsWith('data:')) {
        return JSON.parse(line.slice(6));
      }
      return null;
    } catch {
      return null;
    }
  }
}
```

#### GeminiProvider（providers/gemini.ts）

```typescript
class GeminiProvider extends BaseProvider {
  readonly metadata: ProviderMetadata = {
    id: 'gemini',
    displayName: 'Gemini (Google)',
    supportedModels: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-pro'],
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsEmbedding: true,
    version: '1.0.0',
  };

  protected getAuthHeaders(): Record<string, string> {
    return { 'x-goog-api-key': this.apiKey! };
  }

  protected parseErrorResponse(response: Response): Error {
    return new Error(`Gemini API error: ${response.status}`);
  }

  async chat(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    const model = options?.extra?.model || this.config.defaultModel;
    const body = this.buildRequestBody(messages, tools, options);
    const data = await this.request(
      `/models/${model}:generateContent`,
      body,
      { timeout: options?.timeout, retryCount: options?.retryCount },
    );

    return this.parseResponse(data, model, startTime);
  }

  async *chatStream(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): AsyncIterable<LLMChunk> {
    const model = options?.extra?.model || this.config.defaultModel;
    const body = this.buildRequestBody(messages, tools, { ...options, stream: true });

    for await (const line of this.streamRequest(`/models/${model}:streamGenerateContent`, body)) {
      if (!line.trim()) continue;
      const data = JSON.parse(line);
      const candidate = data.candidates?.[0];
      if (!candidate) continue;

      const part = candidate.content?.parts?.[0];
      const finishReason = candidate.finishReason;

      if (finishReason) {
        yield {
          content: part?.text || '',
          isLast: true,
          finishReason: finishReason === 'TOOL_CALL' ? 'tool_calls'
            : finishReason === 'MAX_TOKENS' ? 'length'
            : finishReason === 'STOP' ? 'stop'
            : 'error',
        };
      } else {
        yield {
          content: part?.text || '',
          toolCallDelta: part?.functionCall?.args ? JSON.stringify(part.functionCall.args) : undefined,
          isLast: false,
        };
      }
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      const model = this.config.defaultModel;
      await this.request(
        `/models/${model}:generateContent`,
        { contents: [{ parts: [{ text: 'ping' }] }] },
        { timeout: 5000 },
      );
      return {
        available: true,
        latencyMs: Date.now() - startTime,
        model,
      };
    } catch (e: any) {
      return {
        available: false,
        latencyMs: Date.now() - startTime,
        model: this.config.defaultModel,
        error: e.message,
      };
    }
  }

  private buildRequestBody(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions & { stream?: boolean },
  ): Record<string, unknown> {
    return {
      contents: this.convertMessages(messages),
      tools: tools ? [{ function_declarations: this.convertTools(tools) }] : undefined,
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens ?? 4096,
        topP: options?.topP ?? 1.0,
        stopSequences: options?.stop,
      },
      systemInstruction: this.extractSystemMessage(messages),
    };
  }

  private convertMessages(messages: Message[]): unknown[] {
    // Gemini 角色只有 user / model，无 system
    return messages
      .filter(m => m.role !== 'system')
      .map(m => {
        const role = m.role === 'assistant' ? 'model' : 'user';
        const toolCalls = (m as AssistantMessage).tool_calls;

        if (toolCalls?.length) {
          return {
            role,
            parts: [
              ...(typeof m.content === 'string' && m.content ? [{ text: m.content }] : []),
              ...toolCalls.map(tc => ({
                functionCall: { name: tc.toolName, args: tc.arguments },
              })),
            ],
          };
        }

        if (m.role === 'tool') {
          const tc = m.content as ToolResultContent;
          return {
            role: 'function',
            parts: [{
              functionResponse: {
                name: tc.toolCallId,
                response: { result: tc.result, success: tc.success },
              },
            }],
          };
        }

        return {
          role,
          parts: typeof m.content === 'string'
            ? [{ text: m.content }]
            : this.convertContentParts(m.content),
        };
      });
  }

  private convertTools(tools: ToolDefinition[]): unknown[] {
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    }));
  }

  private parseResponse(data: any, model: string, startTime: number): LLMResponse {
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const textPart = parts.find((p: any) => p.text);
    const functionCalls = parts.filter((p: any) => p.functionCall);

    return {
      message: {
        role: 'assistant',
        content: textPart?.text || '',
        tool_calls: functionCalls.length > 0
          ? functionCalls.map((fc: any) => ({
              type: 'tool_call',
              toolCallId: fc.functionCall.name,  // Gemini 无独立 ID
              toolName: fc.functionCall.name,
              arguments: fc.functionCall.args,
            } as ToolCallContent))
          : undefined,
      },
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount || 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata?.totalTokenCount || 0,
      },
      model,
      requestId: '',
      durationMs: Date.now() - startTime,
      truncated: candidate?.finishReason === 'MAX_TOKENS',
      finishReason: candidate?.finishReason === 'TOOL_CALL' ? 'tool_calls'
        : candidate?.finishReason === 'STOP' ? 'stop'
        : 'error',
    };
  }
}
```

#### OllamaProvider（providers/ollama.ts）

```typescript
class OllamaProvider extends BaseProvider {
  readonly metadata: ProviderMetadata = {
    id: 'ollama',
    displayName: 'Ollama (Local)',
    supportedModels: [],  // 运行时从 Ollama API 获取
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsEmbedding: false,
    version: '1.0.0',
  };

  constructor(config: ProviderConfig) {
    super(config);
    // 启动时获取可用模型列表
    this.refreshModels();
  }

  protected getAuthHeaders(): Record<string, string> {
    return {}; // Ollama 不需要认证
  }

  protected parseErrorResponse(response: Response): Error {
    return new Error(`Ollama API error: ${response.status}`);
  }

  async chat(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    const body = this.buildRequestBody(messages, tools, options);
    const data = await this.request('/api/chat', body, {
      timeout: options?.timeout,
      retryCount: options?.retryCount,
    });

    return {
      message: {
        role: 'assistant',
        content: data.message?.content || '',
        tool_calls: data.message?.tool_calls?.map((tc: any) => ({
          type: 'tool_call',
          toolCallId: `${tc.function.name}_${startTime}`,
          toolName: tc.function.name,
          arguments: tc.function.arguments,
        })) as ToolCallContent[] | undefined,
      },
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
      model: data.model,
      requestId: '',
      durationMs: Date.now() - startTime,
      truncated: false,
      finishReason: data.done ? 'stop' : 'error',
    };
  }

  async *chatStream(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): AsyncIterable<LLMChunk> {
    const body = this.buildRequestBody(messages, tools, { ...options, stream: true });

    for await (const line of this.streamRequest('/api/chat', body)) {
      if (!line.trim()) continue;
      const data = JSON.parse(line);

      yield {
        content: data.message?.content || '',
        toolCallDelta: data.message?.tool_calls?.[0]?.function?.arguments,
        isLast: data.done || false,
        finishReason: data.done ? 'stop' : undefined,
      };
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const data = await response.json() as { models: Array<{ name: string }> };
        this.metadata.supportedModels = data.models?.map(m => m.name) || [];
      }
      return {
        available: response.ok,
        latencyMs: Date.now() - startTime,
        model: this.config.defaultModel,
      };
    } catch (e: any) {
      return {
        available: false,
        latencyMs: Date.now() - startTime,
        model: this.config.defaultModel,
        error: e.message,
      };
    }
  }

  private async refreshModels(): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        const data = await response.json() as { models: Array<{ name: string }> };
        this.metadata.supportedModels = data.models?.map(m => m.name) || [];
      }
    } catch {
      // 首次获取失败不影响初始化
    }
  }

  private buildRequestBody(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions & { stream?: boolean },
  ): Record<string, unknown> {
    return {
      model: options?.extra?.model || this.config.defaultModel,
      messages: this.convertMessages(messages),
      tools: tools ? this.convertTools(tools) : undefined,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens ?? 4096,
        top_p: options?.topP ?? 1.0,
        stop: options?.stop,
      },
      stream: options?.stream ?? false,
    };
  }

  private convertMessages(messages: Message[]): unknown[] {
    // Ollama 消息格式兼容 OpenAI
    return messages.map(m => {
      if (m.role === 'system' && typeof m.content === 'string') {
        return { role: 'system', content: m.content };
      }
      if (m.role === 'user') {
        return { role: 'user', content: typeof m.content === 'string' ? m.content : '' };
      }
      if (m.role === 'assistant') {
        const msg: any = { role: 'assistant', content: typeof m.content === 'string' ? m.content : '' };
        const toolCalls = (m as AssistantMessage).tool_calls;
        if (toolCalls?.length) {
          msg.tool_calls = toolCalls.map(tc => ({
            type: 'function',
            function: { name: tc.toolName, arguments: tc.arguments },
          }));
        }
        return msg;
      }
      if (m.role === 'tool') {
        const tc = m.content as ToolResultContent;
        return { role: 'tool', content: JSON.stringify(tc.result) };
      }
      return m;
    });
  }

  private convertTools(tools: ToolDefinition[]): unknown[] {
    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }
}
```

#### ModelRouter（router/model-router.ts）

```typescript
class DefaultModelRouter implements IModelRouter {
  private registry: IProviderRegistry;
  private config: RouterConfig;
  private rules: RouterRule[] = [];
  private stats: RouterStats = {
    totalResolves: 0,
    routeDistribution: {},
    fallbackCount: 0,
    fallbackReasons: {},
    avgLatencyMs: 0,
  };

  // 降级状态跟踪
  private failureCounts: Map<string, number> = new Map();
  private degradedProviders: Set<string> = new Set();
  private recoveryTimers: Map<string, NodeJS.Timeout> = new Map();
  private lastResolveTime: number = 0;

  constructor(registry: IProviderRegistry, config: RouterConfig) {
    this.registry = registry;
    this.config = config;
    this.registerBuiltinRules();
  }

  async resolve(context: RouterContext): Promise<ResolvedModel> {
    const startTime = Date.now();
    this.stats.totalResolves++;

    // 1. 先尝试自定义规则
    for (const rule of [...this.rules].sort((a, b) => b.priority - a.priority)) {
      if (rule.match(context)) {
        if (rule.target === 'fallback') break;
        this.updateStats(rule.target.providerId, Date.now() - startTime);
        return rule.target;
      }
    }

    // 2. 工作区指定路由
    if (context.workspaceId && this.config.workspaces?.[context.workspaceId]) {
      const target = this.config.workspaces[context.workspaceId]!;
      if (!this.isDegraded(target.providerId)) {
        this.updateStats(target.providerId, Date.now() - startTime);
        return target;
      }
    }

    // 3. 任务类型路由
    if (context.taskType && this.config.taskTypes?.[context.taskType]) {
      const target = this.config.taskTypes[context.taskType]!;
      if (!this.isDegraded(target.providerId)) {
        this.updateStats(target.providerId, Date.now() - startTime);
        return target;
      }
    }

    // 4. 默认路由
    const defaultTarget = this.config.default;
    if (!this.isDegraded(defaultTarget.providerId)) {
      this.updateStats(defaultTarget.providerId, Date.now() - startTime);
      return defaultTarget;
    }

    // 5. 降级：从 fallback 列表中选择第一个可用的
    const fallbackResult = await this.selectFallback(context);
    this.updateStats(fallbackResult.providerId, Date.now() - startTime);
    return fallbackResult;
  }

  /**
   * 报告调用结果（成功/失败），用于降级决策
   */
  reportResult(providerId: string, success: boolean, error?: string): void {
    if (success) {
      this.failureCounts.set(providerId, 0);
      return;
    }

    const count = (this.failureCounts.get(providerId) || 0) + 1;
    this.failureCounts.set(providerId, count);

    if (count >= this.config.fallback.conditions.maxConsecutiveFailures) {
      this.triggerDegradation(providerId, `连续失败 ${count} 次`);
    }
  }

  registerRule(rule: RouterRule): void {
    this.rules.push(rule);
  }

  getConfig(): RouterConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<RouterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getStats(): RouterStats {
    return { ...this.stats };
  }

  private registerBuiltinRules(): void {
    // 内置规则：需要工具调用的请求排除不支持 Function Calling 的模型
    this.rules.push({
      name: 'requires-tools',
      match: (ctx) => ctx.requiresTools,
      target: 'fallback',  // 走降级检查
      priority: 100,
    });
  }

  private isDegraded(providerId: string): boolean {
    return this.degradedProviders.has(providerId);
  }

  private triggerDegradation(providerId: string, reason: string): void {
    this.degradedProviders.add(providerId);
    this.stats.fallbackCount++;
    this.stats.fallbackReasons[reason] = (this.stats.fallbackReasons[reason] || 0) + 1;

    // 设置恢复检查定时器
    if (this.recoveryTimers.has(providerId)) {
      clearTimeout(this.recoveryTimers.get(providerId)!);
    }
    this.recoveryTimers.set(providerId, setTimeout(async () => {
      const provider = this.registry.get(providerId);
      if (provider) {
        const health = await provider.healthCheck();
        if (health.available) {
          this.degradedProviders.delete(providerId);
          this.failureCounts.set(providerId, 0);
        }
      }
    }, this.config.fallback.recoveryCheckIntervalMs));
  }

  private async selectFallback(context: RouterContext): Promise<ResolvedModel> {
    for (const fallback of this.config.fallback.fallbacks) {
      if (!this.isDegraded(fallback.providerId)) {
        const provider = this.registry.get(fallback.providerId);
        if (provider) {
          const health = await provider.healthCheck();
          if (health.available) {
            return fallback;
          }
        }
      }
    }
    // 所有 fallback 都不可用，返回第一个 fallback 作为最后尝试
    return this.config.fallback.fallbacks[0]!;
  }

  private updateStats(providerId: string, latencyMs: number): void {
    this.stats.routeDistribution[providerId] = (this.stats.routeDistribution[providerId] || 0) + 1;
    // 平滑平均延迟
    const total = this.stats.totalResolves;
    this.stats.avgLatencyMs = this.stats.avgLatencyMs * (total - 1) / total + latencyMs / total;
  }
}
```

#### LLMObserver（observer/llm-observer.ts）

```typescript
class DefaultLLMObserver implements ILLMObserver {
  private records: LLMCallRecord[] = [];
  private maxRecords: number;
  private listeners: Array<(record: LLMCallRecord) => void> = [];
  private recordCounter: number = 0;

  constructor(maxRecords: number = 10000) {
    this.maxRecords = maxRecords;
  }

  async wrap<T>(providerId: string, model: string, call: () => Promise<T>): Promise<T> {
    const startTime = Date.now();
    const requestId = `llm_${providerId}_${++this.recordCounter}`;

    try {
      const result = await call() as any;
      const durationMs = Date.now() - startTime;

      // 尝试从结果中提取 usage 信息
      const response = result as LLMResponse | undefined;
      this.record({
        requestId,
        providerId,
        model,
        promptTokens: response?.usage?.promptTokens || 0,
        completionTokens: response?.usage?.completionTokens || 0,
        totalTokens: response?.usage?.totalTokens || 0,
        cachedTokens: response?.usage?.cachedTokens,
        durationMs,
        success: true,
        finishReason: response?.finishReason || 'stop',
        timestamp: Date.now(),
      });

      return result;
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      this.record({
        requestId,
        providerId,
        model,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        durationMs,
        success: false,
        finishReason: 'error',
        error: error.message,
        timestamp: Date.now(),
      });
      throw error;
    }
  }

  record(callRecord: LLMCallRecord): void {
    this.records.push(callRecord);

    // 限制最大记录数
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }

    // 通知监听器
    for (const listener of this.listeners) {
      try {
        listener(callRecord);
      } catch {
        // 监听器异常不影响正常流程
      }
    }
  }

  query(filter?: CallRecordFilter): LLMCallRecord[] {
    let result = [...this.records];

    if (filter) {
      if (filter.providerId) result = result.filter(r => r.providerId === filter.providerId);
      if (filter.model) result = result.filter(r => r.model === filter.model);
      if (filter.success !== undefined) result = result.filter(r => r.success === filter.success);
      if (filter.startTime) result = result.filter(r => r.timestamp >= filter.startTime!);
      if (filter.endTime) result = result.filter(r => r.timestamp <= filter.endTime!);
      if (filter.limit) {
        const offset = filter.offset || 0;
        result = result.slice(offset, offset + filter.limit);
      }
    }

    return result;
  }

  getStats(timeRange?: { start: number; end: number }): CallStats {
    let filtered = this.records;
    if (timeRange) {
      filtered = filtered.filter(r =>
        r.timestamp >= timeRange.start && r.timestamp <= timeRange.end,
      );
    }

    const totalCalls = filtered.length;
    if (totalCalls === 0) {
      return {
        totalCalls: 0, totalTokens: 0, totalPromptTokens: 0,
        totalCompletionTokens: 0, totalCachedTokens: 0,
        avgDurationMs: 0, successRate: 1,
        byProvider: {}, byModel: {},
      };
    }

    const byProvider: Record<string, ProviderCallStats> = {};
    const byModel: Record<string, ModelCallStats> = {};

    for (const record of filtered) {
      // 按 Provider 统计
      if (!byProvider[record.providerId]) {
        byProvider[record.providerId] = { callCount: 0, totalTokens: 0, avgDurationMs: 0, successRate: 0 };
      }
      const ps = byProvider[record.providerId]!;
      ps.callCount++;
      ps.totalTokens += record.totalTokens;
      ps.avgDurationMs = ps.avgDurationMs * (ps.callCount - 1) / ps.callCount + record.durationMs / ps.callCount;
      ps.successRate = ps.successRate * (ps.callCount - 1) / ps.callCount + (record.success ? 1 : 0) / ps.callCount;

      // 按模型统计
      if (!byModel[record.model]) {
        byModel[record.model] = { callCount: 0, totalTokens: 0, avgDurationMs: 0, successRate: 0 };
      }
      const ms = byModel[record.model]!;
      ms.callCount++;
      ms.totalTokens += record.totalTokens;
      ms.avgDurationMs = ms.avgDurationMs * (ms.callCount - 1) / ms.callCount + record.durationMs / ms.callCount;
      ms.successRate = ms.successRate * (ms.callCount - 1) / ms.callCount + (record.success ? 1 : 0) / ms.callCount;
    }

    const totalSuccess = filtered.filter(r => r.success).length;

    return {
      totalCalls,
      totalTokens: filtered.reduce((s, r) => s + r.totalTokens, 0),
      totalPromptTokens: filtered.reduce((s, r) => s + r.promptTokens, 0),
      totalCompletionTokens: filtered.reduce((s, r) => s + r.completionTokens, 0),
      totalCachedTokens: filtered.reduce((s, r) => s + (r.cachedTokens || 0), 0),
      avgDurationMs: filtered.reduce((s, r) => s + r.durationMs, 0) / totalCalls,
      successRate: totalSuccess / totalCalls,
      byProvider,
      byModel,
    };
  }

  export(): LLMCallRecord[] {
    return [...this.records];
  }

  onCallRecorded(callback: (record: LLMCallRecord) => void): void {
    this.listeners.push(callback);
  }
}
```

#### ConfigManager（config/config-manager.ts）

```typescript
class DefaultLLMConfigManager implements ILLMConfigManager {
  private db: betterSqlite3.Database;
  private listeners: Array<(event: ConfigChangeEvent) => void> = [];

  constructor(db: betterSqlite3.Database) {
    this.db = db;
  }

  async getProviderConfigs(): Promise<Record<string, ProviderConfig>> {
    const row = this.db.prepare(
      "SELECT value FROM config WHERE key = 'llm_providers'",
    ).get() as { value: string } | undefined;

    if (!row) return {};
    return JSON.parse(row.value);
  }

  async getProviderConfig(id: string): Promise<ProviderConfig | undefined> {
    const configs = await this.getProviderConfigs();
    return configs[id];
  }

  async updateProviderConfig(id: string, config: Partial<ProviderConfig>): Promise<void> {
    const configs = await this.getProviderConfigs();
    configs[id] = { ...configs[id], ...config } as ProviderConfig;
    this.saveProviderConfigs(configs);
    this.notify({ type: 'provider_updated', providerId: id, timestamp: Date.now() });
  }

  async removeProviderConfig(id: string): Promise<void> {
    const configs = await this.getProviderConfigs();
    delete configs[id];
    this.saveProviderConfigs(configs);
    this.notify({ type: 'provider_removed', providerId: id, timestamp: Date.now() });
  }

  async getRouterConfig(): Promise<RouterConfig> {
    const defaultRow = this.db.prepare(
      "SELECT value FROM config WHERE key = 'llm_router_default'",
    ).get() as { value: string } | undefined;

    const taskTypesRow = this.db.prepare(
      "SELECT value FROM config WHERE key = 'llm_router_task_types'",
    ).get() as { value: string } | undefined;

    const fallbackRow = this.db.prepare(
      "SELECT value FROM config WHERE key = 'llm_router_fallback'",
    ).get() as { value: string } | undefined;

    return {
      default: defaultRow ? JSON.parse(defaultRow.value) : { providerId: 'openai', model: 'gpt-4o' },
      taskTypes: taskTypesRow ? JSON.parse(taskTypesRow.value) : undefined,
      fallback: fallbackRow ? JSON.parse(fallbackRow.value) : {
        fallbacks: [
          { providerId: 'openai', model: 'gpt-4o-mini' },
          { providerId: 'ollama', model: 'qwen2.5:7b' },
        ],
        conditions: { maxConsecutiveFailures: 3, timeoutThreshold: 120000 },
        recoveryCheckIntervalMs: 300000,
      },
    };
  }

  async updateRouterConfig(config: Partial<RouterConfig>): Promise<void> {
    if (config.default) {
      this.setConfig('llm_router_default', JSON.stringify(config.default), 'json');
    }
    if (config.taskTypes) {
      this.setConfig('llm_router_task_types', JSON.stringify(config.taskTypes), 'json');
    }
    if (config.fallback) {
      this.setConfig('llm_router_fallback', JSON.stringify(config.fallback), 'json');
    }
    this.notify({ type: 'router_updated', timestamp: Date.now() });
  }

  onConfigChanged(callback: (event: ConfigChangeEvent) => void): void {
    this.listeners.push(callback);
  }

  private saveProviderConfigs(configs: Record<string, ProviderConfig>): void {
    this.setConfig('llm_providers', JSON.stringify(configs), 'json');
  }

  private setConfig(key: string, value: string, valueType: string): void {
    this.db.prepare(`
      INSERT INTO config (key, value, value_type, updated_at)
      VALUES (?, ?, ?, unixepoch())
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()
    `).run(key, value, valueType);
  }

  private notify(event: ConfigChangeEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* ignore */ }
    }
  }
}
```

### 3.3 集成方式

```typescript
// Agent Core 初始化时
import { ProviderRegistry } from './llm/registry/provider-registry';
import { DefaultModelRouter } from './llm/router/model-router';
import { DefaultLLMObserver } from './llm/observer/llm-observer';
import { DefaultLLMConfigManager } from './llm/config/config-manager';
import { OpenAIProvider } from './llm/providers/openai';
import { ClaudeProvider } from './llm/providers/claude';
import { GeminiProvider } from './llm/providers/gemini';
import { OllamaProvider } from './llm/providers/ollama';
import type { RouterConfig } from './llm/types';

// 1. 创建观测器
const observer = new DefaultLLMObserver();

// 2. 注册 Provider
const openai = new OpenAIProvider({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: 'gpt-4o',
});

const claude = new ClaudeProvider({
  baseUrl: 'https://api.anthropic.com/v1',
  apiKey: process.env.ANTHROPIC_API_KEY!,
  defaultModel: 'claude-3-5-sonnet-20241022',
});

const gemini = new GeminiProvider({
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  apiKey: process.env.GEMINI_API_KEY!,
  defaultModel: 'gemini-2.0-flash',
});

const ollama = new OllamaProvider({
  baseUrl: 'http://localhost:11434',
  defaultModel: 'qwen2.5:7b',
});

ProviderRegistry.register('openai', openai);
ProviderRegistry.register('claude', claude);
ProviderRegistry.register('gemini', gemini);
ProviderRegistry.register('ollama', ollama);

// 3. 创建路由
const routerConfig: RouterConfig = {
  default: { providerId: 'openai', model: 'gpt-4o', options: { temperature: 0.7 } },
  taskTypes: {
    complex: { providerId: 'openai', model: 'gpt-4o', options: { temperature: 0.5, maxTokens: 8192 } },
    simple: { providerId: 'openai', model: 'gpt-4o-mini', options: { temperature: 0.3, maxTokens: 2048 } },
    chat: { providerId: 'gemini', model: 'gemini-2.0-flash', options: { temperature: 0.7 } },
  },
  fallback: {
    fallbacks: [
      { providerId: 'openai', model: 'gpt-4o-mini', options: {} },
      { providerId: 'ollama', model: 'qwen2.5:7b', options: {} },
    ],
    conditions: { maxConsecutiveFailures: 3, timeoutThreshold: 120000 },
    recoveryCheckIntervalMs: 300000,
  },
};

const router = new DefaultModelRouter(ProviderRegistry, routerConfig);

// 4. 发送消息
async function sendMessage(messages: Message[], tools?: ToolDefinition[], taskType?: string) {
  const resolved = await router.resolve({
    workspaceId: 'ws-1',
    taskType: taskType as any,
    requiresTools: !!tools,
    requiresStreaming: false,
  });

  const provider = ProviderRegistry.get(resolved.providerId)!;

  // 使用观测器包装调用
  const response = await observer.wrap(
    resolved.providerId,
    resolved.model,
    () => provider.chat(messages, tools, resolved.options),
  );

  // 报告路由结果
  router.reportResult(resolved.providerId, true);

  // 记录观测数据
  console.log(`LLM call: provider=${resolved.providerId}, model=${resolved.model}, tokens=${response.usage.totalTokens}, duration=${response.durationMs}ms`);

  return response;
}
```

### 3.4 实施步骤

| 步骤 | 任务 | 产出物 | 预估工时 |
|:----:|------|--------|:--------:|
| 1 | 创建类型定义 `types.ts`（所有接口 + 消息格式） | `src/main/llm/types.ts` | 3h |
| 2 | 实现 LLMProvider 接口定义 + BaseProvider 抽象类 | `src/main/llm/provider-interface.ts` + `src/main/llm/providers/base-provider.ts` | 3h |
| 3 | 实现 OpenAIProvider | `src/main/llm/providers/openai.ts` | 4h |
| 4 | 实现 ClaudeProvider | `src/main/llm/providers/claude.ts` | 4h |
| 5 | 实现 GeminiProvider | `src/main/llm/providers/gemini.ts` | 4h |
| 6 | 实现 OllamaProvider | `src/main/llm/providers/ollama.ts` | 3h |
| 7 | 实现 ProviderRegistry | `src/main/llm/registry/provider-registry.ts` | 2h |
| 8 | 实现 ModelRouter + 内置路由规则 | `src/main/llm/router/model-router.ts` + `src/main/llm/router/router-rules.ts` | 6h |
| 9 | 实现 FallbackHandler（降级策略） | `src/main/llm/router/fallback-handler.ts` | 3h |
| 10 | 实现 ConfigManager（SQLite 持久化） | `src/main/llm/config/config-manager.ts` + `src/main/llm/config/llm-config.ts` | 4h |
| 11 | 实现 LLMObserver + ObserverStore | `src/main/llm/observer/llm-observer.ts` + `src/main/llm/observer/observer-store.ts` | 3h |
| 12 | 单元测试（11 个测试文件） | `__tests__/llm/` | 10h |
| 13 | 集成测试（全流程） | `__tests__/llm/integration/full-llm-flow.test.ts` | 4h |

**实施顺序**：步骤 1 → 2 → 7 → 3 → 4 → 5 → 6 → 10 → 8 → 9 → 11 → 12 → 13

### 3.5 测试计划

#### 单元测试

| 测试文件 | 覆盖内容 | 关键用例 |
|----------|----------|----------|
| `provider-interface.test.ts` | Provider 接口 | 接口一致性检查、metadata 完整性 |
| `provider-registry.test.ts` | 注册管理 | 注册/获取/注销/重复注册/healthCheck 聚合 |
| `model-router.test.ts` | 路由选择 | 工作区路由、任务类型路由、默认路由、自定义规则、降级触发 |
| `fallback-handler.test.ts` | 降级策略 | 连续失败触发、超时触发、恢复检查、全部不可用 |
| `openai.test.ts` | OpenAI Provider | chat/chatStream/healthCheck、消息转换、工具格式、错误处理 |
| `claude.test.ts` | Claude Provider | chat/chatStream/healthCheck、system 字段处理、tool_use 格式 |
| `gemini.test.ts` | Gemini Provider | chat/chatStream/healthCheck、function_declarations、role 转换 |
| `ollama.test.ts` | Ollama Provider | chat/chatStream/healthCheck、模型列表刷新、OpenAI 兼容格式 |
| `config-manager.test.ts` | 配置管理 | 读写 Provider 配置、读写路由配置、配置变更通知、默认值 |
| `llm-observer.test.ts` | 调用观测 | wrap/record/query/getStats/export、内存上限、监听器 |
| `observer-store.test.ts` | 观测存储 | 持久化读写、内存上限、查询过滤 |

#### 集成测试

| 测试场景 | 方法 |
|----------|------|
| 全流程 LLM 调用 | ProviderRegistry → ModelRouter → Provider → Observer |
| Provider 切换 | 连续两次调用不同 Provider |
| 降级触发和执行 | 模拟 Provider 连续失败 → 触发降级 → 切换到 fallback |
| 配置持久化 | 写入配置 → 模拟重启 → 读取配置 |
| 流式中断恢复 | 模拟网络中断 → 恢复后继续接收 |

#### Mock 策略

LLM Provider 的单元测试使用 Mock HTTP 服务器（如 `nock` 或 `msw`）模拟 API 响应：

| Provider | Mock URL | Mock 响应 |
|----------|----------|-----------|
| OpenAI | `https://api.openai.com/v1` | `{ choices: [{ message: { content: '...' }, finish_reason: 'stop' }], usage: {...} }` |
| Claude | `https://api.anthropic.com/v1` | `{ content: [{ type: 'text', text: '...' }], stop_reason: 'end_turn' }` |
| Gemini | `https://generativelanguage.googleapis.com/v1beta` | `{ candidates: [{ content: { parts: [{ text: '...' }] } }] }` |
| Ollama | `http://localhost:11434` | `{ message: { content: '...' }, done: true }` |

### 3.6 错误处理规范

| 错误码 | 含义 | 触发条件 | 处理方式 |
|--------|------|----------|----------|
| `LLM_001` | Provider 不可用（网络/认证） | healthCheck 失败或 API 调用 401/403 | 触发降级策略 |
| `LLM_002` | API 返回格式异常 | 响应缺少关键字段（如 choices） | 重试（最多 3 次），仍失败返回错误 |
| `LLM_003` | 响应被截断 | finish_reason='length' | 自动压缩历史后重试 |
| `LLM_004` | Function Calling 解析失败 | tool_calls 格式不合法 | 重新发送，禁用工具重试 |
| `LLM_005` | 上下文超限 | API 返回 400 上下文超限错误 | 自动截断后重试 |
| `LLM_006` | 所有 Provider 降级后仍失败 | 全部 fallback 不可用 | 通知用户手动处理 |

---

## 第四部分：性能目标

| 指标 | 目标 | 测量方式 |
|------|:----:|----------|
| Provider 路由选择 | < 1ms | `performance.now()` — 纯内存路由决策 |
| Provider 切换 | < 5ms | 从 resolve 到 provider.chat() 的准备时间 |
| 降级触发响应 | < 100ms | 从失败到切换到 fallback 的时间 |
| 观测记录写入 | < 0.1ms | 内存写入延迟 |
| 观测统计查询 | < 5ms | 10000 条记录的聚合统计 |
| 配置读取 | < 5ms | SQLite 单行查询 |
| 配置写入 | < 10ms | SQLite 单行写入 |
| Provider 初始化 | < 50ms | 从 new 到可调用（不含网络请求） |
| healthCheck 聚合 | < 6s | 4 个 Provider 并行 healthCheck（每个 5s timeout） |
| 内存占用（观测记录） | < 5MB | 10000 条 LLMCallRecord 的内存占用 |

---

## 第五部分：附录

### 5.1 配置示例汇总

**完整 LLM 配置示例**（存储在 SQLite config 表）：

```json
{
  "llm_providers": {
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "${OPENAI_API_KEY}",
      "defaultModel": "gpt-4o",
      "models": ["gpt-4o", "gpt-4o-mini", "o3-mini"]
    },
    "claude": {
      "baseUrl": "https://api.anthropic.com/v1",
      "apiKey": "${ANTHROPIC_API_KEY}",
      "defaultModel": "claude-3-5-sonnet-20241022",
      "models": ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"]
    },
    "gemini": {
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
      "apiKey": "${GEMINI_API_KEY}",
      "defaultModel": "gemini-2.0-flash",
      "models": ["gemini-2.0-flash", "gemini-2.0-flash-lite"]
    },
    "ollama": {
      "baseUrl": "http://localhost:11434",
      "defaultModel": "qwen2.5:7b",
      "models": ["qwen2.5:7b", "deepseek-r1:7b", "llama3:8b"]
    }
  },
  "llm_router_default": {
    "providerId": "openai",
    "model": "gpt-4o",
    "options": { "temperature": 0.7 }
  },
  "llm_router_task_types": {
    "complex": { "providerId": "openai", "model": "gpt-4o", "options": { "temperature": 0.5, "maxTokens": 8192 } },
    "simple": { "providerId": "openai", "model": "gpt-4o-mini", "options": { "temperature": 0.3, "maxTokens": 2048 } },
    "chat": { "providerId": "gemini", "model": "gemini-2.0-flash", "options": { "temperature": 0.7 } },
    "planning": { "providerId": "claude", "model": "claude-3-5-sonnet-20241022", "options": { "temperature": 0.2, "maxTokens": 4096 } }
  },
  "llm_router_fallback": {
    "fallbacks": [
      { "providerId": "openai", "model": "gpt-4o-mini" },
      { "providerId": "ollama", "model": "qwen2.5:7b" }
    ],
    "conditions": {
      "maxConsecutiveFailures": 3,
      "timeoutThreshold": 120000
    },
    "recoveryCheckIntervalMs": 300000
  }
}
```

### 5.2 模型参数推荐

| 场景 | 模型 | 温度 | maxTokens | 推荐理由 |
|------|------|:----:|:---------:|----------|
| 复杂任务（建造/探索） | GPT-4o / Claude-4 | 0.5 | 8192 | 强推理，复杂指令遵循 |
| 日常操作（挖矿/收集） | GPT-4o-mini | 0.3 | 2048 | 低成本，快速响应 |
| 对话交互 | Gemini 2.0 Flash | 0.7 | 4096 | 低延迟，对话流畅 |
| 任务规划 | Claude Sonnet | 0.2 | 4096 | 高质量规划，极少出错 |
| 本地部署（离线） | Qwen2.5 7B / DeepSeek | 0.5 | 4096 | 无网络依赖 |

### 5.3 与 V5 的集成点

V6 Provider 模块需要与 V5 提示词系统协作：

| V5 组件 | V6 消费者 | 交互方式 |
|---------|-----------|----------|
| `PromptBuilder.build()` | `ModelRouter.resolve()` | 将 `build()` 结果传入 `resolve()` 作为 `RouterContext` |
| `ToolPromptAssembler.assemble()` | `Provider.chat(tools)` | 组装后的工具列表传递给 Provider |
| `ContextWindowManager.trim()` | `Provider.chat(messages)` | 裁剪后的消息列表传递给 Provider |
| `AgentProfile.preferences` | `ModelRouter` 路由决策 | Agent 的偏好设置影响模型选择 |

### 5.4 扩展指南

| 扩展点 | 接口 | 后续用途 | 预计版本 |
|--------|------|----------|:--------:|
| 新 Provider | `LLMProvider` | DeepSeek / 本地 vLLM / Groq | V7+ |
| 自定义路由规则 | `RouterRule` | 基于成本的动态路由 | V8 |
| Provider 优先级权重 | `ProviderMetadata` | 成本最低优先路由 | V9 |
| 观测数据持久化 | `LLMObserver` + SQLite | 长期统计分析 | V11 |
| 多 Provider 并行 | `ModelRouter` | 同一个请求同时发往多个模型取最佳 | V13 |

---

> **更新记录**
> - 2026-07-05：初版创建，对应 V6 LLM Provider ×4 + ModelRouter 模块