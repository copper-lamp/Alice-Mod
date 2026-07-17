import { create } from 'zustand'

/** QQ 账号状态 */
export type AccountStatus = 'online' | 'reconnecting' | 'offline' | 'error'

/** 过滤类型 */
export type LogFilterType = 'all' | 'group' | 'private' | 'system'

/** 账号统计 */
export interface AccountStats {
  groupsCount: number
  uptime: number
  messagesReceived: number
  messagesSent: number
}

/** 手动连接配置 */
export interface ManualConnectionParams {
  host: string
  port: number
  protocol: 'ws' | 'wss'
  token?: string
}

/** 测试连接结果 */
export interface TestResult {
  success: boolean
  latency?: number
  error?: string
}

/** 桥接配置 */
export interface BridgeConfig {
  groupId: string
  direction: 'both' | 'qq_to_game' | 'game_to_qq'
  prefix?: string
  keywords?: string[]
  userWhitelist?: string[]
}

/** 账号配置 */
export interface QQAccountConfig {
  connectionType: 'qr' | 'manual'
  manual?: ManualConnectionParams
  qr?: { sessionToken: string }
  deploymentMode: 'docker' | 'desktop'
  authorization: {
    defaultPermission: 0 | 1 | 2 | 3
    cooldownSeconds: number
    allowPrivate: boolean
  }
  bridges: BridgeConfig[]
  /** NapCat 数据持久化目录（Docker 容器挂载路径） */
  dataDir?: string
}

/** QQ 账号 */
export interface QQAccount {
  id: string
  qqNumber: string
  nickname: string
  status: AccountStatus
  enabled: boolean
  error?: string
  stats: AccountStats
  config: QQAccountConfig
  createdAt: number
}

/** 日志条目 */
export interface LogEntry {
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

/** 日志筛选 */
export interface LogFilter {
  type: LogFilterType
  search: string
}

/** 二维码数据 */
export interface QRCodeData {
  url: string      // 二维码内容（登录 URL）
  expiresAt: number
}

/** 二维码登录轮询结果 */
export interface QRLoginResult {
  isLogin: boolean
  isOffline: boolean
  qrcodeUrl?: string
  loginError?: string
}

/** 账号状态更新 */
export interface AccountStatusUpdate {
  accountId: string
  status: AccountStatus
  stats?: Partial<AccountStats>
  error?: string
}

/** 状态管理 */
interface QQBotState {
  // 账号列表
  accounts: QQAccount[]
  accountOrder: string[]
  loading: boolean

  // 视图状态
  selectedAccountId: string | null

  // 添加账号面板
  isAddingAccount: boolean
  addMode: 'qr' | 'manual'
  qrCodeData: QRCodeData | null
  qrCodeExpiresAt: number | null
  qrCodeStatus: 'idle' | 'loading' | 'ready' | 'expired' | 'success' | 'error'
  qrCheckTimer: number | null

  // 消息日志（当前选中的账号）
  messageLogs: LogEntry[]
  logFilter: LogFilter

  // 全局操作状态
  isConfiguring: boolean

  // Actions - 账号管理
  loadAccounts: () => Promise<void>
  addAccount: (config: QQAccountConfig) => Promise<boolean>
  removeAccount: (id: string) => Promise<boolean>
  toggleAccount: (id: string, enabled: boolean) => Promise<void>
  reorderAccounts: (order: string[]) => void

  // Actions - 视图
  selectAccount: (id: string) => void
  deselectAccount: () => void

  // Actions - 添加账号面板
  startAddAccount: (mode?: 'qr' | 'manual') => void
  cancelAddAccount: () => void
  setAddMode: (mode: 'qr' | 'manual') => void

  // Actions - 扫码登录
  startQRLogin: () => Promise<void>
  refreshQRCode: () => Promise<void>
  cancelQRLogin: () => void
  checkQRLogin: () => Promise<void>
  startQRCheckTimer: () => void
  stopQRCheckTimer: () => void

  // Actions - 手动配置
  testConnection: (params: ManualConnectionParams) => Promise<TestResult>

  // Actions - 配置
  loadConfig: (accountId: string) => Promise<QQAccountConfig | null>
  saveConfig: (accountId: string, config: QQAccountConfig) => Promise<boolean>

