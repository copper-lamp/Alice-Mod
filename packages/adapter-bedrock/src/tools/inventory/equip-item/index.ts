/**
 * 工具：equip_item
 *
 * 装备或卸下指定部位的物品，支持 head、chest、legs、feet、offhand 五个部位。
 * 通过 action 参数区分装备/卸下操作。
 */

import type { IToolModule, ToolMetadata, ToolContext, ResultEnvelope } from '../../../registry/tool-module.types.js';
import { InventoryEngine } from '../../../ai/inventory/InventoryEngine.js';

type ArmorSlot = 'head' | 'chest' | 'legs' | 'feet' | 'offhand';
const VALID_SLOTS: ArmorSlot[] = ['head', 'chest', 'legs', 'feet', 'offhand'];

export default class EquipItemTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'equip_item',
      description: '装备或卸下指定部位的物品。支持 head、chest、legs、feet、offhand。通过 action 参数区分 equip（装备）和 unequip（卸下）。',
      category: 'inventory',
      input_schema: {
        type: 'object',
        properties: {
          item_name: {
            type: 'string',
            description: '要装备的物品名称，装备模式必填',
          },
          slot: {
            type: 'string',
            enum: ['head', 'chest', 'legs', 'feet', 'offhand'],
            description: '装备部位',
          },
          action: {
            type: 'string',
            enum: ['equip', 'unequip'],
            description: '操作类型：equip 装备，unequip 卸下',
            default: 'equip',
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
          equippedItem: { type: 'string' },
          unequippedItem: { type: 'string' },
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
      const { item_name, slot, action = 'equip', bot_name } = params;

      if (!VALID_SLOTS.includes(slot)) {
        return {
          success: false,
          error: { code: 'INVALID_PARAMS', message: `无效的装备部位: ${slot}，可选: ${VALID_SLOTS.join(', ')}` },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      if (action === 'equip' && !item_name) {
        return {
          success: false,
          error: { code: 'INVALID_PARAMS', message: '装备模式需要指定 item_name' },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

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

      const engine = new InventoryEngine(player, botName);
      const result = action === 'equip'
        ? engine.equip(item_name, slot as ArmorSlot)
        : engine.unequip(slot as ArmorSlot);

      if (!result.success) {
        return {
          success: false,
          error: { code: 'ITEM_NOT_FOUND', message: result.reason || `${action} 失败` },
          data: {
            equippedItem: result.equippedItem ?? undefined,
            unequippedItem: result.unequippedItem ?? undefined,
          },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      return {
        success: true,
        data: {
          equippedItem: result.equippedItem ?? undefined,
          unequippedItem: result.unequippedItem ?? undefined,
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