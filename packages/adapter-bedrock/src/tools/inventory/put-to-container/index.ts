/**
 * 工具：put_to_container
 *
 * 将背包中的物品放入容器（箱子、熔炉、桶等）。
 * 执行AI会自动移动到容器附近。
 */

import type { IToolModule, ToolMetadata, ToolContext, ResultEnvelope } from '../../../registry/tool-module.types.js';
import { ContainerAPI } from '../../../ai/inventory/ContainerAPI.js';

export default class PutToContainerTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'put_to_container',
      description: '将背包中的物品放入容器（箱子、熔炉、桶等）。执行AI会自动移动到容器附近。',
      category: 'inventory',
      input_schema: {
        type: 'object',
        properties: {
          x: { type: 'number', description: '容器方块 X 坐标' },
          y: { type: 'number', description: '容器方块 Y 坐标' },
          z: { type: 'number', description: '容器方块 Z 坐标' },
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
        required: ['x', 'y', 'z'],
      },
      output_schema: {
        type: 'object',
        properties: {
          putCount: { type: 'number' },
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
        const moveResult = await aiEngine.moveTo(botName, blockPos, { distance: 2.5, timeout: 15000 });
        if (!moveResult.success) {
          return {
            success: false,
            error: { code: 'NO_PATH', message: `无法移动到容器附近: ${moveResult.reason}` },
            meta: { duration: ctx.getElapsedMs() },
          };
        }
      }

      containerAPI = new ContainerAPI(player, botName);
      const opened = containerAPI.open(blockPos);
      if (!opened) {
        return {
          success: false,
          error: { code: 'CONTAINER_NOT_FOUND', message: `无法打开容器: ${blockPos.x}, ${blockPos.y}, ${blockPos.z}` },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      const result = containerAPI.put(item_name, count);
      containerAPI.close();

      if (result.count <= 0) {
        return {
          success: false,
          error: {
            code: 'ITEM_NOT_FOUND',
            message: item_name ? `背包中未找到物品: ${item_name}` : '背包中没有可放入的物品',
          },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      return {
        success: true,
        data: { putCount: result.count },
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