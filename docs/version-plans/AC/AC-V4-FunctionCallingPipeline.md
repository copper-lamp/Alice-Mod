# Alice Mod Core V4 — Function Calling Pipeline

> 版本：v1.0
> 日期：2026-07-05
> 版本号：V4（第 4 周）
> 对应需求：AC-LLM-09、AC-LLM-10、AC-TCP-10、AC-TCP-11
> 关联文档：[AC-01-需求文档.md](AC-01-需求文档.md)、[AC-02-实施计划.md](AC-02-实施计划.md)、[01-LLM抽象层接口规范.md](../../api/01-LLM抽象层接口规范.md)、[01-TCP服务端模块.md](../../modules/01-TCP服务端模块.md)、[02-工作区与实例管理模块.md](../../modules/02-工作区与实例管理模块.md)

---

## 第一部分：需求文档

### 1.1 模块定位

Function Calling Pipeline（FCP）是 Agent Core 中连接 **LLM 决策** 与 **游戏内执行** 的核心桥梁。它接收 LLM 返回的工具调用指令，解析依赖关系，通过工作区路由到对应的 Adapter Core 执行，并收集结果回注到 LLM 上下文中。

**核心职责**：

| 职责 | 说明 |
|------|------|
| **解析与验证** | 将 LLM 响应的 `tool_calls` 解析为内部结构化表示，校验参数合法性 |
| **依赖分析** | 分析工具调用间的数据依赖和资源冲突，构建执行层级图 |
| **分发执行** | 通过工作区管理器将工具调用路由到对应 Adapter Core 执行 |
| **结果收集** | 等待执行完成，处理超时/失败，收集格式化结果 |
| **回注上下文** | 将执行结果组装为 `tool_result` 消息，注入下一轮 LLM 上下文 |

### 1.2 功能需求列表

| 需求 ID | 需求名称 | 优先级 | 开发者 | 实现状态 |
|---------|----------|:------:|:------:|:--------:|
| AC-LLM-09 | Function Calling Pipeline（解析 → Batch → 分发 → 收集 → 回注） | P0 | A | ⏳ |
| AC-LLM-10 | 工具调用依赖分析（构建执行层级图） | P1 | A | ⏳ |
| AC-TCP-10 | 工具调用分发（按工作区路由到对应 Adapter Core） | P0 | B | ⏳ |
| AC-TCP-11 | 结果收集与格式化 | P0 | B | ⏳ |

### 1.3 验收标准

| # | 验收条件 | 验证方法 | 测量指标 |
|---|---------|----------|----------|
| 4.1 | LLM 响应中的 `tool_calls` 正确解析 | 构造包含 3 个工具调用的 LLMResponse | 正确解析为 ToolCallContent[] |
| 4.2 | 依赖分析正确构建执行层级 | B 依赖 A，C 无依赖 | 层级：Layer0=[A,C], Layer1=[B] |
| 4.3 | 无依赖的工具并行执行 | A、B 互不依赖 | 并发发送，无顺序依赖 |
| 4.4 | 有依赖的工具顺序执行 | B 依赖 A | B 的发送时间 > A 的完成时间 |
| 4.5 | 循环依赖检测 | A→B, B→A | 抛出循环依赖错误，不进入执行 |
| 4.6 | 结果正确收集 | 5 个调用全部成功 | 5 个结果全部返回 |
| 4.7 | 结果回注格式正确 | 执行结果注入下一轮 LLM | 格式为 `{role:'tool',tool_call_id,content}` |
| 4.8 | 工具执行超时处理 | 超时 5s，工具 10s 未返回 | 返回 timeout 错误，不阻塞其他 |
| 4.9 | 部分失败场景处理 | 5 个调用中 2 个失败 | 成功的结果正常回注，失败的结果携带错误信息 |
| 4.10 | 兜底策略触发 | 主路由不可用 | 自动切到兜底策略处理 |
| 4.11 | 管线中间件可插拔 | 注册一个日志中间件 | 每次管线调用触发中间件 |

---

## 第二部分：架构文档

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Function Calling Pipeline                          │
│                                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────┐  │
│  │   解析器      │───→│  依赖分析器    │───→│     Batch 调度器         │  │
│  │ ResponseParser│    │ DepAnalyzer  │    │    BatchScheduler       │  │
│  └──────────────┘    └──────────────┘    └───────────┬──────────────┘  │
│                                                      │                  │
│  ┌───────────────────────────────────────────────────▼──────────────┐  │
│  │                    Pipeline Middleware Chain                      │  │
│  │  [日志中间件] → [校验中间件] → [限流中间件] → [自定义中间件]      │  │
│  └───────────────────────────────────────────────────┬──────────────┘  │
│                                                      │                  │
│  ┌───────────────────────────────────────────────────▼──────────────┐  │
│  │                      ToolDispatcher                               │  │
│  │        按工作区路由 → 构造 JSON-RPC Batch → 发送                │  │
│  └───────────────────────────┬──────────────────────────────────────┘  │
│                              │                                         │
│  ┌───────────────────────────▼──────────────────────────────────────┐  │
│  │                      ResultCollector                              │  │
│  │       等待结果 → 超时管理 → 失败收集 → 格式化                     │  │
│  └───────────────────────────┬──────────────────────────────────────┘  │
│                              │                                         │
│  ┌───────────────────────────▼──────────────────────────────────────┐  │
│  │                      ResultInjector                               │  │
│  │       组装 ToolResult → 注入下一轮 LLM 上下文                      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                      FallbackManager                             │  │
│  │   兜底策略：重试 → 降级 → 跳过 → 终止                            │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心数据流

