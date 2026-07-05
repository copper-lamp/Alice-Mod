/**
 * 内置路由规则
 */

import type { RouterRule, RouterContext, IProviderRegistry } from '../types';

/**
 * 创建内置路由规则
 */
export function createBuiltinRules(registry: IProviderRegistry): RouterRule[] {
  return [
    // 规则1：需要工具调用的请求，确保目标 Provider 支持 Function Calling
    {
      name: 'requires-tools-check',
      match: (ctx: RouterContext) => ctx.requiresTools,
      target: 'fallback',  // 走降级检查（会检查 Provider 能力）
      priority: 100,
    },

    // 规则2：需要流式的请求，确保目标 Provider 支持流式输出
    {
      name: 'requires-streaming-check',
      match: (ctx: RouterContext) => ctx.requiresStreaming,
      target: 'fallback',
      priority: 90,
    },
  ];
}

/**
 * 创建按任务类型过滤的自定义规则
 */
export function createTaskTypeRule(name: string, taskType: string, target: RouterRule['target'], priority: number): RouterRule {
  return {
    name,
    match: (ctx: RouterContext) => ctx.taskType === taskType,
    target,
    priority,
  };
}