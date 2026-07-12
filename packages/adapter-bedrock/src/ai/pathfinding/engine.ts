/**
 * 寻路引擎
 *
 * 协调缓存、路由器、地面规划器、条件策略，返回最终路径。
 */

import type {
  Vec3,
  PathContext,
  PathResult,
  Path,
  IPathfindingEngine,
  IGroundPathPlanner,
  IFlightSegmentPlanner,
  IBlockInteractionPlanner,
  BoundingBox,
  MoveSegment,
} from './types.js';
import { PathCache } from './cache.js';
import { groundPathPlanner } from './ground-planner.js';
import { flightSegmentPlanner } from './flight-planner.js';
import { blockInteractionPlanner } from './block-interaction-planner.js';
import { movementRouter } from './router.js';
import { movementConfig } from '../movement/config.js';
import {
  AvoidHostileCondition,
  AvoidLavaCondition,
  HungerAwareCondition,
  FallDamageCondition,
} from './conditions/index.js';

export class PathfindingEngine implements IPathfindingEngine {
  private cache: PathCache;
  private planner: IGroundPathPlanner;
  private flightPlanner: IFlightSegmentPlanner;
  private blockInteractionPlanner: IBlockInteractionPlanner;
  private conditions = [
    new AvoidHostileCondition(),
    new AvoidLavaCondition(),
    new HungerAwareCondition(),
    new FallDamageCondition(),
  ];

  constructor(options: {
    cacheSize?: number;
    planner?: IGroundPathPlanner;
    flightPlanner?: IFlightSegmentPlanner;
    blockInteractionPlanner?: IBlockInteractionPlanner;
  } = {}) {
    this.cache = new PathCache(options.cacheSize ?? 256);
    this.planner = options.planner ?? groundPathPlanner;
    this.flightPlanner = options.flightPlanner ?? flightSegmentPlanner;
    this.blockInteractionPlanner = options.blockInteractionPlanner ?? blockInteractionPlanner;
  }

