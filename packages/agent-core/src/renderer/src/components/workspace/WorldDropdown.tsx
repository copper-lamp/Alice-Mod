import React from 'react'
import { Dropdown, Header, Separator } from '@heroui/react'
import { ChevronDown } from 'lucide-react'
import { useWorldStore } from '../../stores/worldStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'

const statusDotClass = (state: string) => {
  switch (state) {
    case 'online': return 'bg-green-400'
    case 'connecting': return 'bg-yellow-400'
    default: return 'bg-gray-400'
  }
}

const editionLabel: Record<string, string> = {
  bedrock: 'BE',
  java: 'JE',
}

const WorldDropdown: React.FC = () => {
  const {
    worlds,
    currentWorldId,
    setActiveWorld,
  } = useWorldStore()

  const currentWorkspaceId = useWorkspaceStore(s => s.currentWorkspaceId)
  const workspaces = useWorkspaceStore(s => s.workspaces)

  const currentWorkspace = workspaces.find(w => w.id === currentWorkspaceId)

  // 只在有工作区且世界数 > 1 时显示
  if (!currentWorkspaceId || worlds.length <= 1) {
    return null
  }

  const currentWorld = worlds.find(w => w.id === currentWorldId)

  return (
    <Dropdown>
      <Dropdown.Trigger>
        <div
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-200/60 cursor-pointer transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <span className={`w-2 h-2 rounded-full ${statusDotClass(currentWorld?.state ?? 'offline')}`} />
          <span>{currentWorld?.worldName || '未选择世界'}</span>
          <ChevronDown size={12} className="text-gray-400" />
        </div>
      </Dropdown.Trigger>

      <Dropdown.Popover className="min-w-[220px]">
        <Dropdown.Menu
          onAction={(key) => {
            const ks = key as string
            const world = worlds.find(w => w.id === ks)
            if (world) {
              setActiveWorld(currentWorkspaceId, world.worldName)
            }
          }}
        >
          <Header>世界 · {currentWorkspace?.name}</Header>
          <Separator />

          <Dropdown.Section>
            {worlds.map(world => (
              <Dropdown.Item
                key={world.id}
                id={world.id}
                textValue={world.worldName}
              >
                <div className="flex items-center gap-2 w-full">
                  <span className={`w-2 h-2 rounded-full ${statusDotClass(world.state)} flex-shrink-0`} />
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-xs font-medium text-gray-700 truncate">
                      {world.worldName}
                    </span>
                    <span className="text-[10px] text-gray-400 truncate leading-tight">
                      {editionLabel[world.edition] ?? world.edition} {world.gameVersion}
                    </span>
                  </div>
                  {world.botCount > 0 && (
                    <span className="text-[10px] text-gray-400 flex-shrink-0">
                      {world.botCount} 假人
                    </span>
                  )}
                </div>
              </Dropdown.Item>
            ))}
          </Dropdown.Section>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

export default WorldDropdown
