/**
 * B1 回归测试：ToolDispatcher.callTool 的 method 必须为 'tool_call'
 *
 * 对应 Bug：AC 端误写 method='call_tool'，与 JE 端 METHOD_TOOL_CALL = "tool_call" 不匹配，
 * 导致所有 AC→JE 工具调用返回 Method Not Found。
 *
 * 修复：tool-dispatcher.ts:179 将 'call_tool' 改为 'tool_call'
 *
 * 测试策略：直接验证 tool-dispatcher.ts 中 callTool 方法构造的 JSON-RPC 请求
 * method 字段为 'tool_call'，而非 'call_tool'。
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('B1 回归: ToolDispatcher.callTool 的 method 必须为 tool_call', () => {
  const sourcePath = path.resolve(__dirname, '../../src/main/pipeline/tool-dispatcher.ts')
  const source = fs.readFileSync(sourcePath, 'utf-8')

  it('callTool 方法中 method 字段为 tool_call（不是 call_tool）', () => {
    // 找到 callTool 方法中的 method 定义
    const methodLines = source
      .split('\n')
      .filter((line) => line.includes("method:"))
      .map((l) => l.trim())

    // 找到 callTool 相关的 method 赋值
    const callToolMethod = methodLines.find(
      (line) => line.includes("'tool_call'") || line.includes("'call_tool'")
    )

    expect(callToolMethod).toBeDefined()
    expect(callToolMethod).toContain("'tool_call'")
    expect(callToolMethod).not.toContain("'call_tool'")
  })

  it('源代码中不存在 call_tool 作为 method 的赋值（排除 executeBatch 中的 method）', () => {
    // 检查 callTool 方法内的 method 定义
    const callToolSection = source.split('async callTool(')[1]
    expect(callToolSection).toBeDefined()

    // 在 callTool 方法范围内查找 method 定义
    const methodDef = callToolSection.split('\n').find(
      (line) => line.includes('method:') && (line.includes("'tool_call'") || line.includes("'call_tool'"))
    )
    expect(methodDef).toBeDefined()
    expect(methodDef).toContain("'tool_call'")
    expect(methodDef).not.toContain("'call_tool'")
  })
})