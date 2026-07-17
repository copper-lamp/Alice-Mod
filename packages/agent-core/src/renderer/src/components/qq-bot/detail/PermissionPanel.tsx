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

      {/* ── 部署方式 ── */}
      <div className="pt-4 border-t border-gray-100">
        <label className="text-sm font-medium text-gray-700 block mb-1">部署方式</label>
        <p className="text-xs text-gray-400 mb-2">
          选择 NapCat 运行方式：Docker 容器（推荐）或桌面版进程
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={account.config.deploymentMode === 'docker' ? 'primary' : 'secondary'}
            onPress={async () => {
              if (account.config.deploymentMode === 'docker') return
              await saveConfig(account.id, {
                ...account.config,
                deploymentMode: 'docker',
              })
            }}
          >
            Docker 容器
          </Button>
          <Button
            size="sm"
            variant={account.config.deploymentMode === 'desktop' ? 'primary' : 'secondary'}
            onPress={async () => {
              if (account.config.deploymentMode === 'desktop') return
              await saveConfig(account.id, {
                ...account.config,
                deploymentMode: 'desktop',
              })
            }}
          >
            桌面版进程
          </Button>
        </div>
      </div>

      {/* ── 数据存储目录 ── */}
      <div className="pt-4 border-t border-gray-100">
        <label className="text-sm font-medium text-gray-700 block mb-1">数据存储目录</label>
        <p className="text-xs text-gray-400 mb-2">
          NapCat 登录态数据存储位置（含 QQ 聊天缓存、图片等），不占 C 盘空间
        </p>
        <div className="flex items-center gap-2">
          <div className="flex-1 text-sm text-gray-600 truncate font-mono bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
            {account.config.dataDir || '默认位置（软件安装目录/Alice/qq-bot/napcat-data/）'}
          </div>
          <Button
            size="sm"
            variant="secondary"
            onPress={async () => {
              const dir = await window.electronAPI.invoke('qq-bot:choose-data-dir') as string | null
              if (dir) {
                await saveConfig(account.id, {
                  ...account.config,
                  dataDir: dir,
                })
              }
            }}
          >
            选择目录
          </Button>
        </div>
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