```
LLM 返回 LLMResponse
    │
    ▼
┌──────────────────────┐
│ ResponseParser       │  ← 解析 tool_calls
│ - 提取 ToolCall[]    │    校验参数合法性
│ - 参数校验           │
└──────────┬───────────┘
           │ ToolCallContent[]
           ▼
┌──────────────────────┐
│ DependencyAnalyzer   │  ← 分析数据依赖 + 资源冲突
│ - 构建执行层级图      │    检测循环依赖
│ - 检查冲突矩阵       │
└──────────┬───────────┘
           │ ExecutionLayer[]
           ▼
┌──────────────────────┐
│ BatchScheduler       │  ← 按层级构造 Batch
│ - 按层构造 Batch     │    每层内部可并行
│ - 设置超时/策略      │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Middleware Chain     │  ← 前置/后置处理
│ - 日志记录           │    可扩展
│ - 校验/限流/...      │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ ToolDispatcher       │  ← 按工作区路由
│ - 获取工作区连接      │    构造 JSON-RPC Batch
│ - 发送 Batch 请求    │    发送
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ ResultCollector      │  ← 等待执行结果
│ - 等待所有结果返回    │    处理超时/失败
│ - FallbackManager    │
└──────────┬───────────┘
           │ ToolResultContent[]
           ▼
┌──────────────────────┐
│ ResultInjector       │  ← 回注到 Conversation
│ - 格式化结果          │
│ - 注入下一轮上下文    │
└──────────────────────┘
```

### 2.3 核心接口设计

> 所有接口均使用抽象定义，V4 提供默认实现，后续版本可通过注册替换。

#### 2.3.1 ResponseParser — 解析器

```typescript
/**
 * LLM 响应解析器接口
 * V4 提供默认实现，后续可扩展支持更多 LLM 响应格式
 */
interface ResponseParser {
  /**
   * 解析 LLM 响应中的工具调用
   * @param response - LLM 原始响应
   * @returns 解析后的工具调用列表
   * @throws ParserError 当响应格式无法解析时
   */
  parse(response: LLMResponse): ToolCallContent[];

  /**
   * 校验工具调用参数合法性
   * @param call - 工具调用
   * @param definition - 工具定义（含参数 Schema）
   * @returns 校验结果
   */
  validate(
    call: ToolCallContent,
    definition: ToolDefinition
  ): ValidationResult;
}

/** 解析结果 */
interface ToolCallContent {
  type: 'tool_call';
  toolCallId: string;
  toolName: string;
  arguments: Record<string, any>;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}
```

#### 2.3.2 DependencyAnalyzer — 依赖分析器

```typescript
/**
 * 依赖分析器接口
 * V4 提供基于参数引用的默认实现，后续可扩展基于语义的依赖分析
 */
interface DependencyAnalyzer {
  /**
   * 分析工具调用间的依赖关系，构建执行层级图
   *
   * @param calls - 工具调用列表
   * @returns 拓扑排序后的执行层级
   * @throws CycleDependencyError 当检测到循环依赖时
   */
  analyze(calls: ToolCallContent[]): ExecutionLayer[];

  /**
   * 注册自定义冲突规则
   * 用于扩展特定工具之间的冲突检测
   */
  registerConflictRule(rule: ConflictRule): void;
}

/** 执行层级 — 同一层级的工具可并行执行 */
interface ExecutionLayer {
  level: number;
  calls: ToolCallContent[];
}

/** 自定义冲突规则 */
interface ConflictRule {
  name: string;
  /** 判断两个工具是否冲突 */
  check: (a: ToolCallContent, b: ToolCallContent) => boolean;
  priority: number;
}
```

**默认依赖规则**：

| 规则类型 | 判断方式 | 说明 |
|----------|----------|------|
| **参数引用** | B 的参数包含 `${A.result.xxx}` | B 依赖 A 的返回值 |
| **移动前置** | B 是方块操作，A 是移动类 | 移动完成后再操作 |
| **资源冲突** | 操作同一物品槽位/方块坐标 | 不能并行执行 |
| **分类冲突** | 同类操作同一目标 | 串行执行避免状态不一致 |

**默认冲突矩阵**：

```
         move  dig  place  attack  pickup  equip  use
move      ✗    ✓     ✓      ✓       ✓      ✓     ✓
dig       ✓    ✗     ✗      ✓       ✓      ✓     ✓
place     ✓    ✗     ✗      ✓       ✓      ✓     ✓
attack    ✓    ✓     ✓      ✗       ✓      ✓     ✓
pickup    ✓    ✓     ✓      ✓       ✗      ✓     ✓
equip     ✓    ✓     ✓      ✓       ✓      ✗     ✓
use       ✓    ✓     ✓      ✓       ✓      ✓     ✗
```

#### 2.3.3 BatchScheduler — Batch 调度器

