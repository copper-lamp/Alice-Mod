/**
 * ResultInjector 默认实现
 *
 * 将工具执行结果回注到 LLM 对话上下文中。
 * 组装为 `{ role: 'tool', tool_call_id, content }` 格式的消息。
 * 支持为特定工具注册自定义结果格式化器。
 */

import type { IResultInjector, CollectResult, Conversation, ToolResultContent, ResultFormatter } from './types';

/**
 * 默认结果回注器
 *
 * 将执行结果转换为 LLM 可识别的 tool 消息格式：
 * ```
 * { role: 'tool', tool_call_id: 'xxx', content: '{"success":true,"data":{...}}' }
 * ```
 */
export class DefaultResultInjector implements IResultInjector {
  /** 工具级别的格式化器 */
  private formatters: Map<string, ResultFormatter> = new Map();

  /**
   * 注册自定义结果格式化器
   * 可针对特定工具定制回注格式
   */
  registerFormatter(toolName: string, formatter: ResultFormatter): void {
    this.formatters.set(toolName, formatter);
  }

  /**
   * 将收集结果回注到对话
   *
   * @param result - 收集结果
   * @param conversation - 对话上下文
   */
  inject(result: CollectResult, conversation: Conversation): void {
    for (const toolResult of result.results) {
      // 跳过被取消的调用
      if (toolResult.cancelled) continue;

      // 应用自定义格式化器（如果有）
      let formattedResult = toolResult;
      if (toolResult.toolName && this.formatters.has(toolResult.toolName)) {
        const formatter = this.formatters.get(toolResult.toolName)!;
        formattedResult = formatter(toolResult);
      }

      // 构造 tool 消息
      const content = this.formatToolResultContent(formattedResult);

      conversation.addMessage({
        role: 'tool',
        tool_call_id: toolResult.toolCallId,
        content,
      });
    }
  }

  /**
   * 格式化工具结果为字符串
   */
  private formatToolResultContent(result: ToolResultContent): string {
    const payload: Record<string, unknown> = {
      success: result.success,
    };

    if (result.data) {
      payload.data = result.data;
    }

    if (result.error) {
      payload.error = result.error;
    }

    if (result.durationMs >= 0) {
      payload.duration_ms = result.durationMs;
    }

    if (result.skipped) {
      payload.skipped = true;
    }

    if (result.resolvedByFallback) {
      payload.resolved_by_fallback = true;
    }

    return JSON.stringify(payload);
  }
}