import { ipcMain, dialog, BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import WebSocket from 'ws'
import { DockerContainerManager } from '../qq-bot/docker-container-manager'
import type { ContainerStatus } from '../qq-bot/docker-container-manager'
import { OneBotClient } from '../qq-bot/onebot-client'
import { routeQQMessageToAgent } from '../qq-bot/message-router'
import type { QQMessage } from '../qq-bot/types'

// ── 类型 ──

interface QQAccount {
  id: string
  qqNumber: string
  nickname: string
  status: 'online' | 'reconnecting' | 'offline' | 'error'
  enabled: boolean
  error?: string
  stats: { groupsCount: number; uptime: number; messagesReceived: number; messagesSent: number }
  config: QQAccountConfig
  createdAt: number
}

interface QQAccountConfig {
  connectionType: 'qr' | 'manual'
  manual?: { host: string; port: number; protocol: 'ws' | 'wss'; token?: string }
  qr?: { sessionToken: string }
  authorization: { defaultPermission: number; cooldownSeconds: number; allowPrivate: boolean }
  bridges: BridgeConfig[]
  /** 自动分配的 OneBot 端口（多账号时每个账号独立端口） */
  assignedPort?: number
  /** 自动分配的 WebUI 端口（多账号时每个账号独立端口） */
  assignedWebUiPort?: number
  /** NapCat 数据持久化目录（Docker 容器挂载路径），为空则使用默认路径 */
  dataDir?: string
}

interface BridgeConfig {
  groupId: string
  direction: 'both' | 'qq_to_game' | 'game_to_qq'
  prefix?: string
  keywords?: string[]
  userWhitelist?: string[]
}

interface LogEntry {
  id: string
  accountId: string
  type: 'group' | 'private' | 'system'
  direction: 'incoming' | 'outgoing'
  userName: string
  userId?: string
  groupId?: string
  content: string
  reply?: string
  duration?: number
  timestamp: string
}

// ── 持久化 ──

const CONFIG_DIR = path.join(app.getPath('userData'), 'qq-bot')
const ACCOUNTS_FILE = path.join(CONFIG_DIR, 'accounts.json')
const LOGS_DIR = path.join(CONFIG_DIR, 'logs')

function ensureDirs(): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.mkdirSync(LOGS_DIR, { recursive: true })
}

function loadAccounts(): { accounts: QQAccount[]; order: string[] } {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'))
    }
  } catch { /* ignore */ }
  return { accounts: [], order: [] }
}

function saveAccounts(accounts: QQAccount[], order: string[]): void {
  ensureDirs()
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({ accounts, order }, null, 2), 'utf-8')
}

function loadLogs(accountId: string): LogEntry[] {
  try {
    const file = path.join(LOGS_DIR, `${accountId}.json`)
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'))
    }
  } catch { /* ignore */ }
  return []
}

function saveLogs(accountId: string, logs: LogEntry[]): void {
  ensureDirs()
  fs.writeFileSync(path.join(LOGS_DIR, `${accountId}.json`), JSON.stringify(logs.slice(0, 200), null, 2), 'utf-8')
}

function appendLog(accountId: string, entry: LogEntry): void {
  const logs = loadLogs(accountId)
  logs.unshift(entry)
  saveLogs(accountId, logs)
}

// ── 默认配置 ──

const DEFAULT_AUTH = { defaultPermission: 1 as const, cooldownSeconds: 3, allowPrivate: true }

// ── Docker / OneBot 运行时管理 ──

interface ManagedDockerInstance {
  qqNumber: string
  manager: DockerContainerManager
}

/** 多账号 Docker 实例 Map，key = accountId (QQAccount.id) */
const dockerContainers = new Map<string, ManagedDockerInstance>()
export const activeClients = new Map<string, OneBotClient>()

/** 并发锁：防止 ensureDockerConnection 被重复调用 */
const pendingAccountConnections = new Set<string>()

/** 端口分配基础 */
const BASE_ONE_BOT_PORT = 3001
const BASE_WEB_UI_PORT = 6099
const MAX_PORT_OFFSET = 50

/** 临时扫码登录的 Docker 管理器（不与已托管账号冲突） */
let qrLoginManager: DockerContainerManager | null = null

/**
 * 为临时扫码登录分配一个不与已托管账号冲突的端口
 */
