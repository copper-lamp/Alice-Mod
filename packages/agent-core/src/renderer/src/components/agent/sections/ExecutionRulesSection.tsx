import React from 'react'
import { Description } from '@heroui/react'
import Toggle from '../../ui/Toggle'

interface ExecutionRule {
  id: string
  name: string
  description: string
  enabled: boolean
}

interface ExecutionRulesSectionProps {
  rules: ExecutionRule[]
  onChange: (rules: ExecutionRule[]) => void
}

const PRESET_RULES: ExecutionRule[] = [
  {
    id: 'auto-eat',
    name: '自动进食',
    description: '当饱食度低于阈值时自动食用背包中的食物',
    enabled: true
  },
  {
    id: 'auto-equip',
    name: '自动装备',
    description: '根据当前活动自动切换合适的工具和装备',
    enabled: true
  },
  {
    id: 'safety-first',
    name: '安全优先',
    description: '优先保证角色安全，避免进入危险区域或接触危险方块',
    enabled: true
  },
  {
    id: 'item-collect',
    name: '物品收集',
    description: '自动收集周围掉落物并整理到背包',
    enabled: false
  },
  {
    id: 'tool-switch',
    name: '工具切换',
    description: '根据目标方块自动选择最合适的工具进行挖掘',
    enabled: false
  }
]

const ExecutionRulesSection: React.FC<ExecutionRulesSectionProps> = ({ rules, onChange }) => {
  const effectiveRules = rules.length > 0 ? rules : PRESET_RULES

  const handleToggle = (ruleId: string, enabled: boolean) => {
    const updated = effectiveRules.map(r =>
      r.id === ruleId ? { ...r, enabled } : r
    )
    onChange(updated)
  }

  return (
    <div className="space-y-2">
      {effectiveRules.map(rule => (
        <div key={rule.id} className="flex items-start gap-3 rounded-lg bg-surface px-3 py-2.5">
          <Toggle selected={rule.enabled} onChange={(val) => handleToggle(rule.id, val)} label={rule.name} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">{rule.name}</div>
            <Description>{rule.description}</Description>
          </div>
        </div>
      ))}
    </div>
  )
}

export default ExecutionRulesSection
