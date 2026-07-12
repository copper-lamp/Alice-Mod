import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StatusReporter } from '../../src/status/status-reporter.js';
import { createFakePlayer } from '../setup.js';

function createFakeBot(name: string, online: boolean, overrides: Partial<any> = {}): any {
  const pl = createFakePlayer({ realName: name, name, ...overrides });
  return {
    name,
    isOnline: () => online,
    getPlayer: () => (online ? pl : null),
    getInfo: () => ({ name, isOnline: online }),
  };
}

describe('StatusReporter', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('未连接时不应发送上报', () => {
    const send = vi.fn();
    const reporter = new StatusReporter({
      sendNotification: send,
      isConnected: () => false,
      getBots: () => [createFakeBot('BotA', true)],
    });

    reporter.report();
    expect(send).not.toHaveBeenCalled();
  });

  it('应按假人采集并发送多条 status_report', () => {
    const send = vi.fn();
    const reporter = new StatusReporter({
      sendNotification: send,
      isConnected: () => true,
      getBots: () => [
        createFakeBot('BotA', true, { health: 18, hunger: 16 }),
        createFakeBot('BotB', true, { health: 12, hunger: 8 }),
        createFakeBot('BotC', false),
      ],
    });

    reporter.report();

    expect(send).toHaveBeenCalledTimes(2);
    const calls = send.mock.calls.map((c) => c[1]);
    const botIds = calls.map((c) => c.bot_id).sort();
    expect(botIds).toEqual(['BotA', 'BotB']);

    const botA = calls.find((c) => c.bot_id === 'BotA');
    expect(botA.health.health).toBe(18);
    expect(botA.health.hunger).toBe(16);
    expect(botA.position.dimension).toBe('overworld');
    expect(botA.inventory_summary.total_slots).toBe(36);
    expect(botA.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('无在线假人时不应发送', () => {
    const send = vi.fn();
    const reporter = new StatusReporter({
      sendNotification: send,
      isConnected: () => true,
      getBots: () => [createFakeBot('BotA', false)],
    });

    reporter.report();
    expect(send).not.toHaveBeenCalled();
  });

  it('定时器启动后应按周期上报', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const reporter = new StatusReporter({
      sendNotification: send,
      isConnected: () => true,
      getBots: () => [createFakeBot('BotA', true)],
      intervalMs: 2000,
    });

    reporter.start();
    vi.advanceTimersByTime(2000);
    expect(send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(4000);
    expect(send).toHaveBeenCalledTimes(3);

    reporter.stop();
    vi.advanceTimersByTime(2000);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('采集耗时超过阈值应记录警告', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const originalNow = Date.now;
    let callCount = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      callCount++;
      const base = originalNow();
      return callCount === 1 ? base : base + 200;
    });

    const reporter = new StatusReporter({
      sendNotification: vi.fn(),
      isConnected: () => true,
      getBots: () => [createFakeBot('BotA', true)],
    });

    reporter.report();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