function findTempPort(): { oneBot: number; webUi: number } {
  const usedPorts = new Set<number>()
  for (const inst of dockerContainers.values()) {
    usedPorts.add(inst.manager.getOneBotPort())
    usedPorts.add(inst.manager.getWebUiPort())
  }
  for (let offset = 0; offset < MAX_PORT_OFFSET; offset++) {
    const oneBot = BASE_ONE_BOT_PORT + offset
    const webUi = BASE_WEB_UI_PORT + offset
    if (!usedPorts.has(oneBot) && !usedPorts.has(webUi)) {
      return { oneBot, webUi }
    }
  }
  throw new Error('无法分配临时端口')
}

/**
 * 延迟辅助函数
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 为账号分配唯一端口（OneBot + WebUI）
 * 优先使用已持久化的端口，否则自动分配最小可用端口
 */
function assignPorts(
  account: QQAccount,
  preferredOneBot?: number,
  preferredWebUi?: number,
): { oneBot: number; webUi: number } {
  // 优先使用持久化端口
  if (preferredOneBot && preferredWebUi) {
    return { oneBot: preferredOneBot, webUi: preferredWebUi }
  }
  if (account.config.assignedPort && account.config.assignedWebUiPort) {
    return { oneBot: account.config.assignedPort, webUi: account.config.assignedWebUiPort }
  }

  // 收集所有已占用端口
  const usedPorts = new Set<number>()
  for (const inst of dockerContainers.values()) {
    usedPorts.add(inst.manager.getOneBotPort())
    usedPorts.add(inst.manager.getWebUiPort())
  }

  // 查找最小可用端口对
  for (let offset = 0; offset < MAX_PORT_OFFSET; offset++) {
    const oneBot = BASE_ONE_BOT_PORT + offset
    const webUi = BASE_WEB_UI_PORT + offset
    if (!usedPorts.has(oneBot) && !usedPorts.has(webUi)) {
      return { oneBot, webUi }
    }
  }
  throw new Error('无法分配可用端口，已超出最大偏移量')
}

/**
 * 获取或创建 Docker 容器管理器
 * 每个托管账号使用独立的 Docker 容器
 */
function getOrCreateDockerContainer(
  account: QQAccount,
  onProgress?: (p: { percent: number; stage: string; message: string }) => void,
): DockerContainerManager {
  const existing = dockerContainers.get(account.id)
  if (existing) return existing.manager

  const ports = assignPorts(account)
  const containerName = `napcat-${account.id.slice(0, 8)}`

  const manager = new DockerContainerManager({
    containerName,
    account: account.qqNumber,
    oneBotPort: ports.oneBot,
    webUiPort: ports.webUi,
    restartPolicy: 'unless-stopped',
    dataDir: account.config.dataDir || undefined,
    onLog: (line) => {
      console.log(`[Docker(${account.qqNumber})] ${line}`)
    },
    onStatusChange: (status) => {
      console.log(`[DockerContainerManager(${account.qqNumber})] status: ${status}`)
    },
  })

  // 持久化端口
  account.config.assignedPort = ports.oneBot
  account.config.assignedWebUiPort = ports.webUi
  const data = loadAccounts()
  const acc = data.accounts.find(a => a.id === account.id)
  if (acc) {
    acc.config.assignedPort = ports.oneBot
    acc.config.assignedWebUiPort = ports.webUi
    saveAccounts(data.accounts, data.order)
  }

  dockerContainers.set(account.id, { qqNumber: account.qqNumber, manager })
  return manager
}

function destroyDockerContainer(accountId?: string): void {
  if (accountId) {
    const inst = dockerContainers.get(accountId)
    if (inst) {
      inst.manager.remove().catch(() => {})
      dockerContainers.delete(accountId)
    }
  } else {
    // 销毁所有容器
    for (const [id] of dockerContainers) {
      destroyDockerContainer(id)
    }
  }
}

function buildWsUrlFromConfig(config: QQAccountConfig): string | null {
  if (config.connectionType === 'manual' && config.manual) {
    return `${config.manual.protocol}://${config.manual.host}:${config.manual.port}`
  }
  // Docker 托管账号使用分配的端口，默认 3001
  const port = config.assignedPort || BASE_ONE_BOT_PORT
  return `ws://127.0.0.1:${port}`
}

