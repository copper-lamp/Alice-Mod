import React from 'react'
import CustomTitleBar from './CustomTitleBar'
import LeftSidebar from './LeftSidebar'
import StatusBar from './StatusBar'
import { useUIStore } from '../../stores/uiStore'
import { useConfigStore } from '../../stores/configStore'

const AppLayout: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const layoutMode = useUIStore(s => s.layoutMode)
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
      </div>
      <StatusBar />
    </div>
  )
}

export default AppLayout