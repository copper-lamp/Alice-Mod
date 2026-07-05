import React from 'react'
import { Checkbox, Select, Label, ListBox } from '@heroui/react'

interface QQBinding {
  enabled: boolean
  accountId?: string
  groupIds?: string[]
}

interface QQBindSectionProps {
  binding: QQBinding
  onChange: (binding: QQBinding) => void
}

const MOCK_QQ_ACCOUNTS = [
  { id: '10001', name: '主账号 - 10001' },
  { id: '10002', name: '子账号 - 10002' },
  { id: '10003', name: '测试账号 - 10003' }
]

const MOCK_QQ_GROUPS = [
  { id: 'g001', name: 'Minecraft 服务器群' },
  { id: 'g002', name: 'AI 开发交流群' },
  { id: 'g003', name: '测试群组' },
  { id: 'g004', name: '管理群' }
]

const QQBindSection: React.FC<QQBindSectionProps> = ({ binding, onChange }) => {
  const handleToggleEnabled = (enabled: boolean) => {
    onChange({ ...binding, enabled })
  }

  const handleAccountChange = (accountId: string) => {
    onChange({ ...binding, accountId })
  }

  const handleAddGroup = (groupId: string) => {
    const current = binding.groupIds ?? []
    if (current.includes(groupId) || !groupId) return
    onChange({ ...binding, groupIds: [...current, groupId] })
  }

  const handleRemoveGroup = (groupId: string) => {
    const current = binding.groupIds ?? []
    onChange({ ...binding, groupIds: current.filter(id => id !== groupId) })
  }

  const availableGroups = MOCK_QQ_GROUPS.filter(g => !(binding.groupIds ?? []).includes(g.id))

  return (
    <div className="space-y-4">
      {/* 启用开关 */}
      <Checkbox isSelected={binding.enabled} onChange={handleToggleEnabled}>
        <Checkbox.Content>
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
          <span className="text-sm text-gray-700">启用 QQ 绑定</span>
        </Checkbox.Content>
      </Checkbox>

      {binding.enabled && (
        <>
          {/* 账号选择 */}
          <div>
            <label className="text-xs text-gray-500 font-medium mb-1.5 block">QQ 账号</label>
            <Select
              selectedKey={binding.accountId ?? ''}
              onSelectionChange={(key) => handleAccountChange(key as string)}
              placeholder="请选择账号"
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {MOCK_QQ_ACCOUNTS.map(acc => (
                    <ListBox.Item key={acc.id} id={acc.id} textValue={acc.name}>
                      {acc.name}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>

          {/* 群组选择 */}
          <div>
            <label className="text-xs text-gray-500 font-medium mb-1.5 block">绑定群组</label>
            {binding.groupIds && binding.groupIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {binding.groupIds.map(gid => {
                  const group = MOCK_QQ_GROUPS.find(g => g.id === gid)
                  return (
                    <span
                      key={gid}
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-green-50 text-green-600 rounded-full border border-green-200"
                    >
                      {group?.name ?? gid}
                      <button
                        onClick={() => handleRemoveGroup(gid)}
                        className="text-green-400 hover:text-green-600 ml-0.5"
                      >
                        ×
                      </button>
                    </span>
                  )
                })}
              </div>
            )}
            {availableGroups.length > 0 ? (
              <Select
                selectedKey=""
                onSelectionChange={(key) => handleAddGroup(key as string)}
                placeholder="添加群组..."
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {availableGroups.map(g => (
                      <ListBox.Item key={g.id} id={g.id} textValue={g.name}>
                        {g.name}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            ) : (
              <div className="text-xs text-gray-400">已选择所有可用群组</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default QQBindSection