function buildAccessToken(config: QQAccountConfig): string | undefined {
  if (config.connectionType === 'manual' && config.manual) {
    return config.manual.token
  }
  return undefined
}

async function connectOneBot(account: QQAccount): Promise<void> {
  // 清理残存客户端（上次连接失败留下的）
  const existing = activeClients.get(account.id)
  if (existing) {
    // 已有活跃连接 → 不用重复创建
    if (existing.getStatus() === 'connected') {
      console.log(`[QQBot] 账号 ${account.qqNumber} 已有活跃 OneBot 连接，跳过`)
      return
    }
    // 清理残存（未连接）客户端
    console.log(`[QQBot] 清理残存 OneBot 客户端 (account=${account.qqNumber})`)
    await existing.disconnect().catch(() => {})
    activeClients.delete(account.id)
  }

  const wsUrl = buildWsUrlFromConfig(account.config)
  if (!wsUrl) return

  const client = new OneBotClient({
    wsUrl,
    accessToken: buildAccessToken(account.config),
    reconnectInterval: 5000,
    maxReconnectAttempts: 10,
    heartbeatInterval: 10000,
  })

  client.onMessage((msg: QQMessage) => {
    appendLog(account.id, {
      id: uuidv4(),
      accountId: account.id,
      type: msg.type,
      direction: 'incoming',
      userName: msg.userName,
      userId: msg.userId,
      groupId: msg.groupId,
      content: msg.content,
      timestamp: new Date(msg.timestamp * 1000).toISOString(),
    })

    const data = loadAccounts()
    const acc = data.accounts.find(a => a.id === account.id)
    if (acc) {
      acc.stats.messagesReceived++
      saveAccounts(data.accounts, data.order)
    }

    // V24: 路由消息到绑定的 Agent 实例
    routeQQMessageToAgent(account.id, msg, client).catch((err) =>
      console.error(`[QQBot] 路由消息到 Agent 失败:`, err),
    )
  })

  client.onStatusChange((status) => {
    const data = loadAccounts()
    const acc = data.accounts.find(a => a.id === account.id)
    if (!acc) return

    if (status === 'connected') {
      acc.status = 'online'
      acc.error = undefined
    } else if (status === 'reconnecting') {
      acc.status = 'reconnecting'
    } else {
      acc.status = acc.enabled ? 'offline' : 'offline'
    }
    saveAccounts(data.accounts, data.order)

    // 推送状态更新到前端
    mainWindow?.webContents.send('qq-bot:status-update', {
      accountId: account.id,
      status: acc.status,
      error: acc.error,
    })
  })

  activeClients.set(account.id, client)
  try {
    await client.connect()
  } catch (err) {
    // 初始连接失败，但不清理 activeClients
    // OneBotClient 内部会后台自动重连，保留 client 让 disconnectOneBot 可正常停止
    throw err
  }
}

async function disconnectOneBot(accountId: string): Promise<void> {
  const client = activeClients.get(accountId)
  if (client) {
    await client.disconnect()
    activeClients.delete(accountId)
  }
}

/** 断开所有已托管 OneBot 连接（用于扫码登录前清理） */
async function disconnectAllManagedClients(): Promise<void> {
  const ids = Array.from(activeClients.keys())
  if (ids.length === 0) return
  console.log(`[QQBot] 断开所有托管客户端 (${ids.length} 个)...`)
  await Promise.allSettled(ids.map(id => disconnectOneBot(id)))
}

