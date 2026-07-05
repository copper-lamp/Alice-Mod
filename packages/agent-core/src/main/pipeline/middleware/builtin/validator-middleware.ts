/**
 * 校验中间件
 *
 * 在 Batch 发送前校验工具调用的参数合法性。
 * 使用工作区注册的工具定义进行参数校验。
 * 校验不通过的调用会被标记为失败，不进入执行。
 */

import type { IPipelineMiddleware, MiddlewareContext } from '../../types';
import type { ToolSchema } from '@mcagent/shared';

/**
 * 校验中间件
 *
 * 需要获取工作区的工具定义列表进行校验。
 * 通过 context.metadata 传入 ToolRegistry 引用。
 */
export class ValidatorMiddleware implements IPipelineMiddleware {
  readonly name = 'validator';

  async before(context: MiddlewareContext): Promise<MiddlewareContext> {
    const toolRegistry = context.metadata.toolRegistry as {
      findTool: (workspaceId: string, toolName: string) => ToolSchema | undefined;
    } | undefined;

    if (!toolRegistry) {
      // 未提供工具注册表，跳过校验
      return context;
    }

    const validCalls = [];
    const errors: Array<{ code: string; message: string; toolName?: string; toolCallId?: string }> = [];

    for (const call of context.calls) {
      const definition = toolRegistry.findTool(context.workspaceId, call.toolName);

      if (!definition) {
        // 工具未注册，跳过
        errors.push({
          code: 'FCP_003',
          message: `工具 "${call.toolName}" 在工作区 ${context.workspaceId} 中未注册`,
          toolName: call.toolName,
          toolCallId: call.toolCallId,
        });
        continue;
      }

      if (definition.enabled === false) {
        // 工具未启用
        errors.push({
          code: 'FCP_003',
          message: `工具 "${call.toolName}" 在工作区 ${context.workspaceId} 中已禁用`,
          toolName: call.toolName,
          toolCallId: call.toolCallId,
        });
        continue;
      }

      // 校验参数
      const params = definition.parameters || {};
      let hasError = false;

      for (const [key, param] of Object.entries(params)) {
        const value = call.arguments[key];

        if (param.required && (value === undefined || value === null)) {
          errors.push({
            code: 'FCP_001',
            message: `工具 "${call.toolName}" 缺少必填参数: ${key}`,
            toolName: call.toolName,
            toolCallId: call.toolCallId,
          });
          hasError = true;
          break;
        }
      }

      if (!hasError) {
        validCalls.push(call);
      }
    }

    // 更新上下文
    context.calls = validCalls;
    if (errors.length > 0) {
      context.errors = [...(context.errors || []), ...errors];
    }

    return context;
  }

  async after(context: MiddlewareContext): Promise<MiddlewareContext> {
    // 后置不需要处理
    return context;
  }
}