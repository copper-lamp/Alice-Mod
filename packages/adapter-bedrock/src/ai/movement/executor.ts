/**
 * 移动执行器
 *
 * 按 Path.segments 驱动假人移动，支持状态切换、条件中断、局部重规划。
 */

import type { Path, PathContext, MoveSegment, Vec3 } from '../pathfinding/types.js';
import type { MoveResult, IMovementExecutor } from './types.js';
import { MovementStateMachine } from './state-machine.js';
import { ActionController } from './action-controller.js';
import { ConditionMonitor } from './condition-monitor.js';
import { BlockInteractionExecutor } from './block-interaction-executor.js';
import { InventoryRequirementChecker } from './inventory-requirement-checker.js';
import { WALK_SPEED, SPRINT_SPEED, SWIM_SPEED, CLIMB_SPEED } from '../shared/movement-constants.js';

const POSITION_TOLERANCE = 0.8;
const TICK_INTERVAL_MS = 100;
const MAX_STUCK_TICKS = 20; // 2 秒未移动视为卡住

export class MovementExecutor implements IMovementExecutor {
  private stateMachine = new MovementStateMachine();
  private conditionMonitor = new ConditionMonitor();
  private actionController: ActionController | null = null;
  private blockInteractionExecutor = new BlockInteractionExecutor();
  private inventoryChecker = new InventoryRequirementChecker();
  private paused = false;
  private stopped = false;

  async execute(path: Path, ctx: PathContext): Promise<MoveResult> {
    const startTime = Date.now();
    const startPos = { ...ctx.playerPos };
    let distanceMoved = 0;
    let hungerCost = 0;

    if (!ctx.player) {
      return {
        success: false,
        finalPos: ctx.playerPos,
        distanceMoved: 0,
        durationMs: 0,
        hungerCost: 0,
        reason: 'cancelled',
      };
    }
    // SimulatedPlayer 在某些 LLSE 版本中可能缺少 isOnline，缺失时默认在线
    if (typeof ctx.player.isOnline === 'function' && !ctx.player.isOnline()) {
      return {
        success: false,
        finalPos: ctx.playerPos,
        distanceMoved: 0,
        durationMs: 0,
        hungerCost: 0,
        reason: 'cancelled',
      };
    }

    this.actionController = new ActionController(ctx.player);
    this.stateMachine.reset();
    this.stopped = false;
    this.paused = false;

    for (const segment of path.segments) {
      if (this.stopped) {
        return this.buildResult(startPos, ctx.playerPos, startTime, distanceMoved, hungerCost, 'cancelled');
      }

      // 等待暂停恢复
      while (this.paused) {
        await this.sleep(TICK_INTERVAL_MS);
      }

      // 每段开始前检查条件
      const signal = this.conditionMonitor.tick(ctx);
      if (signal === 'stop') {
        return this.buildResult(startPos, ctx.playerPos, startTime, distanceMoved, hungerCost, 'interrupted');
      }
      if (signal === 'pause') {
        this.paused = true;
        continue;
      }

      // 切换状态
      this.stateMachine.transition(segment.mode, ctx);

      // 执行段
      const segResult = await this.executeSegment(segment, ctx);
      if (!segResult.success) {
        return this.buildResult(startPos, ctx.playerPos, startTime, distanceMoved, hungerCost, segResult.reason);
      }

      distanceMoved += segResult.distance;
      hungerCost += segResult.hungerCost;
    }

    this.actionController?.stopMoving();
    return this.buildResult(startPos, ctx.playerPos, startTime, distanceMoved, hungerCost, 'success');
  }

  pause(): void {
    this.paused = true;
    this.actionController?.stopMoving();
  }

  resume(): void {
    this.paused = false;
  }

  stop(): void {
    this.stopped = true;
    this.paused = false;
    this.actionController?.stopMoving();
  }

