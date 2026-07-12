/**
 * 工具：drop_item
 *
 * 丢弃背包中指定物品，可指定数量；未指定名称时丢弃当前主手物品。
 */

import type { IToolModule, ToolMetadata, ToolContext, ToolResult } from '../../../registry/tool-module.types.js';
import { InventoryEngine } from '../../../ai/inventory/InventoryEngine.js';

export default class DropItemTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'drop_item',
      description: '丢弃背包中的物品。可指定物品名称和数量，未指定名称时丢弃当前主手物品。',
      category: 'inventory',
      input_schema: {
        type: 'object',
        properties: {
          item_name: {
            type: 'string',
            description: '要丢弃的物品名称（如 cobblestone、stone_sword），不填则丢弃主手物品',
          },
          count: {
            type: 'number',
            description: '丢弃数量，不填则丢弃该槽位全部',
          },
          target_entity: {
            type: 'string',
            description: '目标实体 ID，指定时向该实体位置丢弃',
          },
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
          item: { type: 'string' },
          dropped: { type: 'number' },
          remaining: { type: 'number' },
          reason: { type: 'string' },
        },
      },
      execution: {
        timeout_default_ms: 10000,
        timeout_max_ms: 30000,
        is_movement: false,
        is_async: true,
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async execute(params: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    try {
      const { item_name, count, target_entity, bot_name } = params;
      const botName = this.resolveBotName(ctx, bot_name);

      if (!botName) {
        return {
          success: false,
          error: '未指定假人名称，且不存在唯一在线假人',
          duration_ms: ctx.getElapsedMs(),
        };
      }

      const player = ctx.bot.getBotPlayer(botName);
      if (!player) {
        return {
          success: false,
          error: `假人不在线: ${botName}`,
          duration_ms: ctx.getElapsedMs(),
        };
      }

      const engine = new InventoryEngine(player, botName);
      const result = engine.drop(item_name, count, target_entity);

      return {
        success: result.success,
        data: {
          item: result.item,
          dropped: result.dropped,
          remaining: result.remaining,
          reason: result.success ? 'success' : result.error,
        },
        error: result.success ? undefined : result.error,
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
