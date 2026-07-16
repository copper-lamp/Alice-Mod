/**
 * PromptBuilder — 提示词编排器主类
 *
 * 负责将智能体定义、游戏状态、工具列表等组装为 LLM 消息。
 * 实现三区域缓存结构：静态前缀 → 半静态工具列表 → 动态内容。
 */

import type {
  AgentProfile,
  BuildParams,
  PromptBuildResult,
  ConversationMessage,
  TokenBreakdown,
  PromptFragment,
  CacheStats,
  PromptBuilderConfig,
  IPromptBuilder,
  IToolPromptAssembler,
  IContextWindowManager,
  IPromptTemplateEngine,
  ISystemPromptBuilder,
  IStateInjector,
  ICacheKeyBuilder,
  StrategyRule,
  ConstraintRule,
} from '../types';
import { DEFAULT_AGENT_PROFILE } from '../types';
import { DefaultToolPromptAssembler } from '../tools/tool-prompt-assembler';
import { DefaultContextWindowManager } from '../context/context-window-manager';
import { DefaultPromptTemplateEngine } from './template-engine';
import { DefaultSystemPromptBuilder } from './system-prompt-builder';
import { DefaultStateInjector } from './state-injector';
import { DefaultCacheKeyBuilder } from '../context/cache-key-builder';
import type { ToolSchema } from '@mcagent/shared';

export class PromptBuilder implements IPromptBuilder {
  private profile: AgentProfile;
  private assembler: IToolPromptAssembler;
  private contextManager: IContextWindowManager;
  private templateEngine: IPromptTemplateEngine;
  private systemPromptBuilder: ISystemPromptBuilder;
  private stateInjector: IStateInjector;
  private cacheKeyBuilder: ICacheKeyBuilder;
  private customFragments: PromptFragment[] = [];

  // 缓存统计
  private stats: CacheStats = {
    totalBuilds: 0,
    cacheHits: 0,
    cacheMisses: 0,
    hitRate: 0,
    avgStaticTokens: 0,
    avgDynamicTokens: 0,
  };

  // 上次构建的缓存 key，用于判断缓存命中
  private lastCacheKey: string | null = null;
  private toolRegistry: { getTools(workspaceId: string): ToolSchema[] };

  constructor(config?: PromptBuilderConfig) {
    this.profile = config?.profile ?? DEFAULT_AGENT_PROFILE;
    this.toolRegistry = config?.toolRegistry ?? { getTools: () => [] };
    this.assembler = config?.assembler ?? new DefaultToolPromptAssembler(this.toolRegistry);
    this.contextManager = config?.contextManager ?? new DefaultContextWindowManager();
    this.templateEngine = config?.templateEngine ?? new DefaultPromptTemplateEngine();
    this.systemPromptBuilder = config?.systemPromptBuilder ?? new DefaultSystemPromptBuilder(this.templateEngine);
    this.stateInjector = config?.stateInjector ?? new DefaultStateInjector();
    this.cacheKeyBuilder = config?.cacheKeyBuilder ?? new DefaultCacheKeyBuilder();
  }

