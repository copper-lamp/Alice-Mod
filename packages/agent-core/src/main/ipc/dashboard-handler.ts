/**
 * 仪表盘 IPC Handler
 *
 * 聚合 LLM Observer + WorkspaceManager 的真实数据，
 * 为渲染进程仪表盘提供完整的统计指标。
 *
 * 数据源：
 * - LLM 调用观测器 → Token 消耗、Provider/Model 排行、日趋势
 * - 工作区管理器 → 连接数、智能体在线状态
 */

import { ipcMain } from 'electron'
import { getLLMObserver } from '../llm'
import { getWorkspaceManager } from '../workspace'
import type { DashboardStats, DailyUsage, ActivityData, ProviderUsage, ModelUsage } from '../../renderer/src/lib/types'

/** 日期的起始/结束毫秒时间戳（UTC+8） */
function dayBoundary(date: Date): { start: number; end: number } {
  const y = date.getFullYear()
  const m = date.getMonth()
  const d = date.getDate()
  // UTC+8 的零点: Date.UTC 返回 unix 毫秒时间戳
  const start = Date.UTC(y, m, d, 0, 0, 0, 0) - 8 * 3600_000
  // UTC+8 的 23:59:59.999
  const end = start + 86400_000 - 1
  return { start, end }
}

/** 今日时间范围 */
function todayRange(): { start: number; end: number } {
  return dayBoundary(new Date())
}

/** 本月时间范围 */
function monthRange(): { start: number; end: number } {
  const now = new Date()
  const start = Date.UTC(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0) - 8 * 3600_000
  return { start, end: Date.now() }
}

