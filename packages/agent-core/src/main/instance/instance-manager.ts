/**
 * 实例管理器
 *
 * 管理 `mcagent_instance.json` 配置文件的导入、校验、CRUD 操作。
 * 支持从文件导入、从 JSON 字符串导入、以及离线访问。
 */

import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

import { InstanceValidator, type InstanceConfig } from './instance-validator';

/** 导入结果 */
export interface ImportResult {
  success: boolean;
  instances: InstanceConfig[];
  errors: string[];
}

/** 实例文件存储路径 */
function getDefaultStoragePath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'instances.json');
}

/**
 * 实例管理器
 */
export class InstanceManager {
  private instances: InstanceConfig[] = [];
  private storagePath: string;

  constructor(storagePath?: string) {
    this.storagePath = storagePath ?? getDefaultStoragePath();
  }

  // ── 导入 ──

  /**
   * 从文件导入实例配置
   */
  importFromFile(filePath: string): ImportResult {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return this.importFromJson(content);
    } catch (err) {
      return {
        success: false,
        instances: [],
        errors: [`Failed to read file: ${err instanceof Error ? err.message : String(err)}`],
      };
    }
  }

  /**
   * 从 JSON 字符串导入实例配置
   */
  importFromJson(jsonStr: string): ImportResult {
    // 解析 JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return { success: false, instances: [], errors: ['Invalid JSON format'] };
    }

    // 校验
    const validation = InstanceValidator.validate(parsed);
    if (!validation.valid) {
      return { success: false, instances: [], errors: validation.errors };
    }

    // 提取实例
    const root = parsed as { instances: Record<string, unknown>[] };
    const newInstances = root.instances.map((raw) => InstanceValidator.toInstanceConfig(raw));

    // 去重：新导入的实例会替换已存在的同名实例
    const result: InstanceConfig[] = [];
    const errors: string[] = [];

    for (const inst of newInstances) {
      const existingIndex = this.instances.findIndex((i) => i.instance_id === inst.instance_id);
      if (existingIndex >= 0) {
        this.instances[existingIndex] = inst;
        errors.push(`Instance "${inst.instance_id}" already exists, overwritten`);
      } else {
        this.instances.push(inst);
      }
      result.push(inst);
    }

    // 保存到磁盘
    this.save();

    return {
      success: errors.length === 0 || errors.every((e) => e.includes('overwritten')),
      instances: result,
      errors,
    };
  }

  // ── CRUD ──

  /** 获取所有实例配置 */
  getAll(): InstanceConfig[] {
    return [...this.instances];
  }

  /** 按 instance_id 获取实例 */
  get(instanceId: string): InstanceConfig | undefined {
    return this.instances.find((i) => i.instance_id === instanceId);
  }

  /** 添加实例 */
  add(config: InstanceConfig): boolean {
    const existing = this.instances.find((i) => i.instance_id === config.instance_id);
    if (existing) return false;

    this.instances.push(config);
    this.save();
    return true;
  }

  /** 更新实例 */
  update(instanceId: string, updates: Partial<InstanceConfig>): boolean {
    const index = this.instances.findIndex((i) => i.instance_id === instanceId);
    if (index < 0) return false;

    this.instances[index] = { ...this.instances[index], ...updates };
    this.save();
    return true;
  }

  /** 删除实例 */
  remove(instanceId: string): boolean {
    const index = this.instances.findIndex((i) => i.instance_id === instanceId);
    if (index < 0) return false;

    this.instances.splice(index, 1);
    this.save();
    return true;
  }

  /** 实例数量 */
  get count(): number {
    return this.instances.length;
  }

  // ── 持久化 ──

  /** 保存到磁盘 */
  save(): void {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = {
        schema_version: '1.0',
        instances: this.instances,
      };

      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[InstanceManager] Failed to save instances: ${err}`);
    }
  }

  /** 从磁盘加载 */
  load(): void {
    try {
      if (!fs.existsSync(this.storagePath)) {
        console.log('[InstanceManager] 文件不存在:', this.storagePath)
        this.instances = [];
        return;
      }

      const content = fs.readFileSync(this.storagePath, 'utf-8');
      const parsed = JSON.parse(content);

      if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.instances)) {
        console.log('[InstanceManager] 无效格式:', typeof parsed, Array.isArray(parsed?.instances))
        this.instances = [];
        return;
      }

      this.instances = parsed.instances
        .filter((i: unknown) => typeof i === 'object' && i !== null)
        .map((i: Record<string, unknown>) => InstanceValidator.toInstanceConfig(i));
      console.log('[InstanceManager] 已加载', this.instances.length, '个实例, 路径:', this.storagePath)
      if (this.instances.length > 0) {
        console.log('[InstanceManager] 首个实例:', {
          instance_id: this.instances[0].instance_id,
          file_path: this.instances[0].file_path,
          game_version: this.instances[0].game_version,
          icon_data: this.instances[0].icon_data ? '(存在)' : undefined,
        })
      }
    } catch (err) {
      console.error('[InstanceManager] 加载失败:', err)
      this.instances = [];
    }
  }
}
