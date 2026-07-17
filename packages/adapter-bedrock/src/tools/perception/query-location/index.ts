/**
 * 工具：query_location
 *
 * 查询附近指定群系（biome）或方块（block）的位置。
 * - 群系查询使用 /locate biome 命令
 * - 方块查询使用螺旋扫描，支持模糊搜索，最多返回 10 个位置
 * - 半径 3 格内的多个匹配位置只保留最靠近地面的一个
 */

import type { IToolModule, ToolMetadata, ToolContext, ResultEnvelope } from '../../../registry/tool-module.types.js';

export default class QueryLocationTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'query_location',
      description: '查询附近指定群系或方块的位置。支持生物群系查找和方块模糊搜索。',
      category: 'perception',
      input_schema: {
        type: 'object',
        properties: {
          query_type: {
            type: 'string',
            enum: ['biome', 'block'],
            description: '查询类别：biome-生物群系, block-方块（支持模糊搜索，如"stone"可匹配"stone"、"stone_bricks"）',
          },
          query_name: {
            type: 'string',
            description: '群系名称或方块名称。方块支持模糊搜索，忽略大小写和下划线差异。',
          },
          radius: {
            type: 'number',
            description: '搜索半径（格），默认 2048',
            default: 2048,
          },
          bot_name: {
            type: 'string',
            description: '假人名称（多假人时必须指定）',
          },
        },
        required: ['query_type', 'query_name'],
      },
      output_schema: {
        type: 'object',
        properties: {
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
          total: { type: 'number' },
          query_type: { type: 'string' },
          query_name: { type: 'string' },
        },
      },
      execution: {
        timeout_default_ms: 30000,
        timeout_max_ms: 120000,
        is_movement: false,
        is_async: true,
      },
    };
  }

  async execute(params: Record<string, any>, ctx: ToolContext): Promise<ResultEnvelope> {
    const { query_type, query_name, radius = 2048, bot_name } = params;

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

    try {
      if (query_type === 'biome') {
        return await this.queryBiome(player, query_name, Number(radius), ctx);
      } else if (query_type === 'block') {
        return await this.queryBlock(player, query_name, Number(radius), ctx);
      } else {
        return {
          success: false,
          error: { code: 'INVALID_PARAMS', message: `不支持的查询类别: ${query_type}，支持 biome 和 block` },
          meta: { duration: ctx.getElapsedMs() },
        };
      }
    } catch (err) {
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : String(err) },
        meta: { duration: ctx.getElapsedMs() },
      };
    }
  }

  // ── 群系查询 ──

  private async queryBiome(
    player: any,
    biomeName: string,
    _radius: number,
    ctx: ToolContext,
  ): Promise<ResultEnvelope> {
    const normalizedName = this.normalizeName(biomeName);

    // 使用 /locate biome 命令
    const cmd = `locate biome ${normalizedName}`;
    const result = this.runCommand(cmd, player);

    if (!result || !result.success) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `未找到群系: ${biomeName}` },
        meta: { duration: ctx.getElapsedMs() },
      };
    }

    // 解析命令输出
    // 格式: "The nearest [biome] is at [x, y, z] (distance: [d] blocks)"
    // 或: "Located biome [biome] at [x, y, z]"
    const output = result.output;
    const posMatch = output.match(/at\s+\[?(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\]?/i);

    if (!posMatch) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `无法解析群系位置: ${biomeName}` },
        meta: { duration: ctx.getElapsedMs() },
      };
    }

    const pos = {
      x: parseInt(posMatch[1], 10),
      y: parseInt(posMatch[2], 10),
      z: parseInt(posMatch[3], 10),
    };

    return {
      success: true,
      data: {
        positions: [pos],
        total: 1,
        query_type: 'biome',
        query_name: biomeName,
      },
      meta: { duration: ctx.getElapsedMs() },
    };
  }

  // ── 方块查询 ──

  private async queryBlock(
    player: any,
    blockName: string,
    radius: number,
    ctx: ToolContext,
  ): Promise<ResultEnvelope> {
    const playerPos = { x: player.pos.x, y: player.pos.y, z: player.pos.z };
    const dimid = player.pos?.dimid ?? 0;
    const normalizedName = this.normalizeName(blockName);

    const positions = this.scanBlocks(playerPos, normalizedName, radius, dimid);

    if (positions.length === 0) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `在半径 ${radius} 格内未找到方块: ${blockName}` },
        meta: { duration: ctx.getElapsedMs() },
      };
    }

    // 按距离排序
    positions.sort((a, b) => this.distance(playerPos, a) - this.distance(playerPos, b));

    return {
      success: true,
      data: {
        positions,
        total: positions.length,
        query_type: 'block',
        query_name: blockName,
      },
      meta: { duration: ctx.getElapsedMs() },
    };
  }

  /**
   * 扫描附近方块。
   * 使用螺旋扫描模式，从玩家位置向外扩展。
   * 自适应步长：近距离细扫，远距离粗扫。
   * 每列只检查地表方块（从最高 Y 向下扫描，找到第一个非空气方块）。
   */
  private scanBlocks(
    center: { x: number; y: number; z: number },
    blockName: string,
    radius: number,
    dimid: number,
  ): Array<{ x: number; y: number; z: number }> {
    const results: Array<{ x: number; y: number; z: number }> = [];
    const maxChecks = 100000;
    let checks = 0;

    const minY = Math.max(Math.floor(center.y) - 16, -64);
    const maxY = Math.min(Math.floor(center.y) + 32, 320);

    for (let r = 0; r <= radius && results.length < 10 && checks < maxChecks; r++) {
      // 自适应步长：近距离密集扫描，远距离稀疏扫描
      const step = r <= 8 ? 1 : r <= 32 ? 1 : r <= 64 ? 2 : r <= 128 ? 3 : r <= 256 ? 4 : r <= 512 ? 6 : 8;

      for (let dx = -r; dx <= r && results.length < 10 && checks < maxChecks; dx += step) {
        for (let dz = -r; dz <= r && results.length < 10 && checks < maxChecks; dz += step) {
          // 只在螺旋边界上扫描
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;

          const wx = Math.floor(center.x + dx);
          const wz = Math.floor(center.z + dz);
          checks++;

          // 从最高 Y 向下扫描，找到第一个非空气方块（地表方块）
          const surfaceY = this.findSurfaceY(wx, wz, minY, maxY, dimid);
          if (surfaceY === null) continue;

          try {
            const block = mc.getBlock(wx, surfaceY, wz, dimid);
            if (!block) continue;

            const blockType = this.normalizeName(block.type || block.name || '');
            if (this.fuzzyMatch(blockType, blockName)) {
              // 检查是否在已有结果 3 格范围内
              if (this.isWithinRadius(results, { x: wx, y: surfaceY, z: wz }, 3)) {
                // 如果在 3 格内，用更靠近地面的替换
                this.replaceWithCloserToGround(results, { x: wx, y: surfaceY, z: wz });
              } else {
                results.push({ x: wx, y: surfaceY, z: wz });
              }
            }
          } catch (e) {
            // 忽略单个方块读取错误
          }
        }
      }
    }

    // 最终去重保证
    return this.deduplicatePositions(results).slice(0, 10);
  }

  /**
   * 查找地表 Y 坐标（从最高 Y 向下扫描，找到第一个非空气方块）
   */
  private findSurfaceY(
    x: number,
    z: number,
    minY: number,
    maxY: number,
    dimid: number,
  ): number | null {
    for (let y = maxY; y >= minY; y--) {
      try {
        const block = mc.getBlock(x, y, z, dimid);
        if (block && !(block as any).isAir()) {
          return y;
        }
      } catch (e) {
        // 忽略单个方块读取错误
      }
    }
    return null;
  }

  /**
   * 检查 pos 是否在现有 positions 中任意一个的 radius 范围内
   */
  private isWithinRadius(
    positions: Array<{ x: number; y: number; z: number }>,
    pos: { x: number; y: number; z: number },
    radius: number,
  ): boolean {
    return positions.some((p) => this.distance(p, pos) <= radius);
  }

  /**
   * 如果 pos 的 y 比已有结果中某个位置更低（更靠近地面），则替换
   */
  private replaceWithCloserToGround(
    positions: Array<{ x: number; y: number; z: number }>,
    pos: { x: number; y: number; z: number },
  ): void {
    for (let i = 0; i < positions.length; i++) {
      if (this.distance(positions[i], pos) <= 3) {
        if (pos.y < positions[i].y) {
          positions[i] = pos;
        }
        return;
      }
    }
  }

  /**
   * 去重位置：3 格内只保留最靠近地面的（y 最小）
   */
  private deduplicatePositions(
    positions: Array<{ x: number; y: number; z: number }>,
  ): Array<{ x: number; y: number; z: number }> {
    const groups: Array<Array<{ x: number; y: number; z: number }>> = [];

    for (const pos of positions) {
      let added = false;
      for (const group of groups) {
        if (this.distance(group[0], pos) <= 3) {
          group.push(pos);
          added = true;
          break;
        }
      }
      if (!added) {
        groups.push([pos]);
      }
    }

    return groups.map((group) => {
      group.sort((a, b) => a.y - b.y);
      return group[0];
    });
  }

  // ── 辅助方法 ──

  private runCommand(cmd: string, player: any): { success: boolean; output: string } | null {
    try {
      if (typeof player.runCmd === 'function') {
        try {
          const ok = player.runCmd(cmd);
          if (ok) return { success: true, output: '' };
        } catch (e) {
          // ignore
        }
      }

      const api = mc as any;
      if (typeof api.runcmdEx === 'function') {
        const res = api.runcmdEx(cmd);
        if (res && res.success) {
          return { success: true, output: res.output || '' };
        }
      }
      if (typeof api.runcmd === 'function') {
        api.runcmd(cmd);
        return { success: true, output: '' };
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

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