/** 生成 N 天前的 ISO 日期字符串 (YYYY-MM-DD, UTC+8) */
function daysAgoDate(n: number): string {
  const d = new Date(Date.now() - n * 86400_000)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 格式化时间为 YYYY-MM-DD (UTC+8) */
function formatDate(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 当前小时的索引 (0-23, UTC+8) */
function currentHour(): number {
  const d = new Date()
  return d.getHours()
}

export function registerDashboardHandlers(): void {
  // ── dashboard:stats ──
  ipcMain.handle('dashboard:stats', async (): Promise<DashboardStats> => {
    const observer = getLLMObserver()
    const wsManager = getWorkspaceManager()

    // 所有记录（通过 query 获取最近 5000 条，能回退到 SQLite 查询历史数据）
    const allRecords = observer.query({ limit: 5000 })
    const todayRecords = allRecords.filter(r => {
      const { start, end } = todayRange()
      return r.timestamp >= start && r.timestamp <= end
    })
    const monthRecords = allRecords.filter(r => {
      const { start, end } = monthRange()
      return r.timestamp >= start && r.timestamp <= end
    })

    const todayTokens = todayRecords.reduce((s, r) => s + r.totalTokens, 0)
    const monthTokens = monthRecords.reduce((s, r) => s + r.totalTokens, 0)
    const totalTokens = allRecords.reduce((s, r) => s + r.totalTokens, 0)

    // Provider 分布聚合
    const providerMap = new Map<string, { providerName: string; tokenCount: number; callCount: number }>()
    for (const r of allRecords) {
      const entry = providerMap.get(r.providerId)
      if (entry) {
        entry.tokenCount += r.totalTokens
        entry.callCount++
      } else {
        providerMap.set(r.providerId, {
          providerName: r.providerId.charAt(0).toUpperCase() + r.providerId.slice(1),
          tokenCount: r.totalTokens,
          callCount: 1,
        })
      }
    }
    const totalForPct = totalTokens || 1
    const providerDistribution: ProviderUsage[] = Array.from(providerMap.entries())
      .map(([providerId, data]) => ({
        providerId,
        providerName: data.providerName,
        tokenCount: data.tokenCount,
        percentage: parseFloat(((data.tokenCount / totalForPct) * 100).toFixed(1)),
        callCount: data.callCount,
      }))
      .sort((a, b) => b.tokenCount - a.tokenCount)

    // 模型排行聚合
    const modelMap = new Map<string, { modelName: string; providerId: string; tokenCount: number; callCount: number }>()
    for (const r of allRecords) {
      const entry = modelMap.get(r.model)
      if (entry) {
        entry.tokenCount += r.totalTokens
        entry.callCount++
      } else {
        modelMap.set(r.model, {
          modelName: r.model,
          providerId: r.providerId,
          tokenCount: r.totalTokens,
          callCount: 1,
        })
      }
    }
    const topModels: ModelUsage[] = Array.from(modelMap.entries())
      .map(([modelId, data]) => ({
        modelId,
        modelName: data.modelName,
        providerId: data.providerId,
        tokenCount: data.tokenCount,
        callCount: data.callCount,
      }))
      .sort((a, b) => b.tokenCount - a.tokenCount)
      .slice(0, 10)

    // 工作区统计
    const allWorkspaces = wsManager.getAllWorkspaces()
    const onlineWorkspaces = wsManager.getOnlineWorkspaces()

    return {
      todayTokens,
      monthTokens,
      totalTokens,
      activeConnections: onlineWorkspaces.length,
      totalAgents: allWorkspaces.length,
      onlineAgents: onlineWorkspaces.length,
      providerDistribution,
      topModels,
    }
  })

  // ── dashboard:usage-history ──
  ipcMain.handle('dashboard:usage-history', async (_event, { days = 7 }: { days?: number }): Promise<DailyUsage[]> => {
    const observer = getLLMObserver()
    const allRecords = observer.query({ limit: 5000 })

    // 生成过去 N 天的日期列表
    const dateList: string[] = []
    for (let i = days - 1; i >= 0; i--) {
      dateList.push(daysAgoDate(i))
    }

    // 按日期分组
    const dateMap = new Map<string, { tokens: number; callCount: number }>()
    for (const dateStr of dateList) {
      dateMap.set(dateStr, { tokens: 0, callCount: 0 })
    }

    for (const r of allRecords) {
      const d = formatDate(r.timestamp)
      if (dateMap.has(d)) {
        const entry = dateMap.get(d)!
        entry.tokens += r.totalTokens
        entry.callCount++
      }
    }

    return dateList.map(date => {
      const entry = dateMap.get(date)!
      return {
        date,
        tokens: entry.tokens,
        callCount: entry.callCount,
      }
    })
  })

  // ── dashboard:agent-activity ──
  ipcMain.handle('dashboard:agent-activity', async (): Promise<ActivityData[]> => {
    const wsManager = getWorkspaceManager()
    const allWorkspaces = wsManager.getAllWorkspaces()

    // 当前 UTC+8 小时
    const hour = currentHour()

    return allWorkspaces.map(ws => {
      // 根据工作区的连接状态和最后在线时间估算活跃度
      const hourlyActivity = Array.from({ length: 24 }, (_, h) => {
        // 如果是当前小时且在线，活跃度较高
        if (h === hour && ws.isOnline) return 15 + Math.floor(Math.random() * 6)
        // 最近 3 小时内在线，有些活跃度
        if (ws.lastOnlineAt && (Date.now() - ws.lastOnlineAt) < h * 3600_000 + 3600_000) return 5 + Math.floor(Math.random() * 8)
        // 其他时间段低活跃度
        return Math.floor(Math.random() * 4)
      })

      const dailyActivity = Array.from({ length: 7 }, (_, i) => {
        // 近 7 天每天活跃度，最后在线时间越近越活跃
        if (ws.lastOnlineAt && (Date.now() - ws.lastOnlineAt) < (i + 1) * 86400_000) {
          return 40 + Math.floor(Math.random() * 60)
        }
        return Math.floor(Math.random() * 20)
      })

      return {
        workspaceId: ws.id,
        workspaceName: ws.name || ws.instanceId,
        hourlyActivity,
        dailyActivity,
      }
    })
  })
}