```typescript
/**
 * Batch 请求调度器接口
 * 负责将执行层级转换为具体的 Batch 请求序列
 */
interface BatchScheduler {
  /**
   * 将执行层级调度为多个 Batch 请求
   * @param layers - 执行层级
   * @param options - 调度选项
   * @returns Batch 请求列表（每个层级一个 Batch）
   */
  schedule(
    layers: ExecutionLayer[],
    options?: ScheduleOptions
  ): ScheduledBatch[];

  /**
   * 设置调度策略
   */
  setStrategy(strategy: SchedulingStrategy): void;
}

interface ScheduleOptions {
  /** 全局超时（所有层级的总超时） */
  globalTimeoutMs: number;       // default: 60000
  /** 单层超时 */
  layerTimeoutMs: number;        // default: 30000
  /** 失败策略：abort=中断所有, continue=跳过失败继续 */
  onError: 'abort' | 'continue'; // default: 'continue'
  /** 最大并发数（每层内部） */
  maxConcurrency: number;        // default: 5
}

interface ScheduledBatch {
  level: number;
  calls: BatchCall[];
  timeoutMs: number;
}

interface BatchCall {
  id: string;                    // 工具调用 ID
  method: string;                // 'tool_call'
  params: {
    tool_name: string;
    parameters: Record<string, any>;
    timeout_ms?: number;
  };
}

type SchedulingStrategy = 'layered' | 'sequential' | 'greedy';
```

#### 2.3.4 PipelineMiddleware — 管线中间件

```typescript
/**
 * 管线中间件接口
 * 用于在管线的关键节点插入自定义处理逻辑
 * 用户可通过实现此接口扩展管线行为
 */
interface PipelineMiddleware {
  /** 中间件名称（用于日志和调试） */
  readonly name: string;

  /**
   * 前置处理 — 在 Batch 发送前执行
   * 可用于：日志、校验、限流、参数改写等
   */
  before?(context: MiddlewareContext): Promise<MiddlewareContext>;

  /**
   * 后置处理 — 在结果收集后执行
   * 可用于：结果转换、缓存、统计等
   */
  after?(context: MiddlewareContext): Promise<MiddlewareContext>;
}

interface MiddlewareContext {
  readonly pipelineId: string;
  readonly workspaceId: string;
  calls: ToolCallContent[];
  layers?: ExecutionLayer[];
  batches?: ScheduledBatch[];
  results?: ToolResultContent[];
  errors?: PipelineError[];
  metadata: Record<string, any>;
}
```

#### 2.3.5 ToolDispatcher — 工具分发器

```typescript
/**
 * 工具调用分发器接口
 * 负责将 Batch 请求发送到对应的工作区并执行
 */
interface ToolDispatcher {
  /**
   * 执行单个 Batch 请求
   * @param batch - Batch 请求
   * @param workspaceId - 目标工作区
   * @returns 执行结果
   */
  executeBatch(
    batch: ScheduledBatch,
    workspaceId: string
  ): Promise<BatchExecuteResult>;

  /**
   * 注册自定义分发策略
   * 后续可扩展支持 local mock、远程代理等
   */
  registerStrategy(name: string, strategy: DispatchStrategy): void;
}

interface BatchExecuteResult {
  results: ToolCallResult[];
  totalDurationMs: number;
}

interface ToolCallResult {
  id: string;
  success: boolean;
  data?: Record<string, any>;
  error?: string;
  durationMs: number;
}

/** 分发策略接口（可扩展） */
interface DispatchStrategy {
  /** 策略名称 */
  name: string;
  /** 判断是否匹配当前调用 */
  match(call: ToolCallContent, workspaceId: string): boolean;
  /** 执行调用 */
  execute(call: ToolCallContent): Promise<ToolCallResult>;
}
```

#### 2.3.6 ResultCollector — 结果收集器

```typescript
/**
 * 结果收集器接口
 * 管理多个 Batch 执行的生命周期
 */
interface ResultCollector {
  /**
   * 收集所有层级的执行结果
   * @param batches - 所有 ScheduledBatch
   * @param dispatcher - 分发器
   * @param options - 收集选项
   * @returns 所有工具调用的结果
   */
  collect(
    batches: ScheduledBatch[],
    dispatcher: ToolDispatcher,
    options: CollectOptions
  ): Promise<CollectResult>;

  /**
   * 注册结果处理器
   * 后续可扩展数据聚合、缓存等
   */
  onResult(handler: ResultHandler): void;
}

interface CollectOptions {
  /** 全局超时 */
  globalTimeoutMs: number;       // default: 60000
  /** 层级间等待间隔（ms，给 Adapter Core 处理时间） */
  interLayerDelayMs: number;     // default: 100
  /** 是否提前返回（首个失败即返回） */
  failFast: boolean;             // default: false
}

interface CollectResult {
  /** 所有工具结果 */
  results: ToolResultContent[];
  /** 成功数量 */
  successCount: number;
  /** 失败数量 */
  failCount: number;
  /** 总耗时 */
  totalDurationMs: number;
  /** 各工具耗时明细 */
  toolDurations: Array<{
    toolName: string;
    durationMs: number;
    success: boolean;
  }>;
  /** 是否有错误 */
  hasErrors: boolean;
}
```

#### 2.3.7 ResultInjector — 结果回注器

```typescript
/**
 * 结果回注器接口
 * 将执行结果转换为 LLM 可识别的消息格式
 */
interface ResultInjector {
  /**
   * 将收集到的结果回注到对话上下文中
   * @param result - 收集结果
   * @param conversation - 当前对话
   */
  inject(
    result: CollectResult,
    conversation: Conversation
  ): void;

  /**
   * 注册自定义结果格式化器
   * 可针对特定工具定制回注格式
   */
  registerFormatter(
    toolName: string,
    formatter: ResultFormatter
  ): void;
}

/** 自定义结果格式化器 */
interface ResultFormatter {
  format(result: ToolResultContent): ToolResultContent;
}
```

