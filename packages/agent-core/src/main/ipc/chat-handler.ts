import { ipcMain } from 'electron'

export function registerChatHandlers(): void {
  // 发送对话消息（非流式）
  ipcMain.handle('chat:send', async (_event, { workspaceId, message }) => {
    // TODO: V7 阶段3 接入 V5 提示词系统 + V6 ModelRouter + V4 Pipeline
    console.log(`[chat:send] workspace=${workspaceId}, message=${message}`)
    return {
      id: crypto.randomUUID(),
      content: `[模拟回复] 已收到消息：${message.substring(0, 50)}...`
    }
  })

  // 流式对话
  ipcMain.handle('chat:stream', async (event, { workspaceId, message }) => {
    console.log(`[chat:stream] workspace=${workspaceId}, message=${message}`)

    // 模拟流式输出
    const chunks = [
      { content: '这是', thinking: '我在思考如何回答...' },
      { content: '一条', toolCalls: [{ id: '1', name: 'get_player_position', category: '感知', params: {}, status: 'running' as const }] },
      { content: '模拟的', toolCalls: [{ id: '1', name: 'get_player_position', category: '感知', params: {}, status: 'success' as const, result: { success: true, data: { x: 100, y: 64, z: 200 }, duration_ms: 15 } }] },
      { content: '流式回复。' }
    ]

    for (let i = 0; i < chunks.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 200))
      event.sender.send('chat:stream:chunk', {
        id: crypto.randomUUID(),
        ...chunks[i],
        isLast: i === chunks.length - 1
      })
    }

    event.sender.send('chat:stream:done', {})
  })

  // 获取对话历史
  ipcMain.handle('chat:history', async (_event, { workspaceId, limit = 50 }) => {
    // TODO: 从 SQLite 加载历史消息
    console.log(`[chat:history] workspace=${workspaceId}, limit=${limit}`)
    return []
  })
}