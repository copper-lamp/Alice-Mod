import { create } from 'zustand'
import type { ChatMessage, ToolCallInfo } from '../lib/types'
import type { ChatState, StreamEvent } from './chatStore'

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  currentStreamingId: null,
  streamingEvents: [],
  isStreaming: false,
  error: null,

  addMessage: msg =>
    set(s => ({ messages: [...s.messages, msg] })),

  updateMessage: (id, partial) =>
    set(s => ({
      messages: s.messages.map(m => (m.id === id ? { ...m, ...partial } : m))
    })),

  startStream: id =>
    set({
      currentStreamingId: id,
      streamingEvents: [],
      isStreaming: true,
      error: null
    }),

  appendStreamEvent: (event: StreamEvent) =>
    set(s => ({ streamingEvents: [...s.streamingEvents, event] })),

  finishStream: () => {
    const { currentStreamingId, streamingEvents } = get()
    if (currentStreamingId) {
      // 从有序事件中提取最终数据
      let content = ''
      let thinking = ''
      const toolCalls: ToolCallInfo[] = []

      for (const evt of streamingEvents) {
        if (evt.type === 'text') content += evt.data as string
        else if (evt.type === 'thinking') thinking += evt.data as string
        else if (evt.type === 'tool_calls') {
          const calls = evt.data as ToolCallInfo[]
          for (const c of calls) {
            const existing = toolCalls.find(t => t.id === c.id)
            if (existing) Object.assign(existing, c)
            else toolCalls.push(c)
          }
        }
      }

      const msg: ChatMessage = {
        id: currentStreamingId,
        role: 'assistant',
        content,
        thinking: thinking || undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        timestamp: Date.now(),
        workspaceId: ''
      }
      set(s => ({
        messages: [...s.messages, msg],
        currentStreamingId: null,
        streamingEvents: [],
        isStreaming: false
      }))
    }
  },

  clearChat: () =>
    set({
      messages: [],
      currentStreamingId: null,
      streamingEvents: [],
      isStreaming: false,
      error: null
    }),

  setError: err => set({ error: err }),

  stopStream: () => {
    if (get().isStreaming) {
      set({
        currentStreamingId: null,
        streamingEvents: [],
        isStreaming: false
      })
    }
  }
}))