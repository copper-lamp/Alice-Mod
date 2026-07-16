# Alice Mod Core V22 — LLM 工作流编排新架构

> 版本：v1.0
> 日期：2026-07-16
> 版本号：V22
> 适用范围：Agent Core（agent-core）所有 LLM 调度入口。
> 关联文档：
>
> - [AC-V20-主链路组装-设计文档.md](AC-V20-主链路组装-设计文档.md)（V22 是其上的元编排层）
> - [AC-V20-实施-执行文档.md](AC-V20-实施-执行文档.md)
> - [AC-V14-事件触发器与QQ完善-架构文档.md](AC-V14-事件触发器与QQ完善-架构文档.md)
> - [AC-V13-任务系统.md](AC-V13-任务系统.md)
> - [AC-V11-记忆系统v1.md](AC-V11-记忆系统v1.md) / [AC-V12-记忆系统v2-地图索引.md](AC-V12-记忆系统v2-地图索引.md)

---

## 第1章 背景

### 1.1 V20 之后的真实痛点

V20 已把"触发 → LLM → 工具 → 历史"的主链路打通，但在实际执行长任务（多工具、多轮、需要回滚、跨 trigger 复用）时暴露出三类问题：

| 痛点 | 现象 | 根因 |
| --- | --- | --- |
| **LLM 无显式规划** | 复杂任务一上来就调工具，调到一半发现前提错了再重做，浪费轮次 | V20 的 MainAgent 把"规划"职责直接交给 LLM 一句话的 `prompt`，没有结构化计划 |
| **进展状态丢失** | 跨轮/跨 session 时 LLM 看不到"已经完成哪些、哪些还差什么"，反复重复劳动 | V20 的 `ChatHistoryStore` 存的是对话，不是"任务进度" |
| **上下文无记忆压缩** | 长任务 history 撑爆上下文窗口；3 天前的对话与今天等权 | V20 只按 `maxRounds` 截断，不做时间/重要性分层 |

更上游的痛点是 **AI（LLM）自身在 IDE/CLI 中执行多步任务时也面临完全相同的三个问题**——LLM 没有系统级的"todo 列表 + 进展状态 + 任务记忆"机制，每次开新会话都从零开始。

V22 一次性解决这两层：把"LLM 自身工作流"与"LLM 调度智能体的工作流"统一为同一套元编排架构。

### 1.2 目标

为 Agent Core 引入 **元编排层（Meta-Orchestration Layer）**，让 LLM 在执行任务时具备：

1. **显式可调整的计划**——任务开始先输出"执行计划文档"，通过 `update_plan` 工具动态调整
2. **跨轮进展状态**——已完成待办的摘要持续可用，**严格 ≤ 200 token**
3. **动态技能注入**——在 plan / execute / transfer / summarize 四个阶段注入对应技能
4. **分层记忆压缩**——1–3 天前 200 token、3 天前 100 token、关键事实放宽配额
5. **简单/复杂任务双模式**——简单任务走轻量路径，复杂任务走 plan-execute 闭环

### 1.3 范围声明

- **本期 P0**：V22 元编排层的设计与代码骨架，集成到 V20 MainAgent 之上；不引入新的 LLM 调用次数（不抢 V20 的 LLM 预算）
- **本期 P0 不包含**：长期记忆的向量化与跨 agent 共享（V11/V12 已覆盖，V22 只读不写）；UI 侧的计划/进展面板
- **后续 P1**：UI 可视化计划、跨 agent 任务移交、计划版本对比与回滚

---

## 第2章 核心概念

V22 引入 7 个核心概念，所有概念都对应代码中明确的类型与接口（见第 5 章）。

### 2.1 执行计划文档（Execution Plan Document）

**定义**：任务开始时由 LLM 一次性输出的"任务执行计划"，包含目标、约束、待办列表。**它是 LLM 自身的输出，不是 Agent Core 生成的**——LLM 在第一轮 respond 时必须把计划写在 response 里，由 Agent Core 解析落库。

**结构**（JSON 形式，从 LLM response 解析）：

```ts
interface ExecutionPlan {
  /** 计划 ID（Agent Core 在收到第一份计划时分配） */
  id: string
  /** 用户原始任务描述（一句话） */
  goal: string
  /** 任务约束（不可违反项），来自用户输入或 LLM 自动识别 */
  constraints: string[]
  /** 可动态调整的待办列表 */
  todos: PlanTodo[]
  /** 计划生成时间（ms） */
  createdAt: number
  /** 最近一次 update_plan 的时间 */
  updatedAt: number
}

interface PlanTodo {
  /** 待办 ID（在本计划内稳定，用于 update_plan 引用） */
  id: string
  /** 状态 */
  status: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed'
  /** 一句话描述（≤ 80 字） */
  description: string
  /** 实际使用的工具名（可选；标记 LLM 计划用哪些工具） */
  expectedTools?: string[]
  /** 依赖的其它 todo id（可选，Agent Core 不强制按依赖调度） */
  dependsOn?: string[]
  /** 完成时间（仅 completed/skipped/failed 时存在） */
  completedAt?: number
  /** 失败原因（仅 failed 时存在） */
  failureReason?: string
}
```

**关键约束**：

- 一个 task 对应一个 plan；同 plan 跨多轮迭代（每轮 MainAgent.handle 调用对应 plan 的一个或多个 todo）
- 计划通过 LLM 的响应文本 + `update_plan` 工具双向维护（见 §2.3）
- Agent Core **不**对 plan 内容做语义校验（不检查"该 todo 是否合理"），只保证结构合法

### 2.2 进展状态（Progress State）

**定义**：当前 plan 的"已完成待办摘要的合并浓缩"，是 LLM 下一轮 context 的**关键组成部分**。

**特征**：

- **动态窗口**：保留已完成的最近 N 条 + 当前 in_progress 的 todo，**严格 ≤ 200 token**
- **内容来源**：由 Agent Core 在每次 todo 状态变更后**自动生成**，不消耗 LLM 调用
- **注入位置**：作为 system prompt 的"任务进展"段落（V19 prompt 结构的扩展区域，详见 §5.6）
- **失序容忍**：进展状态乱序或漏一条不致命，LLM 可读 plan 兜底

**数据结构**：

