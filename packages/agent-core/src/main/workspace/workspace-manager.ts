/**
 * 工作区管理器
 *
 * 核心职责：
 * 1. 管理所有 Workspace 的生命周期（创建/查询/删除）
 * 2. 同步 TcpConnection 状态到 Workspace 状态
 * 3. 通过 ToolRegistry 管理工作区的工具列表
 * 4. 保证 instanceId 唯一性（同一实例不可能有两个在线工作区）
 * 5. 发出生命周期事件供上层模块监听
 */

import { EventEmitter } from 'node:events';
import type { ToolSchema } from '@mcagent/shared';

import { Workspace, WorkspaceState, type WorkspaceData, type WorkspaceSource } from './workspace';
import { ToolRegistry } from './tool-registry';
import { WorkspaceStore } from './workspace-store';

/** 工作区管理器事件 */
export enum WorkspaceEvent {
  Created = 'workspace:created',
  StateChanged = 'workspace:state-changed',
  ToolsUpdated = 'workspace:tools-updated',
  Removed = 'workspace:removed',
}

/** 工作区管理器事件数据 */
export interface WorkspaceEventData {
  type: WorkspaceEvent;
  workspaceId: string;
  instanceId: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * 工作区管理器
 *
 * 维护所有工作区，协调 TcpServer 的连接状态与工作区状态的同步。
 */
export class WorkspaceManager extends EventEmitter {
  /** workspaceId → Workspace */
  private readonly workspaces: Map<string, Workspace> = new Map();
  /** instanceId → workspaceId (快速查找) */
  private readonly instanceIndex: Map<string, string> = new Map();
  /** connectionId → workspaceId (快速查找) */
  private readonly connectionIndex: Map<string, string> = new Map();
  /** 工具注册表 */
  private readonly toolRegistry = new ToolRegistry();
  /** 持久化存储 */
  private readonly store = new WorkspaceStore();

  // ── 创建/获取 ──

  /**
   * 创建工作区
   * 如果 instanceId 已存在，则返回已有的工作区
   */
  createWorkspace(params: {
    instanceId: string;
    edition?: string;
    name?: string;
    source?: WorkspaceSource;
  }): Workspace {
    // 检查是否已存在
    const existingId = this.instanceIndex.get(params.instanceId);
    if (existingId) {
      const existing = this.workspaces.get(existingId);
      if (existing) return existing;
    }

    const workspace = new Workspace({
      instanceId: params.instanceId,
      edition: params.edition ?? null,
      name: params.name,
      source: params.source,
    });

    this.workspaces.set(workspace.id, workspace);
    this.instanceIndex.set(params.instanceId, workspace.id);

    // 持久化
    this.store.save(workspace.toJSON());

    this.emitEvent(WorkspaceEvent.Created, workspace.id, params.instanceId, {
      edition: params.edition,
    });

    return workspace;
  }

  /** 按 workspaceId 获取工作区 */
  getWorkspace(id: string): Workspace | undefined {
    return this.workspaces.get(id);
  }

  /** 按 instanceId 获取工作区 */
  getWorkspaceByInstanceId(instanceId: string): Workspace | undefined {
    const workspaceId = this.instanceIndex.get(instanceId);
    if (!workspaceId) return undefined;
    return this.workspaces.get(workspaceId);
  }

  /** 按 connectionId 获取工作区 */
  getWorkspaceByConnectionId(connectionId: string): Workspace | undefined {
    const workspaceId = this.connectionIndex.get(connectionId);
    if (!workspaceId) return undefined;
    return this.workspaces.get(workspaceId);
  }

  /** 获取所有工作区 */
  getAllWorkspaces(): Workspace[] {
    return Array.from(this.workspaces.values());
  }

  /** 获取所有在线工作区 */
  getOnlineWorkspaces(): Workspace[] {
    return this.getAllWorkspaces().filter((w) => w.isOnline);
  }

  /** 在线工作区数量 */
  get onlineCount(): number {
    return this.getOnlineWorkspaces().length;
  }

  /** 工作区总数 */
  get totalCount(): number {
    return this.workspaces.size;
  }

  // ── 状态同步 ──

  /**
   * 将工作区标记为 Connecting（连接建立时）
   */
  setConnecting(instanceId: string, connectionId: string): Workspace | undefined {
    const workspace = this.getOrCreateForConnection(instanceId, connectionId);
    if (!workspace) return undefined;

    workspace.goConnecting(connectionId);
    this.connectionIndex.set(connectionId, workspace.id);
    this.emitEvent(WorkspaceEvent.StateChanged, workspace.id, instanceId, {
      newState: WorkspaceState.Connecting,
      connectionId,
    });

    return workspace;
  }

