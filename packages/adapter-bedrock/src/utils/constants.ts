/**
 * 全局常量定义
 */

// ── 目录路径 ──

export const BOT_DATA_DIR = './plugins/mcagent-adapter-be/data/bots/';
export const BOT_INVENTORY_DIR = './plugins/mcagent-adapter-be/data/inventories/';

// ── 操作列表 ──

export const LONG_OPERATIONS: string[] = ['useitem'];
export const SHORT_OPERATIONS: string[] = ['attack', 'interact', 'clear'];

// ── 维度名称 ──

export const DIMENSION_NAMES: string[] = ['主世界', '下界', '末地'];

// ── 游戏模式名称 ──

export const GAME_MODE_NAMES: Record<number, string> = {
  0: '生存模式',
  1: '创造模式',
  2: '冒险模式',
  5: '默认模式',
  6: '旁观模式',
};

// ── 默认选中栏位 ──

export const DEFAULT_SELECT_SLOT = 0;

// ── 死亡频率检测 ──

export const DEATH_COUNTER_THRESHOLD = 5;
export const DEATH_COUNTER_WINDOW_MS = 20000;

// ── 成功标识 ──

export const SUCCESS = '';

// ── 数据版本 ──

export const BOT_DATA_VERSION = 1;