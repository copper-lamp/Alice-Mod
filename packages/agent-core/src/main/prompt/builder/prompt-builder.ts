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

    // 2. 组装工具列表（半静态部分 — Region 2）
    const tools = await this.assembler.assemble(params.workspaceId, {
      groupByCategory: true,
      verbosity: this.profile.preferences.verbosity >= 2 ? 'detailed' : 'standard',
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

  private updateHitRate(): void {
    if (this.stats.totalBuilds === 0) {
      this.stats.hitRate = 0;
      return;
    }
    this.stats.hitRate = this.stats.cacheHits / this.stats.totalBuilds;
  }
}