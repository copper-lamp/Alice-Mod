/**
 * Tool Schema 定义
 * 描述工具的参数结构和元数据
 */

/** 参数类型 */
export type ParamType = 'string' | 'number' | 'boolean' | 'object' | 'array';

/** 参数定义 */
export interface ParamDefinition {
  type: ParamType;
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
  /** 嵌套属性（当 type 为 'object' 时） */
  properties?: Record<string, ParamDefinition>;
  /** 数组元素类型（当 type 为 'array' 时） */
  items?: ParamDefinition;
}

/** 工具 Schema */
export interface ToolSchema {
  /** 工具名称（蛇形命名） */
  name: string;
  /** 工具描述 */
  description: string;
  /** 参数定义 */
  parameters: Record<string, ParamDefinition>;
  /** 所属类别 */
  category: ToolCategory;
  /** 是否启用 */
  enabled?: boolean;
}

/** 工具类别 */
export enum ToolCategory {
  Perception = 'perception',
  Movement = 'movement',
  Inventory = 'inventory',
  Entity = 'entity',
  Survival = 'survival',
  Block = 'block',
  Chat = 'chat',
  QQ = 'qq',
  Memory = 'memory',
  Task = 'task',
  Knowledge = 'knowledge',
  Maps = 'maps',
  Aim = 'aim',
}

/** 工具调用结果 */
export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /** 执行耗时（ms） */
  duration?: number;
  /** 资源消耗 */
  cost?: {
    time?: number;
    hunger?: number;
    durability?: number;
  };
}
