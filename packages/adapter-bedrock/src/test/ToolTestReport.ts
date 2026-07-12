/**
 * 测试报告内存存储
 */

import type { ReportEntry } from './types.js';

export type { ReportEntry };

export interface ReportStats {
  total: number;
  passed: number;
  failed: number;
  timeout: number;
}

export class ToolTestReport {
  private entries: ReportEntry[] = [];

  constructor(private maxEntries = 100) {}

  /**
   * 追加一条测试记录
   */
  append(entry: ReportEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  /**
   * 获取最近 N 条记录
   */
  recent(count = 50): ReportEntry[] {
    return this.entries.slice(-count);
  }

  /**
   * 获取统计信息
   */
  stats(): ReportStats {
    const total = this.entries.length;
    const passed = this.entries.filter((e) => e.success).length;
    const failed = this.entries.filter((e) => !e.success && !this.isTimeout(e.error)).length;
    const timeout = this.entries.filter((e) => this.isTimeout(e.error)).length;
    return { total, passed, failed, timeout };
  }

  /**
   * 按工具名查询
   */
  filterByTool(toolName: string): ReportEntry[] {
    return this.entries.filter((e) => e.tool === toolName);
  }

  /**
   * 清空报告
   */
  clear(): void {
    this.entries = [];
  }

  private isTimeout(error?: string): boolean {
    return !!error && error.includes('TOOL_TIMEOUT');
  }
}
