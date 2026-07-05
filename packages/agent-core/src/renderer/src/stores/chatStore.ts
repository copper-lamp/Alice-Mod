import type { ChatMessage, ToolCallInfo } from '../lib/types'

/** 流式事件类型 */
export type StreamEventType = 'thinking' | 'text' | 'tool_calls'

/** 有序流式事件 */
export interface StreamEvent {
  type: StreamEventType
  data: string | ToolCallInfo[]
}

/** 对话状态 */
interface ChatState {
  messages: ChatMessage[]
  currentStreamingId: string | null
  streamingEvents: StreamEvent[]
  isStreaming: boolean
  error: string | null

  /* actions */
  addMessage: (msg: ChatMessage) => void
  updateMessage: (id: string, partial: Partial<ChatMessage>) => void
  startStream: (id: string) => void
  appendStreamEvent: (event: StreamEvent) => void
  finishStream: () => void
  clearChat: () => void
  setError: (err: string | null) => void
  stopStream: () => void
}

export type { ChatState }