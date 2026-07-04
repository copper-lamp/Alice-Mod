/**
 * 离线访问支持
 *
 * 允许不启动游戏时浏览/编辑已保存的实例配置和关联数据。
 * 所有操作都基于持久化的文件数据，不依赖 TCP 连接。
 */

import type { InstanceConfig } from './instance-validator';
import type { InstanceManager } from './instance-manager';

/** 离线工作区数据（从持久化数据还原的摘要） */
export interface OfflineWorkspaceData {
  instanceId: string;
  name: string;
  edition: string;
  lastOnlineAt: number | null;
  toolCount: number;
  tools: unknown[];
}

/**
 * 离线访问服务
 *
 * 提供不依赖游戏进程的数据访问能力。
 */
export class OfflineAccess {
  private readonly instanceManager: InstanceManager;

  constructor(instanceManager: InstanceManager) {
    this.instanceManager = instanceManager;
  }

  /**
   * 获取所有离线工作区数据
   * 基于已保存的实例配置和上次在线时的工具列表
   */
  getWorkspaces(): OfflineWorkspaceData[] {
    const instances = this.instanceManager.getAll();
    return instances.map((inst) => ({
      instanceId: inst.instance_id,
      name: inst.name,
      edition: inst.edition,
      lastOnlineAt: null,
      toolCount: 0,
      tools: [],
    }));
  }

  /**
   * 检查是否有已保存的实例
   */
  get hasSavedInstances(): boolean {
    return this.instanceManager.count > 0;
  }

  /**
   * 获取实例配置（不依赖游戏进程）
   */
  getInstanceConfig(instanceId: string): InstanceConfig | undefined {
    return this.instanceManager.get(instanceId);
  }

  /**
   * 获取所有实例配置
   */
  getAllInstanceConfigs(): InstanceConfig[] {
    return this.instanceManager.getAll();
  }
}
