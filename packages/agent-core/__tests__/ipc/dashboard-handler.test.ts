/**
 * 仪表盘 IPC Handler 测试
 *
 * 覆盖场景：
 * - dashboard:stats 聚合 Token / Provider / Model / 工作区数据
 * - dashboard:usage-history 按天聚合最近 N 天用量
 * - dashboard:agent-activity 根据工作区状态生成活跃度
 * - 无数据时返回空状态
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ipcMain } from 'electron'
import { DefaultLLMObserver, setLLMObserver, resetLLMObserver } from '../../src/main/llm'
import { WorkspaceManager, getWorkspaceManager, resetWorkspaceManager, setWorkspaceManager } from '../../src/main/workspace'
import { registerDashboardHandlers } from '../../src/main/ipc/dashboard-handler'
import type { LLMCallRecord } from '../../src/main/llm/types'

// 模拟 electron ipcMain.handle
const handlers = new Map<string, (...args: any[]) => Promise<unknown>>()
vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: any) => {
  handlers.set(channel, handler)
})

/** 触发 IPC handler（第一个参数为模拟 event） */
async function invoke(channel: string, ...args: any[]) {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`未注册的 IPC handler: ${channel}`)
  return handler({}, ...args)
}

/** 构造一条 LLM 调用记录 */
function makeRecord(overrides: Partial<LLMCallRecord> = {}): LLMCallRecord {
  return {
    requestId: 'req_1',
    providerId: 'openai',
    model: 'gpt-4o',
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30,
    durationMs: 100,
    success: true,
    finishReason: 'stop',
    timestamp: Date.now(),
    ...overrides,
  }
}

describe('dashboard-handler', () => {
  beforeEach(() => {
    handlers.clear()
    resetLLMObserver()
    resetWorkspaceManager()

    // 使用无持久化的 WorkspaceManager，避免测试依赖 SQLite 二进制
    setWorkspaceManager(new WorkspaceManager(false))

    registerDashboardHandlers()
  })

  afterEach(() => {
    resetLLMObserver()
    resetWorkspaceManager()
    handlers.clear()
  })

  // ───────────────────────────────────────────────
  // dashboard:stats
  // ───────────────────────────────────────────────

  it('stats 应聚合今日/本月/总计 Token 消耗', async () => {
    const observer = new DefaultLLMObserver()
    setLLMObserver(observer)

    const now = Date.now()
    observer.record(makeRecord({ providerId: 'openai', model: 'gpt-4o', totalTokens: 30, timestamp: now }))
    observer.record(makeRecord({ providerId: 'openai', model: 'gpt-4o-mini', totalTokens: 50, timestamp: now }))

    const stats = await invoke('dashboard:stats') as any

    expect(stats.todayTokens).toBe(80)
    expect(stats.monthTokens).toBe(80)
    expect(stats.totalTokens).toBe(80)
  })

  it('stats 应正确计算 Provider 分布与模型排行', async () => {
    const observer = new DefaultLLMObserver()
    setLLMObserver(observer)

    const now = Date.now()
    observer.record(makeRecord({ providerId: 'openai', model: 'gpt-4o', totalTokens: 100, timestamp: now }))
    observer.record(makeRecord({ providerId: 'claude', model: 'claude-3', totalTokens: 50, timestamp: now }))
    observer.record(makeRecord({ providerId: 'openai', model: 'gpt-4o-mini', totalTokens: 30, timestamp: now }))

    const stats = await invoke('dashboard:stats') as any

    expect(stats.providerDistribution).toHaveLength(2)
    expect(stats.providerDistribution[0].providerId).toBe('openai')
    expect(stats.providerDistribution[0].tokenCount).toBe(130)
    expect(stats.providerDistribution[1].tokenCount).toBe(50)
    expect(stats.providerDistribution[0].percentage).toBeCloseTo(72.2, 1)

    expect(stats.topModels).toHaveLength(3)
    expect(stats.topModels[0].modelId).toBe('gpt-4o')
    expect(stats.topModels[0].tokenCount).toBe(100)
  })

  it('stats 应返回工作区在线/总数', async () => {
    const observer = new DefaultLLMObserver()
    setLLMObserver(observer)
    const wm = getWorkspaceManager()

    wm.createWorkspace({ instanceId: 'agent-1' })
    wm.createWorkspace({ instanceId: 'agent-2' })
    wm.setOnline('agent-1', 'conn-1')

    const stats = await invoke('dashboard:stats') as any

    expect(stats.totalAgents).toBe(2)
    expect(stats.onlineAgents).toBe(1)
    expect(stats.activeConnections).toBe(1)
  })

  it('stats 在无数据时应返回零值与空数组', async () => {
    const observer = new DefaultLLMObserver()
    setLLMObserver(observer)

    const stats = await invoke('dashboard:stats') as any

    expect(stats.todayTokens).toBe(0)
    expect(stats.monthTokens).toBe(0)
    expect(stats.totalTokens).toBe(0)
    expect(stats.providerDistribution).toEqual([])
    expect(stats.topModels).toEqual([])
    expect(stats.totalAgents).toBe(0)
  })

  // ───────────────────────────────────────────────
  // dashboard:usage-history
  // ───────────────────────────────────────────────

  it('usage-history 应按天聚合最近 7 天用量', async () => {
    const observer = new DefaultLLMObserver()
    setLLMObserver(observer)

    const now = new Date()
    const todayTs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0).getTime()
    const yesterdayTs = todayTs - 86400_000

    observer.record(makeRecord({ totalTokens: 100, timestamp: todayTs }))
    observer.record(makeRecord({ totalTokens: 50, timestamp: yesterdayTs }))

    const history = await invoke('dashboard:usage-history', { days: 7 }) as any[]

    expect(history).toHaveLength(7)
    const todayEntry = history[history.length - 1]
    const yesterdayEntry = history[history.length - 2]

    expect(todayEntry.tokens).toBe(100)
    expect(todayEntry.callCount).toBe(1)
    expect(yesterdayEntry.tokens).toBe(50)
    expect(yesterdayEntry.callCount).toBe(1)
  })

  it('usage-history 在无记录时应返回 7 条零值', async () => {
    const observer = new DefaultLLMObserver()
    setLLMObserver(observer)

    const history = await invoke('dashboard:usage-history', { days: 7 }) as any[]

    expect(history).toHaveLength(7)
    expect(history.every(h => h.tokens === 0 && h.callCount === 0)).toBe(true)
  })

  // ───────────────────────────────────────────────
  // dashboard:agent-activity
  // ───────────────────────────────────────────────

  it('agent-activity 应为每个工作区返回 24h/7天 活跃度数组', async () => {
    const wm = getWorkspaceManager()
    wm.createWorkspace({ instanceId: 'agent-1', name: 'Alpha' })
    wm.createWorkspace({ instanceId: 'agent-2', name: 'Beta' })

    const activity = await invoke('dashboard:agent-activity') as any[]

    expect(activity).toHaveLength(2)
    expect(activity[0].workspaceName).toBe('Alpha')
    expect(activity[0].hourlyActivity).toHaveLength(24)
    expect(activity[0].dailyActivity).toHaveLength(7)
    expect(activity.every(a => a.hourlyActivity.length === 24)).toBe(true)
    expect(activity.every(a => a.dailyActivity.length === 7)).toBe(true)
  })

  it('agent-activity 在无工作区时应返回空数组', async () => {
    const activity = await invoke('dashboard:agent-activity') as any[]
    expect(activity).toEqual([])
  })
})
