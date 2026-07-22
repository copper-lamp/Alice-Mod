/**
 * 工具：place_block
 *
 * 在指定坐标放置方块，支持可选放置方向。
 * 执行AI会自动移动到目标位置附近。
 */

import type { IToolModule, ToolMetadata, ToolContext, ResultEnvelope } from '../../../registry/tool-module.types.js';
import { BlockOperationEngine } from '../../../ai/block/BlockOperationEngine.js';
import { InventoryEngine } from '../../../ai/inventory/InventoryEngine.js';

export default class PlaceBlockTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'place_block',
      description: '在指定坐标放置方块，支持可选放置方向。执行AI会自动移动到目标位置附近。',
      category: 'block',
      input_schema: {
        type: 'object',
        properties: {
          x: { type: 'number', description: '放置位置的 X 坐标' },
          y: { type: 'number', description: '放置位置的 Y 坐标' },
          z: { type: 'number', description: '放置位置的 Z 坐标' },
          block_name: {
            type: 'string',
            description: '要放置的方块名称',
          },
          facing: {
            type: 'string',
            enum: ['down', 'up', 'north', 'south', 'west', 'east'],
            description: '放置方向（可选，不指定则自动选择）',
          },
          bot_name: {
            type: 'string',
            description: '假人名称（多假人时必须指定）',
          },
        },
        required: ['x', 'y', 'z', 'block_name'],
      },
      output_schema: {
        type: 'object',
        properties: {
          blockName: { type: 'string' },
          position: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
            },
          },
        },
      },
      execution: {
        timeout_default_ms: 15000,
        timeout_max_ms: 30000,
        is_movement: true,
        is_async: true,
      },
    };
  }

  async execute(params: Record<string, any>, ctx: ToolContext): Promise<ResultEnvelope> {
    try {
      const { x, y, z, block_name, facing, bot_name } = params;
      const botName = this.resolveBotName(ctx, bot_name);

      if (!botName) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: '未指定假人名称，且不存在唯一在线假人' },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      const player = ctx.bot.getBotPlayer(botName);
      if (!player) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: `假人不在线: ${botName}` },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      const inventoryEngine = new InventoryEngine(player as any, botName);
      const engine = new BlockOperationEngine({
        player,
        botName,
        inventoryEngine,
        world: ctx.world,
      });

      const pos = { x: Number(x), y: Number(y), z: Number(z) };
      const result = await engine.placeBlock(pos, block_name, facing);

      if (!result.success) {
        return {
          success: false,
          error: {
            code: result.error?.includes('占用') ? 'POSITION_OCCUPIED' : 'CANNOT_PLACE',
            message: result.error || '放置失败',
          },
          data: {
            blockName: block_name,
            position: { x: pos.x, y: pos.y, z: pos.z },
          },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      return {
        success: true,
        data: {
          blockName: block_name,
          position: { x: pos.x, y: pos.y, z: pos.z },
        },
        meta: { duration: ctx.getElapsedMs() },
      };
    } catch (err) {
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : String(err) },
        meta: { duration: ctx.getElapsedMs() },
      };
    }
  }

  private resolveBotName(ctx: ToolContext, explicitName?: string): string | null {
    if (explicitName) return explicitName;
    const activeBot = ctx.bot.getActiveBot();
    if (activeBot && activeBot.name && this.isOnline(activeBot)) return activeBot.name;

    const bots = ctx.bot.listBots();
    const online = bots.filter((b) => this.isOnline(b));
    if (online.length === 1) return online[0].name;
    return null;
  }

  private isOnline(bot: { isOnline: boolean | (() => boolean) }): boolean {
    return typeof bot.isOnline === 'function' ? bot.isOnline() : bot.isOnline;
  }
}