/**
 * IToolModule 接口定义
 *
 * 定义工具模块的统一接口规范，所有工具必须实现此接口。
 * 遵循协议规范 v1.0 的 ResultEnvelope 和 ErrorCode 标准。
 */

// ── 工具分类 ──

export type ToolCategory =
  | 'perception'
  | 'movement'
  | 'inventory'
  | 'entity'
  | 'survival'
  | 'block'
  | 'combat'
  | 'chat';

// ── 错误码（ErrorCode 标准 v1.0）──

/**
 * 通用错误码
 */
export type GeneralErrorCode =
  | 'NOT_FOUND'
  | 'TOO_FAR'
  | 'TIMEOUT'
  | 'NO_PERMISSION'
  | 'INVALID_PARAMS'
  | 'INTERNAL_ERROR'
  | 'CANCELLED';

/**
 * 领域错误码 - 背包
 */
export type InventoryErrorCode =
  | 'INVENTORY_FULL'
  | 'ITEM_NOT_FOUND'
  | 'CONTAINER_FULL'
  | 'CONTAINER_NOT_FOUND';

/**
 * 领域错误码 - 战斗
 */
export type CombatErrorCode =
  | 'TARGET_NOT_FOUND'
  | 'WEAPON_BROKEN'
  | 'NO_AMMO';

/**
 * 领域错误码 - 生存
 */
export type SurvivalErrorCode =
  | 'NOT_HUNGRY'
  | 'NO_FOOD'
  | 'NOT_NIGHT'
  | 'MONSTERS_NEARBY'
  | 'BED_OCCUPIED';

/**
 * 领域错误码 - 移动
 */
export type MovementErrorCode =
  | 'NO_PATH'
  | 'BLOCKED'
  | 'ENTITY_MOVED'
  | 'NOT_RIDEABLE'
  | 'NOT_RIDING';

/**
 * 领域错误码 - 方块
 */
export type BlockErrorCode =
  | 'BLOCK_NOT_FOUND'
  | 'NOT_BREAKABLE'
  | 'POSITION_OCCUPIED'
  | 'CANNOT_PLACE'
  | 'TOO_LARGE'
  | 'NO_ORE';

/**
 * 领域错误码 - 对话
 */
export type ChatErrorCode =
  | 'MESSAGE_TOO_LONG'
  | 'PLAYER_NOT_FOUND'
  | 'MUTED'
  | 'EMOTE_NOT_FOUND'
  | 'MESSAGE_NOT_FOUND';

/**
 * 领域错误码 - QQ
 */
export type QQErrorCode =
  | 'CONNECTION_FAILED'
  | 'SEND_FAILED';

/**
 * 领域错误码 - 记忆
 */
export type MemoryErrorCode =
  | 'MEMORY_NOT_FOUND'
  | 'STORAGE_FULL';

/**
 * 领域错误码 - 任务
 */
export type TaskErrorCode =
  | 'TASK_NOT_FOUND'
  | 'TASK_ALREADY_RUNNING'
  | 'DEPENDENCY_FAILED'
  | 'MAX_RETRIES_EXCEEDED';

/**
 * 统一错误码类型
 */
export type ErrorCode =
  | GeneralErrorCode
  | InventoryErrorCode
  | CombatErrorCode
  | SurvivalErrorCode
  | MovementErrorCode
  | BlockErrorCode
  | ChatErrorCode
  | QQErrorCode
  | MemoryErrorCode
  | TaskErrorCode;

// ── 工具元数据 ──

export interface ToolMetadata {
  name: string;
  description: string;
  category: ToolCategory;
  input_schema: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  execution?: {
    timeout_default_ms?: number;
    timeout_max_ms?: number;
    is_movement?: boolean;
    is_async?: boolean;
  };
}

// ── 工具执行上下文 ──

export interface PlayerAccess {
  getHealth(): number;
  getMaxHealth(): number;
  getHunger(): number;
  getSaturation(): number;
  getPosition(): { x: number; y: number; z: number; dimension: string };
  getRotation(): { yaw: number; pitch: number };
  getSelectedSlot(): number;
  setSelectedSlot(slot: number): boolean;
  getInventory(): Container | null;
  getEquipment(): Record<string, string | null>;
}

