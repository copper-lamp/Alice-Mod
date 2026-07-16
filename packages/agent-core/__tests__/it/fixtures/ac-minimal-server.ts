/**
 * AC 最小化 TCP 服务器（用于 L2 端到端测试）
 *
 * 启动一个完整的 TcpServer，监听 27541 端口，接受 JE 端连接，
 * 处理工具注册、工具调用，提供 ToolDispatcher 供测试使用。
 */

import { TcpServer, ServerEvent } from '../../../src/main/tcp/tcp-server'
import { WorkspaceManager } from '../../../src/main/workspace/workspace-manager'
import { DefaultToolDispatcher } from '../../../src/main/pipeline/tool-dispatcher'
import { normalizeToolSchema } from '../../../src/main/tool-schema'

export interface AcMinimalContext {
  tcpServer: TcpServer
  workspaceManager: WorkspaceManager
  toolDispatcher: DefaultToolDispatcher
  port: number
  authToken: string
  stop: () => Promise<void>
}

/**
 * 启动最小化 AC TCP 服务器
 * 不启动 Electron 窗口，仅包含 TCP 服务 + 工具注册 + 工具调度
 */
export async function startAcMinimalServer(
  port = 27541,
  authToken = 'mct_64cf4ca6c0c64a75aaf9a5b0',
): Promise<AcMinimalContext> {
  const workspaceManager = new WorkspaceManager(false)

  const tcpServer = new TcpServer({
    host: '127.0.0.1',
    port,
    authTokens: new Set([authToken]),
    maxConnections: 10,
  })

  tcpServer.setMessageHandlerFactory((_connId) => ({
    onNotification: (_cid, notif) => {
      if (notif.method === 'register_tools') {
        const params = notif.params as { tools?: unknown[] } | undefined
        if (params?.tools) {
          const normalized = params.tools.map((raw) =>
            normalizeToolSchema(raw as Record<string, unknown>)
          )
          const workspace = workspaceManager.getWorkspaceByConnectionId(_connId)
          if (workspace) {
            workspaceManager.registerTools(workspace.id, normalized)
            console.log(`[AC] 工具注册: ${normalized.length} 个工具`)
          }
        }
      }
      if (notif.method === 'status_report') {
        // 忽略状态上报
      }
    },
    onRequest: async (_cid, req) => {
      if (req.method === 'handshake' || req.method === 'pong') return null
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32601, message: `Method not found: ${req.method}` },
      }
    },
  }))

  // 监听连接事件，自动创建 workspace
  tcpServer.on(ServerEvent.ConnectionStateChange, ({ clientId, newState, prevState }) => {
    if (newState === 'connected') {
      const conn = tcpServer.getConnection(clientId)
      if (conn?.instanceId) {
        workspaceManager.setOnline(conn.instanceId, clientId)
        console.log(`[AC] 实例 ${conn.instanceId} 已连接`)
      }
    }
  })

  await tcpServer.start()
  const actualPort = (tcpServer as any).server?.address()?.port ?? port

  const toolDispatcher = new DefaultToolDispatcher(workspaceManager, tcpServer)

  console.log(`[AC] TCP 服务器已启动，监听端口 ${actualPort}`)

  return {
    tcpServer,
    workspaceManager,
    toolDispatcher,
    port: actualPort,
    authToken,
    stop: async () => { await tcpServer.stop() },
  }
}