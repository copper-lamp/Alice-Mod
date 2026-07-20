/**
 * V5 提示词工程 — 类型定义
 *
 * 所有接口定义，V5 提供默认实现，后续版本可通过扩展接口/注册新实现来增强功能。
 */

import type { ToolSchema } from '@mcagent/shared';

// ════════════════════════════════════════════════════
// 基础类型
// ════════════════════════════════════════════════════

/** 消息角色 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** 对话消息 */
export interface ConversationMessage {
  role: MessageRole;
  content: string;
  tool_calls?: ToolCallPart[];
  tool_call_id?: string;
}

/** 工具调用（消息中的部分） */
export interface ToolCallPart {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** 触发来源 */
export type BuildSource = 'user' | 'event' | 'system' | 'tool_result';

/** 工具描述详细程度 */
export enum ToolVerbosity {
  Minimal = 'minimal',
  Standard = 'standard',
  Detailed = 'detailed',
}

// ════════════════════════════════════════════════════
// 1. 智能体定义系统
// ════════════════════════════════════════════════════

/** 智能体定义 */
export interface AgentProfile {
  /** 智能体名称 */
  name: string;
  /** 智能体身份描述 */
  identity: string;
  /** 专业领域标签（V19 新增，由 wizard 的 expertise 多选标签生成） */
  expertise?: string[];
  /** 个性特征 */
  personality: string[];
  /** 行为规则 */
  rules: BehaviorRules;
  /** 偏好设置 */
  preferences: AgentPreferences;
  /** 自定义提示词片段 */
  fragments: PromptFragment[];
  /** 沟通风格（参考 CURSOR 沟通规范） */
  communicationStyle?: string[];
  /** 工作方式（参考 ANTHROPIC 工作流） */
  workApproach?: string[];
  /** 工作流模板描述（V19 新增，由 workflowId 生成） */
  workflowDescription?: string;
  /** 行为边界（参考 DEVIN 安全红线） */
  boundaries?: string[];
  /** 信息保密规则（参考 DEVIN 数据安全 + ANTHROPIC 不透露机制） */
  securityRules?: SecurityRules;
  /** 工具使用规范（参考 CURSOR 工具调用规范） */
  toolDiscipline?: ToolDiscipline;
}

/** 行为规则 */
export interface BehaviorRules {
  /** 核心规则（始终生效） */
  core: string[];
  /** 策略规则（影响决策方式） */
  strategy: StrategyRule[];
  /** 约束规则（限制行为边界） */
  constraints: ConstraintRule[];
}

/** 策略规则 */
export interface StrategyRule {
  name: string;
  description: string;
  priority: number;
  condition?: string;
}

/** 约束规则 */
export interface ConstraintRule {
  name: string;
  description: string;
  /** 违背后果 */
  consequence: 'warning' | 'block' | 'replan';
}

/** 智能体偏好 */
export interface AgentPreferences {
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
export interface PromptFragment {
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

// ════════════════════════════════════════════════════
// 2. 提示词编排器
// ════════════════════════════════════════════════════

/** 提示词编排器接口 */
export interface IPromptBuilder {
  /** 构建完整的消息列表 */
  build(params: BuildParams): Promise<PromptBuildResult>;
  /** 注册自定义提示词片段 */
  registerFragment(fragment: PromptFragment): void;
  /** 获取当前智能体定义 */
  getProfile(): AgentProfile;
  /** 更新智能体定义 */
  updateProfile(profile: Partial<AgentProfile>): void;
  /** 获取缓存统计 */
  getCacheStats(): CacheStats;
}

/** 构建参数 */
export interface BuildParams {
  /** 工作区 ID */
  workspaceId: string;
  /** 用户输入 */
  userInput: string;
  /** 对话历史 */
  history: ConversationMessage[];
  /** 当前玩家状态 */
  state: PlayerState;
  /** 触发来源 */
  source: BuildSource;
  /** 系统提示词覆盖（可选） */
  systemOverride?: string;
  /** 注入的自定义上下文（可选，供中间件使用） */
  extraContext?: Record<string, unknown>;
  /**
   * V23：跨 Agent 上下文（peer_context）
   * 主 Agent 注入 QQ 端最近对话，QQ Agent 注入游戏端最近对话
   */
  peerContext?: {
    /** 对端 source */
    peerSource: 'game' | 'qq';
    /** 对端最近对话历史（来自 ChatHistoryStore.loadWithPeer） */
    peerHistory: Array<{
      role: string;
      content: string;
      createdAt: number;
    }>;
    /** 共享玩家事实（来自 MemoryManager.loadPlayerFacts） */
    sharedFacts?: Array<{
      key: string;
      value: string;
    }>;
    /** 待消费汇报（仅 QQ Agent，来自 AgentReportBus.consumePending） */
    pendingReports?: Array<{
      reportType: string;
      summary: string;
      timestamp: number;
    }>;
  };
}

/** 玩家状态 */
export interface PlayerState {
  /** V30: 跳过状态注入（QQ 来源时不注入游戏状态） */
  skip?: boolean;
  health: number;
  hunger: number;
  saturation: number;
  position: {
    x: number;
    y: number;
    z: number;
    dimension: string;
    biome?: string;
  };
  equipment?: {
    mainhand?: string;
    offhand?: string;
    helmet?: string;
    chestplate?: string;
    leggings?: string;
    boots?: string;
  };
  inventory?: {
    usedSlots: number;
    totalSlots: number;
    items: string[];
  };
  statusEffects: string[];
  specialStatus?: string;
}

/** 提示词构建结果 */
export interface PromptBuildResult {
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

/** 缓存信息 */
export interface CacheInfo {
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
    system: string;
    tools: string;
    dynamic: string;
  };
}

/** Token 统计 */
export interface TokenBreakdown {
  systemPrompt: number;
  stateInjection: number;
  toolDefinitions: number;
  conversationHistory: number;
  userInput: number;
  fragments: number;
  total: number;
}

/** 缓存统计 */
export interface CacheStats {
  totalBuilds: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  avgStaticTokens: number;
  avgDynamicTokens: number;
}

// ════════════════════════════════════════════════════
// 3. 工具提示组装器
// ════════════════════════════════════════════════════

/** 工具提示组装器接口 */
export interface IToolPromptAssembler {
  /** 组装工具列表 */
  assemble(
    workspaceId: string,
    options?: AssembleOptions,
  ): Promise<ToolPromptDefinition[]>;

