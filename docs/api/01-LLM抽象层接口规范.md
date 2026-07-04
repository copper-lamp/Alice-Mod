# McAgent LLM 抽象层接口规范

> 版本：v1.0
> 日期：2026-07-04
> 范围：Provider 接口 · Model Router · 提示词系统 · Function Calling 管线 · 消息格式
> 关联文档：[00-顶层设计.md](../00-顶层设计.md)、[02-模块划分与功能简介.md](../02-模块划分与功能简介.md)、[通信协议规范.md](../protocols/01-通信协议规范.md)

---

## 第1章 概述

### 1.1 设计目标

LLM 抽象层是 Agent Core 的核心模块，在 LLM（大语言模型）与 McAgent 框架之间建立统一的接入和交互规范。其设计遵循以下原则：

| 原则 | 说明 |
|------|------|
| **Provider 化** | 所有 LLM 接入通过统一接口，切换模型不修改业务代码 |
| **无状态路由** | Model Router 按规则选择模型，不持有对话状态 |
| **格式自适应** | 自动将不同 Provider 的响应格式转换为统一的内部表示 |
| **流式优先** | 所有 Provider 优先支持流式输出，降低首 token 延迟 |
| **可观测** | 每次 LLM 调用记录 tokens 消耗、耗时、模型名称 |

### 1.2 体系位置

```
┌────────────────────────────────────────────────────────────────┐
│                        Agent Core                              │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    LLM 抽象层                             │  │
│  │                                                          │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │  │
│  │  │  Provider 接口  │  │ Model Router │  │ 提示词系统     │  │  │
│  │  │ · OpenAI      │  │ · 工作区路由  │  │ · 系统提示词   │  │  │
│  │  │ · Claude      │  │ · 任务类型路由 │  │ · 状态注入     │  │  │
│  │  │ · Gemini      │  │ · 降级策略    │  │ · 工具列表组装  │  │  │
│  │  │ · Ollama      │  │              │  │ · 上下文管理   │  │  │
│  │  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │  │
│  │         │                 │                   │           │  │
│  │  ┌──────▼─────────────────▼───────────────────▼───────┐  │  │
│  │  │               Function Calling 管线                  │  │  │
│  │  │  解析 → 构造 Batch → 发送 → 收集结果 → 回注上下文    │  │  │
│  │  └──────────────────────┬──────────────────────────────┘  │  │
│  └─────────────────────────┼────────────────────────────────┘  │
│                            │                                    │
│                    ┌───────▼───────┐                            │
│                    │  工作区管理器   │                            │
│                    └───────┬───────┘                            │
│                            │ TCP JSON-RPC                       │
└────────────────────────────┼────────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │  Adapter Core   │
                    └─────────────────┘
```

### 1.3 数据流

```
用户输入 / 事件触发
    │
    ▼
┌──────────────────────┐
│   提示词系统组装       │  ← 注入状态 + 工具列表
│   (PromptBuilder)    │
└──────────┬───────────┘
           │ messages[]
           ▼
┌──────────────────────┐
│   Model Router       │  ← 选择 Provider + 模型
│   选择最佳模型        │
└──────────┬───────────┘
           │ 路由到 Provider
           ▼
┌──────────────────────┐
│   Provider.chat()    │  ← 调用 LLM API
│   (流式/非流式)       │
└──────────┬───────────┘
           │ LLMResponse
           ▼
┌──────────────────────┐
│  Function Calling    │  ← 解析工具调用
│  管线处理             │  → 构造 JSON-RPC Batch
│                      │  → 发送 → 收集结果
└──────────┬───────────┘
           │ 执行结果
           ▼
┌──────────────────────┐
│   结果回注上下文       │  ← 注入下一轮
│   (下一轮循环)        │
└──────────────────────┘
```

---

## 第2章 Provider 接口

### 2.1 核心接口