async function ensureDockerConnection(account: QQAccount): Promise<void> {
  if (account.config.connectionType !== 'qr') return

  // 🔒 并发锁：React StrictMode 双渲染可能导致重复调用
  if (pendingAccountConnections.has(account.id)) {
    console.log(`[QQBot] 账号 ${account.qqNumber} 连接已在进行中，跳过重复调用`)
    return
  }
  pendingAccountConnections.add(account.id)

  try {
    const manager = getOrCreateDockerContainer(account)

    if (manager.getStatus() === 'idle' || manager.getStatus() === 'error') {
      console.log(`[QQBot] ▶ 启动 Docker 容器 (account=${account.qqNumber})...`)
      await manager.start()
    } else {
      console.log(`[QQBot] ▶ Docker 容器已在运行 (account=${account.qqNumber}, status=${manager.getStatus()})，跳过启动`)
    }

    // 给容器一点时间启动 OneBot WebSocket 服务（WebUI 就绪后 WS 还需几秒）
    console.log(`[QQBot] ▶ 等待 OneBot WebSocket 服务就绪 (account=${account.qqNumber})...`)
    await delay(2000)

    try {
      await connectOneBot(account)
      console.log(`[QQBot] ▶ OneBot 连接成功 (account=${account.qqNumber})`)
    } catch (err) {
      // ❌ 不停止容器！
      // OneBotClient 会后台自动重连，停容器反而让重连永远失败
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`[QQBot] ⚠ 初始 OneBot 连接失败 (account=${account.qqNumber}, ${msg})，客户端将自动重连`)
      throw err
    }
  } finally {
    pendingAccountConnections.delete(account.id)
  }
}

function createManagedAccount(info: { uin: string; nickname: string }, oneBotPort?: number, webUiPort?: number): QQAccount {
  const data = loadAccounts()
  const existing = data.accounts.find(a => a.qqNumber === info.uin)
  if (existing) {
    existing.nickname = info.nickname || existing.nickname
    existing.config.connectionType = 'qr'
    if (oneBotPort) existing.config.assignedPort = oneBotPort
    if (webUiPort) existing.config.assignedWebUiPort = webUiPort
    saveAccounts(data.accounts, data.order)
    return existing
  }

  const account: QQAccount = {
    id: uuidv4(),
    qqNumber: info.uin,
    nickname: info.nickname,
    status: 'offline',
    enabled: true,
    stats: { groupsCount: 0, uptime: 0, messagesReceived: 0, messagesSent: 0 },
    config: {
      connectionType: 'qr',
      authorization: DEFAULT_AUTH,
      bridges: [],
      assignedPort: oneBotPort,
      assignedWebUiPort: webUiPort,
    },
    createdAt: Date.now(),
  }
  data.accounts.push(account)
  data.order.push(account.id)
  saveAccounts(data.accounts, data.order)
  return account
}

// ── 注册 Handler ──

/** 主窗口引用，用于向前端推送状态更新 */
let mainWindow: BrowserWindow | null = null

