import React from 'react'
import { Table, ProgressBar } from '@heroui/react'

interface ExploredArea {
  id: string
  name: string
  coordinateRange: string
  explorationPercent: number
  description: string
}

const MOCK_AREAS: ExploredArea[] = [
  { id: '1', name: '主世界 - 平原', coordinateRange: 'X: -200~200, Z: -200~200', explorationPercent: 92, description: '出生点周边平原区域，已基本探索完毕，有多处小型村庄和矿洞入口。' },
  { id: '2', name: '主世界 - 森林', coordinateRange: 'X: 200~500, Z: -100~300', explorationPercent: 65, description: '大型橡木森林，部分区域已标记，存在少量未探索洞穴。' },
  { id: '3', name: '下界', coordinateRange: 'X: -50~50, Z: -50~50', explorationPercent: 40, description: '下界堡垒附近区域，已发现部分堡垒遗迹，下界合金资源待开采。' },
  { id: '4', name: '主世界 - 沙漠', coordinateRange: 'X: -400~-100, Z: 100~400', explorationPercent: 25, description: '大型沙漠生物群系，发现了沙漠神殿，周边尚未详细勘察。' },
  { id: '5', name: '末地', coordinateRange: 'X: -20~20, Z: -20~20', explorationPercent: 15, description: '末地主岛已登录，末影龙已被击败，末地城和折跃门待探索。' }
]

const progressColor = (percent: number): 'success' | 'warning' | 'danger' => {
  if (percent >= 80) return 'success'
  if (percent >= 40) return 'warning'
  return 'danger'
}

const MapIndexView: React.FC = () => {
  return (
    <div>
      <h2 className="text-base font-semibold text-gray-700 mb-4">地图索引</h2>

      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="地图探索区域" className="min-w-[700px]">
            <Table.Header>
              <Table.Column isRowHeader>区域名称</Table.Column>
              <Table.Column>坐标范围</Table.Column>
              <Table.Column>探索度</Table.Column>
            </Table.Header>
            <Table.Body>
              {MOCK_AREAS.map(area => (
                <Table.Row key={area.id} id={area.id}>
                  <Table.Cell>
                    <span className="text-sm font-medium text-gray-700">{area.name}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="text-xs font-mono text-gray-500">{area.coordinateRange}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex items-center gap-3 max-w-[200px]">
                      <ProgressBar
                        value={area.explorationPercent}
                        color={progressColor(area.explorationPercent)}
                        size="sm"
                        className="flex-1"
                      >
                        <ProgressBar.Track>
                          <ProgressBar.Fill />
                        </ProgressBar.Track>
                      </ProgressBar>
                      <span className="text-xs font-mono text-gray-500 shrink-0">{area.explorationPercent}%</span>
                    </div>
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

export default MapIndexView
