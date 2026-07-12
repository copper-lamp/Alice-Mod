/**
 * 生存工具 use_item
 *
 * 使用物品，支持普通使用、喝药水和投掷三种模式。
 */

import type { IToolModule, ToolMetadata, ToolContext, ToolResult } from '../../../registry/tool-module.types.js';
import { SurvivalEngine } from '../../../ai/survival/index.js';
import { InventoryEngine } from '../../../ai/inventory/index.js';
import type { Vec3 } from '../../../ai/pathfinding/types.js';

export default class UseItemTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'use_item',
      description: '使用物品，支持普通使用、喝药水和投掷三种模式',
      category: 'survival',
      input_schema: {
        type: 'object',
        properties: {
          item_name: {
            type: 'string',
            description: '要使用的物品名称',
          },
          mode: {
            type: 'string',
            description: '使用模式',
            enum: ['use', 'drink', 'throw'],
          },
          target: {
            type: 'object',
            description: '目标位置（投掷模式需要）',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
            },
          },
        },
        required: ['item_name', 'mode'],
      },
      output_schema: {
        type: 'object',
        properties: {
          item: { type: 'string' },
          mode: { type: 'string' },
          remaining: { type: 'number', description: '剩余数量' },
        },
      },
      execution: {
        timeout_default_ms: 10000,
        timeout_max_ms: 30000,
        is_movement: false,
        is_async: false,
      },
    };
  }

  async execute(params: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    try {
      const resolved = this.resolveBot(ctx, params);
      if (!resolved) {
        return {
          success: false,
          error: 'BOT_NOT_FOUND',
          duration_ms: ctx.getElapsedMs(),
        };
      }

      const { player, botName } = resolved;
      const inventoryEngine = new InventoryEngine(player, botName);
      const engine = new SurvivalEngine({
        player,
        botName,
        inventoryEngine,
        world: ctx.world,
      });

      const target: Vec3 | undefined = params.target
        ? {
            x: Number(params.target.x),
            y: Number(params.target.y),
            z: Number(params.target.z),
          }
        : undefined;

      const result = await engine.useItem(params.item_name, params.mode, target);

      return {
        success: result.success,
        data: result.success
          ? {
              item: result.item,
              mode: result.mode,
              remaining: result.remaining,
            }
          : undefined,
        error: result.error,
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

  private resolveBot(
    ctx: ToolContext,
    params: Record<string, any>,
  ): { player: any; botName: string } | null {
    if (params.bot_name) {
      const player = ctx.bot.getBotPlayer(params.bot_name);
      if (!player) return null;
      return { player, botName: params.bot_name };
    }

    const activeBot = ctx.bot.getActiveBot();
    if (!activeBot) return null;

    const player = typeof activeBot.getPlayer === 'function' ? activeBot.getPlayer() : activeBot;
    const botName = activeBot.name || 'default';
    if (!player) return null;

    return { player, botName };
  }
}
