/**
 * 工具：interact_entity
 *
 * 与生物交互，支持喂食、繁殖、交易、驯服、剪毛、挤奶六种操作。
 * 执行AI会自动移动到实体附近。
 */

import type { IToolModule, ToolMetadata, ToolContext, ResultEnvelope } from '../../../registry/tool-module.types.js';

const VALID_ACTIONS = ['feed', 'breed', 'trade', 'tame', 'shear', 'milk'] as const;
type EntityAction = typeof VALID_ACTIONS[number];

export default class InteractEntityTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'interact_entity',
      description: '与生物交互，支持 feed（喂食）、breed（繁殖）、trade（交易）、tame（驯服）、shear（剪毛）、milk（挤奶）。执行AI会自动移动到实体附近。',
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
            enum: [...VALID_ACTIONS],
            description: '交互类型：feed-喂食, breed-繁殖, trade-交易, tame-驯服, shear-剪毛, milk-挤奶',
          },
          itemName: {
            type: 'string',
            description: '物品名称（feed/breed/tame 模式需要，不指定则由执行AI自动选择）',
          },
          tradeIndex: {
            type: 'number',
            description: '交易选项索引（trade 模式需要）',
          },
          count: {
            type: 'number',
            description: '交易次数（trade 模式使用，默认 1）',
            default: 1,
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
          details: {
            type: 'object',
            properties: {
              foodUsed: { type: 'string' },
              babySpawned: { type: 'boolean' },
              tamed: { type: 'boolean' },
              attempts: { type: 'number' },
              woolDropped: { type: 'boolean' },
              milkObtained: { type: 'boolean' },
              tradeDetails: { type: 'object' },
            },
          },
        },
      },
      execution: {
        timeout_default_ms: 30000,
        timeout_max_ms: 60000,
        is_movement: true,
        is_async: true,
      },
    };
  }

  async execute(params: Record<string, any>, ctx: ToolContext): Promise<ResultEnvelope> {
    try {
      const { entityId, action, itemName, tradeIndex, count = 1, botName } = params;

      if (!VALID_ACTIONS.includes(action)) {
        return {
          success: false,
          error: { code: 'INVALID_PARAMS', message: `不支持的交互类型: ${action}，可选: ${VALID_ACTIONS.join(', ')}` },
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

      // 执行交互
      const details: Record<string, unknown> = {};
      let success = false;

      switch (action as EntityAction) {
        case 'feed':
        case 'breed':
        case 'tame':
          if (!itemName) {
            return {
              success: false,
              error: { code: 'ITEM_NOT_FOUND', message: `${action} 模式需要指定物品名称` },
              meta: { duration: ctx.getElapsedMs() },
            };
          }
          details.foodUsed = itemName;
          details.attempts = 1;
          success = this.simulateInteractWithItem(player, entity, itemName);
          if (action === 'tame') details.tamed = success;
          if (action === 'breed') details.babySpawned = success;
          break;

        case 'trade':
          details.tradeDetails = { index: tradeIndex, count };
          success = this.simulateInteract(player, entity);
          break;

        case 'shear':
          details.woolDropped = true;
          success = this.simulateInteractWithItem(player, entity, 'shears');
          break;

        case 'milk':
          details.milkObtained = true;
          success = this.simulateInteractWithItem(player, entity, 'bucket');
          break;
      }

      return {
        success,
        data: {
          entityName: entityType,
          details,
        },
        error: success ? undefined : { code: 'NOT_FOUND', message: `${action} 交互失败` },
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

  private simulateInteract(player: any, entity: any): boolean {
    try {
      this.simulateLookAt(player, entity);
      if (typeof player.simulateInteract === 'function') {
        player.simulateInteract();
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  private simulateInteractWithItem(player: any, entity: any, itemName: string): boolean {
    try {
      const inventory = player.getInventory();
      if (!inventory) return false;

      const size = inventory.size ?? 36;
      for (let i = 0; i < size; i++) {
        const item = inventory.getItem(i);
        if (!item || item.isNull()) continue;
        const name = String(item.type || item.name || '').toLowerCase();
        if (name.includes(itemName.toLowerCase())) {
          if (typeof player.setSelectedSlot === 'function') {
            player.setSelectedSlot(i);
          }
          break;
        }
      }

      this.simulateLookAt(player, entity);
      if (typeof player.simulateUseItem === 'function') {
        player.simulateUseItem();
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  private simulateLookAt(player: any, entity: any): void {
    try {
      const target = new FloatPos(entity.pos.x, entity.pos.y + 1, entity.pos.z, entity.pos.dimid ?? 0);
      if (typeof player.simulateLookAt === 'function') {
        player.simulateLookAt(target);
      }
    } catch (e) {
      // ignore
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