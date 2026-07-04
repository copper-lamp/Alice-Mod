// 配置接入占位

export interface AppOptions {
  host?: string;
  port?: number;
  debug?: boolean;
}

export class ConfigManager {
  private config: AppOptions = {};

  load(options: AppOptions): void {
    this.config = { ...this.config, ...options };
  }

  get<K extends keyof AppOptions>(key: K): AppOptions[K] {
    return this.config[key];
  }
}
