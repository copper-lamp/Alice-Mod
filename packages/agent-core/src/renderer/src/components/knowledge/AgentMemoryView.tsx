import React, { useState } from 'react'
import { Table, TextField, Input, Chip } from '@heroui/react'

interface MemoryItem {
  id: string
  contentSummary: string
  similarityScore: number
  updatedAt: string
  tags: string[]
}

const MOCK_MEMORIES: MemoryItem[] = [
  { id: '1', contentSummary: '玩家偏好使用钻石剑和盾牌组合，在战斗中优先使用格挡后反击策略。', similarityScore: 0.92, updatedAt: '2026-07-05 10:30', tags: ['战斗偏好', '装备'] },
  { id: '2', contentSummary: '玩家在建筑风格上偏好中世纪哥特式，常用材料为石砖、深色橡木和玻璃板。', similarityScore: 0.87, updatedAt: '2026-07-04 16:15', tags: ['建筑风格', '材料'] },
  { id: '3', contentSummary: '上一个会话中玩家正在探索下界堡垒的左侧通道，坐标 (-120, 45, 230)。', similarityScore: 0.81, updatedAt: '2026-07-03 22:00', tags: ['位置记忆', '任务'] },
  { id: '4', contentSummary: '玩家对红石机械的脉冲信号处理掌握较好，但对比较器减法模式理解不足。', similarityScore: 0.76, updatedAt: '2026-07-02 19:45', tags: ['能力评估', '红石'] },
  { id: '5', contentSummary: '智能体上次拒绝了玩家关于创造模式无敌的请求，维持了生存模式规则的一致性。', similarityScore: 0.68, updatedAt: '2026-07-01 14:20', tags: ['行为记录', '规则'] }
]

const similarityChipColor = (score: number): 'success' | 'warning' | 'danger' => {
  if (score >= 0.8) return 'success'
  if (score >= 0.6) return 'warning'
  return 'danger'
}

const AgentMemoryView: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('')

  const filtered = MOCK_MEMORIES.filter(memory =>
    memory.contentSummary.includes(searchQuery) ||
    memory.tags.some(tag => tag.includes(searchQuery))
  )

  return (
    <div>
      <h2 className="text-base font-semibold text-gray-700 mb-4">智能体记忆</h2>

      {/* 搜索框 */}
      <div className="mb-4">
        <TextField
          aria-label="搜索向量记忆"
          fullWidth
          value={searchQuery}
          onChange={setSearchQuery}
        >
          <Input placeholder="搜索向量记忆..." />
        </TextField>
      </div>

      {/* 表格 */}
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="记忆记录" className="min-w-[800px]">
            <Table.Header>
              <Table.Column isRowHeader>内容摘要</Table.Column>
              <Table.Column>相似度</Table.Column>
              <Table.Column>标签</Table.Column>
              <Table.Column>更新时间</Table.Column>
            </Table.Header>
            <Table.Body>
              {filtered.length > 0 ? (
                filtered.map(memory => (
                  <Table.Row key={memory.id} id={memory.id}>
                    <Table.Cell>
                      <span className="text-sm text-gray-700">{memory.contentSummary}</span>
                    </Table.Cell>
                    <Table.Cell>
                      <Chip color={similarityChipColor(memory.similarityScore)} variant="soft" size="sm">
                        {Math.round(memory.similarityScore * 100)}%
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {memory.tags.map(tag => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.5 text-[10px] text-gray-500 bg-gray-100 rounded"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="text-xs text-gray-400">{memory.updatedAt}</span>
                    </Table.Cell>
                  </Table.Row>
                ))
              ) : (
                <Table.Row id="empty">
                  <Table.Cell>
                    <span className="text-xs text-gray-400">未找到匹配的记忆片段</span>
                  </Table.Cell>
                  <Table.Cell />
                  <Table.Cell />
                  <Table.Cell />
                </Table.Row>
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  )
}

export default AgentMemoryView
