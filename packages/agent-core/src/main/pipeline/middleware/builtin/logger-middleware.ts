/**
 * 日志中间件
 *
 * 记录管线各阶段的关键事件，用于调试和监控。
 * 输出格式：{阶段}:{事件} {详情}
 */

import type { IPipelineMiddleware, MiddlewareContext } from '../../types';

/**
 * 日志级别
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 日志中间件
 *
 * 记录管线执行的完整日志链路：
 * - before: 记录解析后的工具调用列表
 * - after: 记录执行结果统计
 */
export class LoggerMiddleware implements IPipelineMiddleware {
  readonly name = 'logger';

  async before(context: MiddlewareContext): Promise<MiddlewareContext> {
    this.log('info', `Pipeline:start`, {
      pipelineId: context.pipelineId,
      workspaceId: context.workspaceId,
      toolCount: context.calls.length,
      tools: context.calls.map((c) => c.toolName),
    });

    return context;
  }

  async after(context: MiddlewareContext): Promise<MiddlewareContext> {
    const results = context.results || [];
    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    this.log('info', `Pipeline:complete`, {
      pipelineId: context.pipelineId,
      total: results.length,
      success: successCount,
      failed: failCount,
    });

    // 记录失败详情
    for (const result of results) {
      if (!result.success) {
        this.log('warn', `Tool:failed`, {
          toolName: result.toolName,
          toolCallId: result.toolCallId,
          error: result.error,
          fallback: result.resolvedByFallback,
        });
      }
    }

    return context;
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const prefix = `[Pipeline:${level.toUpperCase()}]`;
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    // 使用 console 输出，后续可替换为正式日志模块
    switch (level) {
      case 'error':
        console.error(`${prefix} ${message}${dataStr}`);
        break;
      case 'warn':
        console.warn(`${prefix} ${message}${dataStr}`);
        break;
      case 'debug':
        console.debug(`${prefix} ${message}${dataStr}`);
        break;
      default:
        console.log(`${prefix} ${message}${dataStr}`);
    }
  }
}