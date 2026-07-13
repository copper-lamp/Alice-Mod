/**
 * ToolManager — 工具管理器
 *
 * 封装 ToolRegistry 的工具查找、执行、超时管理功能。
 * 提供统一的 executeTool 接口，包含超时控制、错误处理、耗时统计。
 */

import { ToolRegistry } from './tool-registry.js';
import type { ToolContext, ResultEnvelope } from './tool-module.types.js';

/**
 * 工具管理器
 */
export class ToolManager {
  private registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  /**
   * 执行指定工具
   * @param name 工具名称
   * @param params 工具参数
   * @param ctx 执行上下文
   * @returns 执行结果（含耗时统计）
   */
  async executeTool(
    name: string,
    params: Record<string, any>,
    ctx: ToolContext,
  ): Promise<ResultEnvelope> {
    const tool = this.registry.resolve(name);
    if (!tool) {
      logger.error(`[ToolManager] 工具未找到: ${name}`);
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `工具未找到: ${name}`,
        },
        meta: { duration: 0 },
      };
    }

    const timeout = tool.metadata.execution?.timeout_max_ms
      ?? tool.metadata.execution?.timeout_default_ms
      ?? 30000;

    logger.info(`[ToolManager] 开始执行工具 ${name}, 参数=${JSON.stringify(params)}, 超时=${timeout}ms`);
    const startTime = Date.now();

    try {
      const result = await Promise.race([
        tool.module.execute(params, ctx),
        createTimeout(timeout, name),
      ]);

      const duration = Date.now() - startTime;
      if (result.success) {
        logger.info(`[ToolManager] 工具 ${name} 执行成功, 耗时=${duration}ms`);
      } else {
        const errMsg = result.error?.message || 'unknown';
        logger.warn(`[ToolManager] 工具 ${name} 执行失败, 耗时=${duration}ms, 错误=${errMsg}`);
      }

      return {
        ...result,
        meta: {
          ...result.meta,
          duration,
        },
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : '';
      logger.error(`[ToolManager] 工具 ${name} 执行异常, 耗时=${duration}ms, 错误=${message}\n${stack || ''}`);
      return {
        success: false,
        error: {
          code: 'TIMEOUT',
          message,
        },
        meta: { duration },
      };
    }
  }

  /**
   * 获取底层注册器（用于查询工具列表等）
   */
  getRegistry(): ToolRegistry {
    return this.registry;
  }
}

/**
 * 创建超时 Promise
 */
function createTimeout(ms: number, toolName: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`TOOL_TIMEOUT: ${toolName} 执行超时 (${ms}ms)`));
    }, ms);
  });
}