```ts
interface ProgressState {
  /** 关联的 plan id */
  planId: string
  /** 已完成/失败/跳过的 todo 摘要列表（按完成时间倒序，新→旧） */
  completed: Array<{
    todoId: string
    description: string          // 计划里的描述，原样或截断
    status: 'completed' | 'failed' | 'skipped'
    result?: string              // 关键结果（≤ 40 字）
    failureReason?: string       // 失败原因（仅 failed）
    tokenCount: number           // 自身消耗的 token
  }>
  /** 当前正在做的 todo（仅一个；如有冲突由 LLM 自行裁决） */
  inProgress?: { todoId: string; description: string }
  /** 上次压缩时间（ms） */
  lastCompressedAt: number
}
```

### 2.3 update_plan 工具

**定义**：LLM 调用的"计划调整"工具，允许拆分/新增/跳过/重排/标记完成 todo。

**工具签名**（注册到 ToolRegistry，对所有 agent 默认启用）：

```ts
interface UpdatePlanArgs {
  /** 操作类型 */
  operation: 'add' | 'update_status' | 'split' | 'reorder' | 'set_in_progress'
  /** 操作目标（todo id） */
  todoId?: string
  /** 新增的 todo（operation='add'） */
  newTodo?: { description: string; expectedTools?: string[]; dependsOn?: string[] }
  /** 拆分的子 todo（operation='split'） */
  splitInto?: Array<{ description: string; expectedTools?: string[] }>
  /** 状态更新（operation='update_status'） */
  status?: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed'
  /** 完成时的关键结果（status='completed' 时可选，节省 token） */
  result?: string
  /** 失败原因（status='failed' 时建议必填） */
  failureReason?: string
  /** 重排目标顺序（operation='reorder'） */
  newOrder?: string[]
}
```

**约束**：

- 工具**不是**必需的——LLM 可以完全不调 update_plan，按自己节奏把 todo 标完成（在最终 assistant 消息里用结构化文本表达"todo X 完成"）
- 工具失败 → 写入进展状态一条 `plan update rejected: <reason>`，不打断主流程
- 工具调用**不消耗 LLM 轮次**——它与正常 tool_call 并行存在（pipeline 走 BatchToolDispatcher）

### 2.4 任务摘要（Task Summary）

**定义**：单个 todo 完成后 LLM 输出的结构化摘要，用于写入 ProgressState。

**生成时机**：

- todo 状态变为 `completed` / `failed` / `skipped` 时
- 由 LLM 在 response 中以 `<tool_call>update_plan</tool_call>` 提交（见 §2.3）
- 若 LLM 没主动调 update_plan，Agent Core **回退为**：把该 todo 的 description 原样 + 工具执行结果的前 40 字写入 ProgressState

### 2.5 任务记忆（Task Memory）

**定义**：plan 全部完成（或 LLM 主动结束）后输出的"本次任务总结"，用于：

- 沉淀到 ChatHistoryStore 的 metadata 字段（不占 message 列表）
- 触发可选的长期记忆更新（V11/V12 现有接口）
- 跨 session 复用"上次做了什么"

**结构**：

```ts
interface TaskMemory {
  planId: string
  /** 一句话目标 */
  goal: string
  /** 完成情况摘要 */
  outcome: 'success' | 'partial' | 'failed' | 'aborted'
  /** 关键决策与结果（≤ 5 条，每条 ≤ 50 字） */
  keyOutcomes: string[]
  /** 失败原因（outcome='failed'） */
  failureReasons?: string[]
  /** 产出物（物品 ID、方块坐标、关键 ID 等可复用信息） */
  artifacts?: Array<{ type: string; ref: string }>
  /** 总耗时 / 总 token */
  durationMs: number
  totalTokens: number
  /** 沉淀时间 */
  committedAt: number
}
```

### 2.6 技能注入（Skill Injection）

**定义**：在 plan / execute / transfer / summarize 四个阶段，Agent Core 向 LLM 的 system prompt 中**临时追加**对应技能文档（来自 `prompt/skills/*.md`）。

**注入的 4 个阶段**：

| 阶段 | 触发时机 | 注入技能示例 |
| --- | --- | --- |
| `plan` | 任务开始、LLM 第一次 respond 前 | `skill:plan-mode`、`skill:task-decomposition` |
| `execute` | 每次 MainAgent.handle 的 LLM 调用前 | `skill:tool-call-best-practice`、`skill:error-recovery` |
| `transfer` | 每个 todo 完成、跨入下一 todo 前 | `skill:progress-summarization`、`skill:context-window-management` |
| `summarize` | plan 全部完成、输出 task memory 前 | `skill:long-term-memory-summarization` |

**实现要点**：

- 技能文档存于 `packages/agent-core/src/main/orchestration/skills/*.md`
- 注入时按"技能名 → 文档全文"替换占位符 `{{skill:plan-mode}}`
- 技能可配置启用/禁用（`agent.orchestration.skills[]` 数组）
- 同一轮只注入**当前阶段**对应的技能，不注入其它阶段（避免 prompt 膨胀）

### 2.7 分层记忆压缩（Tiered Memory Compression）

**定义**：对 ChatHistoryStore 中的历史按"时间 + 重要性"做压缩，节省 token。

**压缩档位**（V22 默认值，可在 `agent_core_settings` 覆盖；档位按 `minAgeDays` 升序匹配，第一个匹配项生效）：

| 档位 | 时间窗口 | 重要性 | 压缩后 token 上限 |
| --- | --- | --- | --- |
| T0 | 当天（< 1 天） | — | 不压缩（保留原文） |
| T1 | 1–3 天 | 普通 | 200 |
| T2 | 1–3 天 | `critical: true` | 400 |
| T3 | ≥ 3 天 | 普通 | 100 |
| T4 | ≥ 3 天 | `critical: true` | 200 |

> **档位语义**：`minAgeDays` 是"记忆距今的最少天数"，同一时间窗口内分"普通 / 关键"两个配额。匹配时按列表顺序取第一个 `ageDays ≥ minAgeDays` 的档位。

**重要性标记来源**：

- LLM 在调 `update_plan` 时附 `critical: true` 标记
- 或 Agent Core 自动识别：包含"约定/规则/账号/密钥/位置"等关键词

---

## 第3章 工作流模式

V22 区分两种工作流模式，**由 Agent Core 根据任务复杂度自动选择**（也可由 LLM 在 plan 里显式声明）。

### 3.1 简单任务模式（Simple Mode）

**触发条件**（任一）：

- LLM 评估后认为只需 1 轮 LLM 调用即可完成
- 任务无多步依赖、无跨工具状态共享
- 任务预计消耗 < 3 个 tool_call

**流程**：

