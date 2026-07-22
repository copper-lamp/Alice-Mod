import { app, BrowserWindow, shell, Notification } from 'electron'
import path from 'path'
import fs, { existsSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { initLogger, getLogger, getLogDb } from './log'
import { registerAllIpcHandlers, setMemoryManager, bootstrapAndWireAgents, createResolveTarget, getSharedAgentConfigManager, getMainAgentRegistry, setMainWindowRef, forwardUpdaterEvents } from './ipc'
import { initModelRegistry } from './ipc/model-handler'
import { setLogDb } from './ipc/log-handler'
import { getToolCallCollector, setToolCallCollector } from './ipc/tool-call-handler'
import { PipelineEventCollector } from './pipeline/event-collector'
import { getDatabaseManager } from './database'
import { getWorkspaceManager } from './workspace'
import { getWorldSessionManager, WorldSessionEventType } from './workspace/world-session-manager'
import { DefaultLLMObserver, SqliteObserverStore, setLLMObserver } from './llm'
import { TcpServer, ServerEvent } from './tcp'
import { MemoryManager, DEFAULT_MEMORY_CONFIG } from './memory'
import type { MemoryBranch } from './memory/types'
import { TaskManager, setTaskManager } from './task'
import { SQLiteStore } from './memory/sqlite-store'
import { TriggerModule, setTriggerModule } from './trigger'
import { initQQBotIntegration } from './qq-bot/integration'
import { autoStartQQBotAccounts } from './ipc/qq-bot-handler'
import { updater } from './updater'
import { DefaultToolDispatcher, setToolDispatcher } from './pipeline/tool-dispatcher'
import { initDiagnoseScheduler, stopDiagnoseScheduler } from './diagnose'
import type { JsonRpcRequest, JsonRpcResponse, ToolSchema, JsonRpcNotification } from '@mcagent/shared'

// ════════════════════════════════════════════════════════════════
// Windows 控制台编码修复
// ════════════════════════════════════════════════════════════════
// 将控制台代码页切换到 UTF-8 (65001)，否则 UTF-8 编码的中文日志
// 在 GBK 终端上会显示为乱码（如 鏂囦欢 → 文件）。
function fixConsoleEncoding(): void {
  if (process.platform !== 'win32') return

  // 方法1: 通过 chcp 切换控制台代码页为 UTF-8
  // 注意: 在 electron-vite dev 的 pipe 模式下此方法不生效（留给 package.json 脚本处理），
  //       但在生产环境直接启动 Electron 时可正确设置。
  try {
    execSync('chcp 65001', { timeout: 3000 })
  } catch {
    // chcp 命令不可用时忽略
  }
}

// 在模块加载时立即执行编码修复，确保在任何 console.* 输出之前生效
fixConsoleEncoding()

let mainWindow: BrowserWindow | null = null

/**
 * 全局 TCP 服务端实例
 * 供 ToolDispatcher 等工作区管道模块访问
 */
let tcpServerInstance: TcpServer | null = null

export function getTcpServer(): TcpServer {
  if (!tcpServerInstance) {
    throw new Error('TcpServer 尚未初始化，请确保在 initializeServices 之后调用')
  }
  return tcpServerInstance
}

async function initializeServices(): Promise<void> {
  // 1. 初始化数据库（优先，其他模块依赖数据库连接）
  const dbManager = getDatabaseManager()
  const userDataPath = app.getPath('userData')
  const dbPath = path.join(userDataPath, 'alice-mod.db')
  await dbManager.init(dbPath)
  console.info('主进程', '数据库初始化完成')

  // 2. 初始化模型注册表（异步拉取，不阻塞）
  initModelRegistry().catch(() => { /* 静默 */ })

  // 3. 初始化日志系统（依赖 DatabaseManager 的 SQLite 连接）
  const logger = initLogger()
  logger.info('SYSTEM', '日志系统初始化完成')

  // 4. 设置 IPC Handler 的数据库引用
  const logDb = getLogDb()
  if (logDb) {
    setLogDb(logDb)
  }

  // 4. 初始化任务系统（V13）
  const taskSqlite = new SQLiteStore(dbPath)
  const taskManager = new TaskManager({}, { sqlite: taskSqlite })
  taskManager.init()
  setTaskManager(taskManager)
  logger.info('SYSTEM', '任务系统初始化完成')

  // 5. 初始化记忆系统（内存管理 + 持久化）
  let memoryManager: MemoryManager | null = null
  try {
    const sqliteDir = path.dirname(path.join(userDataPath, 'alice-mod-memory.db'))
    if (!existsSync(sqliteDir)) {
      mkdirSync(sqliteDir, { recursive: true })
    }
    memoryManager = new MemoryManager({
      sqlitePath: path.join(userDataPath, 'alice-mod-memory.db'),
      chroma: {
        collectionName: 'mcagent_memories',
        clientType: 'http',
        url: 'http://localhost:8000',
      },
      embedding: DEFAULT_MEMORY_CONFIG.embedding!,
      limits: DEFAULT_MEMORY_CONFIG.limits,
      autoCleanup: DEFAULT_MEMORY_CONFIG.autoCleanup,
    })
    await memoryManager.init()
    setMemoryManager(memoryManager)
    logger.info('SYSTEM', '记忆系统初始化完成')
  } catch (err) {
    logger.warn('SYSTEM', `记忆系统初始化失败: ${(err as Error).message}`)
  }

  // 6. 初始化 LLM 调用观测器（持久化到 SQLite）
  const observer = new DefaultLLMObserver(new SqliteObserverStore())
  setLLMObserver(observer)
  logger.info('SYSTEM', 'LLM 调用观测器初始化完成')

  // 7. 恢复持久化的工作区列表
  const workspaceManager = getWorkspaceManager()
  const restored = workspaceManager.loadPersistedWorkspaces()
  logger.info('SYSTEM', `已恢复 ${restored.length} 个持久化工作区`)

  // 8. 初始化工具调用事件收集器
  const collector = new PipelineEventCollector()
  setToolCallCollector(collector)

  // 9. 启动 TCP 服务端，监听 Adapter Core 连接
  // 从 BE 生成的实例入口文件读取 auth_token 用于握手认证
  // 依次尝试多个可能的路径
  let authTokens = new Set<string>()
  const candidatePaths: string[] = []
  const envPath = process.env.MCAGENT_INSTANCE_FILE
  if (envPath) candidatePaths.push(envPath)
  // 用户可能从项目根目录或 agent-core 目录启动
  candidatePaths.push(
    path.join(process.cwd(), 'Alice', 'mcagent_instance.json'),                   // CWD/Alice/
    path.resolve(process.cwd(), '..', 'bds26.10', 'Alice', 'mcagent_instance.json'), // CWD/../bds26.10/Alice/
    path.resolve(process.cwd(), '..', '..', 'bds26.10', 'Alice', 'mcagent_instance.json'), // CWD/../../bds26.10/Alice/
    path.resolve(process.cwd(), '..', 'serverjava', 'Alice', 'mcagent_instance.json'), // CWD/../serverjava/Alice/
    path.resolve(process.cwd(), '..', '..', 'serverjava', 'Alice', 'mcagent_instance.json'), // CWD/../../serverjava/Alice/
  )

  for (const p of candidatePaths) {
    try {
      const content = fs.readFileSync(p, 'utf-8')
      const instance = JSON.parse(content)
      if (instance.auth?.token) {
        authTokens.add(instance.auth.token)
        logger.info('SYSTEM', `已从实例文件加载 auth_token: ${p}`)
        // 不 break，继续扫描其他路径以收集所有有效的 auth_token
      }
    } catch {
      continue // 此路径不可读，尝试下一个
    }
  }

  if (authTokens.size === 0) {
    logger.warn('SYSTEM', '未找到有效的 mcagent_instance.json，TCP 服务端将使用默认 token 认证（仅开发环境）')
    authTokens.add('mcagent-default-token')
  }

  tcpServerInstance = new TcpServer({
    host: '0.0.0.0',
    port: 27541,
    authTokens,
  })

  // 10. 初始化工具调度器（依赖 TCP 服务端 + 工作区管理器）
  const toolDispatcher = new DefaultToolDispatcher(workspaceManager, tcpServerInstance)
  setToolDispatcher(toolDispatcher)
  logger.info('SYSTEM', 'ToolDispatcher 初始化完成')

  // 11. 设置 TCP 消息路由：工具注册 / 游戏聊天 / 插件事件
  tcpServerInstance.setMessageHandlerFactory((connectionId) => ({
    onNotification: (_clientId: string, notification: JsonRpcNotification) => {
      handleTcpNotification(workspaceManager, notification, connectionId, logger)
    },
    onRequest: async (_clientId: string, request: JsonRpcRequest): Promise<JsonRpcResponse | null> => {
      // 非 handshake/pong 的请求暂时不处理，返回方法未找到
      if (request.method === 'handshake' || request.method === 'pong') return null
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: `Method not found: ${request.method}` },
      }
    },
  }))

  tcpServerInstance.on('listening', (info: { host: string; port: number }) => {
    logger.info('SYSTEM', `TCP 服务端已启动，监听 ${info.host}:${info.port}`)
    console.info('主进程', `TCP 服务端已启动，监听 ${info.host}:${info.port}`)
  })

  tcpServerInstance.on('error', (err: Error) => {
    logger.error('SYSTEM', `TCP 服务端错误: ${err.message}`)
    console.error('主进程', `TCP 服务端错误: ${err.message}`)
  })

  // 连接事件：日志输出 + 工作区状态同步 + 系统通知
  tcpServerInstance.on(ServerEvent.ConnectionOpened, ({ clientId }) => {
    logger.info('TCP', `新连接接入，ID: ${clientId}`)
  })

  tcpServerInstance.on(ServerEvent.ConnectionStateChange, ({ clientId, newState, prevState }) => {
    logger.info('TCP', `连接 ${clientId} 状态变更: ${prevState} → ${newState}`)

    if (newState === 'connected') {
      const conn = tcpServerInstance!.getConnection(clientId)
      const instanceId = conn?.instanceId ?? 'unknown'
      const address = conn?.address ?? 'unknown'
      workspaceManager.setOnline(instanceId, clientId)
      logger.info('TCP', `实例 ${instanceId} (${address}) 握手成功，已连接`)
      console.info('主进程', `✅ 实例 ${instanceId} 连接成功`)

      // 桌面通知
      if (Notification.isSupported()) {
        new Notification({
          title: 'McAgent - 连接成功',
          body: `实例 ${instanceId} 已连接 (${address})`,
        }).show()
      }

      // 注册初始世界上下文（如果握手时提供了 world_name）
      if (conn?.worldName) {
        const workspace = workspaceManager.getWorkspaceByConnectionId(clientId)
        if (workspace) {
          const worldManager = getWorldSessionManager()
          worldManager.registerWorld(workspace.id, {
            instanceId: conn.instanceId!,
            worldName: conn.worldName,
            edition: conn.version?.edition ?? 'java',
            gameVersion: conn.version?.protocol ?? '',
          })
          if (conn.worldOnline !== false) {
            worldManager.setWorldOnline(workspace.id, conn.worldName)
          }
        }
      }
    }
  })

  tcpServerInstance.on(ServerEvent.ConnectionClosed, ({ clientId }) => {
    workspaceManager.setOffline(clientId)
    logger.warn('TCP', `连接 ${clientId} 已断开`)
  })

  // 世界上下文事件处理
  tcpServerInstance.on(ServerEvent.WorldOnline, ({ clientId, instanceId, worldName, botCount }) => {
    if (!instanceId || !worldName) return
    const workspace = workspaceManager.getWorkspaceByConnectionId(clientId)
    if (!workspace) return

    const worldManager = getWorldSessionManager()
    worldManager.registerWorld(workspace.id, {
      instanceId,
      worldName,
      edition: 'java',
      gameVersion: '',
    })
    // 设置 botCount
    const session = worldManager.getWorld(workspace.id, worldName)
    if (session) {
      session.botCount = typeof botCount === 'number' ? botCount : 0
    }
    worldManager.setWorldOnline(workspace.id, worldName)
    logger.info('TCP', `世界 ${worldName} 上线 (实例: ${instanceId})`)
  })

  tcpServerInstance.on(ServerEvent.WorldOffline, ({ clientId, instanceId, worldName, uptimeSeconds, botCount, reason }) => {
    if (!instanceId || !worldName) return
    const workspace = workspaceManager.getWorkspaceByConnectionId(clientId)
    if (!workspace) return

    const worldManager = getWorldSessionManager()
    const session = worldManager.getWorld(workspace.id, worldName)
    if (session) {
      session.uptimeSeconds = typeof uptimeSeconds === 'number' ? uptimeSeconds : 0
      session.botCount = typeof botCount === 'number' ? botCount : 0
    }
    worldManager.setWorldOffline(workspace.id, worldName, reason)
    logger.info('TCP', `世界 ${worldName} 下线 (实例: ${instanceId})`)
  })

  try {
    await tcpServerInstance.start()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('SYSTEM', `TCP 服务端启动失败: ${msg}`)
    console.error('主进程', `TCP 服务端启动失败: ${msg}`)
  }

  // 12. 初始化事件触发器模块（V14）
  // V20：先 bootstrap LLM 子系统 + 构造 MainAgentRegistry，再注入到 TriggerModule
  const mainAgentRegistry = await bootstrapAndWireAgents(tcpServerInstance)
  const resolveTarget = createResolveTarget(getSharedAgentConfigManager())
  logger.info('SYSTEM', 'V20 主链路组装完成（bootstrap + MainAgentRegistry）')

  const triggerModule = new TriggerModule(
    {
      db: dbManager.getDb(),
      actionDeps: {
        taskManager,
        callTool: async (workspaceId, toolName, params) => {
          const dispatcher = toolDispatcher
          if (!dispatcher) {
            throw new Error('ToolDispatcher 尚未初始化')
          }
          return dispatcher.callTool(workspaceId, toolName, params)
        },
        // V20：主链路 MainAgent 注入（trigger send_llm target='main'/'qq_sub_agent' 走此路径）
        mainAgentProvider: (p) => mainAgentRegistry.getSync(p.workspaceId, p.agentId),
        resolveTarget,
        sendQQ: async (target, content, messageType) => {
          const { sendQQMessage } = await import('./qq-bot/integration')
          return sendQQMessage(target, content, messageType)
        },
        storeMemory: async (workspaceId, memoryParams) => {
          const { getMemoryManager } = await import('./ipc/memory-handler')
          const mm = getMemoryManager()
          if (!mm) {
            logger.warn('TRIGGER', '记忆系统尚未初始化，无法存储事件记忆')
            return
          }
          try {
            await mm.store(
              {
                type: memoryParams.memoryType as any,
                branch: (memoryParams.branch ?? 'experience') as MemoryBranch,
                content: { text: memoryParams.content },
                importance: memoryParams.importance,
                tags: memoryParams.tags,
              },
              workspaceId,
            )
          } catch (err) {
            logger.warn('TRIGGER', `存储事件记忆失败: ${(err as Error).message}`, { error: (err as Error).message })
          }
        },
      },
      logger: {
        info: (msg) => logger.info('TRIGGER', msg),
        warn: (msg, meta) => logger.warn('TRIGGER', msg, meta),
        error: (msg, meta) => logger.error('TRIGGER', msg, meta),
      },
    },
    {
      defaultCooldownSeconds: 5,
      maxLogsPerTrigger: 1000,
      logRetentionDays: 30,
    },
  )
  setTriggerModule(triggerModule)
  await triggerModule.start()
  logger.info('SYSTEM', '事件触发器模块初始化完成')

  // 13. 初始化 QQ 机器人集成（可选模块，失败不阻塞主流程）
  try {
    const qqIntegration = initQQBotIntegration({ taskManager })
    qqIntegration.bindEventBus(triggerModule.getEventBus())
    logger.info('SYSTEM', 'QQ 机器人集成初始化完成')

    // 自动启动已启用的托管 QQ 账号
    autoStartQQBotAccounts().catch(err =>
      logger.warn('SYSTEM', `QQ 账号自动启动失败: ${(err as Error).message}`)
    )

    // V24: 预热所有启用了 QQ 绑定的 Agent
    try {
      const agentConfigManager = getSharedAgentConfigManager()
      const agents = await agentConfigManager.list()
      const registry = getMainAgentRegistry()
      let warmedCount = 0
      for (const summary of agents) {
        const config = await agentConfigManager.get(summary.id)
        if (config?.qqBinding?.enabled) {
          const workspaceId = config.workspaceId ?? ''
          registry.get(workspaceId, summary.id).catch((err: unknown) =>
            console.warn(`[Boot] 预热 Agent ${summary.id} 失败:`, err)
          )
          warmedCount++
        }
      }
      if (warmedCount > 0) {
        logger.info('SYSTEM', `已触发 ${warmedCount} 个 QQ 绑定 Agent 的预热`)
      }
    } catch (err) {
      logger.warn('SYSTEM', `预热 QQ Agent 失败: ${(err as Error).message}`)
    }
  } catch (err) {
    logger.warn('SYSTEM', `QQ 机器人集成初始化失败: ${(err as Error).message}`)
  }
}

