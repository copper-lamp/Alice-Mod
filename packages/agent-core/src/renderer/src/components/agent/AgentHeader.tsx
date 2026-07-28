import { useEffect, useState } from 'react'
import { Button, Chip, Switch, toast } from '@heroui/react'
import { Wifi, WifiOff } from 'lucide-react'
import { agentApi } from '../../lib/ipc'
import type { AgentConfig, AgentRuntimeStatus, AgentSummary } from '../../lib/types'

interface Props {
  agent: AgentConfig
  summary?: AgentSummary
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return '未运行'
  const minutes = Math.floor((Date.now() - timestamp) / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export default function AgentHeader({ agent, summary }: Props) {
  const agentId = agent.id ?? ''
  const [enabled, setEnabled] = useState(agent.enabled !== false)
  const [status, setStatus] = useState<AgentRuntimeStatus>({ status: 'initializing', qqStatus: 'disconnected' })
  const [enabledPending, setEnabledPending] = useState(false)
  const [botPending, setBotPending] = useState(false)

  useEffect(() => setEnabled(agent.enabled !== false), [agent.id, agent.enabled])

  useEffect(() => {
    if (!agentId) return
    let active = true
    const refresh = async () => {
      try {
        const next = await agentApi.status(agentId)
        if (active) setStatus(next)
      } catch {
        // 状态接口不可用时保留最近一次可用状态。
      }
    }
    void refresh()
    const interval = setInterval(refresh, 30000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [agentId])

  const changeEnabled = async (selected: boolean) => {
    if (!agentId || enabledPending) return
    const previous = enabled
    setEnabled(selected)
    setEnabledPending(true)
    try {
      await agentApi.setEnabled(agentId, selected)
      toast.success(selected ? '智能体已启用' : '智能体已禁用')
    } catch (reason) {
      setEnabled(previous)
      toast.danger(reason instanceof Error ? reason.message : '更新启用状态失败')
    } finally {
      setEnabledPending(false)
    }
  }

  const botOnline = status.botOnline === true
  const controlBot = async () => {
    if (!agentId || botPending) return
    setBotPending(true)
    try {
      await agentApi.botControl(agentId, botOnline ? 'offline' : 'online')
      setStatus(previous => ({ ...previous, botOnline: !botOnline }))
      toast.success(botOnline ? '假人已下线' : '假人已上线')
    } catch (reason) {
      toast.danger(reason instanceof Error ? reason.message : '假人控制失败')
    } finally {
      setBotPending(false)
    }
  }

  const qqLabel = status.qqStatus === 'connected' ? 'QQ 在线' : status.qqStatus === 'connecting' ? 'QQ 连接中' : 'QQ 离线'

  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-separator">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-secondary text-sm font-semibold text-muted">
          {agent.skinData ? <img src={agent.skinData} alt={`${agent.name} 头像`} className="h-full w-full object-cover" /> : agent.name.charAt(0)}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-base font-semibold text-foreground">{agent.name}</h1>
            <Chip size="sm" color={enabled ? 'success' : 'default'} variant="soft">{enabled ? '已启用' : '已禁用'}</Chip>
            {agent.qqBinding.enabled ? <Chip size="sm" color={status.qqStatus === 'connected' ? 'success' : status.qqStatus === 'connecting' ? 'warning' : 'default'} variant="soft">{qqLabel}</Chip> : null}
            <Chip size="sm" color={botOnline ? 'success' : 'default'} variant="soft">假人{botOnline ? '在线' : '离线'}</Chip>
          </div>
          <p className="mt-0.5 text-xs text-muted">最后活跃：{formatTime(summary?.lastActiveAt)}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Switch aria-label={`${enabled ? '禁用' : '启用'}智能体 ${agent.name}`} isSelected={enabled} isDisabled={enabledPending} onChange={set => void changeEnabled(set)}>
          <Switch.Content>
            <Switch.Control><Switch.Thumb /></Switch.Control>
            <span className="text-sm">{enabled ? '启用中' : '已停用'}</span>
          </Switch.Content>
        </Switch>
        <Button size="sm" variant="secondary" isPending={botPending} isDisabled={botPending} onPress={() => void controlBot()}>
          {botOnline ? <WifiOff size={14} /> : <Wifi size={14} />}
          {botPending ? '处理中' : botOnline ? '下线' : '上线'}
        </Button>
      </div>
    </header>
  )
}
