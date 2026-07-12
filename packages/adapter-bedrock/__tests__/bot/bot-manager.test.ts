import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BotManager } from '../../src/bot/BotManager.js';
import { resetFileStore, resetMcState, createFakePlayer, setOnlinePlayers } from '../setup.js';

function uniqueName(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

describe('BotManager', () => {
  let createdNames: string[] = [];
  let listener: any = null;

  beforeEach(() => {
    resetFileStore();
    resetMcState();
    createdNames = [];
    listener = null;
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
    if (listener) {
      BotManager.offEvent(listener);
    }
  });

  it('应能创建并查询假人', () => {
    const name = uniqueName('CreateBot');
    const result = BotManager.create(name, { x: 10, y: 64, z: -5, dimid: 0 }, 'owner1');
    createdNames.push(name);

    expect(result).toBe('');
    const bot = BotManager.get(name);
    expect(bot).not.toBeNull();
    expect(bot!.name).toBe(name);
    expect(bot!.getOwner()).toBe('owner1');
    expect(BotManager.list()).toContain(name);
  });

  it('同名创建应返回错误', () => {
    const name = uniqueName('DupBot');
    BotManager.create(name, { x: 0, y: 64, z: 0, dimid: 0 });
    createdNames.push(name);

    const result = BotManager.create(name, { x: 1, y: 64, z: 1, dimid: 0 });
    expect(result).toContain('已存在');
  });

  it('应能上线并下线假人', () => {
    const name = uniqueName('OnlineBot');
    BotManager.create(name, { x: 0, y: 64, z: 0, dimid: 0 });
    createdNames.push(name);

    const onlineResult = BotManager.online(name);
    expect(onlineResult).toBe('');
    expect(BotManager.get(name)!.isOnline()).toBe(true);

    const offlineResult = BotManager.offline(name);
    expect(offlineResult).toBe('');
    expect(BotManager.get(name)!.isOnline()).toBe(false);
  });

  it('应持久化假人数据到文件', () => {
    const name = uniqueName('PersistBot');
    BotManager.create(name, { x: 7, y: 70, z: 9, dimid: 1 });
    createdNames.push(name);

    const saveOk = BotManager.saveData(name, false);
    expect(saveOk).toBe(true);

    // 重新加载应能恢复（直接重新加载，内存实例会被文件数据覆盖）
    const loadOk = BotManager.loadAllData();
    expect(loadOk).toBe(true);

    const restored = BotManager.get(name);
    expect(restored).not.toBeNull();
    expect(restored!.getPos().x).toBe(7);
    expect(restored!.getPos().dimid).toBe(1);

    createdNames.push(name);
  });

  it('应支持多个假人共存', () => {
    const names = [uniqueName('MultiA'), uniqueName('MultiB'), uniqueName('MultiC')];
    for (const name of names) {
      BotManager.create(name, { x: 0, y: 64, z: 0, dimid: 0 });
      createdNames.push(name);
    }

    expect(BotManager.getAll().length).toBeGreaterThanOrEqual(3);
    expect(BotManager.list()).toEqual(expect.arrayContaining(names));
  });

  it('死亡频率过高应自动下线', () => {
    const name = uniqueName('DeathBot');
    BotManager.create(name, { x: 0, y: 64, z: 0, dimid: 0 });
    createdNames.push(name);
    BotManager.online(name);

    const fakePlayer = createFakePlayer({ realName: name, name });
    setOnlinePlayers([fakePlayer]);

    for (let i = 0; i < 8; i++) {
      BotManager.onPlayerDie(fakePlayer, 'zombie');
    }

    expect(BotManager.get(name)!.isOnline()).toBe(false);
  });

  it('应正确发出状态变更事件', () => {
    const events: any[] = [];
    listener = (e: any) => events.push(e);
    BotManager.onEvent(listener);

    const name = uniqueName('EventBot');
    BotManager.create(name, { x: 0, y: 64, z: 0, dimid: 0 });
    createdNames.push(name);
    BotManager.online(name);
    BotManager.offline(name);

    expect(events.map((e) => e.type)).toEqual(['created', 'online', 'offline']);
    expect(events.every((e) => e.botName === name)).toBe(true);
  });
});
