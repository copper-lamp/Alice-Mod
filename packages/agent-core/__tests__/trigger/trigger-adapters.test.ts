/**
 * Trigger 适配器单元测试
 *
 * 覆盖场景：
 * - CronTriggerAdapter: cron / at / interval 调度、取消调度、启动时加载、missed 补偿
 * - GameChatTriggerAdapter: 游戏聊天事件转换、字段缺失校验
 * - PluginEventTriggerAdapter: 插件事件转换、字段缺失校验
 * - QQTriggerAdapter: 群消息 / 私聊 / @机器人检测 / 事件类型解析
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { EventBus } from '../../src/main/trigger/event-bus';
import { TriggerStore } from '../../src/main/trigger/trigger-store';
import { CronTriggerAdapter } from '../../src/main/trigger/adapters/cron-adapter';
import { GameChatTriggerAdapter } from '../../src/main/trigger/adapters/game-chat-adapter';
import { PluginEventTriggerAdapter } from '../../src/main/trigger/adapters/plugin-event-adapter';
import { QQTriggerAdapter } from '../../src/main/trigger/adapters/qq-trigger-adapter';
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

describe('CronTriggerAdapter', () => {
  let db: Database.Database;
  let store: TriggerStore;
  let bus: EventBus;
  let adapter: CronTriggerAdapter;
  let events: AgentEvent[] = [];

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(TRIGGER_DDL);
    store = new TriggerStore(db);
    bus = new EventBus();
    events = [];
    bus.subscribe({ source: 'cron' }, (e) => events.push(e));
    adapter = new CronTriggerAdapter(bus, store);
  });

  afterEach(async () => {
    await adapter.stop();
    db.close();
  });

  it('interval 调度应在指定间隔触发', async () => {
    const trigger = store.create(
      {
        name: 'interval-test',
        source: 'cron',
        rule: { type: 'interval', value: 1 },
        action: { type: 'none', config: {} },
      },
      { triggerId: 'temp', scheduleType: 'interval', intervalSeconds: 1 },
    );

    await adapter.start();
    adapter.schedule(trigger.id, { triggerId: trigger.id, scheduleType: 'interval', intervalSeconds: 1 });

    await new Promise((r) => setTimeout(r, 2200));
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].type).toBe('cron_trigger');
    expect(events[0].payload.triggerId).toBe(trigger.id);
  });

  it('at 调度应在到达时间触发', async () => {
    const trigger = store.create(
      {
        name: 'at-test',
        source: 'cron',
        rule: { type: 'cron', value: 'at' },
        action: { type: 'none', config: {} },
      },
      { triggerId: 'temp', scheduleType: 'at', scheduledAt: Date.now() + 50 },
    );

    await adapter.start();
    adapter.schedule(trigger.id, { triggerId: trigger.id, scheduleType: 'at', scheduledAt: Date.now() + 50 });

    await new Promise((r) => setTimeout(r, 200));
    expect(events.length).toBe(1);
  });

  it('已过期 at 调度不应触发', async () => {
    const trigger = store.create(
      {
        name: 'at-past',
        source: 'cron',
        rule: { type: 'cron', value: 'at' },
        action: { type: 'none', config: {} },
      },
      { triggerId: 'temp', scheduleType: 'at', scheduledAt: Date.now() - 1000 },
    );

    // 不启动 adapter，避免补偿机制触发；仅验证 schedule 不会调度过期任务
    adapter.schedule(trigger.id, { triggerId: trigger.id, scheduleType: 'at', scheduledAt: Date.now() - 1000 });

    await new Promise((r) => setTimeout(r, 50));
    expect(events.length).toBe(0);
  });

  it('unschedule 应取消所有调度', async () => {
    const trigger = store.create(
      {
        name: 'unschedule-test',
        source: 'cron',
        rule: { type: 'interval', value: 1 },
        action: { type: 'none', config: {} },
      },
      { triggerId: 'temp', scheduleType: 'interval', intervalSeconds: 1 },
    );

    await adapter.start();
    adapter.schedule(trigger.id, { triggerId: trigger.id, scheduleType: 'interval', intervalSeconds: 1 });
    adapter.unschedule(trigger.id);

    await new Promise((r) => setTimeout(r, 1200));
    expect(events.length).toBe(0);
  });

  it('start 应加载数据库中 cron 触发器', async () => {
    const trigger = store.create(
      {
        name: 'auto-load',
        source: 'cron',
        rule: { type: 'interval', value: 1 },
        action: { type: 'none', config: {} },
      },
      { triggerId: 'temp', scheduleType: 'interval', intervalSeconds: 1 },
    );

    await adapter.start();

    await new Promise((r) => setTimeout(r, 1200));
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].payload.triggerId).toBe(trigger.id);
  });

  it('missed at 触发器应在 start 时补偿执行', async () => {
    const trigger = store.create(
      {
        name: 'missed',
        source: 'cron',
        rule: { type: 'cron', value: 'at' },
        action: { type: 'none', config: {} },
      },
      { triggerId: 'temp', scheduleType: 'at', scheduledAt: Date.now() - 1000 },
    );

    await adapter.start();
    await new Promise((r) => setImmediate(r));

    expect(events.length).toBe(1);
    expect(events[0].payload.triggerId).toBe(trigger.id);
  });

  it('禁用触发器不应触发', async () => {
    const trigger = store.create(
      {
        name: 'disabled',
        source: 'cron',
        rule: { type: 'interval', value: 1 },
        action: { type: 'none', config: {} },
        enabled: false,
      },
      { triggerId: 'temp', scheduleType: 'interval', intervalSeconds: 1 },
    );

    await adapter.start();

    await new Promise((r) => setTimeout(r, 1200));
    expect(events.length).toBe(0);
  });
});

describe('GameChatTriggerAdapter', () => {
  let adapter: GameChatTriggerAdapter;

  beforeEach(() => {
    adapter = new GameChatTriggerAdapter();
  });

  it('应转换完整游戏聊天事件', () => {
    const event = adapter.handle({
      workspaceId: 'ws_001',
      playerId: 'player_001',
      playerName: 'Alice',
      message: 'hello',
      rawMessage: 'hello',
      isAtBot: true,
      timestamp: 1234567890,
    });

    expect(event).not.toBeNull();
    expect(event!.type).toBe('game_chat');
    expect(event!.source).toBe('game_chat');
    expect(event!.workspaceId).toBe('ws_001');
    expect(event!.payload.message).toBe('hello');
    expect(event!.payload.isAtBot).toBe(true);
  });

  it('缺少 workspaceId 应返回 null', () => {
    expect(adapter.handle({ playerId: 'p', message: 'hi' })).toBeNull();
  });

  it('缺少 playerId 应返回 null', () => {
    expect(adapter.handle({ workspaceId: 'ws', message: 'hi' })).toBeNull();
  });

  it('缺少 message 应返回 null', () => {
    expect(adapter.handle({ workspaceId: 'ws', playerId: 'p' })).toBeNull();
  });

  it('应使用 playerId 作为默认 playerName', () => {
    const event = adapter.handle({ workspaceId: 'ws', playerId: 'p', message: 'hi' });
    expect(event!.payload.playerName).toBe('p');
  });

  it('应使用 message 作为默认 rawMessage', () => {
    const event = adapter.handle({ workspaceId: 'ws', playerId: 'p', message: 'hi' });
    expect(event!.payload.rawMessage).toBe('hi');
  });

  it('isAtBot 默认应为 false', () => {
    const event = adapter.handle({ workspaceId: 'ws', playerId: 'p', message: 'hi' });
    expect(event!.payload.isAtBot).toBe(false);
  });
});

describe('PluginEventTriggerAdapter', () => {
  let adapter: PluginEventTriggerAdapter;

  beforeEach(() => {
    adapter = new PluginEventTriggerAdapter();
  });

  it('应转换完整插件事件', () => {
    const event = adapter.handle({
      workspaceId: 'ws_001',
      eventType: 'player_hurt',
      entityId: 'player_001',
      position: { x: 1, y: 2, z: 3, dimension: 'overworld' },
      data: { damage: 5, source: 'zombie' },
    });

    expect(event).not.toBeNull();
    expect(event!.type).toBe('player_hurt');
    expect(event!.source).toBe('plugin_event');
    expect(event!.workspaceId).toBe('ws_001');
    expect(event!.payload.eventType).toBe('player_hurt');
    expect(event!.payload.data).toEqual({ damage: 5, source: 'zombie' });
  });

  it('缺少 workspaceId 应返回 null', () => {
    expect(adapter.handle({ eventType: 'player_hurt' })).toBeNull();
  });

  it('缺少 eventType 应返回 null', () => {
    expect(adapter.handle({ workspaceId: 'ws' })).toBeNull();
  });

  it('data 默认应为空对象', () => {
    const event = adapter.handle({ workspaceId: 'ws', eventType: 'test' });
    expect(event!.payload.data).toEqual({});
  });
});

describe('QQTriggerAdapter', () => {
  let adapter: QQTriggerAdapter;

  beforeEach(() => {
    adapter = new QQTriggerAdapter();
  });

  it('应转换群消息事件', () => {
    const event = adapter.handle({
      id: 'm1',
      type: 'group',
      groupId: '123',
      userId: 'u1',
      userName: 'User',
      content: 'hello',
      rawContent: 'hello',
      segments: [],
      timestamp: 1234567890,
    });

    expect(event).not.toBeNull();
    expect(event!.type).toBe('qq_group_msg');
    expect(event!.source).toBe('qq');
    expect(event!.payload.content).toBe('hello');
    expect(event!.payload.isPrivate).toBe(false);
  });

  it('应转换私聊消息事件', () => {
    const event = adapter.handle({
      id: 'm2',
      type: 'private',
      userId: 'u1',
      userName: 'User',
      content: 'hi',
      rawContent: 'hi',
      segments: [],
      timestamp: 1234567890,
    });

    expect(event!.type).toBe('qq_private_msg');
    expect(event!.payload.isPrivate).toBe(true);
  });

  it('应检测 @机器人消息', () => {
    const event = adapter.handle({
      id: 'm3',
      type: 'group',
      groupId: '123',
      userId: 'u1',
      userName: 'User',
      content: '@bot hello',
      rawContent: '@bot hello',
      segments: [{ type: 'at', data: { qq: 'u1' } }],
      timestamp: 1234567890,
    });

    expect(event!.type).toBe('qq_at_bot');
    expect(event!.payload.isAtBot).toBe(true);
  });

  it('应检测 @全体成员', () => {
    const event = adapter.handle({
      id: 'm4',
      type: 'group',
      groupId: '123',
      userId: 'u1',
      userName: 'User',
      content: '@all hello',
      rawContent: '@all hello',
      segments: [{ type: 'at', data: { qq: 'all' } }],
      timestamp: 1234567890,
    });

    expect(event!.type).toBe('qq_at_bot');
    expect(event!.payload.isAtBot).toBe(true);
  });

  it('缺少 userId 应返回 null', () => {
    expect(adapter.handle({ content: 'hi', type: 'private' })).toBeNull();
  });

  it('缺少 content 应返回 null', () => {
    expect(adapter.handle({ userId: 'u1', type: 'private' })).toBeNull();
  });

  it('应使用 userId 作为默认 userName', () => {
    const event = adapter.handle({ id: 'm5', type: 'private', userId: 'u1', content: 'hi', segments: [], timestamp: 1 });
    expect(event!.payload.userName).toBe('u1');
  });

  it('应使用 id 作为默认 messageId', () => {
    const event = adapter.handle({ id: 'm6', type: 'private', userId: 'u1', content: 'hi', segments: [], timestamp: 1 });
    expect(event!.payload.messageId).toBe('m6');
  });

  it('无 segments 时不应误判为 @机器人', () => {
    const event = adapter.handle({
      id: 'm7',
      type: 'group',
      groupId: '123',
      userId: 'u1',
      userName: 'User',
      content: 'hello',
      rawContent: 'hello',
      segments: undefined as any,
      timestamp: 1,
    });

    expect(event!.type).toBe('qq_group_msg');
    expect(event!.payload.isAtBot).toBe(false);
  });
});
