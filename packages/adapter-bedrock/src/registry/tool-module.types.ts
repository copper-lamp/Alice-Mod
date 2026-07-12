/**
 * IToolModule 接口定义
 *
 * 定义工具模块的统一接口规范，所有工具必须实现此接口。
 * 遵循 MCP 风格的工具定义，包含元数据、输入/输出 schema、执行逻辑。
 */

// ── 工具分类 ──

export type ToolCategory =
  | 'perception'
  | 'movement'
  | 'inventory'
  | 'entity'
  | 'survival'
  | 'block'
  | 'chat';

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

// ── 工具执行结果 ──

export interface ToolResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  duration_ms: number;
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
  ): Promise<ToolResult>;
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
