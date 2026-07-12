/**
 * 生存操作引擎类型定义
 */

export interface FoodInfo {
  name: string;
  hungerRestored: number;
  saturationRestored: number;
  hasNegativeEffect: boolean;
}

export interface EatResult {
  success: boolean;
  item?: string;
  hungerRestored?: number;
  saturationRestored?: number;
  effects?: string[];
  error?: string;
  durationMs?: number;
}

export interface SleepResult {
  success: boolean;
  sleptDuration?: number;
  timeWhenWake?: number;
  error?: string;
}

export interface UseItemResult {
  success: boolean;
  item?: string;
  mode?: 'use' | 'drink' | 'throw';
  remaining?: number;
  error?: string;
}