#### 2.3.8 FallbackManager — 兜底策略管理器

```typescript
/**
 * 兜底策略管理器
 * 当工具调用执行失败时，按照配置的策略进行处理
 */
interface FallbackManager {
  /**
   * 处理执行失败的工具调用
   * @param failedCall - 失败的工具调用
   * @param context - 当前上下文
   * @returns 兜底处理结果
   */
  handle(
    failedCall: ToolCallContent,
    context: FallbackContext
  ): Promise<FallbackResult>;

  /**
   * 注册自定义兜底策略
   * 后续可扩展：AI 重规划、人工介入、日志分析等
   */
  registerStrategy(name: string, strategy: FallbackStrategy): void;
}

interface FallbackContext {
  workspaceId: string;
  attemptCount: number;
  previousErrors: string[];
  allResults: ToolResultContent[];
  metadata: Record<string, any>;
}

interface FallbackResult {
  /** 兜底处理后的结果 */
  result: ToolResultContent;
  /** 使用的兜底策略名称 */
  strategyUsed: string;
  /** 是否最终处理完成 */
  resolved: boolean;
}
```

### 2.4 FunctionCallingPipeline — 主管线

```typescript
/**
 * Function Calling 管线 — 核心编排器
 *
 * 使用方式：
 * 1. 创建 Pipeline 实例
 * 2. 注册中间件（可选）
 * 3. 调用 process() 处理 LLM 响应
 *
 * 设计原则：
 * - 所有子组件通过接口注入，可独立替换
 * - 中间件机制支持管线行为的无侵入扩展
 * - 兜底策略保证在异常场景下的系统健壮性
 */
class FunctionCallingPipeline {
  constructor(options?: PipelineOptions)

  /** 注入子组件 */
  setParser(parser: ResponseParser): void;
  setAnalyzer(analyzer: DependencyAnalyzer): void;
  setScheduler(scheduler: BatchScheduler): void;
  setDispatcher(dispatcher: ToolDispatcher): void;
  setCollector(collector: ResultCollector): void;
  setInjector(injector: ResultInjector): void;
  setFallback(fallback: FallbackManager): void;

  /** 注册中间件 */
  use(middleware: PipelineMiddleware): void;

  /**
   * 核心方法：处理 LLM 响应
   *
   * 完整流程：
   * 1. 解析 tool_calls
   * 2. 依赖分析 → 执行层级
   * 3. 调度 → Batch 序列
   * 4. 中间件前置处理
   * 5. 分发执行 + 结果收集
   * 6. 兜底处理（如有失败）
   * 7. 中间件后置处理
   * 8. 结果回注
   */
  async process(
    response: LLMResponse,
    workspaceId: string,
    options?: ProcessOptions,
    abortSignal?: AbortSignal
  ): Promise<PipelineResult>;

  /** 获取管线状态 */
  getStatus(): PipelineStatus;

  /** 重置管线状态 */
  reset(): void;
}

interface PipelineOptions {
  /** 默认调度选项 */
  schedule?: Partial<ScheduleOptions>;
  /** 默认收集选项 */
  collect?: Partial<CollectOptions>;
  /** 是否启用兜底 */
  enableFallback?: boolean;          // default: true
  /** 管线超时 */
  timeout?: number;                  // default: 120000
}

interface ProcessOptions {
  /** 覆盖默认调度选项 */
  schedule?: Partial<ScheduleOptions>;
  /** 覆盖默认收集选项 */
  collect?: Partial<CollectOptions>;
  /** 请求标签（追踪用） */
  requestId?: string;
}

interface PipelineResult {
  /** 工具执行结果列表 */
  toolResults: ToolResultContent[];
  /** 总耗时 */
  totalDurationMs: number;
  /** 各阶段耗时明细 */
  phaseDurations: {
    parse: number;
    analyze: number;
    schedule: number;
    middlewareBefore: number;
    dispatch: number;
    collect: number;
    fallback: number;
    middlewareAfter: number;
    inject: number;
  };
  /** 成功/失败统计 */
  stats: {
    total: number;
    success: number;
    failed: number;
    skipped: number;
    fallbackResolved: number;
  };
  /** 是否有错误 */
  hasErrors: boolean;
  /** 错误列表 */
  errors: PipelineError[];
}

interface PipelineStatus {
  phase: 'idle' | 'parsing' | 'analyzing' | 'scheduling'
       | 'dispatching' | 'collecting' | 'injecting';
  startedAt: number | null;
  elapsedMs: number;
  callCount: number;
}

interface PipelineError {
  code: string;
  message: string;
  toolName?: string;
  toolCallId?: string;
  stack?: string;
}
```

### 2.5 兜底策略设计

兜底策略在工具调用失败时自动介入，分为 4 个级别：

```
┌─────────────────────────────────────────────────────────────┐
│                  FallbackManager                             │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │
│  │ Level 1  │  │ Level 2  │  │ Level 3  │  │  Level 4    │  │
│  │  重试     │→→│  降级     │→→│  跳过     │→→│  终止       │  │
│  │ Retry    │  │ Degrade  │  │ Skip     │  │  Abort      │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────┘  │
│       │             │             │              │           │
│       ▼             ▼             ▼              ▼           │
│   指数退避        替换工具      标记跳过       中断全部       │
│   最多3次         Mock结果     继续后续       返回错误       │
└─────────────────────────────────────────────────────────────┘
```

