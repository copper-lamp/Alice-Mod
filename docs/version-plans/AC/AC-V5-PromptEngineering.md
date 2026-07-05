# Alice Mod Core V5 — 提示词工程与上下文管理

> 版本：v1.0
> 日期：2026-07-05
> 版本号：V5（第 5 周）
> 对应需求：AC-LLM-11、AC-LLM-12、AC-LLM-13、AC-LLM-14
> 关联文档：[AC-01-需求文档.md](AC-01-需求文档.md)、[AC-02-实施计划.md](AC-02-实施计划.md)、[AC-V4-FunctionCallingPipeline.md](AC-V4-FunctionCallingPipeline.md)、[01-LLM抽象层接口规范.md](../../api/01-LLM抽象层接口规范.md)

---

## 第一部分：需求文档

### 1.1 模块定位

提示词工程（Prompt Engineering）模块是 Agent Core 中连接 **LLM 抽象层** 与 **Function Calling 管线** 的关键中间层。它负责将智能体的行为定义、游戏状态、工具列表等结构化信息，组装为 LLM 可理解的高效提示词。

**核心职责**：

| 职责 | 说明 |
|------|------|
| **智能体定义管理** | 提供用户可配置的智能体身份、行为规则、偏好设置 |
| **提示词模板编排** | 支持灵活组合系统提示词/状态注入/工具说明/示例等片段 |
| **工具提示注入** | 将工具 Schema 动态转换为 LLM 可识别的 Function Calling 定义 |
| **上下文窗口管理** | 控制 tokens 预算，确保上下文不超限，优先保留关键信息 |
| **提示词缓存优化** | 分离静态/动态内容，最大化 LLM Prompt Caching 命中率 |

### 1.2 与 V4 管线的关系

```
┌─────────────────────────────────────────────────────────────────────┐
│                        V5 提示词工程模块                              │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ 智能体定义     │  │ 提示词编排器   │  │ 工具提示组装器           │  │
│  │ AgentDef     │  │ PromptBuilder │  │ ToolPromptAssembler    │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬──────────────┘  │
│         │                 │                       │                  │
│         └─────────────────┼───────────────────────┘                  │
│                           │                                          │
│                           ▼                                          │
│              ┌────────────────────────┐                              │
│              │  上下文窗口管理器        │                              │
│              │  ContextWindowManager  │                              │
│              └────────────────────────┘                              │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ messages[] + tools[]
                            ▼
              ┌─────────────────────────────┐
              │  Model Router / Provider    │
              │  LLM 调用层                  │
              └─────────────┬───────────────┘
                            │ LLMResponse
                            ▼
              ┌─────────────────────────────┐
              │  V4 Function Calling 管线    │
              │  解析 → 依赖分析 → 分发 → 收集 │
              └─────────────────────────────┘
```

### 1.3 功能需求列表

| 需求 ID | 需求名称 | 优先级 | 实现状态 |
|---------|---------|:------:|:--------:|
| AC-LLM-11 | 智能体定义系统（Agent Profile / Behavior Rules / Prompt Fragments） | P0 | ⏳ |
| AC-LLM-12 | 提示词编排器（PromptBuilder + 片段注册 + 条件组合） | P0 | ⏳ |
| AC-LLM-13 | 工具提示组装器（ToolPromptAssembler + 分类过滤 + 格式转换） | P0 | ⏳ |
| AC-LLM-14 | 上下文窗口管理器（Token 预算 + 裁剪策略 + 缓存优化） | P1 | ⏳ |

### 1.4 验收标准

| # | 验收条件 | 验证方法 | 测量指标 |
|---|---------|----------|----------|
| 5.1 | 智能体定义可配置身份、规则、偏好 | 创建 AgentProfile 对象，验证所有字段 | 正确序列化/反序列化 |
| 5.2 | 支持注册自定义提示词片段 | 注册 3 个片段，构建时按顺序拼接 | 片段出现在最终消息中 |
| 5.3 | 工具列表按分类注入 | 注册 20 个工具，按分类过滤后注入 | 仅注入指定分类的工具 |
| 5.4 | 上下文窗口不超限 | 构造 50 轮对话，trim 后在限制内 | 消息 tokens 总和 ≤ maxTokens |
| 5.5 | 状态注入格式正确 | 设置 PlayerState 各字段 | 格式化后包含所有字段 |
| 5.6 | 静态前缀缓存命中 | 连续 2 次请求，静态部分完全相同 | 静态前缀缓存 key 一致 |
| 5.7 | 系统提示词可被用户覆盖 | 传入 systemOverride | 覆盖默认系统提示词 |
| 5.8 | 工具提示注入支持自定义格式器 | 注册自定义格式器 | 自定义格式器生效 |

### 1.5 缓存策略设计目标

| 指标 | 目标 | 说明 |
|------|:----:|------|
| 静态前缀占比 | ≥ 70% | 系统提示词 + 工具定义 等静态内容占每次请求的比例 |
| 缓存命中率 | ≥ 90% | 连续请求中，静态前缀部分被缓存命中的比例 |
| 动态内容占比 | ≤ 30% | 状态注入 + 用户输入 + 历史 等动态内容 |
| 缓存 key 稳定性 | 100% | 相同配置的智能体，缓存 key 完全一致 |

---

## 第二部分：架构文档

### 2.1 整体架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       V5 提示词工程模块                                   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    1. 智能体定义系统                               │   │
│  │  ┌────────────────┐  ┌──────────────────┐  ┌────────────────┐  │   │
│  │  │  AgentProfile  │  │  BehaviorRules   │  │ PromptFragments│  │   │
│  │  │  · 身份         │  │  · 核心规则       │  │  · 内置片段     │  │   │
│  │  │  · 个性         │  │  · 策略规则       │  │  · 用户片段     │  │   │
│  │  │  · 偏好         │  │  · 约束规则       │  │  · 条件片段     │  │   │
│  │  └────────┬───────┘  └────────┬─────────┘  └────────┬───────┘  │   │
│  │           └───────────────────┼─────────────────────┘           │   │
│  └───────────────────────────────┼─────────────────────────────────┘   │
│                                  │                                      │
│  ┌───────────────────────────────▼─────────────────────────────────┐   │
│  │                    2. 提示词编排器                                │   │
│  │                                                                  │   │
│  │  ┌────────────────────────────────────────────────────────────┐  │   │
│  │  │                    PromptBuilder                            │  │   │
│  │  │                                                             │  │   │
│  │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │  │   │
│  │  │  │ 系统提示词 │  │ 状态注入  │  │ 工具列表  │  │ 对话历史  │  │  │   │
│  │  │  │ (静态)    │  │ (动态)   │  │ (半静态) │  │ (动态)   │  │  │   │
│  │  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │  │   │
│  │  │                                                             │  │   │
│  │  │  缓存区域: [静态前缀] [半静态内容] [动态内容]                │  │   │
│  │  └────────────────────────────────────────────────────────────┘  │   │
│  └───────────────────────────────┬─────────────────────────────────┘   │
│                                  │                                      │
│  ┌───────────────────────────────▼─────────────────────────────────┐   │
│  │                    3. 工具提示组装器                              │   │
│  │                                                                  │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │   │
│  │  │ 分类过滤       │  │ 格式转换      │  │ 自定义格式器          │  │   │
│  │  │ · 按类别      │  │ · ToolSchema │  │ · 简写模式           │  │   │
│  │  │ · 按条件      │  │ · OpenAI    │  │ · 详细模式           │  │   │
│  │  │ · 按优先级    │  │ · Claude    │  │ · 按工具定制         │  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────────────┘  │   │
│  └───────────────────────────────┬─────────────────────────────────┘   │
│                                  │                                      │
│  ┌───────────────────────────────▼─────────────────────────────────┐   │
│  │                    4. 上下文窗口管理器                            │   │
│  │                                                                  │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │   │
│  │  │ Token 预算    │  │ 裁剪策略      │  │ 缓存 key 生成        │  │   │
│  │  │ · 分段预算    │  │ · 滑动窗口   │  │ · 静态前缀哈希       │  │   │
│  │  │ · 动态调整    │  │ · 摘要压缩   │  │ · 缓存验证           │  │   │
│  │  │ · 预留控制    │  │ · 优先级保留 │  │ · 缓存统计           │  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 提示词缓存优化设计

