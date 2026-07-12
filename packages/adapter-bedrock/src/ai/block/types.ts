/**
 * V6 方块操作引擎 — 类型定义
 */

import type { Vec3 } from '../pathfinding/types.js';

/** 区域操作模式 */
export type AreaMode = 'fill' | 'clear' | 'break' | 'vein';

/** 工具推荐结果 */
export interface ToolRecommendation {
  toolSlot: number | null;
  canHandMine: boolean;
  toolName?: string;
}

/** 挖掘结果 */
export interface MineResult {
  success: boolean;
  block?: string;
  drops?: string[];
  tool_damage?: number;
  duration_ms?: number;
  error?: string;
}

/** 放置结果 */
export interface PlaceResult {
  success: boolean;
  block?: string;
  position?: Vec3;
  duration_ms?: number;
  error?: string;
}

/** 方块交互结果 */
export interface UseBlockResult {
  success: boolean;
  block?: string;
  duration_ms?: number;
  error?: string;
}

/** 区域操作结果 */
export interface AreaResult {
  success: boolean;
  mode: AreaMode;
  total_blocks: number;
  success_count: number;
  fail_count: number;
  drops?: Record<string, number>;
  duration_ms: number;
  error?: string;
}

/** 放置面 */
export interface PlacementFace {
  face: Vec3;
  neighbor: Vec3;
}

/** 方块操作引擎构造选项 */
export interface BlockOperationEngineOptions {
  player: any;
  botName: string;
  inventoryEngine: any;
  world: any;
}