/**
 * 处理 TCP 通知消息路由
 */
function handleTcpNotification(
  workspaceManager: ReturnType<typeof getWorkspaceManager>,
  notification: JsonRpcNotification,
  connectionId: string,
  logger: ReturnType<typeof getLogger>,
): void {
  const workspace = workspaceManager.getWorkspaceByConnectionId(connectionId)
  const workspaceId = workspace?.id ?? ''

  switch (notification.method) {
    case 'register_tools': {
      const params = notification.params as { tools?: unknown[]; instance_id?: string } | undefined
      if (params?.tools && workspace) {
        // 归一化：JE 端 SchemaGenerator 发送的字段名（input_schema / output_schema / execution）
        // 与 AC 端 ToolSchema 契约（parameters / category / enabled）不一致，
        // 在消费端做协议兼容，归一化为标准 ToolSchema。
        const normalized = params.tools.map((raw) => normalizeToolSchema(raw as Record<string, unknown>))
        workspaceManager.registerTools(workspace.id, normalized)
        logger.info('TCP', `工作区 ${workspace.id} 注册 ${normalized.length} 个工具`)
      }
      return
    }

    case 'game_chat': {
      const params = notification.params as Record<string, unknown> | undefined
      if (!params) return
      try {
        const { getTriggerModule } = require('./trigger')
        const triggerModule = getTriggerModule() as TriggerModule
        triggerModule.handleRawEvent('game_chat', { ...params, workspaceId })
      } catch (err) {
        logger.warn('TCP', `转发 game_chat 事件失败: ${(err as Error).message}`)
      }
      return
    }

    case 'event': {
      const params = notification.params as Record<string, unknown> | undefined
      if (!params) return
      try {
        const { getTriggerModule } = require('./trigger')
        const triggerModule = getTriggerModule() as TriggerModule
        triggerModule.handleRawEvent('plugin_event', {
          workspaceId,
          eventType: params.event_type,
          data: params.data,
          entityId: params.entity_id,
          position: params.position,
        })
      } catch (err) {
        logger.warn('TCP', `转发 event 通知失败: ${(err as Error).message}`)
      }
      return
    }

    default:
      // 其他通知可扩展
      break
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#f3f4f6',
      symbolColor: '#4b5563',
      height: 36
    },
    backgroundColor: '#f3f4f6',
    webPreferences: {
      preload: path.resolve(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false
  })

  // 开发环境加载 dev server，生产环境加载打包后的文件
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.resolve(__dirname, '../renderer/index.html'))
  }

  // 窗口就绪后显示，避免白屏
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // 在外部浏览器打开外部链接
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // 注册 IPC Handler
  registerAllIpcHandlers(mainWindow)

  // V33: 设置主窗口引用，用于流式事件实时推送到前端
  setMainWindowRef(mainWindow)

  // 将更新事件推送到渲染进程
  forwardUpdaterEvents(mainWindow)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  await initializeServices()

  // 初始化自动更新模块（异步，不阻塞启动）
  // 所有用户从 copper-lamp/Alice-App 的 GitHub Releases 拉取更新
  updater.init()

  // 初始化诊断信息自动打包（后台自动生成，无需用户操作）
  // 输出位置：%APPDATA%/alice-mod/diagnose/diagnose_*.zip
  // 生成时机：启动时 / 崩溃后 / 每 24 小时（保留最近 3 份）
  try {
    initDiagnoseScheduler()
  } catch (err) {
    console.warn('[Boot] 诊断信息调度器初始化失败:', (err as Error).message)
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', async () => {
  if (tcpServerInstance) {
    try {
      await tcpServerInstance.stop()
    } catch {
      // 忽略关闭时的错误
    }
  }
  // 正常退出时清理崩溃标记
  stopDiagnoseScheduler()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 工具 Schema 归一化（协议兼容层）—— 提取到独立模块避免副作用
import { normalizeToolSchema } from './tool-schema'
export { normalizeToolSchema, jsonSchemaToParams, convertSingleParam } from './tool-schema'