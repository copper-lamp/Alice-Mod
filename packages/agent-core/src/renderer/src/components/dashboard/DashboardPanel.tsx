import React, { useEffect } from 'react'
import { useDashboardStore } from '../../stores/dashboardStore'
import type { DashboardStats, DailyUsage, ActivityData, ProviderUsage, ModelUsage } from '../../lib/types'

const COLORS = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6', '#F97316']
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const CHART_HEIGHT = 200
const PIE_SIZE = 160
const PIE_RADIUS = 68
const PIE_CIRCUMFERENCE = 2 * Math.PI * PIE_RADIUS

const formatNumber = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

const formatDate = (dateStr: string): string => {
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

const getActivityLevel = (value: number, max: number): string => {
  if (max === 0) return 'bg-gray-100'
  const ratio = value / max
  if (ratio <= 0.25) return 'bg-blue-100'
  if (ratio <= 0.5) return 'bg-blue-300'
  if (ratio <= 0.75) return 'bg-blue-500'
  return 'bg-blue-700'
}

const DashboardPanel: React.FC = () => {
  const { stats, dailyUsage, activityData, loading, fetchStats, fetchUsageHistory, fetchActivity } = useDashboardStore()

  useEffect(() => {
    fetchStats()
    fetchUsageHistory(7)
    fetchActivity()
  }, [fetchStats, fetchUsageHistory, fetchActivity])

  const inner = (
    <>
      {/* Token 用量总览 */}
      <section>
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Token 用量总览</h3>
        <div className="grid grid-cols-3 gap-6">
          <div className="bg-blue-50 rounded-xl p-5">
            <span className="text-sm text-blue-600 font-medium">今日 Token</span>
            <p className="text-2xl font-bold text-blue-700 font-mono mt-1">{formatNumber(stats.todayTokens)}</p>
            <div className="w-full h-1.5 bg-blue-200 rounded-full mt-3 overflow-hidden">
              <div className="h-full bg-blue-600 rounded-full" style={{ width: `${Math.min((stats.todayTokens / (stats.monthTokens || 1)) * 100, 100)}%` }} />
            </div>
          </div>
          <div className="bg-violet-50 rounded-xl p-5">
            <span className="text-sm text-violet-600 font-medium">本月 Token</span>
            <p className="text-2xl font-bold text-violet-700 font-mono mt-1">{formatNumber(stats.monthTokens)}</p>
            <div className="w-full h-1.5 bg-violet-200 rounded-full mt-3 overflow-hidden">
              <div className="h-full bg-violet-600 rounded-full" style={{ width: `${Math.min((stats.monthTokens / (stats.totalTokens || 1)) * 100, 100)}%` }} />
            </div>
          </div>
          <div className="bg-emerald-50 rounded-xl p-5">
            <span className="text-sm text-emerald-600 font-medium">总 Token</span>
            <p className="text-2xl font-bold text-emerald-700 font-mono mt-1">{formatNumber(stats.totalTokens)}</p>
            <div className="w-full h-1.5 bg-emerald-200 rounded-full mt-3 overflow-hidden">
              <div className="h-full bg-emerald-600 rounded-full" style={{ width: '100%' }} />
            </div>
          </div>
        </div>
      </section>

      {/* Token 日趋势 + Provider 分布 */}
      <section className="grid grid-cols-2 gap-8">
        <div className="bg-gray-50/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Token 日趋势</h3>
          {dailyUsage.length === 0 ? (
            <div className="flex items-center justify-center h-[200px] text-xs text-gray-400">暂无数据</div>
          ) : (
            <TokenTrendChart data={dailyUsage} />
          )}
        </div>
        <div className="bg-gray-50/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Provider 分布</h3>
          {stats.providerDistribution.length === 0 ? (
            <div className="flex items-center justify-center h-[200px] text-xs text-gray-400">暂无数据</div>
          ) : (
            <ProviderPieChart data={stats.providerDistribution} />
          )}
        </div>
      </section>

      {/* 模型调用排行 + 连接概览 */}
      <section className="grid grid-cols-2 gap-8">
        <div className="bg-gray-50/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">模型调用排行</h3>
          {stats.topModels.length === 0 ? (
            <div className="flex items-center justify-center h-[200px] text-xs text-gray-400">暂无数据</div>
          ) : (
            <ModelRankingChart data={stats.topModels} />
          )}
        </div>
        <div className="bg-gray-50/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">连接概览</h3>
          <ConnectionOverview stats={stats} />
        </div>
      </section>

      {/* 活跃时段热力图 */}
      <section className="bg-gray-50/50 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">智能体 24h 活跃时段</h3>
        {activityData.length === 0 ? (
          <div className="flex items-center justify-center h-[120px] text-xs text-gray-400">暂无数据</div>
        ) : (
          <ActivityHeatmapChart data={activityData} />
        )}
      </section>
    </>
  )

  if (loading) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-white rounded-xl shadow-sm border border-gray-200 animate-fadeIn">
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-400">加载中...</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white rounded-xl shadow-sm border border-gray-200 animate-fadeIn">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
        <div>
          <h2 className="text-base font-semibold text-gray-800">仪表盘</h2>
          <p className="text-xs text-gray-400 mt-0.5">系统概览 · {stats.onlineAgents}/{stats.totalAgents} 智能体在线</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-8">
          {inner}
        </div>
      </div>
    </div>
  )
}