```
1. LLM 接收任务
2. (可选) 调 update_plan(operation='add', newTodo={...}) 标记 1–3 个 todo
3. 正常 MainAgent.handle 循环（含工具调用、history 落库）
4. 完成后直接输出 finalResponse
5. Agent Core 在后台异步沉淀一条 task memory（不阻塞）
```

**与 V20 的差异**：V20 完全没有 plan 概念；V22 简单模式允许"无 plan"或"轻量 plan"，主链路完全复用 V20。

### 3.2 复杂任务模式（Complex Mode）

**触发条件**（任一）：

- LLM 评估需要 ≥ 3 轮 LLM 调用
- 任务有跨工具状态共享（如：先 explore 再 build）
- 用户在 trigger 配置中显式标注 `complex: true`（V14 trigger 新增字段）

**流程**：

```
1. LLM 接收任务，进入 plan 阶段
2. LLM 输出完整 ExecutionPlan（goal + todos[]），Agent Core 解析落库
3. 进入 execute 阶段：MainAgent.handle 循环
   a. 注入 skill:execute
   b. 注入 ProgressState 到 system prompt
   c. LLM 调工具、调 update_plan 标记进度
   d. 每次 todo 状态变更：自动生成 TaskSummary → 写入 ProgressState
4. 进入 transfer 阶段（每个 todo 切换时）
   a. 检查 ProgressState 是否 ≤ 200 token（超出则触发压缩）
   b. 注入 skill:transfer
   c. 压缩后 context 继续
5. 所有 todo 完成 / 失败 / 跳过
   a. 进入 summarize 阶段
   b. 注入 skill:summarize
   c. LLM 输出 TaskMemory
   d. Agent Core 持久化 TaskMemory + 触发可选长期记忆更新
6. 抛弃本轮对话历史，仅保留 TaskMemory 作为下次 context
```

**关键差异 vs 简单模式**：

- 多了 plan/transfer/summarize 三个阶段
- ProgressState 跨轮持久（在 plan 维度，不在 session 维度）
- 任务结束后只留 TaskMemory（不存完整对话）

### 3.3 模式选择规则

| 信号 | 来源 | 模式 |
| --- | --- | --- |
| LLM 在第一轮 response 里包含完整 plan（todos.length ≥ 2） | LLM 自报 | complex |
| trigger 配置标 `complex: true` | trigger-store | complex |
| 上轮已属于某 plan（planId 存在） | plan registry | complex |
| 其它 | — | simple |

LLM 可以在任意轮调 `update_plan(operation='add', newTodo=...)` 升级到 complex 模式（从那一刻起开始走 complex 流程）。

---

## 第4章 架构

### 4.1 元编排层在系统中的位置

```
┌──────────────────────────────────────────────────────────────────┐
│                    Agent Core Main Process                       │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              Meta-Orchestration Layer (V22 本期)            │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │  │
│  │  │ Plan     │ │ Progress │ │ Skill    │ │ Memory   │       │  │
│  │  │ Manager  │ │ State    │ │ Injector │ │ Compressor│      │  │
│  │  │          │ │ Manager  │ │          │ │          │       │  │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘       │  │
│  │       └─────────────┴───────────┴────────────┘             │  │
│  │                         │                                  │  │
│  │              update_plan tool (新)                         │  │
│  └────────────────────────┬───────────────────────────────────┘  │
│                           │ 包装 MainAgent.handle                │
│                           ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │            Main Link (V20 已落地, V22 不重写)               │  │
│  │  Trigger → MainAgent → PromptBuilder → LLM                │  │
│  │           → Pipeline (BatchToolDispatcher) → Adapter       │  │
│  │           → ChatHistoryStore / TaskMemory                  │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

V22 **不修改** V20 的内部数据流，只是在 V20 MainAgent.handle 的入口/出口做包装。

### 4.2 模块依赖图

```
                  ┌─────────────────┐
                  │  Orchestrator   │  ← 顶层调度器（每个 MainAgent 一个）
                  │  (新)           │
                  └────────┬────────┘
                           │ 持有
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
┌──────────────┐  ┌────────────────┐  ┌──────────────┐
│ PlanManager  │  │ ProgressState  │  │ SkillInjector│
│ (新)         │  │ Manager (新)   │  │ (新)         │
└──────┬───────┘  └────────┬───────┘  └──────┬───────┘
       │                   │                  │
       │              ┌────▼────┐             │
       │              │ Memory  │             │
       │              │Compress │             │
       │              │  or(新) │             │
       │              └────┬────┘             │
       │                   │                  │
       └───────────────────┴──────────────────┘
                           │
                           ▼
                ┌────────────────────┐
                │  MainAgent (V20)   │
                │  包装 .handle()    │
                └────────────────────┘
                           │
                           ▼
                ┌────────────────────┐
                │  PromptBuilder     │
                │  (V5+V19) 注入     │
                │  progress + skill  │
                └────────────────────┘
```

### 4.3 数据流（复杂任务模式 1 轮 LLM 调用）

```
Input: Trigger 事件 / MainAgentEvent { source, prompt, metadata }
  │
  ▼
Orchestrator.dispatch(event)
  │
  ├─ 1. 模式判断
  │    已有 planId? → complex
  │    其它 → simple
  │
  ├─ 2. (complex 模式) 加载/创建 plan
  │    plan = planManager.getOrCreate(workspaceId, agentId, event)
  │    progressState = psManager.load(plan.id)
  │
  ├─ 3. 选 skill & 注入
  │    skill = skillInjector.pick(phase: 'plan'|'execute'|'transfer'|'summarize')
  │    skillText = skillInjector.render(skill)
  │
  ├─ 4. 压缩 progress（如需）
  │    if progressState.tokenCount > 200:
  │        progressState = memCompressor.compress(progressState)
  │
  ├─ 5. 包装 MainAgent.handle
  │    wrappedPrompt = renderExecutionContext(plan, progressState, skillText, event)
  │    result = await mainAgent.handle({ source, prompt: wrappedPrompt, ... })
  │
  ├─ 6. 解析 LLM response 中的 update_plan tool_call
  │    for each tool_call where name == 'update_plan':
  │        planManager.apply(plan.id, args)
  │        psManager.recordSummary(plan.id, ...)
  │
  ├─ 7. 触发 ProgressState 重建
  │    psManager.refresh(plan.id)
  │
  └─ 8. (plan 全部完成) 生成 TaskMemory
       if plan.allTodosDone:
            taskMemory = buildTaskMemory(plan, progressState, result)
            memoryStore.append(taskMemory)
            (可选) longTermMemory.commit(taskMemory)
