import React from 'react'

interface Props {
  onConfigOpen?: () => void
}

const CustomTitleBar: React.FC<Props> = ({ onConfigOpen }) => {

  return (
    <div
      className="flex items-center justify-between h-9 bg-gray-100 select-none px-2"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* 左侧：软件名称 + 工作实例选择 */}
      <div className="flex items-center gap-4" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <span className="text-sm font-semibold text-gray-700 ml-2 tracking-wide">Alice</span>
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-200/60 rounded-md text-xs text-gray-500 cursor-pointer hover:bg-gray-200 transition-colors">
          <ServerIcon />
          <span>BDS server 5C</span>
          <ChevronIcon />
        </div>
      </div>

      {/* 右侧：设置按钮 + 由 OS 渲染原生窗口控制按钮 */}
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

const ServerIcon: React.FC = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
    <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
    <line x1="6" y1="6" x2="6" y2="6" /><line x1="10" y1="6" x2="10" y2="6" />
    <line x1="6" y1="18" x2="6" y2="18" /><line x1="10" y1="18" x2="10" y2="18" />
  </svg>
)

const ChevronIcon: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

const SettingsIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

export default CustomTitleBar