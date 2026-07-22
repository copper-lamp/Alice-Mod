/**
 * 工具：take_from_container
 *
 * 从容器（箱子、熔炉、桶等）中取出物品到背包。
 * 执行AI会自动移动到容器附近。
 */

import type { IToolModule, ToolMetadata, ToolContext, ResultEnvelope } from '../../../registry/tool-module.types.js';
import { ContainerAPI } from '../../../ai/inventory/ContainerAPI.js';

export default class TakeFromContainerTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'take_from_container',
      description: '从容器（箱子、熔炉、桶等）中取出物品到背包。执行AI会自动移动到容器附近。',
      category: 'inventory',
      input_schema: {
        type: 'object',
        properties: {
          x: { type: 'number', description: '容器方块 X 坐标' },
          y: { type: 'number', description: '容器方块 Y 坐标' },
          z: { type: 'number', description: '容器方块 Z 坐标' },
          item_name: {
            type: 'string',
            description: '要取出的物品名称，不填则取出容器内所有物品',
          },
          count: {
            type: 'number',
            description: '取出数量，不填则取出所有匹配物品',
          },
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
          takenCount: { type: 'number' },
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
    let containerAPI: ContainerAPI | null = null;

    try {
      const { x, y, z, item_name, count, bot_name } = params;
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

      const blockPos = { x: Number(x), y: Number(y), z: Number(z) };

      // 确保在容器附近
      const px = player.pos?.x ?? 0;
      const py = player.pos?.y ?? 0;
      const pz = player.pos?.z ?? 0;
      const dist = Math.sqrt((px - blockPos.x) ** 2 + (py - blockPos.y) ** 2 + (pz - blockPos.z) ** 2);
      if (dist > 5) {
        const { aiEngine } = await import('../../../ai/index.js');
        const moveResult = await aiEngine.moveTo(botName, blockPos, { timeout: 15000 });
        if (!moveResult.success) {
          return {
            success: false,
            error: { code: 'NO_PATH', message: `无法移动到容器附近: ${moveResult.reason}` },
            meta: { duration: ctx.getElapsedMs() },
          };
        }
      }

      containerAPI = new ContainerAPI(player);
      const block = ctx.world.getBlock(blockPos.x, blockPos.y, blockPos.z);
      if (!block) {
        return {
          success: false,
          error: { code: 'CONTAINER_NOT_FOUND', message: `无法找到容器方块: ${blockPos.x}, ${blockPos.y}, ${blockPos.z}` },
          meta: { duration: ctx.getElapsedMs() },
        };
      }
      const opened = containerAPI.open(block);
      if (!opened) {
        return {
          success: false,
          error: { code: 'CONTAINER_NOT_FOUND', message: `无法打开容器: ${blockPos.x}, ${blockPos.y}, ${blockPos.z}` },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      const result = containerAPI.take(item_name, count);
      containerAPI.close();

      if ((result.transferred ?? 0) <= 0) {
        return {
          success: false,
          error: {
            code: 'ITEM_NOT_FOUND',
            message: item_name ? `容器中未找到物品: ${item_name}` : '容器为空',
          },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      return {
        success: true,
        data: { takenCount: result.transferred },
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