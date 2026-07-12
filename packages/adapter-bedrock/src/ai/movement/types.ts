/**
 * 移动执行模块类型定义
 */

import type { Vec3, Path, PathContext, MoveMode } from '../pathfinding/types.js';

// ── 执行结果 ──

export interface MoveResult {
  success: boolean;
  finalPos: Vec3;
  distanceMoved: number;
  durationMs: number;
  hungerCost: number;
  reason?:
    | 'success'
    | 'no_path'
    | 'too_far'
    | 'interrupted'
    | 'blocked'
    | 'timeout'
    | 'died'
    | 'cancelled'
    | 'missing_materials';
}

export interface RideResult {
  success: boolean;
  reason?: 'success' | 'not_rideable' | 'too_far' | 'entity_not_found' | 'error';
  isRiding?: boolean;
  mountType?: string;
}

export interface DismountResult {
  success: boolean;
  reason?: 'success' | 'not_riding' | 'error';
  isRiding?: boolean;
}

// ── 执行器接口 ──

export interface IMovementExecutor {
  execute(path: Path, ctx: PathContext): Promise<MoveResult>;
  pause(): void;
  resume(): void;
  stop(): void;
}

// ── 状态机 ──

export interface IMovementStateMachine {
  getState(): MoveMode;
  transition(to: MoveMode, ctx: PathContext): boolean;
}

// ── 条件监控 ──

export type ConditionSignal =
  | 'continue'
  | 'pause'
  | 'retreat'
  | 'replan'
  | 'stop';

export interface IExecutionCondition {
  evaluate(ctx: PathContext): ConditionSignal;
}

export interface IConditionMonitor {
  tick(ctx: PathContext): ConditionSignal;
}

// ── 动作控制器 ──

export interface IActionController {
  moveTo(pos: Vec3, speed: number): Promise<boolean>;
  sprint(enabled: boolean): boolean;
  jump(): boolean;
  lookAt(pos: Vec3): boolean;
  stopMoving(): void;
  breakBlock(pos: Vec3, toolName?: string): Promise<boolean>;
  placeBlock(pos: Vec3, blockName: string, face?: Vec3): Promise<boolean>;
  useFirework(): boolean;
  startGliding(): boolean;
  stopGliding(): boolean;
  selectSlot(slot: number): boolean;
  getSelectedSlot(): number;
}

// ── 方块交互执行器 ──

export interface IBlockInteractionExecutor {
  executeActions(actions: import('../pathfinding/types.js').BlockActionPlan[], ctx: PathContext): Promise<boolean>;
}

// ── 库存需求检查器 ──

export interface IInventoryRequirementChecker {
  verify(actions: import('../pathfinding/types.js').BlockActionPlan[], inventory: import('../pathfinding/types.js').ItemSnapshot[]): { ok: boolean; missing?: string[] };
}
