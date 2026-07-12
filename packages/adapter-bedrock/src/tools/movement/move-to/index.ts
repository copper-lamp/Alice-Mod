/**
 * 移动工具 move_to
 *
 * 移动到目标位置（坐标/实体/方块），执行 AI 自动处理寻路、避障、状态切换。
 */

import type { IToolModule, ToolMetadata, ToolContext, ToolResult } from '../../../registry/tool-module.types.js';
import { aiEngine } from '../../../ai/index.js';
import type { Vec3 } from '../../../ai/pathfinding/types.js';

export default class MoveToTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'move_to',
      description: '移动到目标位置（支持坐标、实体、方块目标，执行AI负责寻路和避障）',
      category: 'movement',
      input_schema: {
        type: 'object',
        properties: {
          target: {
            type: 'object',
            description: '目标位置或实体',
          },
          target_type: {
            type: 'string',
            enum: ['coordinate', 'entity', 'block'],
            description: '目标类型',
          },
          distance: {
            type: 'number',
            default: 2,
            description: '目标距离（默认2格，仅entity/block有效）',
          },
          sprint: {
            type: 'boolean',
            default: false,
            description: '是否疾跑（已废弃，由执行AI自动判断）',
          },
          bot_name: {
            type: 'string',
            description: '假人名称（多假人时必须指定）',
          },
          options: {
            type: 'object',
            properties: {
              timeout: { type: 'number', description: '超时时间（毫秒）' },
              avoidHostile: { type: 'boolean', description: '避开敌对生物' },
              allowSprint: { type: 'boolean', description: '允许疾跑' },
              allowBreak: { type: 'boolean', description: '允许破坏方块' },
              allowPlace: { type: 'boolean', description: '允许放置方块' },
              allowSwim: { type: 'boolean', description: '允许游泳' },
              allowElytra: { type: 'boolean', description: '允许使用鞘翅' },
              maxBlocksToBreak: { type: 'number', description: '最多破坏方块数' },
              maxBlocksToPlace: { type: 'number', description: '最多放置方块数' },
              preferredBlock: { type: 'string', description: '优先放置方块' },
              maxRange: { type: 'number', description: '最大寻路范围' },
            },
          },
        },
        required: ['target', 'target_type'],
      },
      output_schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          finalPosition: { type: 'object' },
          distance: { type: 'number' },
          duration: { type: 'number' },
          hungerCost: { type: 'number' },
          reason: { type: 'string' },
        },
      },
      execution: {
        timeout_default_ms: 60000,
        timeout_max_ms: 120000,
        is_movement: true,
        is_async: true,
      },
    };
  }

  async execute(params: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    try {
      const { target, target_type, distance = 2, bot_name, options = {} } = params;

      let targetPos: Vec3;
      const playerPos = ctx.player.getPosition();

      if (target_type === 'coordinate') {
        targetPos = { x: Number(target.x), y: Number(target.y), z: Number(target.z) };
      } else if (target_type === 'block') {
        const blockPos: Vec3 = { x: Number(target.x), y: Number(target.y), z: Number(target.z) };
        targetPos = this.applyDistance(blockPos, playerPos, distance);
      } else if (target_type === 'entity') {
        // @ts-expect-error — LLSE mc 类型声明中无 getEntity，但运行时可用
        const entity = mc.getEntity(target.entity_id);
        if (!entity) {
          return {
            success: false,
            error: `实体未找到: ${target.entity_id}`,
            duration_ms: ctx.getElapsedMs(),
          };
        }
        const entityPos: Vec3 = { x: entity.pos.x, y: entity.pos.y, z: entity.pos.z };
        targetPos = this.applyDistance(entityPos, playerPos, distance);
      } else {
        return {
          success: false,
          error: `不支持的 target_type: ${target_type}`,
          duration_ms: ctx.getElapsedMs(),
        };
      }

      const result = await aiEngine.moveTo(bot_name, targetPos, {
        ...options,
        timeout: options.timeout ?? 60000,
      });

      return {
        success: result.success,
        data: {
          finalPosition: result.finalPos,
          finalDistance: distance,
          distance: result.distanceMoved,
          duration: result.durationMs,
          hungerCost: result.hungerCost,
          reason: result.reason,
        },
        error: result.success ? undefined : result.reason,
        duration_ms: result.durationMs,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        duration_ms: ctx.getElapsedMs(),
      };
    }
  }

  /**
   * 在目标与玩家之间保留指定距离
   */
  private applyDistance(target: Vec3, playerPos: { x: number; y: number; z: number }, distance: number): Vec3 {
    if (distance <= 0) return target;

    const dx = playerPos.x - target.x;
    const dy = playerPos.y - target.y;
    const dz = playerPos.z - target.z;
    const horizontal = Math.sqrt(dx * dx + dz * dz);

    if (horizontal <= distance) {
      // 已在距离内，直接停在当前目标点
      return target;
    }

    const ratio = distance / horizontal;
    return {
      x: target.x + dx * ratio,
      y: target.y + dy * ratio,
      z: target.z + dz * ratio,
    };
  }
}
