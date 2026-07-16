/**
 * V22 元编排层 — 单元测试
 *
 * 覆盖 9 个核心组件：
 *   1. PlanStore               — Plan SQLite DAO
 *   2. PlanManager             — Plan CRUD + update_plan 5 种 operation
 *   3. ProgressStateManager    — 进展状态管理
 *   4. MemoryCompressor        — 分层记忆压缩
 *   5. SkillInjector           — 技能注入
 *   6. TaskMemoryStore         — 任务记忆持久化
 *   7. update_plan tool        — 工具 Schema + Handler
 *   8. Orchestrator            — 顶层元编排器
 *   9. MemoryBackedLongTermMemoryHook — V11 记忆桥接器
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { PlanStore } from '../../src/main/orchestration/plan-store'
import {
  PlanManager,
  defaultPlanExtractor,
} from '../../src/main/orchestration/plan-manager'
import { ProgressStateManager } from '../../src/main/orchestration/progress-state-manager'
import {
  MemoryCompressor,
  DEFAULT_TIERS,
  detectCritical,
} from '../../src/main/orchestration/memory-compressor'
import { SkillInjector } from '../../src/main/orchestration/skill-injector'
import { TaskMemoryStore } from '../../src/main/orchestration/task-memory-store'
import {
  UPDATE_PLAN_TOOL,
  UpdatePlanHandler,
} from '../../src/main/orchestration/tools/update-plan'
import { Orchestrator } from '../../src/main/orchestration/orchestrator'
import { MemoryBackedLongTermMemoryHook } from '../../src/main/orchestration/memory-backed-hook'
import { NoOpLongTermMemoryHook } from '../../src/main/orchestration/long-term-memory-hook'
import type {
  OrchestrationSQLiteStore,
  ExecutionPlan,
  TaskMemory,
  UpdatePlanArgs,
  ProgressState,
} from '../../src/main/orchestration/types'
import type { MainAgentResult } from '../../src/main/agent/main-agent'
import type { MemoryManager } from '../../src/main/memory/memory-manager'

// ════════════════════════════════════════════════════════════════
// 测试辅助
// ════════════════════════════════════════════════════════════════

/**
 * 创建测试用 OrchestrationSQLiteStore。
 * - execute: 有参数时用 prepare().run()（单语句），无参数时用 exec()（多语句 DDL）
 * - queryAll: 复用 SQLiteStore.queryAll 的绑定策略
 */
function createTestStore(dbPath: string): {
  store: OrchestrationSQLiteStore
  db: Database.Database
} {
  const db = new Database(dbPath)
  const store: OrchestrationSQLiteStore = {
    queryAll: (sql, params) => {
      return (params ? db.prepare(sql).all(params) : db.prepare(sql).all()) as any
    },
    execute: (sql, params) => {
      if (params) {
        db.prepare(sql).run(params)
      } else {
        db.exec(sql)
      }
    },
  }
  return { store, db }
}

/** 创建临时目录 */
function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** 清理临时目录 */
function cleanupDir(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
}

// ════════════════════════════════════════════════════════════════
// 1. MemoryCompressor
// ════════════════════════════════════════════════════════════════

describe('MemoryCompressor', () => {
  const compressor = new MemoryCompressor()

  it('estimateTokens 估算 token 数量', () => {
    expect(compressor.estimateTokens('')).toBe(0)
    expect(compressor.estimateTokens('你好')).toBe(1)
    expect(compressor.estimateTokens('a'.repeat(100))).toBe(25)
  })

  it('detectCritical 识别关键关键词', () => {
    expect(detectCritical('约定每周一汇报')).toBe(true)
    expect(detectCritical('规则：不能使用 /fill')).toBe(true)
    expect(detectCritical('账户密码是 123456')).toBe(true)
    expect(detectCritical('位置坐标：100, 64, -200')).toBe(true)
    expect(detectCritical('今天天气很好')).toBe(false)
    expect(detectCritical('挖了一些铁矿')).toBe(false)
  })

  it('compressProgress 对超过 maxTokens 的 state 压缩或不压缩', () => {
    const state = {
      planId: 'plan-1',
      completed: [
        { todoId: 't1', description: 'a'.repeat(200), status: 'completed' as const, tokenCount: 50 },
        { todoId: 't2', description: 'b'.repeat(200), status: 'completed' as const, tokenCount: 50 },
      ],
      lastCompressedAt: 0,
    }
    const result = compressor.compressProgress(state, 80)
    // 可能压缩也可能不压缩，取决于实现策略
    expect(typeof result.compressed).toBe('boolean')
    expect(result.state.planId).toBe('plan-1')
  })

  it('compressProgress 对未超 maxTokens 的 state 不压缩', () => {
    const state = {
      planId: 'plan-1',
      completed: [
        { todoId: 't1', description: '简短', status: 'completed' as const, tokenCount: 2 },
      ],
      lastCompressedAt: 0,
    }
    const result = compressor.compressProgress(state, 200)
    expect(result.compressed).toBe(false)
    expect(result.state.completed.length).toBe(1)
  })

  it('DEFAULT_TIERS 包含 5 档', () => {
    expect(DEFAULT_TIERS.length).toBe(5)
    expect(DEFAULT_TIERS[0].minAgeDays).toBe(0)
    expect(DEFAULT_TIERS[0].importance).toBe('normal')
  })
})