```

---

## 第5章 详细设计

### 5.1 Orchestrator

**位置**：`packages/agent-core/src/main/orchestration/orchestrator.ts`（新）

**职责**：作为 V22 的顶层入口，**包装**而非替换 V20 的 MainAgent。MainAgentRegistry 在获取 MainAgent 时同步创建 Orchestrator，二者 1:1 绑定。

**接口**：

```ts
export interface OrchestratorDeps {
  mainAgent: MainAgent
  planManager: PlanManager
  progressStateManager: ProgressStateManager
  skillInjector: SkillInjector
  memoryCompressor: MemoryCompressor
  taskMemoryStore: TaskMemoryStore
  longTermMemory?: LongTermMemoryHook     // V11/V12 接口，可选
  maxProgressTokens?: number             // 默认 200
}

export class Orchestrator {
  constructor(deps: OrchestratorDeps)

  /** 主入口：替代直接调 mainAgent.handle */
  async dispatch(event: MainAgentEvent, opts?: { abortSignal?: AbortSignal }): Promise<OrchestratorResult>

  /** 强制设置 plan（外部 trigger 可在派发前预置） */
  attachPlan(plan: ExecutionPlan): void

  /** 取当前 plan（供 debug-handler 等查询） */
  getCurrentPlan(): ExecutionPlan | undefined

  /** 中止 */
  abort(): void
}

export interface OrchestratorResult extends MainAgentResult {
  /** 关联的 plan id（无 plan 时为 undefined） */
  planId?: string
  /** 复杂模式完成时附带 task memory id */
  taskMemoryId?: string
}
```

**dispatch 内部实现要点**：

```ts
async dispatch(event, opts) {
  // 1. 模式判断 + plan 获取
  const existing = this.planManager.getByEvent(event.metadata?.eventId)
  const plan = existing ?? this.planManager.createFromEvent(event)
  const isComplex = this.detectComplexMode(plan, event)

  // 2. 复杂模式：装配上下文
  let wrappedPrompt = event.prompt
  if (isComplex) {
    const progress = await this.psManager.load(plan.id)
    const compressed = this.memoryCompressor.compressIfNeeded(progress)
    if (compressed.compressed) await this.psManager.save(compressed.state)

    const phase = this.inferPhase(plan)   // 'plan' | 'execute' | 'transfer' | 'summarize'
    const skill = this.skillInjector.pick(phase, this.deps.mainAgent['deps'].agentConfig)

    wrappedPrompt = this.renderContext({
      originalPrompt: event.prompt,
      plan,
      progress: compressed.state,
      skillText: skill?.content,
    })
  }

  // 3. 调底层 MainAgent
  const result = await this.deps.mainAgent.handle(
    { ...event, prompt: wrappedPrompt },
    opts,
  )

  // 4. 解析 LLM response 中的 update_plan 调用
  // （Orchestrator 在 tool 结果回流后扫描）
  // ... 详见 §5.5

  // 5. 复杂模式收尾
  if (isComplex && this.planManager.isAllDone(plan.id)) {
    const taskMemory = this.buildTaskMemory(plan, result)
    const id = await this.deps.taskMemoryStore.append(taskMemory)
    await this.deps.longTermMemory?.commit?.(taskMemory)
    return { ...result, planId: plan.id, taskMemoryId: id }
  }

  return { ...result, planId: plan?.id }
}
```

### 5.2 PlanManager

**位置**：`packages/agent-core/src/main/orchestration/plan-manager.ts`（新）

**职责**：plan 的 CRUD、`update_plan` 工具的实现、plan 解析（从 LLM response 提取 plan JSON）。

**接口**：

```ts
export interface PlanManagerDeps {
  store: PlanStore                       // SQLite/内存实现
  /** 从 LLM response 中提取 plan 的策略（默认按 JSON 块解析） */
  extractor?: (llmResponse: string) => ExecutionPlan | undefined
}

export class PlanManager {
  constructor(deps: PlanManagerDeps)

  /** 根据 trigger event 创建空 plan（LLM 在第一轮填充） */
  createFromEvent(event: MainAgentEvent): ExecutionPlan

  /** 从 LLM response 提取并保存 plan */
  ingestFromLLM(planId: string, llmResponse: string): ExecutionPlan

  /** update_plan 工具的 action handler */
  apply(planId: string, args: UpdatePlanArgs): { ok: boolean; reason?: string }

  /** 查 plan */
  get(planId: string): ExecutionPlan | undefined
  getByEvent(eventId: string): ExecutionPlan | undefined

  /** 列出某个 (workspace, agent) 下的活跃 plan */
  listActive(workspaceId: string, agentId: string): ExecutionPlan[]

  /** 全部 todo 是否完成 */
  isAllDone(planId: string): boolean
}

export interface PlanStore {
  save(plan: ExecutionPlan): Promise<void>
  load(planId: string): Promise<ExecutionPlan | undefined>
  loadByEvent(eventId: string): Promise<ExecutionPlan | undefined>
  listActive(workspaceId: string, agentId: string): Promise<ExecutionPlan[]>
}
```

**PlanStore 持久化**：本期用 SQLite 表 `orch_plans` + `orch_plan_todos`；与 `chat_history` 同样落 `agent-core` 现有 SQLite。

**update_plan 操作的语义**：

| operation | 语义 | 失败场景 |
| --- | --- | --- |
| `add` | 追加 todo（status=pending）到 todos[] | 无 |
| `update_status` | 修改指定 todo 状态；不允许 `completed` → 其它 | todoId 不存在、状态非法跳转 |
| `split` | 把指定 todo 替换为多个子 todo | 拆分数为 0 |
| `reorder` | 重排 todos 顺序（仅 pending 可重排） | newOrder 含非 pending id |
| `set_in_progress` | 标记 in_progress（同时把上一个 in_progress 退回 pending） | 已有 in_progress |

### 5.3 ProgressStateManager

**位置**：`packages/agent-core/src/main/orchestration/progress-state-manager.ts`（新）

**职责**：维护 plan 维度的进展状态、自动汇总 todo 完成摘要、控制 token 上限。

**接口**：

```ts
export interface ProgressStateManagerDeps {
  planManager: PlanManager
  compressor: MemoryCompressor
  maxTokens?: number                      // 默认 200
}

export class ProgressStateManager {
  constructor(deps: ProgressStateManagerDeps)