export function registerQQBotHandlers(win?: BrowserWindow): void {
  mainWindow = win ?? null
  ensureDirs()

  // 获取账号列表
  ipcMain.handle('qq-bot:get-accounts', async () => {
    return loadAccounts()
  })

  // 添加账号（手动配置）
  ipcMain.handle('qq-bot:add-account', async (_, config: QQAccountConfig) => {
    const data = loadAccounts()
    const account: QQAccount = {
      id: uuidv4(),
      qqNumber: '',
      nickname: '',
      status: 'offline',
      enabled: true,
      stats: { groupsCount: 0, uptime: 0, messagesReceived: 0, messagesSent: 0 },
      config: { ...config, authorization: config.authorization ?? DEFAULT_AUTH, bridges: config.bridges ?? [] },
      createdAt: Date.now(),
    }
    data.accounts.push(account)
    data.order.push(account.id)
    saveAccounts(data.accounts, data.order)
    return { success: true, accountId: account.id }
  })

  // 删除账号
  ipcMain.handle('qq-bot:remove-account', async (_, id: string) => {
    const data = loadAccounts()
    const account = data.accounts.find(a => a.id === id)
    if (account?.enabled) {
      await disconnectOneBot(id)
    }
    // 清理 Docker 容器
    destroyDockerContainer(id)
    data.accounts = data.accounts.filter(a => a.id !== id)
    data.order = data.order.filter(o => o !== id)
    saveAccounts(data.accounts, data.order)
    try { fs.unlinkSync(path.join(LOGS_DIR, `${id}.json`)) } catch { /* ignore */ }
    return { success: true }
  })

  // 切换账号开关
  ipcMain.handle('qq-bot:toggle-account', async (_, id: string, enabled: boolean) => {
    const data = loadAccounts()
    const account = data.accounts.find(a => a.id === id)
    if (!account) return { success: false }

    // 临时限制：单账号检查
    if (enabled) {
      const otherEnabled = data.accounts.find(
        a => a.id !== id && a.enabled && a.config.connectionType === 'qr'
      )
      if (otherEnabled) {
        const msg = `临时限制：当前仅支持单账号运行。账号 ${otherEnabled.qqNumber} 已启用，请先禁用该账号再启用其他账号`
        console.log(`[QQBot] ⚠ ${msg}`)
        account.status = 'error'
        account.error = msg
        saveAccounts(data.accounts, data.order)
        mainWindow?.webContents.send('qq-bot:status-update', {
          accountId: id,
          status: 'error',
          error: msg,
        })
        return { success: false, error: msg }
      }
    }

    account.enabled = enabled
    account.status = enabled ? 'reconnecting' : 'offline'
    account.error = undefined
    saveAccounts(data.accounts, data.order)

    // 推送初始状态到前端
    mainWindow?.webContents.send('qq-bot:status-update', {
      accountId: id,
      status: account.status,
      error: account.error,
    })

    if (enabled) {
      try {
        if (account.config.connectionType === 'qr') {
          await ensureDockerConnection(account)
        } else {
          await connectOneBot(account)
        }
      } catch (err) {
        account.status = 'error'
        account.error = err instanceof Error ? err.message : String(err)
        saveAccounts(data.accounts, data.order)

        // 推送失败状态到前端
        mainWindow?.webContents.send('qq-bot:status-update', {
          accountId: id,
          status: 'error',
          error: account.error,
        })
      }
    } else {
      await disconnectOneBot(id)
      // 推送离线状态到前端
      mainWindow?.webContents.send('qq-bot:status-update', {
        accountId: id,
        status: 'offline',
      })
      // Docker 容器：Docker 的 --restart=unless-stopped 会自动管理
      // 不需要延迟杀进程，Docker 重启策略会处理
      destroyDockerContainer(id)
    }

    return { success: true }
  })

  // 保存排序
  ipcMain.handle('qq-bot:reorder-accounts', async (_, order: string[]) => {
    const data = loadAccounts()
    data.order = order
    saveAccounts(data.accounts, data.order)
    return { success: true }
  })

  // Docker 安装状态
  ipcMain.handle('qq-bot:get-install-status', async () => {
    const dockerInfo = await DockerContainerManager.getDockerInfo()
    return {
      installed: dockerInfo.version ? true : false,
      dockerVersion: dockerInfo.version,
      isDockerInstalled: dockerInfo.isDockerInstalled,
      error: dockerInfo.error,
      installDir: 'Docker Desktop', // Docker 方案无需安装目录
      defaultInstallDir: 'Docker Desktop',
    }
  })

  // 选择安装目录（Docker 方案不需要，但保留 API 兼容性）
  ipcMain.handle('qq-bot:choose-install-dir', async () => {
    return null
  })

  // 安装 NapCat（Docker 方案：通过 docker pull 安装）
  ipcMain.handle('qq-bot:install-napcat', async () => {
    // Docker 方案：无需手动安装，容器启动时自动拉取镜像
    const dockerInfo = await DockerContainerManager.getDockerInfo()
    if (!dockerInfo.version) {
      return { success: false, error: `Docker 不可用: ${dockerInfo.error || '请确保 Docker 已安装并正在运行'}` }
    }
    // 创建一个临时管理器来拉取镜像（验证拉取是否成功）
    const tempManager = new DockerContainerManager({
      containerName: 'napcat-install-test',
      oneBotPort: 3099,
      webUiPort: 6199,
    })
    try {
      await tempManager.pull()
      return { success: true, message: 'NapCat 镜像已拉取完成' }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 设置 NapCat 目录（Docker 方案不需要，保留 API 兼容性）
  ipcMain.handle('qq-bot:set-napcat-dir', async () => {
    return { success: true }
  })

  // 扫码登录 - 开始
  ipcMain.handle('qq-bot:start-qr-login', async () => {
    const dockerInfo = await DockerContainerManager.getDockerInfo()
    if (!dockerInfo.version) {
      throw new Error(`Docker 不可用: ${dockerInfo.error || '请确保 Docker 已安装并正在运行'}`)
    }

    // 如果已有 QR 登录实例在运行，先清理
    if (qrLoginManager) {
      qrLoginManager.remove().catch(() => {})
      qrLoginManager = null
    }

    // 创建临时 Docker 容器用于扫码（无 -q 参数）
    const tempPort = findTempPort()
    const tempManager = new DockerContainerManager({
      containerName: `napcat-qr-login-${Date.now().toString(36)}`,
      oneBotPort: tempPort.oneBot,
      webUiPort: tempPort.webUi,
      restartPolicy: 'no', // 临时容器，不自动重启
      onLog: (line) => console.log(`[Docker(QR)] ${line}`),
      onStatusChange: (status) => console.log(`[Docker(QR)] status: ${status}`),
    })

    qrLoginManager = tempManager

    // 启动容器（自动拉取镜像）
    await tempManager.start()

    // 等待 NapCat 完全就绪后获取二维码（带重试）
    let lastError: Error | null = null
    for (let i = 0; i < 3; i++) {
      try {
        if (i > 0) {
          console.log(`[QQBot] 二维码获取重试 (第 ${i + 1} 次)...`)
          await delay(2000)
        }
        const qr = await tempManager.getQRCode()
        return { url: qr.url, expiresAt: qr.expiresAt }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
      }
    }
    throw lastError || new Error('获取二维码失败')
  })

  // 扫码登录 - 检查状态
  ipcMain.handle('qq-bot:check-qr-login', async () => {
    const manager = qrLoginManager
    if (!manager) return { isLogin: false, isOffline: false }

    try {
      const status = await manager.checkLoginStatus()
      if (status.isLogin) {
        const info = await manager.getLoginInfo()
        if (info) {
          // 获取临时管理器的端口，分配给新账号
          const tempPort = manager.getOneBotPort()
          const tempWebUiPort = manager.getWebUiPort()
          const account = createManagedAccount(info, tempPort, tempWebUiPort)

          // 清理临时 QR 登录管理器
          qrLoginManager = null
          manager.remove().catch(() => {})

          // 自动启用新账号
          if (account.enabled) {
            await ensureDockerConnection(account)
          }
        }
      }
      return status
    } catch (err) {
      return { isLogin: false, isOffline: false, loginError: err instanceof Error ? err.message : String(err) }
    }
  })

  // 扫码登录 - 取消
  ipcMain.handle('qq-bot:cancel-qr-login', async () => {
    if (qrLoginManager) {
      qrLoginManager.remove().catch(() => {})
      qrLoginManager = null
    }
    return { success: true }
  })

  // 强制停止 Docker 容器管理器（兜底重置，支持按账号）
  ipcMain.handle('qq-bot:stop-manager', async (_, accountId?: string) => {
    if (accountId) {
      destroyDockerContainer(accountId)
    } else {
      destroyDockerContainer()
    }
    return { success: true }
  })

  // 获取容器管理器状态（支持按账号）
  ipcMain.handle('qq-bot:get-manager-status', async (_, accountId?: string) => {
    if (accountId) {
      const inst = dockerContainers.get(accountId)
      if (!inst) return { exists: false, status: null }
      return { exists: true, status: inst.manager.getStatus(), qqNumber: inst.qqNumber }
    }
    // 返回所有账号的状态摘要
    const summaries: Array<{ accountId: string; qqNumber: string; status: string }> = []
    for (const [id, inst] of dockerContainers) {
      summaries.push({ accountId: id, qqNumber: inst.qqNumber, status: inst.manager.getStatus() })
    }
    return { exists: summaries.length > 0, instances: summaries }
  })

  // 测试连接
  ipcMain.handle('qq-bot:test-connection', async (_, params: { host: string; port: number; protocol: string; token?: string }) => {
    return testWebSocketConnection(params)
  })

  // 获取配置
  ipcMain.handle('qq-bot:get-config', async (_, accountId: string) => {
    const data = loadAccounts()
    const account = data.accounts.find(a => a.id === accountId)
    return account?.config ?? null
  })

  // 保存配置
  ipcMain.handle('qq-bot:save-config', async (_, accountId: string, config: QQAccountConfig) => {
    const data = loadAccounts()
    const account = data.accounts.find(a => a.id === accountId)
    if (account) {
      account.config = config
      saveAccounts(data.accounts, data.order)
    }
    return { success: true }
  })

  // 选择数据存储目录（docker 容器挂载路径）
  ipcMain.handle('qq-bot:choose-data-dir', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择 NapCat 数据存储目录',
      message: 'NapCat 登录态数据将存储在此目录（含 QQ 聊天缓存、图片等），不占 C 盘空间',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // 获取消息日志
  ipcMain.handle('qq-bot:get-message-log', async (_, accountId: string, params: { offset?: number; type?: string; search?: string }) => {
    let logs = loadLogs(accountId)
    const offset = params.offset ?? 0
    const limit = 50

    if (params.type && params.type !== 'all') {
      logs = logs.filter(l => l.type === params.type)
    }
    if (params.search) {
      const q = params.search.toLowerCase()
      logs = logs.filter(l => l.content.toLowerCase().includes(q) || (l.reply && l.reply.toLowerCase().includes(q)))
    }

    return logs.slice(offset, offset + limit)
  })

  // 清空日志
  ipcMain.handle('qq-bot:clear-logs', async (_, accountId: string) => {
    saveLogs(accountId, [])
    return { success: true }
  })
}

/**
 * 测试 WebSocket 连接
 */
async function testWebSocketConnection(params: { host: string; port: number; protocol: string; token?: string }): Promise<{ success: boolean; latency?: number; error?: string }> {
  const wsUrl = `${params.protocol}://${params.host}:${params.port}${params.token ? `?access_token=${params.token}` : ''}`
  const startedAt = Date.now()

  return new Promise((resolve) => {
    let resolved = false
    const ws = new WebSocket(wsUrl)

    const timer = setTimeout(() => {
      if (resolved) return
      resolved = true
      ws.terminate()
      resolve({ success: false, error: '连接超时' })
    }, 5000)

    ws.on('open', () => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      ws.close()
      resolve({ success: true, latency: Date.now() - startedAt })
    })

    ws.on('error', (err) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      ws.terminate()
      resolve({ success: false, error: err.message })
    })
  })
}

/**
 * 获取当前已启用且正在运行的账号数
 */
function getEnabledRunningAccountCount(): number {
  const data = loadAccounts()
  return data.accounts.filter(a => a.enabled && a.config.connectionType === 'qr').length
}

/**
 * 自动启动第一个已启用的托管 QQ 账号
 * 使用 Docker 容器方案
 */
export async function autoStartQQBotAccounts(): Promise<void> {
  console.log('[QQBot] 检查已启用的 QQ 账号...')
  const data = loadAccounts()
  const enabledAccounts = data.accounts.filter(a => a.enabled && a.config.connectionType === 'qr')
  if (enabledAccounts.length === 0) {
    console.log('[QQBot] 没有已启用的托管账号，跳过自动启动')
    return
  }

  // 临时限制：只启动第一个已启用的账号
  const firstAccount = enabledAccounts[0]
  if (enabledAccounts.length > 1) {
    console.log(`[QQBot] ⚠ 临时限制：发现 ${enabledAccounts.length} 个已启用账号，只启动第一个 (${firstAccount.qqNumber})`)
    for (const account of enabledAccounts.slice(1)) {
      account.enabled = false
      account.status = 'offline'
      account.error = '临时限制：当前仅支持单账号运行，请先禁用其他账号'
    }
    saveAccounts(data.accounts, data.order)
    for (const account of enabledAccounts.slice(1)) {
      mainWindow?.webContents.send('qq-bot:status-update', {
        accountId: account.id,
        status: 'offline',
        error: '临时限制：当前仅支持单账号运行',
      })
    }
  }

  console.log(`[QQBot] 自动启动账号 ${firstAccount.qqNumber}...`)
  firstAccount.status = 'reconnecting'
  firstAccount.error = undefined
  saveAccounts(data.accounts, data.order)
  mainWindow?.webContents.send('qq-bot:status-update', {
    accountId: firstAccount.id,
    status: 'reconnecting',
  })

  try {
    await ensureDockerConnection(firstAccount)
  } catch (err) {
    const data2 = loadAccounts()
    const acc = data2.accounts.find(a => a.id === firstAccount.id)
    if (acc) {
      acc.status = 'error'
      acc.error = err instanceof Error ? err.message : String(err)
      saveAccounts(data2.accounts, data2.order)
    }
    mainWindow?.webContents.send('qq-bot:status-update', {
      accountId: firstAccount.id,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
    console.error(`[QQBot] 自动启动账号 ${firstAccount.qqNumber} 失败:`, err)
  }
  console.log('[QQBot] 自动启动完成')
}