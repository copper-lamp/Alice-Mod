// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import '../../__tests__/renderer-setup'

import MessageBubble from '../../src/renderer/src/components/chat/MessageBubble'
import MessageList from '../../src/renderer/src/components/chat/MessageList'
import ThinkingBlock from '../../src/renderer/src/components/chat/ThinkingBlock'
import ToolCallCard from '../../src/renderer/src/components/chat/ToolCallCard'
import ToolCallList from '../../src/renderer/src/components/chat/ToolCallList'

// 模拟 crypto.randomUUID
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => 'test-uuid' },
    writable: true
  })
}

describe('MessageBubble', () => {
  it('渲染用户消息 - 右侧蓝色气泡，带来源标签', () => {
    render(
      <MessageBubble
        message={{
          id: '1',
          role: 'user',
          content: '帮我看看周围有什么',
          source: 'game',
          timestamp: Date.now(),
          workspaceId: 'ws1'
        }}
      />
    )
    expect(screen.getByText('帮我看看周围有什么')).toBeInTheDocument()
    expect(screen.getByText('来自游戏')).toBeInTheDocument()
    // 外层容器 justify-end 表示在右侧
    const container = screen.getByText('帮我看看周围有什么').closest('.flex')
    expect(container?.className).toContain('justify-end')
  })

  it('渲染用户消息 - 来自 QQ 时显示对应标签', () => {
    render(
      <MessageBubble
        message={{
          id: '1',
          role: 'user',
          content: 'QQ 消息测试',
          source: 'qq',
          timestamp: Date.now(),
          workspaceId: 'ws1'
        }}
      />
    )
    expect(screen.getByText('来自 QQ')).toBeInTheDocument()
  })

  it('渲染 assistant 消息 - 纯文本，无卡片样式', () => {
    render(
      <MessageBubble
        message={{
          id: '2',
          role: 'assistant',
          content: '你周围有一些树木和石头。',
          timestamp: Date.now(),
          workspaceId: 'ws1'
        }}
      />
    )
    const text = screen.getByText('你周围有一些树木和石头。')
    expect(text).toBeInTheDocument()
    // assistant 消息应该直接是 p 标签，没有外层卡片容器
    expect(text.tagName).toBe('P')
  })

  it('助理消息显示时间戳', () => {
    render(
      <MessageBubble
        message={{
          id: '2',
          role: 'assistant',
          content: '回复内容',
          timestamp: 1700000000000,
          workspaceId: 'ws1'
        }}
      />
    )
    expect(screen.getByText(/\d{2}:\d{2}/)).toBeInTheDocument()
  })

  it('显示思考过程和工具调用', () => {
    render(
      <MessageBubble
        message={{
          id: '3',
          role: 'assistant',
          content: '正在查询周围环境...',
          thinking: '我需要先获取玩家的位置，然后查询附近的方块。',
          toolCalls: [
            { id: 't1', name: 'get_position', category: '感知', params: {}, status: 'success', result: { success: true, data: { x: 100, y: 64, z: 200 }, duration_ms: 15 } }
          ],
          timestamp: Date.now(),
          workspaceId: 'ws1'
        }}
      />
    )
    expect(screen.getByText('思考过程')).toBeInTheDocument()
    expect(screen.getByText('get_position')).toBeInTheDocument()
  })

  it('系统消息居中灰色显示', () => {
    render(
      <MessageBubble
        message={{
          id: '5',
          role: 'system',
          content: '系统提示信息',
          timestamp: Date.now(),
          workspaceId: 'ws1'
        }}
      />
    )
    const text = screen.getByText('系统提示信息')
    expect(text).toBeInTheDocument()
    const container = text.closest('.flex')
    expect(container?.className).toContain('justify-center')
  })
})

describe('MessageList', () => {
  const sampleMessages = [
    { id: '1', role: 'user' as const, content: '你好', timestamp: Date.now(), workspaceId: 'ws1', source: 'game' as const },
    { id: '2', role: 'assistant' as const, content: '你好！有什么我可以帮你的？', timestamp: Date.now(), workspaceId: 'ws1' }
  ]

  it('有消息时渲染消息列表', () => {
    render(<MessageList messages={sampleMessages} isStreaming={false} />)
    expect(screen.getByText('你好')).toBeInTheDocument()
    expect(screen.getByText('你好！有什么我可以帮你的？')).toBeInTheDocument()
  })

  it('无消息且非流式时显示空状态提示', () => {
    render(<MessageList messages={[]} isStreaming={false} />)
    expect(screen.getByText('LLM 对话面板')).toBeInTheDocument()
    expect(screen.getByText('等待玩家通过游戏或 QQ 发起对话')).toBeInTheDocument()
  })

  it('流式输出中显示闪烁光标', () => {
    render(<MessageList messages={[]} isStreaming={true} streamingEvents={[{ type: 'text' as const, data: '正在生成' }]} />)
    expect(screen.getByText('正在生成')).toBeInTheDocument()
  })
})

