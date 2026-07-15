/**
 * V20 §4.3 ConnectionResolver — workspaceId → TcpConnection 解析
 *
 * 轻量包装，复用 TcpServer + WorkspaceManager 已有 API：
 * - resolve(workspaceId)：通过 workspace → connectionId → TcpServer.getConnection
 * - resolveByInstanceId(instanceId)：直接走 TcpServer.findByInstanceId（给 trigger 用）
 *
 * 抛 NotConnectedError（来自 tcp/errors）当 workspace 离线 / 不存在。
 */

import type { TcpServer } from '../tcp/tcp-server';
import type { TcpConnection } from '../tcp/connection';
import type { WorkspaceManager } from '../workspace/workspace-manager';
import { NotConnectedError } from '../tcp/errors';

export class ConnectionResolver {
  constructor(
    private readonly tcpServer: TcpServer,
    private readonly workspaceManager: WorkspaceManager,
  ) {}

  /**
   * 按 workspaceId 解析出已连接的 TcpConnection。
   *
   * @throws NotConnectedError 当 workspace 不存在 / 无 connectionId / 连接已断开
   */
  resolve(workspaceId: string): TcpConnection {
    // 1) workspaceId → connectionId（handshake 成功后 workspace.connectionId 必有）
    const ws = this.workspaceManager.getWorkspace(workspaceId);
    if (!ws?.connectionId) {
      throw new NotConnectedError(workspaceId);
    }
    // 2) connectionId → TcpConnection（走 TcpServer.getConnection，已存在）
    const conn = this.tcpServer.getConnection(ws.connectionId);
    if (!conn?.isConnected) {
      throw new NotConnectedError(workspaceId);
    }
    return conn;
  }

  /**
   * 按 instanceId 解析 TcpConnection（给 trigger 注入用）。
   *
   * 事件触发时可直接通过 instanceId 解析，跳过 workspace 查表。
   * 未连接时返回 undefined（不抛错，由调用方决定如何处理）。
   */
  resolveByInstanceId(instanceId: string): TcpConnection | undefined {
    const conn = this.tcpServer.findByInstanceId(instanceId);
    return conn?.isConnected ? conn : undefined;
  }
}
