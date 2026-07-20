import React, { useEffect, useState, useCallback } from 'react'
import { useAgentStore } from '../../stores/agentStore'
import { llmApi, dashboardApi, aimApi } from '../../lib/ipc'
import type { ContextTokenInfo, UsageStats, DailyUsage } from '../../lib/types'

/** 每日用量图表高度 */
const CHART_MAX_HEIGHT = 40

const RightSidebar: React.FC = () => {
  const { currentAgent, currentAgentId } = useAgentStore()

  const workspaceId = currentAgent?.workspaceId ?? ''

  // ── 上下文窗口 ──
  const [context, setContext] = useState<ContextTokenInfo | null>(null)
  // ── 用量统计 ──
  const [usage, setUsage] = useState<UsageStats | null>(null)
  // ── 每日用量历史（7天） ──
  const [dailyUsage, setDailyUsage] = useState<DailyUsage[]>([])
  // ── 待办事项 ──
  const [todos, setTodos] = useState<Array<{ id: string; title: string; done: boolean }>>([])
  // ── 加载状态 ──
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [contextResult, usageResult, historyResult, todosResult] = await Promise.allSettled([
        workspaceId ? llmApi.contextTokens(workspaceId) : Promise.resolve(null),
        llmApi.usage('today'),
        dashboardApi.usageHistory(7),
        aimApi.list(),
      ])

      if (contextResult.status === 'fulfilled' && contextResult.value) {
        setContext(contextResult.value)
      }
      if (usageResult.status === 'fulfilled') {
        setUsage(usageResult.value)
      }
      if (historyResult.status === 'fulfilled') {
        setDailyUsage(historyResult.value)
      }
      if (todosResult.status === 'fulfilled') {
        const tasks = (todosResult.value.tasks ?? []) as Array<{ id: string; title: string; items?: Array<{ id: string; label: string; done: boolean }> }>
        // 扁平化：将每个任务的 items 展开为独立待办项
        const flatTodos: Array<{ id: string; title: string; done: boolean }> = []
        for (const task of tasks) {
          if (task.items && task.items.length > 0) {
            for (const item of task.items) {
              flatTodos.push({ id: item.id, title: item.label, done: item.done })
            }
          } else {
            flatTodos.push({ id: task.id, title: task.title, done: false })
          }
        }
        setTodos(flatTodos.slice(0, 10)) // 最多显示 10 条
      }
    } catch {
      // 静默处理
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 60000) // 每 60 秒刷新
    return () => clearInterval(interval)
  }, [loadData])

  const percentage = context ? Math.round(context.percentage) : 0
  const usedTokens = context?.used.toLocaleString() ?? '--'
  const maxTokens = context?.max.toLocaleString() ?? '--'

  // 计算今日/本月用量
  const todayTokens = usage?.todayTokens?.toLocaleString() ?? '--'
  const monthTokens = usage?.monthTokens?.toLocaleString() ?? '--'

  // 找出每日用量最大值，用于计算柱状图高度
  const maxDaily = Math.max(...dailyUsage.map(d => d.tokens), 1)

  return (
    <aside className="flex flex-col h-full overflow-hidden bg-gray-100">
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-xs text-gray-400 text-center">加载中...</div>
        ) : (
          <>
            {/* 上下文窗口 */}
            <div className="p-4">
              <h3 className="text-xs text-gray-400 font-medium mb-2">上下文窗口</h3>
              {context ? (
                <>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          percentage > 90 ? 'bg-red-500' : percentage > 70 ? 'bg-amber-500' : 'bg-blue-500'
                        }`}
                        style={{ width: `${Math.min(percentage, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 font-mono">{percentage}%</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-400">{usedTokens} / {maxTokens} tokens</div>
                  {context.breakdown && (
                    <div className="mt-1.5 space-y-0.5">
                      <div className="flex justify-between text-[10px] text-gray-400">
                        <span>系统</span>
                        <span className="font-mono">{context.breakdown.system.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-[10px] text-gray-400">
                        <span>历史</span>
                        <span className="font-mono">{context.breakdown.history.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-[10px] text-gray-400">
                        <span>工具</span>
                        <span className="font-mono">{context.breakdown.tools.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-[10px] text-gray-400">
                        <span>状态</span>
                        <span className="font-mono">{context.breakdown.state.toLocaleString()}</span>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-xs text-gray-400">暂无上下文数据</div>
              )}
            </div>

            {/* 用量监控 */}
            <div className="px-4 pb-4">
              <h3 className="text-xs text-gray-400 font-medium mb-2">用量监控</h3>
              <div className="mb-2">
                <div className="flex justify-between text-xs text-gray-500 mb-0.5">
                  <span>今日用量</span>
                  <span className="font-mono">{todayTokens}</span>
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>本月用量</span>
                  <span className="font-mono">{monthTokens}</span>
                </div>
              </div>
              {dailyUsage.length > 0 && <UsageChart data={dailyUsage} maxValue={maxDaily} />}
            </div>

            {/* 待办事项 */}
            <div className="px-4 pb-4">
              <h3 className="text-xs text-gray-400 font-medium mb-2">待办事项</h3>
              {todos.length > 0 ? (
                <div className="space-y-1.5">
                  {todos.map(todo => (
                    <TodoItem key={todo.id} label={todo.title} completed={todo.done} />
                  ))}
                </div>
              ) : (
                <div className="text-xs text-gray-400">暂无待办事项</div>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}

/** 每周用量柱状图 */
const UsageChart: React.FC<{ data: DailyUsage[]; maxValue: number }> = ({ data, maxValue }) => {
  const dayLabels: Record<string, string> = {
    'Monday': '一', 'Tuesday': '二', 'Wednesday': '三', 'Thursday': '四',
    'Friday': '五', 'Saturday': '六', 'Sunday': '日',
  }

  const getDayLabel = (dateStr: string) => {
    try {
      const d = new Date(dateStr)
      const dayName = d.toLocaleDateString('en-US', { weekday: 'long' })
      return dayLabels[dayName] ?? dateStr.slice(5)
    } catch {
      return dateStr.slice(5)
    }
  }

  return (
    <div className="flex items-end gap-1.5 h-10">
      {data.slice(-7).map((day, i) => {
        const height = maxValue > 0 ? (day.tokens / maxValue) * CHART_MAX_HEIGHT : 0
        return (
          <div key={day.date ?? i} className="flex-1 flex flex-col items-center gap-0.5 group relative">
            <div
              className="w-full bg-blue-500/20 rounded-t transition-all duration-300 hover:bg-blue-500/40"
              style={{ height: `${Math.max(height, 2)}px` }}
              title={`${day.date}: ${day.tokens.toLocaleString()} tokens`}
            />
            <span className="text-[10px] text-gray-400">{getDayLabel(day.date)}</span>
          </div>
        )
      })}
    </div>
  )
}

/** 待办项 */
const TodoItem: React.FC<{ label: string; completed: boolean }> = ({ label, completed }) => (
  <div className="flex items-center gap-2 text-xs">
    <span className={`w-3 h-3 rounded border flex items-center justify-center shrink-0 ${completed ? 'bg-green-400 border-green-400' : 'border-gray-300'}`}>
      {completed && (
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </span>
    <span className={completed ? 'text-gray-400 line-through truncate' : 'text-gray-500 truncate'}>{label}</span>
  </div>
)

export default RightSidebar