```typescript
/**
 * LLM Provider 统一接口
 * 所有模型接入方必须实现此接口
 */
interface LLMProvider {
  /** Provider 元数据 */
  readonly metadata: ProviderMetadata;

  /** 发送消息并获取完整响应 */
  chat(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions
  ): Promise<LLMResponse>;

  /** 流式聊天，逐 chunk 返回 */
  chatStream(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions
  ): AsyncIterable<LLMChunk>;

  /** 生成嵌入向量（可选，默认由记忆系统的 EmbeddingModel 处理） */
  embed?(text: string): Promise<number[]>;

  /** 检查 Provider 可用性（连通性、API Key 有效性） */
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
  extra?: Record<string, any>;
  /** 超时时间（ms） */
  timeout?: number;              // default: 60000
  /** 重试次数 */
  retryCount?: number;           // default: 3
  /** 请求标签（用于追踪和日志） */
  requestId?: string;
}
```

### 2.2 响应格式

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

### 2.3 Provider 注册

```typescript
class ProviderRegistry {
  /** 注册一个 Provider */
  static register(id: string, provider: LLMProvider): void;

  /** 获取已注册的 Provider */
  static get(id: string): LLMProvider | undefined;

  /** 获取所有已注册的 Provider */
  static getAll(): Map<string, LLMProvider>;

  /** 注销 Provider */
  static unregister(id: string): void;

  /** 检查 Provider 是否已注册 */
  static has(id: string): boolean;
}
```

**内置 Provider**：

| Provider ID | 类名 | 协议地址 |
|------------|------|----------|
| `openai` | `OpenAIProvider` | `https://api.openai.com/v1`（可配置 baseUrl） |
| `claude` | `ClaudeProvider` | `https://api.anthropic.com/v1` |
| `gemini` | `GeminiProvider` | `https://generativelanguage.googleapis.com/v1beta` |
| `ollama` | `OllamaProvider` | `http://localhost:11434`（可配置 baseUrl） |

---

## 第3章 Model Router

### 3.1 路由接口

```typescript
interface ModelRouter {
  /** 根据上下文选择最优 Provider + 模型 */
  resolve(context: RouterContext): ResolvedModel;

  /** 注册自定义路由规则 */
  registerRule(rule: RouterRule): void;

  /** 获取当前路由配置 */
  getConfig(): RouterConfig;
}

interface RouterContext {
  /** 工作区 ID */
  workspaceId: string;
  /** 当前任务类型（如 task 指定了，则优先按任务类型路由） */
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
```

### 3.2 内置路由策略

| 策略 | 条件 | 路由目标 |
|------|------|----------|
| **工作区指定** | 工作区配置了固定模型 | 按工作区配置 |
| **任务类型路由** | `taskType=complex` | 使用强模型（如 GPT-4o, Claude-4） |
| **任务类型路由** | `taskType=simple` | 使用轻量模型（如 GPT-4o-mini） |
| **任务类型路由** | `taskType=chat` | 使用对话优化模型 |
| **降级** | 主模型不可用 | 自动切换到次级模型 |

### 3.3 降级策略

```typescript
interface FallbackStrategy {
  /** 降级顺序列表（按优先级） */
  fallbacks: ResolvedModel[];
  /** 降级条件 */
  conditions: {
    /** 连续失败次数超过此值触发降级 */
    maxConsecutiveFailures: number;   // default: 3
    /** 超时时间超过此值触发降级（ms） */
    timeoutThreshold: number;          // default: 120000
  };
  /** 降级后是否尝试恢复主模型 */
  recoveryCheckIntervalMs: number;    // default: 300000 (5min)
}
```

### 3.4 配置示例

```json
{
  "router": {
    "default": {
      "providerId": "openai",
      "model": "gpt-4o",
      "options": { "temperature": 0.7 }
    },
    "workspaces": {
      "ws-survival-1": {
        "providerId": "claude",
        "model": "claude-3-5-sonnet-20241022"
      }
    },
    "taskTypes": {
      "complex": {
        "providerId": "openai",
        "model": "gpt-4o",
        "options": { "temperature": 0.5, "maxTokens": 8192 }
      },
      "simple": {
        "providerId": "openai",
        "model": "gpt-4o-mini",
        "options": { "temperature": 0.3, "maxTokens": 2048 }
      },
      "chat": {
        "providerId": "gemini",
        "model": "gemini-2.0-flash"
      },
      "planning": {
        "providerId": "claude",
        "model": "claude-3-5-sonnet-20241022",
        "options": { "temperature": 0.2, "maxTokens": 4096 }
      }
    },
    "fallback": {
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
}
```

