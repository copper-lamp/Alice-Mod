/**
 * 工具：ride
 *
 * 骑乘指定实体（如马、猪、船、矿车等）。
 * 执行AI会自动移动到实体附近并骑乘。
 */

import type { IToolModule, ToolMetadata, ToolContext, ResultEnvelope } from '../../../registry/tool-module.types.js';

export default class RideTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'ride',
      description: '骑乘指定实体（如马、猪、船、矿车等）。执行AI会自动移动到实体附近。',
      category: 'movement',
      input_schema: {
        type: 'object',
        properties: {
          entity_id: {
            type: 'string',
            description: '要骑乘的实体 ID',
          },
          bot_name: {
            type: 'string',
            description: '假人名称（多假人时必须指定）',
          },
        },
        required: ['entity_id'],
      },
      output_schema: {
        type: 'object',
        properties: {
          isRiding: { type: 'boolean' },
          mountType: { type: 'string' },
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
      const { entity_id, bot_name } = params;

      if (!entity_id) {
        return {
          success: false,
          error: { code: 'INVALID_PARAMS', message: '缺少必要参数: entity_id' },
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

      // 获取实体
      // @ts-expect-error — LLSE mc 类型声明中无 getEntity，但运行时可用
      const entity = mc.getEntity(entity_id);
      if (!entity) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: `实体未找到: ${entity_id}` },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      // 检查实体是否可骑乘
      const entityType = String(entity.type || entity.name || '').toLowerCase();
      const rideable = ['horse', 'donkey', 'mule', 'pig', 'boat', 'minecart', 'strider', 'skeleton_horse', 'zombie_horse'];
      if (!rideable.some((t) => entityType.includes(t))) {
        return {
          success: false,
          error: { code: 'NOT_RIDEABLE', message: `实体不可骑乘: ${entityType}` },
          data: { isRiding: false, mountType: entityType },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      // 靠近实体
      const dx = entity.pos.x - player.pos.x;
      const dy = entity.pos.y - player.pos.y;
      const dz = entity.pos.z - player.pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > 3) {
        const { aiEngine } = await import('../../../ai/index.js');
        const moveResult = await aiEngine.moveTo(botName, {
          x: entity.pos.x,
          y: entity.pos.y,
          z: entity.pos.z,
        }, { timeout: 10000 });
        if (!moveResult.success) {
          return {
            success: false,
            error: { code: 'NO_PATH', message: `无法靠近实体: ${moveResult.reason}` },
            meta: { duration: ctx.getElapsedMs() },
          };
        }
      }

      // 骑乘
      try {
        if (typeof player.simulateInteract === 'function') {
          player.simulateInteract();
        }
      } catch (e) {
        // ignore
      }

      return {
        success: true,
        data: { isRiding: true, mountType: entityType },
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