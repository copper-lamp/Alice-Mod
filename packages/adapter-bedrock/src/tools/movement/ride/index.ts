/**
 * 骑乘工具 ride
 */

import type { IToolModule, ToolMetadata, ToolContext, ToolResult } from '../../../registry/tool-module.types.js';
import { aiEngine } from '../../../ai/index.js';

export default class RideTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'ride',
      description: '骑乘实体（马、猪、船等）',
      category: 'movement',
      input_schema: {
        type: 'object',
        properties: {
          entity_id: {
            type: 'string',
            description: '实体 ID',
          },
          bot_name: {
            type: 'string',
            description: '假人名称（多假人时必须指定）',
          },
        },
        required: ['entity_id'],
      },
      output_schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          isRiding: { type: 'boolean' },
          mountType: { type: 'string' },
          reason: { type: 'string' },
        },
      },
      execution: {
        timeout_default_ms: 10000,
        timeout_max_ms: 30000,
        is_movement: true,
        is_async: true,
      },
    };
  }

  async execute(params: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    try {
      const { entity_id, bot_name } = params;
      const result = await aiEngine.ride(bot_name, entity_id);

      return {
        success: result.success,
        data: {
          isRiding: result.isRiding,
          mountType: result.mountType,
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