  /** 按类别过滤工具 */
  filterByCategory(
    tools: ToolPromptDefinition[],
    categories: string[],
  ): ToolPromptDefinition[];

  /** 按条件过滤工具 */
  filterByCondition(
    tools: ToolPromptDefinition[],
    condition: (tool: ToolPromptDefinition) => boolean,
  ): ToolPromptDefinition[];

  /** 注册自定义提示格式器 */
  registerFormatter(
    toolName: string,
    formatter: ToolPromptFormatter,
  ): void;

  /** 注册 Provider 格式适配器 */
  registerProviderAdapter(
    providerId: string,
    adapter: ToolFormatAdapter,
  ): void;
}

/** 组装选项 */
export interface AssembleOptions {
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
export interface ToolPromptDefinition {
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

/** 工具参数提示 */
export interface ToolParamPrompt {
  type: string;
  description: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
  /** 示例值 */
  example?: unknown;
}

/** 工具使用示例 */
export interface ToolExample {
  description: string;
  arguments: Record<string, unknown>;
  expectedResult?: string;
}

/** 工具提示格式器 */
export interface ToolPromptFormatter {
  format(tool: ToolPromptDefinition): ToolPromptDefinition;
}

/** Provider 格式适配器 */
export interface ToolFormatAdapter {
  convert(tools: ToolPromptDefinition[]): unknown[];
}

// ════════════════════════════════════════════════════
// 4. 上下文窗口管理器
// ════════════════════════════════════════════════════

/** 上下文窗口管理器接口 */
export interface IContextWindowManager {
  /** 裁剪对话历史，确保不超过 tokens 上限 */
  trim(
    history: ConversationMessage[],
    options?: TrimOptions,
  ): ConversationMessage[];

  /** 估算消息列表的 tokens 数 */
  estimateTokens(messages: ConversationMessage[]): number;