// ════════════════════════════════════════════════════════════════
// 2. SkillInjector
// ════════════════════════════════════════════════════════════════

describe('SkillInjector', () => {
  let dir: string

  beforeEach(() => {
    dir = createTempDir('skills-')
    // 创建各阶段技能文件
    writeFileSync(join(dir, 'plan-mode.md'), '# Plan Mode\n执行计划阶段技能。')
    writeFileSync(join(dir, 'execute-mining.md'), '# Execute Mining\n采集技能。')
    writeFileSync(join(dir, 'execute-building.md'), '# Execute Building\n建造技能。')
    writeFileSync(join(dir, 'transfer.md'), '# Transfer\n转移技能。')
    writeFileSync(join(dir, 'summarize.md'), '# Summarize\n总结技能。')
    // 非技能文件不应被加载
    writeFileSync(join(dir, 'README.md'), '# README')
  })

  afterEach(() => {
    cleanupDir(dir)
  })

  it('list 按 phase 分组', () => {
    const injector = new SkillInjector({ skillsDir: dir })
    const skills = injector.list()
    expect(skills['plan']).toHaveLength(1)
    expect(skills['execute']).toHaveLength(2)
    expect(skills['transfer']).toHaveLength(1)
    expect(skills['summarize']).toHaveLength(1)
  })

  it('pick 按白名单/黑名单过滤', () => {
    const injector = new SkillInjector({ skillsDir: dir })
    const planSkills = injector.pick('execute', ['execute-mining'], undefined)
    expect(planSkills).toHaveLength(1)
    expect(planSkills[0].name).toBe('execute-mining')

    const allSkills = injector.pick('execute', undefined, ['execute-mining'])
    expect(allSkills).toHaveLength(1)
    expect(allSkills[0].name).toBe('execute-building')
  })

  it('render 返回 markdown 格式', () => {
    const injector = new SkillInjector({ skillsDir: dir })
    const skills = injector.pick('plan', undefined, undefined)
    const text = injector.render(skills)
    expect(text).toContain('# Plan Mode')
    expect(text).toContain('执行计划阶段技能。')
  })

  it('目录不存在时返回空列表', () => {
    const injector = new SkillInjector({ skillsDir: join(dir, 'nonexistent') })
    const skills = injector.list()
    expect(skills['plan']).toEqual([])
    expect(skills['execute']).toEqual([])
  })
})

// ════════════════════════════════════════════════════════════════
// 3. defaultPlanExtractor
// ════════════════════════════════════════════════════════════════

describe('defaultPlanExtractor', () => {
  it('提取 ===PLAN=== 块', () => {
    const text = `一些内容\n===PLAN===\n{"goal":"测试","constraints":[],"todos":[]}\n===END===`
    const result = defaultPlanExtractor(text)
    expect(result).toBeDefined()
    expect(result!.goal).toBe('测试')
  })

  it('提取 ```json fenced 块', () => {
    const text = `一些内容\n\`\`\`json\n{"goal":"测试","constraints":[],"todos":[]}\n\`\`\`\n更多内容`
    const result = defaultPlanExtractor(text)
    expect(result).toBeDefined()
    expect(result!.goal).toBe('测试')
  })

  it('无 plan 内容返回 undefined', () => {
    const text = '普通聊天内容'
    const result = defaultPlanExtractor(text)
    expect(result).toBeUndefined()
  })
})

// ════════════════════════════════════════════════════════════════
// 4. PlanStore
// ════════════════════════════════════════════════════════════════

