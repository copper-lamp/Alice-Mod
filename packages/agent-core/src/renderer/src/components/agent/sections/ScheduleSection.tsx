import React from 'react'
import { RadioGroup, Radio, Select, ListBox, TextArea } from '@heroui/react'
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
  { value: 'UTC', label: 'UTC (协调世界时)' }
]

const defaultSchedule: AgentSchedule = {
  mode: 'disabled',
  timezone: 'Asia/Shanghai',
}

const ScheduleSection: React.FC<ScheduleSectionProps> = ({ schedule, onChange }) => {
  const safe = schedule ?? defaultSchedule

  const update = (patch: Partial<AgentSchedule>) => {
    onChange({ ...safe, ...patch })
  }

  return (
    <div className="space-y-4">
      {/* 模式选择 */}
      <RadioGroup value={safe.mode} onChange={(val) => {
        if (val === 'disabled') {
          onChange(undefined)
        } else {
          update({ mode: val as 'cron' | 'interval' })
        }
      }}>
        <Radio value="disabled" className="border-border group cursor-pointer rounded-lg border-2 p-3 hover:border-blue-300 data-[selected=true]:border-blue-500">
          <Radio.Content>
            <Radio.Control>
              <Radio.Indicator />
            </Radio.Control>
            关闭定时触发
          </Radio.Content>
        </Radio>
        <Radio value="cron" className="border-border group cursor-pointer rounded-lg border-2 p-3 hover:border-blue-300 data-[selected=true]:border-blue-500">
          <Radio.Content>
            <Radio.Control>
              <Radio.Indicator />
            </Radio.Control>
            Cron 表达式
          </Radio.Content>
        </Radio>
        <Radio value="interval" className="border-border group cursor-pointer rounded-lg border-2 p-3 hover:border-blue-300 data-[selected=true]:border-blue-500">
          <Radio.Content>
            <Radio.Control>
              <Radio.Indicator />
            </Radio.Control>
            固定间隔
          </Radio.Content>
        </Radio>
      </RadioGroup>

      {safe.mode === 'cron' && (
        <div className="space-y-3 pl-1">
          <div>
            <label className="text-xs text-gray-500 font-medium mb-1 block">Cron 表达式</label>
            <input
              type="text"
              value={safe.cronExpression ?? ''}
              onChange={e => update({ cronExpression: e.target.value })}
              placeholder="例如: 0 */30 * * * * (每30分钟), 0 9 * * * (每天9点)"
              className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 bg-white"
            />
            <p className="text-xs text-gray-400 mt-1">
              格式: 秒 分 时 日 月 周，例如 <code className="bg-gray-100 px-1 rounded">0 0 9 * * *</code> 每天9点
            </p>
          </div>

          <div>
            <label className="text-xs text-gray-500 font-medium mb-1 block">时区</label>
            <Select
              selectedKey={safe.timezone ?? 'Asia/Shanghai'}
              onSelectionChange={(key) => update({ timezone: key as string })}
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {TIMEZONE_OPTIONS.map(tz => (
                    <ListBox.Item key={tz.value} id={tz.value} textValue={tz.label}>
                      {tz.label}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>

          <div>
            <label className="text-xs text-gray-500 font-medium mb-1 block">触发提示词（可选）</label>
            <TextArea
              value={safe.prompt ?? ''}
              onChange={(e) => update({ prompt: e.target.value })}
              placeholder="定时触发时发送给 AI 的提示词，如：检查当前游戏状态并汇报"
              rows={2}
              className="w-full resize-none"
            />
          </div>
        </div>
      )}

      {safe.mode === 'interval' && (
        <div className="space-y-3 pl-1">
          <div>
            <label className="text-xs text-gray-500 font-medium mb-1 block">间隔时间（秒）</label>
            <input
              type="number"
              min={10}
              value={safe.intervalSeconds ?? 300}
              onChange={e => update({ intervalSeconds: Math.max(10, parseInt(e.target.value) || 300) })}
              className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 bg-white"
            />
            <p className="text-xs text-gray-400 mt-1">最小间隔 10 秒，建议 60 秒以上</p>
          </div>

          <div>
            <label className="text-xs text-gray-500 font-medium mb-1 block">触发提示词（可选）</label>
            <TextArea
              value={safe.prompt ?? ''}
              onChange={(e) => update({ prompt: e.target.value })}
              placeholder="定时触发时发送给 AI 的提示词，如：检查当前游戏状态并汇报"
              rows={2}
              className="w-full resize-none"
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default ScheduleSection