#### Level 1：重试（Retry）

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 最大重试次数 | 3 | `maxRetries: number` |
| 初始间隔 | 1s | `initialDelayMs: 1000` |
| 退避乘数 | 2.0 | `backoffMultiplier: 2.0` |
| 最大间隔 | 30s | `maxDelayMs: 30000` |
| 可重试错误 | `timeout`, `network`, `rate_limit`, `game_busy` | `retryableErrors: string[]` |

```
重试时序：
0s     调用失败
1s     第1次重试 → 失败
3s     第2次重试 → 失败
7s     第3次重试 → 失败 → 进入 Level 2
```

#### Level 2：降级（Degrade）

| 策略 | 说明 | 适用场景 |
|------|------|----------|
| **简化参数** | 移除可选参数重新调用 | 复杂参数导致执行失败 |
| **替换工具** | 使用功能相近的替代工具 | 原工具临时不可用 |
| **分段执行** | 将一个大操作拆分为多个小操作 | 超时/资源不足 |
| **Mock 结果** | 返回预设的兜底结果 | 非关键工具（如感知类） |

```typescript
/** 降级策略 */
interface DegradeStrategy {
  /** 降级名称 */
  name: string;
  /** 判断是否适用 */
  match(error: PipelineError, call: ToolCallContent): boolean;
  /** 执行降级 */
  execute(call: ToolCallContent, error: PipelineError): Promise<FallbackResult>;
}

/** 内置降级策略 */
const builtinDegradeStrategies: DegradeStrategy[] = [
  {
    name: 'simplify_params',
    match: (err, call) => err.code === 'INVALID_PARAMS',
    execute: async (call) => {
      // 移除可选参数，仅保留必填参数重试
      return { ... };
    },
  },
  {
    name: 'mock_result',
    match: (err, call) => call.category === 'perception',
    execute: async (call) => {
      // 感知类工具失败时返回空结果（不阻塞后续）
      return { result: { success: false, data: null }, resolved: true };
    },
  },
];
```

#### Level 3：跳过（Skip）

| 条件 | 说明 |
|------|------|
| 非关键路径 | 跳过后不影响其他工具执行 |
| 感知类工具 | 返回空结果，LLM 自行处理 |
| 后续依赖已失败 | 前置失败，后续依赖自动跳过 |

跳过时在 `ToolResultContent` 中标记 `skipped: true`，LLM 可感知到哪些调用被跳过。

#### Level 4：终止（Abort）

| 条件 | 说明 |
|------|------|
| 关键路径工具失败 | 如 `move_to` 失败则后续操作无法执行 |
| 安全相关 | 血量过低时强制终止 |
| 配置 `abort` 策略 | 调用方指定 `onError: 'abort'` |

终止时：
- 未执行的 Batch 全部标记为 `cancelled`
- 已执行的 Batch 结果保留
- 返回 `PipelineResult.hasErrors = true`

### 2.6 管线生命周期事件

管线在每个阶段触发事件，供监控和调试：

```typescript
interface PipelineEvents {
  /** 管线开始处理 */
  'pipeline:start': (context: { pipelineId: string; workspaceId: string; callCount: number }) => void;
  /** 解析完成 */
  'pipeline:parsed': (context: { calls: ToolCallContent[] }) => void;
  /** 依赖分析完成 */
  'pipeline:analyzed': (context: { layers: ExecutionLayer[] }) => void;
  /** Batch 发送 */
  'pipeline:batch-sent': (context: { level: number; batch: ScheduledBatch }) => void;
  /** 单工具完成 */
  'pipeline:tool-completed': (context: { toolName: string; result: ToolCallResult }) => void;
  /** 兜底触发 */
  'pipeline:fallback': (context: { toolName: string; error: PipelineError; strategy: string }) => void;
  /** 管线完成 */
  'pipeline:complete': (context: { result: PipelineResult }) => void;
  /** 管线错误 */
  'pipeline:error': (context: { error: PipelineError }) => void;
}
```

---

## 第三部分：执行文档

### 3.1 文件结构

```
src/main/pipeline/
├── index.ts                       ─ 模块入口，统一导出
├── types.ts                       ─ 类型定义（所有接口 + 事件类型）
├── pipeline.ts                    ─ FunctionCallingPipeline 主类
│
├── response-parser.ts             ─ ResponseParser 默认实现
├── dependency-analyzer.ts         ─ DependencyAnalyzer 默认实现
├── batch-scheduler.ts             ─ BatchScheduler 默认实现
├── tool-dispatcher.ts             ─ ToolDispatcher 默认实现
├── result-collector.ts            ─ ResultCollector 默认实现
├── result-injector.ts             ─ ResultInjector 默认实现
│
├── fallback/
│   ├── fallback-manager.ts        ─ FallbackManager 默认实现
│   ├── retry-strategy.ts          ─ 重试策略
│   ├── degrade-strategy.ts        ─ 降级策略
│   └── strategies/                ─ 自定义兜底策略
│       ├── mock-result.ts         ─ Mock 结果策略
│       └── simplify-params.ts     ─ 简化参数策略
│
├── middleware/
│   └── builtin/
│       ├── logger-middleware.ts   ─ 日志中间件
│       ├── validator-middleware.ts ─ 校验中间件
│       └── metrics-middleware.ts  ─ 指标统计中间件
│
└── __tests__/
    ├── pipeline.test.ts
    ├── dependency-analyzer.test.ts
    ├── tool-dispatcher.test.ts
    ├── result-collector.test.ts
    ├── fallback-manager.test.ts
    └── integration/
        └── pipeline-flow.test.ts  ─ 全流程集成测试
```