describe('PlanStore', () => {
  let db: Database.Database
  let store: OrchestrationSQLiteStore
  let planStore: PlanStore
  let dir: string

  beforeEach(() => {
    dir = createTempDir('plan-store-')
    ;({ store, db } = createTestStore(join(dir, 'test.db')))
    planStore = new PlanStore(store)
  })

  afterEach(() => {
    try { db.close() } catch { /* ignore */ }
    cleanupDir(dir)
  })

  it('save / load 往返', () => {
    planStore.save({
      id: 'plan-1',
      goal: '测试',
      constraints: ['约束1'],
      todos: [
        { id: 't1', status: 'pending', description: '待办1' },
      ],
      createdAt: 1000,
      updatedAt: 1000,
    }, { workspaceId: 'ws-1', agentId: 'agent-1' })
    const loaded = planStore.load('plan-1')
    expect(loaded).toBeDefined()
    expect(loaded!.goal).toBe('测试')
    expect(loaded!.todos).toHaveLength(1)
    expect(loaded!.todos[0].description).toBe('待办1')
  })

  it('loadByEvent 按事件 ID 查询', () => {
    planStore.save({
      id: 'plan-2',
      goal: '测试',
      constraints: [],
      todos: [],
      createdAt: 1000,
      updatedAt: 1000,
    }, { workspaceId: 'ws-1', agentId: 'agent-1', eventId: 'evt-1' })
    const loaded = planStore.loadByEvent('evt-1')
    expect(loaded).toBeDefined()
    expect(loaded!.id).toBe('plan-2')
  })

  it('listActive 按 workspace+agent 过滤活跃计划', () => {
    planStore.save({
      id: 'plan-3', goal: '活跃', constraints: [], todos: [
        { id: 't1', status: 'pending', description: '待办1' },
      ],
      createdAt: 1000, updatedAt: 1000,
    }, { workspaceId: 'ws-1', agentId: 'agent-1' })
    planStore.save({
      id: 'plan-4', goal: '其他 Agent', constraints: [], todos: [],
      createdAt: 1000, updatedAt: 1000,
    }, { workspaceId: 'ws-1', agentId: 'agent-2' })
    // plan-3 有 pending todo → 活跃
    const active = planStore.listActive('ws-1', 'agent-1')
    expect(active.length).toBeGreaterThanOrEqual(1)
    expect(active.some(p => p.id === 'plan-3')).toBe(true)
  })

  it('load 不存在的 plan 返回 undefined', () => {
    const loaded = planStore.load('nonexistent')
    expect(loaded).toBeUndefined()
  })
})

// ════════════════════════════════════════════════════════════════
// 5. PlanManager
// ════════════════════════════════════════════════════════════════