  async findPath(from: Vec3, to: Vec3, ctx: PathContext): Promise<PathResult> {
    const startTime = Date.now();

    // 1. 快速失败
    const distance = this.distance(from, to);
    if (distance > ctx.options.maxRange) {
      return {
        success: false,
        reason: 'too_far',
        nodeCount: 0,
        durationMs: Date.now() - startTime,
      };
    }

    // 2. 缓存命中
    const cached = this.cache.get(from, to, ctx.playerDimid);
    if (cached) {
      const validated = this.validatePath(cached, ctx);
      if (validated) {
        return {
          success: true,
          path: cached,
          nodeCount: cached.segments.reduce((sum, s) => sum + s.waypoints.length, 0),
          durationMs: Date.now() - startTime,
        };
      }
      this.cache.invalidate();
    }

    // 3. 选择主导模式
    const mode = movementRouter.selectMode(from, to, ctx);

    let result: PathResult;

    if (mode === 'elytra') {
      // 鞘翅场景：生成起飞-滑翔-降落段
      result = await this.planElytraPath(from, to, ctx);
    } else {
      // 地面/水域：调用地面规划器
      result = await this.planner.findPath(from, to, ctx);

      // 死路且允许方块交互时，尝试生成挖/搭方案
      if (!result.success && (ctx.options.allowBreak || ctx.options.allowPlace)) {
        result = await this.tryBlockInteractionPath(from, to, ctx);
      }
    }

    // 4. 条件策略校验（规划层）
    if (result.success && result.path) {
      const path = result.path;
      const check = this.checkConditions(path, ctx);
      if (!check.pass) {
        return {
          success: false,
          reason: 'no_path',
          nodeCount: 0,
          durationMs: Date.now() - startTime,
        };
      }

      // 写入缓存
      this.cache.put(from, to, ctx.playerDimid, path);
    }

    return {
      ...result,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * 规划鞘翅路径：起飞点地面段 + 滑翔段 + 降落点地面段
   */
  private async planElytraPath(from: Vec3, to: Vec3, ctx: PathContext): Promise<PathResult> {
    const flightSegment = await this.flightPlanner.planSegment(from, to, ctx);
    if (!flightSegment) {
      return await this.planner.findPath(from, to, ctx);
    }

    const takeoff = flightSegment.waypoints[0];
    const landing = flightSegment.waypoints[flightSegment.waypoints.length - 1];

    const toTakeoff = await this.planner.findPath(from, takeoff, ctx);
    const fromLanding = await this.planner.findPath(landing, to, ctx);

    const segments: MoveSegment[] = [];
    if (toTakeoff.success && toTakeoff.path) {
      segments.push(...toTakeoff.path.segments);
    }
    segments.push(flightSegment);
    if (fromLanding.success && fromLanding.path) {
      segments.push(...fromLanding.path.segments);
    }

    const totalDistance = segments.reduce((sum, s) => {
      let d = 0;
      for (let i = 1; i < s.waypoints.length; i++) {
        const a = s.waypoints[i - 1];
        const b = s.waypoints[i];
        d += Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
      }
      return sum + d;
    }, 0);

    return {
      success: true,
      path: {
        segments,
        totalCost: segments.reduce((sum, s) => sum + s.estimatedCost, 0),
        totalDistance,
        isPartial: false,
      },
      nodeCount: segments.reduce((sum, s) => sum + s.waypoints.length, 0),
      durationMs: 0,
    };
  }

  /**
   * 尝试方块交互路径：在原路径基础上附加 blockActions
   */
  private async tryBlockInteractionPath(from: Vec3, to: Vec3, ctx: PathContext): Promise<PathResult> {
    const biOptions = movementConfig.getBlockInteractionOptions(ctx.options);
    const actions = this.blockInteractionPlanner.generateActions(
      from,
      to,
      {
        getBlock: (x, y, z) => {
          try {
            return mc.getBlock(x, y, z, ctx.playerDimid);
          } catch (e) { return null; }
        },
        getTime: () => 0,
        getWeather: () => 'clear',
        getEntities: () => [],
        getOnlinePlayers: () => [],
      },
      biOptions,
      ctx.playerDimid,
    );

    if (actions.length === 0) {
      return { success: false, reason: 'no_path', nodeCount: 0, durationMs: 0 };
    }

    // 把 actions 附加到一个 break_block / place_block segment 中
    const breakActions = actions.filter((a) => a.type === 'break');
    const placeActions = actions.filter((a) => a.type === 'place');
    const segments: MoveSegment[] = [];

    if (breakActions.length > 0) {
      segments.push({
        mode: 'break_block',
        waypoints: [from],
        estimatedCost: breakActions.reduce((sum, a) => sum + a.estimatedTimeMs, 0),
        blockActions: breakActions,
      });
    }
    if (placeActions.length > 0) {
      segments.push({
        mode: 'place_block',
        waypoints: [from],
        estimatedCost: placeActions.reduce((sum, a) => sum + a.estimatedTimeMs, 0),
        blockActions: placeActions,
      });
    }

    // 然后继续地面规划到目标
    const after = await this.planner.findPath(from, to, ctx);
    if (after.success && after.path) {
      segments.push(...after.path.segments);
    }

    return {
      success: true,
      path: {
        segments,
        totalCost: segments.reduce((sum, s) => sum + s.estimatedCost, 0),
        totalDistance: this.distance(from, to),
        isPartial: false,
      },
      nodeCount: segments.reduce((sum, s) => sum + s.waypoints.length, 0),
      durationMs: 0,
    };
  }

  /**
   * 按区域失效缓存
   */
  invalidateCache(region?: BoundingBox): void {
    this.cache.invalidate(region);
  }

  /**
   * 校验缓存路径是否仍满足条件
   */
  private validatePath(path: Path, ctx: PathContext): boolean {
    const check = this.checkConditions(path, ctx);
    return check.pass;
  }

  /**
   * 检查路径上所有点是否满足条件策略
   */
  private checkConditions(path: Path, ctx: PathContext): { pass: boolean; reason?: string } {
    for (const segment of path.segments) {
      for (const point of segment.waypoints) {
        for (const condition of this.conditions) {
          const evalResult = condition.evaluate(ctx, point);
          if (!evalResult.pass) {
            return { pass: false, reason: evalResult.reason };
          }
        }
      }
    }
    return { pass: true };
  }

  private distance(a: Vec3, b: Vec3): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}

export const pathfindingEngine = new PathfindingEngine();
