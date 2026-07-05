import React from 'react'

/** 思考过程可视化 */
const ThinkingBlock: React.FC<{ content: string }> = ({ content }) => {
  const [expanded, setExpanded] = React.useState(false)

  if (!content) return null

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span>思考过程</span>
      </button>

      {expanded && (
        <div className="mt-1 ml-4 p-2.5 bg-gray-50 rounded-md border border-gray-100">
          <p className="text-xs text-gray-500 whitespace-pre-wrap leading-relaxed">{content}</p>
        </div>
      )}
    </div>
  )
}

export default ThinkingBlock