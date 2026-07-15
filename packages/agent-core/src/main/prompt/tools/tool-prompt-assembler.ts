/**
 * 工具提示组装器
 *
 * 将工具 Schema 动态转换为 LLM 可识别的 ToolPromptDefinition 格式。
 * 支持分类过滤、优先级排序、自定义格式器和 Provider 格式适配。
 */

import type {
  ToolPromptDefinition,
  ToolParamPrompt,
  ToolPromptFormatter,
  ToolFormatAdapter,
  AssembleOptions,
  IToolPromptAssembler,
} from '../types';
import type { ToolSchema } from '@mcagent/shared';

/**
 * 工具提示组装器默认实现
 */
export class DefaultToolPromptAssembler implements IToolPromptAssembler {
  private formatters: Map<string, ToolPromptFormatter> = new Map();
  private adapters: Map<string, ToolFormatAdapter> = new Map();
  private cache: Map<string, { tools: ToolPromptDefinition[]; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 60000; // 60s

  constructor(
    private toolRegistry: { getTools(workspaceId: string): ToolSchema[] },
  ) {
    this.registerDefaultAdapters();
  }

  async assemble(workspaceId: string, options?: AssembleOptions): Promise<ToolPromptDefinition[]> {
    const cacheKey = `tools:${workspaceId}:${JSON.stringify(options || {})}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL && options?.useCache !== false) {
      return cached.tools;
    }

    // 1. 获取原始工具 Schema
    const schemas = this.toolRegistry.getTools(workspaceId);

    // 2. 转换为中间格式
    let tools: ToolPromptDefinition[] = schemas.map(schema => this.schemaToPromptDef(schema));

    // 3. 分类过滤
    if (options?.includeCategories) {
      tools = tools.filter(t => options.includeCategories!.includes(t.category));
    }
    if (options?.excludeCategories) {
      tools = tools.filter(t => !options.excludeCategories!.includes(t.category));
    }

    // 4. 名称过滤
    if (options?.includeTools) {
      tools = tools.filter(t => options.includeTools!.includes(t.name));
    }
    if (options?.excludeTools) {
      tools = tools.filter(t => !options.excludeTools!.includes(t.name));
    }

    // 5. 应用自定义格式器
    tools = tools.map(t => {
      const formatter = this.formatters.get(t.name);
      return formatter ? formatter.format(t) : t;
    });

    // 6. 按优先级排序
    tools.sort((a, b) => a.priority - b.priority);

    // 7. 截断
    if (options?.maxTools && tools.length > options.maxTools) {
      tools = tools.slice(0, options.maxTools);
    }

    // 8. 缓存结果
    if (options?.useCache !== false) {
      this.cache.set(cacheKey, { tools, timestamp: Date.now() });
    }

    return tools;
  }

  filterByCategory(
    tools: ToolPromptDefinition[],
    categories: string[],
  ): ToolPromptDefinition[] {
    return tools.filter(t => categories.includes(t.category));
  }

  filterByCondition(
    tools: ToolPromptDefinition[],
    condition: (tool: ToolPromptDefinition) => boolean,
  ): ToolPromptDefinition[] {
    return tools.filter(condition);
  }

  registerFormatter(toolName: string, formatter: ToolPromptFormatter): void {
    this.formatters.set(toolName, formatter);
  }

  registerProviderAdapter(providerId: string, adapter: ToolFormatAdapter): void {
    this.adapters.set(providerId, adapter);
  }

  /** 获取指定 Provider 的格式适配器 */
  getAdapter(providerId: string): ToolFormatAdapter | undefined {
    return this.adapters.get(providerId);
  }

  /** 清除缓存 */
  clearCache(): void {
    this.cache.clear();
  }

  private schemaToPromptDef(schema: ToolSchema): ToolPromptDefinition {
    const params: Record<string, ToolParamPrompt> = {};
    for (const [key, def] of Object.entries(schema.parameters ?? {})) {
      params[key] = {
        type: def.type,
        description: def.description || '',
        required: def.required ?? false,
        default: def.default,
        enum: def.enum,
        example: def.default,
      };
    }

    return {
      name: schema.name,
      description: schema.description,
      parameters: params,
      category: schema.category,
      priority: this.getDefaultPriority(schema.category),
      examples: [],
    };
  }

  private getDefaultPriority(category: string): number {
    const priorities: Record<string, number> = {
      perception: 1,
      movement: 2,
      inventory: 3,
      survival: 4,
      block: 5,
      entity: 6,
      chat: 7,
      qq: 8,
      memory: 9,
      task: 10,
    };
    return priorities[category] || 99;
  }

  private registerDefaultAdapters(): void {
    // OpenAI 格式适配器
    this.adapters.set('openai', {
      convert: (tools) => tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: {
            type: 'object',
            properties: Object.fromEntries(
              Object.entries(t.parameters).map(([key, param]) => [
                key,
                {
                  type: param.type,
                  description: param.description,
                  ...(param.enum ? { enum: param.enum } : {}),
                },
              ]),
            ),
            required: Object.entries(t.parameters)
              .filter(([_, p]) => p.required)
              .map(([key]) => key),
          },
        },
      })),
    });
  }
}