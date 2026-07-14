/**
 * 工作区模块 - 管理 Adapter Core 实例的工作区生命周期
 *
 * 子模块：
 * - workspace: Workspace 数据类 + WorkspaceState 枚举
 * - tool-registry: 工具注册管理器
 * - workspace-manager: 工作区管理器（创建/状态同步/事件）
 */

export { Workspace, WorkspaceState, type WorkspaceData, type WorkspaceSession, type WorkspaceSource } from './workspace';
export { ToolRegistry } from './tool-registry';
export { WorkspaceManager, WorkspaceEvent, type WorkspaceEventData, getWorkspaceManager, setWorkspaceManager, resetWorkspaceManager } from './workspace-manager';
export { WorkspaceStore } from './workspace-store';
export { WorldSession, WorldSessionState, WorldSessionEventType, type WorldSessionData, type WorldSessionEvent } from './world-session';
export { WorldSessionManager, getWorldSessionManager, setWorldSessionManager, resetWorldSessionManager } from './world-session-manager';
export { WorldStore } from './world-store';
