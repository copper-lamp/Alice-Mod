/**
 * 工具：mine_block
 *
 * 挖掘指定坐标的方块，自动选择最合适的工具。
 */

import type { IToolModule, ToolMetadata, ToolContext, ToolResult } from '../../../registry/tool-module.types.js';
import { BlockOperationEngine } from '../../../ai/block/BlockOperationEngine.js';
import { InventoryEngine } from '../../../ai/inventory/InventoryEngine.js';

export default class MineBlockTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'mine_block',
      description: '挖掘指定坐标的方块，自动选择最合适的工具',
      category: 'block',
      input_schema: {
        type: 'object',
        properties: {
          x: { type: 'number', description: '方块 X 坐标' },
          y: { type: 'number', description: '方块 Y 坐标' },
          z: { type: 'number', description: '方块 Z 坐标' },
          bot_name: {
            type: 'string',
            description: '假人名称（多假人时必须指定）',
          },
        },
        required: ['x', 'y', 'z'],
      },
      output_schema: {
        type: 'object',
        properties: {
          block: { type: 'string', description: '挖掘的方块类型' },
          drops: { type: 'array', description: '掉落物列表' },
          tool_damage: { type: 'number', description: '工具耐久消耗' },
          duration_ms: { type: 'number', description: '挖掘耗时' },
        },
      },
      execution: {
        timeout_default_ms: 15000,
        timeout_max_ms: 60000,
        is_movement: true,
        is_async: true,
      },
    };
  }

  async execute(params: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    try {
      const { x, y, z, bot_name } = params;
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

      const result = await engine.mineBlock({ x: Number(x), y: Number(y), z: Number(z) });

      return {
        success: result.success,
        data: {
          block: result.block,
          drops: result.drops,
          tool_damage: result.tool_damage,
          duration_ms: result.duration_ms,
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
