/**
 * Provider 格式适配器
 *
 * 不同 LLM Provider 对工具定义的格式要求不同，适配器负责转换：
 * - OpenAI: Function Calling JSON Schema
 * - Claude: Tools API
 * - Gemini: FunctionDeclaration
 * - Ollama: 兼容 OpenAI 格式
 */

import type { ToolPromptDefinition, ToolFormatAdapter } from '../types';

/**
 * OpenAI Function Calling 格式适配器
 */
export class OpenAIFormatAdapter implements ToolFormatAdapter {
  convert(tools: ToolPromptDefinition[]): unknown[] {
    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(
            Object.entries(t.parameters).map(([key, param]) => {
              const prop: Record<string, unknown> = {
                type: param.type,
                description: param.description,
              };
              if (param.enum) prop.enum = param.enum;
              if (param.default !== undefined) prop.default = param.default;
              return [key, prop];
            }),
          ),
          required: Object.entries(t.parameters)
            .filter(([_, p]) => p.required)
            .map(([key]) => key),
        },
      },
    }));
  }
}

/**
 * Claude Tools API 格式适配器
 */
export class ClaudeFormatAdapter implements ToolFormatAdapter {
  convert(tools: ToolPromptDefinition[]): unknown[] {
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(t.parameters).map(([key, param]) => {
            const prop: Record<string, unknown> = {
              type: param.type,
              description: param.description,
            };
            if (param.enum) prop.enum = param.enum;
            if (param.default !== undefined) prop.default = param.default;
            return [key, prop];
          }),
        ),
        required: Object.entries(t.parameters)
          .filter(([_, p]) => p.required)
          .map(([key]) => key),
      },
    }));
  }
}

/**
 * Gemini FunctionDeclaration 格式适配器
 */
export class GeminiFormatAdapter implements ToolFormatAdapter {
  convert(tools: ToolPromptDefinition[]): unknown[] {
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(t.parameters).map(([key, param]) => {
            const prop: Record<string, unknown> = {
              type: param.type,
              description: param.description,
            };
            if (param.enum) prop.enum = param.enum;
            return [key, prop];
          }),
        ),
        required: Object.entries(t.parameters)
          .filter(([_, p]) => p.required)
          .map(([key]) => key),
      },
    }));
  }
}

/**
 * Provider 格式适配器工厂
 */
export function createAdapter(providerId: string): ToolFormatAdapter | undefined {
  switch (providerId) {
    case 'openai':
    case 'ollama':
      return new OpenAIFormatAdapter();
    case 'claude':
      return new ClaudeFormatAdapter();
    case 'gemini':
      return new GeminiFormatAdapter();
    default:
      return undefined;
  }
}