import React from 'react'
import { RadioGroup, Radio } from '@heroui/react'

interface MemoryConfigSectionProps {
  mode: 'sqlite' | 'chroma' | 'both'
  onChange: (mode: 'sqlite' | 'chroma' | 'both') => void
}

const MEMORY_OPTIONS: { value: 'sqlite' | 'chroma' | 'both'; label: string; description: string }[] = [
  {
    value: 'sqlite',
    label: 'SQLite 结构化存储',
    description: '使用关系型数据库存储对话记录和结构化数据，适用于精确查询和历史追溯'
  },
  {
    value: 'chroma',
    label: 'Chroma 向量记忆',
    description: '使用向量数据库进行语义检索，适用于相似度匹配和上下文召回'
  },
  {
    value: 'both',
    label: '二者兼用',
    description: '同时使用 SQLite 和 Chroma，兼顾结构化查询与语义检索能力'
  }
]

const MemoryConfigSection: React.FC<MemoryConfigSectionProps> = ({ mode, onChange }) => {
  return (
    <RadioGroup value={mode} onChange={(val) => onChange(val as 'sqlite' | 'chroma' | 'both')}>
      {MEMORY_OPTIONS.map(option => (
        <Radio
          key={option.value}
          value={option.value}
          className="border-border group cursor-pointer rounded-lg border-2 p-3 hover:border-blue-300 data-[selected=true]:border-blue-500 data-[selected=true]:bg-blue-500/10"
        >
          <Radio.Content>
            <Radio.Control>
              <Radio.Indicator />
            </Radio.Control>
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-700">{option.label}</div>
              <div className="text-xs text-gray-400 mt-0.5">{option.description}</div>
            </div>
          </Radio.Content>
        </Radio>
      ))}
    </RadioGroup>
  )
}

export default MemoryConfigSection
