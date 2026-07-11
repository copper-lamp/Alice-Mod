import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TCP_CONFIG,
  PROTOCOL_VERSION,
  VERSION,
  TOOL,
  AC_TOOL_COUNT,
  ADAPTER_TOOL_COUNT,
  TOTAL_TOOL_COUNT,
  CONTEXT,
  SCHEDULER,
  DB_NAME,
  PROJECT_NAME,
} from '../src/constants/index.js';

describe('constants', () => {
  describe('DEFAULT_TCP_CONFIG', () => {
    it('should use port 27541 per spec', () => {
      expect(DEFAULT_TCP_CONFIG.port).toBe(27541);
    });

    it('should listen on all interfaces', () => {
      expect(DEFAULT_TCP_CONFIG.host).toBe('0.0.0.0');
    });

    it('should have max 10 connections', () => {
      expect(DEFAULT_TCP_CONFIG.maxConnections).toBe(10);
    });

    it('should have 10s heartbeat interval', () => {
      expect(DEFAULT_TCP_CONFIG.heartbeatInterval).toBe(10000);
    });

    it('should have 30s heartbeat timeout', () => {
      expect(DEFAULT_TCP_CONFIG.heartbeatTimeout).toBe(30000);
    });

    it('should have 1s base reconnect delay', () => {
      expect(DEFAULT_TCP_CONFIG.reconnectBaseDelay).toBe(1000);
    });

    it('should have max 5 reconnect attempts', () => {
      expect(DEFAULT_TCP_CONFIG.reconnectMaxAttempts).toBe(5);
    });
  });

  describe('VERSION', () => {
    it('should return 1.0.0', () => {
      expect(VERSION.toString()).toBe('1.0.0');
    });
  });

  describe('PROTOCOL_VERSION', () => {
    it('should be 1.0.0 per spec', () => {
      expect(PROTOCOL_VERSION).toBe('1.0.0');
    });
  });

  describe('TOOL', () => {
    it('should have 30s max execution time', () => {
      expect(TOOL.MAX_EXECUTION_TIME).toBe(30000);
    });

    it('should have max 3 retries', () => {
      expect(TOOL.MAX_RETRIES).toBe(3);
    });

    it('should have 30s initial retry delay', () => {
      expect(TOOL.initialRetryDelay).toBe(30000);
    });

    it('should have 2.0 retry multiplier', () => {
      expect(TOOL.retryMultiplier).toBe(2.0);
    });
  });

  describe('tool counts', () => {
    it('should have 17 AC tools', () => {
      expect(AC_TOOL_COUNT).toBe(17);
    });

    it('should have 26 Adapter tools', () => {
      expect(ADAPTER_TOOL_COUNT).toBe(26);
    });

    it('should have 43 total tools', () => {
      expect(TOTAL_TOOL_COUNT).toBe(43);
    });
  });

  describe('CONTEXT', () => {
    it('should have 20 max conversation turns', () => {
      expect(CONTEXT.MAX_CONVERSATION_TURNS).toBe(20);
    });

    it('should have 150 player state tokens', () => {
      expect(CONTEXT.PLAYER_STATE_TOKENS).toBe(150);
    });
  });

  describe('SCHEDULER', () => {
    it('should allow max 3 concurrent tasks', () => {
      expect(SCHEDULER.maxConcurrent).toBe(3);
    });

    it('should poll every 1s', () => {
      expect(SCHEDULER.pollIntervalMs).toBe(1000);
    });
  });

  describe('DB_NAME', () => {
    it('should be alice-mod.db', () => {
      expect(DB_NAME).toBe('alice-mod.db');
    });
  });

  describe('PROJECT_NAME', () => {
    it('should be Alice Mod', () => {
      expect(PROJECT_NAME).toBe('Alice Mod');
    });
  });
});
