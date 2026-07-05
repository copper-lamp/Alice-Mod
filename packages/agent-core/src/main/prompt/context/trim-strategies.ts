/**
 * 裁剪策略实现
 *
 * 三种策略：
 * 1. sliding_window — 保留最近 N 轮对话
 * 2. summary — 将旧对话压缩为摘要
 * 3. priority — 按消息类型优先级保留
 */

import type { ConversationMessage, ContextWindowConfig, ITrimStrategy } from '../types';

/**
 * 滑动窗口裁剪策略
 * 保留最近的 N 轮对话，丢弃最旧的
 */
export class SlidingWindowTrimStrategy implements ITrimStrategy {
  readonly name = 'sliding_window';

  trim(
    history: ConversationMessage[],
    maxTokens: number,
    forceKeep: number,
    config: ContextWindowConfig,
  ): ConversationMessage[] {
    const rounds = this.groupIntoRounds(history);
    let keptRounds = rounds.slice(-forceKeep);

    // 如果仍然超限，进一步压缩工具结果
    let estimated = this.estimateTokens(keptRounds.flat());
    if (estimated > maxTokens) {
      keptRounds = this.compressToolResults(keptRounds, maxTokens, config);
    }

    return keptRounds.flat();
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

  private compressToolResults(
    rounds: ConversationMessage[][],
    maxTokens: number,
    config: ContextWindowConfig,
  ): ConversationMessage[][] {
    return rounds.map(round => {
      return round.map(msg => {
        if (msg.role === 'tool' && msg.content.length > config.toolResultCompressThreshold) {
          return {
            ...msg,
            content: `[工具结果已压缩，长度: ${msg.content.length} 字符]`,
          };
        }
        return msg;
      });
    });
  }

  private estimateTokens(messages: ConversationMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      total += Math.ceil(msg.content.length / 4);
      if (msg.tool_calls) {
        total += msg.tool_calls.length * 20;
      }
    }
    return total;
  }
}

/**
 * 摘要压缩裁剪策略
 * 将较旧的对话压缩为摘要，保留最近对话
 */
export class SummaryTrimStrategy implements ITrimStrategy {
  readonly name = 'summary';

  trim(
    history: ConversationMessage[],
    maxTokens: number,
    forceKeep: number,
    _config: ContextWindowConfig,
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
      // 如果摘要后仍然超限，回退到滑动窗口
      const fallback = new SlidingWindowTrimStrategy();
      return fallback.trim(recentRounds.flat(), maxTokens, forceKeep, _config);
    }

    return result;
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

  private summarizeRounds(rounds: ConversationMessage[][]): string {
    const userActions: string[] = [];
    const toolResults: string[] = [];

    for (const round of rounds) {
      for (const msg of round) {
        if (msg.role === 'user') {
          const firstLine = msg.content.split('\n').pop() || msg.content.slice(0, 50);
          userActions.push(firstLine);
        }
        if (msg.role === 'tool') {
          const success = !msg.content.includes('失败');
          toolResults.push(success ? '成功' : '失败');
        }
      }
    }

    return `共 ${rounds.length} 轮对话，用户执行了 ${userActions.length} 次操作，其中 ${toolResults.filter(r => r === '成功').length} 次成功。`;
  }

  private estimateTokens(messages: ConversationMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      total += Math.ceil(msg.content.length / 4);
      if (msg.tool_calls) {
        total += msg.tool_calls.length * 20;
      }
    }
    return total;
  }
}

/**
 * 优先级裁剪策略
 * 保留关键消息（工具结果 > 工具调用 > 用户消息 > 普通 assistant）
 */
export class PriorityTrimStrategy implements ITrimStrategy {
  readonly name = 'priority';

  trim(
    history: ConversationMessage[],
    _maxTokens: number,
    forceKeep: number,
    _config: ContextWindowConfig,
  ): ConversationMessage[] {
    // 按角色分组
    const toolMessages = history.filter(m => m.role === 'tool');
    const toolCallMessages = history.filter(m => m.role === 'assistant' && m.tool_calls);
    const userMessages = history.filter(m => m.role === 'user');
    const assistantMessages = history.filter(m => m.role === 'assistant' && !m.tool_calls);

    // 工具结果优先级最高，保留最近的 N 条
    const keptToolResults = toolMessages.slice(-forceKeep);
    const keptToolCalls = toolCallMessages.slice(-Math.ceil(forceKeep / 2));
    const keptUser = userMessages.slice(-Math.ceil(forceKeep / 2));
    const keptAssistant = assistantMessages.slice(-Math.max(1, Math.floor(forceKeep / 4)));

    // 按原始顺序合并
    const kept = new Set([
      ...keptToolResults,
      ...keptToolCalls,
      ...keptUser,
      ...keptAssistant,
    ]);

    return history.filter(msg => kept.has(msg));
  }
}