这是 V5 的核心设计目标。利用 LLM 的 Prompt Caching 功能（如 Anthropic 的 Prompt Caching、OpenAI 的 Context Caching），将提示词分为三个区域：

```
┌──────────────────────────────────────────────────────────────────┐
│                      完整提示词结构                                │
│                                                                  │
│  Region 1: 静态前缀 (Static Prefix)      ← 最高缓存命中率        │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ 系统提示词 (System Prompt)                                │  │
│  │ · 智能体身份定义                                         │  │
│  │ · 行为规则                                               │  │
│  │ · 交互格式说明                                           │  │
│  │ · 核心约束                                               │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Region 2: 半静态内容 (Semi-Static)      ← 缓存命中率较高       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ 工具定义列表 (Tool Definitions)                            │  │
│  │ · 按 Category 分组的工具 Schema                            │  │
│  │ · 工具描述 + 参数说明                                      │  │
│  │ · 在工具集变更时刷新缓存                                    │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Region 3: 动态内容 (Dynamic Content)   ← 每次都不同            │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ 当前状态注入 (State Injection)                            │  │
│  │ 对话历史 (Conversation History)                            │  │
│  │ 用户输入 (User Input)                                      │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Cache Key: hash(agent_profile + behavior_rules + tool_list)     │
│  → 缓存命中的条件下，LLM 只需计算 dynamic 部分                     │
└──────────────────────────────────────────────────────────────────┘
```

**缓存命中场景分析**：

| 场景 | 静态前缀 | 工具列表 | 动态内容 | 缓存命中 |
|------|:--------:|:--------:|:--------:|:--------:|
| 连续对话（同一智能体，同一工具集） | ✅ 命中 | ✅ 命中 | ❌ 不同 | 高 (R1+R2) |
| 工具调用后继续（结果回注入历史） | ✅ 命中 | ✅ 命中 | ❌ 不同 | 高 (R1+R2) |
| 切换工作区（相同智能体配置） | ✅ 命中 | ❌ 不同 | ❌ 不同 | 中 (R1) |
| 修改智能体配置 | ❌ 不同 | ✅ 命中 | ❌ 不同 | 低 |
| 首次启动 | ❌ 首次 | ❌ 首次 | ❌ 首次 | 无 |

### 2.3 核心数据流

```
用户/事件触发
    │
    ▼
┌──────────────────────────────────────────────┐
│  PromptBuilder.build()                       │
│                                              │
│  1. 加载 AgentProfile 定义 → 生成系统提示词    │
│  2. 注入 BehaviorRules → 附加到系统提示词     │
│  3. 加载 PromptFragments → 按顺序拼接         │
│  4. 调用 ToolPromptAssembler → 生成工具列表   │
│  5. 采集 PlayerState → 格式化状态注入         │
│  6. 加载对话历史 → 裁剪到 tokens 预算内       │
│  7. 组装最终消息列表 + 计算缓存 key           │
│                                              │
│  ┌──────────────┐  ┌────────────────────┐   │
│  │ CacheKey     │  │ 缓存命中?           │   │
│  │ agent:xxx    │──→ 是 → 复用缓存区域   │   │
│  │ tools:xxx    │  │ 否 → 全新构建       │   │
│  └──────────────┘  └────────────────────┘   │
└──────────────────────┬───────────────────────┘
                       │ messages[] + tools[]
                       ▼
┌──────────────────────────────────────────────┐
│  ModelRouter.resolve() → Provider.chat()     │
│  (LLM 调用，利用缓存加速)                      │
└──────────────────────┬───────────────────────┘
                       │ LLMResponse
                       ▼
┌──────────────────────────────────────────────┐
│  V4 FunctionCallingPipeline.process()        │
│  (解析 → 依赖分析 → 分发 → 收集 → 回注)      │
└──────────────────────┬───────────────────────┘
                       │ tool_result[]
                       ▼
┌──────────────────────────────────────────────┐
│  ContextWindowManager.append()              │
│  (将结果回注到对话历史，触发裁剪)             │
└──────────────────────────────────────────────┘
```

### 2.4 核心接口设计

#### 2.4.1 AgentProfile — 智能体定义

```typescript
/**
 * 智能体定义
 * 用户可配置的核心身份、行为规则和偏好设置
 */
interface AgentProfile {
  /** 智能体名称 */
  name: string;
  /** 智能体身份描述 */
  identity: string;
  /** 个性特征 */
  personality: string[];
  /** 行为规则 */
  rules: BehaviorRules;
  /** 偏好设置 */
  preferences: AgentPreferences;
  /** 自定义提示词片段 */
  fragments: PromptFragment[];
}

interface BehaviorRules {
  /** 核心规则（始终生效） */
  core: string[];
  /** 策略规则（影响决策方式） */
  strategy: StrategyRule[];
  /** 约束规则（限制行为边界） */
  constraints: ConstraintRule[];
}

interface StrategyRule {
  name: string;
  description: string;
  priority: number;         // 数字越大优先级越高
  condition?: string;       // 触发条件（可选，为空则始终生效）
}

interface ConstraintRule {
  name: string;
  description: string;
  /** 违背后果 */
  consequence: 'warning' | 'block' | 'replan';
}

interface AgentPreferences {
  /** 语言偏好 */
  language: string;
  /** 详细程度（0=最简 1=标准 2=详细） */
  verbosity: 0 | 1 | 2;
  /** 是否允许主动行为 */
  allowProactive: boolean;
  /** 风险偏好（0=保守 1=平衡 2=激进） */
  riskTolerance: 0 | 1 | 2;
  /** 额外配置（扩展点） */
  extras: Record<string, unknown>;
}

/** 提示词片段 */
interface PromptFragment {
  /** 片段名称 */
  name: string;
  /** 片段内容（支持模板变量） */
  template: string;
  /** 插入位置 */
  position: 'system_begin' | 'system_end' | 'before_tools' | 'after_tools';
  /** 启用条件（为空则始终启用） */
  condition?: string;
  /** 是否启用 */
  enabled: boolean;
}
```

#### 2.4.2 PromptBuilder — 提示词编排器