  /** 构建缓存 key */
  buildCacheKey(context: CacheKeyContext): string;

  /** 获取窗口配置 */
  getConfig(): ContextWindowConfig;

  /** 更新窗口配置 */
  updateConfig(config: Partial<ContextWindowConfig>): void;
}

/** 上下文窗口配置 */
export interface ContextWindowConfig {
  /** 最大 tokens */
  maxTokens: number;
  /** 预留的系统提示词 tokens */
  systemReserveTokens: number;
  /** 预留的状态注入 tokens */
  stateReserveTokens: number;
  /** 预留的工具定义 tokens */
  toolsReserveTokens: number;
  /** 预留的自定义片段 tokens */
  fragmentsReserveTokens: number;
  /** 对话历史最大 tokens */
  historyMaxTokens: number;
  /** 保留的最新对话轮数 */
  keepRecentRounds: number;
  /** 工具结果压缩阈值（超出的结果压缩为摘要） */
  toolResultCompressThreshold: number;
  /** 裁剪策略 */
  trimStrategy: 'sliding_window' | 'summary' | 'priority';
}

/** 裁剪选项 */
export interface TrimOptions {
  /** 覆盖 maxTokens */
  maxTokens?: number;
  /** 强制保留的轮数 */
  forceKeepRounds?: number;
  /** 是否启用摘要压缩 */
  enableSummary?: boolean;
}

/** 缓存 key 上下文 */
export interface CacheKeyContext {
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

/** 缓存 key 各部分 */
export interface CacheKeyParts {
  /** 静态前缀 key（系统提示词） */
  staticPrefix: string;
  /** 工具定义 key */
  toolDefinitions: string;
  /** 完整缓存 key */
  full: string;
}

// ════════════════════════════════════════════════════
// 5. 模板引擎
// ════════════════════════════════════════════════════

/** 模板引擎接口 */
export interface IPromptTemplateEngine {
  /** 渲染模板 */
  render(template: string, variables: Record<string, unknown>): string;
  /** 注册自定义模板函数 */
  registerFunction(name: string, fn: TemplateFunction): void;
}

/** 模板函数 */
export type TemplateFunction = (...args: string[]) => string;

// ════════════════════════════════════════════════════
// 6. 系统提示词构建器
// ════════════════════════════════════════════════════

/** 系统提示词构建器接口 */
export interface ISystemPromptBuilder {
  /** 构建系统提示词 */
  build(profile: AgentProfile, override?: string): string;
}

// ════════════════════════════════════════════════════
// 7. 状态注入器
// ════════════════════════════════════════════════════

/** 状态注入器接口 */
export interface IStateInjector {
  /** 格式化状态注入 */
  format(state: PlayerState): string;
}

// ════════════════════════════════════════════════════
// 8. 缓存 key 构建器
// ════════════════════════════════════════════════════

/** 缓存 key 构建器接口 */
export interface ICacheKeyBuilder {
  /** 构建分层的缓存 key */
  build(context: CacheKeyContext): CacheKeyParts;
  /** 从 AgentProfile 生成 hash */
  hashAgentProfile(profile: AgentProfile): string;
  /** 从工具列表生成 hash */
  hashToolDefinitions(tools: ToolPromptDefinition[]): string;
}

// ════════════════════════════════════════════════════
// 9. 裁剪策略
// ════════════════════════════════════════════════════

/** 裁剪策略接口 */
export interface ITrimStrategy {
  name: string;
  trim(
    history: ConversationMessage[],
    maxTokens: number,
    forceKeep: number,
    config: ContextWindowConfig,
  ): ConversationMessage[];
}

// ════════════════════════════════════════════════════
// 10. PromptBuilder 配置
// ════════════════════════════════════════════════════

/** PromptBuilder 配置 */
export interface PromptBuilderConfig {
  /** 智能体定义（默认使用 DEFAULT_AGENT_PROFILE） */
  profile?: AgentProfile;
  /** 工具提示组装器 */
  assembler?: IToolPromptAssembler;
  /** 上下文窗口管理器 */
  contextManager?: IContextWindowManager;
  /** 模板引擎 */
  templateEngine?: IPromptTemplateEngine;
  /** 系统提示词构建器 */
  systemPromptBuilder?: ISystemPromptBuilder;
  /** 状态注入器 */
  stateInjector?: IStateInjector;
  /** 缓存 key 构建器 */
  cacheKeyBuilder?: ICacheKeyBuilder;
  /** 工具注册表 */
  toolRegistry?: { getTools(workspaceId: string): ToolSchema[] };
}

/** 默认智能体定义 */
export const DEFAULT_AGENT_PROFILE: AgentProfile = {
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

// ════════════════════════════════════════════════════
// 11. 身份模板系统
// ════════════════════════════════════════════════════

/** 内置身份模板标识 */
export type IdentityTemplateId = 'default' | 'logistics' | 'survival_companion' | 'killer' | 'builder' | 'explorer' | 'farmer';

/** 信息保密规则 */
export interface SecurityRules {
  /** 禁止透露的内容 */
  neverDisclose: string[];
  /** 敏感操作确认列表 */
  sensitiveOperations: string[];
  /** 数据安全要求 */
  dataSecurity: string[];
}

/** 工具使用规范 */
export interface ToolDiscipline {
  /** 工具调用前检查 */
  preCheck: string[];
  /** 错误处理策略 */
  errorHandling: string[];
  /** 工具伦理规范 */
  ethics: string[];
}

/** 身份模板定义 */
export interface IdentityTemplate {
  /** 模板标识 */
  id: IdentityTemplateId;
  /** 模板名称 */
  name: string;
  /** 模板描述 */
  description: string;
  /** 身份描述 */
  identity: string;
  /** 默认个性特征 */
  personality: string[];
  /** 默认行为规则 */
  rules: BehaviorRules;
  /** 默认偏好设置 */
  preferences: AgentPreferences;
  /** 推荐工具分类 */
  recommendedToolCategories: string[];
  /** 沟通风格（参考 CURSOR 沟通规范） */
  communicationStyle?: string[];
  /** 工作方式（参考 ANTHROPIC 工作流） */
  workApproach?: string[];
  /** 行为边界（参考 DEVIN 安全红线） */
  boundaries?: string[];
  /** 信息保密规则（参考 DEVIN 数据安全 + ANTHROPIC 不透露机制） */
  securityRules?: SecurityRules;
  /** 工具使用规范（参考 CURSOR 工具调用规范） */
  toolDiscipline?: ToolDiscipline;
  /** 推荐工作流模板 */
  recommendedWorkflow?: WorkflowTemplateId;
}

// ════════════════════════════════════════════════════
// 12. 性格库系统
// ════════════════════════════════════════════════════

/** 性格类别 */
export type PersonalityCategory = 'social' | 'decision' | 'work' | 'communication' | 'risk' | 'emotion';

/** 性格特征定义 */
export interface PersonalityTrait {
  /** 特征标识 */
  id: string;
  /** 特征描述 */
  description: string;
  /** 所属类别 */
  category: PersonalityCategory;
  /** 标签（用于筛选） */
  tags: string[];
  /** 冲突特征（不能同时选） */
  conflictsWith?: string[];
}

// ════════════════════════════════════════════════════
// 13. 工作流模板
// ════════════════════════════════════════════════════

/** 工作流模板标识 */
export type WorkflowTemplateId = 'explore_gather' | 'combat_loot' | 'build_construct' | 'guard_patrol' | 'farm_harvest' | 'mine_quarry' | 'trade_barter';

/** 工作流步骤 */
export interface WorkflowStep {
  /** 步骤名称 */
  name: string;
  /** 步骤描述 */
  description: string;
  /** 该步骤推荐使用的工具分类 */
  toolCategories: string[];
  /** 步骤持续时间（秒） */
  duration?: number;
  /** 退出条件 */
  exitCondition?: string;
}

/** 工作流模板 */
export interface WorkflowTemplate {
  /** 模板标识 */
  id: WorkflowTemplateId;
  /** 模板名称 */
  name: string;
  /** 模板描述 */
  description: string;
  /** 适用场景 */
  applicableScenarios: string[];
  /** 工作流步骤 */
  steps: WorkflowStep[];
  /** 默认行为规则覆盖 */
  rulesOverride?: Partial<BehaviorRules>;
}

// ════════════════════════════════════════════════════
// 14. 模板注册器
// ════════════════════════════════════════════════════

/** 用户自定义模板 */
export interface UserTemplate {
  /** 模板标识 */
  id: string;
  /** 模板名称 */
  name: string;
  /** 模板描述 */
  description: string;
  /** 模板类型 */
  type: 'identity' | 'behavior' | 'workflow' | 'full_agent';
  /** 模板数据 */
  data: Record<string, unknown>;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 标签 */
  tags: string[];
}

/** 模板注册器接口 */
export interface ITemplateRegistry {
  /** 保存自定义模板 */
  save(template: UserTemplate): Promise<void>;
  /** 加载模板 */
  load(id: string): Promise<UserTemplate | undefined>;
  /** 删除模板 */
  delete(id: string): Promise<void>;
  /** 列出所有模板 */
  list(type?: UserTemplate['type']): Promise<UserTemplate[]>;
  /** 获取内置身份模板 */
  getIdentityTemplate(id: IdentityTemplateId): IdentityTemplate;
  /** 获取所有内置身份模板 */
  listIdentityTemplates(): IdentityTemplate[];
  /** 获取工作流模板 */
  getWorkflowTemplate(id: WorkflowTemplateId): WorkflowTemplate;
  /** 获取所有工作流模板 */
  listWorkflowTemplates(): WorkflowTemplate[];
  /** 从身份模板创建 AgentProfile */
  createProfileFromIdentity(id: IdentityTemplateId, overrides?: Partial<AgentProfile>): AgentProfile;
  /** 从自定义模板创建 AgentProfile */
  createProfileFromCustom(templateId: string): Promise<AgentProfile | undefined>;
}

// ════════════════════════════════════════════════════
// 15. 工具提示词写作规范
// ════════════════════════════════════════════════════

/** 工具命名规范 */
export enum ToolNamingConvention {
  /** 动作前缀 + 目标（如 move_to, break_block） */
  ActionTarget = 'action_target',
  /** 动词开头（如 get, set, find） */
  VerbFirst = 'verb_first',
  /** 领域 + 操作（如 inventory.sort, chat.send） */
  DomainAction = 'domain_action',
}

/** 工具描述质量等级 */
export enum ToolDescriptionQuality {
  /** 优秀：完整描述+参数+示例 */
  Excellent = 'excellent',
  /** 良好：描述+必填参数 */
  Good = 'good',
  /** 合格：仅描述 */
  Acceptable = 'acceptable',
  /** 不合格：缺失关键信息 */
  Poor = 'poor',
}

/** 工具描述质量检查结果 */
export interface ToolDescriptionQualityCheck {
  /** 工具名称 */
  name: string;
  /** 质量等级 */
  quality: ToolDescriptionQuality;
  /** 问题列表 */
  issues: string[];
  /** 建议 */
  suggestions: string[];
}

/** 工具提示词写作规范 */
export interface ToolPromptWritingSpec {
  /** 命名规范 */
  namingConvention: ToolNamingConvention;
  /** 描述写作规则 */
  descriptionRules: {
    /** 必须包含的要素 */
    requiredElements: string[];
    /** 建议包含的要素 */
    recommendedElements: string[];
    /** 禁止的内容 */
    forbiddenContent: string[];
    /** 最大长度 */
    maxLength: number;
  };
  /** 参数写作规则 */
  parameterRules: {
    /** 参数描述要求 */
    descriptionRequired: boolean;
    /** 必须标注是否为必填 */
    requiredMarking: boolean;
    /** 建议提供默认值 */
    suggestDefault: boolean;
    /** 建议提供枚举值 */
    suggestEnum: boolean;
    /** 建议提供示例值 */
    suggestExample: boolean;
  };
  /** 示例写作规则 */
  exampleRules: {
    /** 示例数量要求 */
    minExamples: number;
    /** 示例必须包含的字段 */
    requiredFields: string[];
  };
}

/** 默认上下文窗口配置 */
export const DEFAULT_CONTEXT_WINDOW_CONFIG: ContextWindowConfig = {
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