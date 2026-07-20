import { ipcMain, dialog, BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import WebSocket from 'ws'
import { DockerContainerManager } from '../qq-bot/docker-container-manager'
import type { ContainerStatus } from '../qq-bot/docker-container-manager'
import { NapCatManager } from '../qq-bot/napcat-manager'
import type { NapCatStatus } from '../qq-bot/napcat-manager'
import { OneBotClient } from '../qq-bot/onebot-client'
import { routeQQMessageToAgent } from '../qq-bot/message-router'
import type { QQMessage } from '../qq-bot/types'
import { getSharedAgentConfigManager } from './agent-handler'

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
  /** 部署模式：docker（Docker 容器方案）| desktop（桌面版 NapCat 进程管理） */
  deploymentMode: 'docker' | 'desktop'
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

function loadAccounts(): { accounts: QQAccount[]; order: string[]; meta?: Record<string, unknown> } {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'))
    }
  } catch { /* ignore */ }
  return { accounts: [], order: [] }
}

function saveAccounts(accounts: QQAccount[], order: string[], meta?: Record<string, unknown>): void {
  ensureDirs()
  // 当 meta 未显式传入时，从现有文件读取并保留 meta，避免丢失 deploymentMode 等配置
  const resolvedMeta = meta !== undefined ? meta : (() => {
    try {
      if (fs.existsSync(ACCOUNTS_FILE)) {
        const existing = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'))
        return existing.meta
      }
    } catch { /* ignore */ }
    return undefined
  })()
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({ accounts, order, meta: resolvedMeta }, null, 2), 'utf-8')
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

// ── 运行时管理 ──

interface ManagedDockerInstance {
  qqNumber: string
  manager: DockerContainerManager
}

interface ManagedNapcatInstance {
  qqNumber: string
  manager: NapCatManager
}

/** 多账号 Docker 实例 Map，key = accountId (QQAccount.id) */
const dockerContainers = new Map<string, ManagedDockerInstance>()
/** 多账号 NapCat 桌面版实例 Map，key = accountId (QQAccount.id) */
const napcatInstances = new Map<string, ManagedNapcatInstance>()
export const activeClients = new Map<string, OneBotClient>()

/** 并发锁：防止 ensureManagedConnection 被重复调用 */
const pendingAccountConnections = new Set<string>()

/** 端口分配基础 */
const BASE_ONE_BOT_PORT = 3001
const BASE_WEB_UI_PORT = 6099
const MAX_PORT_OFFSET = 50

