/**
 * 工具：eat
 *
 * 让假人自动从背包中寻找食物并进食。
 * 执行AI会自动处理进食动画和等待。
 */

import type { IToolModule, ToolMetadata, ToolContext, ResultEnvelope } from '../../../registry/tool-module.types.js';
import { SurvivalEngine } from '../../../ai/survival/SurvivalEngine.js';

export default class EatTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'eat',
      description: '让假人自动从背包中寻找食物并进食。执行AI会自动处理进食动画和等待。',
      category: 'survival',
      input_schema: {
        type: 'object',
        properties: {
          food_name: {
            type: 'string',
            description: '要吃的食物名称，不填则自动选择背包中合适的食物',
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
          foodUsed: { type: 'string' },
          hungerRestored: { type: 'number' },
          saturationRestored: { type: 'number' },
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
      const { food_name, bot_name } = params;
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

      const engine = new SurvivalEngine(player, botName);
      const result = engine.eat(food_name);

      if (!result.success) {
        return {
          success: false,
          error: {
            code: result.reason?.includes('不饿') ? 'NOT_HUNGRY' : 'NO_FOOD',
            message: result.reason || '进食失败',
          },
          data: {
            foodUsed: result.foodUsed ?? undefined,
            hungerRestored: result.hungerRestored ?? 0,
            saturationRestored: result.saturationRestored ?? 0,
          },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      return {
        success: true,
        data: {
          foodUsed: result.foodUsed ?? '',
          hungerRestored: result.hungerRestored ?? 0,
          saturationRestored: result.saturationRestored ?? 0,
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