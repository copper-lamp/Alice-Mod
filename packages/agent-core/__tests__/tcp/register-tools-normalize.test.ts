/**
 * B4 回归测试：normalizeToolSchema 兼容 JE 端 input_schema 格式
 *
 * 对应 Bug：JE 端 SchemaGenerator 输出 {name, description, category, input_schema, ...}
 * 而 AC 端 ToolSchema 契约要求 {name, description, parameters, category, enabled}，
 * 导致 prompt 中缺少参数定义。
 *
 * 修复：在 AC 端 handleTcpNotification 接收 register_tools 时做归一化，
 * 识别 input_schema / parameters / function.parameters 三种来源。
 */

import { describe, it, expect } from 'vitest'
import { normalizeToolSchema } from '../../src/main/tool-schema'

describe('B4 回归: normalizeToolSchema 兼容 JE input_schema', () => {
  it('JE 格式 input_schema 应转换为 parameters（type/description/required）', () => {
    const jeRaw = {
      name: 'bot_spawn',
      description: '创建假人',
      category: '',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '假人名' },
          x: { type: 'number', description: 'X' },
          y: { type: 'number', description: 'Y' },
          z: { type: 'number', description: 'Z' },
        },
        required: ['name', 'x', 'y', 'z'],
      },
    }
    const r = normalizeToolSchema(jeRaw)
    expect(r.name).toBe('bot_spawn')
    expect(r.parameters).toBeDefined()
    expect(r.parameters.name.type).toBe('string')
    expect(r.parameters.name.required).toBe(true)
    expect(r.parameters.x.required).toBe(true)
    expect(r.parameters.y.required).toBe(true)
    expect(r.parameters.z.required).toBe(true)
    // category 缺失时按 bot_* 前缀推断
    expect(r.category).toBe('entity')
  })

  it('BE 格式 parameters 应直接保留', () => {
    const beRaw = {
      name: 'move_to',
      description: '移动',
      category: 'movement',
      parameters: {
        x: { type: 'number', description: 'X', required: true },
        y: { type: 'number', description: 'Y', required: true },
        z: { type: 'number', description: 'Z', required: true },
      },
    }
    const r = normalizeToolSchema(beRaw)
    expect(r.parameters.x.required).toBe(true)
    expect(r.category).toBe('movement')
  })

  it('category 缺失时按工具名前缀推断', () => {
    expect(normalizeToolSchema({ name: 'move_to', description: '' }).category).toBe('movement')
    expect(normalizeToolSchema({ name: 'look_around', description: '' }).category).toBe('perception')
    expect(normalizeToolSchema({ name: 'mine_block', description: '' }).category).toBe('block')
    expect(normalizeToolSchema({ name: 'craft_item', description: '' }).category).toBe('survival')
    expect(normalizeToolSchema({ name: 'chat_say', description: '' }).category).toBe('chat')
    expect(normalizeToolSchema({ name: 'task_create', description: '' }).category).toBe('task')
    expect(normalizeToolSchema({ name: 'memory_query', description: '' }).category).toBe('memory')
    expect(normalizeToolSchema({ name: 'unknown_xyz', description: '' }).category).toBe('task')
  })

  it('function.parameters 嵌套格式应兼容', () => {
    const r = normalizeToolSchema({
      name: 'foo',
      description: '...',
      function: {
        name: 'foo',
        description: '...',
        parameters: {
          type: 'object',
          properties: { a: { type: 'string' } },
          required: ['a'],
        },
      },
    })
    expect(r.parameters.a.type).toBe('string')
    expect(r.parameters.a.required).toBe(true)
  })
})