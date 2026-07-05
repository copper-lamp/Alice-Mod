/**
 * ResponseParser 默认实现
 *
 * 解析 LLM 响应中的 tool_calls，提取工具名和参数。
 * 支持标准 OpenAI 格式的 tool_calls。
 * 后续可扩展支持更多 LLM 格式。
 */

import type { ToolSchema } from '@mcagent/shared';
import type { IResponseParser, LLMResponse, ToolCallContent, ValidationResult } from './types';

/**
 * 默认响应解析器
 *
 * 解析标准格式的 tool_calls：
 * ```json
 * {
 *   "message": {
 *     "tool_calls": [{
 *       "id": "call_xxx",
 *       "function": { "name": "move_to", "arguments": "{\"x\": 100}" }
 *     }]
 *   }
 * }
 * ```
 */
export class DefaultResponseParser implements IResponseParser {
  parse(response: LLMResponse): ToolCallContent[] {
    const toolCalls = response.message?.tool_calls;
    if (!toolCalls || !Array.isArray(toolCalls) || toolCalls.length === 0) {
      return [];
    }

    const results: ToolCallContent[] = [];

    for (const tc of toolCalls) {
      if (tc.type !== 'function' || !tc.function?.name) continue;

      let parsedArgs: Record<string, unknown> = {};
      try {
        if (tc.function.arguments) {
          parsedArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        }
      } catch {
        // 参数解析失败时使用空对象，标记为空参数
      }

      results.push({
        type: 'tool_call',
        toolCallId: tc.id || `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        toolName: tc.function.name,
        arguments: parsedArgs,
      });
    }

    return results;
  }

  validate(call: ToolCallContent, definition: ToolSchema): ValidationResult {
    const errors: string[] = [];
    const params = definition.parameters || {};

    for (const [key, param] of Object.entries(params)) {
      const value = call.arguments[key];

      // 检查必填
      if (param.required && (value === undefined || value === null)) {
        errors.push(`缺少必填参数: ${key}`);
        continue;
      }

      if (value === undefined || value === null) continue;

      // 检查类型
      if (param.type === 'string' && typeof value !== 'string') {
        errors.push(`参数 ${key} 应为 string，实际为 ${typeof value}`);
      } else if (param.type === 'number' && typeof value !== 'number') {
        errors.push(`参数 ${key} 应为 number，实际为 ${typeof value}`);
      } else if (param.type === 'boolean' && typeof value !== 'boolean') {
        errors.push(`参数 ${key} 应为 boolean，实际为 ${typeof value}`);
      }

      // 检查枚举
      if (param.enum && Array.isArray(param.enum) && !param.enum.includes(String(value))) {
        errors.push(`参数 ${key} 值 "${value}" 不在允许的枚举范围内: ${param.enum.join(', ')}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}