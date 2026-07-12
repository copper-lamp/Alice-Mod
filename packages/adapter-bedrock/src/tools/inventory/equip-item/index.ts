/**
 * 工具：equip_item
 *
 * 装备或卸下指定部位的装备/副手物品。
 */

import type { IToolModule, ToolMetadata, ToolContext, ToolResult } from '../../../registry/tool-module.types.js';
import { InventoryEngine } from '../../../ai/inventory/InventoryEngine.js';
import type { ArmorSlot } from '../../../ai/inventory/types.js';

const VALID_SLOTS: ArmorSlot[] = ['head', 'chest', 'legs', 'feet', 'offhand'];

export default class EquipItemTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'equip_item',
      description: '装备或卸下指定部位的物品。支持 head、chest、legs、feet、offhand。',
      category: 'inventory',
      input_schema: {
        type: 'object',
        properties: {
          item_name: {
            type: 'string',
            description: '要装备的物品名称，不填或空字符串表示卸下该部位装备',
          },
          slot: {
            type: 'string',
            enum: ['head', 'chest', 'legs', 'feet', 'offhand'],
            description: '装备部位',
          },
          bot_name: {
            type: 'string',
            description: '假人名称（多假人时必须指定）',
          },
        },
        required: ['slot'],
      },
      output_schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          item: { type: 'string' },
          slot: { type: 'string' },
          previous_item: { type: 'string' },
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
      const { item_name, slot, bot_name } = params;

      if (!VALID_SLOTS.includes(slot)) {
        return {
          success: false,
          error: `无效的装备部位: ${slot}，可选: ${VALID_SLOTS.join(', ')}`,
          duration_ms: ctx.getElapsedMs(),
        };
      }

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
      const result = item_name
        ? engine.equip(item_name, slot as ArmorSlot)
        : engine.unequip(slot as ArmorSlot);

      return {
        success: result.success,
        data: {
          item: result.item,
          slot: result.slot,
          previous_item: result.previousItem,
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
