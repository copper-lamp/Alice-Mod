/**
 * 执行器单元测试 — Simple / Composite / Loop / Conditional
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { SimpleTaskExecutor } from '../../src/main/task/executors/simple-executor'
import { CompositeTaskExecutor } from '../../src/main/task/executors/composite-executor'
import { LoopTaskExecutor } from '../../src/main/task/executors/loop-executor'
import { ConditionalTaskExecutor } from '../../src/main/task/executors/conditional-executor'
import type { Task, ExecutionContext } from '../../src/main/task/types'

function createMockContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    workspaceId: 'test-ws',
    callTool: overrides.callTool ?? (async () => ({ success: true, data: {} })),
    getSubTask: overrides.getSubTask ?? (async () => null),
    updateProgress: overrides.updateProgress ?? (async () => {}),
    log: overrides.log ?? (async () => {}),
    abortSignal: overrides.abortSignal,
  }
}

function createTestTask(overrides: Partial<Task> = {}): Task {
  const now = Math.floor(Date.now() / 1000)
  return {
    id: `task-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: 'test-ws',
    name: 'test',
    description: '',
    type: 'simple',
    status: 'pending',
    progress: 0,
    priority: 'normal',
    tags: [],
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('SimpleTaskExecutor', () => {
  let executor: SimpleTaskExecutor

  beforeEach(() => {
    executor = new SimpleTaskExecutor()
  })

  it('should execute a simple task successfully', async () => {
    const task = createTestTask({
      action: { toolName: 'mine_block', parameters: { target: 'diamond_ore' } },
    })
    const context = createMockContext({
      callTool: async () => ({ success: true, data: { blocks: 10 } }),
    })

    const result = await executor.execute(task, context)
    expect(result.success).toBe(true)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('should fail if no action specified', async () => {
    const task = createTestTask()
    const context = createMockContext()

    const result = await executor.execute(task, context)
    expect(result.success).toBe(false)
    expect(result.error).toContain('必须指定 action')
  })

  it('should fail if tool call throws', async () => {
    const task = createTestTask({
      action: { toolName: 'fail', parameters: {} },
    })
    const context = createMockContext({
      callTool: async () => { throw new Error('工具执行失败') },
    })

    const result = await executor.execute(task, context)
    expect(result.success).toBe(false)
    expect(result.error).toContain('工具调用失败')
  })

  it('should handle abort signal', async () => {
    const abortController = new AbortController()
    abortController.abort()

    const task = createTestTask({
      action: { toolName: 'test', parameters: {} },
    })
    const context = createMockContext({ abortSignal: abortController.signal })

    const result = await executor.execute(task, context)
    expect(result.success).toBe(false)
    expect(result.error).toContain('已中止')
  })

  it('should validate canExecute', async () => {
    const taskWithAction = createTestTask({ action: { toolName: 'test', parameters: {} } })
    const taskWithoutAction = createTestTask()

    expect((await executor.canExecute(taskWithAction)).ok).toBe(true)
    expect((await executor.canExecute(taskWithoutAction)).ok).toBe(false)
  })
})

describe('CompositeTaskExecutor', () => {
  let executor: CompositeTaskExecutor

  beforeEach(() => {
    executor = new CompositeTaskExecutor()
  })

  it('should fail if no subtaskIds', async () => {
    const task = createTestTask({ type: 'composite' })
    const context = createMockContext()

    const result = await executor.execute(task, context)
    expect(result.success).toBe(false)
    expect(result.error).toContain('必须指定 subtaskIds')
  })

  it('should handle empty subtaskIds', async () => {
    const task = createTestTask({ type: 'composite', subtaskIds: [] })
    const context = createMockContext()

    const result = await executor.execute(task, context)
    expect(result.success).toBe(false)
  })

  it('should handle missing sub tasks', async () => {
    const task = createTestTask({ type: 'composite', subtaskIds: ['sub1'] })
    const context = createMockContext({
      getSubTask: async () => null,
    })

    const result = await executor.execute(task, context)
    expect(result.success).toBe(false)
  })

  it('should validate canExecute', async () => {
    const taskWithSubs = createTestTask({ type: 'composite', subtaskIds: ['sub1'] })
    const taskWithoutSubs = createTestTask({ type: 'composite' })

    expect((await executor.canExecute(taskWithSubs)).ok).toBe(true)
    expect((await executor.canExecute(taskWithoutSubs)).ok).toBe(false)
  })
})

describe('LoopTaskExecutor', () => {
  let executor: LoopTaskExecutor

  beforeEach(() => {
    executor = new LoopTaskExecutor()
  })

  it('should fail if no loopConfig', async () => {
    const task = createTestTask({ type: 'loop' })
    const context = createMockContext()

    const result = await executor.execute(task, context)
    expect(result.success).toBe(false)
    expect(result.error).toContain('必须指定 loopConfig')
  })

  it('should fail if no action', async () => {
    const task = createTestTask({
      type: 'loop',
      loopConfig: { mode: 'count', count: 3, maxIterations: 100 },
    })
    const context = createMockContext()

    const result = await executor.execute(task, context)
    expect(result.success).toBe(false)
    expect(result.error).toContain('必须指定 action')
  })

  it('should execute count mode', async () => {
    let callCount = 0
    const task = createTestTask({
      type: 'loop',
      action: { toolName: 'test', parameters: {} },
      loopConfig: { mode: 'count', count: 3, maxIterations: 100 },
    })
    const context = createMockContext({
      callTool: async () => { callCount++; return { iterations: callCount } },
    })

    const result = await executor.execute(task, context)
    expect(result.success).toBe(true)
    expect(result.data.iterations).toBe(3)
    expect(callCount).toBe(3)
  })

  it('should stop at maxIterations', async () => {
    const task = createTestTask({
      type: 'loop',
      action: { toolName: 'test', parameters: {} },
      loopConfig: { mode: 'count', count: 10, maxIterations: 3 },
    })
    const context = createMockContext()

    const result = await executor.execute(task, context)
    expect(result.data.iterations).toBe(3)
  })

  it('should validate canExecute', async () => {
    const validTask = createTestTask({
      type: 'loop',
      action: { toolName: 'test', parameters: {} },
      loopConfig: { mode: 'count', count: 3, maxIterations: 100 },
    })
    const taskWithoutConfig = createTestTask({ type: 'loop' })
    const taskWithoutAction = createTestTask({
      type: 'loop',
      loopConfig: { mode: 'count', count: 3, maxIterations: 100 },
    })

    expect((await executor.canExecute(validTask)).ok).toBe(true)
    expect((await executor.canExecute(taskWithoutConfig)).ok).toBe(false)
    expect((await executor.canExecute(taskWithoutAction)).ok).toBe(false)
  })
})

describe('ConditionalTaskExecutor', () => {
  let executor: ConditionalTaskExecutor

  beforeEach(() => {
    executor = new ConditionalTaskExecutor()
  })

  it('should fail if no condition', async () => {
    const task = createTestTask({ type: 'conditional' })
    const context = createMockContext()

    const result = await executor.execute(task, context)
    expect(result.success).toBe(false)
    expect(result.error).toContain('必须指定 condition')
  })

  it('should fail if no action', async () => {
    const task = createTestTask({
      type: 'conditional',
      condition: { type: 'time', value: Date.now() + 1000 },
    })
    const context = createMockContext()

    const result = await executor.execute(task, context)
    expect(result.success).toBe(false)
    expect(result.error).toContain('必须指定 action')
  })

  it('should execute when time condition is met', async () => {
    const task = createTestTask({
      type: 'conditional',
      action: { toolName: 'test', parameters: {} },
      condition: { type: 'time', value: Date.now() - 1000 }, // 过去的时间
    })
    const context = createMockContext()

    const result = await executor.execute(task, context)
    expect(result.success).toBe(true)
  })

  it('should validate canExecute', async () => {
    const validTask = createTestTask({
      type: 'conditional',
      action: { toolName: 'test', parameters: {} },
      condition: { type: 'time', value: Date.now() + 1000 },
    })
    const taskWithoutCondition = createTestTask({ type: 'conditional' })
    const taskWithoutAction = createTestTask({
      type: 'conditional',
      condition: { type: 'time', value: Date.now() + 1000 },
    })

    expect((await executor.canExecute(validTask)).ok).toBe(true)
    expect((await executor.canExecute(taskWithoutCondition)).ok).toBe(false)
    expect((await executor.canExecute(taskWithoutAction)).ok).toBe(false)
  })
})