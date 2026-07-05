import React, { useState } from 'react'
import { Table, TextField, Input, Chip } from '@heroui/react'

interface KnowledgeEntry {
  id: string
  name: string
  type: string
  description: string
}

const MOCK_ENTRIES: KnowledgeEntry[] = [
  { id: '1', name: '钻石矿石', type: '方块', description: '一种稀有矿石，通常生成于 Y=16 以下，需要用铁镐或更高等级镐开采。' },
  { id: '2', name: '钻石剑', type: '物品', description: '由 2 颗钻石和 1 根木棍合成，攻击力 7 点，是基础近战武器中的顶级选择。' },
  { id: '3', name: '苦力怕', type: '生物', description: '一种绿色爬行者，会悄悄靠近玩家后爆炸，爆炸威力随距离变化。' },
  { id: '4', name: '末影人', type: '生物', description: '中立生物，被注视时会瞬移并攻击玩家，掉落末影珍珠。' },
  { id: '5', name: '附魔台', type: '方块', description: '用于为工具和武器附魔，周围书架数量影响附魔等级上限。' },
  { id: '6', name: '下界合金锭', type: '物品', description: '在下界堡垒中获取远古残骸后熔炼得到，用于升级钻石装备。' },
  { id: '7', name: '红石中继器', type: '方块', description: '红石电路组件，可延迟信号或增强信号强度，用于构建复杂电路。' },
  { id: '8', name: '凋灵骷髅', type: '生物', description: '下界要塞中的敌对生物，被击杀后概率掉落凋灵骷髅头颅。' }
]

const typeChipColor: Record<string, 'success' | 'warning' | 'danger'> = {
  '物品': 'warning',
  '方块': 'success',
  '生物': 'danger'
}

const DatabaseView: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('')

  const filtered = MOCK_ENTRIES.filter(entry =>
    entry.name.includes(searchQuery) ||
    entry.type.includes(searchQuery) ||
    entry.description.includes(searchQuery)
  )

  return (
    <div>
      <h2 className="text-base font-semibold text-gray-700 mb-4">资料库管理</h2>

      {/* 搜索框 */}
      <div className="mb-4">
        <TextField
          aria-label="搜索知识条目"
          fullWidth
          value={searchQuery}
          onChange={setSearchQuery}
        >
          <Input placeholder="搜索知识条目..." />
        </TextField>
      </div>

      {/* 表格 */}
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="资料库条目" className="min-w-[600px]">
            <Table.Header>
              <Table.Column isRowHeader>类型</Table.Column>
              <Table.Column>名称</Table.Column>
              <Table.Column>描述</Table.Column>
            </Table.Header>
            <Table.Body>
              {filtered.length > 0 ? (
                filtered.map(entry => (
                  <Table.Row key={entry.id} id={entry.id}>
                    <Table.Cell>
                      <Chip color={typeChipColor[entry.type] ?? 'default'} variant="soft" size="sm">
                        {entry.type}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="text-sm font-medium text-gray-700">{entry.name}</span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="text-xs text-gray-500">{entry.description}</span>
                    </Table.Cell>
                  </Table.Row>
                ))
              ) : (
                <Table.Row id="empty">
                  <Table.Cell>
                    <span className="text-xs text-gray-400">未找到匹配的知识条目</span>
                  </Table.Cell>
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

export default DatabaseView
