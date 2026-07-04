// 数据持久化占位
// 负责插件运行时数据的存储与恢复

export interface StorageAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export class PersistenceManager {
  constructor(private adapter: StorageAdapter) {}

  async get<T>(key: string): Promise<T | null> {
    return this.adapter.get<T>(key);
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.adapter.set(key, value);
  }

  async delete(key: string): Promise<void> {
    await this.adapter.delete(key);
  }
}
