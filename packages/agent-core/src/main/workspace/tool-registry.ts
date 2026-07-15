/**
 * 工具注册管理器
 *
 * 按工作区维护已注册的工具列表：
 * - 接收 `register_tools` 通知后动态注册/替换
 * - 支持按工具名称查询
 * - 工作区离线时保留工具列表（等待重连后重新注册）
 */

import { createHash } from 'node:crypto';
import type { ToolSchema } from '@mcagent/shared';

/**
 * 工具注册管理器
 *
 * 每个 WorkspaceManager 持有一个 ToolRegistry 实例，
 * 用于管理所有工作区的工具列表。
 */
export class ToolRegistry {
  /** workspaceId → ToolSchema[] */
  private readonly registry: Map<string, ToolSchema[]> = new Map();
  /** workspaceId → content hash */
  private readonly hashes: Map<string, string> = new Map();

  /**
   * 注册/替换工作区的工具列表
   * @returns true=有变更已更新, false=无变更跳过
   */
  register(workspaceId: string, tools: ToolSchema[]): boolean {
    const newHash = computeToolsHash(tools);
    const oldHash = this.hashes.get(workspaceId);
    
    // 无变更则跳过
    if (oldHash === newHash && oldHash !== undefined) return false;
    
    this.registry.set(workspaceId, [...tools]);
    this.hashes.set(workspaceId, newHash);
    return true;
  }

  /** 获取工作区工具列表的 hash */
  getHash(workspaceId: string): string | undefined {
    return this.hashes.get(workspaceId);
  }

  /**
   * 获取工作区的工具列表
   */
  getTools(workspaceId: string): ToolSchema[] {
    return this.registry.get(workspaceId) ?? [];
  }

  /**
   * 按名称在工作区中查找工具
   */
  findTool(workspaceId: string, toolName: string): ToolSchema | undefined {
    const tools = this.registry.get(workspaceId);
    return tools?.find((t) => t.name === toolName);
  }

  /**
   * 移除工作区的工具列表（工作区被删除时调用）
   */
  unregister(workspaceId: string): void {
    this.registry.delete(workspaceId);
  }

  /**
   * 获取所有已注册的工具（按工作区分组）
   */
  getAll(): Map<string, ToolSchema[]> {
    return new Map(this.registry);
  }

  /**
   * 获取所有工作区的工具名称列表
   */
  getAllToolNames(): string[] {
    const names: string[] = [];
    for (const tools of this.registry.values()) {
      for (const tool of tools) {
        if (!names.includes(tool.name)) {
          names.push(tool.name);
        }
      }
    }
    return names;
  }

  /**
   * 获取已注册的工作区数量
   */
  get workspaceCount(): number {
    return this.registry.size;
  }

  /**
   * 清空所有注册
   */
  clear(): void {
    this.registry.clear();
    this.hashes.clear();
  }
}

/**
 * 计算工具列表的 hash
 * 按工具名排序确保顺序稳定
 */
function computeToolsHash(tools: ToolSchema[]): string {
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  const json = JSON.stringify(sorted);
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}
