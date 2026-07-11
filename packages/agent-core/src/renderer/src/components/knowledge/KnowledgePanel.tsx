import React from 'react'
import { Card, Tabs } from '@heroui/react'
import { useKnowledgeStore } from '../../stores/knowledgeStore'
import type { KnowledgeTab } from '../../stores/knowledgeStore'
import DatabaseView from './DatabaseView'
import MapIndexView from './MapIndexView'
import ExpertView from './ExpertView'
import ExperienceView from './ExperienceView'
import SkillsView from './SkillsView'

const tabs = [
  { key: 'database' as const, label: '资料库' },
  { key: 'map-index' as const, label: '地图索引' },
  { key: 'expert' as const, label: '专家' },
  { key: 'experience' as const, label: '经验' },
  { key: 'skill' as const, label: '技能' },
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
              <Tabs.Panel id="map-index">
                <MapIndexView />
              </Tabs.Panel>
              <Tabs.Panel id="expert">
                <ExpertView />
              </Tabs.Panel>
              <Tabs.Panel id="experience">
                <ExperienceView />
              </Tabs.Panel>
              <Tabs.Panel id="skill">
                <SkillsView />
              </Tabs.Panel>
            </div>
          </Tabs>
        </Card.Content>
      </Card>
    </div>
  )
}

export default KnowledgePanel
