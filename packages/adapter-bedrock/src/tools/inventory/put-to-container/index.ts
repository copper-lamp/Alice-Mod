/**
 * 工具：put_to_container
 *
 * 移动到容器旁，将背包物品放入容器。
 */

import type { IToolModule, ToolMetadata, ToolContext, ToolResult } from '../../../registry/tool-module.types.js';
import { aiEngine } from '../../../ai/index.js';
import { ContainerAPI } from '../../../ai/inventory/ContainerAPI.js';
import { BotManager } from '../../../bot/BotManager.js';

export default class PutToContainerTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'put_to_container',
      description: '将背包中的物品放入容器（箱子、熔炉、桶等）。执行AI会自动移动到容器附近。',
      category: 'inventory',
      input_schema: {
        type: 'object',
        properties: {
          container_position: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
            },
            required: ['x', 'y', 'z'],
            description: '容器方块坐标',
          },
          item_name: {
            type: 'string',
            description: '要放入的物品名称，不填则放入背包内所有可放入物品',
          },
          count: {
            type: 'number',
            description: '放入数量，不填则放入所有匹配物品',
          },
          bot_name: {
            type: 'string',
            description: '假人名称（多假人时必须指定）',
          },
        },
        required: ['container_position'],
      },
      output_schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          item: { type: 'string' },
          transferred: { type: 'number' },
          remaining: { type: 'number' },
          reason: { type: 'string' },
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async execute(params: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    let containerAPI: ContainerAPI | null = null;

    try {
      const { container_position, item_name, count, bot_name } = params;
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

      const blockPos = { x: Number(container_position.x), y: Number(container_position.y), z: Number(container_position.z) };
      const block = ctx.world.getBlock(blockPos.x, blockPos.y, blockPos.z);
      if (!block) {
        return {
          success: false,
          error: `找不到目标方块: ${blockPos.x}, ${blockPos.y}, ${blockPos.z}`,
          duration_ms: ctx.getElapsedMs(),
        };
      }

      containerAPI = new ContainerAPI(player);

      // 移动到容器附近
      const approachTarget = containerAPI.computeApproachTarget(blockPos, 2);
      const moveResult = await aiEngine.moveTo(botName, approachTarget, { timeout: 20000 });
      if (!moveResult.success) {
        return {
          success: false,
          error: `移动到容器附近失败: ${moveResult.reason}`,
          duration_ms: ctx.getElapsedMs(),
        };
      }

      // 移动后重新获取方块
      const movedBlock = ctx.world.getBlock(blockPos.x, blockPos.y, blockPos.z);
      if (!movedBlock) {
        return {
          success: false,
          error: '移动后目标方块消失',
          duration_ms: ctx.getElapsedMs(),
        };
      }

      const container = containerAPI.open(movedBlock);
      if (!container) {
        return {
          success: false,
          error: '目标方块不是容器或距离过远',
          duration_ms: ctx.getElapsedMs(),
        };
      }

      const result = containerAPI.put(container, item_name, count);
      containerAPI.close();
      containerAPI = null;

      if (result.success) {
        this.saveInventory(botName);
      }

      return {
        success: result.success,
        data: {
          item: result.item,
          transferred: result.transferred,
          remaining: result.remaining,
          reason: result.success ? 'success' : result.error,
        },
        error: result.success ? undefined : result.error,
        duration_ms: ctx.getElapsedMs(),
      };
    } catch (err) {
      containerAPI?.close();
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
    if (activeBot && activeBot.name && this.isOnline(activeBot)) return activeBot.name;

    const bots = ctx.bot.listBots();
    const online = bots.filter((b) => this.isOnline(b));
    if (online.length === 1) return online[0].name;
    return null;
  }

  private isOnline(bot: { isOnline: boolean | (() => boolean) }): boolean {
    return typeof bot.isOnline === 'function' ? bot.isOnline() : bot.isOnline;
  }

  private saveInventory(botName: string): void {
    try {
      BotManager.saveInventory(botName);
    } catch (e) {
      logger.warn(`[put_to_container] 保存背包失败: ${botName}`, e);
    }
  }
}
