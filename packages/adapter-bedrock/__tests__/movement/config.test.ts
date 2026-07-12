import { describe, it, expect, beforeEach } from 'vitest';
import { MovementConfigManager } from '../../src/ai/movement/config.js';
import type { PathOptions } from '../../src/ai/pathfinding/types.js';

describe('MovementConfigManager', () => {
  let config: MovementConfigManager;

  beforeEach(() => {
    config = new MovementConfigManager();
  });

  it('默认配置包含所有必需字段', () => {
    const merged = config.merge();
    expect(merged.allowSprint).toBe(true);
    expect(merged.allowBreak).toBe(false);
    expect(merged.allowPlace).toBe(false);
    expect(merged.allowElytra).toBe(false);
    expect(merged.maxRange).toBe(128);
  });

  it('工具参数覆盖默认值', () => {
    const options: PathOptions = {
      allowElytra: true,
      allowBreak: true,
      maxRange: 256,
    };
    const merged = config.merge(options);
    expect(merged.allowElytra).toBe(true);
    expect(merged.allowBreak).toBe(true);
    expect(merged.maxRange).toBe(256);
  });

  it('方块交互配置合并黑名单', () => {
    const options = config.merge({ allowBreak: true });
    const bi = config.getBlockInteractionOptions(options);
    expect(bi.allowBreak).toBe(true);
    expect(bi.unbreakableBlocks.has('bedrock')).toBe(true);
    expect(bi.protectedBlocks.has('chest')).toBe(true);
  });
});
