/**
 * 自定义工具格式器
 *
 * 提供内置的常用工具格式器，用于控制特定工具在提示词中的呈现方式。
 */

import type { ToolPromptDefinition, ToolPromptFormatter } from '../types';

/**
 * 简化版工具格式器
 * 移除所有可选参数，只保留必填参数
 */
export class MinimalToolFormatter implements ToolPromptFormatter {
  format(tool: ToolPromptDefinition): ToolPromptDefinition {
    const minimalParams: Record<string, typeof tool.parameters[string]> = {};
    for (const [key, param] of Object.entries(tool.parameters)) {
      if (param.required) {
        minimalParams[key] = param;
      }
    }
    return {
      ...tool,
      parameters: minimalParams,
      examples: [],
      usageHint: undefined,
    };
  }
}

/**
 * 详细版工具格式器
 * 添加使用示例和详细参数说明
 */
export class DetailedToolFormatter implements ToolPromptFormatter {
  format(tool: ToolPromptDefinition): ToolPromptDefinition {
    return {
      ...tool,
      description: `${tool.description}\n类别: ${tool.category}\n优先级: ${tool.priority}`,
      parameters: Object.fromEntries(
        Object.entries(tool.parameters).map(([key, param]) => [
          key,
          {
            ...param,
            description: `${param.description}${param.required ? ' (必填)' : ' (可选)'}${param.default !== undefined ? `, 默认: ${param.default}` : ''}`,
          },
        ]),
      ),
      examples: tool.examples?.length ? tool.examples : this.generateDefaultExample(tool),
    };
  }

  private generateDefaultExample(tool: ToolPromptDefinition): Array<{
    description: string;
    arguments: Record<string, unknown>;
  }> {
    const exampleArgs: Record<string, unknown> = {};
    for (const [key, param] of Object.entries(tool.parameters)) {
      if (param.required) {
        exampleArgs[key] = param.example ?? (param.type === 'string' ? 'example' : 0);
      }
    }

    return Object.keys(exampleArgs).length > 0
      ? [{ description: `${tool.name} 基本用法`, arguments: exampleArgs }]
      : [];
  }
}

/**
 * 工具格式器注册表
 */
export class ToolFormatterRegistry {
  private formatters: Map<string, ToolPromptFormatter> = new Map();

  /** 获取所有注册的格式器 */
  getAll(): Map<string, ToolPromptFormatter> {
    return new Map(this.formatters);
  }
}