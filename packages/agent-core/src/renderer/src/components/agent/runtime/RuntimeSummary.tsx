import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, ProgressBar, ScrollShadow } from '@heroui/react'
import { RefreshCw } from 'lucide-react'
import { aimApi, dashboardApi, llmApi } from '../../../lib/ipc'
import type { ContextTokenInfo, DailyUsage, UsageStats } from '../../../lib/types'

interface Props { workspaceId: string }
interface Todo { id: string; title: string; done: boolean }

export default function RuntimeSummary({ workspaceId }: Props) {
  const [context, setContext] = useState<ContextTokenInfo | null>(null)
  const [usage, setUsage] = useState<UsageStats | null>(null)
  const [daily, setDaily] = useState<DailyUsage[]>([])
  const [todos, setTodos] = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const results = await Promise.allSettled([
      workspaceId ? llmApi.contextTokens(workspaceId) : Promise.resolve(null),
      llmApi.usage('today'),
      dashboardApi.usageHistory(7),
      aimApi.list(),
    ])
    const failures = results.filter(result => result.status === 'rejected').length
    if (results[0].status === 'fulfilled') setContext(results[0].value)
    if (results[1].status === 'fulfilled') setUsage(results[1].value)
    if (results[2].status === 'fulfilled') setDaily(results[2].value)
    if (results[3].status === 'fulfilled') {
      const tasks = (results[3].value.tasks ?? []) as Array<{ id: string; title: string; items?: Array<{ id: string; label: string; done: boolean }> }>
      setTodos(tasks.flatMap(task => task.items?.length ? task.items.map(item => ({ id: item.id, title: item.label, done: item.done })) : [{ id: task.id, title: task.title, done: false }]).slice(0, 10))
    }
    setError(failures ? `${failures} 项摘要数据暂时不可用` : null)
    setLoading(false)
  }, [workspaceId])

  useEffect(() => {
    void load()
    const interval = setInterval(load, 60000)
    return () => clearInterval(interval)
  }, [load])

  const maximum = Math.max(...daily.map(item => item.tokens), 1)

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col bg-surface-secondary/50 p-3">
      <div className="mb-3 flex items-center justify-between">
        <div><h2 className="text-sm font-semibold text-foreground">运行摘要</h2><p className="text-[10px] text-muted">部分数据为工作区或全局维度</p></div>
        <Button isIconOnly size="sm" variant="ghost" aria-label="刷新运行摘要" isPending={loading} onPress={() => void load()}><RefreshCw size={14} /></Button>
      </div>
      <ScrollShadow className="min-h-0 flex-1 space-y-4">
        {error ? <Alert status="warning"><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert> : null}
        <section className="rounded-md bg-surface p-3 shadow-sm">
          <h3 className="mb-2 text-xs font-medium text-muted">上下文窗口</h3>
          {context ? <><ProgressBar value={context.percentage} size="sm"><ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track></ProgressBar><p className="mt-1 text-xs text-muted">{context.used.toLocaleString()} / {context.max.toLocaleString()} tokens</p></> : <p className="text-xs text-muted">暂无上下文数据</p>}
        </section>
        <section className="rounded-md bg-surface p-3 shadow-sm">
          <h3 className="mb-2 text-xs font-medium text-muted">Token 用量</h3>
          <div className="space-y-1 text-xs text-muted"><p className="flex justify-between"><span>今日</span><span>{usage?.todayTokens.toLocaleString() ?? '--'}</span></p><p className="flex justify-between"><span>本月</span><span>{usage?.monthTokens.toLocaleString() ?? '--'}</span></p></div>
          <div className="mt-3 flex h-12 items-end gap-1">{daily.slice(-7).map(item => <div key={item.date} className="flex-1 rounded-t bg-default/25" title={`${item.date}: ${item.tokens.toLocaleString()}`} style={{ height: `${Math.max((item.tokens / maximum) * 48, 2)}px` }} />)}</div>
        </section>
        <section className="rounded-md bg-surface p-3 shadow-sm">
          <h3 className="mb-2 text-xs font-medium text-muted">待办事项</h3>
          {todos.length ? <div className="space-y-2">{todos.map(todo => <p key={todo.id} className={`text-xs ${todo.done ? 'text-muted line-through' : 'text-foreground'}`}>{todo.done ? '✓' : '○'} {todo.title}</p>)}</div> : <p className="text-xs text-muted">暂无待办事项</p>}
        </section>
      </ScrollShadow>
    </aside>
  )
}