  /** 加载/重建 plan 的 progress state */
  load(planId: string): Promise<ProgressState>

  /** todo 状态变更时调用：自动追加 summary */
  recordSummary(planId: string, todoId: string, summary: TaskSummary): Promise<ProgressState>

  /** 主动压缩 */
  compress(planId: string): Promise<ProgressState>

  /** 渲染为可注入 prompt 的文本（按 token 上限截断） */
  renderForPrompt(state: ProgressState): string
}

export interface TaskSummary {
  todoId: string
  status: 'completed' | 'failed' | 'skipped'
  result?: string                        // 关键结果 ≤ 40 字
  failureReason?: string                 // 失败原因
  critical?: boolean                     // 是否标记为关键事实
}
```

**自动汇总策略**（LLM 没主动 record 时的回退）：

```ts
function buildFallbackSummary(plan: ExecutionPlan, todoId: string, toolResult?: string): TaskSummary {
  const todo = plan.todos.find(t => t.id === todoId)
  return {
    todoId,
    status: 'completed',                  // 或 'failed' / 'skipped'，按 plan 状态取
    result: toolResult ? toolResult.slice(0, 40) : undefined,
    critical: false,
  }
}
```

**renderForPrompt 输出示例**（严格 ≤ 200 token）：

```
[任务进展] 计划 plan-abc123
✅ #2 已收集 16 个圆石 (result: 16 cobblestone)
✅ #1 探索到 (120, 64, -340) 处的铁矿点
🔄 #3 正在挖掘铁矿（in_progress）
⏭️ #4 已跳过（无铁矿）
```

### 5.4 SkillInjector

**位置**：`packages/agent-core/src/main/orchestration/skill-injector.ts`（新）

**职责**：根据 phase 选择技能、渲染技能文档、控制 prompt 注入量。

**接口**：

```ts
export type SkillPhase = 'plan' | 'execute' | 'transfer' | 'summarize'

export interface Skill {
  name: string                            // e.g. 'plan-mode'
  phase: SkillPhase
  /** markdown 文档全文，Agent Core 启动时一次性加载 */
  content: string
  /** Agent 默认是否启用（可被 agent.orchestration.skills 覆盖） */
  enabledByDefault: boolean
  /** 估算 token 数（用于预算控制） */
  estimatedTokens: number
}

export interface SkillInjectorDeps {
  /** 技能目录（启动时扫描） */
  skillsDir: string
  /** 单一 prompt 中所有 skill 的 token 总预算 */
  totalSkillBudget?: number              // 默认 600
}

export class SkillInjector {
  constructor(deps: SkillInjectorDeps)

  /** 列出所有技能（按 phase 分组） */
  list(): Record<SkillPhase, Skill[]>

  /** 选当前 phase 的技能（按 agent 配置 + 预算裁剪） */
  pick(phase: SkillPhase, agentConfig: AgentConfig): Skill[]

  /** 渲染为可注入 prompt 的 markdown 文本 */
  render(skills: Skill[]): string
}
```

**技能文档示例**（`skills/plan-mode.md`）：

```markdown
# 技能：计划模式

你正在为用户的复杂任务生成执行计划。请：

1. 先用 1 句话明确 goal
2. 列出 3–10 个 todos，每个 todo ≤ 80 字
3. 用 `update_plan` 工具提交计划
4. 计划输出后立刻进入 execute 模式
```

**Agent 配置覆盖**：

```ts
// AgentConfig 新增字段（types.ts 增量）
interface AgentConfig {
  // ... 现有 ...
  orchestration?: {
    enabledSkills?: string[]              // 白名单；空 = 全部启用
    disabledSkills?: string[]             // 黑名单
  }
}
```

### 5.5 update_plan 工具实现

**位置**：`packages/agent-core/src/main/orchestration/tools/update-plan.ts`（新）

**职责**：作为 ToolRegistry 中的一个内置工具，对所有 agent 默认启用。

**实现要点**：

```ts
export const updatePlanTool: ToolSchema = {
  name: 'update_plan',
  description: '调整执行计划：新增/修改/拆分/重排/标记进度 todo。',
  inputSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: ['add', 'update_status', 'split', 'reorder', 'set_in_progress'] },
      todoId: { type: 'string' },
      newTodo: { type: 'object', properties: { /* ... */ } },
      splitInto: { type: 'array', items: { /* ... */ } },
      status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'skipped', 'failed'] },
      result: { type: 'string' },
      failureReason: { type: 'string' },
      newOrder: { type: 'array', items: { type: 'string' } },
    },
    required: ['operation'],
  },
}

export class UpdatePlanHandler {
  constructor(private planManager: PlanManager) {}

  async execute(args: UpdatePlanArgs, context: ToolContext): Promise<ToolResult> {
    const plan = this.planManager.get(context.metadata.planId)
    if (!plan) return { success: false, error: 'NO_ACTIVE_PLAN' }

    const res = this.planManager.apply(plan.id, args)
    return res.ok
      ? { success: true, data: { plan } }
      : { success: false, error: res.reason ?? 'UNKNOWN' }
  }
}
```

**注册时机**：

- Agent Core 启动时（`bootstrapAndWireAgents`）注册到全局 `ToolRegistry`
- 工具的 `isEnabled` 按 agent 的 `orchestration.enabledSkills` 判断（默认 true）

### 5.6 PromptBuilder 集成

**位置**：`packages/agent-core/src/main/prompt/builder/prompt-builder.ts`（修改）

**变更**：在 `build()` 接受 `extraContext.progress` 和 `extraContext.skills`，注入到新的"任务进展"和"技能"区域。

**V19 已有 6 个区域**：身份/性格/行为规则/工作流/工具/沟通边界

**V22 新增 2 个区域**（按 V19 风格追加）：

| 区域编号 | 名称 | 来源 | 注入条件 |
| --- | --- | --- | --- |
| 7 | 任务进展 | `extraContext.progress` | 复杂模式 |
| 8 | 当前技能 | `extraContext.skills` | 任一阶段都注入 |

**build() 签名变化**：

```ts
interface BuildParams {
  // ... 现有 ...
  extraContext?: {
    excludeTools?: string[]
    /** V22 新增 */
    progress?: string                     // ProgressStateManager.renderForPrompt 的输出
    skills?: string                       // SkillInjector.render 的输出
  }
}
```

### 5.7 MemoryCompressor

**位置**：`packages/agent-core/src/main/orchestration/memory-compressor.ts`（新）

**职责**：按"时间 + 重要性"压缩 ProgressState、ChatHistory 段、未来扩展到长期记忆。

**接口**：

```ts
/**
 * 压缩档位：按 minAgeDays 升序匹配，第一个 ageDays ≥ minAgeDays 的档位生效。
 * 同一时间窗口内 critical 与 normal 是两个独立档位。
 */
