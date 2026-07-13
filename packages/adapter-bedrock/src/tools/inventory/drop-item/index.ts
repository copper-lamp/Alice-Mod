/**
 * 工具：drop_item
 *
 * 从背包中丢弃物品，支持指定物品名称、数量，以及向指定实体（玩家）丢弃。
 */

import type { IToolModule, ToolMetadata, ToolContext, ResultEnvelope } from '../../../registry/tool-module.types.js';

export default class DropItemTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'drop_item',
      description: '从背包中丢弃物品，支持指定物品名称、数量，以及向指定实体（玩家）丢弃。',
      category: 'inventory',
      input_schema: {
        type: 'object',
        properties: {
          item_name: {
            type: 'string',
            description: '要丢弃的物品名称，不填则丢弃当前手持物品',
          },
          count: {
            type: 'number',
            description: '丢弃数量，不填则丢弃所有匹配物品',
          },
          target_entity: {
            type: 'string',
            description: '目标实体 ID（可选，向指定玩家/实体丢弃物品）',
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
          droppedCount: { type: 'number' },
        },
      },
      execution: {
        timeout_default_ms: 10000,
        timeout_max_ms: 20000,
        is_movement: false,
        is_async: true,
      },
    };
  }

  async execute(params: Record<string, any>, ctx: ToolContext): Promise<ResultEnvelope> {
    try {
      const { item_name, count, target_entity, bot_name } = params;
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

      const inventory = player.getInventory();
      if (!inventory) {
        return {
          success: false,
          error: { code: 'INTERNAL_ERROR', message: '无法获取背包' },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      let droppedCount = 0;
      const size = inventory.size ?? 36;

      for (let i = 0; i < size; i++) {
        const item = inventory.getItem(i);
        if (!item || item.isNull()) continue;

        const name = String(item.type || item.name || '').toLowerCase();
        if (item_name && !name.includes(item_name.toLowerCase())) continue;

        const itemCount = item.count ?? 1;
        const toDrop = count ? Math.min(itemCount, count - droppedCount) : itemCount;

        // 丢弃物品
        try {
          if (typeof player.simulateDropItem === 'function') {
            player.simulateDropItem(i, toDrop);
          }
        } catch (e) {
          continue;
        }

        droppedCount += toDrop;
        if (count && droppedCount >= count) break;
      }

      if (droppedCount === 0) {
        return {
          success: false,
          error: {
            code: 'ITEM_NOT_FOUND',
            message: item_name ? `背包中未找到物品: ${item_name}` : '背包中没有可丢弃的物品',
          },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      return {
        success: true,
        data: { droppedCount },
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