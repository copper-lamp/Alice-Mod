/**
 * 工具：area_operation
 *
 * 对指定区域进行批量方块操作，支持 clear（清空）、fill（填充）、replace（替换）三种模式。
 * 不使用 /fill 等服务端指令，而是拆解为逐格 mineBlock / placeBlock 执行。
 */

import type { IToolModule, ToolMetadata, ToolContext, ResultEnvelope } from '../../../registry/tool-module.types.js';
import { BlockOperationEngine } from '../../../ai/block/BlockOperationEngine.js';
import { InventoryEngine } from '../../../ai/inventory/InventoryEngine.js';
import type { AreaMode } from '../../../ai/block/index.js';
import type { Vec3 } from '../../../ai/pathfinding/types.js';

export default class AreaOperationTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'area_operation',
      description: '对指定区域进行批量方块操作，支持 clear（清空）、fill（填充）、replace（替换）三种模式。不使用 /fill 指令，逐格执行。',
      category: 'block',
      input_schema: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['clear', 'fill', 'replace'],
            description: '操作模式：clear-清空区域, fill-填充方块, replace-替换方块',
          },
          from: {
            type: 'object',
            description: '区域起点坐标',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
            },
            required: ['x', 'y', 'z'],
          },
          to: {
            type: 'object',
            description: '区域终点坐标',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
            },
            required: ['x', 'y', 'z'],
          },
          block_name: {
            type: 'string',
            description: '方块名称（fill/replace 模式需要）',
          },
          radius: {
            type: 'number',
            description: '搜索半径（replace 模式按区域匹配时使用）',
          },
          bot_name: {
            type: 'string',
            description: '假人名称（多假人时必须指定）',
          },
        },
        required: ['mode', 'from', 'to'],
      },
      output_schema: {
        type: 'object',
        properties: {
          mode: { type: 'string' },
          affectedBlocks: { type: 'number' },
          from: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } },
          to: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } },
          blockName: { type: 'string' },
        },
      },
      execution: {
        timeout_default_ms: 60000,
        timeout_max_ms: 300000,
        is_movement: true,
        is_async: true,
      },
    };
  }

  async execute(params: Record<string, any>, ctx: ToolContext): Promise<ResultEnvelope> {
    try {
      const { mode, from, to, block_name, radius, bot_name } = params;
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
      const engine = new BlockOperationEngine({
        player,
        botName,
        inventoryEngine,
        world: ctx.world,
      });

      const fromPos: Vec3 = { x: Number(from.x), y: Number(from.y), z: Number(from.z) };
      const toPos = to ? { x: Number(to.x), y: Number(to.y), z: Number(to.z) } : undefined;

      const result = await engine.areaOperation(mode as AreaMode, fromPos, toPos, block_name, radius);

      return {
        success: result.success,
        data: {
          mode: result.mode,
          affectedBlocks: result.success_count ?? 0,
          from: fromPos,
          to: toPos ?? fromPos,
          blockName: block_name ?? undefined,
        },
        error: result.success ? undefined : {
          code: 'TOO_LARGE',
          message: result.error || '区域操作失败',
        },
        meta: { duration: result.duration_ms ?? ctx.getElapsedMs() },
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