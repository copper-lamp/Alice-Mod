import React from 'react'

const StatusBar: React.FC = () => {
  return (
    <footer className="h-6 flex items-center justify-between px-3 bg-gray-100 text-[11px] text-gray-400">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
          TCP 未连接
        </span>
        <span className="text-gray-300">|</span>
        <span>工作区: 0</span>
      </div>
      <div className="flex items-center gap-3">
        <span>v1.0.0</span>
        <span className="text-gray-300">|</span>
        <span>Alice Mod Core</span>
      </div>
    </footer>
  )
}

export default StatusBar