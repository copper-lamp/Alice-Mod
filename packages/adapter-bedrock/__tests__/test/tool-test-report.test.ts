/**
 * ToolTestReport 单元测试
 */

import { describe, it, expect } from 'vitest';
import { ToolTestReport } from '../../src/test/ToolTestReport.js';
import type { ReportEntry } from '../../src/test/types.js';

function makeEntry(overrides: Partial<ReportEntry> = {}): ReportEntry {
  return {
    id: `id_${Date.now()}_${Math.random()}`,
    timestamp: Date.now(),
    player: 'TestPlayer',
    tool: 'move_to',
    params: {},
    success: true,
    durationMs: 100,
    ...overrides,
  };
}

describe('ToolTestReport', () => {
  it('应能追加并查询最近记录', () => {
    const report = new ToolTestReport();
    const entry = makeEntry();
    report.append(entry);

    expect(report.recent(1)).toHaveLength(1);
    expect(report.recent(1)[0].id).toBe(entry.id);
  });

  it('应按通过/失败/超时分类统计', () => {
    const report = new ToolTestReport();
    report.append(makeEntry({ success: true, tool: 'move_to' }));
    report.append(makeEntry({ success: false, tool: 'mine_block', error: 'block unbreakable' }));
    report.append(makeEntry({ success: false, tool: 'place_block', error: 'TOOL_TIMEOUT: place_block 执行超时 (30000ms)' }));

    const stats = report.stats();
    expect(stats.total).toBe(3);
    expect(stats.passed).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.timeout).toBe(1);
  });

  it('超过最大条目时应自动清理旧记录', () => {
    const report = new ToolTestReport(5);
    for (let i = 0; i < 10; i++) {
      report.append(makeEntry({ id: `entry_${i}` }));
    }

    const recent = report.recent(10);
    expect(recent).toHaveLength(5);
    expect(recent[0].id).toBe('entry_5');
    expect(recent[4].id).toBe('entry_9');
  });

  it('应按工具名过滤', () => {
    const report = new ToolTestReport();
    report.append(makeEntry({ tool: 'move_to' }));
    report.append(makeEntry({ tool: 'eat' }));
    report.append(makeEntry({ tool: 'move_to' }));

    expect(report.filterByTool('move_to')).toHaveLength(2);
    expect(report.filterByTool('eat')).toHaveLength(1);
  });

  it('清空后统计应为零', () => {
    const report = new ToolTestReport();
    report.append(makeEntry());
    report.clear();

    expect(report.stats().total).toBe(0);
    expect(report.recent(10)).toHaveLength(0);
  });
});
