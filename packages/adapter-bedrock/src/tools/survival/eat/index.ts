/**
 * 生存工具 eat
 *
 * 让假人吃东西恢复饥饿值，可指定食物名称或自动选择最优食物。
 */

import type { IToolModule, ToolMetadata, ToolContext, ToolResult } from '../../../registry/tool-module.types.js';
import { SurvivalEngine } from '../../../ai/survival/index.js';
import { InventoryEngine } from '../../../ai/inventory/index.js';

export default class EatTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'eat',
      description: '让假人吃东西恢复饥饿值，可指定食物名称或自动选择最优食物',
      category: 'survival',
      input_schema: {
        type: 'object',
        properties: {
          food_name: {
            type: 'string',
            description: '要吃的食物名称，不指定则自动选择最优食物',
          },
        },
      },
      output_schema: {
        type: 'object',
        properties: {
          item: { type: 'string', description: '实际食用的物品' },
          hunger_restored: { type: 'number', description: '恢复的饥饿值' },
          saturation_restored: { type: 'number', description: '恢复的饱和度' },
          effects: { type: 'array', description: '获得的药水效果' },
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

      const result = await engine.eat(params.food_name);

      return {
        success: result.success,
        data: result.success
          ? {
              item: result.item,
              hunger_restored: result.hungerRestored,
              saturation_restored: result.saturationRestored,
              effects: result.effects,
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
