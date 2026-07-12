/**
 * ConfigManager 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigManager, DEFAULT_GUI_TEST_CONFIG } from '../../src/config/index.js';

describe('ConfigManager.gui_test', () => {
  let manager: ConfigManager;

  beforeEach(() => {
    manager = new ConfigManager();
  });

  it('默认应使用 GUI 测试默认配置', () => {
    manager.load({});
    const cfg = manager.guiTest;
    expect(cfg.enabled).toBe(DEFAULT_GUI_TEST_CONFIG.enabled);
    expect(cfg.require_op).toBe(DEFAULT_GUI_TEST_CONFIG.require_op);
    expect(cfg.allowed_players).toEqual([]);
    expect(cfg.max_report_entries).toBe(100);
  });

  it('应允许通过 gui_test 选项覆盖默认值', () => {
    manager.load({
      gui_test: {
        enabled: false,
        require_op: false,
        allowed_players: ['xuid_1'],
        max_report_entries: 50,
        default_target_bot: 'bot1',
      },
    });

    const cfg = manager.guiTest;
    expect(cfg.enabled).toBe(false);
    expect(cfg.require_op).toBe(false);
    expect(cfg.allowed_players).toEqual(['xuid_1']);
    expect(cfg.max_report_entries).toBe(50);
    expect(cfg.default_target_bot).toBe('bot1');
  });

  it('未提供的 gui_test 字段应使用默认值', () => {
    manager.load({
      gui_test: {
        enabled: false,
      },
    });

    const cfg = manager.guiTest;
    expect(cfg.enabled).toBe(false);
    expect(cfg.require_op).toBe(DEFAULT_GUI_TEST_CONFIG.require_op);
    expect(cfg.max_report_entries).toBe(DEFAULT_GUI_TEST_CONFIG.max_report_entries);
  });

  it('smoke_cases 应被正确合并', () => {
    manager.load({
      gui_test: {
        smoke_cases: {
          move_to: { tool: 'move_to', params: { x: 1, y: 2, z: 3 } },
        },
      },
    });

    expect(manager.guiTest.smoke_cases.move_to).toEqual({
      tool: 'move_to',
      params: { x: 1, y: 2, z: 3 },
    });
  });
});
