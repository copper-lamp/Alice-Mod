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
  input_schema: Record<string, any>;
  output_schema?: Record<string, any>;
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
  getInventory(): any;
  getEquipment(): Record<string, any>;
}

export interface WorldAccess {
  getBlock(x: number, y: number, z: number): any;
  getTime(): number;
  getWeather(): string;
  getEntities(options?: any): any[];
  getOnlinePlayers(): any[];
}

export interface BotAccess {
  // 假人管理接口（V10 实现）
}

export interface EventNotification {
  type: string;
  data: Record<string, any>;
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
  data?: Record<string, any>;
  error?: string;
  duration_ms: number;
}

// ── IToolModule 接口 ──

export interface IToolModule {
  /** 返回工具元数据（名称、描述、参数 schema 等） */
  metadata(): ToolMetadata;

  /** 执行工具逻辑 */
  execute(
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