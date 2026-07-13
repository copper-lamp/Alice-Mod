/**
 * 地面路径规划器
 *
 * 基于 LLSE 原生 simulateNavigateTo 获取底层路径，
 * 再按地形特征分段为 walk/sprint/swim/climb/sprint_jump。
 */

import type { Vec3, PathContext, PathResult, MoveSegment, MoveMode, IGroundPathPlanner } from './types.js';
import { movementRouter } from './router.js';
import { WALK_SPEED, SPRINT_SPEED, SWIM_SPEED, CLIMB_SPEED } from '../shared/movement-constants.js';

export class GroundPathPlanner implements IGroundPathPlanner {
  async findPath(from: Vec3, to: Vec3, ctx: PathContext): Promise<PathResult> {
    const startTime = Date.now();

    try {
      const pl = ctx.player;
      if (!pl) {
        return {
          success: false,
          reason: 'no_path',
          nodeCount: 0,
          durationMs: Date.now() - startTime,
        };
      }
      // SimulatedPlayer 在某些 LLSE 版本中可能缺少 isOnline，缺失时默认在线
      if (typeof pl.isOnline === 'function' && !pl.isOnline()) {
        return {
          success: false,
          reason: 'no_path',
          nodeCount: 0,
          durationMs: Date.now() - startTime,
        };
      }

      const dimid = ctx.playerDimid;
      const fpTo = new FloatPos(to.x, to.y, to.z, dimid);

      // 调用 LLSE 原生寻路
      const nav = pl.simulateNavigateTo(fpTo);
      if (!nav || !nav.path || nav.path.length === 0) {
        return {
          success: false,
          reason: 'no_path',
          nodeCount: 0,
          durationMs: Date.now() - startTime,
        };
      }

      const waypoints = nav.path.map((p: number[]) => ({ x: p[0], y: p[1], z: p[2] }));
      const smoothed = this.smoothWaypoints(waypoints);
      const segments = this.buildSegments(smoothed, ctx);

      const path = {
        segments,
        totalCost: segments.reduce((sum, s) => sum + s.estimatedCost, 0),
        totalDistance: this.calcDistance(smoothed),
        isPartial: nav.isFullPath === false,
      };

      return {
        success: true,
        path,
        nodeCount: waypoints.length,
        durationMs: Date.now() - startTime,
      };
    } catch (e) {
      logger.warn('[GroundPathPlanner] 寻路异常', e);
      return {
        success: false,
        reason: 'no_path',
        nodeCount: 0,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * 去除共线冗余节点
   */
  private smoothWaypoints(points: Vec3[]): Vec3[] {
    if (points.length <= 2) return points;

    const result: Vec3[] = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const prev = result[result.length - 1];
      const curr = points[i];
      const next = points[i + 1];

      // 如果当前点在 prev->next 直线上，则跳过
      if (this.isCollinear(prev, curr, next)) {
        continue;
      }
      result.push(curr);
    }
    result.push(points[points.length - 1]);
    return result;
  }

  /**
   * 判断三点是否共线
   */
  private isCollinear(a: Vec3, b: Vec3, c: Vec3): boolean {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const acx = c.x - a.x;
    const acy = c.y - a.y;
    const acz = c.z - a.z;

    // 叉积接近 0 则共线
    const crossX = aby * acz - abz * acy;
    const crossY = abz * acx - abx * acz;
    const crossZ = abx * acy - aby * acx;

    const threshold = 0.01;
    return (
      Math.abs(crossX) < threshold &&
      Math.abs(crossY) < threshold &&
      Math.abs(crossZ) < threshold
    );
  }

  /**
   * 将路径点拆分为 MoveSegment
   */
  private buildSegments(points: Vec3[], ctx: PathContext): MoveSegment[] {
    if (points.length === 0) return [];
    if (points.length === 1) {
      return [this.createSegment('walk', points, ctx)];
    }

    const segments: MoveSegment[] = [];
    let currentMode: MoveMode = movementRouter.selectSegmentMode(points[0], points[0], points[1], ctx);
    let currentWaypoints: Vec3[] = [points[0]];

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const next = points[i + 1];
      const mode = movementRouter.selectSegmentMode(prev, curr, next, ctx);

      if (mode === currentMode) {
        currentWaypoints.push(curr);
      } else {
        segments.push(this.createSegment(currentMode, currentWaypoints, ctx));
        currentMode = mode;
        currentWaypoints = [prev, curr];
      }
    }

    if (currentWaypoints.length > 0) {
      segments.push(this.createSegment(currentMode, currentWaypoints, ctx));
    }

    return segments;
  }

  /**
   * 创建单个 Segment
   */
  private createSegment(mode: MoveMode, waypoints: Vec3[], ctx: PathContext): MoveSegment {
    const dist = this.calcDistance(waypoints);
    let speed: number;

    switch (mode) {
      case 'sprint':
      case 'sprint_jump':
        speed = SPRINT_SPEED;
        break;
      case 'swim':
        speed = SWIM_SPEED;
        break;
      case 'climb':
        speed = CLIMB_SPEED;
        break;
      default:
        speed = WALK_SPEED;
    }

    const estimatedTimeMs = (dist / speed) * 1000;
    return {
      mode,
      waypoints,
      estimatedCost: estimatedTimeMs,
    };
  }

  /**
   * 计算路径总长度
   */
  private calcDistance(points: Vec3[]): number {
    let dist = 0;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      const dz = points[i].z - points[i - 1].z;
      dist += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    return dist;
  }
}

export const groundPathPlanner = new GroundPathPlanner();
