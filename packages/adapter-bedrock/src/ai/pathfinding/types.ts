/**
 * 寻路模块类型定义
 */

// ── 通用向量 ──

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface BoundingBox {
  min: Vec3;
  max: Vec3;
}

export interface ItemSnapshot {
  name: string;
  count: number;
  slot: number;
}

export interface EntityRef {
  id: string;
  type: string;
  pos: Vec3;
  isHostile: boolean;
}

// ── 移动模式 ──

export type MoveMode =
  | 'walk'
  | 'sprint'
  | 'sprint_jump'
  | 'swim'
  | 'climb'
  | 'elytra'
  | 'ride'
  | 'boat'
  | 'break_block'
  | 'place_block';

// ── 路径选项 ──

export interface PathOptions {
  timeout?: number;
  avoidHostile?: boolean;
  allowSprint?: boolean;
  allowBreak?: boolean;
  allowPlace?: boolean;
  allowSwim?: boolean;
  allowElytra?: boolean;
  maxBlocksToBreak?: number;
  maxBlocksToPlace?: number;
  preferredBlock?: string;
  maxRange?: number;
  pathfinding?: 'astar';
}

// ── 寻路上下文 ──

export interface PathContext {
  player: any;              // 当前操作的 LLSE 玩家对象
  playerHealth: number;
  playerHunger: number;
  playerPos: Vec3;
  playerDimid: number;
  inventory: ItemSnapshot[];
  dimension: string;
  hostileEntities: EntityRef[];
  options: Required<PathOptions>;
}

// ── 方块交互选项 ──

export interface BlockInteractionOptions {
  allowBreak: boolean;
  allowPlace: boolean;
  maxBlocksToBreak: number;
  maxBlocksToPlace: number;
  preferredBlock?: string;
  unbreakableBlocks: Set<string>;
  protectedBlocks: Set<string>;
}

// ── 方块交互计划 ──

export interface BlockActionPlan {
  type: 'break' | 'place';
  targetPos: Vec3;
  blockName?: string;
  toolName?: string;
  face?: Vec3;
  estimatedTimeMs: number;
  durabilityCost?: number;
}

// ── 路径段 ──

export interface MoveSegment {
  mode: MoveMode;
  waypoints: Vec3[];
  estimatedCost: number;
  requiredItems?: string[];
  conditions?: IPathCondition[];
  blockActions?: BlockActionPlan[];
}

// ── 路径 ──

export interface Path {
  segments: MoveSegment[];
  totalCost: number;
  totalDistance: number;
  isPartial: boolean;
}

// ── 寻路结果 ──

export interface PathResult {
  success: boolean;
  path?: Path;
  reason?: 'success' | 'no_path' | 'timeout' | 'too_far' | 'cancelled' | 'missing_materials';
  nodeCount: number;
  durationMs: number;
}

// ── 条件策略 ──

export interface ConditionEvaluation {
  pass: boolean;
  costMultiplier?: number;
  reason?: string;
}

export interface IPathCondition {
  evaluate(ctx: PathContext, point: Vec3): ConditionEvaluation;
}

// ── 寻路引擎接口 ──

export interface IPathfindingEngine {
  findPath(from: Vec3, to: Vec3, ctx: PathContext): Promise<PathResult>;
  invalidateCache(region?: BoundingBox): void;
}

export interface IGroundPathPlanner {
  findPath(from: Vec3, to: Vec3, ctx: PathContext): Promise<PathResult>;
}

export interface IFlightSegmentPlanner {
  planSegment(from: Vec3, to: Vec3, ctx: PathContext): Promise<MoveSegment | null>;
}

export interface IBlockInteractionPlanner {
  generateActions(
    from: Vec3,
    to: Vec3,
    world: WorldAccess,
    options: BlockInteractionOptions,
    dimid?: number,
  ): BlockActionPlan[];
}

// ── 世界访问抽象 ──

export interface WorldAccess {
  getBlock(x: number, y: number, z: number): any;
  getTime(): number;
  getWeather(): string;
  getEntities(options?: any): any[];
  getOnlinePlayers(): any[];
}