  // Actions - 日志
  loadMessageLogs: (accountId: string) => Promise<void>
  setLogFilter: (filter: Partial<LogFilter>) => void
  clearLogs: (accountId: string) => Promise<void>
  loadMoreLogs: (accountId: string) => Promise<void>

  // Actions - 状态推送
  handleStatusUpdate: (update: AccountStatusUpdate) => void
  handleNewMessage: (entry: LogEntry) => void
}

export const useQQBotStore = create<QQBotState>((set, get) => ({
  // 初始状态
  accounts: [],
  accountOrder: [],
  loading: false,
  selectedAccountId: null,
  isAddingAccount: false,
  addMode: 'qr',
  qrCodeData: null,
  qrCodeExpiresAt: null,
  qrCodeStatus: 'idle',
  qrCheckTimer: null,
  messageLogs: [],
  logFilter: { type: 'all', search: '' },
  isConfiguring: false,

  // ── 账号管理 ──

  loadAccounts: async () => {
    set({ loading: true })
    try {
      const data = await window.electronAPI.invoke('qq-bot:get-accounts') as {
        accounts: QQAccount[]; order: string[]
      }
      set({ accounts: data.accounts, accountOrder: data.order, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  addAccount: async (config) => {
    set({ isConfiguring: true })
    try {
      const { success } = await window.electronAPI.invoke('qq-bot:add-account', config) as { success: boolean }
      if (success) {
        await get().loadAccounts()
        set({ isAddingAccount: false })
      }
      return success
    } catch { return false }
    finally { set({ isConfiguring: false }) }
  },

  removeAccount: async (id) => {
    try {
      const { success } = await window.electronAPI.invoke('qq-bot:remove-account', id) as { success: boolean }
      if (success) {
        set(s => ({
          accounts: s.accounts.filter(a => a.id !== id),
          accountOrder: s.accountOrder.filter(o => o !== id),
          selectedAccountId: s.selectedAccountId === id ? null : s.selectedAccountId,
        }))
      }
      return success
    } catch { return false }
  },

  toggleAccount: async (id, enabled) => {
    try {
      await window.electronAPI.invoke('qq-bot:toggle-account', id, enabled)
      set(s => ({
        accounts: s.accounts.map(a =>
          a.id === id ? { ...a, enabled, status: enabled ? 'reconnecting' : 'offline' } : a
        )
      }))
    } catch { /* ignore */ }
  },

  reorderAccounts: (order) => {
    set({ accountOrder: order })
    window.electronAPI.invoke('qq-bot:reorder-accounts', order).catch(() => {})
  },

  // ── 视图 ──

  selectAccount: (id) => {
    set({ selectedAccountId: id, isAddingAccount: false })
    get().loadMessageLogs(id)
  },

  deselectAccount: () => {
    set({ selectedAccountId: null, messageLogs: [] })
  },

  // ── 添加账号面板 ──

  startAddAccount: (mode = 'qr') => {
    set({ isAddingAccount: true, addMode: mode, selectedAccountId: null, messageLogs: [] })
    if (mode === 'qr') {
      get().startQRLogin()
    }
  },

  cancelAddAccount: () => {
    get().cancelQRLogin()
    set({ isAddingAccount: false, addMode: 'qr', qrCodeData: null, qrCodeExpiresAt: null, qrCodeStatus: 'idle', qrCheckTimer: null })
  },

  setAddMode: (mode) => {
    set({ addMode: mode })
    if (mode === 'qr' && get().qrCodeStatus === 'idle') {
      get().startQRLogin()
    }
    if (mode === 'manual') {
      get().cancelQRLogin()
    }
  },

  // ── 扫码登录 ──

  startQRLogin: async () => {
    set({ qrCodeStatus: 'loading', qrCodeData: null })
    try {
      const data = await window.electronAPI.invoke('qq-bot:start-qr-login') as QRCodeData
      set({ qrCodeData: data, qrCodeExpiresAt: data.expiresAt, qrCodeStatus: 'ready' })
      get().startQRCheckTimer()
    } catch {
      set({ qrCodeStatus: 'error' })
    }
  },

  refreshQRCode: async () => {
    set({ qrCodeStatus: 'loading' })
    try {
      const data = await window.electronAPI.invoke('qq-bot:start-qr-login') as QRCodeData
      set({ qrCodeData: data, qrCodeExpiresAt: data.expiresAt, qrCodeStatus: 'ready' })
      get().startQRCheckTimer()
    } catch {
      set({ qrCodeStatus: 'error' })
    }
  },

  cancelQRLogin: () => {
    window.electronAPI.invoke('qq-bot:cancel-qr-login').catch(() => {})
    get().stopQRCheckTimer()
    set({ qrCodeData: null, qrCodeExpiresAt: null, qrCodeStatus: 'idle' })
  },

  startQRCheckTimer: () => {
    get().stopQRCheckTimer()
    const timer = window.setInterval(() => {
      get().checkQRLogin()
    }, 2000)
    set({ qrCheckTimer: timer })
  },

  stopQRCheckTimer: () => {
    const timer = get().qrCheckTimer
    if (timer !== null) {
      window.clearInterval(timer)
      set({ qrCheckTimer: null })
    }
  },

  checkQRLogin: async () => {
    try {
      const result = await window.electronAPI.invoke('qq-bot:check-qr-login') as QRLoginResult
      if (result.isLogin) {
        get().stopQRCheckTimer()
        set({ qrCodeStatus: 'success' })
        await get().loadAccounts()
        // 登录成功后自动选中该账号
        const account = get().accounts.find(a => a.config.connectionType === 'qr' && a.enabled)
        if (account) {
          window.setTimeout(() => get().selectAccount(account.id), 1000)
        }
      } else if (result.isOffline || result.loginError) {
        get().stopQRCheckTimer()
        set({ qrCodeStatus: 'error' })
      }
    } catch {
      // 轮询异常时保持当前状态，继续下一次
    }
  },

  // ── 手动配置 ──

  testConnection: async (params) => {
    try {
      return await window.electronAPI.invoke('qq-bot:test-connection', params) as TestResult
    } catch { return { success: false, error: '连接失败' } }
  },

  // ── 配置 ──

  loadConfig: async (accountId) => {
    try {
      return await window.electronAPI.invoke('qq-bot:get-config', accountId) as QQAccountConfig | null
    } catch { return null }
  },

  saveConfig: async (accountId, config) => {
    try {
      const { success } = await window.electronAPI.invoke('qq-bot:save-config', accountId, config) as { success: boolean }
      if (success) {
        set(s => ({
          accounts: s.accounts.map(a =>
            a.id === accountId ? { ...a, config } : a
          )
        }))
      }
      return success
    } catch { return false }
  },

  // ── 日志 ──

  loadMessageLogs: async (accountId) => {
    try {
      const logs = await window.electronAPI.invoke('qq-bot:get-message-log', accountId, {
        type: get().logFilter.type,
        search: get().logFilter.search,
      }) as LogEntry[]
      set({ messageLogs: logs })
    } catch { /* ignore */ }
  },

  setLogFilter: (filter) => {
    set(s => ({ logFilter: { ...s.logFilter, ...filter } }))
    const id = get().selectedAccountId
    if (id) get().loadMessageLogs(id)
  },

  clearLogs: async (accountId) => {
    try {
      await window.electronAPI.invoke('qq-bot:clear-logs', accountId)
      set({ messageLogs: [] })
    } catch { /* ignore */ }
  },

  loadMoreLogs: async (accountId) => {
    try {
      const more = await window.electronAPI.invoke('qq-bot:get-message-log', accountId, {
        offset: get().messageLogs.length,
        type: get().logFilter.type,
        search: get().logFilter.search,
      }) as LogEntry[]
      set(s => ({ messageLogs: [...s.messageLogs, ...more] }))
    } catch { /* ignore */ }
  },

  // ── 状态推送 ──

  handleStatusUpdate: (update) => {
    set(s => ({
      accounts: s.accounts.map(a =>
        a.id === update.accountId
          ? { ...a, status: update.status, error: update.error, stats: { ...a.stats, ...update.stats } }
          : a
      )
    }))
  },

  handleNewMessage: (entry) => {
    set(s => {
      if (s.selectedAccountId !== entry.accountId) return s
      return { messageLogs: [entry, ...s.messageLogs].slice(0, 200) }
    })
  },
}))