---

## 第4章 消息格式

### 4.1 消息类型

```typescript
type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

interface Message {
  role: MessageRole;
  content: string | MessageContent[];
  /** 消息 ID（用于追踪和引用） */
  id?: string;
  /** 时间戳 */
  timestamp?: number;
}

type MessageContent =
  | TextContent
  | ImageContent
  | ToolCallContent
  | ToolResultContent;

interface TextContent {
  type: 'text';
  text: string;
}

interface ImageContent {
  type: 'image';
  /** base64 编码的图片数据 */
  data: string;
  /** MIME 类型 */
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  /** 可选描述 */
  alt?: string;
}

interface ToolCallContent {
  type: 'tool_call';
  /** 工具调用 ID */
  toolCallId: string;
  /** 工具名称 */
  toolName: string;
  /** 工具参数（JSON 对象） */
  arguments: Record<string, any>;
}

interface ToolResultContent {
  type: 'tool_result';
  /** 工具调用 ID（对应 ToolCallContent 的 toolCallId） */
  toolCallId: string;
  /** 执行结果 */
  result: Record<string, any>;
  /** 是否执行成功 */
  success: boolean;
  /** 错误信息（当 success=false） */
  error?: string;
}
```

### 4.2 对话历史结构

```typescript
interface Conversation {
  /** 对话 ID */
  id: string;
  /** 关联的工作区 ID */
  workspaceId: string;
  /** 消息列表 */
  messages: Message[];
  /** 元数据 */
  metadata: {
    createdAt: number;
    updatedAt: number;
    messageCount: number;
    totalTokens: number;
    /** 关联的模型信息 */
    model: string;
    provider: string;
  };
}
```

### 4.3 工具定义格式

每个工具的定义采用 JSON Schema 格式，转换为 LLM 可识别的 Function Calling 参数：

```typescript
interface ToolDefinition {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 工具参数 Schema（JSON Schema 格式） */
  input_schema: {
    type: 'object';
    properties: Record<string, SchemaProperty>;
    required?: string[];
  };
}

interface SchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
  default?: any;
  minimum?: number;
  maximum?: number;
}
```

### 4.4 Provider 适配

不同 Provider 的工具定义格式不同，LLM 抽象层自动转换：

```typescript
interface ToolFormatAdapter {
  /** 将内部 ToolDefinition 转换为 Provider 格式 */
  toProviderFormat(
    tools: ToolDefinition[],
    providerId: string
  ): any;

  /** 将 Provider 响应的工具调用解析为内部格式 */
  parseToolCalls(
    response: any,
    providerId: string
  ): ToolCallContent[];
}
```

| Provider | 原生格式 | 适配方式 |
|----------|----------|----------|
| OpenAI | `tools` 参数（function 类型） | 直接映射 |
| Claude | `tools` 参数（JSON Schema） | 直接映射 |
| Gemini | `tools.function_declarations` | 重命名字段 |
| Ollama | 同 OpenAI 格式 | 复用 OpenAI 适配器 |

---

## 第5章 提示词系统

### 5.1 PromptBuilder 接口

```typescript
interface PromptBuilder {
  /** 构建完整的消息列表 */
  build(params: BuildParams): Promise<Message[]>;

  /** 注册自定义提示词片段 */
  registerFragment(name: string, template: string): void;
}

interface BuildParams {
  /** 工作区 ID */
  workspaceId: string;
  /** 用户输入 */
  userInput: string;
  /** 对话历史 */
  history: Message[];
  /** 当前基础状态 */
  state: PlayerState;
  /** 可用工具列表 */
  tools: ToolDefinition[];
  /** 触发来源 */
  source: 'user' | 'event' | 'system';
  /** 系统指令（可选，覆盖默认系统提示词） */
  systemOverride?: string;
}
```

