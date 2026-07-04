import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeartbeatManager, HeartbeatEvent, HeartbeatState } from '../../src/main/tcp/heartbeat';

describe('HeartbeatManager (心跳管理)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start in idle state', () => {
    const onEvent = vi.fn();
    const hb = new HeartbeatManager({}, onEvent);
    expect(hb.currentState).toBe(HeartbeatState.Idle);
    expect(hb.isHealthy).toBe(true);
  });

  it('should send ping immediately on start', () => {
    const onEvent = vi.fn();
    const sendPing = vi.fn();
    const hb = new HeartbeatManager({ interval: 10000, timeout: 30000, maxFailures: 5 }, onEvent);
    hb.start(sendPing);

    expect(sendPing).toHaveBeenCalledTimes(1);
    expect(hb.currentState).toBe(HeartbeatState.Waiting);
  });

  it('should send ping periodically', () => {
    const onEvent = vi.fn();
    const sendPing = vi.fn();
    const hb = new HeartbeatManager({ interval: 10000, timeout: 30000, maxFailures: 5 }, onEvent);
    hb.start(sendPing);

    // Advance by 10s
    vi.advanceTimersByTime(10000);
    expect(sendPing).toHaveBeenCalledTimes(2);

    // Advance by another 10s
    vi.advanceTimersByTime(10000);
    expect(sendPing).toHaveBeenCalledTimes(3);
  });

  it('should restore on pong after timeout', () => {
    const onEvent = vi.fn();
    const sendPing = vi.fn();
    const hb = new HeartbeatManager({ interval: 10000, timeout: 5000, maxFailures: 5 }, onEvent);
    hb.start(sendPing);

    // Advance past timeout
    vi.advanceTimersByTime(6000);
    expect(hb.currentState).toBe(HeartbeatState.Failed);
    expect(onEvent).toHaveBeenCalledWith(HeartbeatEvent.Timeout, expect.any(Object));

    // Receive pong
    hb.receivePong();
    expect(hb.currentState).toBe(HeartbeatState.Idle);
    expect(onEvent).toHaveBeenCalledWith(HeartbeatEvent.Restored);
  });

  it('should trigger failed after max failures', () => {
    const onEvent = vi.fn();
    const sendPing = vi.fn();
    const hb = new HeartbeatManager({ interval: 1000, timeout: 500, maxFailures: 3 }, onEvent);
    hb.start(sendPing);

    // 1st timeout
    vi.advanceTimersByTime(600);
    expect(onEvent).toHaveBeenCalledWith(HeartbeatEvent.Timeout, expect.any(Object));

    // 2nd ping + timeout
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(600);

    // 3rd ping + timeout → should trigger Failed
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(600);

    expect(onEvent).toHaveBeenCalledWith(HeartbeatEvent.Failed, expect.any(Object));
  });

  it('should stop and clean up timers', () => {
    const onEvent = vi.fn();
    const sendPing = vi.fn();
    const hb = new HeartbeatManager({ interval: 1000, timeout: 500, maxFailures: 5 }, onEvent);
    hb.start(sendPing);
    hb.stop();

    expect(hb.currentState).toBe(HeartbeatState.Stopped);

    // Advance time - no more pings
    vi.advanceTimersByTime(10000);
    expect(sendPing).toHaveBeenCalledTimes(1); // Only the initial one
  });

  it('should track pong timestamps', () => {
    const onEvent = vi.fn();
    const sendPing = vi.fn();
    const hb = new HeartbeatManager({ interval: 10000, timeout: 30000, maxFailures: 5 }, onEvent);
    hb.start(sendPing);

    expect(hb.lastPong).toBe(0);

    hb.receivePong();
    expect(hb.lastPong).toBeGreaterThan(0);
  });
});
