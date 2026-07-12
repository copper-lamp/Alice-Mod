/**
 * 工具：area_operation
 *
 * 对指定区域进行批量方块操作，支持填充、清空、破坏和连锁挖掘四种模式。
 * 不使用 /fill 等服务端指令，而是拆解为逐格 mineBlock / placeBlock 执行。
 */

import type { IToolModule, ToolMetadata, ToolContext, ToolResult } from '../../../registry/tool-module.types.js';
import { BlockOperationEngine } from '../../../ai/block/BlockOperationEngine.js';
import { InventoryEngine } from '../../../ai/inventory/InventoryEngine.js';
import type { AreaMode } from '../../../ai/block/index.js';
import type { Vec3 } from '../../../ai/pathfinding/types.js';

export default class AreaOperationTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'area_operation',
      description: '对指定区域进行批量方块操作，支持填充、清空、破坏和连锁挖掘四种模式',
      category: 'block',
      input_schema: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            description: '操作模式',
            enum: ['fill', 'clear', 'break', 'vein'],
          },
          from: {
            type: 'object',
            description: '区域起点坐标',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
            },
          },
          to: {
            type: 'object',
            description: '区域终点坐标（fill/clear/break 模式需要）',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
            },
          },
          block_name: {
            type: 'string',
            description: '方块名称（fill 模式需要）',
          },
          radius: {
            type: 'number',
            description: '搜索半径（vein 模式使用，默认 16）',
            default: 16,
          },
          bot_name: {
            type: 'string',
            description: '假人名称（多假人时必须指定）',
          },
        },
        required: ['mode', 'from'],
      },
      output_schema: {
        type: 'object',
        properties: {
          mode: { type: 'string' },
          total_blocks: { type: 'number', description: '总操作方块数' },
          success_count: { type: 'number' },
          fail_count: { type: 'number' },
          duration_ms: { type: 'number' },
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

  async execute(params: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    try {
      const { mode, from, to, block_name, radius, bot_name } = params;
      const botName = this.resolveBotName(ctx, bot_name);

      if (!botName) {
        return {
          success: false,
          error: '未指定假人名称，且不存在唯一在线假人',
          duration_ms: ctx.getElapsedMs(),
        };
      }

      const player = ctx.bot.getBotPlayer(botName);
      if (!player) {
        return {
          success: false,
          error: `假人不在线: ${botName}`,
          duration_ms: ctx.getElapsedMs(),
        };
      }

      const inventoryEngine = new InventoryEngine(player as Player, botName);
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
          total_blocks: result.total_blocks,
          success_count: result.success_count,
          fail_count: result.fail_count,
          duration_ms: result.duration_ms,
          drops: result.drops,
        },
        error: result.error,
        duration_ms: result.duration_ms ?? ctx.getElapsedMs(),
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        duration_ms: ctx.getElapsedMs(),
      };
    }
  }

  private resolveBotName(ctx: ToolContext, explicitName?: string): string | null {
    if (explicitName) return explicitName;
    const activeBot = ctx.bot.getActiveBot();
    if (activeBot && activeBot.name) return activeBot.name;

    const bots = ctx.bot.listBots();
    const online = bots.filter((b: any) => b.isOnline);
    if (online.length === 1) return online[0].name;
    return null;
  }
}
