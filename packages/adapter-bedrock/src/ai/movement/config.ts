/**
 * 移动模块配置管理
 *
 * 合并默认值、config.json、工具参数三级配置。
 */

import type { PathOptions, BlockInteractionOptions } from '../pathfinding/types.js';
import {
  DEFAULT_MAX_RANGE,
  DEFAULT_CACHE_SIZE,
  DEFAULT_ASYNC_NODES_PER_TICK,
  DEFAULT_TIMEOUT_MS,
  SPRINT_MIN_HUNGER,
  ELYTRA_MIN_DISTANCE,
  ENEMY_REACTION_RADIUS,
  AVOID_HOSTILE_RADIUS,
  LOW_HEALTH_THRESHOLD,
  FALL_DAMAGE_THRESHOLD,
  DEFAULT_MAX_BLOCKS_TO_BREAK,
  DEFAULT_MAX_BLOCKS_TO_PLACE,
  DEFAULT_UNBREAKABLE_BLOCKS,
  DEFAULT_PROTECTED_BLOCKS,
  DEFAULT_PREFERRED_PLACE_BLOCKS,
} from '../shared/movement-constants.js';

// ── 运行时完整配置 ──

export interface MovementConfig {
  enabled: boolean;
  maxRange: number;
  cacheSize: number;
  asyncNodesPerTick: number;
  sprint: {
    enabled: boolean;
    minHunger: number;
  };
  swim: {
    enabled: boolean;
  };
  elytra: {
    enabled: boolean;
    minDistance: number;
    requireFirework: boolean;
  };
  blockInteraction: BlockInteractionOptions;
  conditions: {
    avoidHostileRadius: number;
    enemyReactionRadius: number;
    lowHealthThreshold: number;
    fallDamageThreshold: number;
    onEnemyDetected: 'pause' | 'retreat' | 'stop';
    onLowHealth: 'pause' | 'stop';
  };
}

// ── 默认配置 ──

const DEFAULT_CONFIG: MovementConfig = {
  enabled: true,
  maxRange: DEFAULT_MAX_RANGE,
  cacheSize: DEFAULT_CACHE_SIZE,
  asyncNodesPerTick: DEFAULT_ASYNC_NODES_PER_TICK,
  sprint: {
    enabled: true,
    minHunger: SPRINT_MIN_HUNGER,
  },
  swim: {
    enabled: true,
  },
  elytra: {
    enabled: false,
    minDistance: ELYTRA_MIN_DISTANCE,
    requireFirework: true,
  },
  blockInteraction: {
    allowBreak: false,
    allowPlace: false,
    maxBlocksToBreak: DEFAULT_MAX_BLOCKS_TO_BREAK,
    maxBlocksToPlace: DEFAULT_MAX_BLOCKS_TO_PLACE,
    unbreakableBlocks: DEFAULT_UNBREAKABLE_BLOCKS,
    protectedBlocks: DEFAULT_PROTECTED_BLOCKS,
    preferredBlock: DEFAULT_PREFERRED_PLACE_BLOCKS[0],
  },
  conditions: {
    avoidHostileRadius: AVOID_HOSTILE_RADIUS,
    enemyReactionRadius: ENEMY_REACTION_RADIUS,
    lowHealthThreshold: LOW_HEALTH_THRESHOLD,
    fallDamageThreshold: FALL_DAMAGE_THRESHOLD,
    onEnemyDetected: 'pause',
    onLowHealth: 'stop',
  },
};

// ── 配置合并 ──

export class MovementConfigManager {
  private static instance: MovementConfigManager;
  private fileConfig: Partial<MovementConfig> = {};

  static getInstance(): MovementConfigManager {
    if (!MovementConfigManager.instance) {
      MovementConfigManager.instance = new MovementConfigManager();
    }
    return MovementConfigManager.instance;
  }

