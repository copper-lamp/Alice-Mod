import React from 'react'
import { RadioGroup, Radio, Select, Label, ListBox } from '@heroui/react'

interface AgentSchedule {
  mode: 'always' | 'scheduled'
  startTime?: string
  endTime?: string
  timezone?: string
}

interface ScheduleSectionProps {
  schedule: AgentSchedule
  onChange: (schedule: AgentSchedule) => void
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

const ScheduleSection: React.FC<ScheduleSectionProps> = ({ schedule, onChange }) => {
  return (
    <div className="space-y-4">
      {/* 模式选择 */}
      <RadioGroup value={schedule.mode} onChange={(val) => onChange({ ...schedule, mode: val as 'always' | 'scheduled' })}>
        <Radio value="always" className="border-border group cursor-pointer rounded-lg border-2 p-3 hover:border-blue-300 data-[selected=true]:border-blue-500">
          <Radio.Content>
            <Radio.Control>
              <Radio.Indicator />
            </Radio.Control>
            始终启用
          </Radio.Content>
        </Radio>
        <Radio value="scheduled" className="border-border group cursor-pointer rounded-lg border-2 p-3 hover:border-blue-300 data-[selected=true]:border-blue-500">
          <Radio.Content>
            <Radio.Control>
              <Radio.Indicator />
            </Radio.Control>
            定时启用
          </Radio.Content>
        </Radio>
      </RadioGroup>

      {schedule.mode === 'scheduled' && (
        <div className="space-y-3 pl-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1 block">开始时间</label>
              <input
                type="time"
                value={schedule.startTime ?? ''}
                onChange={e => onChange({ ...schedule, startTime: e.target.value })}
                className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 bg-white"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1 block">结束时间</label>
              <input
                type="time"
                value={schedule.endTime ?? ''}
                onChange={e => onChange({ ...schedule, endTime: e.target.value })}
                className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 bg-white"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 font-medium mb-1 block">时区</label>
            <Select
              selectedKey={schedule.timezone ?? 'Asia/Shanghai'}
              onSelectionChange={(key) => onChange({ ...schedule, timezone: key as string })}
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
        </div>
      )}
    </div>
  )
}

export default ScheduleSection
