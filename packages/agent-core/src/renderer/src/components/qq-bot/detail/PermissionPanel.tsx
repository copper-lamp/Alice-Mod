import React, { useState, useEffect } from 'react'
import { Select, Slider, Switch, Button, ListBox } from '@heroui/react'
import { useQQBotStore } from '../../../stores/qqBotStore'
import type { QQAccount } from '../../../stores/qqBotStore'

const PERMISSION_LEVELS = [
  { value: 0, label: '无权限 (NONE)' },
  { value: 1, label: '基础 (BASIC)' },
  { value: 2, label: '命令 (COMMAND)' },
  { value: 3, label: '管理员 (ADMIN)' },
]

interface Props {
  account: QQAccount
}

export const PermissionPanel: React.FC<Props> = ({ account }) => {
  const saveConfig = useQQBotStore(s => s.saveConfig)

  const [defaultPermission, setDefaultPermission] = useState<string>('1')
  const [cooldown, setCooldown] = useState(3)
  const [allowPrivate, setAllowPrivate] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (account.config.authorization) {
      setDefaultPermission(String(account.config.authorization.defaultPermission))
      setCooldown(account.config.authorization.cooldownSeconds)
      setAllowPrivate(account.config.authorization.allowPrivate)
    }
  }, [account.id, account.config.authorization])

  const handleSave = async () => {
    setSaving(true)
    await saveConfig(account.id, {
      ...account.config,
      authorization: {
        defaultPermission: parseInt(defaultPermission, 10) as 0 | 1 | 2 | 3,
        cooldownSeconds: cooldown,
        allowPrivate,
      },
    })
    setSaving(false)
  }

  return (
    <div className="space-y-6 py-1">
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1">默认权限</label>
        <p className="text-xs text-gray-400 mb-2">未在白名单中的用户的默认权限等级</p>
        <Select
          selectedKey={defaultPermission}
          onSelectionChange={(key) => { if (key) setDefaultPermission(key.toString()) }}
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {PERMISSION_LEVELS.map(level => (
                <ListBox.Item key={String(level.value)} textValue={level.label}>{level.label}</ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>

      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1">
          冷却时间: <span className="font-mono">{cooldown}秒</span>
        </label>
        <p className="text-xs text-gray-400 mb-3">同一用户两次命令调用的最小间隔</p>
        <Slider
          value={cooldown}
          onChange={(v: number | number[]) => setCooldown(Array.isArray(v) ? v[0] : v)}
          minValue={0}
          maxValue={30}
          step={1}
          className="max-w-xs"
        >
          <Slider.Track>
            <Slider.Fill />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>
      </div>

      <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
        <div>
          <label className="text-sm font-medium text-gray-700">允许私聊</label>
          <p className="text-xs text-gray-400">是否允许用户通过私聊方式与机器人交互</p>
        </div>
        <Switch isSelected={allowPrivate} onChange={setAllowPrivate}>
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>
      </div>

      <div className="pt-2">
        <Button
          size="sm"
          onPress={handleSave}
          isPending={saving}
        >
          {saving ? '保存中...' : '保存权限配置'}
        </Button>
      </div>
    </div>
  )
}