  /**
   * 执行单个 segment
   */
  private async executeSegment(segment: MoveSegment, ctx: PathContext): Promise<{ success: boolean; distance: number; hungerCost: number; reason?: any }> {
    const ac = this.actionController!;
    let distance = 0;
    let hungerCost = 0;

    switch (segment.mode) {
      case 'walk':
      case 'sprint':
      case 'sprint_jump':
      case 'swim':
      case 'climb':
        for (let i = 0; i < segment.waypoints.length; i++) {
          const wp = segment.waypoints[i];
          const prevPos = { x: ctx.player.pos.x, y: ctx.player.pos.y, z: ctx.player.pos.z };

          // 运行中条件检查
          const signal = this.conditionMonitor.tick(ctx);
          if (signal === 'stop') return { success: false, distance, hungerCost, reason: 'interrupted' };
          if (signal === 'pause') {
            this.paused = true;
            return { success: false, distance, hungerCost, reason: 'interrupted' };
          }

          // 看向并移动
          ac.lookAt(wp);
          this.applyMovementMode(segment.mode, ac, ctx);

          // 等待到达，期间持续调用 moveTo 驱动 SimulatedPlayer
          const arrived = await this.waitForPosition(wp, ctx, ac, segment.mode, POSITION_TOLERANCE, 10000);
          if (!arrived) {
            return { success: false, distance, hungerCost, reason: 'blocked' };
          }

          const currPos = { x: ctx.player.pos.x, y: ctx.player.pos.y, z: ctx.player.pos.z };
          const d = this.distance(prevPos, currPos);
          distance += d;
          hungerCost += this.calcHungerCost(segment.mode, d);
        }
        break;

      case 'elytra':
        // 简化实现：先跳跃再向目标移动，使用烟花推进
        ac.startGliding();
        for (const wp of segment.waypoints) {
          ac.lookAt(wp);
          ac.useFirework();
          const moved = await ac.moveTo(wp, 12);
          if (!moved) return { success: false, distance, hungerCost, reason: 'blocked' };
          const arrived = await this.waitForPosition(wp, ctx, ac, 'elytra', 2.0, 5000);
          if (!arrived) return { success: false, distance, hungerCost, reason: 'blocked' };
          distance += this.distance(
            { x: ctx.player.pos.x, y: ctx.player.pos.y, z: ctx.player.pos.z },
            wp,
          );
        }
        ac.stopGliding();
        break;

      case 'break_block':
      case 'place_block': {
        const actions = segment.blockActions ?? [];
        if (actions.length === 0) {
          return { success: true, distance: 0, hungerCost: 0 };
        }

        const check = this.inventoryChecker.verify(actions, ctx.inventory);
        if (!check.ok) {
          logger.warn(`[MovementExecutor] 缺少材料: ${check.missing?.join(', ')}`);
          return { success: false, distance, hungerCost, reason: 'missing_materials' };
        }

        const ok = await this.blockInteractionExecutor.executeActions(actions, ctx);
        if (!ok) {
          return { success: false, distance, hungerCost, reason: 'blocked' };
        }
        break;
      }

      default:
        break;
    }

    return { success: true, distance, hungerCost };
  }

  private applyMovementMode(mode: string, ac: ActionController, ctx: PathContext): void {
    switch (mode) {
      case 'sprint':
      case 'sprint_jump':
        if (ctx.playerHunger >= 7) {
          ac.sprint(true);
        } else {
          ac.sprint(false);
        }
        if (mode === 'sprint_jump') ac.jump();
        break;
      case 'walk':
      case 'swim':
      case 'climb':
        ac.sprint(false);
        break;
      default:
        break;
    }
  }

  private getSpeed(mode: string): number {
    switch (mode) {
      case 'sprint':
      case 'sprint_jump':
        return SPRINT_SPEED;
      case 'swim':
        return SWIM_SPEED;
      case 'climb':
        return CLIMB_SPEED;
      default:
        return WALK_SPEED;
    }
  }

  private calcHungerCost(mode: string, distance: number): number {
    switch (mode) {
      case 'sprint':
      case 'sprint_jump':
        return distance * 0.02;
      case 'swim':
        return distance * 0.015;
      case 'climb':
        return distance * 0.015;
      default:
        return distance * 0.01;
    }
  }

  /**
   * 等待到达目标位置，期间持续驱动移动
   */
  private async waitForPosition(
    target: Vec3,
    ctx: PathContext,
    ac: ActionController,
    mode: string,
    tolerance: number,
    timeoutMs: number,
  ): Promise<boolean> {
    const start = Date.now();
    let lastPos = { x: ctx.player.pos.x, y: ctx.player.pos.y, z: ctx.player.pos.z };
    let stuckTicks = 0;

    // 先发起一次移动
    ac.moveTo(target, this.getSpeed(mode));

    while (Date.now() - start < timeoutMs) {
      if (this.stopped) return false;

      const pos = { x: ctx.player.pos.x, y: ctx.player.pos.y, z: ctx.player.pos.z };
      const dist = this.distance(pos, target);
      if (dist <= tolerance) return true;

      const moved = this.distance(pos, lastPos);
      if (moved < 0.05) {
        stuckTicks++;
      } else {
        stuckTicks = 0;
      }
      lastPos = pos;

      if (stuckTicks >= MAX_STUCK_TICKS) {
        // 短距离卡住时尝试传送回退（测试模式或 3 格内通用）
        const fallbackRange = ctx.options.allowTeleportFallback ? 8 : 3;
        if (this.distance(pos, target) <= fallbackRange) {
          try {
            const fp = new FloatPos(target.x, target.y, target.z, ctx.playerDimid);
            if (ctx.player.teleport(fp)) {
              await this.sleep(200);
              return true;
            }
          } catch (e) {
            logger.warn('[MovementExecutor] 传送回退失败', e);
          }
        }
        return false;
      }

      // 持续驱动，防止 SimulatedPlayer 单 tick 后停止
      ac.moveTo(target, this.getSpeed(mode));
      await this.sleep(TICK_INTERVAL_MS);
    }

    return false;
  }

  private buildResult(
    startPos: Vec3,
    finalPos: Vec3,
    startTime: number,
    distanceMoved: number,
    hungerCost: number,
    reason: MoveResult['reason'],
  ): MoveResult {
    this.actionController?.stopMoving();
    return {
      success: reason === 'success',
      finalPos,
      distanceMoved,
      durationMs: Date.now() - startTime,
      hungerCost,
      reason,
    };
  }

  private distance(a: Vec3, b: Vec3): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const movementExecutor = new MovementExecutor();
