/**
 * 工具：dismount
 *
 * 从当前骑乘的实体上下来。
 */

import type { IToolModule, ToolMetadata, ToolContext, ResultEnvelope } from '../../../registry/tool-module.types.js';

export default class DismountTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'dismount',
      description: '从当前骑乘的实体上下来。',
      category: 'movement',
      input_schema: {
        type: 'object',
        properties: {
          bot_name: {
            type: 'string',
            description: '假人名称（多假人时必须指定）',
          },
        },
      },
      output_schema: {
        type: 'object',
        properties: {
          isRiding: { type: 'boolean' },
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
      const { bot_name } = params;
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

      // 执行下马
      try {
        player.dismount();
      } catch (e) {
        // ignore
      }

      return {
        success: true,
        data: { isRiding: false },
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