export interface CompressionTier {
  /** 记忆距今的最少天数（ageDays ≥ minAgeDays 时匹配） */
  minAgeDays: number
  /** 重要性 */
  importance: 'normal' | 'critical'
  /** 压缩后允许的最大 token；Infinity 表示不压缩 */
  maxTokens: number
}

export const DEFAULT_TIERS: CompressionTier[] = [
  { minAgeDays: 0, importance: 'normal',   maxTokens: Infinity },  // T0 当天不压缩
  { minAgeDays: 1, importance: 'normal',   maxTokens: 200 },       // T1 1-3 天普通
  { minAgeDays: 1, importance: 'critical', maxTokens: 400 },       // T2 1-3 天关键
  { minAgeDays: 3, importance: 'normal',   maxTokens: 100 },       // T3 ≥3 天普通
  { minAgeDays: 3, importance: 'critical', maxTokens: 200 },       // T4 ≥3 天关键
]

export interface MemoryCompressorDeps {
  tiers?: CompressionTier[]
  /** 估算 token 数的策略；默认按字符数 / 4 估算 */
  estimateTokens?: (text: string) => number
}

export class MemoryCompressor {
  constructor(deps: MemoryCompressorDeps)

  /** 压缩 ProgressState */
  compressProgress(state: ProgressState): { state: ProgressState; compressed: boolean }

  /** 压缩历史片段（按 createdAt + critical 标记） */
  compressHistory(entries: ChatHistoryEntry[]): ChatHistoryEntry[]

  /** 压缩任意文本（按重要性 + 年龄档位） */
  compressText(text: string, opts: { ageDays: number; critical: boolean }): string