  /**
   * 将工作区标记为 Online（握手完成时）
   */
  setOnline(instanceId: string, connectionId: string): Workspace | undefined {
    const workspace = this.getOrCreateForConnection(instanceId, connectionId);
    if (!workspace) return undefined;

    const oldState = workspace.state;
    workspace.goOnline();
    this.connectionIndex.set(connectionId, workspace.id);
    this.store.save(workspace.toJSON());

    if (oldState !== WorkspaceState.Online) {
      this.emitEvent(WorkspaceEvent.StateChanged, workspace.id, instanceId, {
        newState: WorkspaceState.Online,
        oldState,
        connectionId,
      });
    }

    return workspace;
  }

  /**
   * 将工作区标记为 Offline（连接断开时）
   */
  setOffline(connectionId: string): Workspace | undefined {
    const workspaceId = this.connectionIndex.get(connectionId);
    if (!workspaceId) return undefined;

    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return undefined;

    const oldState = workspace.state;
    workspace.goOffline();
    this.connectionIndex.delete(connectionId);
    this.store.save(workspace.toJSON());

    if (oldState !== WorkspaceState.Offline) {
      this.emitEvent(WorkspaceEvent.StateChanged, workspace.id, workspace.instanceId, {
        newState: WorkspaceState.Offline,
        oldState,
      });
    }

    return workspace;
  }

  // ── 工具注册 ──

  /**
   * 注册工具列表到工作区
   */
  registerTools(workspaceId: string, tools: ToolSchema[]): void {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return;

    workspace.updateTools(tools);
    this.toolRegistry.register(workspaceId, tools);

    this.emitEvent(WorkspaceEvent.ToolsUpdated, workspaceId, workspace.instanceId, {
      toolCount: tools.length,
    });
  }

  /** 获取工作区的工具列表 */
  getWorkspaceTools(workspaceId: string): ToolSchema[] {
    return this.toolRegistry.getTools(workspaceId);
  }

  /** 获取 ToolRegistry 引用 */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  // ── 生命周期 ──

  /**
   * 删除工作区
   */
  removeWorkspace(workspaceId: string): boolean {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return false;

    this.toolRegistry.unregister(workspaceId);
    this.instanceIndex.delete(workspace.instanceId);
    if (workspace.connectionId) {
      this.connectionIndex.delete(workspace.connectionId);
    }
    this.workspaces.delete(workspaceId);
    this.store.delete(workspaceId);

    this.emitEvent(WorkspaceEvent.Removed, workspaceId, workspace.instanceId);
    return true;
  }

  /**
   * 清空所有工作区（服务端停止时调用）
   */
  clear(): void {
    const allIds = Array.from(this.workspaces.keys());
    for (const id of allIds) {
      this.removeWorkspace(id);
    }
  }

  // ── 序列化 ──

  /** 导出所有工作区数据 */
  exportAll(): WorkspaceData[] {
    return this.getAllWorkspaces().map((w) => w.toJSON());
  }

  /** 从持久化存储恢复工作区列表（启动时调用） */
  loadPersistedWorkspaces(): WorkspaceData[] {
    const persisted = this.store.getAll()
    for (const data of persisted) {
      // 只恢复离线状态的工作区
      if (!this.workspaces.has(data.id)) {
        const workspace = new Workspace({
          id: data.id,
          instanceId: data.instanceId,
          name: data.name,
          edition: data.edition,
          source: data.source,
        })
        workspace.state = 'offline' as any
        workspace.edition = data.edition
        workspace.protocolVersion = data.protocolVersion
        workspace.modVersion = data.modVersion
        workspace.persisted = true
        workspace.updatedAt = data.updatedAt
        workspace.lastOnlineAt = data.lastOnlineAt

        this.workspaces.set(workspace.id, workspace)
        this.instanceIndex.set(data.instanceId, workspace.id)
      }
    }
    return persisted
  }

  // ── 内部方法 ──

  private getOrCreateForConnection(instanceId: string, connectionId: string): Workspace | undefined {
    // 先通过 instanceId 查找
    let workspace = this.getWorkspaceByInstanceId(instanceId);

    // 再通过 connectionId 查找
    if (!workspace) {
      workspace = this.getWorkspaceByConnectionId(connectionId);
    }

    // 都不存在则创建新的
    if (!workspace) {
      workspace = this.createWorkspace({ instanceId });
    }

    return workspace;
  }

  private emitEvent(
    type: WorkspaceEvent,
    workspaceId: string,
    instanceId: string,
    metadata?: Record<string, unknown>,
  ): void {
    const event: WorkspaceEventData = {
      type,
      workspaceId,
      instanceId,
      timestamp: Date.now(),
      metadata,
    };
    this.emit(type, event);
    this.emit('workspace:event', event);
  }
}

// ════════════════════════════════════════════════════════════════
// 全局单例
// ════════════════════════════════════════════════════════════════

let managerInstance: WorkspaceManager | null = null

export function getWorkspaceManager(): WorkspaceManager {
  if (!managerInstance) {
    managerInstance = new WorkspaceManager()
  }
  return managerInstance
}

export function resetWorkspaceManager(): void {
  managerInstance = null
}
