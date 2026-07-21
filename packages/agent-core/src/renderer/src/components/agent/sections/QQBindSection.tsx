import React from 'react'
import { Select, ListBox, Switch } from '@heroui/react'
import { useQQBotStore } from '../../../stores/qqBotStore'

interface QQBinding {
  enabled: boolean
  accountId?: string
  groupIds?: string[]
  mentionOnly?: boolean
}

interface QQBindSectionProps {
  binding: QQBinding
  onChange: (binding: QQBinding) => void
}

const QQBindSection: React.FC<QQBindSectionProps> = ({ binding, onChange }) => {
  const accounts = useQQBotStore(s => s.accounts)

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

  // 从选中的账号的桥接配置中提取群组
  const selectedAccount = accounts.find(a => a.id === binding.accountId)
  const allGroups = selectedAccount
    ? selectedAccount.config.bridges.map(b => ({ id: b.groupId, name: `群 ${b.groupId}` }))
    : []

  // 当账号切换时，如果选中账号的桥梁中没有已绑定的群组，尝试保留
  // 但如果有群组不在新账号的桥梁中，则自动移除
  React.useEffect(() => {
    if (binding.accountId && selectedAccount && binding.groupIds && binding.groupIds.length > 0) {
      const validGroupIds = allGroups.map(g => g.id)
      const invalidGroups = binding.groupIds.filter(gid => !validGroupIds.includes(gid))
      if (invalidGroups.length > 0) {
        onChange({
          ...binding,
          groupIds: binding.groupIds.filter(gid => validGroupIds.includes(gid)),
        })
      }
    }
  }, [binding.accountId])

  const availableGroups = allGroups.filter(g => !(binding.groupIds ?? []).includes(g.id))

  return (
    <div className="space-y-4">
      {/* 启用开关 */}
      <div className="inline-flex items-center gap-2">
        <Switch
          isSelected={binding.enabled}
          onChange={(val) => handleToggleEnabled(val)}
        >
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>
        <span className="text-sm text-gray-700 select-none">启用 QQ 绑定</span>
      </div>

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
                  {accounts.length === 0 && (
                    <ListBox.Item key="empty" id="empty" textValue="暂无可用账号">
                      <span className="text-gray-400">暂无可用账号，请先在 QQ 机器人页面添加</span>
                    </ListBox.Item>
                  )}
                  {accounts
                    .filter(a => a.enabled)
                    .map(acc => (
                      <ListBox.Item key={acc.id} id={acc.id} textValue={`${acc.nickname} (${acc.qqNumber})`}>
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${acc.status === 'online' ? 'bg-green-500' : acc.status === 'reconnecting' ? 'bg-yellow-500' : 'bg-gray-300'}`} />
                          {acc.nickname || acc.qqNumber} ({acc.qqNumber})
                        </div>
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
                  const group = allGroups.find(g => g.id === gid)
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
            {!selectedAccount ? (
              <div className="text-xs text-gray-400">请先选择 QQ 账号</div>
            ) : allGroups.length === 0 ? (
              <div className="text-xs text-gray-400">该账号暂无桥接配置的群组，请先在 QQ 机器人页面的桥接配置中添加群组</div>
            ) : availableGroups.length === 0 ? (
              <div className="text-xs text-gray-400">已选择所有可用群组</div>
            ) : (
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
            )}
          </div>

          {/* V27: 仅 @ 触发 */}
          <div className="pt-2 border-t border-gray-100">
            <div className="inline-flex items-center gap-2">
              <Switch
                isSelected={binding.mentionOnly ?? false}
                onChange={(val) => onChange({ ...binding, mentionOnly: val })}
              >
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch.Content>
              </Switch>
              <span className="text-sm text-gray-700 select-none">仅 @ 触发</span>
            </div>
            <p className="text-xs text-gray-400 mt-1 ml-11">
              开启后仅处理 @ 机器人的群消息，其他消息将被忽略
            </p>
          </div>
        </>
      )}
    </div>
  )
}

export default QQBindSection