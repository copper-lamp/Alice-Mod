/**
 * 工作区数据类
 *
 * 一个 Workspace 对应一个 Adapter Core 实例的会话抽象。
 * 管理连接状态、工具列表、会话隔离数据。
 * 包含工具列表、会话状态、连接信息等。
 */

import crypto from 'node:crypto';
import type { ToolSchema } from '@mcagent/shared';

/** 工作区状态 */
export enum WorkspaceState {
  Offline = 'offline',
  Connecting = 'connecting',
  Online = 'online',
}

/** 工作区来源 */
export type WorkspaceSource = 'auto' | 'manual';

/** 工作区会话数据（隔离数据） */
export interface WorkspaceSession {
  conversationHistory: unknown[];
  memoryContext: Record<string, unknown>;
}

/** 工作区序列化数据 */
export interface WorkspaceData {
  id: string;
  name: string;
  instanceId: string;
  connectionId: string | null;
  state: WorkspaceState;
  edition: string | null;
  protocolVersion: string | null;
  modVersion: string | null;
  toolCount: number;
  source: WorkspaceSource;
  persisted: boolean;
  createdAt: number;
  updatedAt: number;
  lastOnlineAt: number | null;
}

/**
 * 工作区数据类
 *
 * 每个工作区对应一个 Adapter Core 实例，维护其运行时的全部状态。
 */
export class Workspace {
  readonly id: string;
  readonly instanceId: string;
  readonly createdAt: number;

  name: string;
  connectionId: string | null = null;
  state: WorkspaceState = WorkspaceState.Offline;
  edition: string | null = null;
  protocolVersion: string | null = null;
  modVersion: string | null = null;
  tools: ToolSchema[] = [];
  source: WorkspaceSource = 'auto';
  persisted = false;
  updatedAt: number;
  lastOnlineAt: number | null = null;

  /** 会话隔离数据 */
  readonly session: WorkspaceSession = {
    conversationHistory: [],
    memoryContext: {},
  };

  constructor(params: {
    instanceId: string;
    name?: string;
    edition?: string | null;
    id?: string;
    source?: WorkspaceSource;
  }) {
    this.id = params.id ?? crypto.randomUUID();
    this.instanceId = params.instanceId;
    this.name = params.name ?? params.instanceId;
    this.edition = params.edition ?? null;
    this.source = params.source ?? 'auto';
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }

  /** 是否在线 */
  get isOnline(): boolean {
    return this.state === WorkspaceState.Online;
  }

  /** 工具数量 */
  get toolCount(): number {
    return this.tools.length;
  }

  /** 切换到 Offline 状态 */
  goOffline(): void {
    this.state = WorkspaceState.Offline;
    this.connectionId = null;
    this.updatedAt = Date.now();
  }

  /** 切换到 Connecting 状态 */
  goConnecting(connectionId: string): void {
    this.state = WorkspaceState.Connecting;
    this.connectionId = connectionId;
    this.updatedAt = Date.now();
  }

  /** 切换到 Online 状态 */
  goOnline(): void {
    this.state = WorkspaceState.Online;
    this.lastOnlineAt = Date.now();
    this.updatedAt = Date.now();
  }

  /** 更新版本信息 */
  updateVersion(edition: string, protocolVersion: string, modVersion?: string): void {
    this.edition = edition;
    this.protocolVersion = protocolVersion;
    if (modVersion) this.modVersion = modVersion;
    this.updatedAt = Date.now();
  }

  /** 替换工具列表 */
  updateTools(tools: ToolSchema[]): void {
    this.tools = [...tools];
    this.updatedAt = Date.now();
  }

  /** 序列化为 plain object */
  toJSON(): WorkspaceData {
    return {
      id: this.id,
      name: this.name,
      instanceId: this.instanceId,
      connectionId: this.connectionId,
      state: this.state,
      edition: this.edition,
      protocolVersion: this.protocolVersion,
      modVersion: this.modVersion,
      toolCount: this.toolCount,
      source: this.source,
      persisted: this.persisted,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      lastOnlineAt: this.lastOnlineAt,
    };
  }
}
