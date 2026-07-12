/**
 * 移动与寻路常量
 */

// ── 默认配置 ──

export const DEFAULT_MAX_RANGE = 128;
export const DEFAULT_CACHE_SIZE = 256;
export const DEFAULT_ASYNC_NODES_PER_TICK = 64;
export const DEFAULT_TIMEOUT_MS = 30000;

// ── 移动速度（方块/秒，近似值）──

export const WALK_SPEED = 4.3;
export const SPRINT_SPEED = 5.6;
export const SWIM_SPEED = 2.2;
export const CLIMB_SPEED = 2.0;
export const ELYTRA_GLIDE_SPEED = 12.0;

// ── 饥饿与血量阈值 ──

export const SPRINT_MIN_HUNGER = 7;      // 饥饿 < 7 时停止疾跑（游戏中饥饿 ≤ 6 无法疾跑）
export const LOW_HEALTH_THRESHOLD = 8;
export const LOW_HUNGER_THRESHOLD = 6;

// ── 距离阈值 ──

export const ELYTRA_MIN_DISTANCE = 30;   // 短于该距离不触发鞘翅
export const ENEMY_REACTION_RADIUS = 8;
export const AVOID_HOSTILE_RADIUS = 16;
export const FALL_DAMAGE_THRESHOLD = 3;  // 超过 3 格落差需保护

// ── 路径代价 ──

export const COST_WALK = 1.0;
export const COST_SPRINT = 0.75;         // 单位距离时间更短，代价更低
export const COST_JUMP = 2.0;
export const COST_SWIM = 3.0;
export const COST_CLIMB = 2.0;
export const COST_OBSTACLE = 5.0;
export const COST_DANGER = Infinity;

// ── 方块交互限制 ──

export const DEFAULT_MAX_BLOCKS_TO_BREAK = 8;
export const DEFAULT_MAX_BLOCKS_TO_PLACE = 8;

// ── 默认黑名单 ──

export const DEFAULT_UNBREAKABLE_BLOCKS = new Set([
  'bedrock',
  'barrier',
  'command_block',
  'repeating_command_block',
  'chain_command_block',
  'structure_block',
  'jigsaw',
  'end_portal_frame',
  'end_portal',
  'nether_portal',
]);

export const DEFAULT_PROTECTED_BLOCKS = new Set([
  'chest',
  'trapped_chest',
  'ender_chest',
  'barrel',
  'furnace',
  'blast_furnace',
  'smoker',
  'bed',
  'crafting_table',
  'anvil',
  'enchanting_table',
  'brewing_stand',
  'beacon',
  'dispenser',
  'dropper',
  'hopper',
  'note_block',
  'jukebox',
  'door',
  'trapdoor',
  'fence_gate',
]);

export const DEFAULT_PREFERRED_PLACE_BLOCKS = [
  'dirt',
  'cobblestone',
  'cobblestone_wall',
  'stone',
  'netherrack',
];
