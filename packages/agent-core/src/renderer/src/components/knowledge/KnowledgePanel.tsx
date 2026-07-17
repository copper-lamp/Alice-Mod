/**
 * KnowledgePanel — 知识面板 UI（v2.0 重构）
 *
 * Tab 结构（5 个）：
 *   database → 资料库（知识库管理）
 *   memory   → 记忆（经验记忆）
 *   maps     → 地图路径点
 *   skill    → 技能配置
 *   aim      → 目标任务
 */

import React from 'react'
import { Card, Tabs } from '@heroui/react'
import { useKnowledgeStore } from '../../stores/knowledgeStore'
import type { KnowledgeTab } from '../../stores/knowledgeStore'
import DatabaseView from './DatabaseView'
import MemoryView from './MemoryView'
import MapsView from './MapsView'
import SkillsView from './SkillsView'
import AimView from './AimView'

const tabs = [
  { key: 'database' as const, label: '资料库' },
  { key: 'memory' as const, label: '记忆' },
  { key: 'maps' as const, label: '地图索引' },
  { key: 'skill' as const, label: '技能' },
  { key: 'aim' as const, label: '目标任务' },
]

const KnowledgePanel: React.FC = () => {
  const { activeTab, setActiveTab } = useKnowledgeStore()

  return (
    <div className="flex-1 flex flex-col overflow-hidden animate-fadeIn">
      <Card className="flex-1 flex flex-col overflow-hidden rounded-xl shadow-sm border border-gray-200">
        <Card.Content className="flex-1 flex flex-col overflow-hidden pt-5">
          <Tabs
            selectedKey={activeTab}
            onSelectionChange={(key) => setActiveTab(key as KnowledgeTab)}
            className="w-full"
          >
            <Tabs.ListContainer className="w-[80%] mx-auto">
              <Tabs.List
                aria-label="知识面板"
                className="w-full *:data-[selected=true]:text-gray-800 justify-center"
              >
                {tabs.map(tab => (
                  <Tabs.Tab key={tab.key} id={tab.key}>
                    {tab.label}
                    <Tabs.Indicator />
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs.ListContainer>

            <div className="flex-1 min-h-0 overflow-y-auto pt-4 px-5">
              <Tabs.Panel id="database">
                <DatabaseView />
              </Tabs.Panel>
              <Tabs.Panel id="memory">
                <MemoryView />
              </Tabs.Panel>
              <Tabs.Panel id="maps">
                <MapsView />
              </Tabs.Panel>
              <Tabs.Panel id="skill">
                <SkillsView />
              </Tabs.Panel>
              <Tabs.Panel id="aim">
                <AimView />
              </Tabs.Panel>
            </div>
          </Tabs>
        </Card.Content>
      </Card>
    </div>
  )
}

export default KnowledgePanel