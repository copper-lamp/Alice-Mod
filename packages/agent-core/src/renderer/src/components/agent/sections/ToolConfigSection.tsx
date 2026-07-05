import React from 'react'
import { Checkbox } from '@heroui/react'

interface ToolConfigSectionProps {
  selection: Record<string, boolean>
  onChange: (selection: Record<string, boolean>) => void
}

const TOOL_CATEGORIES = [
  {
    id: 'perception',
    label: '感知类',
    toolCount: 6,
    tools: ['视野扫描', '方块识别', '实体检测', '光照检测', '声音检测', '环境分析']
  },
  {
    id: 'survival',
    label: '生存类',
    toolCount: 5,
    tools: ['自动采集', '耕种', '钓鱼', '合成', '熔炼']
  },
  {
    id: 'movement',
    label: '移动类',
    toolCount: 4,
    tools: ['路径规划', '自动寻路', '跳跃', '飞行']
  },
  {
    id: 'dialogue',
    label: '对话类',
    toolCount: 3,
    tools: ['聊天', '指令响应', '情感分析']
  },
  {
    id: 'inventory',
    label: '背包类',
    toolCount: 4,
    tools: ['物品管理', '装备管理', '容器操作', '物品分类']
  },
  {
    id: 'qq',
    label: 'QQ 类',
    toolCount: 4,
    tools: ['消息收发', '群管理', '文件传输', '语音']
  }
]

const ToolConfigSection: React.FC<ToolConfigSectionProps> = ({ selection, onChange }) => {
  const allSelected = TOOL_CATEGORIES.every(cat => selection[cat.id])

  const toggleAll = () => {
    if (allSelected) {
      onChange({})
    } else {
      const all: Record<string, boolean> = {}
      TOOL_CATEGORIES.forEach(cat => { all[cat.id] = true })
      onChange(all)
    }
  }

  const toggleCategory = (catId: string) => {
    onChange({ ...selection, [catId]: !selection[catId] })
  }

  return (
    <div className="space-y-3">
      {/* 全选 */}
      <Checkbox isSelected={allSelected} onChange={toggleAll}>
        <Checkbox.Content>
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
          <span className="text-sm font-medium text-gray-700">全选</span>
        </Checkbox.Content>
      </Checkbox>

      <div className="border-t border-gray-100" />

      {/* 分类列表 */}
      <div className="space-y-1">
        {TOOL_CATEGORIES.map(category => (
          <Checkbox
            key={category.id}
            isSelected={!!selection[category.id]}
            onChange={() => toggleCategory(category.id)}
          >
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <div className="flex-1 flex items-center justify-between w-full">
                <span className="text-sm text-gray-700">{category.label}</span>
                <span className="text-xs text-gray-400">{category.toolCount} 个工具</span>
              </div>
            </Checkbox.Content>
          </Checkbox>
        ))}
      </div>
    </div>
  )
}

export default ToolConfigSection
