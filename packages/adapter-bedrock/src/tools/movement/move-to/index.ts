/**
 * 工具：move_to
 *
 * 移动假人到目标位置，支持坐标、实体、方块三种目标类型。
 * 执行AI自动处理跳跃、攀爬、游泳、潜行等。
 */

import type { IToolModule, ToolMetadata, ToolContext, ResultEnvelope } from '../../../registry/tool-module.types.js';

export default class MoveToTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'move_to',
      description: '移动假人到目标位置，支持坐标(coordinate)、实体(entity)、方块(block)三种目标类型。执行AI自动处理跳跃、攀爬、游泳、潜行等。',
      category: 'movement',
      input_schema: {
        type: 'object',
        properties: {
          target: {
            type: 'object',
            properties: {
              x: { type: 'number', description: '目标 X 坐标' },
              y: { type: 'number', description: '目标 Y 坐标' },
              z: { type: 'number', description: '目标 Z 坐标' },
            },
            required: ['x', 'y', 'z'],
            description: '目标位置坐标或实体引用',
          },
          target_type: {
            type: 'string',
            enum: ['coordinate', 'entity', 'block'],
            description: '目标类型：coordinate-坐标, entity-实体, block-方块',
          },
          distance: {
            type: 'number',
            description: '停止距离（格），即距目标多远时停止移动',
            default: 2.0,
          },
          sprint: {
            type: 'boolean',
            description: '是否疾跑',
            default: false,
          },
          bot_name: {
            type: 'string',
            description: '假人名称（多假人时必须指定）',
          },
        },
        required: ['target', 'target_type'],
      },
      output_schema: {
        type: 'object',
        properties: {
          finalPosition: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
            },
          },
          finalDistance: { type: 'number' },
          distance: { type: 'number' },
          hungerCost: { type: 'number' },
        },
      },
      execution: {
        timeout_default_ms: 30000,
        timeout_max_ms: 120000,
        is_movement: true,
        is_async: true,
      },
    };
  }

  async execute(params: Record<string, any>, ctx: ToolContext): Promise<ResultEnvelope> {
    try {
      const { target, target_type, distance = 2.0, sprint = false, bot_name } = params;

      if (!target || !target_type) {
        return {
          success: false,
          error: { code: 'INVALID_PARAMS', message: '缺少必要参数: target, target_type' },
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

      const { aiEngine } = await import('../../../ai/index.js');
      const result = await aiEngine.moveTo(botName, target, {
        targetType: target_type,
        distance,
        sprint,
        timeout: 60000,
      });

      if (!result.success) {
        return {
          success: false,
          error: {
            code: result.reason?.includes('超时') ? 'TIMEOUT' : 'NO_PATH',
            message: result.reason || '移动失败',
          },
          data: {
            finalPosition: result.finalPosition,
            finalDistance: result.finalDistance,
            distance: result.distance,
          },
          meta: { duration: ctx.getElapsedMs(), cost: { hunger: result.hungerCost ?? 0 } },
        };
      }

      return {
        success: true,
        data: {
          finalPosition: result.finalPosition,
          finalDistance: result.finalDistance,
          distance: result.distance,
          hungerCost: result.hungerCost,
        },
        meta: { duration: ctx.getElapsedMs(), cost: { hunger: result.hungerCost ?? 0 } },
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