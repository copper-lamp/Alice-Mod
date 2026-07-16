/**
 * TriggerEngine / EventBus / TriggerStore 单元测试
 *
 * 覆盖场景：
 * - EventBus 发布/订阅/过滤/清除
 * - TriggerEngine 规则匹配（keyword / regex / event_type / payload_field / composite / always）
 * - 冷却检查、最大触发次数、优先级排序
 * - 触发器日志记录与清理
 * - 插件事件去重
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { EventBus } from '../../src/main/trigger/event-bus';
import { TriggerStore } from '../../src/main/trigger/trigger-store';
import { TriggerEngine } from '../../src/main/trigger/trigger-engine';
import { ActionExecutor } from '../../src/main/trigger/action-executor';
import type { AgentEvent, EventTrigger, TriggerRule } from '../../src/main/trigger/types';

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

CREATE INDEX IF NOT EXISTS idx_event_triggers_workspace ON event_triggers(workspace_id);
CREATE INDEX IF NOT EXISTS idx_event_triggers_source ON event_triggers(source);
CREATE INDEX IF NOT EXISTS idx_event_triggers_enabled ON event_triggers(enabled);

CREATE TABLE IF NOT EXISTS trigger_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_payload TEXT,
  action_json TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  triggered_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (trigger_id) REFERENCES event_triggers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_trigger_logs_trigger ON trigger_logs(trigger_id);
CREATE INDEX IF NOT EXISTS idx_trigger_logs_event_type ON trigger_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_trigger_logs_triggered_at ON trigger_logs(triggered_at);

CREATE TABLE IF NOT EXISTS trigger_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_id TEXT NOT NULL UNIQUE,
  schedule_type TEXT NOT NULL CHECK(schedule_type IN ('cron', 'at', 'interval')),
  cron_expression TEXT,
  scheduled_at INTEGER,
  interval_seconds INTEGER,
  last_scheduled_at INTEGER,
  next_scheduled_at INTEGER,
  FOREIGN KEY (trigger_id) REFERENCES event_triggers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_trigger_schedule_next ON trigger_schedule(next_scheduled_at);
`;

function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: 'evt_001',
    type: 'game_chat',
    source: 'game_chat',
    workspaceId: 'ws_001',
    timestamp: Date.now(),
    payload: { message: 'hello world' },
    ...overrides,
  };
}

function makeTrigger(overrides: Partial<EventTrigger> = {}): EventTrigger {
  return {
    id: 'trg_001',
    workspaceId: '',
    name: '测试触发器',
    description: '',
    enabled: true,
    source: 'game_chat',
    priority: 5,
    rule: { type: 'always' },
    action: { type: 'none', config: {} },
    cooldownSeconds: 0,
    triggerCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('应异步分发事件到订阅者', async () => {
    const handler = vi.fn();
    bus.subscribe({}, handler);

    bus.publish(makeEvent());
    expect(handler).not.toHaveBeenCalled();

    await new Promise((r) => setImmediate(r));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('应按类型过滤订阅', async () => {
    const handler = vi.fn();
    bus.subscribe({ type: 'player_hurt' }, handler);

    bus.publish(makeEvent({ type: 'player_hurt' }));
    bus.publish(makeEvent({ type: 'game_chat' }));

    await new Promise((r) => setImmediate(r));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('应按来源过滤订阅', async () => {
    const handler = vi.fn();
    bus.subscribe({ source: 'plugin_event' }, handler);

    bus.publish(makeEvent({ source: 'plugin_event', type: 'player_hurt' }));
    bus.publish(makeEvent({ source: 'game_chat' }));

    await new Promise((r) => setImmediate(r));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('应按工作区过滤订阅', async () => {
    const handler = vi.fn();
    bus.subscribe({ workspaceId: 'ws_A' }, handler);

    bus.publish(makeEvent({ workspaceId: 'ws_A' }));
    bus.publish(makeEvent({ workspaceId: 'ws_B' }));

    await new Promise((r) => setImmediate(r));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('on(type) 应只接收指定类型事件', async () => {
    const handler = vi.fn();
    bus.on('game_chat', handler);

    bus.publish(makeEvent({ type: 'game_chat' }));
    bus.publish(makeEvent({ type: 'player_hurt' }));

    await new Promise((r) => setImmediate(r));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('清除后不应再分发', async () => {
    const handler = vi.fn();
    bus.subscribe({}, handler);
    bus.clear();

    bus.publish(makeEvent());
    await new Promise((r) => setImmediate(r));
    expect(handler).not.toHaveBeenCalled();
  });

  it('异步处理器异常不应阻塞其他处理器', async () => {
    const errorHandler = vi.fn().mockRejectedValue(new Error('boom'));
    const okHandler = vi.fn();
    bus.subscribe({}, errorHandler);
    bus.subscribe({}, okHandler);

    bus.publish(makeEvent());
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 10));

    expect(okHandler).toHaveBeenCalledTimes(1);
  });
});

describe('TriggerEngine 规则匹配', () => {
  let db: Database.Database;
  let store: TriggerStore;
  let engine: TriggerEngine;
  let eventBus: EventBus;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(TRIGGER_DDL);
    store = new TriggerStore(db);
    eventBus = new EventBus();
    engine = new TriggerEngine(
      {
        eventBus,
        store,
        actionExecutor: new ActionExecutor(),
      },
      { defaultCooldownSeconds: 0 },
    );
  });

  afterEach(() => {
    engine.stop();
    db.close();
  });

  it('keyword 规则应命中消息内容', () => {
    const trigger = makeTrigger({ rule: { type: 'keyword', value: 'hello' } });
    store.create({
      name: trigger.name,
      source: trigger.source,
      rule: trigger.rule,
      action: trigger.action,
    });

    const matches = engine.evaluate(makeEvent({ payload: { message: 'hello world' } }));
    expect(matches).toHaveLength(1);
  });

  it('keyword 规则大小写不敏感', () => {
    store.create({
      name: 't',
      source: 'game_chat',
      rule: { type: 'keyword', value: 'HELLO' },
      action: { type: 'none', config: {} },
    });

    const matches = engine.evaluate(makeEvent({ payload: { message: 'Hello World' } }));
    expect(matches).toHaveLength(1);
  });

  it('regex 规则应支持捕获组', () => {
    store.create({
      name: 't',
      source: 'game_chat',
      rule: { type: 'regex', value: 'kill (\\d+) zombies' },
      action: { type: 'none', config: {} },
    });

    const matches = engine.evaluate(makeEvent({ payload: { message: 'kill 5 zombies' } }));
    expect(matches).toHaveLength(1);
  });

  it('event_type 规则应命中指定类型', () => {
    store.create({
      name: 't',
      source: 'plugin_event',
      rule: { type: 'event_type', value: 'player_hurt' },
      action: { type: 'none', config: {} },
    });

    const matches = engine.evaluate(makeEvent({ source: 'plugin_event', type: 'player_hurt', workspaceId: 'ws' }));
    expect(matches).toHaveLength(1);
  });

  it('payload_field 规则应支持数值比较', () => {
    store.create({
      name: 't',
      source: 'plugin_event',
      rule: {
        type: 'payload_field',
        field: { key: 'health', op: 'lt', value: 10 },
      },
      action: { type: 'none', config: {} },
    });

    const matches = engine.evaluate(
      makeEvent({ source: 'plugin_event', type: 'player_hurt', payload: { health: 5 } }),
    );
    expect(matches).toHaveLength(1);
  });

  it('payload_field 规则应支持点号路径', () => {
    store.create({
      name: 't',
      source: 'plugin_event',
      rule: {
        type: 'payload_field',
        field: { key: 'player.health', op: 'lte', value: 5 },
      },
      action: { type: 'none', config: {} },
    });

    const matches = engine.evaluate(
      makeEvent({ source: 'plugin_event', type: 'player_hurt', payload: { player: { health: 5 } } }),
    );
    expect(matches).toHaveLength(1);
  });

  it('composite AND 规则应全部满足', () => {
    store.create({
      name: 't',
      source: 'game_chat',
      rule: {
        type: 'composite',
        operator: 'and',
        conditions: [
          { type: 'keyword', value: 'hello' },
          { type: 'keyword', value: 'world' },
        ],
      },
      action: { type: 'none', config: {} },
    });

    expect(engine.evaluate(makeEvent({ payload: { message: 'hello world' } }))).toHaveLength(1);
    expect(engine.evaluate(makeEvent({ payload: { message: 'hello' } }))).toHaveLength(0);
  });

  it('composite OR 规则应满足任一', () => {
    store.create({
      name: 't',
      source: 'game_chat',
      rule: {
        type: 'composite',
        operator: 'or',
        conditions: [
          { type: 'keyword', value: 'hello' },
          { type: 'keyword', value: 'hi' },
        ],
      },
      action: { type: 'none', config: {} },
    });

    expect(engine.evaluate(makeEvent({ payload: { message: 'hi there' } }))).toHaveLength(1);
    expect(engine.evaluate(makeEvent({ payload: { message: 'goodbye' } }))).toHaveLength(0);
  });

  it('at_bot 规则应检测 @机器人', () => {
    store.create({
      name: 't',
      source: 'game_chat',
      rule: { type: 'at_bot' },
      action: { type: 'none', config: {} },
    });

    expect(engine.evaluate(makeEvent({ payload: { isAtBot: true } }))).toHaveLength(1);
    expect(engine.evaluate(makeEvent({ payload: { isAtBot: false } }))).toHaveLength(0);
  });

  it('private_msg 规则应检测私聊', () => {
    store.create({
      name: 't',
      source: 'qq',
      rule: { type: 'private_msg' },
      action: { type: 'none', config: {} },
    });

    expect(engine.evaluate(makeEvent({ source: 'qq', type: 'private', payload: { isPrivate: true } }))).toHaveLength(1);
    expect(engine.evaluate(makeEvent({ source: 'qq', type: 'qq_group_msg', payload: {} }))).toHaveLength(0);
  });

  it('禁用触发器不应命中', () => {
    store.create({
      name: 't',
      source: 'game_chat',
      rule: { type: 'always' },
      action: { type: 'none', config: {} },
      enabled: false,
    });

    expect(engine.evaluate(makeEvent())).toHaveLength(0);
  });

  it('不同工作区触发器不应跨区命中', () => {
    store.create({
      name: 't',
      source: 'game_chat',
      rule: { type: 'always' },
      action: { type: 'none', config: {} },
      workspaceId: 'ws_A',
    });

    expect(engine.evaluate(makeEvent({ workspaceId: 'ws_A' }))).toHaveLength(1);
    expect(engine.evaluate(makeEvent({ workspaceId: 'ws_B' }))).toHaveLength(0);
  });

  it('不同来源触发器不应跨来源命中', () => {
    store.create({
      name: 't',
      source: 'game_chat',
      rule: { type: 'always' },
      action: { type: 'none', config: {} },
    });

    expect(engine.evaluate(makeEvent({ source: 'game_chat' }))).toHaveLength(1);
    expect(engine.evaluate(makeEvent({ source: 'qq' }))).toHaveLength(0);
  });

  it('应按优先级降序排序', () => {
    store.create({ name: 'low', source: 'game_chat', rule: { type: 'always' }, action: { type: 'none', config: {} }, priority: 1 });
    store.create({ name: 'high', source: 'game_chat', rule: { type: 'always' }, action: { type: 'none', config: {} }, priority: 9 });

    const matches = engine.evaluate(makeEvent());
    expect(matches[0].trigger.name).toBe('high');
    expect(matches[1].trigger.name).toBe('low');
  });

  it('插件事件应在 5 秒窗口内去重', async () => {
    const executeSpy = vi.fn().mockResolvedValue({ success: true });
    engine = new TriggerEngine(
      {
        eventBus,
        store,
        actionExecutor: new ActionExecutor({ sendQQ: executeSpy }),
      },
      { defaultCooldownSeconds: 0 },
    );

    store.create({
      name: 't',
      source: 'plugin_event',
      rule: { type: 'always' },
      action: { type: 'send_qq', config: { target: 'g', content: 'hi' } },
    });

    engine.start();

    const event = makeEvent({ source: 'plugin_event', type: 'player_hurt', payload: { health: 5 } });
    eventBus.publish(event);
    eventBus.publish(event);

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 20));

    expect(executeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('TriggerEngine 执行与限制', () => {
  let db: Database.Database;
  let store: TriggerStore;
  let engine: TriggerEngine;
  let executor: ActionExecutor;
  let eventBus: EventBus;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(TRIGGER_DDL);
    store = new TriggerStore(db);
    executor = new ActionExecutor();
    eventBus = new EventBus();
    engine = new TriggerEngine(
      { eventBus, store, actionExecutor: executor },
      { defaultCooldownSeconds: 0 },
    );
  });

  afterEach(() => {
    engine.stop();
    db.close();
  });

  it('冷却期间同一触发器不应重复执行', async () => {
    const executeSpy = vi.fn().mockResolvedValue({ success: true });
    executor.setDeps({
      sendQQ: async () => {
        await executeSpy();
        return true;
      },
    });

    store.create({
      name: 't',
      source: 'game_chat',
      rule: { type: 'always' },
      action: { type: 'send_qq', config: { target: 'g', content: 'hi' } },
      cooldownSeconds: 1,
    });

    engine.start();
    eventBus.publish(makeEvent());
    eventBus.publish(makeEvent());

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 20));

    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  it('达到最大触发次数后不应再执行', async () => {
    const executeSpy = vi.fn().mockResolvedValue({ success: true });
    executor.setDeps({
      sendQQ: async () => {
        await executeSpy();
        return true;
      },
    });

    store.create({
      name: 't',
      source: 'game_chat',
      rule: { type: 'always' },
      action: { type: 'send_qq', config: { target: 'g', content: 'hi' } },
      maxTriggerCount: 2,
      cooldownSeconds: 0,
    });

    engine.start();
    eventBus.publish(makeEvent());
    eventBus.publish(makeEvent());
    eventBus.publish(makeEvent());

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 30));

    expect(executeSpy).toHaveBeenCalledTimes(2);
  });

  it('执行失败应记录错误日志', async () => {
    executor.setDeps({
      sendQQ: async () => {
        throw new Error('send failed');
      },
    });

    const trigger = store.create({
      name: 't',
      source: 'game_chat',
      rule: { type: 'always' },
      action: { type: 'send_qq', config: { target: 'g', content: 'hi' } },
    });

    engine.start();
    eventBus.publish(makeEvent());

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 20));

    const logs = store.getLogs(trigger.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].success).toBe(false);
    expect(logs[0].error).toContain('send failed');
  });

  it('日志清理不应删除近期日志', () => {
    const trigger = store.create({
      name: 't',
      source: 'game_chat',
      rule: { type: 'always' },
      action: { type: 'none', config: {} },
    });

    store.logExecution({
      triggerId: trigger.id,
      eventType: 'game_chat',
      action: { type: 'none', config: {} },
      success: true,
      triggeredAt: Date.now(),
    });

    store.cleanupLogs(30, 1000);
    expect(store.getLogs(trigger.id)).toHaveLength(1);
  });
});

describe('TriggerStore CRUD', () => {
  let db: Database.Database;
  let store: TriggerStore;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(TRIGGER_DDL);
    store = new TriggerStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('应创建触发器并自动生成 ID', () => {
    const trigger = store.create({
      name: 'test',
      source: 'game_chat',
      rule: { type: 'always' },
      action: { type: 'none', config: {} },
    });

    expect(trigger.id).toBeDefined();
    expect(trigger.enabled).toBe(true);
  });

  it('应按 ID 查询触发器', () => {
    const trigger = store.create({
      name: 'test',
      source: 'game_chat',
      rule: { type: 'always' },
      action: { type: 'none', config: {} },
    });

    expect(store.getById(trigger.id)).toEqual(trigger);
    expect(store.getById('not-exist')).toBeNull();
  });

  it('应更新触发器', () => {
    const trigger = store.create({
      name: 'test',
      source: 'game_chat',
      rule: { type: 'always' },
      action: { type: 'none', config: {} },
    });

    const updated = store.update(trigger.id, { name: 'updated', enabled: false });
    expect(updated?.name).toBe('updated');
    expect(updated?.enabled).toBe(false);
  });

  it('应删除触发器', () => {
    const trigger = store.create({
      name: 'test',
      source: 'game_chat',
      rule: { type: 'always' },
      action: { type: 'none', config: {} },
    });

    expect(store.delete(trigger.id)).toBe(true);
    expect(store.delete(trigger.id)).toBe(false);
  });

  it('应按来源过滤列表', () => {
    store.create({ name: 'a', source: 'game_chat', rule: { type: 'always' }, action: { type: 'none', config: {} } });
    store.create({ name: 'b', source: 'qq', rule: { type: 'always' }, action: { type: 'none', config: {} } });

    expect(store.list({ source: 'game_chat' })).toHaveLength(1);
    expect(store.list({})).toHaveLength(2);
  });

  it('应保存和读取调度配置', () => {
    const trigger = store.create(
      { name: 't', source: 'cron', rule: { type: 'cron', value: '0 * * * *' }, action: { type: 'none', config: {} } },
      { triggerId: 'temp', scheduleType: 'cron', cronExpression: '0 * * * *' },
    );

    const schedule = store.getSchedule(trigger.id);
    expect(schedule?.scheduleType).toBe('cron');
    expect(schedule?.cronExpression).toBe('0 * * * *');
  });
});
