/**
 * 配置管理器
 *
 * 负责读取 config.json 并提供运行时配置访问。
 * V6 新增生存与方块操作相关配置项。
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export interface SurvivalConfig {
  eat: {
    max_search_radius: number;
  };
  sleep: {
    max_bed_search_radius: number;
    max_wait_ms: number;
  };
}

export interface BlockConfig {
  max_area_operation_blocks: number;
  tool_durability_threshold: number;
  allow_alternative_materials: boolean;
}

export interface AppOptions {
  host?: string;
  port?: number;
  debug?: boolean;
  survival?: Partial<SurvivalConfig>;
  block?: Partial<BlockConfig>;
}

export const DEFAULT_SURVIVAL_CONFIG: SurvivalConfig = {
  eat: { max_search_radius: 0 },
  sleep: { max_bed_search_radius: 32, max_wait_ms: 60000 },
};

export const DEFAULT_BLOCK_CONFIG: BlockConfig = {
  max_area_operation_blocks: 256,
  tool_durability_threshold: 5,
  allow_alternative_materials: true,
};

interface InternalConfig {
  host: string;
  port: number;
  debug: boolean;
  survival: SurvivalConfig;
  block: BlockConfig;
}

export class ConfigManager {
  private config: InternalConfig = {
    host: '127.0.0.1',
    port: 27541,
    debug: false,
    survival: DEFAULT_SURVIVAL_CONFIG,
    block: DEFAULT_BLOCK_CONFIG,
  };

  load(options?: AppOptions): void {
    this.config = this.mergeWithDefaults(options ?? this.loadFromFile());
  }

  loadFromFile(filePath?: string): AppOptions {
    const target = filePath ?? resolve(process.cwd(), 'config.json');
    if (!existsSync(target)) return {};
    try {
      const content = readFileSync(target, 'utf-8');
      return JSON.parse(content) as AppOptions;
    } catch (e) {
      logger.warn(`[ConfigManager] 读取配置文件失败: ${target}`, e);
      return {};
    }
  }

  get<K extends keyof InternalConfig>(key: K): InternalConfig[K] {
    return this.config[key];
  }

  get survival(): SurvivalConfig {
    return this.config.survival;
  }

  get block(): BlockConfig {
    return this.config.block;
  }

  private mergeWithDefaults(options: AppOptions): InternalConfig {
    return {
      host: options.host ?? this.config.host,
      port: options.port ?? this.config.port,
      debug: options.debug ?? this.config.debug,
      survival: {
        eat: {
          max_search_radius: options.survival?.eat?.max_search_radius ?? DEFAULT_SURVIVAL_CONFIG.eat.max_search_radius,
        },
        sleep: {
          max_bed_search_radius:
            options.survival?.sleep?.max_bed_search_radius ?? DEFAULT_SURVIVAL_CONFIG.sleep.max_bed_search_radius,
          max_wait_ms: options.survival?.sleep?.max_wait_ms ?? DEFAULT_SURVIVAL_CONFIG.sleep.max_wait_ms,
        },
      },
      block: {
        max_area_operation_blocks:
          options.block?.max_area_operation_blocks ?? DEFAULT_BLOCK_CONFIG.max_area_operation_blocks,
        tool_durability_threshold:
          options.block?.tool_durability_threshold ?? DEFAULT_BLOCK_CONFIG.tool_durability_threshold,
        allow_alternative_materials:
          options.block?.allow_alternative_materials ?? DEFAULT_BLOCK_CONFIG.allow_alternative_materials,
      },
    };
  }
}

export const configManager = new ConfigManager();
configManager.load();
