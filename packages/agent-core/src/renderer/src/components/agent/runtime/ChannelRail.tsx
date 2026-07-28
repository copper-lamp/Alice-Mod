import { Button, Tooltip } from '@heroui/react'
import { ChevronLeft, ChevronRight, Gamepad2, MessageCircle, Rows3 } from 'lucide-react'
import type { AgentLogSource } from '../../../lib/types'

interface Props {
  source: AgentLogSource
  expanded: boolean
  onSourceChange: (source: AgentLogSource) => void
  onExpandedChange: (expanded: boolean) => void
}

const sources = [
  { id: 'all', label: '全部', icon: Rows3 },
  { id: 'game', label: '游戏', icon: Gamepad2 },
  { id: 'qq', label: 'QQ', icon: MessageCircle },
] as const

export default function ChannelRail({ source, expanded, onSourceChange, onExpandedChange }: Props) {
  return (
    <aside className={`${expanded ? 'w-[210px]' : 'w-12'} flex shrink-0 flex-col gap-2 bg-surface-secondary/60 p-2 transition-[width]`}>
      <div className="flex items-center justify-between gap-2 px-1">
        {expanded ? <span className="text-xs font-medium text-muted">对话渠道</span> : null}
        <Tooltip>
          <Button isIconOnly size="sm" variant="ghost" aria-label={expanded ? '收起对话渠道' : '展开对话渠道'} onPress={() => onExpandedChange(!expanded)}>
            {expanded ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
          </Button>
          <Tooltip.Content>{expanded ? '收起渠道' : '展开渠道'}</Tooltip.Content>
        </Tooltip>
      </div>
      <nav className="flex flex-col gap-1" aria-label="日志来源">
        {sources.map(item => {
          const Icon = item.icon
          return (
            <Button key={item.id} size="sm" isIconOnly={!expanded} variant={source === item.id ? 'secondary' : 'ghost'} aria-label={`筛选${item.label}日志`} className={expanded ? 'justify-start' : ''} onPress={() => onSourceChange(item.id)}>
              <Icon size={15} />
              {expanded ? item.label : null}
            </Button>
          )
        })}
      </nav>
    </aside>
  )
}