  /**
   * 从 config.json 加载配置（若存在）
   */
  loadFromFile(): void {
    try {
      if (typeof File === 'undefined' || !File.exists('./plugins/Alices Mod/config.json')) {
        this.fileConfig = {};
        return;
      }
      const content = File.readFrom('./plugins/Alices Mod/config.json');
      if (!content) return;
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object' && parsed.pathfinding) {
        this.fileConfig = this.normalizeFileConfig(parsed.pathfinding);
      }
    } catch (e) {
      logger.warn('[MovementConfig] 加载 config.json 失败，使用默认配置', e);
      this.fileConfig = {};
    }
  }

  /**
   * 合并配置：默认值 < config.json < 工具参数
   */
  merge(options: PathOptions = {}): Required<PathOptions> {
    const file = this.fileConfig;
    const blockInteraction = (file.blockInteraction || {}) as Partial<BlockInteractionOptions>;

    return {
      timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
      avoidHostile: options.avoidHostile ?? (file.conditions?.avoidHostileRadius !== undefined ? true : false),
      allowSprint: options.allowSprint ?? file.sprint?.enabled ?? DEFAULT_CONFIG.sprint.enabled,
      allowBreak: options.allowBreak ?? blockInteraction.allowBreak ?? DEFAULT_CONFIG.blockInteraction.allowBreak,
      allowPlace: options.allowPlace ?? blockInteraction.allowPlace ?? DEFAULT_CONFIG.blockInteraction.allowPlace,
      allowSwim: options.allowSwim ?? file.swim?.enabled ?? DEFAULT_CONFIG.swim.enabled,
      allowElytra: options.allowElytra ?? file.elytra?.enabled ?? DEFAULT_CONFIG.elytra.enabled,
      maxBlocksToBreak: options.maxBlocksToBreak ?? blockInteraction.maxBlocksToBreak ?? DEFAULT_CONFIG.blockInteraction.maxBlocksToBreak,
      maxBlocksToPlace: options.maxBlocksToPlace ?? blockInteraction.maxBlocksToPlace ?? DEFAULT_CONFIG.blockInteraction.maxBlocksToPlace,
      preferredBlock: options.preferredBlock ?? blockInteraction.preferredBlock ?? DEFAULT_CONFIG.blockInteraction.preferredBlock,
      maxRange: options.maxRange ?? file.maxRange ?? DEFAULT_CONFIG.maxRange,
      pathfinding: options.pathfinding ?? 'astar',
    };
  }

  /**
   * 获取运行时完整配置（用于执行层条件判断）
   */
  getRuntimeConfig(): MovementConfig {
    return this.mergeRuntime(DEFAULT_CONFIG, this.fileConfig);
  }

  /**
   * 获取方块交互配置
   */
  getBlockInteractionOptions(options: Required<PathOptions>): BlockInteractionOptions {
    const file = this.fileConfig;
    const blockInteraction = (file.blockInteraction || {}) as Partial<BlockInteractionOptions>;

    return {
      allowBreak: options.allowBreak,
      allowPlace: options.allowPlace,
      maxBlocksToBreak: options.maxBlocksToBreak,
      maxBlocksToPlace: options.maxBlocksToPlace,
      preferredBlock: options.preferredBlock,
      unbreakableBlocks: this.mergeSet(blockInteraction.unbreakableBlocks, DEFAULT_UNBREAKABLE_BLOCKS),
      protectedBlocks: this.mergeSet(blockInteraction.protectedBlocks, DEFAULT_PROTECTED_BLOCKS),
    };
  }

  private normalizeFileConfig(input: any): Partial<MovementConfig> {
    const result: Partial<MovementConfig> = {};

    if (typeof input.enabled === 'boolean') result.enabled = input.enabled;
    if (typeof input.maxRange === 'number') result.maxRange = input.maxRange;
    if (typeof input.cacheSize === 'number') result.cacheSize = input.cacheSize;
    if (typeof input.asyncNodesPerTick === 'number') result.asyncNodesPerTick = input.asyncNodesPerTick;

    if (input.sprint && typeof input.sprint === 'object') {
      result.sprint = {
        enabled: input.sprint.enabled ?? DEFAULT_CONFIG.sprint.enabled,
        minHunger: input.sprint.minHunger ?? DEFAULT_CONFIG.sprint.minHunger,
      };
    }

    if (input.swim && typeof input.swim === 'object') {
      result.swim = { enabled: input.swim.enabled ?? DEFAULT_CONFIG.swim.enabled };
    }

    if (input.elytra && typeof input.elytra === 'object') {
      result.elytra = {
        enabled: input.elytra.enabled ?? DEFAULT_CONFIG.elytra.enabled,
        minDistance: input.elytra.minDistance ?? DEFAULT_CONFIG.elytra.minDistance,
        requireFirework: input.elytra.requireFirework ?? DEFAULT_CONFIG.elytra.requireFirework,
      };
    }

    if (input.blockInteraction && typeof input.blockInteraction === 'object') {
      result.blockInteraction = {
        allowBreak: input.blockInteraction.allowBreak ?? DEFAULT_CONFIG.blockInteraction.allowBreak,
        allowPlace: input.blockInteraction.allowPlace ?? DEFAULT_CONFIG.blockInteraction.allowPlace,
        maxBlocksToBreak: input.blockInteraction.maxBlocksToBreak ?? DEFAULT_CONFIG.blockInteraction.maxBlocksToBreak,
        maxBlocksToPlace: input.blockInteraction.maxBlocksToPlace ?? DEFAULT_CONFIG.blockInteraction.maxBlocksToPlace,
        preferredBlock: input.blockInteraction.preferredBlock ?? DEFAULT_CONFIG.blockInteraction.preferredBlock,
        unbreakableBlocks: this.arrayToSet(input.blockInteraction.unbreakableBlocks, DEFAULT_UNBREAKABLE_BLOCKS),
        protectedBlocks: this.arrayToSet(input.blockInteraction.protectedBlocks, DEFAULT_PROTECTED_BLOCKS),
      };
    }

    if (input.conditions && typeof input.conditions === 'object') {
      result.conditions = {
        avoidHostileRadius: input.conditions.avoidHostileRadius ?? DEFAULT_CONFIG.conditions.avoidHostileRadius,
        enemyReactionRadius: input.conditions.enemyReactionRadius ?? DEFAULT_CONFIG.conditions.enemyReactionRadius,
        lowHealthThreshold: input.conditions.lowHealthThreshold ?? DEFAULT_CONFIG.conditions.lowHealthThreshold,
        fallDamageThreshold: input.conditions.fallDamageThreshold ?? DEFAULT_CONFIG.conditions.fallDamageThreshold,
        onEnemyDetected: input.conditions.onEnemyDetected ?? DEFAULT_CONFIG.conditions.onEnemyDetected,
        onLowHealth: input.conditions.onLowHealth ?? DEFAULT_CONFIG.conditions.onLowHealth,
      };
    }

    return result;
  }

  private mergeRuntime(defaults: MovementConfig, file: Partial<MovementConfig>): MovementConfig {
    return {
      enabled: file.enabled ?? defaults.enabled,
      maxRange: file.maxRange ?? defaults.maxRange,
      cacheSize: file.cacheSize ?? defaults.cacheSize,
      asyncNodesPerTick: file.asyncNodesPerTick ?? defaults.asyncNodesPerTick,
      sprint: { ...defaults.sprint, ...file.sprint },
      swim: { ...defaults.swim, ...file.swim },
      elytra: { ...defaults.elytra, ...file.elytra },
      blockInteraction: { ...defaults.blockInteraction, ...file.blockInteraction },
      conditions: { ...defaults.conditions, ...file.conditions },
    } as MovementConfig;
  }

  private mergeSet(custom: string[] | Set<string> | undefined, fallback: Set<string>): Set<string> {
    if (!custom) return fallback;
    const arr = Array.isArray(custom) ? custom : Array.from(custom);
    if (arr.length === 0) return fallback;
    return new Set([...fallback, ...arr]);
  }

  private arrayToSet(arr: string[] | undefined, fallback: Set<string>): Set<string> {
    if (!Array.isArray(arr)) return fallback;
    return new Set(arr);
  }
}

export const movementConfig = MovementConfigManager.getInstance();
