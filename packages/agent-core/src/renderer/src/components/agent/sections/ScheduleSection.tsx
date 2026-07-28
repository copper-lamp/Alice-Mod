import React from 'react'
import { Input, Label, ListBox, Radio, RadioGroup, Select, TextArea, TextField } from '@heroui/react'
import type { AgentSchedule } from '../../../lib/types'

interface ScheduleSectionProps {
  schedule?: AgentSchedule
  onChange: (schedule: AgentSchedule | undefined) => void
}

const TIMEZONE_OPTIONS = [
  { value: 'Asia/Shanghai', label: '亚洲/上海 (UTC+8)' },
  { value: 'Asia/Tokyo', label: '亚洲/东京 (UTC+9)' },
  { value: 'America/New_York', label: '美洲/纽约 (UTC-5)' },
  { value: 'America/Los_Angeles', label: '美洲/洛杉矶 (UTC-8)' },
  { value: 'Europe/London', label: '欧洲/伦敦 (UTC+0)' },
  { value: 'Europe/Berlin', label: '欧洲/柏林 (UTC+1)' },
  { value: 'Australia/Sydney', label: '澳大利亚/悉尼 (UTC+11)' },
  { value: 'UTC', label: 'UTC (协调世界时)' },
]

const defaultSchedule: AgentSchedule = { mode: 'disabled', timezone: 'Asia/Shanghai' }

const ScheduleSection: React.FC<ScheduleSectionProps> = ({ schedule, onChange }) => {
  const safe = schedule ?? defaultSchedule
  const update = (patch: Partial<AgentSchedule>) => onChange({ ...safe, ...patch })

  return <div className="space-y-4">
    <RadioGroup value={safe.mode} onChange={value => {
      if (value === 'disabled') onChange(undefined)
      else if (value !== 'random') update({ mode: value as 'cron' | 'interval' })
    }}>
      <Radio value="disabled" className="rounded-lg bg-surface p-3"><Radio.Content><Radio.Control><Radio.Indicator /></Radio.Control>关闭定时触发</Radio.Content></Radio>
      <Radio value="cron" className="rounded-lg bg-surface p-3"><Radio.Content><Radio.Control><Radio.Indicator /></Radio.Control>Cron 表达式</Radio.Content></Radio>
      <Radio value="interval" className="rounded-lg bg-surface p-3"><Radio.Content><Radio.Control><Radio.Indicator /></Radio.Control>固定间隔</Radio.Content></Radio>
      <Radio value="random" isDisabled className="rounded-lg bg-surface p-3 opacity-60"><Radio.Content><Radio.Control><Radio.Indicator /></Radio.Control><span>随机时段 <span className="ml-2 text-xs text-muted">后端暂不支持，无法启用</span></span></Radio.Content></Radio>
    </RadioGroup>

    {safe.mode === 'random' ? <div role="alert" className="rounded-lg bg-warning-soft p-3 text-sm text-warning-soft-foreground">当前配置包含随机时段调度，但后端尚未提供执行支持。请改为关闭、Cron 或固定间隔后再保存。</div> : null}

    {safe.mode === 'cron' ? <TextField value={safe.cronExpression ?? ''} onChange={value => update({ cronExpression: value })}><Label>Cron 表达式</Label><Input placeholder="例如：0 0 9 * * *" /><p className="mt-1 text-xs text-muted">格式：秒 分 时 日 月 周</p></TextField> : null}
    {safe.mode === 'interval' ? <TextField value={String(safe.intervalSeconds ?? 300)} onChange={value => update({ intervalSeconds: Math.max(10, Number.parseInt(value) || 300) })}><Label>间隔时间（秒）</Label><Input type="number" min={10} /><p className="mt-1 text-xs text-muted">最小间隔 10 秒，建议 60 秒以上</p></TextField> : null}

    {safe.mode !== 'disabled' && safe.mode !== 'random' ? <>
      <div><label className="mb-1.5 block text-sm font-medium text-foreground">时区</label><Select selectedKey={safe.timezone ?? 'Asia/Shanghai'} onSelectionChange={key => update({ timezone: String(key) })}><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger><Select.Popover><ListBox>{TIMEZONE_OPTIONS.map(timezone => <ListBox.Item key={timezone.value} id={timezone.value} textValue={timezone.label}>{timezone.label}<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></Select.Popover></Select></div>
      <TextField value={safe.prompt ?? ''} onChange={value => update({ prompt: value })}><Label>触发提示词（可选）</Label><TextArea rows={2} placeholder="例如：检查当前游戏状态并汇报" /></TextField>
    </> : null}
  </div>
}

export default ScheduleSection
