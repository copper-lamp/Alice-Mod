import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolContextImpl, PlayerAccessImpl, BotAccessImpl } from '../../src/registry/tool-context.js';
import { BotManager } from '../../src/bot/BotManager.js';
import { resetFileStore, resetMcState, createFakePlayer, setOnlinePlayers } from '../setup.js';

function uniqueName(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

describe('ToolContext / BotAccess', () => {
  let createdNames: string[] = [];

  beforeEach(() => {
    resetFileStore();
    resetMcState();
    createdNames = [];
    BotManager.init();
  });

  afterEach(() => {
    for (const name of createdNames) {
      const bot = BotManager.get(name);
      if (bot && bot.isOnline()) {
        BotManager.offline(name, false);
      }
      if (BotManager.get(name)) {
        BotManager.remove(name);
      }
    }
  });

  it('BotAccess 应能管理假人', () => {
    const botAccess = new BotAccessImpl();
    const name = uniqueName('CtxBot');

    const created = botAccess.createBot({ name, pos: { x: 1, y: 64, z: 1, dimid: 0 } });
    createdNames.push(name);

    expect(typeof created).not.toBe('string');
    expect(botAccess.getBot(name)).not.toBeNull();
    expect(botAccess.listBots().some((b) => b.name === name)).toBe(true);

    const setOk = botAccess.setActiveBot(name);
    expect(setOk).toBe(true);
    expect(botAccess.getActiveBot()?.name).toBe(name);

    expect(botAccess.destroyBot(name)).toBe(true);
    createdNames = [];
    expect(botAccess.getBot(name)).toBeNull();
  });

  it('ToolContext 未指定 active bot 时应回退到首个在线玩家', () => {
    const fakePlayer = createFakePlayer({ realName: 'RealPlayer', health: 15, hunger: 18 });
    setOnlinePlayers([fakePlayer]);

    const ctx = new ToolContextImpl({});
    expect(ctx.player.getHealth()).toBe(15);
    expect(ctx.player.getHunger()).toBe(18);
  });

  it('ToolContext 指定 activeBotName 后 player 应指向该假人', () => {
    const name = uniqueName('ActiveBot');
    BotManager.create(name, { x: 0, y: 64, z: 0, dimid: 0 });
    createdNames.push(name);
    BotManager.online(name);

    const fakePlayer = createFakePlayer({
      realName: name,
      name,
      health: 8,
      hunger: 5,
      pos: { x: 10, y: 70, z: -10, dimid: 0 },
    });
    setOnlinePlayers([fakePlayer]);

    const ctx = new ToolContextImpl({ activeBotName: name });
    expect(ctx.player.getHealth()).toBe(8);
    expect(ctx.player.getHunger()).toBe(5);
    expect(ctx.player.getPosition()).toMatchObject({ x: 10, y: 70, z: -10 });
  });

  it('PlayerAccess 应返回默认安全值', () => {
    setOnlinePlayers([]);
    const access = new PlayerAccessImpl();

    expect(access.getHealth()).toBe(0);
    expect(access.getMaxHealth()).toBe(20);
    expect(access.getHunger()).toBe(20);
    expect(access.getPosition()).toMatchObject({ x: 0, y: 64, z: 0 });
    expect(access.getRotation()).toMatchObject({ yaw: 0, pitch: 0 });
  });

  it('ToolContext 应能发送事件', () => {
    const events: any[] = [];
    const ctx = new ToolContextImpl({
      sendEvent: (e) => events.push(e),
    });

    ctx.sendEvent({ type: 'test_event', data: { foo: 'bar' }, timestamp: new Date().toISOString() });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('test_event');
    expect(ctx.getElapsedMs()).toBeGreaterThanOrEqual(0);
  });
});