  async build(params: BuildParams): Promise<PromptBuildResult> {
    this.stats.totalBuilds++;

    // 1. 合并自定义片段到 profile 中
    const mergedProfile: AgentProfile = {
      ...this.profile,
      fragments: [...this.profile.fragments, ...this.customFragments],
    };

    // 1b. 从 extraContext 注入用户配置（V19 新增）
    this.injectExtraContext(mergedProfile, params);

    // 2. 构建系统提示词（静态部分 — Region 1）
    let systemPrompt: string;
    let systemHash: string;
    if (params.systemOverride) {
      systemPrompt = params.systemOverride;
      // 追加 system_end 位置的自定义片段
      const endFragments = this.customFragments.filter(
        f => f.enabled && f.position === 'system_end',
      );
      for (const fragment of endFragments) {
        const rendered = this.templateEngine.render(fragment.template, {
          agent: this.profile,
        });
        if (rendered) {
          systemPrompt += '\n\n' + rendered;
        }
      }
      systemHash = this.hashString(systemPrompt);
    } else {
      systemPrompt = this.systemPromptBuilder.build(mergedProfile);
      systemHash = this.cacheKeyBuilder.hashAgentProfile(mergedProfile);
    }

    // 1b. V23：注入 peer_context（跨 Agent 上下文）
    // 放在 system prompt 末尾，作为附加的上下文信息
    const peerContextStr = this.formatPeerContext(params.peerContext);
    if (peerContextStr) {
      systemPrompt += '\n\n' + peerContextStr;
      systemHash = this.hashString(systemPrompt); // 刷新 hash（peerContext 变化时 cache 失效）
    }

    // 1c. V22：注入区域 7（任务进展）和区域 8（当前技能）
    const progressText = params.extraContext?.progress as string | undefined;
    const skillsText = params.extraContext?.skills as string | undefined;
    if (progressText) {
      systemPrompt += '\n\n## 任务进展\n' + progressText;
      systemHash = this.hashString(systemPrompt);
    }
    if (skillsText) {
      systemPrompt += '\n\n## 当前技能\n' + skillsText;
      systemHash = this.hashString(systemPrompt);
    }

    // 2. 组装工具列表（半静态部分 — Region 2）
    // 从 extraContext 获取 agent 指定的禁用工具列表
    const excludeTools = params.extraContext?.excludeTools as string[] | undefined;
    const tools = await this.assembler.assemble(params.workspaceId, {
      groupByCategory: true,
      verbosity: this.profile.preferences.verbosity >= 2 ? 'detailed' : 'standard',
      excludeTools,
    });
    const toolsHash = this.cacheKeyBuilder.hashToolDefinitions(tools);

    // 3. 格式化状态注入（动态部分 — Region 3）
    const stateInjection = this.stateInjector.format(params.state);
    const stateHash = this.hashString(stateInjection + params.userInput);

    // 4. 构建缓存 key
    const cacheKey = this.contextManager.buildCacheKey({
      agentHash: systemHash,
      toolsHash,
      workspaceId: params.workspaceId,
      providerId: params.extraContext?.providerId as string || 'openai',
    });

    // 5. 判断缓存命中
    const cacheHit = this.lastCacheKey === cacheKey;
    if (cacheHit) {
      this.stats.cacheHits++;
    } else {
      this.stats.cacheMisses++;
    }
    this.lastCacheKey = cacheKey;
    this.updateHitRate();

    // 6. 处理 before_tools / after_tools 片段（添加到工具说明区域）
    const beforeToolsFragments = this.getAllFragments().filter(
      f => f.enabled && f.position === 'before_tools',
    );
    const afterToolsFragments = this.getAllFragments().filter(
      f => f.enabled && f.position === 'after_tools',
    );

    // 7. 裁剪对话历史
    const trimmedHistory = this.contextManager.trim(params.history);

    // 8. 组装最终消息列表
    const messages = this.assembleMessages(
      systemPrompt,
      stateInjection,
      trimmedHistory,
      params.userInput,
      beforeToolsFragments,
      afterToolsFragments,
      tools,
    );

    // 9. 计算 token 统计
    const tokenBreakdown = this.calculateTokenBreakdown(
      systemPrompt,
      stateInjection,
      tools,
      params.history,
      params.userInput,
    );

    return {
      messages,
      tools,
      cache: {
        key: cacheKey,
        staticTokens: tokenBreakdown.systemPrompt + tokenBreakdown.toolDefinitions + tokenBreakdown.fragments,
        dynamicTokens: tokenBreakdown.stateInjection + tokenBreakdown.conversationHistory + tokenBreakdown.userInput,
        totalTokens: tokenBreakdown.total,
        regions: {
          system: systemHash,
          tools: toolsHash,
          dynamic: stateHash,
        },
      },
      tokenBreakdown,
      cacheHit,
    };
  }

  registerFragment(fragment: PromptFragment): void {
    const existing = this.customFragments.findIndex(f => f.name === fragment.name);
    if (existing >= 0) {
      this.customFragments[existing] = { ...fragment };
    } else {
      this.customFragments.push({ ...fragment });
    }
  }

  getProfile(): AgentProfile {
    return JSON.parse(JSON.stringify(this.profile));
  }

  updateProfile(partial: Partial<AgentProfile>): void {
    if (partial.name !== undefined) this.profile.name = partial.name;
    if (partial.identity !== undefined) this.profile.identity = partial.identity;
    if (partial.personality !== undefined) this.profile.personality = [...partial.personality];
    if (partial.rules !== undefined) this.profile.rules = JSON.parse(JSON.stringify(partial.rules));
    if (partial.preferences !== undefined) {
      this.profile.preferences = { ...this.profile.preferences, ...partial.preferences };
    }
    if (partial.fragments !== undefined) {
      this.profile.fragments = partial.fragments.map(f => ({ ...f }));
    }
    // 缓存 key 变化，更新 lastCacheKey 以触发缓存 miss
    this.lastCacheKey = null;
  }

  getCacheStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * 从 extraContext 注入用户配置到 mergedProfile（V19 新增）
   * 支持：expertise、workflowDescription、behaviorRules、communicationStyle、boundaries
   */
  private injectExtraContext(profile: AgentProfile, params: BuildParams): void {
    if (!params.extraContext) return;

    // 注入 expertise → 追加到 identity + 设置 profile.expertise
    const expertise = params.extraContext.expertise as string[] | undefined;
    if (expertise && expertise.length > 0) {
      profile.expertise = expertise;
      // 只在 identity 末尾追加，不覆盖已有内容
      if (!profile.identity.endsWith(`擅长：${expertise.join('、')}。`)) {
        profile.identity += `\n擅长：${expertise.join('、')}。`;
      }
    }

    // 注入 workflowDescription → 优先覆盖 workApproach
    const workflowDesc = params.extraContext.workflowDescription as string | undefined;
    if (workflowDesc) {
      profile.workflowDescription = workflowDesc;
    }

    // 注入 behaviorRules → 覆盖 rules
    const behaviorRules = params.extraContext.behaviorRules as {
      core: string[];
      strategy: StrategyRule[];
      constraints: ConstraintRule[];
    } | undefined;
    if (behaviorRules) {
      profile.rules = {
        core: behaviorRules.core ?? [],
        strategy: (behaviorRules.strategy ?? []).map(s => ({ ...s })),
        constraints: (behaviorRules.constraints ?? []).map(c => ({ ...c })),
      };
    }

    // 注入 communicationStyle
    const commStyle = params.extraContext.communicationStyle as string[] | undefined;
    if (commStyle && commStyle.length > 0) {
      profile.communicationStyle = [...commStyle];
    }

    // 注入 boundaries
    const boundaries = params.extraContext.boundaries as string[] | undefined;
    if (boundaries && boundaries.length > 0) {
      profile.boundaries = [...boundaries];
    }
  }

