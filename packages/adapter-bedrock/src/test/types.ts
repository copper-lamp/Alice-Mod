/**
 * V6-T 游戏内 GUI 测试工具内部类型
 */

import type { ToolResult } from '../registry/tool-module.types.js';

export type { GuiTestConfig } from '../config/index.js';

/** 玩家会话：记录当前选中的假人与执行状态 */
export interface PlayerSession {
  /** 当前选中的目标假人名称 */
  activeBot: string;
  /** 正在执行的异步任务，防止并发 */
  pendingExecution: Promise<unknown> | null;
}

/** 主菜单动作 */
export interface MainMenuAction {
  type: 'category' | 'smoke' | 'report' | 'legacy' | 'selectBot' | 'close';
  category?: string;
}

/** 冒烟测试用例 */
export interface SmokeTestCase {
  tool: string;
  params: Record<string, unknown>;
}

/** 单条测试报告 */
export interface ReportEntry {
  id: string;
  timestamp: number;
  player: string;
  tool: string;
  params: Record<string, unknown>;
  success: boolean;
  durationMs: number;
  error?: string;
}

/** 表单控件元信息 */
export interface FormField {
  name: string;
  title: string;
  type: 'input' | 'switch' | 'dropdown' | 'slider' | 'label';
  placeholder?: string;
  defaultValue?: string | boolean | number;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
}

/** 工具执行后回调 */
export type ToolExecuteCallback = (player: Player, toolName: string, result: ToolResult) => void;
