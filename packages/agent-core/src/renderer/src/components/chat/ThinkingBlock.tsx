import React from 'react'
import { Button } from '@heroui/react'

/** 思考过程 - 默认折叠，展开后灰色文字 */
const ThinkingBlock: React.FC<{ content: string }> = ({ content }) => {
  const [expanded, setExpanded] = React.useState(false)

  if (!content) return null

  return (
    <div className="mb-2">
      <Button
        size="sm"
        variant="ghost"
        className="h-auto min-w-0 justify-start px-0 py-0 text-xs text-muted"
        onPress={() => setExpanded(!expanded)}
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="font-medium">Thought</span>
        {!expanded && <span className="ml-1 max-w-[300px] truncate text-muted/70">{content.slice(0, 60)}{content.length > 60 ? '...' : ''}</span>}
      </Button>

      {expanded && (
        <div className="ml-4 mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-muted">
          {content}
        </div>
      )}
    </div>
  )
}

export default ThinkingBlock
