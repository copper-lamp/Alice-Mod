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
import { WIKI_TOOL_SCHEMAS } from '../wiki';
import { SEARCH_TOOL_SCHEMAS } from '../search';
import { MEMORY_TOOL_SCHEMAS } from '../memory/tools';
import { TASK_TOOL_SCHEMAS } from '../task';
import { UPDATE_PLAN_TOOL } from '../orchestration/tools/update-plan';
import { getDatabaseManager } from '../database';

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
  /** 持久化存储（可传入 null 禁用持久化，便于测试） */
  private readonly store: WorkspaceStore | null;

  constructor(enablePersistence: boolean = true) {
    super();
    this.store = enablePersistence ? new WorkspaceStore() : null;
  }

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
    this.store?.save(workspace.toJSON());

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
    workspace.connectionId = connectionId; // 修复：同步更新 connectionId
    this.connectionIndex.set(connectionId, workspace.id);
    this.store?.save(workspace.toJSON());

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
    this.store?.save(workspace.toJSON());

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
   * 通过 hash 检测跳过无变更的注册，有变更时持久化到 SQLite
   */
  registerTools(workspaceId: string, tools: ToolSchema[]): boolean {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return false;

    // 自动注入内置工具（Wiki / 搜索 / 记忆 / 任务 / 编排等）
    const allTools = [...tools, ...WIKI_TOOL_SCHEMAS, ...SEARCH_TOOL_SCHEMAS, ...MEMORY_TOOL_SCHEMAS, ...TASK_TOOL_SCHEMAS, UPDATE_PLAN_TOOL];

    // hash 变更检测：无变更则不更新
    const changed = this.toolRegistry.register(workspaceId, allTools);
    if (!changed) return true; // 无变更，跳过后续操作

    workspace.updateTools(allTools);

    // 持久化到 SQLite
    this.persistTools(workspaceId, allTools);

    this.emitEvent(WorkspaceEvent.ToolsUpdated, workspaceId, workspace.instanceId, {
      toolCount: allTools.length,
    });

    return true;
  }

  /** 获取工作区的工具列表 */
  getWorkspaceTools(workspaceId: string): ToolSchema[] {
    return this.toolRegistry.getTools(workspaceId);
  }

  /** 获取 ToolRegistry 引用 */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  /** 将工具列表持久化到 SQLite */
  private persistTools(workspaceId: string, tools: ToolSchema[]): void {
    try {
      const db = getDatabaseManager().getDb();
      const hash = this.toolRegistry.getHash(workspaceId) ?? '';
      db.prepare(`
        INSERT OR REPLACE INTO tool_registry (workspace_id, tool_hash, tool_json, tool_count, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(workspaceId, hash, JSON.stringify(tools), tools.length, Date.now());
    } catch (err) {
      console.error('[WorkspaceManager] 持久化工具列表失败:', err);
    }
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
    this.store?.delete(workspaceId);

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
    const persisted = this.store?.getAll() ?? []
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

export function setWorkspaceManager(manager: WorkspaceManager): void {
  managerInstance = manager
}

export function resetWorkspaceManager(): void {
  managerInstance = null
}
