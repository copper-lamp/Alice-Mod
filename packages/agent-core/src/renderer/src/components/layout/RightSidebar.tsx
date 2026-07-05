import React from 'react'

const RightSidebar: React.FC = () => {
  return (
    <aside className="w-72 flex flex-col bg-gray-100">
      <div className="p-4">
        <h3 className="text-xs text-gray-400 font-medium mb-2">上下文窗口</h3>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full" style={{ width: '45%' }} />
          </div>
          <span className="text-xs text-gray-500 font-mono">45%</span>
        </div>
        <div className="mt-1 text-xs text-gray-400">1,843 / 4,096 tokens</div>
      </div>

      <div className="px-4 pb-4">
        <h3 className="text-xs text-gray-400 font-medium mb-2">用量监控</h3>
        <div className="mb-2">
          <div className="flex justify-between text-xs text-gray-500 mb-0.5">
            <span>今日用量</span>
            <span className="font-mono">12,847</span>
          </div>
          <div className="flex justify-between text-xs text-gray-500">
            <span>本月用量</span>
            <span className="font-mono">284,193</span>
          </div>
        </div>
        <UsageChart />
      </div>

      <div className="flex-1 px-4">
        <h3 className="text-xs text-gray-400 font-medium mb-2">待办事项</h3>
        <div className="space-y-1.5">
          <TodoItem label="待集统计" completed={false} />
          <TodoItem label="预编译项" completed={false} />
          <TodoItem label="配置 Provider" completed={true} />
        </div>
      </div>
    </aside>
  )
}

const UsageChart: React.FC = () => {
  const days = ['一', '二', '三', '四', '五', '六', '日']
  const heights = [40, 65, 30, 80, 55, 45, 70]
  return (
    <div className="flex items-end gap-1.5 h-10">
      {days.map((day, i) => (
        <div key={day} className="flex-1 flex flex-col items-center gap-0.5">
          <div className="w-full bg-blue-500/20 rounded-t" style={{ height: `${heights[i]}%` }} />
          <span className="text-[10px] text-gray-400">{day}</span>
        </div>
      ))}
    </div>
  )
}

const TodoItem: React.FC<{ label: string; completed: boolean }> = ({ label, completed }) => (
  <div className="flex items-center gap-2 text-xs">
    <span className={`w-3 h-3 rounded border flex items-center justify-center ${completed ? 'bg-green-400 border-green-400' : 'border-gray-300'}`}>
      {completed && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
    </span>
    <span className={completed ? 'text-gray-400 line-through' : 'text-gray-500'}>{label}</span>
  </div>
)

export default RightSidebar