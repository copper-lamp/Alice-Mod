import type { ToolCallInfo } from '../lib/types'
import { useChatStore } from '../stores/useChatStore'

/**
 * 模拟流式响应生成器
 * 按时间顺序追加事件，工具调用出现在发起位置
 */
export async function simulateMockStream(userMessage: string): Promise<void> {
  const store = useChatStore.getState()
  const { addMessage, startStream, appendStreamEvent, finishStream } = store

  // 1. 添加用户消息（模拟来自游戏内聊天）
  addMessage({
    id: crypto.randomUUID(),
    role: 'user',
    content: userMessage,
    source: 'game',
    timestamp: Date.now(),
    workspaceId: 'mock'
  })

  // 2. 开始流式 assistant 回复
  const streamId = crypto.randomUUID()
  startStream(streamId)

  const delay = (ms: number) => new Promise(r => setTimeout(r, ms))
  const tool1Id = crypto.randomUUID()
  const tool2Id = crypto.randomUUID()
  const tool3Id = crypto.randomUUID()

  try {
    // ===== 思考 =====
    appendStreamEvent({ type: 'thinking', data: '好的，我需要先获取玩家的位置信息，然后查询周围的方块和环境状态。让我逐步执行。' })
    await delay(600)

    // ===== 文本 =====
    appendStreamEvent({ type: 'text', data: '好的，让我先看看你的位置。' })
    await delay(400)

    // ===== 工具调用: get_player_position (running) =====
    appendStreamEvent({
      type: 'tool_calls',
      data: [
        { id: tool1Id, name: 'get_player_position', category: '感知', params: {}, status: 'running' } as ToolCallInfo
      ]
    })
    await delay(800)

    // ===== 工具调用: get_player_position (success) =====
    appendStreamEvent({
      type: 'tool_calls',
      data: [
        {
          id: tool1Id, name: 'get_player_position', category: '感知', params: {},
          status: 'success',
          result: { success: true, data: { x: 103, y: 64, z: -215, dimension: 'overworld' }, duration_ms: 12 }
        } as ToolCallInfo
      ]
    })
    await delay(300)

    // ===== 文本 =====
    appendStreamEvent({ type: 'text', data: '你现在位于坐标 (103, 64, -215) 的主世界。\n\n让我进一步查询周围的环境。' })
    await delay(500)

    // ===== 工具调用: query_nearby_blocks (running) =====
    appendStreamEvent({
      type: 'tool_calls',
      data: [
        { id: tool2Id, name: 'query_nearby_blocks', category: '感知', params: { radius: 10, x: 103, z: -215 }, status: 'running' } as ToolCallInfo
      ]
    })
    await delay(1000)

    // ===== 工具调用: query_nearby_blocks (success) =====
    appendStreamEvent({
      type: 'tool_calls',
      data: [
        {
          id: tool2Id, name: 'query_nearby_blocks', category: '感知', params: { radius: 10, x: 103, z: -215 },
          status: 'success',
          result: {
            success: true,
            data: {
              blocks: [
                { name: '橡树原木', count: 5, distance: 3 },
                { name: '橡树树叶', count: 12, distance: 3 },
                { name: '石头', count: 8, distance: 5 },
                { name: '煤矿', count: 3, distance: 7 },
                { name: '草方块', count: 20, distance: 1 }
              ]
            },
            duration_ms: 25
          }
        } as ToolCallInfo
      ]
    })
    await delay(300)

    // ===== 文本 =====
    appendStreamEvent({ type: 'text', data: '我周围的环境如下：\n• 附近有 5 棵橡树，距离约 3 格\n• 地表主要是草方块和石头\n• 在 7 格外发现了一些煤矿（3 个）\n\n这是一个不错的开局位置，有木材和煤炭资源。' })
    await delay(600)

    // ===== 工具调用: check_time (running) =====
    appendStreamEvent({
      type: 'tool_calls',
      data: [
        { id: tool3Id, name: 'check_time', category: '感知', params: {}, status: 'running' } as ToolCallInfo
      ]
    })
    await delay(600)

    // ===== 工具调用: check_time (success) =====
    appendStreamEvent({
      type: 'tool_calls',
      data: [
        {
          id: tool3Id, name: 'check_time', category: '感知', params: {},
          status: 'success',
          result: { success: true, data: { time: 1200, time_of_day: '中午', day: 3 }, duration_ms: 8 }
        } as ToolCallInfo
      ]
    })
    await delay(200)

    // ===== 最终文本 =====
    appendStreamEvent({ type: 'text', data: '当前时间是游戏内第 3 天的中午，光线充足，适合探索和采集。\n建议你可以先砍一些橡树获取木材，然后去挖掘那些煤矿。\n需要我帮你做什么吗？' })

    // ===== 完成 =====
    await delay(500)
    finishStream()

  } catch (err) {
    console.error('Mock stream error:', err)
    finishStream()
  }
}

/** 预置测试消息列表 */
export const MOCK_TEST_MESSAGES = [
  '帮我看看周围有什么资源',
  '现在是什么时间？我该做什么？',
  '检查一下我的状态',
  '帮我去附近探索一下'
]