  /** 获取所有片段（profile + custom） */
  private getAllFragments(): PromptFragment[] {
    return [...this.profile.fragments, ...this.customFragments];
  }

  private assembleMessages(
    systemPrompt: string,
    stateInjection: string,
    history: ConversationMessage[],
    userInput: string,
    beforeToolsFragments: PromptFragment[],
    afterToolsFragments: PromptFragment[],
    tools: unknown[],
  ): ConversationMessage[] {
    const messages: ConversationMessage[] = [];

    // 系统提示词（role: system）
    messages.push({ role: 'system', content: systemPrompt });

    // 对话历史（role: user / assistant / tool）
    messages.push(...history);

    // 当前用户输入（role: user，前缀状态注入）
    let userMessage = stateInjection;

    // before_tools 片段
    for (const fragment of beforeToolsFragments) {
      const rendered = this.templateEngine.render(fragment.template, {
        agent: this.profile,
        tools,
        state: {},
      });
      if (rendered) {
        userMessage += '\n\n' + rendered;
      }
    }

    userMessage += '\n\n' + userInput;

    // after_tools 片段
    for (const fragment of afterToolsFragments) {
      const rendered = this.templateEngine.render(fragment.template, {
        agent: this.profile,
        tools,
        state: {},
      });
      if (rendered) {
        userMessage += '\n\n' + rendered;
      }
    }

    messages.push({ role: 'user', content: userMessage });

    return messages;
  }

  private calculateTokenBreakdown(
    systemPrompt: string,
    stateInjection: string,
    tools: unknown[],
    history: ConversationMessage[],
    userInput: string,
  ): TokenBreakdown {
    const fragments = this.getAllFragments().filter(f => f.enabled);
    const fragmentsTokens = fragments.reduce(
      (sum, f) => sum + Math.ceil(f.template.length / 4),
      0,
    );

    return {
      systemPrompt: Math.ceil(systemPrompt.length / 4),
      stateInjection: Math.ceil(stateInjection.length / 4),
      toolDefinitions: Math.ceil(JSON.stringify(tools).length / 4),
      conversationHistory: this.contextManager.estimateTokens(history),
      userInput: Math.ceil(userInput.length / 4),
      fragments: fragmentsTokens,
      total: 0,
    };
  }

  private hashString(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * V23：格式化 peer_context 为可读的提示词片段
   * 格式：
   *   ## 跨 Agent 上下文
   *   ### 对端（qq）最近对话
   *   [timestamp] role: content
   *   ### 共享玩家事实
   *   - player_name: 小明
   *   ### 待消费汇报
   *   - [task_completed] 任务已完成
   */
  private formatPeerContext(ctx?: BuildParams['peerContext']): string {
    if (!ctx) return '';

    const parts: string[] = ['## 跨 Agent 上下文'];

    if (ctx.peerHistory && ctx.peerHistory.length > 0) {
      const label = ctx.peerSource === 'qq' ? 'QQ' : '游戏';
      parts.push(`\n### 对端（${label}）最近对话\n`);
      for (const entry of ctx.peerHistory.slice(-5)) {
        const ts = new Date(entry.createdAt).toLocaleTimeString('zh-CN', { hour12: false });
        parts.push(`[${ts}] ${entry.role === 'user' ? '玩家' : entry.role === 'assistant' ? 'Alice' : entry.role}: ${entry.content.slice(0, 200)}`);
      }
    }

    if (ctx.sharedFacts && ctx.sharedFacts.length > 0) {
      parts.push(`\n### 共享玩家事实\n`);
      for (const fact of ctx.sharedFacts) {
        parts.push(`- ${fact.key}: ${fact.value}`);
      }
    }

    if (ctx.pendingReports && ctx.pendingReports.length > 0) {
      parts.push(`\n### 待消费汇报\n`);
      for (const report of ctx.pendingReports) {
        const ts = new Date(report.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
        parts.push(`- [${report.reportType}] ${report.summary}（${ts}）`);
      }
    }

    return parts.join('\n');
  }

  private updateHitRate(): void {
    if (this.stats.totalBuilds === 0) {
      this.stats.hitRate = 0;
      return;
    }
    this.stats.hitRate = this.stats.cacheHits / this.stats.totalBuilds;
  }
}