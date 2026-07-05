import React from 'react'
import { Table, Chip } from '@heroui/react'

interface ExpertConfig {
  id: string
  name: string
  domain: string
  fragmentCount: number
  description: string
}

const MOCK_EXPERTS: ExpertConfig[] = [
  { id: '1', name: '建筑大师', domain: '建筑与结构设计', fragmentCount: 12, description: '擅长 Minecraft 建筑风格设计、材料搭配、结构力学分析，提供建筑方案建议。' },
  { id: '2', name: '红石工程师', domain: '红石电路与机械', fragmentCount: 18, description: '精通红石电路原理、脉冲发生器、逻辑门、活塞机械等复杂装置设计。' },
  { id: '3', name: '战斗导师', domain: '战斗与生存技巧', fragmentCount: 9, description: '涵盖 PvP 与 PvE 技巧、装备搭配、药水酿造、附魔策略等战斗知识。' },
  { id: '4', name: '资源管理师', domain: '资源规划与农业', fragmentCount: 7, description: '负责资源采集路线规划、自动化农场设计、物品分类存储系统方案。' },
  { id: '5', name: '探险向导', domain: '地形探索与导航', fragmentCount: 14, description: '掌握各类地形生成规则、遗迹定位技巧、下界与末地探险策略。' }
]

const ExpertView: React.FC = () => {
  return (
    <div>
      <h2 className="text-base font-semibold text-gray-700 mb-4">专家配置</h2>

      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="专家配置" className="min-w-[700px]">
            <Table.Header>
              <Table.Column isRowHeader>专家名称</Table.Column>
              <Table.Column>领域</Table.Column>
              <Table.Column>提示词片段数</Table.Column>
              <Table.Column>状态</Table.Column>
            </Table.Header>
            <Table.Body>
              {MOCK_EXPERTS.map(expert => (
                <Table.Row key={expert.id} id={expert.id}>
                  <Table.Cell>
                    <span className="text-sm font-medium text-gray-700">{expert.name}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <Chip color="accent" variant="soft" size="sm">
                      {expert.domain}
                    </Chip>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="text-xs text-gray-500">{expert.fragmentCount} 个</span>
                  </Table.Cell>
                  <Table.Cell>
                    <Chip color="success" variant="soft" size="sm">已激活</Chip>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  )
}

export default ExpertView
