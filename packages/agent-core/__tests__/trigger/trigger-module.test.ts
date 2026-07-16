/**
 * TriggerModule 集成测试
 *
 * 覆盖场景：
 * - 启动/停止生命周期
 * - 创建/更新/删除触发器并持久化
 * - 通过 handleRawEvent 处理各类原始事件
 * - cron 触发器创建后自动调度
 * - 日志查询
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { TriggerModule } from '../../src/main/trigger';
import type { AgentEvent } from '../../src/main/trigger/types';

const TRIGGER_DDL = `
CREATE TABLE IF NOT EXISTS event_triggers (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL CHECK(source IN ('cron', 'game_chat', 'plugin_event', 'qq')),
  priority INTEGER NOT NULL DEFAULT 5,
  rule_json TEXT NOT NULL,
  action_json TEXT NOT NULL,
  cooldown_seconds INTEGER NOT NULL DEFAULT 0,
  max_trigger_count INTEGER,
  trigger_count INTEGER NOT NULL DEFAULT 0,
  last_triggered_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  target_agent_id TEXT
);

CREATE TABLE IF NOT EXISTS trigger_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_payload TEXT,
  action_json TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  triggered_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS trigger_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_id TEXT NOT NULL UNIQUE,
  schedule_type TEXT NOT NULL CHECK(schedule_type IN ('cron', 'at', 'interval')),
  cron_expression TEXT,
  scheduled_at INTEGER,
  interval_seconds INTEGER,
  last_scheduled_at INTEGER,
  next_scheduled_at INTEGER
);
`;

describe('TriggerModule', () => {
  let db: Database.Database;
  let module: TriggerModule;
  let events: AgentEvent[] = [];
  let actionDeps: {
    sendQQ: ReturnType<typeof vi.fn>;
    sendLLM: ReturnType<typeof vi.fn>;
    callTool: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(TRIGGER_DDL);
    events = [];
    actionDeps = {
      sendQQ: vi.fn().mockResolvedValue(true),
      sendLLM: vi.fn().mockResolvedValue('reply'),
      callTool: vi.fn().mockResolvedValue({ ok: true }),
    };

    module = new TriggerModule(
      {
        db,
        actionDeps,
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      },
      { defaultCooldownSeconds: 0 },
    );

    module.getEventBus().subscribe({}, (e) => events.push(e));
  });

  afterEach(async () => {
    await module.stop();
    db.close();
  });

  it('应创建并查询触发器', () => {
    const trigger = module.createTrigger({
      name: 'chat-test',
      source: 'game_chat',
      rule: { type: 'keyword', value: 'hello' },
      action: { type: 'none', config: {} },
    });

    expect(trigger.id).toBeDefined();
    expect(module.getTrigger(trigger.id)).toEqual(trigger);
    expect(module.listTriggers({ source: 'game_chat' })).toHaveLength(1);
  });

  it('应处理游戏聊天原始事件并触发匹配', async () => {
    module.createTrigger({
      name: 'chat-test',
      source: 'game_chat',
      rule: { type: 'keyword', value: 'hello' },
      action: { type: 'send_qq', config: { target: 'g', content: 'hi' } },
      cooldownSeconds: 0,
    });

    await module.start();
    module.handleRawEvent('game_chat', {
      workspaceId: 'ws_001',
      playerId: 'p1',
      playerName: 'Alice',
      message: 'hello world',
      rawMessage: 'hello world',
      isAtBot: false,
      timestamp: Date.now(),
    });

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 20));

    expect(actionDeps.sendQQ).toHaveBeenCalledWith('g', 'hi', 'group');
  });

  it('应处理 QQ 原始事件并触发匹配', async () => {
    module.createTrigger({
      name: 'qq-at',
      source: 'qq',
      rule: { type: 'at_bot' },
      action: { type: 'send_qq', config: { target: 'g', content: '收到 @' } },
    });

    await module.start();
    module.handleRawEvent('qq', {
      id: 'm1',
      type: 'group',
      groupId: 'g',
      userId: 'u1',
      userName: 'User',
      content: '@bot hi',
      rawContent: '@bot hi',
      segments: [{ type: 'at', data: { qq: 'u1' } }],
      timestamp: Date.now(),
    });

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 20));

    expect(actionDeps.sendQQ).toHaveBeenCalledWith('g', '收到 @', 'group');
  });

  it('应处理插件事件并去重', async () => {
    module.createTrigger({
      name: 'hurt',
      source: 'plugin_event',
      rule: { type: 'event_type', value: 'player_hurt' },
      action: { type: 'send_llm', config: { target: 'main', prompt: 'help' } },
    });

    await module.start();

    const raw = {
      workspaceId: 'ws_001',
      eventType: 'player_hurt',
      entityId: 'p1',
      data: { damage: 5 },
    };

    module.handleRawEvent('plugin_event', raw);
    module.handleRawEvent('plugin_event', raw);

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 20));

    expect(actionDeps.sendLLM).toHaveBeenCalledTimes(1);
  });

  it('创建 cron 触发器后启动应自动调度', async () => {
    const trigger = module.createTrigger(
      {
        name: 'auto-schedule',
        source: 'cron',
        rule: { type: 'interval', value: 1 },
        action: { type: 'none', config: {} },
      },
      { triggerId: 'temp', scheduleType: 'interval', intervalSeconds: 1 },
    );

    await module.start();

    await new Promise((r) => setTimeout(r, 1200));
    expect(events.filter((e) => e.type === 'cron_trigger' && e.payload.triggerId === trigger.id).length).toBeGreaterThanOrEqual(1);
  });

  it('创建 cron 触发器后更新应重新调度', async () => {
    const trigger = module.createTrigger(
      {
        name: 'update-schedule',
        source: 'cron',
        rule: { type: 'interval', value: 1 },
        action: { type: 'none', config: {} },
      },
      { triggerId: 'temp', scheduleType: 'interval', intervalSeconds: 10 },
    );

    await module.start();
    module.updateTrigger(trigger.id, { enabled: false });

    await new Promise((r) => setTimeout(r, 200));
    expect(events.filter((e) => e.type === 'cron_trigger' && e.payload.triggerId === trigger.id).length).toBe(0);
  });

  it('删除 cron 触发器应取消调度', async () => {
    const trigger = module.createTrigger(
      {
        name: 'delete-schedule',
        source: 'cron',
        rule: { type: 'interval', value: 1 },
        action: { type: 'none', config: {} },
      },
      { triggerId: 'temp', scheduleType: 'interval', intervalSeconds: 1 },
    );

    await module.start();
    module.deleteTrigger(trigger.id);

    await new Promise((r) => setTimeout(r, 1200));
    expect(events.filter((e) => e.type === 'cron_trigger' && e.payload.triggerId === trigger.id).length).toBe(0);
  });

  it('应记录触发日志', async () => {
    const trigger = module.createTrigger({
      name: 'log-test',
      source: 'game_chat',
      rule: { type: 'always' },
      action: { type: 'send_qq', config: { target: 'g', content: 'hi' } },
    });

    await module.start();
    module.publishEvent({
      id: 'e1',
      type: 'game_chat',
      source: 'game_chat',
      workspaceId: '',
      timestamp: Date.now(),
      payload: { message: 'hi' },
    });

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 20));

    const logs = module.getTriggerLogs(trigger.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].success).toBe(true);
  });

  it('registerTransient 应注册内存触发器', async () => {
    const trigger = {
      id: 'transient_001',
      workspaceId: '',
      name: 'transient',
      description: '',
      enabled: true,
      source: 'game_chat' as const,
      priority: 5,
      rule: { type: 'always' as const },
      action: { type: 'send_qq', config: { target: 'g', content: 'hi' } },
      cooldownSeconds: 0,
      triggerCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    module.registerTransient(trigger);
    await module.start();

    module.publishEvent({
      id: 'e1',
      type: 'game_chat',
      source: 'game_chat',
      workspaceId: '',
      timestamp: Date.now(),
      payload: { message: 'hi' },
    });

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 20));

    expect(actionDeps.sendQQ).toHaveBeenCalled();
  });
});
