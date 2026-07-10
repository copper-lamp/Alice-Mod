import React, { useState } from 'react'
import { TextField, Label, Input, Select, Button, Chip, Card, ListBox } from '@heroui/react'
import { useQQBotStore } from '../../../stores/qqBotStore'
import type { QQAccount, BridgeConfig } from '../../../stores/qqBotStore'

interface Props {
  account: QQAccount
}

const DIRECTION_LABELS: Record<string, string> = {
  both: '双向',
  qq_to_game: 'QQ → 游戏',
  game_to_qq: '游戏 → QQ',
}

export const BridgeConfigPanel: React.FC<Props> = ({ account }) => {
  const saveConfig = useQQBotStore(s => s.saveConfig)

  const [groupId, setGroupId] = useState('')
  const [direction, setDirection] = useState('both')
  const [prefix, setPrefix] = useState('')
  const [keywords, setKeywords] = useState('')
  const [adding, setAdding] = useState(false)

  const bridges = account.config.bridges || []

  const handleAddBridge = async () => {
    if (!groupId.trim()) return
    setAdding(true)
    const newBridge: BridgeConfig = {
      groupId: groupId.trim(),
      direction: direction as BridgeConfig['direction'],
      prefix: prefix.trim() || undefined,
      keywords: keywords.trim() ? keywords.split(/\s*[,，]\s*/).filter(Boolean) : undefined,
    }
    const updatedBridges = [...bridges, newBridge]
    await saveConfig(account.id, {
      ...account.config,
      bridges: updatedBridges,
    })
    setGroupId('')
    setPrefix('')
    setKeywords('')
    setAdding(false)
  }

  const handleRemoveBridge = async (index: number) => {
    const updatedBridges = bridges.filter((_: BridgeConfig, i: number) => i !== index)
    await saveConfig(account.id, {
      ...account.config,
      bridges: updatedBridges,
    })
  }

  return (
    <div className="space-y-5 py-1">
      {bridges.length > 0 && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">已配置的桥接</label>
          {bridges.map((bridge: BridgeConfig, index: number) => (
            <Card key={index} className="p-3 bg-gray-50/50 border-gray-100">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm text-gray-700">{bridge.groupId}</span>
                    <Chip size="sm" variant="soft">{DIRECTION_LABELS[bridge.direction] || bridge.direction}</Chip>
                  </div>
                  {(bridge.prefix || (bridge.keywords && bridge.keywords.length > 0)) && (
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                      {bridge.prefix && <span>前缀: {bridge.prefix}</span>}
                      {bridge.keywords && bridge.keywords.length > 0 && <span>关键词: {bridge.keywords.join(', ')}</span>}
                    </div>
                  )}
                </div>
                <button
                  className="text-gray-400 hover:text-red-500 cursor-pointer shrink-0"
                  onClick={() => handleRemoveBridge(index)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {bridges.length === 0 && (
        <div className="text-sm text-gray-400 bg-gray-50 rounded-lg p-4">
          暂无桥接规则，添加一个以启用 QQ 群与游戏内聊天的双向同步
        </div>
      )}

      <div className="border border-gray-200 rounded-lg p-4 space-y-3">
        <label className="text-sm font-medium text-gray-700">添加桥接规则</label>
        <div className="grid grid-cols-2 gap-3">
          <TextField value={groupId} onChange={setGroupId}>
            <Label>群号</Label>
            <Input placeholder="QQ 群号" />
          </TextField>
          <Select
            selectedKey={direction}
            onSelectionChange={(key) => { if (key) setDirection(key.toString()) }}
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="both" textValue="双向">双向</ListBox.Item>
                <ListBox.Item id="qq_to_game" textValue="QQ → 游戏">QQ → 游戏</ListBox.Item>
                <ListBox.Item id="game_to_qq" textValue="游戏 → QQ">游戏 → QQ</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
          <TextField value={prefix} onChange={setPrefix}>
            <Label>前缀（可选）</Label>
            <Input placeholder="如 [QQ]" />
          </TextField>
          <TextField value={keywords} onChange={setKeywords}>
            <Label>关键词（可选）</Label>
            <Input placeholder="用逗号分隔" />
          </TextField>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onPress={handleAddBridge}
          isPending={adding}
          isDisabled={!groupId.trim()}
        >
          {adding ? '添加中...' : '添加规则'}
        </Button>
      </div>
    </div>
  )
}
