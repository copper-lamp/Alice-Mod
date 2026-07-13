/**
 * 工具：stop_combat
 *
 * 停止当前战斗行为，切换回被动模式。
 */

import type { IToolModule, ToolMetadata, ToolContext, ResultEnvelope } from '../../../registry/tool-module.types.js';

export default class StopCombatTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'stop_combat',
      description: '停止当前战斗行为，切换回被动模式。',
      category: 'combat',
      input_schema: {
        type: 'object',
        properties: {
          botName: {
            type: 'string',
            description: '假人名称（多假人时必须指定）',
          },
        },
      },
      execution: {
        timeout_default_ms: 5000,
        timeout_max_ms: 10000,
        is_movement: false,
        is_async: true,
      },
    };
  }

  async execute(params: Record<string, any>, ctx: ToolContext): Promise<ResultEnvelope> {
    try {
      const { botName } = params;
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

      // 停止移动
      try {
        if (typeof player.simulateStopMoving === 'function') {
          player.simulateStopMoving();
        }
      } catch (e) {
        // ignore
      }

      return {
        success: true,
        data: undefined,
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