### 5.2 系统提示词模板

```
你是 McAgent，一个运行在 Minecraft 世界中的 AI 智能体。

## 你的身份
- 你是一个有自主意识的 Minecraft 玩家
- 你会像人类一样思考和探索
- 你可以使用工具来与游戏世界交互

## 核心规则
- 每次只做一件事，完成后再做下一件
- 工具可能失败（寻路失败、物品不足等），失败后分析原因并尝试其他方案
- 注意资源消耗（饥饿值、工具耐久度）
- 危险时优先保证生存（逃跑、进食、回血）
- 你无法直接感知环境，需要通过工具获取信息

## 交互格式
- 你可以通过思考来规划步骤
- 需要操作游戏时，使用工具调用
- 工具会批量执行，可以一次发出多个不冲突的工具调用
- 等所有工具执行完成后，我会把结果告诉你
```

### 5.3 状态注入格式

每轮对话前，自动采集并注入玩家状态（~150 tokens）：

```
## 当前状态
生命: {health}/20
饥饿: {hunger}/20
饱和度: {saturation}
位置: ({x}, {y}, {z}) {dimension}
生物群系: {biome}
装备: {equipment_summary}
背包: {inventory_summary}
状态: {status_effects}
```

**状态采集接口**：

```typescript
interface PlayerState {
  health: number;                // 0-20
  hunger: number;                // 0-20
  saturation: number;
  position: {
    x: number; y: number; z: number;
    dimension: 'overworld' | 'nether' | 'the_end';
    biome?: string;
  };
  equipment: {
    mainhand?: string;
    offhand?: string;
    helmet?: string;
    chestplate?: string;
    leggings?: string;
    boots?: string;
  };
  inventory: {
    usedSlots: number;
    totalSlots: number;
    items: string[];              // 摘要格式，如 "圆石 x45, 铁锭 x12"
  };
  statusEffects: string[];       // 如 ["夜视", "饥饿"]
  specialStatus?: string;        // 自定义描述
}

/** 状态注入格式化为文本 */
function formatPlayerState(state: PlayerState): string {
  const items = state.inventory.items.join(', ');
  const effects = state.statusEffects.length > 0
    ? state.statusEffects.join(', ')
    : '无';

  return [
    `生命: ${state.health}/20`,
    `饥饿: ${state.hunger}/20`,
    `饱和度: ${state.saturation}`,
    `位置: (${state.position.x}, ${state.position.y}, ${state.position.z}) ${state.position.dimension}`,
    state.position.biome ? `生物群系: ${state.position.biome}` : '',
    `装备: 主手=${state.equipment.mainhand || '无'} 头盔=${state.equipment.helmet || '无'}`,
    `背包: ${state.inventory.usedSlots}/${state.inventory.totalSlots} - ${items}`,
    `状态: ${effects}`,
    state.specialStatus || '',
  ].filter(Boolean).join('\n');
}
```

### 5.4 工具列表动态组装

```typescript
class ToolListAssembler {
  /**
   * 将注册的工具列表转换为 LLM 可识别的 Function Calling 格式
   *
   * 处理步骤：
   * 1. 从工作区获取当前已注册的工具
   * 2. 过滤不可用的工具（冷却中、条件不满足）
   * 3. 按工具分类排序（感知类靠前，操作类靠后）
   * 4. 转换为 ToolDefinition[] 格式
   */
  assemble(workspaceId: string): ToolDefinition[];

  /**
   * 按类别过滤工具
   * 某些 context 下只暴露部分工具
   */
  filterByCategory(
    tools: ToolDefinition[],
    categories: string[]
  ): ToolDefinition[];
}
```

### 5.5 上下文窗口管理

