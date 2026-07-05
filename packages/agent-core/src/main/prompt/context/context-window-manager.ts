/**
 * 上下文窗口管理器
 *
 * 负责控制 tokens 预算、裁剪历史、管理缓存 key。
 * 提供三种裁剪策略：
 * - sliding_window：保留最近 N 轮对话
 * - summary：将旧对话压缩为摘要
 * - priority：按消息角色优先级保留
 */

import type {
  ConversationMessage,
  ContextWindowConfig,
  TrimOptions,
  CacheKeyContext,
  IContextWindowManager,
  ITrimStrategy,
} from '../types';
import { DEFAULT_CONTEXT_WINDOW_CONFIG } from '../types';
import { SlidingWindowTrimStrategy, SummaryTrimStrategy, PriorityTrimStrategy } from './trim-strategies';
import { DefaultCacheKeyBuilder } from './cache-key-builder';

export class DefaultContextWindowManager implements IContextWindowManager {
  private config: ContextWindowConfig;
  private strategies: Map<string, ITrimStrategy> = new Map();
  private cacheKeyBuilder: DefaultCacheKeyBuilder;

  constructor(config?: Partial<ContextWindowConfig>) {
    this.config = { ...DEFAULT_CONTEXT_WINDOW_CONFIG, ...config };
    this.cacheKeyBuilder = new DefaultCacheKeyBuilder();
    this.registerDefaultStrategies();
  }

  trim(
    history: ConversationMessage[],
    options?: TrimOptions,
  ): ConversationMessage[] {
    if (history.length === 0) return [];

    const maxTokens = options?.maxTokens ?? this.config.historyMaxTokens;
    const forceKeep = options?.forceKeepRounds ?? this.config.keepRecentRounds;

    // 估算当前 tokens
    const estimatedTokens = this.estimateTokens(history);

    // 如果在限制内，直接返回
    if (estimatedTokens <= maxTokens) return history;

    // 需要裁剪
    const strategy = this.strategies.get(this.config.trimStrategy);
    if (!strategy) {
      return history.slice(-forceKeep * 2);
    }

    return strategy.trim(history, maxTokens, forceKeep, this.config);
  }

  estimateTokens(messages: ConversationMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      if (msg.content) {
        total += Math.ceil(msg.content.length / 4);
      }
      if (msg.tool_calls) {
        total += msg.tool_calls.length * 20;
      }
    }
    return total;
  }

  buildCacheKey(context: CacheKeyContext): string {
    return this.cacheKeyBuilder.build(context).full;
  }

  getConfig(): ContextWindowConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<ContextWindowConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** 注册自定义裁剪策略 */
  registerStrategy(strategy: ITrimStrategy): void {
    this.strategies.set(strategy.name, strategy);
  }

  private registerDefaultStrategies(): void {
    this.strategies.set('sliding_window', new SlidingWindowTrimStrategy());
    this.strategies.set('summary', new SummaryTrimStrategy());
    this.strategies.set('priority', new PriorityTrimStrategy());
  }
}