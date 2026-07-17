/**
 * 工具：collect_block
 *
 * 自动采集指定数量的方块。
 * 执行AI会自动查找附近方块、移动到目标位置、选择合适工具并挖掘。
 * 支持预算时间控制：超时未采够或方块耗尽时返回警告。
 */

import type { IToolModule, ToolMetadata, ToolContext, ResultEnvelope } from '../../../registry/tool-module.types.js';
import { BlockOperationEngine } from '../../../ai/block/BlockOperationEngine.js';
import { InventoryEngine } from '../../../ai/inventory/InventoryEngine.js';
import { aiEngine } from '../../../ai/index.js';

export default class CollectBlockTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'collect_block',
      description: '自动采集指定数量的方块。执行AI会自动查找附近方块、移动到目标位置、选择合适工具并挖掘。支持预算时间控制和环境修改规则。',
      category: 'block',
      input_schema: {
        type: 'object',
        properties: {
          block_name: {
            type: 'string',
            description: '要采集的方块名称（如 "stone"、"oak_log"），支持模糊匹配',
          },
          count: {
            type: 'number',
            description: '需要采集的数量',
            minimum: 1,
          },
          rules: {
            type: 'object',
            description: '采集规则配置',
            properties: {
              modify_environment: {
                type: 'boolean',
                description: '是否允许修改环境（如垫脚石、挖开障碍物），默认 false',
                default: false,
              },
            },
          },
          budget_time_ms: {
            type: 'number',
            description: '预算时间（毫秒）。超时未采够或方块耗尽时返回警告。不传则不限时',
            minimum: 1000,
          },
          bot_name: {
            type: 'string',
            description: '假人名称（多假人时必须指定）',
          },
        },
        required: ['block_name', 'count'],
      },
      output_schema: {
        type: 'object',
        properties: {
          blockName: { type: 'string' },
          collected: { type: 'number' },
          target: { type: 'number' },
          warning: { type: 'string' },
          positions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                z: { type: 'number' },
              },
            },
          },
        },
      },
      execution: {
        timeout_default_ms: 120000,
        timeout_max_ms: 600000,
        is_movement: true,
        is_async: true,
      },
    };
  }

  async execute(params: Record<string, any>, ctx: ToolContext): Promise<ResultEnvelope> {
    const startTime = Date.now();
    const { block_name, count, rules, budget_time_ms, bot_name } = params;
    const targetCount = Number(count);
    const budgetMs = budget_time_ms ? Number(budget_time_ms) : 0;
    const modifyEnvironment = rules?.modify_environment === true;

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

    const normalizedName = this.normalizeName(block_name);
    let collected = 0;
    const minedPositions: Array<{ x: number; y: number; z: number }> = [];

    try {
      while (collected < targetCount) {
        // 检查预算时间
        if (budgetMs > 0 && Date.now() - startTime > budgetMs) {
          return {
            success: true,
            data: {
              blockName: block_name,
              collected,
              target: targetCount,
              warning: `预算时间耗尽，仅采集到 ${collected}/${targetCount} 个 ${block_name}`,
              positions: minedPositions,
            },
            meta: { duration: ctx.getElapsedMs() },
          };
        }

        // 查找附近方块
        const positions = this.findBlocks(player, normalizedName, 64, ctx);
        if (positions.length === 0) {
          // 没到时间但已经查询不到方块了
          return {
            success: true,
            data: {
              blockName: block_name,
              collected,
              target: targetCount,
              warning: collected > 0
                ? `附近已无 ${block_name}，共采集到 ${collected} 个（目标 ${targetCount} 个）`
                : `附近未找到方块: ${block_name}`,
              positions: minedPositions,
            },
            meta: { duration: ctx.getElapsedMs() },
          };
        }

        // 采集每个找到的方块
        for (const pos of positions) {
          if (collected >= targetCount) break;

          // 再次检查预算时间
          if (budgetMs > 0 && Date.now() - startTime > budgetMs) {
            break;
          }

          // 移动并挖掘
          const result = await engine.mineBlock(pos);

          if (result.success) {
            collected++;
            minedPositions.push(pos);
          } else {
            // 如果方块已不存在（被其他玩家挖了），跳过
            if (result.error === 'BLOCK_NOT_FOUND' || result.block === 'air') {
              continue;
            }
            // 其他错误（工具损坏、不可破坏等）记录日志但继续
            ctx.logger.warn(`[collect_block] 挖掘失败 ${JSON.stringify(pos)}: ${result.error}`);
          }
        }
      }

      // 成功采集到目标数量
      return {
        success: true,
        data: {
          blockName: block_name,
          collected,
          target: targetCount,
          positions: minedPositions,
        },
        meta: { duration: ctx.getElapsedMs() },
      };
    } catch (err) {
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : String(err) },
        data: {
          blockName: block_name,
          collected,
          target: targetCount,
          positions: minedPositions,
        },
        meta: { duration: ctx.getElapsedMs() },
      };
    }
  }

  // ── 方块查找（复用 query_location 的扫描逻辑）──

  private findBlocks(
    player: any,
    blockName: string,
    radius: number,
    _ctx: ToolContext,
  ): Array<{ x: number; y: number; z: number }> {
    const playerPos = { x: player.pos.x, y: player.pos.y, z: player.pos.z };
    const dimid = player.pos?.dimid ?? 0;
    return this.scanBlocks(playerPos, blockName, radius, dimid);
  }

  private scanBlocks(
    center: { x: number; y: number; z: number },
    blockName: string,
    radius: number,
    dimid: number,
  ): Array<{ x: number; y: number; z: number }> {
    const results: Array<{ x: number; y: number; z: number }> = [];
    const maxChecks = 50000;
    let checks = 0;

    const minY = Math.max(Math.floor(center.y) - 16, -64);
    const maxY = Math.min(Math.floor(center.y) + 32, 320);

    for (let r = 0; r <= radius && results.length < 10 && checks < maxChecks; r++) {
      const step = r <= 8 ? 1 : r <= 32 ? 1 : r <= 64 ? 2 : 3;

      for (let dx = -r; dx <= r && results.length < 10 && checks < maxChecks; dx += step) {
        for (let dz = -r; dz <= r && results.length < 10 && checks < maxChecks; dz += step) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;

          const wx = Math.floor(center.x + dx);
          const wz = Math.floor(center.z + dz);
          checks++;

          const surfaceY = this.findSurfaceY(wx, wz, minY, maxY, dimid);
          if (surfaceY === null) continue;

          try {
            const block = mc.getBlock(wx, surfaceY, wz, dimid);
            if (!block) continue;

            const blockType = this.normalizeName(block.type || block.name || '');
            if (this.fuzzyMatch(blockType, blockName)) {
              results.push({ x: wx, y: surfaceY, z: wz });
            }
          } catch (e) {
            // ignore
          }
        }
      }
    }

    // 按距离排序
    results.sort((a, b) => this.distance(center, a) - this.distance(center, b));
    return results.slice(0, 10);
  }

  private findSurfaceY(x: number, z: number, minY: number, maxY: number, dimid: number): number | null {
    for (let y = maxY; y >= minY; y--) {
      try {
        const block = mc.getBlock(x, y, z, dimid);
        if (block && !(block as any).isAir()) return y;
      } catch (e) {
        // ignore
      }
    }
    return null;
  }

  // ── 辅助方法 ──

  private normalizeName(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/^minecraft:/, '')
      .replace(/\s+/g, '_');
  }

  private fuzzyMatch(item: string, search: string): boolean {
    if (item === search) return true;
    return item.replace(/_/g, '') === search.replace(/_/g, '');
  }

  private distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
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