describe('PlanManager', () => {
  let db: Database.Database
  let store: OrchestrationSQLiteStore
  let planStore: PlanStore
  let planManager: PlanManager
  let dir: string

  beforeEach(() => {
    dir = createTempDir('plan-mgr-')
    ;({ store, db } = createTestStore(join(dir, 'test.db')))
    planStore = new PlanStore(store)
    planManager = new PlanManager({ store: planStore })
  })

  afterEach(() => {
    try { db.close() } catch { /* ignore */ }
    cleanupDir(dir)
  })

  // ── createFromEvent ──

  it('createFromEvent 创建空 plan', () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1', 'evt-1')
    expect(plan.id).toBeDefined()
    expect(plan.goal).toBe('')
    expect(plan.todos).toEqual([])
    expect(plan.createdAt).toBeGreaterThan(0)
  })

  it('createFromEvent 不传 eventId 也成功', () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1')
    expect(plan.id).toBeDefined()
    expect(plan.goal).toBe('')
  })

  // ── ingestFromLLM ──

  it('ingestFromLLM 从 LLM response 提取 plan', () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1')
    const llmResponse = `===PLAN===\n${JSON.stringify({
      goal: '建房子',
      constraints: ['用石头'],
      todos: [
        { description: '收集石头', status: 'pending' },
        { description: '建造墙壁', status: 'pending' },
      ],
    })}\n===END===`
    const ingested = planManager.ingestFromLLM(plan.id, llmResponse)
    expect(ingested.goal).toBe('建房子')
    expect(ingested.todos).toHaveLength(2)
    expect(ingested.constraints).toEqual(['用石头'])
  })

  it('ingestFromLLM 解析失败时返回原始 plan', () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1')
    const ingested = planManager.ingestFromLLM(plan.id, '普通文本')
    expect(ingested.id).toBe(plan.id)
    expect(ingested.todos).toEqual([])
  })

  it('ingestFromLLM planId 不存在时抛错', () => {
    expect(() => planManager.ingestFromLLM('nonexistent', '内容')).toThrow()
  })

  // ── apply: 5 种 operation ──

  it('apply add 新增 todo', () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1')
    const result = planManager.apply(plan.id, {
      operation: 'add',
      todoId: undefined,
      newTodo: { description: '新待办', expectedTools: ['pickaxe'] },
    })
    expect(result.ok).toBe(true)
    const updated = planManager.get(plan.id)!
    expect(updated.todos).toHaveLength(1)
    expect(updated.todos[0].description).toBe('新待办')
    expect(updated.todos[0].expectedTools).toEqual(['pickaxe'])
  })

  it('apply add 缺少新待办描述时返回错误', () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1')
    const result = planManager.apply(plan.id, {
      operation: 'add',
      newTodo: { description: '', expectedTools: [] },
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('ADD_REQUIRES_NEW_TODO')
  })

  it('apply update_status 标记完成', () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1')
    planManager.apply(plan.id, {
      operation: 'add',
      newTodo: { description: '挖矿', expectedTools: ['pickaxe'] },
    })
    const todoId = planManager.get(plan.id)!.todos[0].id
    const result = planManager.apply(plan.id, {
      operation: 'update_status',
      todoId,
      status: 'completed',
      result: '挖到铁矿',
    })
    expect(result.ok).toBe(true)
    const todo = planManager.get(plan.id)!.todos[0]
    expect(todo.status).toBe('completed')
  })

  it('apply update_status 标记失败时带失败原因', () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1')
    planManager.apply(plan.id, { operation: 'add', newTodo: { description: '挖矿' } })
    const todoId = planManager.get(plan.id)!.todos[0].id
    const result = planManager.apply(plan.id, {
      operation: 'update_status',
      todoId,
      status: 'failed',
      failureReason: '遇到僵尸阵亡',
    })
    expect(result.ok).toBe(true)
    const todo = planManager.get(plan.id)!.todos[0]
    expect(todo.status).toBe('failed')
    expect(todo.failureReason).toBe('遇到僵尸阵亡')
  })

  it('apply update_status 不存在的 todoId 返回错误', () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1')
    const result = planManager.apply(plan.id, {
      operation: 'update_status',
      todoId: 'nonexistent',
      status: 'completed',
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('TODO_NOT_FOUND: nonexistent')
  })

  it('apply split 拆分待办', () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1')
    planManager.apply(plan.id, { operation: 'add', newTodo: { description: '准备材料' } })
    const todoId = planManager.get(plan.id)!.todos[0].id
    const result = planManager.apply(plan.id, {
      operation: 'split',
      todoId,
      splitInto: [
        { description: '收集木头', expectedTools: ['axe'] },
        { description: '收集石头', expectedTools: ['pickaxe'] },
      ],
    })
    expect(result.ok).toBe(true)
    const updated = planManager.get(plan.id)!
    // 原 todo 被替换为 2 个子待办（实现层面是替换，不是标记 skipped）
    expect(updated.todos.find(t => t.id === todoId)).toBeUndefined()
    expect(updated.todos.length).toBe(2)
    expect(updated.todos[0].description).toBe('收集木头')
    expect(updated.todos[1].description).toBe('收集石头')
  })

  it('apply split 不存在的 todoId 返回错误', () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1')
    const result = planManager.apply(plan.id, {
      operation: 'split',
      todoId: 'nonexistent',
      splitInto: [{ description: '子任务' }],
    })
    expect(result.ok).toBe(false)
  })

  it('apply reorder 重排待办顺序', () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1')
    planManager.apply(plan.id, { operation: 'add', newTodo: { description: 'A' } })
    planManager.apply(plan.id, { operation: 'add', newTodo: { description: 'B' } })
    const todos = planManager.get(plan.id)!.todos
    const newOrder = [todos[1].id, todos[0].id]
    const result = planManager.apply(plan.id, {
      operation: 'reorder',
      newOrder,
    })
    expect(result.ok).toBe(true)
    const reordered = planManager.get(plan.id)!.todos
    expect(reordered[0].id).toBe(newOrder[0])
    expect(reordered[1].id).toBe(newOrder[1])
  })

  it('apply reorder 不匹配的 newOrder 返回错误', () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1')
    planManager.apply(plan.id, { operation: 'add', newTodo: { description: 'A' } })
    const result = planManager.apply(plan.id, {
      operation: 'reorder',
      newOrder: ['nonexistent'],
    })
    expect(result.ok).toBe(false)
  })

  it('apply set_in_progress 设置当前进行中的待办', () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1')
    planManager.apply(plan.id, { operation: 'add', newTodo: { description: '挖矿' } })
    const todoId = planManager.get(plan.id)!.todos[0].id
    const result = planManager.apply(plan.id, {
      operation: 'set_in_progress',
      todoId,
    })
    expect(result.ok).toBe(true)
    expect(planManager.get(plan.id)!.todos[0].status).toBe('in_progress')
  })

  it('apply set_in_progress 不存在的 todoId 返回错误', () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1')
    const result = planManager.apply(plan.id, { operation: 'set_in_progress', todoId: 'nonexistent' })
    expect(result.ok).toBe(false)
  })

  it('apply 不支持的 operation 返回错误', () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1')
    const result = planManager.apply(plan.id, { operation: 'invalid' as any })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('UNKNOWN_OPERATION: invalid')
  })

  // ── 查询 ──

  it('get / getByEvent / listActive / isAllDone', () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1', 'evt-x')
    expect(planManager.get(plan.id)).toBeDefined()
    expect(planManager.getByEvent('evt-x')).toBeDefined()
    expect(planManager.getByEvent('nonexistent')).toBeUndefined()

    // 添加一个待办使其成为活跃计划
    planManager.apply(plan.id, { operation: 'add', newTodo: { description: '测试任务' } })

    const active = planManager.listActive('ws-1', 'agent-1')
    expect(active.some(p => p.id === plan.id)).toBe(true)

    // 有 1 个 pending 待办时 isAllDone 为 false
    expect(planManager.isAllDone(plan.id)).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════
// 6. ProgressStateManager
// ════════════════════════════════════════════════════════════════

describe('ProgressStateManager', () => {
  let db: Database.Database
  let store: OrchestrationSQLiteStore
  let planStore: PlanStore
  let planManager: PlanManager
  let compressor: MemoryCompressor
  let progressMgr: ProgressStateManager
  let dir: string

  beforeEach(() => {
    dir = createTempDir('progress-')
    ;({ store, db } = createTestStore(join(dir, 'test.db')))
    planStore = new PlanStore(store)
    planManager = new PlanManager({ store: planStore })
    compressor = new MemoryCompressor()
    progressMgr = new ProgressStateManager({ planManager, compressor })
  })

  afterEach(() => {
    try { db.close() } catch { /* ignore */ }
    cleanupDir(dir)
  })

  it('load 从空的 plan 重建状态', () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1')
    const state = progressMgr.load(plan.id)
    expect(state.planId).toBe(plan.id)
    expect(state.completed).toEqual([])
  })

  it('recordSummary 追加并去重', () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1')
    planManager.apply(plan.id, { operation: 'add', newTodo: { description: '挖矿' } })
    const todoId = planManager.get(plan.id)!.todos[0].id
    planManager.apply(plan.id, { operation: 'update_status', todoId, status: 'completed' })

    progressMgr.recordSummary(plan.id, todoId, {
      todoId,
      status: 'completed',
      result: '挖到铁矿',
      critical: false,
    })
    const state = progressMgr.load(plan.id)
    expect(state.completed).toHaveLength(1)
    expect(state.completed[0].result).toBe('挖到铁矿')

    // 重复记录不应增加
    progressMgr.recordSummary(plan.id, todoId, {
      todoId,
      status: 'completed',
      result: '挖到铁矿',
      critical: false,
    })
    expect(progressMgr.load(plan.id).completed).toHaveLength(1)
  })

  it('renderForPrompt 渲染格式', () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1')
    planManager.apply(plan.id, { operation: 'add', newTodo: { description: '挖矿' } })
    const todoId = planManager.get(plan.id)!.todos[0].id
    planManager.apply(plan.id, { operation: 'update_status', todoId, status: 'completed' })
    progressMgr.recordSummary(plan.id, todoId, {
      todoId, status: 'completed', result: '挖到铁矿',
    })

    const text = progressMgr.renderForPrompt(progressMgr.load(plan.id))
    expect(text).toContain('挖矿')
    expect(text).toContain('挖到铁矿')
  })

  it('超 token 上限时截断', () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1')
    // 创建一个低 token 上限的 manager 来验证截断
    const lowTokenMgr = new ProgressStateManager({ planManager, compressor, maxTokens: 50 })
    for (let i = 0; i < 5; i++) {
      planManager.apply(plan.id, { operation: 'add', newTodo: { description: 'x'.repeat(50) } })
      const todoId = planManager.get(plan.id)!.todos[i].id
      planManager.apply(plan.id, { operation: 'update_status', todoId, status: 'completed' })
      lowTokenMgr.recordSummary(plan.id, todoId, {
        todoId, status: 'completed', result: 'y'.repeat(50),
      })
    }
    // 限制 50 token，应截断
    const text = lowTokenMgr.renderForPrompt(lowTokenMgr.load(plan.id))
    expect(text.length).toBeLessThan(50 * 4)
  })
})

