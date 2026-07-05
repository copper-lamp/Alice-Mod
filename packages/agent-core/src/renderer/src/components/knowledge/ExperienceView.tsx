import React from 'react'
import { Table, Chip } from '@heroui/react'

interface ExperienceFragment {
  id: string
  title: string
  category: string
  summary: string
  createdAt: string
}

const MOCK_EXPERIENCES: ExperienceFragment[] = [
  {
    id: '1',
    title: '自动树场建造方案',
    category: '红石机械',
    summary: '使用活塞和观察器构建的自动树场，支持多种树木，每小时产量约 200 原木。关键设计点在于观察器检测树干生长、活塞推动时序控制。',
    createdAt: '2026-06-28 14:30'
  },
  {
    id: '2',
    title: '下界交通枢纽规划',
    category: '导航策略',
    summary: '主世界 1:8 坐标比例映射到下界，建议在 Y=120 高度修建冰道主干线，每 100 格设置一个中间站，主城坐标为枢纽中心。',
    createdAt: '2026-06-25 09:15'
  },
  {
    id: '3',
    title: '村民交易优化策略',
    category: '生存技巧',
    summary: '通过村民打折机制（僵尸转化后治愈），可大幅降低交易成本。建议先建造村民繁殖设施，再搭建交易大厅。',
    createdAt: '2026-06-22 16:45'
  },
  {
    id: '4',
    title: '盾牌使用进阶技巧',
    category: '战斗技巧',
    summary: '盾牌可以格挡 100% 正面近战伤害和弹射物伤害，但在格挡期间移动速度降低 30%。熟练使用盾牌格挡时机可有效应对苦力怕爆炸。',
    createdAt: '2026-06-20 11:00'
  },
  {
    id: '5',
    title: '高频红石信号处理',
    category: '红石机械',
    summary: '使用比较器脉冲缩短器可将高频信号转换为可控脉冲，避免红石火把烧毁。推荐使用 2 刻脉冲设计以平衡频率和稳定性。',
    createdAt: '2026-06-18 20:30'
  }
]

const categoryChipColor: Record<string, 'accent' | 'success' | 'danger' | 'warning'> = {
  '红石机械': 'accent',
  '导航策略': 'warning',
  '生存技巧': 'success',
  '战斗技巧': 'danger'
}

const ExperienceView: React.FC = () => {
  return (
    <div>
      <h2 className="text-base font-semibold text-gray-700 mb-4">经验管理</h2>

      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="经验片段" className="min-w-[800px]">
            <Table.Header>
              <Table.Column isRowHeader>标题</Table.Column>
              <Table.Column>分类</Table.Column>
              <Table.Column>摘要</Table.Column>
              <Table.Column>创建时间</Table.Column>
            </Table.Header>
            <Table.Body>
              {MOCK_EXPERIENCES.map(exp => (
                <Table.Row key={exp.id} id={exp.id}>
                  <Table.Cell>
                    <span className="text-sm font-medium text-gray-700">{exp.title}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <Chip color={categoryChipColor[exp.category] ?? 'default'} variant="soft" size="sm">
                      {exp.category}
                    </Chip>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="text-xs text-gray-500 line-clamp-2">{exp.summary}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="text-xs text-gray-400">{exp.createdAt}</span>
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

export default ExperienceView
