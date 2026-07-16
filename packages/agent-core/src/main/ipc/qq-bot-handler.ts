import { ipcMain, dialog, BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import WebSocket from 'ws'
import { NapCatManager } from '../qq-bot/napcat-manager'
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
  managed?: boolean
  /** 自动分配的 OneBot 端口（多账号时每个账号独立端口） */
  assignedPort?: number
  /** 自动分配的 WebUI 端口（多账号时每个账号独立端口） */
  assignedWebUiPort?: number
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

interface ManagedNapCatInstance {
  qqNumber: string
  manager: NapCatManager
  stopTimer: NodeJS.Timeout | null
}

/** 多账号 NapCat 实例 Map，key = accountId (QQAccount.id) */
const napCatInstances = new Map<string, ManagedNapCatInstance>()
export const activeClients = new Map<string, OneBotClient>()

/** 并发锁：防止 ensureManagedConnection 被重复调用 */
const pendingAccountConnections = new Set<string>()

/** 端口分配基础 */
const BASE_ONE_BOT_PORT = 3001
const BASE_WEB_UI_PORT = 6099
const MAX_PORT_OFFSET = 50

/** 临时扫码登录的 NapCat 管理器（不与已托管账号冲突） */
let qrLoginManager: NapCatManager | null = null

/** 扫码登录前正在运行的托管账号列表，扫码完成后恢复 */
let qrLoginPendingRestore: string[] = []

/**
 * 为临时扫码登录分配一个不与已托管账号冲突的端口
 */
function findTempPort(): { oneBot: number; webUi: number } {
  const usedPorts = new Set<number>()
  for (const inst of napCatInstances.values()) {
    usedPorts.add(inst.manager['options']?.oneBotPort ?? 0)
    usedPorts.add(inst.manager['options']?.webUiPort ?? 0)
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
 * 扫码登录完成后，恢复之前暂停的托管账号
 */
async function restoreManagedAccountsAfterQR(accountIds: string[]): Promise<void> {
  const ids = [...accountIds]
  qrLoginPendingRestore = []
  for (const accountId of ids) {
    const data = loadAccounts()
    const account = data.accounts.find(a => a.id === accountId)
    if (account && account.enabled && account.config.managed) {
      console.log(`[QQBot] 扫码登录完成，恢复托管账号 ${account.qqNumber}...`)
      try {
        await ensureManagedConnection(account)
      } catch (err) {
        console.error(`[QQBot] 恢复托管账号 ${account.qqNumber} 失败:`, err)
      }
    }
  }
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
  for (const inst of napCatInstances.values()) {
    usedPorts.add(inst.manager['options']?.oneBotPort ?? 0)
    usedPorts.add(inst.manager['options']?.webUiPort ?? 0)
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

/**
 * 获取账号的 NapCat 独立工作目录
 * 每个托管账号使用独立的 NapCat 目录，避免 Hook DLL 冲突
 */
function getAccountNapCatDir(accountId: string): string {
  return path.join(app.getPath('userData'), 'napcat_accounts', accountId)
}

/**
 * 确保账号的 NapCat 工作目录存在，并创建 per-account launcher.bat
 * 返回 per-account launcher.bat 的路径
 */
function ensureAccountLauncherBatch(accountId: string, qqNumber: string, installDir: string): string {
  const accountDir = getAccountNapCatDir(accountId)
  fs.mkdirSync(accountDir, { recursive: true })
  fs.mkdirSync(path.join(accountDir, 'config'), { recursive: true })
  fs.mkdirSync(path.join(accountDir, 'cache'), { recursive: true })

  // 复制 qqnt.json（NapCat 的插件配置，QQ.exe 启动时读取）
  const srcQQNT = path.join(installDir, 'qqnt.json')
  const dstQQNT = path.join(accountDir, 'qqnt.json')
  if (!fs.existsSync(dstQQNT)) {
    try { fs.copyFileSync(srcQQNT, dstQQNT) } catch { /* ignore */ }
  }

  // 生成 per-account launcher.bat
  // 使用绝对路径指向共享文件（NapCatWinBootMain.exe、Hook DLL、napcat.mjs）
  // 使用 %cd% 相对路径指向 per-account 目录（config、cache）
  const launcherPath = path.join(accountDir, 'launcher.bat')
  const injectDll = path.join(installDir, 'NapCatWinBootHook.dll')
  const bootMain = path.join(installDir, 'NapCatWinBootMain.exe')
  const mainModule = path.join(installDir, 'napcat.mjs').replace(/\\/g, '/')
  const loadNapCatJs = path.join(accountDir, 'loadNapCat.js').replace(/\\/g, '/')

  const launcherContent = `@echo off
chcp 65001 >nul
set NAPCAT_PATCH_PACKAGE=${accountDir}\\qqnt.json
set NAPCAT_LOAD_PATH=${accountDir}\\loadNapCat.js
set NAPCAT_INJECT_PATH=${injectDll}
set NAPCAT_LAUNCHER_PATH=${bootMain}
set NAPCAT_MAIN_PATH=${installDir}\\napcat.mjs

REM 读取 QQ 安装路径
:loop_read
for /f "tokens=2*" %%a in ('reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ" /v "UninstallString"') do (
    set "RetString=%%~b"
    goto :napcat_boot
)
:napcat_boot
for %%a in ("%RetString%") do ( set "pathWithoutUninstall=%%~dpa" )
set "QQPath=%pathWithoutUninstall%QQ.exe"

echo (async () => {await import("file:///${mainModule}")})() > "${loadNapCatJs}"

REM 使用 %* 透传 spawnProcess 传入的 -q <qqNumber> 参数
"%NAPCAT_LAUNCHER_PATH%" "%QQPath%" "%NAPCAT_INJECT_PATH%" %*
`
  fs.writeFileSync(launcherPath, launcherContent, 'utf-8')
  return launcherPath
}

function getOrCreateNapCatManager(
  account: QQAccount,
  onProgress?: (p: { percent: number; stage: string; message: string }) => void,
): NapCatManager {
  const existing = napCatInstances.get(account.id)
  if (existing) return existing.manager

  const settings = loadNapCatSettings()
  const ports = assignPorts(account)

  // 每个账号使用独立的 NapCat 工作目录，避免 Hook DLL 冲突
  const launcherPath = ensureAccountLauncherBatch(account.id, account.qqNumber, settings.installDir)
  const accountDir = getAccountNapCatDir(account.id)

  const manager = new NapCatManager({
    installDir: settings.installDir,
    workingDir: accountDir,
    userDataPath: app.getPath('userData'),
    account: account.qqNumber,
    executablePath: launcherPath,
    oneBotPort: ports.oneBot,
    webUiPort: ports.webUi,
    onLog: (line) => {
      console.log(`[NapCat(${account.qqNumber})] ${line}`)
    },
    onStatusChange: (status) => {
      console.log(`[NapCatManager(${account.qqNumber})] status: ${status}`)
    },
    onProgress,
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

  napCatInstances.set(account.id, { qqNumber: account.qqNumber, manager, stopTimer: null })
  return manager
}

function destroyNapCatManager(accountId?: string): void {
  if (accountId) {
    // 销毁指定账号的管理器
    cancelNapCatStop(accountId)
    const inst = napCatInstances.get(accountId)
    if (inst) {
      inst.manager.stop().catch(() => {})
      napCatInstances.delete(accountId)
    }
  } else {
    // 销毁所有管理器（兼容 start-qr-login 等场景）
    for (const [id] of napCatInstances) {
      destroyNapCatManager(id)
    }
  }
}

/**
 * 延迟 60 秒后停止指定账号的 NapCat 进程
 * 给用户快速重连留窗口期，避免频繁启停
 */
function scheduleNapCatStop(accountId: string): void {
  cancelNapCatStop(accountId)
  const inst = napCatInstances.get(accountId)
  if (!inst) return

  inst.stopTimer = setTimeout(async () => {
    console.log(`[QQBot] 延迟停止 NapCat (${inst.qqNumber}, 60s 无活动)`)
    try { await inst.manager.stop() } catch { /* ignore */ }
    napCatInstances.delete(accountId)
    inst.stopTimer = null
  }, 60000)
}

/** 取消指定账号的延迟停止 NapCat */
function cancelNapCatStop(accountId: string): void {
  const inst = napCatInstances.get(accountId)
  if (inst?.stopTimer) {
    clearTimeout(inst.stopTimer)
    inst.stopTimer = null
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
  // 托管账号使用分配的端口，默认 3001
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

async function ensureManagedConnection(account: QQAccount): Promise<void> {
  if (account.config.connectionType !== 'qr') return

  // 🔒 并发锁：React StrictMode 双渲染可能导致重复调用
  if (pendingAccountConnections.has(account.id)) {
    console.log(`[QQBot] 账号 ${account.qqNumber} 连接已在进行中，跳过重复调用`)
    return
  }
  pendingAccountConnections.add(account.id)

  try {
    const manager = getOrCreateNapCatManager(account)
    // 用户重新开启 → 取消延迟杀进程，保留 NapCat 进程
    cancelNapCatStop(account.id)

    if (manager.getStatus() === 'idle' || manager.getStatus() === 'error') {
      console.log(`[QQBot] ▶ 启动 NapCat (account=${account.qqNumber})...`)
      await manager.start()
    } else {
      console.log(`[QQBot] ▶ NapCat 已在运行 (account=${account.qqNumber}, status=${manager.getStatus()})，跳过启动`)
    }

    // 给 NapCat 一点时间启动 OneBot WebSocket 服务（WebUI 就绪后 WS 还需几秒）
    console.log(`[QQBot] ▶ 等待 OneBot WebSocket 服务就绪 (account=${account.qqNumber})...`)
    await delay(2000)

    try {
      await connectOneBot(account)
      console.log(`[QQBot] ▶ OneBot 连接成功 (account=${account.qqNumber})`)
    } catch (err) {
      // ❌ 不杀 NapCat 进程！
      // OneBotClient 会后台自动重连，杀进程反而让重连永远失败
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
    existing.config.managed = true
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
      managed: true,
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

    // ⚠ 临时限制：单账号检查
    // 要启用一个账号时，检查是否已有其他账号已启用
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
      // 托管账号断开后，延迟 60s 杀 NapCat 进程（给快速重连留窗口）
      if (account.config.managed) {
        scheduleNapCatStop(id)
      }
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
    // 安装向导：创建临时管理器测试安装是否正确
    const tempManager = new NapCatManager({
      installDir,
      userDataPath: app.getPath('userData'),
      onLog: (line) => console.log(`[NapCat(Install)] ${line}`),
      onStatusChange: (status) => console.log(`[NapCatManager(Install)] status: ${status}`),
      onProgress: (progress) => {
        try {
          event.sender.send('qq-bot:install-progress', progress)
        } catch { /* ignore */ }
      },
    })
    try {
      await tempManager.start()
      await tempManager.stop()
      return { success: true, installDir: tempManager.getInstallDir() }
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

    // 如果已有 QR 登录实例在运行，先清理
    if (qrLoginManager) {
      qrLoginManager.stop().catch(() => {})
      qrLoginManager = null
    }
    qrLoginPendingRestore = []

    // 创建临时 NapCat 实例用于扫码（无 -q 参数）
    // 每个账号使用独立 NapCat 目录，不与其他已托管账号冲突
    const settings = loadNapCatSettings()
    const tempPort = findTempPort()
    const tempManager = new NapCatManager({
      installDir: settings.installDir,
      userDataPath: app.getPath('userData'),
      executablePath: settings.executablePath,
      oneBotPort: tempPort.oneBot,
      webUiPort: tempPort.webUi,
      onLog: (line) => console.log(`[NapCat(QR)] ${line}`),
      onStatusChange: (status) => console.log(`[NapCatManager(QR)] status: ${status}`),
    })

    // 存到临时变量，供 check-qr-login 使用
    qrLoginManager = tempManager

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
          const tempPort = manager['options']?.oneBotPort
          const tempWebUiPort = manager['options']?.webUiPort
          const account = createManagedAccount(info, tempPort, tempWebUiPort)

          // 清理临时 QR 登录管理器
          qrLoginManager = null
          manager.stop().catch(() => {})

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
      qrLoginManager.stop().catch(() => {})
      qrLoginManager = null
    }
    qrLoginPendingRestore = []
    return { success: true }
  })

  // 强制停止 NapCat 管理器（兜底重置，支持按账号）
  ipcMain.handle('qq-bot:stop-manager', async (_, accountId?: string) => {
    if (accountId) {
      destroyNapCatManager(accountId)
    } else {
      destroyNapCatManager()
    }
    return { success: true }
  })

  // 获取 NapCat 管理器状态（支持按账号）
  ipcMain.handle('qq-bot:get-manager-status', async (_, accountId?: string) => {
    if (accountId) {
      const inst = napCatInstances.get(accountId)
      if (!inst) return { exists: false, status: null }
      return { exists: true, status: inst.manager.getStatus(), qqNumber: inst.qqNumber }
    }
    // 返回所有账号的状态摘要
    const summaries: Array<{ accountId: string; qqNumber: string; status: string }> = []
    for (const [id, inst] of napCatInstances) {
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
 * 获取当前已启用且正在运行的账号数
 * 用于单账号限制检查
 */
function getEnabledRunningAccountCount(): number {
  const data = loadAccounts()
  return data.accounts.filter(a => a.enabled && a.config.connectionType === 'qr').length
}

/**
 * 自动启动第一个已启用的托管 QQ 账号
 * 临时限制：只启动第一个账号，避免多账号并发启动导致的 NapCat 冲突问题
 * 在应用初始化阶段调用，用户无需手动点击开关
 */
export async function autoStartQQBotAccounts(): Promise<void> {
  console.log('[QQBot] 检查已启用的 QQ 账号...')
  const data = loadAccounts()
  const enabledAccounts = data.accounts.filter(a => a.enabled && a.config.connectionType === 'qr')
  if (enabledAccounts.length === 0) {
    console.log('[QQBot] 没有已启用的托管账号，跳过自动启动')
    return
  }

  // ⚠ 临时限制：只启动第一个已启用的账号
  // 多账号策略暂缓，避免 NapCat 进程冲突（launcher.bat 解析问题未解决）
  const firstAccount = enabledAccounts[0]
  if (enabledAccounts.length > 1) {
    console.log(`[QQBot] ⚠ 临时限制：发现 ${enabledAccounts.length} 个已启用账号，只启动第一个 (${firstAccount.qqNumber})`)
    // 将其他账号标记为 offline，保留一个在启用状态
    for (const account of enabledAccounts.slice(1)) {
      account.enabled = false
      account.status = 'offline'
      account.error = '临时限制：当前仅支持单账号运行，请先禁用其他账号'
    }
    saveAccounts(data.accounts, data.order)
    // 推送状态更新到前端
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