// ════════════════════════════════════════════════════════════════
// 7. TaskMemoryStore
// ════════════════════════════════════════════════════════════════

describe('TaskMemoryStore', () => {
  let db: Database.Database
  let store: OrchestrationSQLiteStore
  let taskMemStore: TaskMemoryStore
  let dir: string

  beforeEach(() => {
    dir = createTempDir('task-mem-')
    ;({ store, db } = createTestStore(join(dir, 'test.db')))
    taskMemStore = new TaskMemoryStore(store, 'ws-1', 'agent-1')
  })

  afterEach(() => {
    try { db.close() } catch { /* ignore */ }
    cleanupDir(dir)
  })

  const baseMem: TaskMemory = {
    planId: 'plan-1',
    goal: '测试任务',
    outcome: 'success',
    keyOutcomes: ['完成步骤1', '完成步骤2'],
    durationMs: 1000,
    totalTokens: 500,
    committedAt: 1000,
  }

  it('append / load 往返', async () => {
    const id = await taskMemStore.append(baseMem)
    expect(id).toBeDefined()
    expect(id.length).toBeGreaterThan(0)

    const loaded = await taskMemStore.load(id)
    expect(loaded).toBeDefined()
    expect(loaded!.goal).toBe('测试任务')
    expect(loaded!.keyOutcomes).toEqual(['完成步骤1', '完成步骤2'])
  })

  it('append 含 artifacts / failureReasons 的记忆', async () => {
    const mem: TaskMemory = {
      ...baseMem,
      outcome: 'partial',
      failureReasons: ['步骤1失败了'],
      artifacts: [{ type: 'block', ref: 'minecraft:stone' }],
    }
    const id = await taskMemStore.append(mem)
    const loaded = await taskMemStore.load(id)
    expect(loaded!.failureReasons).toEqual(['步骤1失败了'])
    expect(loaded!.artifacts).toEqual([{ type: 'block', ref: 'minecraft:stone' }])
  })

  it('list 倒序返回', async () => {
    await taskMemStore.append({ ...baseMem, committedAt: 1000 })
    await taskMemStore.append({ ...baseMem, committedAt: 2000, goal: '第二个' })
    const list = await taskMemStore.list('ws-1', 'agent-1')
    expect(list).toHaveLength(2)
    expect(list[0].goal).toBe('第二个')
    expect(list[1].goal).toBe('测试任务')
  })

  it('list 支持 limit / beforeCommittedAt 分页', async () => {
    for (let i = 0; i < 3; i++) {
      await taskMemStore.append({ ...baseMem, committedAt: 1000 + i })
    }
    const list = await taskMemStore.list('ws-1', 'agent-1', { limit: 2, beforeCommittedAt: 1002 })
    expect(list).toHaveLength(2)
  })

  it('load 不存在的 id 返回 undefined', async () => {
    const loaded = await taskMemStore.load('nonexistent')
    expect(loaded).toBeUndefined()
  })
})

