import React from 'react'
import WorkspaceDropdown from '../workspace/WorkspaceDropdown'
import WorldDropdown from '../workspace/WorldDropdown'

interface Props {
  onConfigOpen?: () => void
}

const CustomTitleBar: React.FC<Props> = ({ onConfigOpen }) => {

  return (
    <div
      className="flex items-center justify-between h-9 bg-gray-100 select-none px-2"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* 左侧：Alice + 工作区选择器 + 世界选择器 */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-700 ml-1 tracking-wide">Alice</span>
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <WorkspaceDropdown />
        </div>
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <WorldDropdown />
        </div>
      </div>

      {/* 中间：留空（拖拽区域） */}
      <div className="flex-1" />

      {/* 右侧：设置按钮 */}
      <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          onClick={onConfigOpen}
          className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-200/60 transition-colors"
          title="设置"
        >
          <SettingsIcon />
        </button>
      </div>
    </div>
  )
}

const SettingsIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

export default CustomTitleBar