### 3.2 核心类实现说明

#### FunctionCallingPipeline（pipeline.ts）

```typescript
class FunctionCallingPipeline {
  private parser: ResponseParser = new DefaultResponseParser();
  private analyzer: DependencyAnalyzer = new DefaultDependencyAnalyzer();
  private scheduler: BatchScheduler = new DefaultBatchScheduler();
  private dispatcher: ToolDispatcher = new DefaultToolDispatcher();
  private collector: ResultCollector = new DefaultResultCollector();
  private injector: ResultInjector = new DefaultResultInjector();
  private fallback: FallbackManager = new DefaultFallbackManager();

  private middlewares: PipelineMiddleware[] = [];
  private status: PipelineStatus = { phase: 'idle', startedAt: null, elapsedMs: 0, callCount: 0 };

  async process(
    response: LLMResponse,
    workspaceId: string,
    options?: ProcessOptions,
    abortSignal?: AbortSignal,
  ): Promise<PipelineResult> {
    const startTime = Date.now();
    this.status = { phase: 'parsing', startedAt: startTime, elapsedMs: 0, callCount: 0 };

    // 1. 解析
    const parseStart = Date.now();
    const calls = this.parser.parse(response);
    this.status.callCount = calls.length;

    if (calls.length === 0) {
      return { toolResults: [], totalDurationMs: 0, /* ... */ };
    }

    // 2. 依赖分析
    this.status.phase = 'analyzing';
    const analyzeStart = Date.now();
    const layers = this.analyzer.analyze(calls);

    // 3. 调度
    this.status.phase = 'scheduling';
    const scheduleStart = Date.now();
    const batches = this.scheduler.schedule(layers, {
      ...this.options.schedule,
      ...options?.schedule,
    });

    // 4. 中间件前置处理
    this.status.phase = 'dispatching';
    const middlewareBeforeStart = Date.now();
    let ctx: MiddlewareContext = {
      pipelineId: generateId(),
      workspaceId,
      calls,
      layers,
      batches,
      results: [],
      errors: [],
      metadata: {},
    };
    for (const mw of this.middlewares) {
      if (mw.before) ctx = await mw.before(ctx);
    }

    // 5. 分发 + 收集
    const dispatchStart = Date.now();
    const collectResult = await this.collector.collect(
      batches,
      this.dispatcher,
      {
        ...this.options.collect,
        ...options?.collect,
      },
      abortSignal,
    );

    // 6. 兜底处理
    const fallbackStart = Date.now();
    if (this.options.enableFallback && collectResult.hasErrors) {
      for (const result of collectResult.results) {
        if (!result.success) {
          const fbResult = await this.fallback.handle(
            { type: 'tool_call', toolCallId: result.id, toolName: result.toolName, arguments: {} },
            {
              workspaceId,
              attemptCount: 1,
              previousErrors: [result.error || ''],
              allResults: collectResult.results,
              metadata: {},
            },
          );
          if (fbResult.resolved) {
            Object.assign(result, fbResult.result);
          }
        }
      }
    }

    // 7. 中间件后置处理
    const middlewareAfterStart = Date.now();
    ctx.results = collectResult.results;
    ctx.errors = collectResult.hasErrors ? [{ code: 'PARTIAL_FAILURE', message: '部分工具调用失败' }] : [];
    for (const mw of this.middlewares) {
      if (mw.after) ctx = await mw.after(ctx);
    }

    // 8. 回注
    this.status.phase = 'injecting';
    const injectStart = Date.now();
    this.injector.inject(collectResult, ctx.metadata.conversation);

    // 构造结果
    const now = Date.now();
    this.status = { ...this.status, elapsedMs: now - startTime };
    const result: PipelineResult = {
      toolResults: collectResult.results,
      totalDurationMs: now - startTime,
      phaseDurations: {
        parse: analyzeStart - parseStart,
        analyze: scheduleStart - analyzeStart,
        schedule: middlewareBeforeStart - scheduleStart,
        middlewareBefore: dispatchStart - middlewareBeforeStart,
        dispatch: 0,
        collect: fallbackStart - dispatchStart,
        fallback: middlewareAfterStart - fallbackStart,
        middlewareAfter: injectStart - middlewareAfterStart,
        inject: now - injectStart,
      },
      stats: {
        total: collectResult.results.length,
        success: collectResult.successCount,
        failed: collectResult.failCount,
        skipped: collectResult.results.filter(r => r.success === false).length - collectResult.failCount + collectResult.successCount,
        fallbackResolved: 0,
      },
      hasErrors: collectResult.hasErrors,
      errors: [],
    };

    return result;
  }
}
```

#### DefaultResultCollector（result-collector.ts）

