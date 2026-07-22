import React from 'react'

/** 思考过程 - 默认折叠，展开后灰色文字 */
const ThinkingBlock: React.FC<{ content: string }> = ({ content }) => {
  const [expanded, setExpanded] = React.useState(false)

  if (!content) return null

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="group flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="font-medium">Thought</span>
        {!expanded && <span className="text-gray-300 ml-1 truncate max-w-[300px]">{content.slice(0, 60)}{content.length > 60 ? '...' : ''}</span>}
      </button>

      {expanded && (
        <div className="mt-1.5 ml-4 text-xs text-gray-500 whitespace-pre-wrap leading-relaxed">
          {content}
        </div>
      )}
    </div>
  )
}

export default ThinkingBlock
