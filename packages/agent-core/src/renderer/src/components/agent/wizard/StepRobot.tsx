import React, { useEffect, useState } from 'react'
import { Switch, Checkbox, Select, ListBox } from '@heroui/react'
import { useWizardStore } from '../../../stores/wizardStore'
import { useQQBotStore, type QQAccount } from '../../../stores/qqBotStore'

interface GroupInfo {
  id: string
  name: string
}

const StepRobot: React.FC = () => {
  const { formData, updateQQBinding } = useWizardStore()
  const { accounts, loadAccounts } = useQQBotStore()
  const [loaded, setLoaded] = useState(false)
  const [availableGroups, setAvailableGroups] = useState<GroupInfo[]>([])
  const binding = formData.qqBinding

  useEffect(() => {
    loadAccounts().then(() => setLoaded(true))
  }, [])

  // 当选中账号变更时，从该账号的 bridge 配置中获取群组
  useEffect(() => {
    if (binding.accountId) {
      const account = accounts.find(a => a.id === binding.accountId)
      if (account) {
        const groups = (account.config?.bridges ?? []).map(b => ({
          id: b.groupId,
          name: b.groupId, // 群名称需要连接后才能获取
        }))
        setAvailableGroups(groups)
      }
    } else {
      setAvailableGroups([])
    }
  }, [binding.accountId, accounts])

  // 从已绑定群组中找到显示名称
  const findGroupName = (gid: string): string => {
    if (binding.accountId) {
      const account = accounts.find(a => a.id === binding.accountId)
      if (account) {
        const bridge = account.config?.bridges?.find(b => b.groupId === gid)
        if (bridge) return bridge.groupId
      }
    }
    return gid
  }

  const handleAddGroup = (groupId: string) => {
    const current = binding.groupIds ?? []
    if (current.includes(groupId) || !groupId) return
    updateQQBinding({ groupIds: [...current, groupId] })
  }

  const handleRemoveGroup = (groupId: string) => {
    const current = binding.groupIds ?? []
    updateQQBinding({ groupIds: current.filter(id => id !== groupId) })
  }

  const unselectedGroups = availableGroups.filter(g => !(binding.groupIds ?? []).includes(g.id))
  const selectedAccount = accounts.find(a => a.id === binding.accountId)

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h3 className="text-lg font-medium text-gray-800 mb-1">机器人绑定</h3>
        <p className="text-xs text-gray-400 mb-2">可选：绑定 QQ 机器人账号</p>
      </div>

      <Checkbox
        isSelected={binding.enabled}
        onChange={(val) => updateQQBinding({ enabled: val })}
      >
        绑定 QQ 机器人
      </Checkbox>

      {binding.enabled && (
        <div className="space-y-4 pl-4 border-l-2 border-blue-100">
          <div>
            <label className="text-xs text-gray-500 font-medium mb-1.5 block">QQ 账号</label>
            {!loaded ? (
              <div className="text-xs text-gray-400 py-2">加载账号列表...</div>
            ) : accounts.length === 0 ? (
              <div className="text-xs text-gray-400 py-2">
                暂无已登录的 QQ 账号，请先在机器人面板添加
              </div>
            ) : (
              <Select
                selectedKey={binding.accountId ?? ''}
                onSelectionChange={(key) => updateQQBinding({ accountId: key as string })}
                placeholder="请选择账号"
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {accounts.map(acc => (
                      <ListBox.Item key={acc.id} id={acc.id} textValue={`${acc.nickname || acc.qqNumber} - ${acc.qqNumber}`}>
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${
                            acc.status === 'online' ? 'bg-green-500' :
                            acc.status === 'reconnecting' ? 'bg-yellow-500' : 'bg-gray-400'
                          }`} />
                          <span>{acc.nickname || acc.qqNumber}</span>
                          <span className="text-gray-400">({acc.qqNumber})</span>
                          <span className={`text-xs ${
                            acc.status === 'online' ? 'text-green-500' : 'text-gray-400'
                          }`}>
                            {acc.status === 'online' ? '在线' : acc.status === 'reconnecting' ? '重连中' : '离线'}
                          </span>
                        </div>
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            )}
          </div>

          {selectedAccount && (
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1.5 block">
                监听群组
                <span className="text-gray-400 font-normal ml-1">
                  (已绑定 {selectedAccount.config?.bridges?.length ?? 0} 个群)
                </span>
              </label>
              {binding.groupIds && binding.groupIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {binding.groupIds.map(gid => (
                    <span key={gid} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-green-50 text-green-600 rounded-full border border-green-200">
                      {findGroupName(gid)}
                      <button onClick={() => handleRemoveGroup(gid)} className="text-green-400 hover:text-green-600 ml-0.5">×</button>
                    </span>
                  ))}
                </div>
              )}
              {unselectedGroups.length > 0 ? (
                <Select selectedKey="" onSelectionChange={(key) => handleAddGroup(key as string)} placeholder="添加群组...">
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {unselectedGroups.map(g => (
                        <ListBox.Item key={g.id} id={g.id} textValue={g.name}>{g.name}</ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              ) : availableGroups.length > 0 ? (
                <div className="text-xs text-gray-400">已选择所有可用群组</div>
              ) : (
                <div className="text-xs text-gray-400 py-1">该账号暂无已配置的群组桥接</div>
              )}
            </div>
          )}

          {/* V27: 仅 @ 触发 */}
          <div className="pt-2 border-t border-gray-100">
            <div className="inline-flex items-center gap-2">
              <Switch
                isSelected={binding.mentionOnly ?? false}
                onChange={(val) => updateQQBinding({ mentionOnly: val })}
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
        </div>
      )}
    </div>
  )
}

export default StepRobot