/* ===== Token Trend Chart ===== */
const TokenTrendChart: React.FC<{ data: DailyUsage[] }> = ({ data }) => {
  const maxT = Math.max(...data.map(d => d.tokens), 1)
  return (
    <div className="flex gap-1">
      <div className="flex flex-col justify-between text-[10px] text-gray-400 pr-2" style={{ height: CHART_HEIGHT }}>
        <span>{formatNumber(maxT)}</span>
        <span>{formatNumber(Math.round(maxT / 2))}</span>
        <span>0</span>
      </div>
      <div className="flex-1 overflow-x-auto">
        <div className="flex items-end gap-2" style={{ height: CHART_HEIGHT }}>
          {data.map((item) => {
            const barHeight = (item.tokens / maxT) * (CHART_HEIGHT - 24)
            const isToday = new Date(item.date).toDateString() === new Date().toDateString()
            return (
              <div key={item.date} className="flex-1 flex flex-col items-center min-w-[28px] group relative">
                <span className="text-[9px] text-gray-500 font-mono mb-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {formatNumber(item.tokens)}
                </span>
                <div
                  className="w-full rounded-t cursor-pointer transition-all duration-200"
                  style={{
                    height: `${Math.max(barHeight, 2)}px`,
                    background: isToday
                      ? 'linear-gradient(180deg, #3B82F6 0%, #1D4ED8 100%)'
                      : 'linear-gradient(180deg, #93C5FD 0%, #60A5FA 100%)',
                  }}
                />
                <span className="text-[10px] text-gray-400 mt-1.5 truncate w-full text-center">
                  {formatDate(item.date)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ===== Provider Pie Chart ===== */
const ProviderPieChart: React.FC<{ data: ProviderUsage[] }> = ({ data }) => {
  const total = data.reduce((sum, d) => sum + d.tokenCount, 0) || 1
  let accumulatedAngle = 0
  const segments = data.map((item, index) => {
    const percentage = item.tokenCount / total
    const angle = percentage * PIE_CIRCUMFERENCE
    const segment = {
      ...item, color: COLORS[index % COLORS.length],
      dashArray: `${angle} ${PIE_CIRCUMFERENCE - angle}`,
      dashOffset: -accumulatedAngle,
    }
    accumulatedAngle += angle
    return segment
  })

  return (
    <div className="flex items-center gap-6">
      <div className="flex-shrink-0 relative">
        <svg width={PIE_SIZE} height={PIE_SIZE} viewBox={`0 0 ${PIE_SIZE} ${PIE_SIZE}`}>
          <circle cx={PIE_SIZE / 2} cy={PIE_SIZE / 2} r={PIE_RADIUS} fill="none" stroke="#F3F4F6" strokeWidth="20" />
          {segments.map((seg) => (
            <circle key={seg.providerId} cx={PIE_SIZE / 2} cy={PIE_SIZE / 2} r={PIE_RADIUS}
              fill="none" stroke={seg.color} strokeWidth="20"
              strokeDasharray={seg.dashArray} strokeDashoffset={seg.dashOffset}
              transform={`rotate(-90 ${PIE_SIZE / 2} ${PIE_SIZE / 2})`}
              className="transition-all duration-300" style={{ cursor: 'pointer' }}
            />
          ))}
          <text x={PIE_SIZE / 2} y={PIE_SIZE / 2} textAnchor="middle" dominantBaseline="central" className="text-sm font-bold fill-gray-700">
            {total.toLocaleString()}
          </text>
          <text x={PIE_SIZE / 2} y={PIE_SIZE / 2 + 16} textAnchor="middle" dominantBaseline="central" className="text-[10px] fill-gray-400">
            Total
          </text>
        </svg>
      </div>
      <div className="flex-1 space-y-2">
        {data.map((item, index) => (
          <div key={item.providerId} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-600 truncate">{item.providerName}</span>
                <span className="text-xs text-gray-500 font-mono ml-2">{item.percentage.toFixed(1)}%</span>
              </div>
              <div className="text-[10px] text-gray-400">
                {formatNumber(item.tokenCount)} tokens · {item.callCount} 次调用
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ===== Model Ranking ===== */
const ModelRankingChart: React.FC<{ data: ModelUsage[] }> = ({ data }) => {
  const maxTokens = Math.max(...data.map(d => d.tokenCount), 1)
  const maxCalls = Math.max(...data.map(d => d.callCount), 1)
  return (
    <div className="space-y-3">
      {data.map((model, index) => (
        <div key={model.modelId}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className={`text-xs font-mono font-bold w-5 flex-shrink-0 ${index === 0 ? 'text-amber-500' : index === 1 ? 'text-gray-400' : index === 2 ? 'text-orange-600' : 'text-gray-300'}`}>
                #{index + 1}
              </span>
              <span className="text-xs text-gray-700 font-medium truncate">{model.modelName}</span>
              <span className="text-[10px] text-gray-400 flex-shrink-0">{model.providerId}</span>
            </div>
            <span className="text-xs text-gray-500 font-mono">{formatNumber(model.tokenCount)}</span>
          </div>
          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-0.5">
            <div className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full" style={{ width: `${Math.max((model.tokenCount / maxTokens) * 100, 1)}%` }} />
          </div>
          <div className="w-full h-1.5 bg-gray-50 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-violet-300 to-violet-500 rounded-full" style={{ width: `${Math.max((model.callCount / maxCalls) * 100, 1)}%` }} />
          </div>
          <div className="text-[10px] text-gray-400 text-right mt-0.5">{model.callCount} 次调用</div>
        </div>
      ))}
      <div className="flex items-center gap-4 pt-2 border-t border-gray-100">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded bg-gradient-to-r from-blue-400 to-blue-600" />
          <span className="text-[10px] text-gray-400">Token 消耗</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded bg-gradient-to-r from-violet-300 to-violet-500" />
          <span className="text-[10px] text-gray-400">调用次数</span>
        </div>
      </div>
    </div>
  )
}

/* ===== Connection Overview ===== */
const ConnectionOverview: React.FC<{ stats: DashboardStats }> = ({ stats }) => (
  <div className="grid grid-cols-2 gap-4">
    <div className="bg-gray-100/50 rounded-lg p-4">
      <span className="text-xs text-gray-500 block">活跃连接</span>
      <span className="text-2xl font-bold text-gray-800 font-mono mt-1 block">{stats.activeConnections}</span>
      <span className="text-[10px] text-gray-400 mt-0.5 block">当前在线</span>
    </div>
    <div className="bg-gray-100/50 rounded-lg p-4">
      <span className="text-xs text-gray-500 block">智能体总数</span>
      <span className="text-2xl font-bold text-gray-800 font-mono mt-1 block">{stats.totalAgents}</span>
      <span className="text-[10px] text-gray-400 mt-0.5 block">{stats.onlineAgents} 在线</span>
    </div>
    <div className="bg-gray-100/50 rounded-lg p-4 col-span-2">
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500 flex-shrink-0">在线率</span>
        <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-green-400 to-green-600 rounded-full" style={{ width: `${stats.totalAgents > 0 ? (stats.onlineAgents / stats.totalAgents) * 100 : 0}%` }} />
        </div>
        <span className="text-xs text-gray-600 font-mono flex-shrink-0">{stats.onlineAgents}/{stats.totalAgents}</span>
      </div>
    </div>
  </div>
)

/* ===== Activity Heatmap ===== */
const ActivityHeatmapChart: React.FC<{ data: ActivityData[] }> = ({ data }) => {
  const globalMax = Math.max(...data.flatMap(agent => agent.hourlyActivity), 1)
  return (
    <div className="overflow-x-auto">
      <div className="inline-flex flex-col gap-3 min-w-full">
        <div className="flex gap-0.5">
          <div className="w-20 flex-shrink-0" />
          {HOURS.map((h) => (
            <div key={h} className="flex-1 flex flex-col items-center min-w-[18px]">
              <span className="text-[9px] text-gray-400 leading-tight">{h === 0 ? '0' : h === 12 ? '12' : `${h % 12 || 12}`}</span>
              <span className="text-[8px] text-gray-300 leading-tight">{h < 12 ? 'AM' : 'PM'}</span>
            </div>
          ))}
        </div>
        {data.map((agent) => (
          <div key={agent.workspaceId} className="flex items-center gap-0.5">
            <div className="w-20 flex-shrink-0 pr-2">
              <span className="text-[10px] text-gray-600 truncate block text-right">{agent.workspaceName}</span>
            </div>
            {agent.hourlyActivity.map((value, hourIdx) => (
              <div key={hourIdx} className={`flex-1 aspect-square rounded-sm min-w-[14px] ${value === 0 ? 'bg-gray-100' : getActivityLevel(value, globalMax)} transition-colors cursor-default`}
                title={`${agent.workspaceName} · ${hourIdx}:00\n活跃度: ${value}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
        <span className="text-[10px] text-gray-400">低</span>
        <div className="w-3 h-3 rounded-sm bg-gray-100" />
        <div className="w-3 h-3 rounded-sm bg-blue-100" />
        <div className="w-3 h-3 rounded-sm bg-blue-300" />
        <div className="w-3 h-3 rounded-sm bg-blue-500" />
        <div className="w-3 h-3 rounded-sm bg-blue-700" />
        <span className="text-[10px] text-gray-400">高</span>
      </div>
    </div>
  )
}

export default DashboardPanel