export interface WorldAccess {
  getBlock(x: number, y: number, z: number): Block | null;
  getTime(): number;
  getWeather(): string;
  getEntities(options?: Record<string, unknown>): Entity[];
  getOnlinePlayers(): Player[];
}

export interface BotConfig {
  name: string;
  pos: {
    x: number;
    y: number;
    z: number;
    dimid: number;
  };
  owner?: string;
}

/** 假人手柄最小抽象，供工具层使用 */
export interface BotHandle {
  name: string;
  isOnline: boolean | (() => boolean);
  getPlayer?: () => Player;
  getInfo?: () => Record<string, unknown>;
}

export interface BotAccess {
  /** 获取当前工具执行关联的假人 */
  getActiveBot(): BotHandle | null;
  /** 设置当前工具执行关联的假人 */
  setActiveBot(name: string): boolean;
  /** 列出所有假人信息 */
  listBots(): BotHandle[];
  /** 创建假人，失败返回错误原因字符串 */
  createBot(config: BotConfig): BotHandle | string;
  /** 销毁假人 */
  destroyBot(name: string): boolean;
  /** 按名称获取假人 */
  getBot(name: string): BotHandle | null;
  /** 按名称获取假人的游戏内 Player 对象 */
  getBotPlayer(name: string): Player | null;
}

export interface EventNotification {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface ToolContext {
  player: PlayerAccess;
  world: WorldAccess;
  bot: BotAccess;
  sendEvent(event: EventNotification): void;
  logger: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
    debug(msg: string): void;
  };
  getElapsedMs(): number;
}

// ── ResultEnvelope（协议规范 v1.0）──

/**
 * 返回信封（ResultEnvelope）。
 * 所有工具必须返回此格式。
 */
export interface ResultEnvelope<T = Record<string, unknown>> {
  /** 是否成功 */
  success: boolean;

  /** 错误信息（success=false 时必填） */
  error?: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };

  /** 返回数据（success=true 时包含） */
  data?: T;

  /** 执行元数据 */
  meta?: {
    duration: number;
    cost?: Record<string, number>;
  };
}

// ── IToolModule 接口 ──

export interface IToolModule {
  /** 返回工具元数据（名称、描述、参数 schema 等） */
  metadata(): ToolMetadata;

  /** 执行工具逻辑 */
  execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params: Record<string, any>,
    ctx: ToolContext,
  ): Promise<ResultEnvelope>;
}

// ── 已注册工具 ──

export interface RegisteredTool {
  name: string;
  metadata: ToolMetadata;
  module: IToolModule;
  loadedAt: Date;
}

// ── 工具注册器配置 ──

export interface ToolRegistryConfig {
  toolsDir: string;
  scanIntervalMs?: number;
}

// ── ToolResult（测试/渲染层使用的扁平格式）──

/**
 * 工具执行结果（扁平格式，用于测试/渲染层）。
 * 区别于 ResultEnvelope（协议标准），ToolResult 将 error 简化为字符串，
 * 并将 duration 提升为顶层字段，方便 UI 渲染和日志输出。
 */
export interface ToolResult {
  success: boolean;
  duration_ms: number;
  error?: string;
  data?: Record<string, unknown>;
}

/**
 * 将 ResultEnvelope 转换为 ToolResult
 */
export function toToolResult(envelope: ResultEnvelope): ToolResult {
  return {
    success: envelope.success,
    duration_ms: envelope.meta?.duration ?? 0,
    error: envelope.error
      ? typeof envelope.error === 'string'
        ? envelope.error
        : envelope.error.message
      : undefined,
    data: envelope.data,
  };
}

// ── ToolSchema（LLM 可见格式）──

/**
 * 工具 Schema，直接传递给 LLM API。
 * 格式兼容 OpenAI function calling / tool_use。
 */
export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}