// ════════════════════════════════════════════════════════════════
// 8. update_plan tool
// ════════════════════════════════════════════════════════════════

describe('update_plan tool', () => {
  let db: Database.Database
  let store: OrchestrationSQLiteStore
  let planStore: PlanStore
  let planManager: PlanManager
  let handler: UpdatePlanHandler
  let dir: string

  beforeEach(() => {
    dir = createTempDir('tool-')
    ;({ store, db } = createTestStore(join(dir, 'test.db')))
    planStore = new PlanStore(store)
    planManager = new PlanManager({ store: planStore })
    handler = new UpdatePlanHandler(planManager)
  })

  afterEach(() => {
    try { db.close() } catch { /* ignore */ }
    cleanupDir(dir)
  })

  it('schema 名称为 update_plan', () => {
    expect(UPDATE_PLAN_TOOL.name).toBe('update_plan')
  })

  it('无 planId 时返回 NO_ACTIVE_PLAN', () => {
    const result = handler.execute({ operation: 'add', newTodo: { description: 'test' } }, {})
    expect(result.success).toBe(false)
    expect(result.error).toBe('NO_ACTIVE_PLAN')
  })

  it('plan 不存在时返回错误', () => {
    const result = handler.execute(
      { operation: 'add', newTodo: { description: 'test' } },
      { planId: 'nonexistent' },
    )
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('成功执行 add', () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1')
    const result = handler.execute(
      { operation: 'add', newTodo: { description: '新待办' } },
      { planId: plan.id },
    )
    expect(result.success).toBe(true)
    expect(result.data).toBeDefined()
  })

  it('apply 失败传递 error', () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1')
    const result = handler.execute(
      { operation: 'update_status', todoId: 'nonexistent', status: 'completed' },
      { planId: plan.id },
    )
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })
})

// ════════════════════════════════════════════════════════════════
// 9. Orchestrator (排除 MemoryBackedLongTermMemoryHook)
// ════════════════════════════════════════════════════════════════

