import { Button, Switch, ToggleButton, ToggleButtonGroup, Tooltip } from '@heroui/react'
import { PanelRight, RefreshCw, Trash2 } from 'lucide-react'
import type { AgentLogSource, AgentLogType } from '../../../lib/types'

interface Props {
  source: AgentLogSource
  type: AgentLogType
  autoFollow: boolean
  refreshing: boolean
  summaryExpanded: boolean
  onTypeChange: (type: AgentLogType) => void
  onAutoFollowChange: (enabled: boolean) => void
  onRefresh: () => void
  onClearQQ: () => void
  onSummaryExpandedChange: (expanded: boolean) => void
}

const filters = [
  ['all', '全部'],
  ['message', '消息'],
  ['tool', '工具'],
  ['system', '系统'],
] as const

export default function RuntimeToolbar(props: Props) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-separator px-3 py-2">
      <ToggleButtonGroup selectionMode="single" size="sm" selectedKeys={[props.type]} onSelectionChange={keys => {
        const selected = [...keys][0]
        if (selected) props.onTypeChange(selected as AgentLogType)
      }}>
        {filters.map(([id, label], index) => (
          <ToggleButton key={id} id={id} aria-label={`筛选${label}日志`}>
            {index > 0 ? <ToggleButtonGroup.Separator /> : null}
            {label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <div className="flex items-center gap-2">
        <Switch aria-label="自动跟随最新日志" isSelected={props.autoFollow} onChange={props.onAutoFollowChange}>
          <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control><span className="text-sm">自动跟随</span></Switch.Content>
        </Switch>
        {props.source === 'qq' ? (
          <Tooltip>
            <Button isIconOnly size="sm" variant="ghost" aria-label="清空 QQ 历史" onPress={props.onClearQQ}><Trash2 size={15} /></Button>
            <Tooltip.Content>清空 QQ 历史</Tooltip.Content>
          </Tooltip>
        ) : null}
        <Tooltip>
          <Button isIconOnly size="sm" variant="ghost" aria-label="刷新运行日志" isPending={props.refreshing} onPress={props.onRefresh}><RefreshCw size={15} /></Button>
          <Tooltip.Content>刷新日志</Tooltip.Content>
        </Tooltip>
        <Tooltip>
          <Button isIconOnly size="sm" variant="ghost" aria-label={props.summaryExpanded ? '收起运行摘要' : '展开运行摘要'} onPress={() => props.onSummaryExpandedChange(!props.summaryExpanded)}><PanelRight size={15} /></Button>
          <Tooltip.Content>{props.summaryExpanded ? '收起摘要' : '展开摘要'}</Tooltip.Content>
        </Tooltip>
      </div>
    </div>
  )
}