```typescript
interface ContextManager {
  /**
   * 管理对话历史上下文窗口，确保不超过 tokens 上限
   *
   * 策略：
   * 1. 系统提示词 + 状态注入 始终保留（~200 tokens）
   * 2. 最新 N 轮对话保留（N 可配置，默认 20）
   * 3. 超出上限时，从最旧的消息开始丢弃
   * 4. 关键工具结果（成功/失败）保留摘要
   */
  trim(conversation: Conversation, maxTokens: number): Message[];

  /** 计算消息列表的 token 数（估算） */
  estimateTokens(messages: Message[]): number;

  /** 获取当前窗口配置 */
  getConfig(): ContextWindowConfig;
}

interface ContextWindowConfig {
  /** 最大 tokens */
  maxTokens: number;                  // default: 32768
  /** 保留最新几轮对话 */
  keepRecentRounds: number;           // default: 20
  /** 系统提示词保留 tokens */
  systemReserveTokens: number;        // default: 500
  /** 状态注入保留 tokens */
  stateReserveTokens: number;         // default: 200
  /** 工具结果保留 tokens（超出则压缩为摘要） */
  toolResultMaxTokens: number;        // default: 2048
}
```

---

## 第6章 Function Calling 管线

### 6.1 管线接口

```typescript
class FunctionCallingPipeline {
  /**
   * 处理 LLM 响应，执行工具调用并返回结果
   *
   * 管线流程：
   * 1. 解析 LLM 响应中的 tool_calls
   * 2. 分析依赖关系，构建执行图
   * 3. 通过工作区管理器发送 JSON-RPC Batch
   * 4. 收集执行结果
   * 5. 返回格式化的 tool_result 消息
   */
  async process(
    response: LLMResponse,
    workspaceId: string,
    abortSignal?: AbortSignal
  ): Promise<PipelineResult>;

  /** 注册前置/后置处理器 */
  use(middleware: PipelineMiddleware): void;
}

interface PipelineResult {
  /** 工具执行结果列表 */
  toolResults: ToolResultContent[];
  /** 总耗时 */
  totalDurationMs: number;
  /** 各工具耗时明细 */
  toolDurations: Array<{
    toolName: string;
    durationMs: number;
    success: boolean;
  }>;
  /** 是否有工具执行失败 */
  hasErrors: boolean;
}

interface PipelineMiddleware {
  /** 前置处理（在发送前修改 Batch） */
  before?: (batch: BatchRequest) => BatchRequest;
  /** 后置处理（在收集结果后修改结果） */
  after?: (result: PipelineResult) => PipelineResult;
}
```

### 6.2 Batch 执行策略

```typescript
interface BatchExecutor {
  /**
   * 执行 JSON-RPC Batch 请求
   *
   * 执行策略：
   * - 无依赖的工具并行执行
   * - 有依赖的工具等前置工具完成后执行
   * - 设置全局超时
   */
  execute(
    batch: BatchRequest,
    workspaceId: string,
    options?: BatchOptions
  ): Promise<BatchResponse>;
}

interface BatchRequest {
  jsonrpc: '2.0';
  /** 批量调用列表 */
  calls: Array<{
    id: string;
    method: string;
    params: Record<string, any>;
    /** 依赖的工具 ID 列表（依赖这些工具执行完成后才能执行） */
    dependsOn?: string[];
  }>;
}

interface BatchResponse {
  results: Array<{
    id: string;
    success: boolean;
    result?: Record<string, any>;
    error?: string;
    durationMs: number;
  }>;
  /** 整体执行耗时 */
  totalDurationMs: number;
}

interface BatchOptions {
  /** 全局超时 */
  timeout: number;                   // default: 30000
  /** 最大并发数 */
  maxConcurrency: number;            // default: 5
  /** 失败策略 */
  onError: 'abort' | 'continue';    // default: 'continue'
}
```

### 6.3 依赖分析

LLM 可能一次发出多个工具调用，其中一些调用存在依赖关系。依赖分析器自动构建执行图：

