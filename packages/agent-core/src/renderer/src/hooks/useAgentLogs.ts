import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { chatApi } from '../lib/ipc'
import type { AgentLogSource, AgentLogType, ChatMessage } from '../lib/types'
import type { StreamEvent } from '../stores/chatStore'

const PAGE_SIZE = 50

function mergeMessages(...groups: ChatMessage[][]): ChatMessage[] {
  const messages = new Map<string, ChatMessage>()
  for (const group of groups) {
    for (const message of group) messages.set(`${message.source ?? 'unknown'}:${message.id}`, message)
  }
  return [...messages.values()].sort((a, b) => a.timestamp - b.timestamp)
}

function matchesType(message: ChatMessage, type: AgentLogType): boolean {
  if (type === 'all') return true
  if (type === 'system') return message.role === 'system'
  if (type === 'tool') return message.role === 'tool' || Boolean(message.toolCalls?.length)
  return message.role === 'user' || message.role === 'assistant'
}

export function useAgentLogs(agentId: string, workspaceId: string, source: AgentLogSource, type: AgentLogType) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streamingEvents, setStreamingEvents] = useState<StreamEvent[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const requestRef = useRef(0)

  const load = useCallback(async (showLoading = false) => {
    if (!agentId) return
    const request = ++requestRef.current
    if (showLoading) setLoading(true)
    else setRefreshing(true)
    try {
      const gamePromise = source === 'qq'
        ? Promise.resolve([] as ChatMessage[])
        : chatApi.history(workspaceId, { agentId, limit, source: source === 'game' ? 'game' : undefined })
      const qqPromise = source === 'game'
        ? Promise.resolve([] as ChatMessage[])
        : chatApi.qqHistory(workspaceId, agentId, limit)
      const [game, qq] = await Promise.all([gamePromise, qqPromise])
      if (request !== requestRef.current) return
      setMessages(mergeMessages(game, qq))
      setError(null)
    } catch (reason) {
      if (request !== requestRef.current) return
      setError(reason instanceof Error ? reason.message : '加载运行日志失败')
    } finally {
      if (request === requestRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [agentId, workspaceId, source, limit])

  useEffect(() => {
    requestRef.current += 1
    setMessages([])
    setStreamingEvents([])
    setIsStreaming(false)
    setStreamError(null)
    setLimit(PAGE_SIZE)
  }, [agentId, workspaceId, source])

  useEffect(() => {
    void load(true)
  }, [load])

  useEffect(() => {
    const interval = setInterval(() => {
      if (!isStreaming) void load(false)
    }, 5000)
    return () => clearInterval(interval)
  }, [isStreaming, load])

  useEffect(() => chatApi.onStreamEvent(event => {
    if (event.agentId !== agentId) return
    if (event.type === 'done') {
      setIsStreaming(false)
      setStreamingEvents([])
      const data = event.data as { error?: string } | undefined
      setStreamError(data?.error ?? null)
      void load(false)
      return
    }
    setIsStreaming(true)
    setStreamError(null)
    if (source === 'all') {
      const streamEvent: StreamEvent = {
        type: event.type as StreamEvent['type'],
        data: event.data as StreamEvent['data'],
      }
      setStreamingEvents(previous => [...previous, streamEvent])
    }
  }), [agentId, source, load])

  const loadEarlier = useCallback(() => setLimit(value => value + PAGE_SIZE), [])

  const clearQQHistory = useCallback(async () => {
    setClearing(true)
    try {
      await chatApi.clearQQHistory(workspaceId, agentId)
      await load(false)
    } finally {
      setClearing(false)
    }
  }, [workspaceId, agentId, load])

  const visibleMessages = useMemo(
    () => messages.filter(message => matchesType(message, type)),
    [messages, type],
  )

  return {
    messages: visibleMessages,
    streamingEvents: source === 'all' ? streamingEvents : [],
    isStreaming,
    loading,
    refreshing,
    clearing,
    error,
    streamError,
    hasMessages: messages.length > 0,
    refresh: () => load(false),
    retry: () => load(true),
    loadEarlier,
    clearQQHistory,
  }
}
