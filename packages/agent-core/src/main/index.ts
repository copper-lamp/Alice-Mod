import { app, BrowserWindow, shell, Notification } from 'electron'
import path from 'path'
import fs, { existsSync, mkdirSync } from 'node:fs'
import { initLogger, getLogger, getLogDb } from './log'
import { registerAllIpcHandlers, setMemoryManager } from './ipc'
import { setLogDb } from './ipc/log-handler'
import { getToolCallCollector, setToolCallCollector } from './ipc/tool-call-handler'
import { PipelineEventCollector } from './pipeline/event-collector'
import { getDatabaseManager } from './database'
import { getWorkspaceManager } from './workspace'
import { DefaultLLMObserver, SqliteObserverStore, setLLMObserver } from './llm'
import { TcpServer, ServerEvent } from './tcp'
import { MemoryManager, DEFAULT_MEMORY_CONFIG } from './memory'

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

  // 1.5 初始化 LLM 调用观测器（持久化到 SQLite）
  const observer = new DefaultLLMObserver(new SqliteObserverStore())
  setLLMObserver(observer)
  console.info('主进程', 'LLM 调用观测器初始化完成')

  // 1.6 初始化记忆系统（内存管理 + 持久化）
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
    console.info('主进程', '记忆系统初始化完成')
  } catch (err) {
    console.warn('主进程', `记忆系统初始化失败: ${(err as Error).message}`)
  }

  // 2. 初始化日志系统
  const logger = initLogger()
  logger.info('SYSTEM', '日志系统初始化完成')

  // 3. 设置 IPC Handler 的数据库引用
  const logDb = getLogDb()
  if (logDb) {
    setLogDb(logDb)
  }

  // 4. 恢复持久化的工作区列表
  const workspaceManager = getWorkspaceManager()
  const restored = workspaceManager.loadPersistedWorkspaces()
  logger.info('SYSTEM', `已恢复 ${restored.length} 个持久化工作区`)

  // 5. 初始化工具调用事件收集器
  const collector = new PipelineEventCollector()
  setToolCallCollector(collector)

  // 6. 启动 TCP 服务端，监听 Adapter Core 连接
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
  )

  let loadedPath: string | undefined
  for (const p of candidatePaths) {
    try {
      const content = fs.readFileSync(p, 'utf-8')
      const instance = JSON.parse(content)
      if (instance.auth?.token) {
        authTokens.add(instance.auth.token)
        loadedPath = p
        logger.info('SYSTEM', `已从实例文件加载 auth_token: ${p}`)
        break
      }
    } catch {
      continue // 此路径不可读，尝试下一个
    }
  }

  if (!loadedPath) {
    logger.warn('SYSTEM', '未找到有效的 mcagent_instance.json，TCP 服务端将使用默认 token 认证（仅开发环境）')
    authTokens = new Set(['mcagent-default-token'])
  }

  tcpServerInstance = new TcpServer({
    host: '0.0.0.0',
    port: 27541,
    authTokens,
  })

  tcpServerInstance.on('listening', (info: { host: string; port: number }) => {
    logger.info('SYSTEM', `TCP 服务端已启动，监听 ${info.host}:${info.port}`)
    console.info('主进程', `TCP 服务端已启动，监听 ${info.host}:${info.port}`)
  })

  tcpServerInstance.on('error', (err: Error) => {
    logger.error('SYSTEM', `TCP 服务端错误: ${err.message}`)
    console.error('主进程', `TCP 服务端错误: ${err.message}`)
  })

  // 连接事件：日志输出 + 系统通知
  tcpServerInstance.on(ServerEvent.ConnectionOpened, ({ clientId }) => {
    logger.info('TCP', `新连接接入，ID: ${clientId}`)
  })

  tcpServerInstance.on(ServerEvent.ConnectionStateChange, ({ clientId, newState, prevState }) => {
    logger.info('TCP', `连接 ${clientId} 状态变更: ${prevState} → ${newState}`)

    if (newState === 'connected') {
      const conn = tcpServerInstance!.getConnection(clientId)
      const instanceId = conn?.instanceId ?? 'unknown'
      const address = conn?.address ?? 'unknown'
      logger.info('TCP', `实例 ${instanceId} (${address}) 握手成功，已连接`)
      console.info('主进程', `✅ 实例 ${instanceId} 连接成功`)

      // 桌面通知
      if (Notification.isSupported()) {
        new Notification({
          title: 'McAgent - 连接成功',
          body: `实例 ${instanceId} 已连接 (${address})`,
        }).show()
      }
    }
  })

  tcpServerInstance.on(ServerEvent.ConnectionClosed, ({ clientId }) => {
    logger.warn('TCP', `连接 ${clientId} 已断开`)
  })

  try {
    await tcpServerInstance.start()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('SYSTEM', `TCP 服务端启动失败: ${msg}`)
    console.error('主进程', `TCP 服务端启动失败: ${msg}`)
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

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  await initializeServices()
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
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})