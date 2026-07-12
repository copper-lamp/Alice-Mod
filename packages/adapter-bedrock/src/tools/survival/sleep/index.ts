/**
 * 生存工具 sleep
 *
 * 让假人睡觉或起床，可指定床的位置和等待时间。
 */

import type { IToolModule, ToolMetadata, ToolContext, ToolResult } from '../../../registry/tool-module.types.js';
import { SurvivalEngine } from '../../../ai/survival/index.js';
import { InventoryEngine } from '../../../ai/inventory/index.js';
import type { Vec3 } from '../../../ai/pathfinding/types.js';

export default class SleepTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'sleep',
      description: '让假人睡觉或起床，可指定床的位置和等待时间',
      category: 'survival',
      input_schema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: '操作类型',
            enum: ['sleep', 'wake'],
          },
          bed_pos: {
            type: 'object',
            description: '床的位置（不指定则自动搜索附近床）',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
            },
          },
          wait_seconds: {
            type: 'number',
            description: '等待天亮后自动起床的秒数，0 表示等到天亮',
            default: 0,
          },
        },
        required: ['action'],
      },
      output_schema: {
        type: 'object',
        properties: {
          slept_duration: { type: 'number', description: '睡眠持续毫秒数' },
          time_when_wake: { type: 'number', description: '起床时的游戏刻时间' },
        },
      },
      execution: {
        timeout_default_ms: 30000,
        timeout_max_ms: 120000,
        is_movement: true,
        is_async: false,
      },
    };
  }

  async execute(params: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    try {
      const resolved = this.resolveBot(ctx, params);
      if (!resolved) {
        return {
          success: false,
          error: 'BOT_NOT_FOUND',
          duration_ms: ctx.getElapsedMs(),
        };
      }

      const { player, botName } = resolved;
      const inventoryEngine = new InventoryEngine(player, botName);
      const engine = new SurvivalEngine({
        player,
        botName,
        inventoryEngine,
        world: ctx.world,
      });

      const bedPos: Vec3 | undefined = params.bed_pos
        ? {
            x: Number(params.bed_pos.x),
            y: Number(params.bed_pos.y),
            z: Number(params.bed_pos.z),
          }
        : undefined;
      const maxWaitMs = params.wait_seconds ? params.wait_seconds * 1000 : undefined;

      const result = await engine.sleep(params.action, bedPos, maxWaitMs);

      return {
        success: result.success,
        data: result.success
          ? {
              slept_duration: result.sleptDuration,
              time_when_wake: result.timeWhenWake,
            }
          : undefined,
        error: result.error,
        duration_ms: ctx.getElapsedMs(),
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        duration_ms: ctx.getElapsedMs(),
      };
    }
  }

  private resolveBot(
    ctx: ToolContext,
    params: Record<string, any>,
  ): { player: any; botName: string } | null {
    if (params.bot_name) {
      const player = ctx.bot.getBotPlayer(params.bot_name);
      if (!player) return null;
      return { player, botName: params.bot_name };
    }

    const activeBot = ctx.bot.getActiveBot();
    if (!activeBot) return null;

    const player = typeof activeBot.getPlayer === 'function' ? activeBot.getPlayer() : activeBot;
    const botName = activeBot.name || 'default';
    if (!player) return null;

    return { player, botName };
  }
}