/** 临时扫码登录的管理器（Docker 或 NapCat） */
let qrLoginManager: DockerContainerManager | null = null
let qrLoginNapcatManager: NapCatManager | null = null

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
 * 同时考虑 Docker 和 NapCat 桌面版实例
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

  // 收集所有已占用端口（Docker + NapCat 桌面版）
  const usedPorts = new Set<number>()
  for (const inst of dockerContainers.values()) {
    usedPorts.add(inst.manager.getOneBotPort())
    usedPorts.add(inst.manager.getWebUiPort())
  }
  for (const inst of napcatInstances.values()) {
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
 * 获取或创建托管连接管理器（Docker 或 NapCat 桌面版）
 * 根据 account.config.deploymentMode 选择方案
 */
function getOrCreateManagedContainer(
  account: QQAccount,
  onProgress?: (p: { percent: number; stage: string; message: string }) => void,
): DockerContainerManager | NapCatManager {
  if (account.config.deploymentMode === 'desktop') {
    return getOrCreateNapcatContainer(account, onProgress)
  }
  return getOrCreateDockerContainer(account, onProgress)
}

/**
 * 获取或创建 NapCat 桌面版管理器
 */
function getOrCreateNapcatContainer(
  account: QQAccount,
  _onProgress?: (p: { percent: number; stage: string; message: string }) => void,
): NapCatManager {
  const existing = napcatInstances.get(account.id)
  if (existing) return existing.manager

  const ports = assignPorts(account)

  // 获取自定义安装目录：优先使用账号配置 dataDir，其次 data.meta 中保存的路径
  const data = loadAccounts()
  const customInstallDir = data.meta?.customInstallDir as string | undefined
  const installDir = account.config.dataDir || customInstallDir || path.join(process.cwd(), 'Alice', 'qq-bot', 'napcat-install')
  const userDataPath = account.config.dataDir || path.join(process.cwd(), 'Alice', 'qq-bot', 'napcat-data', account.id.slice(0, 8))

  const manager = new NapCatManager({
    installDir,
    userDataPath,
    account: account.qqNumber,
    oneBotPort: ports.oneBot,
    webUiPort: ports.webUi,
    onLog: (line) => {
      console.log(`[NapCat(${account.qqNumber})] ${line}`)
    },
    onStatusChange: (status) => {
      console.log(`[NapCatManager(${account.qqNumber})] status: ${status}`)
    },
  })

  // 持久化端口
  account.config.assignedPort = ports.oneBot
  account.config.assignedWebUiPort = ports.webUi
  const acc = data.accounts.find(a => a.id === account.id)
  if (acc) {
    acc.config.assignedPort = ports.oneBot
    acc.config.assignedWebUiPort = ports.webUi
    saveAccounts(data.accounts, data.order, data.meta)
  }

  napcatInstances.set(account.id, { qqNumber: account.qqNumber, manager })
  return manager
}

/**
 * 获取或创建 Docker 容器管理器
 * 每个托管账号使用独立的 Docker 容器
 */
function getOrCreateDockerContainer(
  account: QQAccount,
  _onProgress?: (p: { percent: number; stage: string; message: string }) => void,
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

function destroyManagedContainer(accountId?: string): void {
  if (accountId) {
    // 销毁 Docker 容器
    const dockerInst = dockerContainers.get(accountId)
    if (dockerInst) {
      dockerInst.manager.remove().catch(() => {})
      dockerContainers.delete(accountId)
    }
    // 销毁 NapCat 桌面版进程
    const napcatInst = napcatInstances.get(accountId)
    if (napcatInst) {
      napcatInst.manager.stop().catch(() => {})
      napcatInstances.delete(accountId)
    }
  } else {
    // 销毁所有
    for (const [id] of dockerContainers) {
      dockerContainers.get(id)?.manager.remove().catch(() => {})
      dockerContainers.delete(id)
    }
    for (const [id] of napcatInstances) {
      napcatInstances.get(id)?.manager.stop().catch(() => {})
      napcatInstances.delete(id)
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
    routeQQMessageToAgent(account.id, account.qqNumber, msg, client).catch((err) =>
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

async function ensureManagedConnection(account: QQAccount): Promise<void> {
  if (account.config.connectionType !== 'qr') return

  // ⚡ 同步 data.meta.deploymentMode 到账号配置
  // 修复：如果用户通过桌面版安装（data.meta.deploymentMode === 'desktop'），
  // 但账号因历史 bug 导致 deploymentMode 为 'docker' 或未设置，纠正为 'desktop'
  if (account.config.deploymentMode !== 'desktop') {
    const data = loadAccounts()
    if (data.meta?.deploymentMode === 'desktop') {
      console.log(`[QQBot] 纠正账号 ${account.qqNumber} deploymentMode: ${account.config.deploymentMode} → desktop`)
      account.config.deploymentMode = 'desktop'
      const acc = data.accounts.find(a => a.id === account.id)
      if (acc) {
        acc.config.deploymentMode = 'desktop'
        saveAccounts(data.accounts, data.order, data.meta)
      }
    }
  }

  // 🔒 并发锁：React StrictMode 双渲染可能导致重复调用
  if (pendingAccountConnections.has(account.id)) {
    console.log(`[QQBot] 账号 ${account.qqNumber} 连接已在进行中，跳过重复调用`)
    return
  }
  pendingAccountConnections.add(account.id)

  try {
    const manager = getOrCreateManagedContainer(account)

    if (account.config.deploymentMode === 'desktop') {
      // NapCat 桌面版
      const napcatManager = manager as NapCatManager
      if (napcatManager.getStatus() === 'idle' || napcatManager.getStatus() === 'error') {
        console.log(`[QQBot] ▶ 启动 NapCat 桌面版 (account=${account.qqNumber})...`)
        await napcatManager.start()
      } else {
        console.log(`[QQBot] ▶ NapCat 桌面版已在运行 (account=${account.qqNumber}, status=${napcatManager.getStatus()})，跳过启动`)
      }
    } else {
      // Docker 容器
      const dockerManager = manager as DockerContainerManager
      if (dockerManager.getStatus() === 'idle' || dockerManager.getStatus() === 'error') {
        console.log(`[QQBot] ▶ 启动 Docker 容器 (account=${account.qqNumber})...`)
        await dockerManager.start()
      } else {
        console.log(`[QQBot] ▶ Docker 容器已在运行 (account=${account.qqNumber}, status=${dockerManager.getStatus()})，跳过启动`)
      }
    }

    // 给容器一点时间启动 OneBot WebSocket 服务（WebUI 就绪后 WS 还需几秒）
    console.log(`[QQBot] ▶ 等待 OneBot WebSocket 服务就绪 (account=${account.qqNumber})...`)
    await delay(2000)

    try {
      await connectOneBot(account)
      console.log(`[QQBot] ▶ OneBot 连接成功 (account=${account.qqNumber})`)
    } catch (err) {
      // ❌ 不停止容器/进程！
      // OneBotClient 会后台自动重连，停容器反而让重连永远失败
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`[QQBot] ⚠ 初始 OneBot 连接失败 (account=${account.qqNumber}, ${msg})，客户端将自动重连`)
      throw err
    }
  } finally {
    pendingAccountConnections.delete(account.id)
  }
}

function createManagedAccount(info: { uin: string; nickname: string }, oneBotPort?: number, webUiPort?: number, deploymentMode?: 'docker' | 'desktop'): QQAccount {
  const data = loadAccounts()
  const existing = data.accounts.find(a => a.qqNumber === info.uin)
  if (existing) {
    existing.nickname = info.nickname || existing.nickname
    existing.config.connectionType = 'qr'
    // 只在创建时设置 deploymentMode，不覆盖已有账号的模式
    if (deploymentMode) existing.config.deploymentMode = deploymentMode
    if (oneBotPort) existing.config.assignedPort = oneBotPort
    if (webUiPort) existing.config.assignedWebUiPort = webUiPort
    saveAccounts(data.accounts, data.order, data.meta)
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
      deploymentMode: deploymentMode || 'docker', // 使用传入的模式，默认 docker
      authorization: DEFAULT_AUTH,
      bridges: [],
      assignedPort: oneBotPort,
      assignedWebUiPort: webUiPort,
    },
    createdAt: Date.now(),
  }
  data.accounts.push(account)
  data.order.push(account.id)
  saveAccounts(data.accounts, data.order, data.meta)
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

  // V28：获取 QQ 账号绑定的 Agent 信息（workspaceId + agentId），用于前端加载 LLM 对话历史
  ipcMain.handle('qq-bot:get-agent-binding', async (_, accountId: string) => {
    try {
      const configManager = getSharedAgentConfigManager()
      const agents = await configManager.list()
      // 遍历所有 agent，用 get() 获取完整配置检查 qqBinding
      for (const summary of agents) {
        const config = await configManager.get(summary.id)
        if (config?.qqBinding?.enabled && config.qqBinding.accountId === accountId) {
          return { workspaceId: config.workspaceId ?? '', agentId: config.id! }
        }
      }
      return null
    } catch {
      return null
    }
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
    // 清理托管容器/进程
    destroyManagedContainer(id)
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
          await ensureManagedConnection(account)
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
      // 清理托管容器/进程
      destroyManagedContainer(id)
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

  // 安装环境状态（Docker + NapCat 桌面版）
  ipcMain.handle('qq-bot:get-install-status', async () => {
    const dockerInfo = await DockerContainerManager.getDockerInfo()
    // 检查 NapCat 桌面版是否已安装（默认目录 + 手动安装的自定义目录）
    const defaultInstallDir = path.join(process.cwd(), 'Alice', 'qq-bot', 'napcat-install')
    const defaultInstalled = fs.existsSync(path.join(defaultInstallDir, 'package.json'))

    // 检查手动安装的自定义目录
    const data = loadAccounts()
    const customInstallDir = data.meta?.customInstallDir as string | undefined
    let customInstalled = false
    if (customInstallDir) {
      customInstalled = fs.existsSync(path.join(customInstallDir, 'package.json'))
    }

    const napcatInstalled = defaultInstalled || customInstalled
    const installDir = customInstallDir && customInstalled ? customInstallDir : defaultInstallDir

    return {
      installed: dockerInfo.version ? true : napcatInstalled,
      dockerVersion: dockerInfo.version,
      isDockerInstalled: dockerInfo.isDockerInstalled,
      napcatInstalled,
      error: dockerInfo.error,
      installDir,
      defaultInstallDir,
    }
  })

  // 选择安装目录（Docker/桌面版通用）
  ipcMain.handle('qq-bot:choose-install-dir', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择 NapCat 安装目录',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // 验证手动安装的 NapCat 目录是否有效
  ipcMain.handle('qq-bot:verify-napcat-install', async (_, dir: string) => {
    try {
      // 检查 package.json 是否存在
      const pkgJsonPath = path.join(dir, 'package.json')
      if (!fs.existsSync(pkgJsonPath)) {
        return { success: false, error: '未找到 package.json，请确认已选择 NapCat 安装目录' }
      }

      // 检查可执行文件是否存在
      const candidates = ['napcat.bat', 'launcher.bat', 'launcher-win10.bat', 'NapCatWinBootMain.exe', 'napcat.exe']
      let foundExecutable = false
      for (const name of candidates) {
        if (fs.existsSync(path.join(dir, name))) {
          foundExecutable = true
          break
        }
      }
      // 也检查一级子目录
      if (!foundExecutable) {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true })
          for (const entry of entries) {
            if (entry.isDirectory()) {
              for (const name of candidates) {
                if (fs.existsSync(path.join(dir, entry.name, name))) {
                  foundExecutable = true
                  break
                }
              }
              if (foundExecutable) break
            }
          }
        } catch { /* ignore */ }
      }

      if (!foundExecutable) {
        return { success: false, error: '未找到 NapCat 可执行文件（napcat.bat/launcher.bat），请确认已下载 NapCat' }
      }

      // 将用户选择的安装目录持久化，供后续 get-install-status 使用
      const data = loadAccounts()
      data.meta = data.meta || {}
      data.meta.customInstallDir = dir
      data.meta.deploymentMode = 'desktop' // 手动安装即桌面版模式
      saveAccounts(data.accounts, data.order, data.meta)

      return { success: true, installDir: dir }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '验证安装目录失败' }
    }
  })

  // 安装 NapCat（支持 Docker 和桌面版两种模式）
  ipcMain.handle('qq-bot:install-napcat', async (_, mode?: string, installDir?: string) => {
    const deployMode = mode || 'docker'
    if (deployMode === 'docker') {
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
    } else {
      // 桌面版方案：使用 NapCatManager 安装
      const installDirPath = installDir || path.join(process.cwd(), 'Alice', 'qq-bot', 'napcat-install')
      const napcatManager = new NapCatManager({
        installDir: installDirPath,
        userDataPath: installDirPath,
        oneBotPort: 3001,
        webUiPort: 6099,
      })
      try {
        await napcatManager.start()
        await napcatManager.stop()
        // 存储桌面版部署模式，供后续 QR 登录使用
        const data = loadAccounts()
        data.meta = data.meta || {}
        data.meta.deploymentMode = 'desktop'
        if (installDir) data.meta.customInstallDir = installDirPath
        saveAccounts(data.accounts, data.order, data.meta)
        return { success: true, message: 'NapCat 桌面版已安装完成' }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  })

  // 设置 NapCat 目录（Docker 方案不需要，保留 API 兼容性）
  ipcMain.handle('qq-bot:set-napcat-dir', async () => {
    return { success: true }
  })

  // 扫码登录 - 开始
  ipcMain.handle('qq-bot:start-qr-login', async (_, mode?: string) => {
    // 没有指定模式时，从 data.meta 读取（桌面版安装时已存储）
    const data = loadAccounts()
    const deployMode = mode || (data.meta?.deploymentMode as string) || 'docker'

    // 清理已有 QR 登录实例
    if (qrLoginManager) {
      qrLoginManager.remove().catch(() => {})
      qrLoginManager = null
    }
    if (qrLoginNapcatManager) {
      qrLoginNapcatManager.stop().catch(() => {})
      qrLoginNapcatManager = null
    }

    if (deployMode === 'desktop') {
      // ── 桌面版 QR 登录 ──
      const data = loadAccounts()
      const customInstallDir = data.meta?.customInstallDir as string | undefined
      const installDir = customInstallDir || path.join(process.cwd(), 'Alice', 'qq-bot', 'napcat-install')
      const userDataPath = path.join(process.cwd(), 'Alice', 'qq-bot', 'napcat-data', 'qr-login')

      const tempPort = findTempPort()
      const tempManager = new NapCatManager({
        installDir,
        userDataPath,
        oneBotPort: tempPort.oneBot,
        webUiPort: tempPort.webUi,
        onLog: (line) => console.log(`[NapCat(QR)] ${line}`),
        onStatusChange: (status) => console.log(`[NapCat(QR)] status: ${status}`),
      })

      qrLoginNapcatManager = tempManager

      // 启动桌面版 NapCat
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
    } else {
      // ── Docker QR 登录 ──
      const dockerInfo = await DockerContainerManager.getDockerInfo()
      if (!dockerInfo.version) {
        throw new Error(`Docker 不可用: ${dockerInfo.error || '请确保 Docker 已安装并正在运行'}`)
      }

      // 创建临时 Docker 容器用于扫码
      const tempPort = findTempPort()
      const tempManager = new DockerContainerManager({
        containerName: `napcat-qr-login-${Date.now().toString(36)}`,
        oneBotPort: tempPort.oneBot,
        webUiPort: tempPort.webUi,
        restartPolicy: 'no',
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
    }
  })

  // 扫码登录 - 检查状态
  ipcMain.handle('qq-bot:check-qr-login', async () => {
    // 优先检查桌面版 QR 登录
    const napcatManager = qrLoginNapcatManager
    if (napcatManager) {
      try {
        const status = await napcatManager.checkLoginStatus()
        if (status.isLogin) {
          const info = await napcatManager.getLoginInfo()
          if (info) {
            const tempPort = napcatManager.getOneBotPort()
            const tempWebUiPort = napcatManager.getWebUiPort()
            const account = createManagedAccount(info, tempPort, tempWebUiPort, 'desktop')

            // 清理临时 QR 登录管理器
            qrLoginNapcatManager = null
            napcatManager.stop().catch(() => {})

            // 自动启用新账号
            if (account.enabled) {
              await ensureManagedConnection(account)
            }
          }
        }
        return status
      } catch (err) {
        return { isLogin: false, isOffline: false, loginError: err instanceof Error ? err.message : String(err) }
      }
    }

    // 检查 Docker QR 登录
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
          const account = createManagedAccount(info, tempPort, tempWebUiPort, 'docker')

          // 清理临时 QR 登录管理器
          qrLoginManager = null
          manager.remove().catch(() => {})

          // 自动启用新账号
          if (account.enabled) {
            await ensureManagedConnection(account)
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
    if (qrLoginNapcatManager) {
      qrLoginNapcatManager.stop().catch(() => {})
      qrLoginNapcatManager = null
    }
    return { success: true }
  })

  // 强制停止托管管理器（兜底重置，支持按账号）
  ipcMain.handle('qq-bot:stop-manager', async (_, accountId?: string) => {
    if (accountId) {
      destroyManagedContainer(accountId)
    } else {
      destroyManagedContainer()
    }
    return { success: true }
  })

  // 获取托管管理器状态（支持按账号）
  ipcMain.handle('qq-bot:get-manager-status', async (_, accountId?: string) => {
    if (accountId) {
      const dockerInst = dockerContainers.get(accountId)
      if (dockerInst) return { exists: true, type: 'docker', status: dockerInst.manager.getStatus(), qqNumber: dockerInst.qqNumber }
      const napcatInst = napcatInstances.get(accountId)
      if (napcatInst) return { exists: true, type: 'desktop', status: napcatInst.manager.getStatus(), qqNumber: napcatInst.qqNumber }
      return { exists: false, status: null }
    }
    // 返回所有账号的状态摘要
    const summaries: Array<{ accountId: string; qqNumber: string; type: string; status: string }> = []
    for (const [id, inst] of dockerContainers) {
      summaries.push({ accountId: id, qqNumber: inst.qqNumber, type: 'docker', status: inst.manager.getStatus() })
    }
    for (const [id, inst] of napcatInstances) {
      summaries.push({ accountId: id, qqNumber: inst.qqNumber, type: 'desktop', status: inst.manager.getStatus() })
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

  // 获取群列表
  ipcMain.handle('qq-bot:get-group-list', async (_, accountId: string) => {
    const client = activeClients.get(accountId)
    if (!client) {
      return { success: false, error: '账号未连接' }
    }
    try {
      const groups = await client.getGroupList()
      return { success: true, groups }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '获取群列表失败' }
    }
  })

  // 获取群成员列表
  ipcMain.handle('qq-bot:get-group-member-list', async (_, accountId: string, groupId: string) => {
    const client = activeClients.get(accountId)
    if (!client) {
      return { success: false, error: '账号未连接' }
    }
    try {
      const members = await client.getGroupMemberList(groupId)
      return { success: true, members }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '获取群成员列表失败' }
    }
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
    await ensureManagedConnection(firstAccount)
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