describe('ThinkingBlock', () => {
  it('空内容不渲染', () => {
    const { container } = render(<ThinkingBlock content="" />)
    expect(container.innerHTML).toBe('')
  })

  it('点击展开/折叠思考内容', async () => {
    render(<ThinkingBlock content="这是一段思考过程" />)
    const toggle = screen.getByText('思考过程')
    expect(toggle).toBeInTheDocument()

    expect(screen.queryByText('这是一段思考过程')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.getByText('这是一段思考过程')).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.queryByText('这是一段思考过程')).not.toBeInTheDocument()
  })
})

describe('ToolCallCard', () => {
  it('渲染工具调用卡片 - 成功状态', () => {
    render(
      <ToolCallCard
        call={{
          id: 't1',
          name: 'get_player_position',
          category: '感知',
          params: {},
          status: 'success',
          result: { success: true, data: { x: 100, y: 64, z: 200 }, duration_ms: 15 }
        }}
      />
    )
    expect(screen.getByText('get_player_position')).toBeInTheDocument()
    expect(screen.getByText('(感知)')).toBeInTheDocument()
    expect(screen.getByText('15ms')).toBeInTheDocument()
  })

  it('渲染工具调用卡片 - 运行中状态', () => {
    render(
      <ToolCallCard
        call={{
          id: 't2',
          name: 'get_blocks',
          category: '感知',
          params: {},
          status: 'running'
        }}
      />
    )
    expect(screen.getByText('执行中')).toBeInTheDocument()
  })
})

describe('ToolCallList', () => {
  it('空列表不渲染', () => {
    const { container } = render(<ToolCallList calls={[]} />)
    expect(container.innerHTML).toBe('')
  })

  it('显示工具调用统计', () => {
    render(
      <ToolCallList
        calls={[
          { id: 't1', name: 'tool_a', category: '动作', params: {}, status: 'success', result: { success: true, duration_ms: 10 } },
          { id: 't2', name: 'tool_b', category: '动作', params: {}, status: 'running' },
          { id: 't3', name: 'tool_c', category: '感知', params: {}, status: 'error' }
        ]}
      />
    )
    expect(screen.getByText('工具调用 (1/3)')).toBeInTheDocument()
    expect(screen.getByText('tool_a')).toBeInTheDocument()
    expect(screen.getByText('tool_b')).toBeInTheDocument()
    expect(screen.getByText('tool_c')).toBeInTheDocument()
  })
})

describe('对话流整体渲染', () => {
  it('消息列表按类型渲染：用户右侧蓝色气泡，AI 纯文本，系统居中', () => {
    const messages = [
      { id: '1', role: 'user' as const, content: '第一个问题', timestamp: 1000, workspaceId: 'ws1', source: 'game' as const },
      { id: '2', role: 'assistant' as const, content: '第一个回答', timestamp: 2000, workspaceId: 'ws1' },
      { id: '3', role: 'system' as const, content: '系统提示', timestamp: 2500, workspaceId: 'ws1' },
      { id: '4', role: 'user' as const, content: '第二个问题', timestamp: 3000, workspaceId: 'ws1', source: 'qq' as const },
      { id: '5', role: 'assistant' as const, content: '第二个回答', timestamp: 4000, workspaceId: 'ws1' }
    ]

    render(<MessageList messages={messages} isStreaming={false} />)

    // 所有消息都渲染
    expect(screen.getByText('第一个问题')).toBeInTheDocument()
    expect(screen.getByText('第一个回答')).toBeInTheDocument()
    expect(screen.getByText('系统提示')).toBeInTheDocument()
    expect(screen.getByText('第二个问题')).toBeInTheDocument()
    expect(screen.getByText('第二个回答')).toBeInTheDocument()

    // 用户消息在右侧（justify-end）
    const firstUser = screen.getByText('第一个问题').closest('.flex')
    expect(firstUser?.className).toContain('justify-end')

    // 系统消息居中
    const sysMsg = screen.getByText('系统提示').closest('.flex')
    expect(sysMsg?.className).toContain('justify-center')

    // AI 消息是纯文本 p 标签
    const firstAi = screen.getByText('第一个回答')
    expect(firstAi.tagName).toBe('P')

    // 来源标签
    expect(screen.getByText('来自游戏')).toBeInTheDocument()
    expect(screen.getByText('来自 QQ')).toBeInTheDocument()
  })

  it('流式输出按事件顺序渲染思考 → 工具调用 → 内容 → 光标', () => {
    render(
      <MessageList
        messages={[]}
        isStreaming={true}
        streamingEvents={[
          { type: 'thinking', data: '思考中...' },
          { type: 'tool_calls', data: [{ id: 't1', name: 'query_data', category: '感知', params: {}, status: 'running' }] },
          { type: 'text', data: '正在生成回复' }
        ]}
      />
    )

    expect(screen.getByText('思考过程')).toBeInTheDocument()
    expect(screen.getByText('query_data')).toBeInTheDocument()
    expect(screen.getByText('正在生成回复')).toBeInTheDocument()
    const cursor = document.querySelector('.animate-pulse')
    expect(cursor).toBeInTheDocument()
  })
})