```typescript
class DependencyAnalyzer {
  /**
   * 分析工具调用之间的数据依赖关系
   *
   * 依赖规则：
   * 1. 如果工具 B 的参数引用了工具 A 的返回值（如 ${toolA.result.x}），则 B 依赖 A
   * 2. 如果工具 B 和工具 A 操作同一物品槽位，则 B 依赖 A
   * 3. 没有依赖关系的工具并行执行
   *
   * 返回拓扑排序后的执行层级
   */
  analyze(calls: ToolCallContent[]): ExecutionLayer[];

  /**
   * 检查两个工具调用是否冲突
   * 冲突 = 不能并行执行
   */
  isConflict(a: ToolCallContent, b: ToolCallContent): boolean;
}

interface ExecutionLayer {
  /** 层级编号（0=第一层） */
  level: number;
  /** 该层可并行执行的工具 */
  calls: ToolCallContent[];
}

/**
 * 默认冲突矩阵（不能并行执行的工具对）
 * 表格中 ✗ 表示冲突（不能并行），✓ 表示可并行
 *
 *         move_to  dig_block  place_block  attack  pickup  use_item
 * move_to    ✗       ✓          ✓           ✓       ✓       ✓
 * dig_block  ✓       ✗          ✗           ✓       ✓       ✓
 * place_block ✓     ✗          ✗           ✓       ✓       ✓
 * attack     ✓       ✓          ✓           ✗       ✓       ✓
 * pickup     ✓       ✓          ✓           ✓       ✗       ✓
 * use_item   ✓       ✓          ✓           ✓       ✓       ✗
 */
```

### 6.4 结果回注

```typescript
class ResultInjector {
  /**
   * 将工具执行结果格式化为 tool_result 消息，注入下一轮 LLM 上下文
   *
   * 格式化规则：
   * - 成功的结果：保留关键数据字段，省略大型数据
   * - 失败的结果：保留完整错误信息
   * - 耗时过长（>5s）的结果：附带耗时说明
   */
  inject(
    results: ToolResultContent[],
    conversation: Conversation
  ): void;
}
```

---

## 第7章 配置

### 7.1 LLMConfig 接口

```typescript
interface LLMConfig {
  /** Provider 配置 */
  providers: Record<string, ProviderConfig>;
  /** 路由配置 */
  router: RouterConfig;
  /** 提示词配置 */
  prompt: PromptConfig;
  /** 上下文窗口配置 */
  context: ContextWindowConfig;
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
  /** 超时配置 */
  timeout?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 代理配置 */
  proxy?: {
    host: string;
    port: number;
    auth?: { username: string; password: string };
  };
}

interface RouterConfig {
  default: ResolvedModel;
  workspaces?: Record<string, ResolvedModel>;
  taskTypes?: Record<string, ResolvedModel>;
  fallback: FallbackStrategy;
}

interface PromptConfig {
  /** 系统提示词模板路径 */
  systemPromptPath?: string;
  /** 自定义提示词片段 */
  fragments?: Record<string, string>;
  /** 状态注入格式模板 */
  stateTemplate?: string;
}
```

### 7.2 配置存储

LLM 配置存储在 `mcagent.db` 的 `config` 表中：

```sql
INSERT INTO config (key, value, value_type, description) VALUES
('llm_providers', '{"openai":{"baseUrl":"https://api.openai.com/v1","defaultModel":"gpt-4o"}}', 'json', 'Provider 配置'),
('llm_router_default', '{"providerId":"openai","model":"gpt-4o"}', 'json', '默认路由'),
('llm_router_task_types', '{"complex":{"providerId":"openai","model":"gpt-4o"},"simple":{"providerId":"openai","model":"gpt-4o-mini"}}', 'json', '任务类型路由'),
('llm_context_max_tokens', '32768', 'number', '上下文最大 tokens'),
('llm_context_keep_rounds', '20', 'number', '保留最近对话轮数');
```

### 7.3 模型参数推荐