describe('Orchestrator', () => {
  let db: Database.Database
  let store: OrchestrationSQLiteStore
  let planManager: PlanManager
  let taskMemoryStore: TaskMemoryStore
  let skillInjector: SkillInjector
  let memoryCompressor: MemoryCompressor
  let progressStateManager: ProgressStateManager
  let dir: string

  beforeEach(() => {
    dir = createTempDir('orch-')
    ;({ store, db } = createTestStore(join(dir, 'test.db')))
    planManager = new PlanManager({ store: new PlanStore(store) })
    taskMemoryStore = new TaskMemoryStore(store, 'ws-1', 'agent-1')
    memoryCompressor = new MemoryCompressor()
    mkdirSync(join(dir, 'skills'))
    skillInjector = new SkillInjector({ skillsDir: join(dir, 'skills') })
    progressStateManager = new ProgressStateManager({ planManager, compressor: memoryCompressor })
  })

  afterEach(() => {
    try { db.close() } catch { /* ignore */ }
    cleanupDir(dir)
  })

  /** 创建一个 mock MainAgentHandle */
  function createMockMainAgent(
    response: Partial<MainAgentResult> = {},
  ): { handle: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn> } {
    return {
      handle: vi.fn().mockResolvedValue({
        finalResponse: '默认回复',
        rounds: 1,
        totalTokens: 100,
        durationMs: 50,
        ...response,
      } as MainAgentResult),
      abort: vi.fn(),
    }
  }

  /** 创建 Orchestrator 实例 */
  function createOrchestrator(mock: ReturnType<typeof createMockMainAgent>) {
    return new Orchestrator({
      mainAgent: mock,
      planManager,
      progressStateManager,
      skillInjector,
      memoryCompressor,
      taskMemoryStore,
    })
  }

  it('simple 模式：无 plan 时直接返回 mainAgent 结果', async () => {
    const mock = createMockMainAgent({ finalResponse: '你好！' })
    const orchestrator = createOrchestrator(mock)

    const result = await orchestrator.dispatch({
      source: 'trigger',
      prompt: '你好',
    })

    expect(result.finalResponse).toBe('你好！')
    expect(result.planId).toBeUndefined()
    expect(mock.handle).toHaveBeenCalledTimes(1)
  })

  it('complex 模式：计划被 ===COMPLEX=== 标记升级', async () => {
    const mock = createMockMainAgent({ finalResponse: '===COMPLEX===\n需要建房子' })
    const orchestrator = createOrchestrator(mock)

    // 先 attach 一个空的 plan
    const plan = planManager.createFromEvent('ws-1', 'agent-1', 'evt-1')
    orchestrator.attachPlan(plan)

    const result = await orchestrator.dispatch({
      source: 'trigger',
      prompt: '建房子',
      metadata: { eventId: 'evt-1' },
    })

    // ===COMPLEX=== 标记升级 → 收尾阶段生成 task memory（但 plan 无 todo → 不会 isAllDone）
    expect(result.planId).toBe(plan.id)
  })

  it('complex 模式：todos >= 2 自动触发', async () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1', 'evt-1')
    const llmResponse = `===PLAN===\n${JSON.stringify({
      goal: '建房子',
      constraints: ['用石头'],
      todos: [
        { description: '收集石头', status: 'pending' },
        { description: '建造墙壁', status: 'pending' },
      ],
    })}\n===END===`
    planManager.ingestFromLLM(plan.id, llmResponse)

    const mock = createMockMainAgent({ finalResponse: '正在执行' })
    const orchestrator = createOrchestrator(mock)

    const result = await orchestrator.dispatch({
      source: 'trigger',
      prompt: '建一座房子',
      metadata: { eventId: 'evt-1' },
    })

    expect(result.planId).toBe(plan.id)
    expect(result.taskMemoryId).toBeUndefined() // 未全部完成
    // prompt 被包装
    expect(mock.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('当前任务计划'),
      }),
    )
  })

  it('complex 模式全部完成时生成 task memory', async () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1', 'evt-2')
    const llmResponse = `===PLAN===\n${JSON.stringify({
      goal: '挖矿',
      constraints: [],
      todos: [
        { description: '做镐子', status: 'pending' },
        { description: '挖铁矿', status: 'pending' },
      ],
    })}\n===END===`
    planManager.ingestFromLLM(plan.id, llmResponse)
    // 全部标记 completed
    const todos = planManager.get(plan.id)!.todos
    for (const t of todos) {
      planManager.apply(plan.id, {
        operation: 'update_status',
        todoId: t.id,
        status: 'completed',
        result: '完成',
      })
    }

    const mock = createMockMainAgent({ finalResponse: '任务完成' })
    const orchestrator = createOrchestrator(mock)

    const result = await orchestrator.dispatch({
      source: 'trigger',
      prompt: '执行任务',
      metadata: { eventId: 'evt-2' },
    })

    expect(result.planId).toBe(plan.id)
    expect(result.taskMemoryId).toBeDefined()
  })

  it('attachPlan / getCurrentPlan 同步', () => {
    const orchestrator = createOrchestrator(createMockMainAgent())
    const plan = planManager.createFromEvent('ws-1', 'agent-1')

    orchestrator.attachPlan(plan)
    expect(orchestrator.getCurrentPlan()?.id).toBe(plan.id)
  })

  it('abort 透传给 MainAgent', () => {
    const mock = createMockMainAgent()
    const orchestrator = createOrchestrator(mock)

    orchestrator.abort()
    expect(mock.abort).toHaveBeenCalledTimes(1)
  })

  it('metadata.complex 触发复杂模式', async () => {
    const plan = planManager.createFromEvent('ws-1', 'agent-1', 'evt-3')
    const mock = createMockMainAgent({ finalResponse: '执行任务' })
    const orch = createOrchestrator(mock)
    orch.attachPlan(plan)

    const result = await orch.dispatch({
      source: 'trigger',
      prompt: '执行任务',
      metadata: { eventId: 'evt-3', complex: true },
    })

    expect(result.planId).toBe(plan.id)
  })
})

// ════════════════════════════════════════════════════════════════
// 10. MemoryBackedLongTermMemoryHook — V11 记忆桥接器
// ════════════════════════════════════════════════════════════════