```typescript
/**
 * 提示词编排器
 * 负责将智能体定义、游戏状态、工具列表等组装为 LLM 消息
 */
interface PromptBuilder {
  /**
   * 构建完整的消息列表
   * @param params - 构建参数
   * @returns 组装后的消息列表 + 缓存信息
   */
  build(params: BuildParams): Promise<PromptBuildResult>;

  /**
   * 注册自定义提示词片段
   * @param fragment - 提示词片段
   */
  registerFragment(fragment: PromptFragment): void;

  /**
   * 获取当前智能体定义
   */
  getProfile(): AgentProfile;

  /**
   * 更新智能体定义
   */
  updateProfile(profile: Partial<AgentProfile>): void;

  /**
   * 获取缓存统计
   */
  getCacheStats(): CacheStats;
}

interface BuildParams {
  /** 工作区 ID */
  workspaceId: string;
  /** 用户输入 */
  userInput: string;
  /** 对话历史 */
  history: ConversationMessage[];
  /** 当前玩家状态 */
  state: PlayerState;
  /** 触发来源 */
  source: 'user' | 'event' | 'system' | 'tool_result';
  /** 系统提示词覆盖（可选） */
  systemOverride?: string;
  /** 注入的自定义上下文（可选，供中间件使用） */
  extraContext?: Record<string, unknown>;
}

interface PromptBuildResult {
  /** 组装后的消息列表 */
  messages: ConversationMessage[];
  /** 工具定义列表（LLM Function Calling 格式） */
  tools: ToolPromptDefinition[];
  /** 缓存信息 */
  cache: CacheInfo;
  /** 各区域 token 统计 */
  tokenBreakdown: TokenBreakdown;
  /** 是否命中缓存 */
  cacheHit: boolean;
}

interface CacheInfo {
  /** 缓存 key */
  key: string;
  /** 静态前缀 tokens 数 */
  staticTokens: number;
  /** 动态内容 tokens 数 */
  dynamicTokens: number;
  /** 总 tokens 数 */
  totalTokens: number;
  /** 缓存区域 */
  regions: {
    system: string;      // 系统提示词 hash
    tools: string;       // 工具列表 hash
    dynamic: string;     // 动态内容 hash
  };
}

interface TokenBreakdown {
  systemPrompt: number;
  stateInjection: number;
  toolDefinitions: number;
  conversationHistory: number;
  userInput: number;
  fragments: number;
  total: number;
}

/** 缓存统计 */
interface CacheStats {
  totalBuilds: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  avgStaticTokens: number;
  avgDynamicTokens: number;
}
```

#### 2.4.3 ToolPromptAssembler — 工具提示组装器

```typescript
/**
 * 工具提示组装器
 * 将工具 Schema 动态转换为 LLM 可识别的工具定义格式
 */
interface ToolPromptAssembler {
  /**
   * 组装工具列表
   * @param workspaceId - 工作区 ID
   * @param options - 组装选项
   * @returns 格式化的工具定义列表
   */
  assemble(
    workspaceId: string,
    options?: AssembleOptions,
  ): Promise<ToolPromptDefinition[]>;

  /**
   * 按类别过滤工具
   */
  filterByCategory(
    tools: ToolPromptDefinition[],
    categories: string[],
  ): ToolPromptDefinition[];

  /**
   * 按条件过滤工具
   */
  filterByCondition(
    tools: ToolPromptDefinition[],
    condition: (tool: ToolPromptDefinition) => boolean,
  ): ToolPromptDefinition[];

  /**
   * 注册自定义提示格式器
   * 用于控制特定工具在提示词中的呈现方式
   */
  registerFormatter(
    toolName: string,
    formatter: ToolPromptFormatter,
  ): void;

  /**
   * 注册 Provider 格式适配器
   * 不同 LLM Provider 对工具定义的格式要求不同
   */
  registerProviderAdapter(
    providerId: string,
    adapter: ToolFormatAdapter,
  ): void;
}

interface AssembleOptions {
  /** 目标 Provider（影响格式） */
  providerId?: string;
  /** 包含的类别（默认全部） */
  includeCategories?: string[];
  /** 排除的类别 */
  excludeCategories?: string[];
  /** 包含的工具名（默认全部） */
  includeTools?: string[];
  /** 排除的工具名 */
  excludeTools?: string[];
  /** 工具描述详细程度 */
  verbosity?: 'minimal' | 'standard' | 'detailed';
  /** 是否按类别分组 */
  groupByCategory?: boolean;
  /** 最大工具数量（超出则按优先级截断） */
  maxTools?: number;
  /** 是否启用缓存 */
  useCache?: boolean;
}

/** 工具提示定义（转为 Provider 格式前的中间表示） */
interface ToolPromptDefinition {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 参数定义 */
  parameters: Record<string, ToolParamPrompt>;
  /** 所属类别 */
  category: string;
  /** 使用优先级（数字越小越优先） */
  priority: number;
  /** 使用示例（可选，提高 LLM 理解） */
  examples?: ToolExample[];
  /** 使用条件说明（可选） */
  usageHint?: string;
}

interface ToolParamPrompt {
  type: string;
  description: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
  /** 示例值 */
  example?: unknown;
}

interface ToolExample {
  /** 示例描述 */
  description: string;
  /** 示例参数 */
  arguments: Record<string, unknown>;
  /** 预期结果说明 */
  expectedResult?: string;
}

/** 工具提示格式器（用于自定义特定工具的呈现） */
interface ToolPromptFormatter {
  /**
   * 格式化工具提示
   * @param tool - 原始工具定义
   * @returns 格式化后的工具定义
   */
  format(tool: ToolPromptDefinition): ToolPromptDefinition;
}

/** Provider 格式适配器 */
interface ToolFormatAdapter {
  /**
   * 将内部格式转换为 Provider 特定的格式
   * @param tools - 内部工具定义列表
   * @returns Provider 格式的工具定义
   */
  convert(tools: ToolPromptDefinition[]): unknown[];
}
```

#### 2.4.4 ContextWindowManager — 上下文窗口管理器

