import { useChatStore } from '../stores/useChatStore'

export function useChat() {
  const store = useChatStore()

  /** 发送对话消息（真实 IPC 路径） */
  const sendMessage = async (workspaceId: string, text: string) => {
    if (!text.trim()) return

    const { addMessage, startStream, appendStreamEvent, finishStream, setError } = store

    addMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      workspaceId
    })

    const streamId = crypto.randomUUID()
    startStream(streamId)

    try {
      const unsub = window.electronAPI.on('chat:stream:chunk', (chunk: any) => {
        if (chunk.thinking) appendStreamEvent({ type: 'thinking', data: chunk.thinking })
        if (chunk.content) appendStreamEvent({ type: 'text', data: chunk.content })
        if (chunk.toolCalls) appendStreamEvent({ type: 'tool_calls', data: chunk.toolCalls })
      })

      const unsubDone = window.electronAPI.on('chat:stream:done', () => {
        finishStream()
        unsub()
        unsubDone()
      })

      await window.electronAPI.invoke('chat:stream', { workspaceId, message: text })
    } catch (err: any) {
      setError(err.message || '发送失败')
      finishStream()
    }
  }

  return {
    messages: store.messages,
    isStreaming: store.isStreaming,
    streamingEvents: store.streamingEvents,
    error: store.error,
    sendMessage,
    clearChat: store.clearChat,
    stopStream: store.stopStream
  }
}