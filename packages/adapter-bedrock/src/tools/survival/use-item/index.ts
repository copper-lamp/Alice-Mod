/**
 * 工具：use_item
 *
 * 使用物品，支持 use（使用）、drink（饮用）、throw（投掷）三种模式。
 * 执行AI会自动查找物品并执行使用动作。
 */

import type { IToolModule, ToolMetadata, ToolContext, ResultEnvelope } from '../../../registry/tool-module.types.js';

export default class UseItemTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'use_item',
      description: '使用物品，支持 use（使用）、drink（饮用）、throw（投掷）三种模式。执行AI会自动查找物品并执行使用动作。',
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
            enum: ['use', 'drink', 'throw'],
            description: '使用模式：use-使用/放置, drink-饮用, throw-投掷',
            default: 'use',
          },
          target: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
            },
            description: '使用目标位置（可选，如放置方块、投掷方向等）',
          },
          bot_name: {
            type: 'string',
            description: '假人名称（多假人时必须指定）',
          },
        },
        required: ['item_name'],
      },
      output_schema: {
        type: 'object',
        properties: {
          itemUsed: { type: 'string' },
          effect: { type: 'string' },
          targetHit: { type: 'string' },
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

  async execute(params: Record<string, any>, ctx: ToolContext): Promise<ResultEnvelope> {
    try {
      const { item_name, mode = 'use', target, bot_name } = params;

      if (!item_name) {
        return {
          success: false,
          error: { code: 'INVALID_PARAMS', message: '缺少必要参数: item_name' },
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

      // 查找物品
      const inventory = player.getInventory();
      if (!inventory) {
        return {
          success: false,
          error: { code: 'INTERNAL_ERROR', message: '无法获取背包' },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      const size = inventory.size ?? 36;
      let foundSlot = -1;
      for (let i = 0; i < size; i++) {
        const item = inventory.getItem(i);
        if (!item || item.isNull()) continue;
        const name = String(item.type || item.name || '').toLowerCase();
        if (name.includes(item_name.toLowerCase())) {
          foundSlot = i;
          break;
        }
      }

      if (foundSlot < 0) {
        return {
          success: false,
          error: { code: 'ITEM_NOT_FOUND', message: `背包中未找到物品: ${item_name}` },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      // 切换到该槽位
      if (typeof player.setSelectedSlot === 'function') {
        player.setSelectedSlot(foundSlot);
      }

      // 根据模式执行
      let effect: string | undefined;
      let targetHit: string | undefined;

      switch (mode) {
        case 'use':
          if (typeof player.simulateUseItem === 'function') {
            player.simulateUseItem();
          }
          effect = 'used';
          break;

        case 'drink':
          // 饮用：需要持续使用
          if (typeof player.simulateUseItem === 'function') {
            player.simulateUseItem();
          }
          effect = 'drunk';
          break;

        case 'throw':
          if (typeof player.simulateThrowItem === 'function') {
            player.simulateThrowItem();
          }
          effect = 'thrown';
          break;
      }

      return {
        success: true,
        data: {
          itemUsed: item_name,
          effect,
          targetHit,
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