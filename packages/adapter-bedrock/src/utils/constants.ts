/**
 * 全局常量定义
 */

// ── 目录路径 ──

export const BOT_DATA_DIR = './plugins/Alices Mod/data/bots/';
export const BOT_INVENTORY_DIR = './plugins/Alices Mod/data/inventories/';
export const PLUGIN_ROOT = './plugins/Alices Mod/';
export const TOOLS_DIR = PLUGIN_ROOT + 'tools/';
export const ALICE_DIR = './Alice/';
export const DATA_DIR = ALICE_DIR + 'data/';
export const INSTANCE_ID_FILE = DATA_DIR + 'instance_id.txt';
export const INSTANCE_FILE_PATH = ALICE_DIR + 'mcagent_instance.json';

// ── TCP 客户端 ──

export const DEFAULT_TCP_HOST = '127.0.0.1';
export const DEFAULT_TCP_PORT = 27541;
export const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
export const RECONNECT_INTERVALS = [1000, 2000, 4000, 8000, 16000];
export const MAX_RECONNECT_ATTEMPTS = 5;

// ── 状态上报 ──

export const DEFAULT_STATUS_INTERVAL_MS = 2000;
export const STATUS_REPORT_WARN_THRESHOLD_MS = 100;

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