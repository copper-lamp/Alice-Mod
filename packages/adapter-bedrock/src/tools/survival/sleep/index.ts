/**
 * 工具：sleep
 *
 * 让假人睡觉或起床。通过 action 参数区分 sleep 和 wake。
 * sleep 模式需要指定床的位置，wake 模式无需参数。
 */

import type { IToolModule, ToolMetadata, ToolContext, ResultEnvelope } from '../../../registry/tool-module.types.js';
import { SurvivalEngine } from '../../../ai/survival/SurvivalEngine.js';
import { InventoryEngine } from '../../../ai/inventory/InventoryEngine.js';

export default class SleepTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'sleep',
      description: '让假人睡觉或起床。action=sleep 需要指定床的位置，action=wake 无需参数。',
      category: 'survival',
      input_schema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['sleep', 'wake'],
            description: '操作类型：sleep 睡觉，wake 起床',
          },
          bed_pos: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
            },
            description: '床的位置坐标（sleep 模式必填）',
          },
          wait_seconds: {
            type: 'number',
            description: '等待时间（秒），超过此时间未入睡则返回失败，不填则无限等待',
            default: 30,
          },
          bot_name: {
            type: 'string',
            description: '假人名称（多假人时必须指定）',
          },
        },
        required: ['action'],
      },
      output_schema: {
        type: 'object',
        properties: {
          bedPosition: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
            },
          },
          timeSkipped: { type: 'boolean' },
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
      const { action, bed_pos, wait_seconds = 30, bot_name } = params;

      if (action !== 'sleep' && action !== 'wake') {
        return {
          success: false,
          error: { code: 'INVALID_PARAMS', message: `不支持的操作: ${action}，可选: sleep, wake` },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      if (action === 'sleep' && !bed_pos) {
        return {
          success: false,
          error: { code: 'INVALID_PARAMS', message: 'sleep 模式需要指定 bed_pos' },
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

      const inventoryEngine = new InventoryEngine(player as any, botName);
      const engine = new SurvivalEngine({ player, botName, inventoryEngine, world: ctx.world });

      if (action === 'wake') {
        const result = await engine.sleep('wake');
        return {
          success: true,
          data: {},
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      // sleep 模式
      const bedPosition = { x: Number(bed_pos.x), y: Number(bed_pos.y), z: Number(bed_pos.z) };
      const result = await engine.sleep('sleep', bedPosition, wait_seconds * 1000);

      if (!result.success) {
        let errorCode: string = 'NOT_NIGHT';
        if (result.error?.includes('怪物')) errorCode = 'MONSTERS_NEARBY';
        else if (result.error?.includes('占用')) errorCode = 'BED_OCCUPIED';
        else if (result.error?.includes('不')) errorCode = 'NOT_NIGHT';

        return {
          success: false,
          error: { code: errorCode as any, message: result.error || '无法入睡' },
          data: { bedPosition, timeSkipped: false },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      return {
        success: true,
        data: { bedPosition, timeSkipped: true },
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