  /** 内部：查找当前 (ageDays, importance) 对应的档位 */
  resolveTier(ageDays: number, critical: boolean): CompressionTier
}
```

**重要性自动识别**（降级方案）：

```ts
const CRITICAL_KEYWORDS = /\b(约定|规则|账号|密码|密钥|位置|坐标|基|基地|家|home)\b/i
function detectCritical(text: string): boolean {
  return CRITICAL_KEYWORDS.test(text)
}
```

### 5.8 TaskMemoryStore

**位置**：`packages/agent-core/src/main/orchestration/task-memory-store.ts`（新）

**职责**：plan 完成后持久化 TaskMemory。

**Schema**：

```sql
CREATE TABLE IF NOT EXISTS task_memories (
  id TEXT PRIMARY KEY,                   -- UUID
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  goal TEXT NOT NULL,
  outcome TEXT NOT NULL,                 -- 'success' | 'partial' | 'failed' | 'aborted'
  key_outcomes_json TEXT NOT NULL,       -- JSON 数组
  failure_reasons_json TEXT,             -- JSON 数组
  artifacts_json TEXT,                   -- JSON 数组
  duration_ms INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  committed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_memories_lookup
  ON task_memories(workspace_id, agent_id, committed_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_memories_plan
  ON task_memories(plan_id);
```

**API**：

```ts
export interface TaskMemoryStore {
  append(mem: TaskMemory): Promise<string>            // 返回 id
  load(id: string): Promise<TaskMemory | undefined>
  list(workspaceId: string, agentId: string, opts?: { limit?: number; beforeCommittedAt?: number }): Promise<TaskMemory[]>
}
```

### 5.9 LongTermMemory 钩子（可选）

**位置**：`packages/agent-core/src/main/orchestration/long-term-memory-hook.ts`（新）

**职责**：把 TaskMemory 的关键决策与结果推送到 V11/V12 现有记忆系统。

```ts
export interface LongTermMemoryHook {
  commit(memory: TaskMemory): Promise<void>
}
```

**实现**：把 `keyOutcomes[]` 作为 `experience` 类型记忆写入 V11；把 `artifacts` 作为 `map_feature` 写入 V12。**不重写** V11/V12 接口。

### 5.10 MainAgentRegistry 改造

**位置**：`packages/agent-core/src/main/agent/main-agent-registry.ts`（修改）

**变更**：每次 `get()` 时同步创建 Orchestrator 并缓存，二者 1:1 绑定。

```ts
export class MainAgentRegistry {
  private orchCache = new Map<string, Orchestrator>()   // key = `${ws}:${agentId}`

  async get(workspaceId: string, agentId: string): Promise<{ mainAgent: MainAgent; orchestrator: Orchestrator } | undefined> {
    const key = `${workspaceId}:${agentId}`
    if (this.orchCache.has(key)) {
      const cached = this.orchCache.get(key)!
      return { mainAgent: cached['mainAgent'], orchestrator: cached }
    }
    // ... 构造 MainAgent (同 V20 现有逻辑) ...
    const orch = new Orchestrator({
      mainAgent,
      planManager: this.deps.planManager,
      progressStateManager: this.deps.progressStateManager,
      skillInjector: this.deps.skillInjector,
      memoryCompressor: this.deps.memoryCompressor,
      taskMemoryStore: this.deps.taskMemoryStore,
      longTermMemory: this.deps.longTermMemory,
    })
    this.orchCache.set(key, orch)
    return { mainAgent, orchestrator: orch }
  }
}
```

**Trigger ActionExecutor 改造**：

```ts
// 之前: deps.mainAgentProvider = (p) => registry.getSync(p.workspaceId, p.agentId)
// 之后: deps.mainAgentProvider = (p) => registry.get(p.workspaceId, p.agentId).then(r => r?.orchestrator)
```

---

## 第6章 与 V20 的集成边界

| 关注点 | V20 已实现 | V22 是否动 |
| --- | --- | --- |
| TriggerEngine → send_llm | ✅ | 不动（入口改用 Orchestrator） |
| MainAgent.handle() 内部 | ✅ | **不修改**——V22 包装它 |
| Pipeline / BatchToolDispatcher | ✅ | 不动 |
| ChatHistoryStore | ✅ | **追加**（不替换）：V22 不写 message，仅写 metadata |
| PromptBuilder | ✅ V5+V19 | **扩展** extraContext 字段 |
| ToolRegistry | ✅ | **追加** `update_plan` 一个工具 |
| MainAgentRegistry | ✅ | **修改**（Orchestrator 1:1 绑定） |
| ActionExecutor | ✅ | **修改**（注入 Orchestrator 而非 MainAgent） |
| 模型调度 / 限流 | ✅ | 不动 |
| 对话历史 Schema | ✅ | 不动 |

V22 **不引入**新的 LLM 调用次数。`update_plan` 是普通 tool_call，走 V20 的 BatchToolDispatcher 通道。

---

## 第7章 配置

存于 `agent_core_settings` 表（V20 已有）。

| key | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `orchestration.enabled` | bool | true | 总开关；关闭后所有 agent 退回 simple 模式 |
| `orchestration.maxProgressTokens` | int | 200 | ProgressState 渲染 token 上限 |
| `orchestration.maxTodosPerPlan` | int | 20 | 单 plan 最多 todo 数（防爆） |
| `orchestration.skillBudgetPerPrompt` | int | 600 | 单轮 prompt 注入的技能 token 上限 |
| `orchestration.skillsDir` | string | `src/main/orchestration/skills` | 技能文档目录 |
| `orchestration.compressionTiersJson` | string | (见 §5.7 DEFAULT_TIERS) | 压缩档位 JSON |
| `orchestration.longTermMemory.enabled` | bool | true | 是否把 TaskMemory 推送到 V11/V12 |
| `trigger.complexModeDefault` | bool | false | trigger 默认模式（V14 增字段） |

**Agent 级覆盖**：`agent.orchestration.{enabledSkills, disabledSkills, mode}`（V22 增量）。

---

## 第8章 错误处理

| 场景 | 处理 |
| --- | --- |
| LLM response 解析不出 plan JSON | 退回 simple 模式；记录 warn 日志；不影响主流程 |
| `update_plan` 操作非法 | 工具返回 `success: false, reason: ...`；LLM 下一轮可重试 |
| `update_plan` 工具未注册 | ToolRegistry 启动时硬注册；缺失则 Agent Core 启动失败 |
| ProgressState 超出 200 token | 触发 MemoryCompressor 压缩；超 2 次仍超则强制截断最早 1 条 |
| Plan 全部 todo 卡在 pending（无 in_progress） | Orchestrator 注入"提示"消息引导 LLM 推进；最多 2 次后强制 `set_in_progress` 第一个 pending |
| 压缩规则被改成非法值 | 启动时校验；非法则回退 DEFAULT_RULES + error 日志 |
| 任务记忆推送长期记忆失败 | 记 error 日志；任务记忆已落 SQLite，重启后可手动重试 |
| Orchestrator.dispatch 中 MainAgent 抛 AbortError | 透传；不写 task memory |
| Trigger event 与 plan 关联丢失（重启后） | PlanStore.loadByEvent 返回 undefined → 视为新 plan（LLM 重新生成） |

**重要不变量**：

- Plan 永远不会"丢"——要么完成写 task memory，要么 pending 留在 SQLite 等下次
- Orchestrator.dispatch 永不直接抛 plan 错误给 Trigger；一律 catch → 记 progress state 一条 "plan error" → 走 fallback

---

## 第9章 测试策略

### 9.1 单元测试

| 模块 | 覆盖点 |
| --- | --- |
| `PlanManager` | createFromEvent / apply 各 operation / isAllDone / 非法操作回绝 |
| `ProgressStateManager` | recordSummary / renderForPrompt token 限制 / 自动回退 summary |
| `SkillInjector` | pick 各 phase / 预算裁剪 / 渲染换行 |
| `MemoryCompressor` | 5 档规则 × 普通/关键 = 10 个组合 / 字符估算 / 关键词识别 |
| `TaskMemoryStore` | append / load / list 分页 / 索引生效 |
| `update_plan` handler | 5 个 operation × happy/error = 10 个 case |
| `Orchestrator` | simple/complex 分支 / plan 注入 / 工具结果回流到 progress / task memory 落库 |

### 9.2 集成测试

- **端到端**：trigger → Orchestrator → MainAgent → mock LLM（含 update_plan）→ 验证 plan 状态、progress 注入、task memory 落库
- **跨 plan 隔离**：两个并发 plan 在不同 (workspace, agent) 下互不干扰
- **压缩边界**：构造 30 条 progress，验证压缩后 token ≤ 上限

### 9.3 E2E（mock Adapter Core TCP server）

- 起 mock JE server，触发 trigger 走复杂模式，验证完整闭环

---

## 第10章 实施分阶段

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| **22.1** | PlanManager + PlanStore + update_plan 工具 | 单测全过；工具注册到 ToolRegistry |
| **22.2** | ProgressStateManager + MemoryCompressor | 单测 token 限制 / 压缩规则 |
| **22.3** | SkillInjector + 4 份示例技能文档 | 单测选 phase / 预算裁剪 |
| **22.4** | TaskMemoryStore + LongTermMemoryHook | 单测落库 / 钩子调用 |
| **22.5** | Orchestrator 主体 + 包装 MainAgent | 集成：trigger 走 complex 模式 → plan 注入 → 工具回流 → task memory |
| **22.6** | MainAgentRegistry 改造 + ActionExecutor 注入 Orchestrator | 现有 trigger 单测全过 |
| **22.7** | PromptBuilder 扩展 + 区域 7/8 注入 | 集成：progress + skill 出现在最终 prompt |
| **22.8** | 集成测试 + E2E + 文档验收清单 | npm test + 手动 trigger 跑通 |

---

## 第11章 文件清单

### 11.1 新增

| 文件 | 职责 |
| --- | --- |
| `src/main/orchestration/orchestrator.ts` | 顶层 Orchestrator |
| `src/main/orchestration/plan-manager.ts` | plan CRUD + update_plan 工具实现 |
| `src/main/orchestration/plan-store.ts` | plan SQLite DAO |
| `src/main/orchestration/progress-state-manager.ts` | 进展状态管理 |
| `src/main/orchestration/memory-compressor.ts` | 分层压缩 |
| `src/main/orchestration/skill-injector.ts` | 技能选择与渲染 |
| `src/main/orchestration/skills/plan-mode.md` | 阶段 1 技能 |
| `src/main/orchestration/skills/execute.md` | 阶段 2 技能 |
| `src/main/orchestration/skills/transfer.md` | 阶段 3 技能 |
| `src/main/orchestration/skills/summarize.md` | 阶段 4 技能 |
| `src/main/orchestration/task-memory-store.ts` | 任务记忆 DAO |
| `src/main/orchestration/long-term-memory-hook.ts` | V11/V12 推送钩子 |
| `src/main/orchestration/tools/update-plan.ts` | update_plan 工具 schema + handler |
| `src/main/orchestration/types.ts` | 公共类型 |
| `src/main/orchestration/index.ts` | 模块聚合导出 |
| `src/main/orchestration/__tests__/*.test.ts` | 单元测试（7 个） |

### 11.2 修改

| 文件 | 变更 |
| --- | --- |
| `src/main/agent/main-agent-registry.ts` | 增 Orchestrator 缓存；`get()` 返回 `{mainAgent, orchestrator}` |
| `src/main/trigger/action-executor.ts` | `mainAgentProvider` 注入 Orchestrator |
| `src/main/trigger/types.ts` | `EventTrigger` 加 `complex: boolean?` 字段 |
| `src/main/trigger/trigger-store.ts` | schema 加 `complex` 列 |
| `src/main/prompt/builder/prompt-builder.ts` | `BuildParams.extraContext` 增 `progress` / `skills` |
| `src/main/prompt/builder/system-prompt-builder.ts` | 加区域 7/8 |
| `src/main/ipc/index.ts` | 启动时初始化 PlanStore / TaskMemoryStore / SkillInjector |
| `src/main/database/database-manager.ts` | 增 `orch_plans` / `orch_plan_todos` / `task_memories` 表 + schema 迁移 |
| `src/renderer/src/lib/types.ts` | `AgentConfig` 增 `orchestration` 字段；`MainAgentEvent` 不动 |

---

## 第12章 风险与未决

| 风险 | 缓解 |
| --- | --- |
| LLM 不按规范在第一轮输出 plan JSON | PlanManager 解析失败时回退 simple 模式；多次失败后 trigger 日志记 warn |
| LLM 频繁调 `update_plan` 撑爆工具调用预算 | 工具与正常 tool_call 共用 maxRounds 预算；不单独限流（实际不影响主链路） |
| ProgressState 200 token 限制过紧 | 通过配置 `orchestration.maxProgressTokens` 调整；类型为 critical 的 todo 放宽 |
| 技能文档被误改导致 prompt 错乱 | 技能文档在仓库内；改文件需 PR review；启动时校验 markdown 大小 |
| Orchestrator 包装增加 1 层 await 链 | 单测覆盖耗时；如 < 5ms 视作可接受 |
| PlanStore 跨 session 关联靠 eventId | eventId 由 trigger 唯一保证；中途重启会丢关联，但 plan 内容仍在 SQLite 可手动 attach |
| TaskMemory 推 V11/V12 与 V11/V12 升级冲突 | LongTermMemoryHook 是可选实现，失败不影响 task memory 落库 |
| 简单/复杂模式判断错误（应当 complex 走了 simple） | LLM 可在 response 中显式输出 `===COMPLEX===` 标记，Orchestrator 见到标记强制升级 |
| 进度状态与 plan 状态不同步（人工修 SQLite 后） | 启动时校验 plan 状态与 progress state 一致；不一致以 plan 为准重建 progress |

---

## 第13章 验收清单

| # | 项 | 验证方法 |
| -- | --- | --- |
| 1 | trigger 简单任务走 simple 模式，1 轮 LLM 调用后产出 finalResponse | 集成测试 |
| 2 | trigger 复杂任务（LLM 输出 plan）走 complex 模式 | 集成测试 |
| 3 | plan 全部 todo 完成 → 自动落 task memory | 集成测试 |
| 4 | ProgressState 严格 ≤ 200 token（默认配置） | 单测 token 估算 |
| 5 | update_plan 各 operation 行为正确 | 单测 ×5 |
| 6 | 4 阶段技能正确注入到 system prompt | 集成测试 + 抓 prompt 文本 |
| 7 | 1–3 天前对话按 200 token 压缩；关键事实按 400 token | 单测 × 5 档 |
| 8 | task memory 落 SQLite 可查 | sqlite3 CLI |
| 9 | 长任务跨多轮迭代 plan 状态正确 | 集成测试 |
| 10 | Plan 解析失败回退 simple 模式不崩溃 | 注入畸形 LLM response 单测 |
| 11 | Orchestrator.dispatch 包装后不破坏 V20 现有 trigger 测试 | npm test 全过 |
| 12 | 技能文档在 prompt 中出现且 token 数在预算内 | 集成测试 |

---

## 第14章 已确认决策

| # | 决策点 | 结论 |
| - | --- | --- |
| 1 | 元编排层放在 V20 MainAgent 之上还是之内？ | **之上**——V22 包装 MainAgent.handle，不修改 V20 内部数据流 |
| 2 | Plan 是 LLM 自主生成还是 Agent Core 引导？ | **LLM 自主生成**，Agent Core 只解析 + 持久化；解析失败时回退 simple |
| 3 | ProgressState 是 200 还是 500 token？ | **200**（用户明确要求），通过配置可放宽到 400 |
| 4 | `update_plan` 工具是否对所有 agent 默认启用？ | **是**——简单模式 LLM 也会调（标几个 todo），复杂模式高频调 |
| 5 | 技能文档是代码常量还是外部文件？ | **外部 markdown 文件**（`skills/*.md`）——便于迭代与本地化 |
| 6 | TaskMemory 是否必推 V11/V12 长期记忆？ | **可选**——通过 `orchestration.longTermMemory.enabled` 控制，默认 true |
| 7 | 压缩按"天数"还是"会话数"？ | **天数**——更符合"昨天/上周/上个月"的直觉 |
| 8 | Orchestrator 是不是单例？ | **每个 (workspaceId, agentId) 一份**——与 MainAgent 1:1 绑定 |
| 9 | Plan 是否跨 session 持久？ | **是**——同 eventId 在重启后能恢复 plan；但 LLM 重新生成 plan 也允许 |
| 10 | 是否引入"plan 版本对比"？ | **不做**——单 plan 线性追加即可；版本对比留 P1 |

---

## 第15章 与本仓库其他版本的关系

```
V11 记忆系统 v1 ─┐
V12 地图索引 v2  ─┼─→ V22 通过 LongTermMemoryHook 读
V13 任务系统    ─┘
V14 触发器      ─→ V22 通过 trigger.complex 字段读
V19 提示词结构   ─→ V22 扩展区域 7/8
V20 主链路组装   ─→ V22 在其上包装 Orchestrator
V22 (本期)      ─→ 元编排层
```
