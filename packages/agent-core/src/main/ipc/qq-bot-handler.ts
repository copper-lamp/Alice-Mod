import { ipcMain, dialog } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import WebSocket from 'ws'
import { NapCatManager } from '../qq-bot/napcat-manager'
import { OneBotClient } from '../qq-bot/onebot-client'
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
  managed?: boolean
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

// ── NapCat / OneBot 运行时管理 ──

let napCatManager: NapCatManager | null = null
const activeClients = new Map<string, OneBotClient>()

function getDefaultInstallDir(): string {
  // 默认使用软件所在目录（开发时为项目根目录，打包后为 exe 所在目录）
  try {
    const appPath = app.getAppPath()
    return path.join(path.dirname(appPath), 'napcat')
  } catch {
    return path.join(app.getPath('userData'), 'napcat')
  }
}

function loadNapCatSettings(): { installDir: string; executablePath?: string } {
  try {
    const file = path.join(CONFIG_DIR, 'napcat.json')
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'))
      return {
        installDir: parsed.installDir || getDefaultInstallDir(),
        executablePath: parsed.executablePath || undefined,
      }
    }
  } catch { /* ignore */ }
  return { installDir: getDefaultInstallDir() }
}

function saveNapCatSettings(settings: { installDir?: string; executablePath?: string }): void {
  ensureDirs()
  const file = path.join(CONFIG_DIR, 'napcat.json')
  const existing = (() => {
    try {
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'))
    } catch { /* ignore */ }
    return {}
  })()
  fs.writeFileSync(file, JSON.stringify({ ...existing, ...settings }, null, 2), 'utf-8')
}

function getOrCreateNapCatManager(account?: string, onProgress?: (p: { percent: number; stage: string; message: string }) => void): NapCatManager {
  const settings = loadNapCatSettings()
  if (!napCatManager) {
    napCatManager = new NapCatManager({
      installDir: settings.installDir,
      userDataPath: app.getPath('userData'),
      account,
      executablePath: settings.executablePath,
      onLog: (line) => {
        console.log(line)
      },
      onStatusChange: (status) => {
        console.log('[NapCatManager] status:', status)
      },
      onProgress,
    })
  }
  return napCatManager
}

function destroyNapCatManager(): void {
  if (napCatManager) {
    napCatManager.stop().catch(() => {})
    napCatManager = null
  }
}

function isNapCatInstalled(): boolean {
  const settings = loadNapCatSettings()
  if (!settings.installDir) return false
  if (!fs.existsSync(settings.installDir)) return false
  const candidates = process.platform === 'win32'
    ? ['napcat.exe', 'NapCatWinBootMain.exe', 'launcher.bat', 'launcher-win10.bat']
    : ['napcat', 'napcat.sh']
  return candidates.some(name => fs.existsSync(path.join(settings.installDir, name)))
}

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

function buildWsUrlFromConfig(config: QQAccountConfig): string | null {
  if (config.connectionType === 'manual' && config.manual) {
    return `${config.manual.protocol}://${config.manual.host}:${config.manual.port}`
  }
  return 'ws://127.0.0.1:3001'
}

function buildAccessToken(config: QQAccountConfig): string | undefined {
  if (config.connectionType === 'manual' && config.manual) {
    return config.manual.token
  }
  return undefined
}

async function connectOneBot(account: QQAccount): Promise<void> {
  if (activeClients.has(account.id)) return

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
  })

  activeClients.set(account.id, client)
  await client.connect()
}

async function disconnectOneBot(accountId: string): Promise<void> {
  const client = activeClients.get(accountId)
  if (client) {
    await client.disconnect()
    activeClients.delete(accountId)
  }
}

async function ensureManagedConnection(account: QQAccount): Promise<void> {
  if (account.config.connectionType !== 'qr') return
  const manager = getOrCreateNapCatManager(account.qqNumber)
  if (manager.getStatus() === 'idle' || manager.getStatus() === 'error') {
    await manager.start()
  }
  await connectOneBot(account)
}

function createManagedAccount(info: { uin: string; nickname: string }): QQAccount {
  const data = loadAccounts()
  const existing = data.accounts.find(a => a.qqNumber === info.uin)
  if (existing) {
    existing.nickname = info.nickname || existing.nickname
    existing.config.connectionType = 'qr'
    existing.config.managed = true
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
      managed: true,
    },
    createdAt: Date.now(),
  }
  data.accounts.push(account)
  data.order.push(account.id)
  saveAccounts(data.accounts, data.order)
  return account
}

// ── 注册 Handler ──

export function registerQQBotHandlers(): void {
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

    account.enabled = enabled
    account.status = enabled ? 'reconnecting' : 'offline'
    account.error = undefined
    saveAccounts(data.accounts, data.order)

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
      }
    } else {
      await disconnectOneBot(id)
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

  // 安装状态
  ipcMain.handle('qq-bot:get-install-status', async () => {
    const settings = loadNapCatSettings()
    return {
      installed: isNapCatInstalled(),
      installDir: settings.installDir,
      executablePath: settings.executablePath,
      defaultInstallDir: getDefaultInstallDir(),
    }
  })

  // 选择安装目录
  ipcMain.handle('qq-bot:choose-install-dir', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      defaultPath: path.dirname(getDefaultInstallDir()),
      title: '选择 NapCat 安装目录',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // 安装 NapCat：指定目录并触发自动下载
  ipcMain.handle('qq-bot:install-napcat', async (event, installDir: string) => {
    saveNapCatSettings({ installDir })
    destroyNapCatManager()
    const manager = getOrCreateNapCatManager(undefined, (progress) => {
      try {
        event.sender.send('qq-bot:install-progress', progress)
      } catch { /* ignore */ }
    })
    try {
      await manager.start()
      await manager.stop()
      return { success: true, installDir: manager.getInstallDir() }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 设置 NapCat 目录（手动模式）
  ipcMain.handle('qq-bot:set-napcat-dir', async (_, installDir: string, executablePath?: string) => {
    saveNapCatSettings({ installDir, executablePath })
    destroyNapCatManager()
    if (!isNapCatInstalled()) {
      return { success: false, error: '指定目录中未找到 NapCat 可执行文件' }
    }
    return { success: true }
  })

  // 扫码登录 - 开始
  ipcMain.handle('qq-bot:start-qr-login', async () => {
    if (!isNapCatInstalled()) {
      throw new Error('NapCat 未安装，请先完成安装向导')
    }
    const manager = getOrCreateNapCatManager()
    await manager.start()
    const qr = await manager.getQRCode()
    return { url: qr.url, expiresAt: qr.expiresAt }
  })

  // 扫码登录 - 检查状态
  ipcMain.handle('qq-bot:check-qr-login', async () => {
    const manager = napCatManager
    if (!manager) return { isLogin: false, isOffline: false }

    try {
      const status = await manager.checkLoginStatus()
      if (status.isLogin) {
        const info = await manager.getLoginInfo()
        if (info) {
          const account = createManagedAccount(info)
          if (account.enabled) {
            await connectOneBot(account)
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
    destroyNapCatManager()
    return { success: true }
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
