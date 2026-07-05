import React from 'react'
import CustomTitleBar from './CustomTitleBar'
import LeftSidebar from './LeftSidebar'
import RightSidebar from './RightSidebar'
import StatusBar from './StatusBar'
import { useUIStore } from '../../stores/uiStore'
import { useConfigStore } from '../../stores/configStore'

const AppLayout: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const showRightSidebar = useUIStore(s => s.showRightSidebar)
  const layoutMode = useUIStore(s => s.layoutMode)
  const openConfigPanel = useConfigStore(s => s.openConfigPanel)

  return (
    <div className="flex flex-col h-screen w-screen bg-gray-100 text-gray-700 overflow-hidden">
      <CustomTitleBar onConfigOpen={openConfigPanel} />
      <div className="flex flex-1 overflow-hidden">
        <LeftSidebar />
        <main className={`flex-1 flex flex-col overflow-hidden ${layoutMode === 'nav-view' ? 'p-4' : ''}`}>
          {children}
        </main>
        {showRightSidebar && <RightSidebar />}
      </div>
      <StatusBar />
    </div>
  )
}

export default AppLayout