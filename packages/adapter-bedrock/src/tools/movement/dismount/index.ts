/**
 * 下马/下船工具 dismount
 */

import type { IToolModule, ToolMetadata, ToolContext, ToolResult } from '../../../registry/tool-module.types.js';
import { aiEngine } from '../../../ai/index.js';

export default class DismountTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'dismount',
      description: '下马或下船',
      category: 'movement',
      input_schema: {
        type: 'object',
        properties: {
          bot_name: {
            type: 'string',
            description: '假人名称（多假人时必须指定）',
          },
        },
      },
      output_schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          isRiding: { type: 'boolean' },
          reason: { type: 'string' },
        },
      },
      execution: {
        timeout_default_ms: 5000,
        timeout_max_ms: 10000,
        is_movement: true,
        is_async: true,
      },
    };
  }

  async execute(params: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    try {
      const { bot_name } = params;
      const result = await aiEngine.dismount(bot_name);

      return {
        success: result.success,
        data: {
          isRiding: result.isRiding,
          reason: result.reason,
        },
        error: result.success ? undefined : result.reason,
        duration_ms: ctx.getElapsedMs(),
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        duration_ms: ctx.getElapsedMs(),
      };
    }
  }
}
