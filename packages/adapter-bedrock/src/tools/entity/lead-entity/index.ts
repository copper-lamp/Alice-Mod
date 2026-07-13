/**
 * 工具：lead_entity
 *
 * 牵引或释放生物，通过 action 参数区分 lead（牵引）和 release（释放）。
 * 执行AI会自动移动到实体附近。
 */

import type { IToolModule, ToolMetadata, ToolContext, ResultEnvelope } from '../../../registry/tool-module.types.js';

export default class LeadEntityTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'lead_entity',
      description: '牵引或释放生物。action=lead 牵引，action=release 释放。执行AI会自动移动到实体附近。',
      category: 'entity',
      input_schema: {
        type: 'object',
        properties: {
          entityId: {
            type: 'string',
            description: '目标实体 ID',
          },
          action: {
            type: 'string',
            enum: ['lead', 'release'],
            description: '操作类型：lead 牵引，release 释放',
          },
          botName: {
            type: 'string',
            description: '假人名称（多假人时必须指定）',
          },
        },
        required: ['entityId', 'action'],
      },
      output_schema: {
        type: 'object',
        properties: {
          entityName: { type: 'string' },
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
      const { entityId, action, botName } = params;

      if (action !== 'lead' && action !== 'release') {
        return {
          success: false,
          error: { code: 'INVALID_PARAMS', message: `不支持的操作: ${action}，可选: lead, release` },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      const resolvedBotName = this.resolveBotName(ctx, botName);
      if (!resolvedBotName) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: '未指定假人名称，且不存在唯一在线假人' },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      const player = ctx.bot.getBotPlayer(resolvedBotName);
      if (!player) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: `假人不在线: ${resolvedBotName}` },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      // 获取实体
      // @ts-expect-error — LLSE mc 类型声明中无 getEntity，但运行时可用
      const entity = mc.getEntity(entityId);
      if (!entity) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: `实体未找到: ${entityId}` },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      const entityType = String(entity.type || entity.name || '').toLowerCase();

      // 靠近实体
      const dx = entity.pos.x - player.pos.x;
      const dy = entity.pos.y - player.pos.y;
      const dz = entity.pos.z - player.pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > 4) {
        const { aiEngine } = await import('../../../ai/index.js');
        const moveResult = await aiEngine.moveTo(resolvedBotName, {
          x: entity.pos.x,
          y: entity.pos.y,
          z: entity.pos.z,
        }, { timeout: 15000 });
        if (!moveResult.success) {
          return {
            success: false,
            error: { code: 'TOO_FAR', message: `无法靠近实体: ${moveResult.reason}` },
            meta: { duration: ctx.getElapsedMs() },
          };
        }
      }

      if (action === 'lead') {
        // 牵引：手持栓绳右键
        const success = this.leadEntity(player, entity);
        return {
          success,
          data: { entityName: entityType },
          error: success ? undefined : { code: 'ITEM_NOT_FOUND', message: '牵引失败，背包中可能没有栓绳' },
          meta: { duration: ctx.getElapsedMs() },
        };
      } else {
        // 释放
        const success = this.releaseEntity(player, entity);
        return {
          success,
          data: { entityName: entityType },
          error: success ? undefined : { code: 'INTERNAL_ERROR', message: '释放失败' },
          meta: { duration: ctx.getElapsedMs() },
        };
      }
    } catch (err) {
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : String(err) },
        meta: { duration: ctx.getElapsedMs() },
      };
    }
  }

  private leadEntity(player: any, entity: any): boolean {
    try {
      const inventory = player.getInventory();
      if (!inventory) return false;

      const size = inventory.size ?? 36;
      for (let i = 0; i < size; i++) {
        const item = inventory.getItem(i);
        if (!item || item.isNull()) continue;
        const name = String(item.type || item.name || '').toLowerCase();
        if (name.includes('lead') || name.includes('leash')) {
          if (typeof player.setSelectedSlot === 'function') {
            player.setSelectedSlot(i);
          }
          break;
        }
      }

      try {
        const target = new FloatPos(entity.pos.x, entity.pos.y + 1, entity.pos.z, entity.pos.dimid ?? 0);
        if (typeof player.simulateLookAt === 'function') {
          player.simulateLookAt(target);
        }
      } catch (e) {
        // ignore
      }

      if (typeof player.simulateUseItem === 'function') {
        player.simulateUseItem();
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  private releaseEntity(player: any, entity: any): boolean {
    try {
      try {
        const target = new FloatPos(entity.pos.x, entity.pos.y + 1, entity.pos.z, entity.pos.dimid ?? 0);
        if (typeof player.simulateLookAt === 'function') {
          player.simulateLookAt(target);
        }
      } catch (e) {
        // ignore
      }

      if (typeof player.simulateInteract === 'function') {
        player.simulateInteract();
        return true;
      }
      return false;
    } catch (e) {
      return false;
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