```typescript
/**
 * 上下文窗口管理器
 * 负责控制 tokens 预算、裁剪历史、管理缓存
 */
interface ContextWindowManager {
  /**
   * 裁剪对话历史，确保不超过 tokens 上限
   * @param history - 对话历史
   * @param options - 裁剪选项
   * @returns 裁剪后的消息列表
   */
  trim(
    history: ConversationMessage[],
    options?: TrimOptions,
  ): ConversationMessage[];

  /**
   * 估算消息列表的 tokens 数
   */
  estimateTokens(messages: ConversationMessage[]): number;

  /**
   * 构建缓存 key
   * @param context - 缓存上下文
   * @returns 缓存 key
   */
  buildCacheKey(context: CacheKeyContext): string;

  /**
   * 获取窗口配置
   */
  getConfig(): ContextWindowConfig;

  /**
   * 更新窗口配置
   */
  updateConfig(config: Partial<ContextWindowConfig>): void;
}

interface ContextWindowConfig {
  /** 最大 tokens */
  maxTokens: number;                    // default: 128000
  /** 预留的系统提示词 tokens */
  systemReserveTokens: number;          // default: 2000
  /** 预留的状态注入 tokens */
  stateReserveTokens: number;           // default: 200
  /** 预留的工具定义 tokens */
  toolsReserveTokens: number;           // default: 4000
  /** 预留的自定义片段 tokens */
  fragmentsReserveTokens: number;       // default: 1000
  /** 对话历史最大 tokens */
  historyMaxTokens: number;             // default: 80000
  /** 保留的最新对话轮数 */
  keepRecentRounds: number;             // default: 30
  /** 工具结果压缩阈值（超出的结果压缩为摘要） */
  toolResultCompressThreshold: number;  // default: 2048
  /** 裁剪策略 */
  trimStrategy: 'sliding_window' | 'summary' | 'priority';
}

interface TrimOptions {
  /** 覆盖 maxTokens */
  maxTokens?: number;
  /** 强制保留的轮数 */
  forceKeepRounds?: number;
  /** 是否启用摘要压缩 */
  enableSummary?: boolean;
}

interface CacheKeyContext {
  /** 智能体 profile hash */
  agentHash: string;
  /** 工具列表 hash */
  toolsHash: string;
  /** 工作区 ID */
  workspaceId: string;
  /** Provider ID */
  providerId: string;
  /** 额外维度（可选） */
  dimensions?: Record<string, string>;
}

/** 缓存 key 各部分格式 */
interface CacheKeyParts {
  /** 静态前缀 key（系统提示词） */
  staticPrefix: string;    // cache:agent:{agentHash}:system
  /** 工具定义 key */
  toolDefinitions: string; // cache:agent:{agentHash}:tools:{toolsHash}
  /** 完整缓存 key */
  full: string;            // cache:agent:{agentHash}:tools:{toolsHash}:ws:{workspaceId}
}
```

#### 2.4.5 提示词模板系统

```typescript
/**
 * 提示词模板引擎
 * 支持模板变量替换和条件渲染
 */
interface PromptTemplateEngine {
  /**
   * 渲染模板
   * @param template - 模板字符串
   * @param variables - 变量值
   * @returns 渲染后的文本
   */
  render(template: string, variables: Record<string, unknown>): string;

  /**
   * 注册自定义模板函数
   * @param name - 函数名称
   * @param fn - 函数实现
   */
  registerFunction(name: string, fn: TemplateFunction): void;
}

/** 模板变量引用格式 */
// 变量: {{variableName}}
// 嵌套: {{state.health}}
// 条件: {{#if condition}}内容{{/if}}
// 循环: {{#each list}}项目{{/each}}
// 函数: {{fnName arg1 arg2}}

type TemplateFunction = (...args: string[]) => string;
```

### 2.5 默认提示词结构

```
[Region 1: 静态前缀 — 始终缓存]
──────────────────────────────────────────────────────────────────
System: 你是 {agent.name}，一个运行在 Minecraft 世界中的 AI 智能体。

## 你的身份
{agent.identity}

## 个性特征
{agent.personality}

## 核心规则
{behaviorRules.core}

## 策略规则
{behaviorRules.strategy}

## 约束规则
{behaviorRules.constraints}

## 交互格式
- 你可以通过思考来规划步骤
- 需要操作游戏时，使用工具调用
- 工具会批量执行，可以一次发出多个不冲突的工具调用
- 等所有工具执行完成后，我会把结果告诉你

## 自定义片段
{fragments}

[Region 2: 半静态 — 工具集变更时缓存失效]
──────────────────────────────────────────────────────────────────
## 可用工具
{formatted tool definitions}

[Region 3: 动态 — 每次都不同]
──────────────────────────────────────────────────────────────────
## 当前状态
{formatted player state}

## 对话历史
{conversation history}

## 用户输入
{user input}
```

### 2.6 内置智能体定义（默认）

```typescript
/** 默认智能体定义 */
const DEFAULT_AGENT_PROFILE: AgentProfile = {
  name: 'McAgent',
  identity: '你是一个有自主意识的 Minecraft 玩家，会像人类一样思考和探索。',
  personality: [
    '谨慎但不胆小，在安全的前提下勇于探索',
    '有条理，会规划任务顺序',
    '乐于助人，接受玩家的指令和委托',
  ],
  rules: {
    core: [
      '每次只做一件事，完成后再做下一件',
      '工具可能失败（寻路失败、物品不足等），失败后分析原因并尝试其他方案',
      '注意资源消耗（饥饿值、工具耐久度）',
      '危险时优先保证生存（逃跑、进食、回血）',
    ],
    strategy: [
      { name: '效率优先', description: '优先选择耗时最短的方案', priority: 1 },
      { name: '资源节约', description: '避免浪费稀有资源', priority: 2 },
    ],
    constraints: [
      { name: '安全边界', description: '生命值低于 5 时停止战斗/探索', consequence: 'replan' },
      { name: '资源底线', description: '不消耗最后 1 组食物', consequence: 'warning' },
    ],
  },
  preferences: {
    language: 'zh-CN',
    verbosity: 1,
    allowProactive: true,
    riskTolerance: 1,
    extras: {},
  },
  fragments: [],
};
```

### 2.7 工具提示注入策略

工具提示注入是整个系统的关键环节，直接影响 LLM 对工具的理解和使用能力。

**注入策略**：

| 策略 | 说明 | 适用场景 |
|------|------|----------|
| **全量注入** | 注入所有可用工具 | 首次启动、工具集变更时 |
| **分类注入** | 仅注入特定分类工具 | 当前任务明确时 |
| **优先级截断** | 按优先级排序，超出 maxTools 截断 | tokens 预算紧张时 |
| **动态选择** | 根据当前状态和任务选择最相关的工具 | 工具数量 > 50 时 |

**格式层级**：

```typescript
/** 工具描述详细程度 */
enum ToolVerbosity {
  /** 极简：仅工具名 + 一句话描述 */
  Minimal = 'minimal',
  /** 标准：工具名 + 描述 + 必填参数 */
  Standard = 'standard',
  /** 详细：工具名 + 描述 + 所有参数 + 示例 */
  Detailed = 'detailed',
}

/** 标准格式示例 */
// Minimal:
//   move_to: 移动到目标位置
//
// Standard:
//   move_to(x: number, z: number, y?: number)
//   描述：移动到目标位置
//   必填参数：x, z
//
// Detailed:
//   move_to(x: number, z: number, y?: number)
//   描述：移动到目标位置，自动寻路
//   参数：
//     x (number, 必填): 目标 X 坐标
//     z (number, 必填): 目标 Z 坐标
//     y (number, 可选): 目标 Y 坐标
//   示例：move_to({x: 100, z: 200}) → 移动到 (100, 0, 200)
```

**Provider 格式适配**：

不同 LLM Provider 对工具定义的格式要求不同，需要适配器进行转换：

| Provider | 格式要求 | 适配器 |
|----------|----------|--------|
| OpenAI | Function Calling JSON Schema | `OpenAIFormatAdapter` |
| Claude | Tools API (JSON Schema) | `ClaudeFormatAdapter` |
| Gemini | FunctionDeclaration | `GeminiFormatAdapter` |
| Ollama | 兼容 OpenAI 格式 | `OpenAIFormatAdapter` |

---

## 第三部分：执行文档

### 3.1 文件结构