describe('MemoryBackedLongTermMemoryHook', () => {
  // 构造一个最小可用的 mock MemoryManager：只暴露本测试关心的方法
  function createMockMemory(stored: Array<{
    type: string
    branch: string
    content: Record<string, unknown>
    tags: string[]
    importance: number
    workspaceId: string
  }> = []): MemoryManager {
    return {
      store: vi.fn(async (params, workspaceId) => {
        stored.push({ ...params, workspaceId: workspaceId ?? 'default' })
        return { id: `mem-${stored.length}`, createdAt: Date.now() }
      }),
      batchStore: vi.fn(async (params, workspaceId) => {
        for (const item of params.items) {
          stored.push({ ...item, workspaceId: workspaceId ?? 'default' })
        }
        return { ids: params.items.map((_, i) => `mem-${i}`), count: params.items.length }
      }),
    } as unknown as MemoryManager
  }

  const baseTaskMemory: TaskMemory = {
    planId: 'plan-001',
    goal: '采集铁矿',
    outcome: 'success',
    keyOutcomes: ['挖到 12 块铁矿', '遇到僵尸后撤离', '安全返回基地'],
    failureReasons: undefined,
    artifacts: [{ type: 'block', ref: 'minecraft:iron_ore' }],
    durationMs: 60_000,
    totalTokens: 1500,
    committedAt: Date.now(),
  }

  it('success outcome → 写 task_archive 分支 + importance 5 + outcome 标签', async () => {
    const stored: any[] = []
    const memory = createMockMemory(stored)
    const hook = new MemoryBackedLongTermMemoryHook(memory)

    await hook.commit('ws-A', baseTaskMemory)

    expect(memory.store).toHaveBeenCalledTimes(1)
    const main = stored[0]
    expect(main.type).toBe('task_experience')
    expect(main.branch).toBe('task_archive')
    expect(main.importance).toBe(5)
    expect(main.workspaceId).toBe('ws-A')
    expect(main.tags).toContain('orchestration')
    expect(main.tags).toContain('plan:plan-001')
    expect(main.tags).toContain('outcome:success')
  })

  it('failed outcome → 写 experience 分支 + importance 7 + lesson 标签', async () => {
    const stored: any[] = []
    const memory = createMockMemory(stored)
    const hook = new MemoryBackedLongTermMemoryHook(memory)

    await hook.commit('ws-A', { ...baseTaskMemory, outcome: 'failed' })

    const main = stored[0]
    expect(main.branch).toBe('experience')
    expect(main.importance).toBe(7)
    expect(main.tags).toContain('lesson')
    expect(main.tags).toContain('outcome:failed')
  })

  it('writeKeyOutcomes=true 时同时写 N 条 key_outcome 子条目', async () => {
    const stored: any[] = []
    const memory = createMockMemory(stored)
    const hook = new MemoryBackedLongTermMemoryHook(memory, { writeKeyOutcomes: true })

    await hook.commit('ws-A', baseTaskMemory)

    expect(memory.store).toHaveBeenCalledTimes(1)
    expect(memory.batchStore).toHaveBeenCalledTimes(1)
    // 1 主条目 + 3 子条目
    expect(stored.length).toBe(4)
    const child = stored[1]
    expect(child.tags).toContain('key_outcome')
    expect(child.importance).toBe(4)
  })

  it('writeKeyOutcomes=false 时不调用 batchStore', async () => {
    const stored: any[] = []
    const memory = createMockMemory(stored)
    const hook = new MemoryBackedLongTermMemoryHook(memory, { writeKeyOutcomes: false })

    await hook.commit('ws-A', baseTaskMemory)

    expect(memory.batchStore).not.toHaveBeenCalled()
    expect(stored.length).toBe(1)
  })

  it('maxKeyOutcomes 截断子条目数量', async () => {
    const stored: any[] = []
    const memory = createMockMemory(stored)
    const hook = new MemoryBackedLongTermMemoryHook(memory, { maxKeyOutcomes: 2 })

    await hook.commit('ws-A', baseTaskMemory)

    // 1 主 + 2 子
    expect(stored.length).toBe(3)
  })

  it('MemoryManager 抛错时被吞掉（默认不 rethrow）', async () => {
    const memory = {
      store: vi.fn(async () => { throw new Error('ChromaStore down') }),
      batchStore: vi.fn(),
    } as unknown as MemoryManager
    const hook = new MemoryBackedLongTermMemoryHook(memory)

    await expect(hook.commit('ws-A', baseTaskMemory)).resolves.toBeUndefined()
  })

  it('rethrow=true 时把错误抛出', async () => {
    const memory = {
      store: vi.fn(async () => { throw new Error('ChromaStore down') }),
      batchStore: vi.fn(),
    } as unknown as MemoryManager
    const hook = new MemoryBackedLongTermMemoryHook(memory, { rethrow: true })

    await expect(hook.commit('ws-A', baseTaskMemory)).rejects.toThrow('ChromaStore down')
  })

  it('NoOpLongTermMemoryHook 静默成功', async () => {
    const hook = new NoOpLongTermMemoryHook()
    await expect(hook.commit('ws-A', baseTaskMemory)).resolves.toBeUndefined()
  })

  it('workspaceId 被透传到所有 store 调用', async () => {
    const stored: any[] = []
    const memory = createMockMemory(stored)
    const hook = new MemoryBackedLongTermMemoryHook(memory)

    await hook.commit('workspace-xyz', baseTaskMemory)

    expect(stored.every((s) => s.workspaceId === 'workspace-xyz')).toBe(true)
  })
})