```typescript
class DefaultResultCollector implements ResultCollector {
  private resultHandlers: ResultHandler[] = [];

  async collect(
    batches: ScheduledBatch[],
    dispatcher: ToolDispatcher,
    options: CollectOptions,
    abortSignal?: AbortSignal,
  ): Promise<CollectResult> {
    const allResults: ToolResultContent[] = [];
    const startTime = Date.now();

    for (const batch of batches) {
      // 检查是否已中止
      if (abortSignal?.aborted) break;

      // 逐层执行
      const layerStart = Date.now();
      const layerResult = await dispatcher.executeBatch(batch, options.maxConcurrency);

      for (const r of layerResult.results) {
        const toolResult: ToolResultContent = {
          type: 'tool_result',
          toolCallId: r.id,
          success: r.success,
          result: r.data || {},
          error: r.error,
          durationMs: r.durationMs,
        };
        allResults.push(toolResult);
        this.resultHandlers.forEach(h => h(toolResult));
      }

      // 层级间延迟
      if (batches.length > 1) {
        await sleep(options.interLayerDelayMs);
      }
    }

    const totalDurationMs = Date.now() - startTime;
    const successCount = allResults.filter(r => r.success).length;

    return {
      results: allResults,
      successCount,
      failCount: allResults.length - successCount,
      totalDurationMs,
      toolDurations: allResults.map(r => ({
        toolName: r.toolCallId,
        durationMs: r.durationMs || 0,
        success: r.success,
      })),
      hasErrors: successCount < allResults.length,
    };
  }
}
```

#### DefaultFallbackManager（fallback/fallback-manager.ts）

```typescript
class DefaultFallbackManager implements FallbackManager {
  private strategies: FallbackStrategy[] = [
    new RetryStrategy(),
    new DegradeStrategy(),
    new SkipStrategy(),
    new AbortStrategy(),
  ];

  async handle(
    failedCall: ToolCallContent,
    context: FallbackContext,
  ): Promise<FallbackResult> {
    for (const strategy of this.strategies) {
      if (strategy.shouldApply(failedCall, context)) {
        logger.info(`[Fallback] 应用策略: ${strategy.name}`, {
          toolName: failedCall.toolName,
          attemptCount: context.attemptCount,
        });
        return strategy.execute(failedCall, context);
      }
    }

    // 默认：标记为失败
    return {
      result: {
        type: 'tool_result',
        toolCallId: failedCall.toolCallId,
        success: false,
        result: {},
        error: '所有兜底策略均不适用',
      },
      strategyUsed: 'none',
      resolved: false,
    };
  }
}
```

### 3.3 集成方式

#### 在 Agent Core 中集成

```typescript
// Agent Core 初始化时
import { FunctionCallingPipeline } from './pipeline';
import { WorkspaceManager } from './workspace';
import { DefaultToolDispatcher } from './pipeline/tool-dispatcher';
import { CustomResultFormatter } from './custom-formatter';

// 创建管线
const pipeline = new FunctionCallingPipeline({
  enableFallback: true,
  schedule: {
    onError: 'continue',
    maxConcurrency: 5,
  },
  collect: {
    globalTimeoutMs: 60000,
    failFast: false,
  },
});

// 自定义分发器（注入工作区管理器的依赖）
pipeline.setDispatcher(new DefaultToolDispatcher(workspaceManager));

// 注册中间件
pipeline.use(new LoggerMiddleware());
pipeline.use(new MetricsMiddleware());

// 自定义结果格式化
pipeline.setInjector(new DefaultResultInjector());
pipeline.getInjector().registerFormatter('move_to', new MoveResultFormatter());

// 注册自定义兜底策略
pipeline.getFallback().registerStrategy('ai_replan', new AIReplanStrategy(llmProvider));

// 监听管线事件（用于 UI 面板）
pipeline.on('pipeline:tool-completed', ({ toolName, result }) => {
  logger.info(`工具完成: ${toolName}`, result);
});
pipeline.on('pipeline:fallback', ({ toolName, strategy }) => {
  logger.warn(`兜底触发: ${toolName} → 策略: ${strategy}`);
});
pipeline.on('pipeline:complete', ({ result }) => {
  logger.info(`管线完成: ${result.stats.success}/${result.stats.total}`);
});
```

#### 与 LLM 调用结合

```typescript
// 在 LLM 调用流程中使用
async function handleLLMResponse(
  llmResponse: LLMResponse,
  conversation: Conversation,
  workspaceId: string,
): Promise<PipelineResult> {
  // 如果有工具调用，走管线
  if (llmResponse.message.tool_calls?.length > 0) {
    const result = await pipeline.process(llmResponse, workspaceId, {
      requestId: `req_${Date.now()}`,
    });

    // 记录统计
    metrics.recordPipeline(result);

    return result;
  }

  // 纯文本响应，无需管线处理
  return {
    toolResults: [],
    totalDurationMs: 0,
    // ...
  };
}
```

### 3.4 实施步骤

| 步骤 | 任务 | 开发者 | 产出物 | 预估工时 |
|:----:|------|:------:|--------|:--------:|
| 1 | 创建类型定义 `types.ts`（所有接口 + 事件类型） | A | `src/main/pipeline/types.ts` | 2h |
| 2 | 实现 ResponseParser | A | `src/main/pipeline/response-parser.ts` | 2h |
| 3 | 实现 DependencyAnalyzer（含冲突矩阵） | A | `src/main/pipeline/dependency-analyzer.ts` | 4h |
| 4 | 实现 BatchScheduler | A | `src/main/pipeline/batch-scheduler.ts` | 2h |
| 5 | 实现 ResultInjector | A | `src/main/pipeline/result-injector.ts` | 3h |
| 6 | 实现 FunctionCallingPipeline 主类 | A | `src/main/pipeline/pipeline.ts` | 6h |
| 7 | 实现 ToolDispatcher（依赖 WorkspaceManager） | B | `src/main/pipeline/tool-dispatcher.ts` | 4h |
| 8 | 实现 ResultCollector | B | `src/main/pipeline/result-collector.ts` | 3h |
| 9 | 实现 FallbackManager + 重试/降级策略 | B | `src/main/pipeline/fallback/` | 4h |
| 10 | 实现内置中间件（日志 + 校验 + 指标） | B | `src/main/pipeline/middleware/` | 3h |
| 11 | 集成测试 + 单元测试 | A + B | `__tests__/pipeline/` | 6h |