| 场景 | 模型 | 温度 | maxTokens | 推荐理由 |
|------|------|------|-----------|----------|
| 复杂任务（建造/探索） | GPT-4o / Claude-4 | 0.5 | 8192 | 强推理，复杂指令遵循 |
| 日常操作（挖矿/收集） | GPT-4o-mini | 0.3 | 2048 | 低成本，快速响应 |
| 对话交互 | Gemini 2.0 Flash | 0.7 | 4096 | 低延迟，对话流畅 |
| 任务规划 | Claude Opus | 0.2 | 8192 | 高质量规划，极少出错 |
| 本地部署（离线） | Qwen2.5 7B / DeepSeek | 0.5 | 4096 | 无网络依赖 |

---

## 第8章 扩展 Provider 实现示例

### 8.1 自定义 Provider

```typescript
// providers/custom-provider.ts
// 自定义 Provider 实现示例

import { LLMProvider, ProviderMetadata, Message, ToolDefinition,
         LLMResponse, LLMChunk, ChatOptions, HealthCheckResult } from '../llm/types';

export class CustomProvider implements LLMProvider {
  readonly metadata: ProviderMetadata = {
    id: 'custom',
    displayName: '自定义 LLM',
    supportedModels: ['custom-model-v1'],
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsEmbedding: false,
    version: '1.0.0',
  };

  private baseUrl: string;
  private apiKey: string;

  constructor(config: { baseUrl: string; apiKey: string }) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
  }

  async chat(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions
  ): Promise<LLMResponse> {
    const startTime = Date.now();

    // 1. 转换消息格式
    const providerMessages = this.convertMessages(messages);

    // 2. 转换工具格式
    const providerTools = tools
      ? this.convertTools(tools)
      : undefined;

    // 3. 调用 API
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options?.extra?.model || this.metadata.supportedModels[0],
        messages: providerMessages,
        tools: providerTools,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 4096,
      }),
      signal: AbortSignal.timeout(options?.timeout ?? 60000),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // 4. 解析响应
    return {
      message: {
        role: 'assistant',
        content: data.choices[0].message.content || '',
        tool_calls: this.parseToolCalls(data.choices[0].message),
      },
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
      model: data.model,
      requestId: data.id,
      durationMs: Date.now() - startTime,
      truncated: data.choices[0].finish_reason === 'length',
      finishReason: data.choices[0].finish_reason === 'tool_calls'
        ? 'tool_calls'
        : data.choices[0].finish_reason,
    };
  }

  async *chatStream(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions
  ): AsyncIterable<LLMChunk> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options?.extra?.model || this.metadata.supportedModels[0],
        messages: this.convertMessages(messages),
        tools: tools ? this.convertTools(tools) : undefined,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 4096,
        stream: true,
      }),
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      for (const line of text.split('\n')) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));
          const delta = data.choices[0]?.delta;

          yield {
            content: delta?.content || '',
            toolCallDelta: delta?.tool_calls?.[0]?.function?.arguments,
            isLast: data.choices[0]?.finish_reason != null,
            finishReason: data.choices[0]?.finish_reason,
          };
        }
      }
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return {
        available: response.ok,
        latencyMs: Date.now() - startTime,
        model: this.metadata.supportedModels[0],
      };
    } catch (e: any) {
      return {
        available: false,
        latencyMs: Date.now() - startTime,
        model: this.metadata.supportedModels[0],
        error: e.message,
      };
    }
  }

  // ─── 私有转换方法 ───

  private convertMessages(messages: Message[]): any[] {
    return messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant'
           : m.role === 'user' ? 'user'
           : m.role === 'system' ? 'system'
           : 'tool',
      content: typeof m.content === 'string'
        ? m.content
        : m.content.filter(c => c.type === 'text').map(c => (c as TextContent).text).join('\n'),
    }));
  }

  private convertTools(tools: ToolDefinition[]): any[] {
    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  private parseToolCalls(message: any): ToolCallContent[] {
    if (!message.tool_calls) return [];
    return message.tool_calls.map((tc: any) => ({
      type: 'tool_call',
      toolCallId: tc.id,
      toolName: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));
  }
}
```

### 8.2 Provider 注册与使用

