import React from 'react'
import CustomTitleBar from './CustomTitleBar'
import LeftSidebar from './LeftSidebar'
import RightSidebar from './RightSidebar'
import StatusBar from './StatusBar'
import { useUIStore } from '../../stores/uiStore'
import { useConfigStore } from '../../stores/configStore'

const AppLayout: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const layoutMode = useUIStore(s => s.layoutMode)
  const showRightSidebar = layoutMode === 'agent-view'
  const openConfigPanel = useConfigStore(s => s.openConfigPanel)

  return (
    <div className="flex flex-col h-screen w-screen bg-gray-100 text-gray-700 overflow-hidden">
      <CustomTitleBar onConfigOpen={openConfigPanel} />
      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
        <LeftSidebar />
        <main
          className={`flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden transition-all duration-300 ease-in-out ${
            layoutMode === 'nav-view' ? 'p-4' : 'p-0'
          }`}
        >
          {children}
        </main>
        <aside
          className={`flex flex-col min-h-0 min-w-0 overflow-hidden bg-gray-100 border-l border-gray-200 transition-all duration-300 ease-in-out ${
            showRightSidebar ? 'w-72 opacity-100' : 'w-0 opacity-0 border-l-0'
          }`}
        >
          <div className="w-72 h-full flex-shrink-0 overflow-hidden">
            <RightSidebar />
          </div>
        </aside>
      </div>
      <StatusBar />
    </div>
  )
}

export default AppLayout