```
src/main/prompt/
├── index.ts                          ─ 模块入口，统一导出
├── types.ts                          ─ 类型定义（所有接口）
│
├── agent/
│   ├── agent-profile.ts              ─ AgentProfile 默认实现
│   ├── behavior-rules.ts             ─ BehaviorRules 管理
│   └── prompt-fragments.ts           ─ PromptFragment 管理
│
├── builder/
│   ├── prompt-builder.ts             ─ PromptBuilder 主类
│   ├── system-prompt-builder.ts      ─ 系统提示词构建
│   ├── state-injector.ts             ─ 状态注入格式化
│   └── template-engine.ts            ─ 模板引擎（变量替换 + 条件渲染）
│
├── tools/
│   ├── tool-prompt-assembler.ts      ─ ToolPromptAssembler 主类
│   ├── tool-format-adapters.ts       ─ Provider 格式适配器
│   └── tool-formatters.ts            ─ 自定义工具格式器
│
├── context/
│   ├── context-window-manager.ts     ─ ContextWindowManager 主类
│   ├── trim-strategies.ts            ─ 裁剪策略实现
│   └── cache-key-builder.ts          ─ 缓存 key 构建
│
└── __tests__/
    ├── prompt-builder.test.ts
    ├── tool-prompt-assembler.test.ts
    ├── context-window-manager.test.ts
    ├── agent-profile.test.ts
    ├── template-engine.test.ts
    ├── cache-key-builder.test.ts
    └── integration/
        └── full-prompt-flow.test.ts  ─ 全流程集成测试
```

### 3.2 核心类实现说明

#### PromptBuilder（builder/prompt-builder.ts）