```typescript
// 初始化时注册
import { ProviderRegistry } from '../llm/provider-registry';
import { CustomProvider } from './custom-provider';

const customProvider = new CustomProvider({
  baseUrl: 'https://api.example.com',
  apiKey: 'sk-xxx',
});

ProviderRegistry.register('custom', customProvider);

// 使用 Provider
const provider = ProviderRegistry.get('custom');
const response = await provider.chat(messages, tools);
```

---

## 第9章 BE/JE 实现差异

LLM 抽象层完全在 Agent Core 中实现（TypeScript），不涉及 Adapter Core。BE 和 JE 在此层面**完全共享同一套代码**，无差异。

| 维度 | 说明 |
|------|------|
| Provider 实现 | Agent Core 侧，TypeScript，BE/JE 共享 |
| 提示词系统 | Agent Core 侧，TypeScript，BE/JE 共享 |
| Function Calling 管线 | Agent Core 侧，TypeScript，BE/JE 共享 |
| 配置管理 | Agent Core 侧，从 mcagent.db 读取 |
| 路由策略 | Agent Core 侧，运行时内存决策 |

---

## 附录A：快速参考

### 接口速查

| 接口/类 | 位置 | 职责 |
|----------|------|------|
| `LLMProvider` | 第2章 | 统一模型接入 |
| `ProviderRegistry` | 2.3 | Provider 注册管理 |
| `ModelRouter` | 第3章 | 模型路由选择 |
| `PromptBuilder` | 5.1 | 提示词组装 |
| `ContextManager` | 5.5 | 上下文窗口管理 |
| `FunctionCallingPipeline` | 6.1 | 工具调用管线 |
| `BatchExecutor` | 6.2 | Batch 并行执行 |
| `DependencyAnalyzer` | 6.3 | 依赖分析 |

### 数据流简图

```
用户输入 → PromptBuilder → ModelRouter → Provider.chat()
                                                    ↓
                                            FunctionCallingPipeline
                                                    ↓
                                            BatchExecutor → TCP → Adapter Core
                                                    ↓
                                            ResultInjector → 下一轮
```

### Provider 配置示例汇总

**OpenAI**：
```json
{
  "providers": {
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "${OPENAI_API_KEY}",
      "defaultModel": "gpt-4o",
      "models": ["gpt-4o", "gpt-4o-mini", "o3-mini"]
    }
  }
}
```

**Claude**：
```json
{
  "providers": {
    "claude": {
      "baseUrl": "https://api.anthropic.com/v1",
      "apiKey": "${ANTHROPIC_API_KEY}",
      "defaultModel": "claude-3-5-sonnet-20241022"
    }
  }
}
```

**Ollama（本地）**：
```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434",
      "defaultModel": "qwen2.5:7b",
      "models": ["qwen2.5:7b", "deepseek-r1:7b", "llama3:8b"]
    }
  }
}
```

---

## 附录B：与相关模块的交互

| 相关模块 | 交互方式 |
|----------|----------|
| **工作区管理器 (A4)** | 获取工具列表、发送 JSON-RPC Batch |
| **提示词系统 (A3)** | 调用 PromptBuilder 组装消息 |
| **TCP 服务端 (A5)** | 通过工作区管理器间接发送 Batch |
| **UI 界面 (A1)** | 暴露当前模型、tokens 统计供可视化 |
| **记忆系统** | 无直接交互，LLM 通过工具调用间接使用记忆 |
| **任务系统** | 任务系统设置 taskType，Model Router 据此选模型 |

---

## 附录C：错误码

| 错误码 | 说明 | 处理方式 |
|--------|------|----------|
| `LLM_001` | Provider 不可用（网络/认证） | 触发降级策略 |
| `LLM_002` | API 返回格式异常 | 重试（最多 3 次） |
| `LLM_003` | 响应被截断 | 压缩历史后重试 |
| `LLM_004` | Function Calling 解析失败 | 重新发送，禁用工具重试 |
| `LLM_005` | 上下文超限 | 自动截断后重试 |
| `LLM_006` | 所有 Provider 降级后仍失败 | 通知用户手动处理 |