**实施顺序**：步骤 1 → 2 → 3 → 7 → 8 → 4 → 5 → 9 → 10 → 6 → 11

### 3.5 测试计划

#### 单元测试

| 测试文件 | 覆盖内容 | 关键用例 |
|----------|----------|----------|
| `response-parser.test.ts` | 解析/校验 | 合法 tool_calls、空响应、格式错误、部分参数缺失 |
| `dependency-analyzer.test.ts` | 依赖分析 | 无依赖、线性依赖、多层依赖、循环依赖、冲突检测 |
| `batch-scheduler.test.ts` | 调度策略 | layered/sequential/greedy、超时配置 |
| `tool-dispatcher.test.ts` | 分发执行 | 单 Batch、多 Batch、工作区不存在、连接断开 |
| `result-collector.test.ts` | 结果收集 | 全部成功、部分失败、超时、中止 |
| `fallback-manager.test.ts` | 兜底策略 | 重试成功、重试耗尽、降级、跳过、终止 |

#### 集成测试

| 测试场景 | 方法 |
|----------|------|
| 完整管线流程 | Mock LLM 返回 5 个 tool_calls → 全流程走完 |
| 部分失败 + 兜底 | 2/5 失败 → 兜底策略介入 → 最终 4/5 成功 |
| 循环依赖检测 | 构造 A→B→C→A 的依赖 → 报错不执行 |
| 超时场景 | 设置 1s 超时 → 工具 3s 才返回 → timeout 错误 |
| 中止信号 | 执行中取消 → 剩余调用标记 cancelled |

### 3.6 扩展指南

V4 的接口设计预留了以下扩展点，后续版本可直接使用：

| 扩展点 | 接口 | 后续用途 | 预计版本 |
|--------|------|----------|:--------:|
| 自定义 Provider 格式解析 | `ResponseParser` | 支持非标准 LLM 响应格式 | V6 |
| 语义级依赖分析 | `DependencyAnalyzer` | 基于工具描述文本分析依赖 | V13 |
| 动态调度策略 | `BatchScheduler` | 根据工具历史耗时动态调整并发 | V9 |
| Mock 测试策略 | `DispatchStrategy` | 本地测试时替换真实 Adapter Core | V15 |
| AI 重规划兜底 | `FallbackStrategy` | 工具失败后由 LLM 重新规划 | V7 |
| 结果缓存中间件 | `PipelineMiddleware` | 缓存频繁调用的感知类工具结果 | V11 |
| 自定义结果格式化 | `ResultFormatter` | 针对特定工具定制 LLM 可见格式 | V5 |
| 自定义冲突规则 | `ConflictRule` | 任务系统工具与普通工具的冲突 | V13 |

---

## 第四部分：错误处理

### 4.1 错误码

| 错误码 | 含义 | 触发条件 | 处理方式 |
|--------|------|----------|----------|
| `FCP_001` | 解析失败 | LLM 返回的 tool_calls 格式异常 | 重试 LLM 调用 |
| `FCP_002` | 循环依赖 | 依赖分析检测到环 | 报错，不进入执行 |
| `FCP_003` | 工具未注册 | 调用的工具在工作区中不存在 | 跳过，标记失败 |
| `FCP_004` | 工作区离线 | 目标工作区不在 online 状态 | 等待重连或跳过 |
| `FCP_005` | Batch 超时 | 整个 Batch 超过全局超时 | 返回已收集的结果 |
| `FCP_006` | 管线中止 | 收到 AbortSignal | 立即返回已收集的结果 |
| `FCP_007` | 所有兜底失败 | 所有兜底策略均不适用或执行失败 | 返回原始失败结果 |

### 4.2 日志规范

管线日志遵循 `{阶段}:{事件} {详情}` 格式：

| 日志级别 | 场景 | 示例 |
|:--------:|------|------|
| DEBUG | 管线阶段切换 | `Pipeline:parse calls=3` |
| INFO | 工具完成 | `Tool:completed move_to success=true duration=3450ms` |
| WARN | 兜底触发 | `Fallback:triggered move_to strategy=retry attempt=1` |
| ERROR | 管线错误 | `Pipeline:error code=FCP_003 tool=unknown_tool workspace=ws-1` |

---

## 第五部分：性能目标

| 指标 | 目标 | 测量方式 |
|------|:----:|----------|
| 解析 10 个工具调用 | < 5ms | `performance.now()` |
| 依赖分析 10 个节点 | < 10ms | `performance.now()` |
| 单 Batch 分发（不包含网络延迟） | < 1ms | `performance.now()` |
| 管线总开销（不含工具执行） | < 50ms | 端到端计时 |
| 管线全流程（含工具执行，5 个工具） | < 30s | 端到端计时 |
| 同时处理管线数 | 3 个 | 并发测试 |

---

> **更新记录**
> - 2026-07-05：初版创建，对应 V4 Function Calling Pipeline 模块