```typescript
class PromptBuilder implements IPromptBuilder {
  private profile: AgentProfile;
  private assembler: ToolPromptAssembler;
  private contextManager: ContextWindowManager;
  private templateEngine: PromptTemplateEngine;
  private customFragments: PromptFragment[] = [];

  constructor(config?: PromptBuilderConfig) {
    this.profile = config?.profile ?? DEFAULT_AGENT_PROFILE;
    this.assembler = config?.assembler ?? new DefaultToolPromptAssembler();
    this.contextManager = config?.contextManager ?? new DefaultContextWindowManager();
    this.templateEngine = new DefaultPromptTemplateEngine();
  }

  async build(params: BuildParams): Promise<PromptBuildResult> {
    // 1. 构建系统提示词（静态部分）
    const systemPrompt = this.buildSystemPrompt(params.systemOverride);

    // 2. 组装工具列表（半静态部分）
    const tools = await this.assembler.assemble(params.workspaceId, {
      providerId: params.source === 'tool_result' ? undefined : 'openai',
      groupByCategory: true,
      verbosity: this.profile.preferences.verbosity === 2 ? 'detailed' : 'standard',
    });
    const toolDefinitions = this.convertToolsForProvider(tools, params.source);

    // 3. 格式化状态注入（动态部分）
    const stateInjection = this.formatStateInjection(params.state);

    // 4. 构建缓存 key
    const cacheKey = this.contextManager.buildCacheKey({
      agentHash: this.hashAgentProfile(),
      toolsHash: await this.hashToolDefinitions(tools),
      workspaceId: params.workspaceId,
      providerId: 'openai',
    });

    // 5. 裁剪对话历史
    const trimmedHistory = this.contextManager.trim(params.history);

    // 6. 组装最终消息列表
    const messages = this.assembleMessages(
      systemPrompt,
      stateInjection,
      trimmedHistory,
      params.userInput,
    );

    // 7. 计算 token 统计
    const tokenBreakdown = this.calculateTokenBreakdown(
      systemPrompt,
      stateInjection,
      toolDefinitions,
      params.history,
      params.userInput,
    );

    return {
      messages,
      tools: toolDefinitions,
      cache: {
        key: cacheKey,
        staticTokens: tokenBreakdown.systemPrompt + tokenBreakdown.toolDefinitions,
        dynamicTokens: tokenBreakdown.stateInjection + tokenBreakdown.conversationHistory + tokenBreakdown.userInput,
        totalTokens: tokenBreakdown.total,
        regions: {
          system: this.hashString(systemPrompt),
          tools: await this.hashToolDefinitions(tools),
          dynamic: this.hashString(stateInjection + params.userInput),
        },
      },
      tokenBreakdown,
      cacheHit: false, // 由外部缓存系统判断
    };
  }

  private buildSystemPrompt(override?: string): string {
    if (override) return override;

    const parts: string[] = [];

    // 系统提示词开头
    parts.push(`你是 ${this.profile.name}，一个运行在 Minecraft 世界中的 AI 智能体。\n`);

    // 身份定义
    parts.push(`## 你的身份\n${this.profile.identity}\n`);

    // 个性特征
    if (this.profile.personality.length > 0) {
      parts.push(`## 个性特征\n${this.profile.personality.map(p => `- ${p}`).join('\n')}\n`);
    }

    // 核心规则
    if (this.profile.rules.core.length > 0) {
      parts.push(`## 核心规则\n${this.profile.rules.core.map(r => `- ${r}`).join('\n')}\n`);
    }

    // 策略规则
    if (this.profile.rules.strategy.length > 0) {
      parts.push(`## 策略规则\n${this.profile.rules.strategy
        .sort((a, b) => b.priority - a.priority)
        .map(r => `- ${r.description}`)
        .join('\n')}\n`);
    }

    // 约束规则
    if (this.profile.rules.constraints.length > 0) {
      parts.push(`## 约束规则\n${this.profile.rules.constraints
        .map(c => `- ${c.description}（违背后果：${c.consequence === 'block' ? '阻止操作' : c.consequence === 'replan' ? '重新规划' : '警告'}）`)
        .join('\n')}\n`);
    }

    // 交互格式说明
    parts.push(`## 交互格式\n- 你可以通过思考来规划步骤\n- 需要操作游戏时，使用工具调用\n- 工具会批量执行，可以一次发出多个不冲突的工具调用\n- 等所有工具执行完成后，我会把结果告诉你\n`);

    // 自定义提示词片段（system_begin / system_end 位置）
    const allFragments = [...this.profile.fragments, ...this.customFragments];
    for (const fragment of allFragments) {
      if (fragment.enabled && (fragment.position === 'system_begin' || fragment.position === 'system_end')) {
        const rendered = this.templateEngine.render(fragment.template, {
          agent: this.profile,
          state: {},
        });
        if (rendered) {
          if (fragment.position === 'system_begin') {
            parts.unshift(rendered);
          } else {
            parts.push(rendered);
          }
        }
      }
    }

    return parts.join('\n');
  }

  private formatStateInjection(state: PlayerState): string {
    const items = state.inventory?.items?.join(', ') || '空';
    const effects = state.statusEffects?.length > 0
      ? state.statusEffects.join(', ')
      : '无';

    return [
      `## 当前状态`,
      `生命: ${state.health}/20`,
      `饥饿: ${state.hunger}/20`,
      `饱和度: ${state.saturation}`,
      `位置: (${state.position.x}, ${state.position.y}, ${state.position.z}) ${state.position.dimension}`,
      state.position.biome ? `生物群系: ${state.position.biome}` : '',
      `装备: 主手=${state.equipment?.mainhand || '无'}, 头盔=${state.equipment?.helmet || '无'}, 胸甲=${state.equipment?.chestplate || '无'}, 护腿=${state.equipment?.leggings || '无'}, 靴子=${state.equipment?.boots || '无'}`,
      `背包: ${state.inventory?.usedSlots || 0}/${state.inventory?.totalSlots || 0} - ${items}`,
      `状态效果: ${effects}`,
      state.specialStatus || '',
    ].filter(Boolean).join('\n');
  }

  private assembleMessages(
    systemPrompt: string,
    stateInjection: string,
    history: ConversationMessage[],
    userInput: string,
  ): ConversationMessage[] {
    const messages: ConversationMessage[] = [];

    // 系统提示词（role: system）
    messages.push({ role: 'system', content: systemPrompt });

    // 对话历史（role: user / assistant / tool）
    messages.push(...history);

    // 当前用户输入（role: user，前缀状态注入）
    const userMessage = `${stateInjection}\n\n${userInput}`;
    messages.push({ role: 'user', content: userMessage });

    return messages;
  }
}
```

#### ToolPromptAssembler（tools/tool-prompt-assembler.ts）

```typescript
class DefaultToolPromptAssembler implements ToolPromptAssembler {
  private toolRegistry: ToolRegistry;
  private formatters: Map<string, ToolPromptFormatter> = new Map();
  private adapters: Map<string, ToolFormatAdapter> = new Map();
  private cache: Map<string, { tools: ToolPromptDefinition[]; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 60000; // 60s

  constructor(toolRegistry: ToolRegistry) {
    this.toolRegistry = toolRegistry;
    this.registerDefaultAdapters();
  }

  async assemble(workspaceId: string, options?: AssembleOptions): Promise<ToolPromptDefinition[]> {
    const cacheKey = `tools:${workspaceId}:${JSON.stringify(options || {})}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL && options?.useCache !== false) {
      return cached.tools;
    }

    // 1. 获取原始工具 Schema
    const schemas = this.toolRegistry.getTools(workspaceId);

    // 2. 转换为中间格式
    let tools: ToolPromptDefinition[] = schemas.map(schema => this.schemaToPromptDef(schema));

    // 3. 分类过滤
    if (options?.includeCategories) {
      tools = tools.filter(t => options.includeCategories!.includes(t.category));
    }
    if (options?.excludeCategories) {
      tools = tools.filter(t => !options.excludeCategories!.includes(t.category));
    }

    // 4. 名称过滤
    if (options?.includeTools) {
      tools = tools.filter(t => options.includeTools!.includes(t.name));
    }
    if (options?.excludeTools) {
      tools = tools.filter(t => !options.excludeTools!.includes(t.name));
    }

    // 5. 应用自定义格式器
    tools = tools.map(t => {
      const formatter = this.formatters.get(t.name);
      return formatter ? formatter.format(t) : t;
    });

    // 6. 按优先级排序
    tools.sort((a, b) => a.priority - b.priority);

    // 7. 截断
    if (options?.maxTools && tools.length > options.maxTools) {
      tools = tools.slice(0, options.maxTools);
    }

    // 8. 缓存结果
    this.cache.set(cacheKey, { tools, timestamp: Date.now() });

    return tools;
  }

  private schemaToPromptDef(schema: ToolSchema): ToolPromptDefinition {
    const params: Record<string, ToolParamPrompt> = {};
    for (const [key, def] of Object.entries(schema.parameters)) {
      params[key] = {
        type: def.type,
        description: def.description || '',
        required: def.required,
        default: def.default,
        enum: def.enum,
        example: def.default, // 用 default 作为示例值
      };
    }

    return {
      name: schema.name,
      description: schema.description,
      parameters: params,
      category: schema.category,
      priority: this.getDefaultPriority(schema.category),
      examples: [],
    };
  }

  private getDefaultPriority(category: string): number {
    const priorities: Record<string, number> = {
      perception: 1,
      movement: 2,
      inventory: 3,
      survival: 4,
      block: 5,
      entity: 6,
      chat: 7,
      qq: 8,
      memory: 9,
      task: 10,
    };
    return priorities[category] || 99;
  }

  private registerDefaultAdapters(): void {
    // OpenAI 格式适配器
    this.adapters.set('openai', {
      convert: (tools) => tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: {
            type: 'object',
            properties: Object.fromEntries(
              Object.entries(t.parameters).map(([key, param]) => [
                key,
                {
                  type: param.type,
                  description: param.description,
                  ...(param.enum ? { enum: param.enum } : {}),
                },
              ]),
            ),
            required: Object.entries(t.parameters)
              .filter(([_, p]) => p.required)
              .map(([key]) => key),
          },
        },
      })),
    });
  }
}
```

#### ContextWindowManager（context/context-window-manager.ts）

```typescript
class DefaultContextWindowManager implements ContextWindowManager {
  private config: ContextWindowConfig = {
    maxTokens: 128000,
    systemReserveTokens: 2000,
    stateReserveTokens: 200,
    toolsReserveTokens: 4000,
    fragmentsReserveTokens: 1000,
    historyMaxTokens: 80000,
    keepRecentRounds: 30,
    toolResultCompressThreshold: 2048,
    trimStrategy: 'sliding_window',
  };

  trim(
    history: ConversationMessage[],
    options?: TrimOptions,
  ): ConversationMessage[] {
    if (history.length === 0) return [];

    const maxTokens = options?.maxTokens ?? this.config.historyMaxTokens;
    const forceKeep = options?.forceKeepRounds ?? this.config.keepRecentRounds;

    // 估算当前 tokens
    let estimatedTokens = this.estimateTokens(history);

    // 如果在限制内，直接返回
    if (estimatedTokens <= maxTokens) return history;

    // 需要裁剪
    switch (this.config.trimStrategy) {
      case 'sliding_window':
        return this.trimBySlidingWindow(history, maxTokens, forceKeep);
      case 'summary':
        return this.trimBySummary(history, maxTokens, forceKeep);
      case 'priority':
        return this.trimByPriority(history, maxTokens, forceKeep);
      default:
        return this.trimBySlidingWindow(history, maxTokens, forceKeep);
    }
  }

  /**
   * 滑动窗口裁剪
   * 保留最近的 N 轮对话，丢弃最旧的
   */
  private trimBySlidingWindow(
    history: ConversationMessage[],
    maxTokens: number,
    forceKeep: number,
  ): ConversationMessage[] {
    // 从后往前保留，每轮包含 user + assistant 消息
    const rounds = this.groupIntoRounds(history);
    let keptRounds = rounds.slice(-forceKeep);

    // 如果仍然超限，进一步压缩工具结果
    let estimated = this.estimateTokens(keptRounds.flat());
    if (estimated > maxTokens) {
      keptRounds = this.compressToolResults(keptRounds, maxTokens);
    }

    return keptRounds.flat();
  }

  /**
   * 摘要压缩裁剪
   * 将较旧的对话压缩为摘要
   */
  private trimBySummary(
    history: ConversationMessage[],
    maxTokens: number,
    forceKeep: number,
  ): ConversationMessage[] {
    const rounds = this.groupIntoRounds(history);
    const recentRounds = rounds.slice(-forceKeep);
    const oldRounds = rounds.slice(0, rounds.length - forceKeep);

    if (oldRounds.length === 0) return recentRounds.flat();

    // 将旧对话压缩为摘要
    const summary = this.summarizeRounds(oldRounds);
    const summaryMessage: ConversationMessage = {
      role: 'system',
      content: `[历史摘要] ${summary}`,
    };

    const result = [summaryMessage, ...recentRounds.flat()];
    const estimated = this.estimateTokens(result);

    if (estimated > maxTokens) {
      return this.trimBySlidingWindow(recentRounds.flat(), maxTokens, forceKeep);
    }

    return result;
  }

  /**
   * 优先级裁剪
   * 保留关键消息（系统提示、工具结果）比普通消息优先
   */
  private trimByPriority(
    history: ConversationMessage[],
    maxTokens: number,
    forceKeep: number,
  ): ConversationMessage[] {
    // 按角色分组
    const toolMessages = history.filter(m => m.role === 'tool');
    const assistantMessages = history.filter(m => m.role === 'assistant' && !m.tool_calls);
    const toolCallMessages = history.filter(m => m.role === 'assistant' && m.tool_calls);
    const userMessages = history.filter(m => m.role === 'user');

    // 工具结果优先级最高，保留最近的 N 条
    const keptToolResults = toolMessages.slice(-forceKeep);
    const keptToolCalls = toolCallMessages.slice(-forceKeep / 2);
    const keptUser = userMessages.slice(-forceKeep / 2);
    const keptAssistant = assistantMessages.slice(-forceKeep / 4);

    // 按原始顺序合并
    const merged = this.mergeByOriginalOrder(history, [
      ...keptToolResults,
      ...keptToolCalls,
      ...keptUser,
      ...keptAssistant,
    ]);

    return merged;
  }

  /**
   * 构建缓存 key
   */
  buildCacheKey(context: CacheKeyContext): string {
    const parts: string[] = ['cache'];

    // agent 维度
    parts.push(`agent:${context.agentHash}`);

    // tools 维度
    if (context.toolsHash) {
      parts.push(`tools:${context.toolsHash}`);
    }

    // workspace 维度
    if (context.workspaceId) {
      parts.push(`ws:${context.workspaceId}`);
    }

    // provider 维度
    if (context.providerId) {
      parts.push(`provider:${context.providerId}`);
    }

    // 额外维度
    if (context.dimensions) {
      for (const [key, value] of Object.entries(context.dimensions)) {
        parts.push(`${key}:${value}`);
      }
    }

    return parts.join(':');
  }

  estimateTokens(messages: ConversationMessage[]): number {
    // 粗略估算：每 token ≈ 4 个中文字符
    let total = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        total += Math.ceil(msg.content.length / 4);
      }
      if (msg.tool_calls) {
        total += msg.tool_calls.length * 20; // 每个 tool_call 约 20 tokens
      }
    }
    return total;
  }

  private groupIntoRounds(history: ConversationMessage[]): ConversationMessage[][] {
    const rounds: ConversationMessage[][] = [];
    let currentRound: ConversationMessage[] = [];

    for (const msg of history) {
      currentRound.push(msg);
      if (msg.role === 'assistant' || msg.role === 'tool') {
        rounds.push([...currentRound]);
        currentRound = [];
      }
    }

    if (currentRound.length > 0) {
      rounds.push(currentRound);
    }

    return rounds;
  }
}
```

#### CacheKeyBuilder（context/cache-key-builder.ts）

```typescript
class CacheKeyBuilder {
  /**
   * 构建分层的缓存 key
   *
   * 格式：
   *   cache:agent:{agentHash}:tools:{toolsHash}:ws:{workspaceId}:provider:{providerId}
   *
   * 分层缓存：
   *   Level 1: cache:agent:{agentHash} — 系统提示词（跨工作区共享）
   *   Level 2: cache:agent:{agentHash}:tools:{toolsHash} — 系统提示词 + 工具定义
   *   Level 3: ...:ws:{workspaceId} — 加上工作区特定信息
   */
  build(context: CacheKeyContext): CacheKeyParts {
    const staticPrefix = `cache:agent:${context.agentHash}:system`;
    const toolDefinitions = `cache:agent:${context.agentHash}:tools:${context.toolsHash}`;
    const full = `cache:agent:${context.agentHash}:tools:${context.toolsHash}:ws:${context.workspaceId}:provider:${context.providerId}`;

    return { staticPrefix, toolDefinitions, full };
  }

  /**
   * 从 AgentProfile 生成 hash
   * 确保相同配置的智能体生成相同的 hash
   */
  hashAgentProfile(profile: AgentProfile): string {
    const normalized = {
      name: profile.name,
      identity: profile.identity,
      personality: [...profile.personality].sort(),
      coreRules: [...profile.rules.core].sort(),
      strategyRules: [...profile.rules.strategy]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(r => ({ name: r.name, description: r.description, priority: r.priority })),
      constraints: [...profile.rules.constraints]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(c => ({ name: c.name, description: c.description, consequence: c.consequence })),
      preferences: profile.preferences,
      fragments: [...profile.fragments]
        .filter(f => f.enabled)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(f => ({ name: f.name, template: f.template, position: f.position })),
    };

    return this.hashString(JSON.stringify(normalized));
  }

  /**
   * 从工具列表生成 hash
   */
  hashToolDefinitions(tools: ToolPromptDefinition[]): string {
    const normalized = tools
      .map(t => ({
        name: t.name,
        category: t.category,
        description: t.description,
        paramNames: Object.keys(t.parameters).sort(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return this.hashString(JSON.stringify(normalized));
  }

  private hashString(input: string): string {
    // 使用简单的哈希函数（Node.js crypto 可替换）
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }
}
```

### 3.3 集成方式

```typescript
// Agent Core 初始化时
import { PromptBuilder } from './prompt';
import { ToolPromptAssembler } from './prompt/tools';
import { ContextWindowManager } from './prompt/context';
import { ToolRegistry } from './workspace';

// 创建工具注册表
const toolRegistry = new ToolRegistry();

// 创建提示词编排器
const promptBuilder = new PromptBuilder({
  profile: {
    name: 'MyAgent',
    identity: '你是一个专注于建筑和红石技术的 AI 智能体',
    personality: ['热爱创造，擅长规划大型建筑'],
    rules: {
      core: ['优先使用可再生材料', '建筑风格以现代为主'],
      strategy: [],
      constraints: [],
    },
    preferences: {
      language: 'zh-CN',
      verbosity: 1,
      allowProactive: true,
      riskTolerance: 1,
      extras: {},
    },
    fragments: [
      {
        name: 'specialty',
        template: '## 专长领域\n- 建筑设计\n- 红石电路\n- 资源规划',
        position: 'system_end',
        enabled: true,
      },
    ],
  },
});

// 注册自定义工具提示格式器
const assembler = new DefaultToolPromptAssembler(toolRegistry);
assembler.registerFormatter('move_to', {
  format: (tool) => ({
    ...tool,
    description: `${tool.description}（自动避障，支持跨维度）`,
  }),
});

// 注册自定义提示词片段
promptBuilder.registerFragment({
  name: 'daily_plan',
  template: '## 每日计划\n{{#if morning}}上午优先采集资源{{/if}}',
  position: 'before_tools',
  enabled: true,
});

// 构建提示词
const result = await promptBuilder.build({
  workspaceId: 'ws-1',
  userInput: '帮我收集一些圆石',
  history: [],
  state: {
    health: 20,
    hunger: 18,
    saturation: 5,
    position: { x: 100, y: 64, z: 200, dimension: 'overworld', biome: 'plains' },
    equipment: { mainhand: '铁镐' },
    inventory: { usedSlots: 10, totalSlots: 36, items: ['圆石 x32', '木棍 x4'] },
    statusEffects: [],
  },
  source: 'user',
});

// result.messages → 发送给 LLM
// result.tools → 作为 Function Calling 工具定义
// result.cache.key → 用于缓存判断
```

### 3.4 实施步骤

| 步骤 | 任务 | 产出物 | 预估工时 |
|:----:|------|--------|:--------:|
| 1 | 创建类型定义 `types.ts`（所有接口） | `src/main/prompt/types.ts` | 2h |
| 2 | 实现 AgentProfile + BehaviorRules + PromptFragments | `src/main/prompt/agent/` | 3h |
| 3 | 实现 PromptTemplateEngine（模板引擎） | `src/main/prompt/builder/template-engine.ts` | 3h |
| 4 | 实现 SystemPromptBuilder（系统提示词构建） | `src/main/prompt/builder/system-prompt-builder.ts` | 3h |
| 5 | 实现 StateInjector（状态注入格式化） | `src/main/prompt/builder/state-injector.ts` | 1h |
| 6 | 实现 PromptBuilder 主类 | `src/main/prompt/builder/prompt-builder.ts` | 5h |
| 7 | 实现 ToolPromptAssembler（工具提示组装） | `src/main/prompt/tools/tool-prompt-assembler.ts` | 4h |
| 8 | 实现 ToolFormatAdapters（Provider 格式适配） | `src/main/prompt/tools/tool-format-adapters.ts` | 3h |
| 9 | 实现 ContextWindowManager（窗口管理） | `src/main/prompt/context/context-window-manager.ts` | 4h |
| 10 | 实现 CacheKeyBuilder（缓存 key 构建） | `src/main/prompt/context/cache-key-builder.ts` | 2h |
| 11 | 实现 TrimStrategies（裁剪策略） | `src/main/prompt/context/trim-strategies.ts` | 3h |
| 12 | 单元测试 + 集成测试 | `__tests__/prompt/` | 6h |

**实施顺序**：步骤 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12

### 3.5 测试计划

#### 单元测试

| 测试文件 | 覆盖内容 | 关键用例 |
|----------|----------|----------|
| `agent-profile.test.ts` | 智能体定义 | 创建/更新/序列化 profile、规则管理、片段注册 |
| `template-engine.test.ts` | 模板引擎 | 变量替换、条件渲染、循环渲染、自定义函数 |
| `prompt-builder.test.ts` | 提示词构建 | 完整构建、systemOverride、片段注入、状态注入 |
| `tool-prompt-assembler.test.ts` | 工具组装 | 全量/分类/条件过滤、格式转换、自定义格式器 |
| `context-window-manager.test.ts` | 窗口管理 | 滑动窗口、摘要压缩、优先级裁剪、token 估算 |
| `cache-key-builder.test.ts` | 缓存 key | agent hash、tools hash、分层 key、相同配置一致性 |

#### 集成测试

| 测试场景 | 方法 |
|----------|------|
| 完整提示词构建流程 | AgentProfile → PromptBuilder → 组装消息 → 校验各区域 |
| 工具提示注入 + 格式适配 | 注册 10 个工具 → 分类过滤 → 转换为 OpenAI 格式 |
| 上下文窗口裁剪 + 缓存 key | 构造 50 轮对话 → 裁剪到 30 轮 → 验证 tokens 不超限 |
| 缓存命中验证 | 相同配置连续构建 2 次 → 验证缓存 key 一致 |
| 智能体配置变更 | 修改 profile 后构建 → 缓存 key 变化 |

### 3.6 缓存命中率优化策略

| 策略 | 说明 | 预期效果 |
|------|------|----------|
| **静态前缀分离** | 系统提示词完全独立，不包含任何动态内容 | 缓存 key 稳定 |
| **工具定义哈希** | 工具列表变更时才刷新缓存 | 减少不必要缓存失效 |
| **分层缓存 key** | system/tools/workspace 分层，部分命中可复用 | 提升缓存利用率 |
| **缓存预热** | 首次构建时主动写入缓存 | 减少首次请求延迟 |
| **缓存失效通知** | 工具集变更时广播失效事件 | 及时更新缓存 |
| **缓存统计监控** | 记录命中率、失效原因 | 持续优化缓存策略 |

### 3.7 扩展指南

V5 的接口设计预留了以下扩展点：

| 扩展点 | 接口 | 后续用途 | 预计版本 |
|--------|------|----------|:--------:|
| 自定义提示词片段 | `PromptFragment` | 领域特定提示词注入 | V6 |
| 自定义工具格式器 | `ToolPromptFormatter` | 工具使用示例增强 | V7 |
| 新 Provider 格式适配 | `ToolFormatAdapter` | 支持更多 LLM Provider | V8 |
| 自定义裁剪策略 | `TrimStrategy` | 基于语义的智能裁剪 | V9 |
| 多语言模板 | `PromptTemplateEngine` | 国际化支持 | V10 |
| 动态智能体切换 | `AgentProfile` | 根据任务切换角色 | V11 |

---

## 第四部分：错误处理

### 4.1 错误码

| 错误码 | 含义 | 触发条件 | 处理方式 |
|--------|------|----------|----------|
| `PMP_001` | 模板渲染失败 | 模板语法错误或变量不存在 | 返回原始模板，记录错误 |
| `PMP_002` | 工具列表组装失败 | 工作区不存在或工具注册表不可用 | 返回空工具列表，LLM 无工具可用 |
| `PMP_003` | 状态注入失败 | 状态数据不完整或格式异常 | 使用默认状态，标记缺失字段 |
| `PMP_004` | 缓存 key 构建失败 | 关键维度缺失（agentHash/toolsHash） | 不缓存，每次重建 |
| `PMP_005` | 上下文裁剪异常 | 裁剪后消息列表为空 | 保留最近 1 轮对话 |

### 4.2 日志规范

| 日志级别 | 场景 | 示例 |
|:--------:|------|------|
| DEBUG | 提示词构建 | `Prompt:build ws=ws-1 tokens=12500 cache=miss` |
| DEBUG | 缓存命中 | `Prompt:cache-hit key=cache:agent:abc:tools:def` |
| INFO | 工具列表变更 | `Prompt:tools-changed ws=ws-1 count=15->18` |
| WARN | 模板渲染异常 | `Prompt:template-error fragment=specialty var=unknown` |
| ERROR | 构建失败 | `Prompt:build-error code=PMP_002 ws=ws-1` |

---

## 第五部分：性能目标

| 指标 | 目标 | 测量方式 |
|------|:----:|----------|
| 提示词构建（含工具组装） | < 50ms | `performance.now()` |
| 模板渲染（10 个片段） | < 5ms | `performance.now()` |
| 工具列表组装（50 个工具） | < 20ms | `performance.now()` |
| 对话历史裁剪（50 轮） | < 10ms | `performance.now()` |
| 缓存 key 构建 | < 1ms | `performance.now()` |
| 静态前缀占比 | ≥ 70% | 静态 tokens / 总 tokens |
| 缓存 key 碰撞率 | 0% | 不同配置生成相同 key 的概率 |

---

> **更新记录**
> - 2026-07-05：初版创建，对应 V5 提示词工程与上下文管理模块