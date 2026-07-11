# Alice Mod Core V13 — 任务系统

> 版本：v1.0
> 日期：2026-07-11
> 版本号：V13（第 16 周）
> 对应需求：AC-TASK-01 ~ AC-TASK-12
> 关联文档：[AC-01-需求文档.md](AC-01-需求文档.md)、[AC-02-实施计划.md](AC-02-实施计划.md)、[AC-03-规范与验收标准.md](AC-03-规范与验收标准.md)、[04-任务系统接口规范.md](../../api/04-任务系统接口规范.md)

---

## 第一部分：需求文档

### 1.1 模块定位

V13 是任务系统的**完整实现版本**，在 V11 记忆系统和 V12 地图索引的基础上，为 Agent Core 引入任务调度和执行能力。任务系统是 McAgent 的"执行引擎"，使 LLM 能够创建、分解、调度和监控任务，实现从高层目标到具体操作的完整闭环。

**核心职责**：

| 职责 | 说明 |
|------|------|
| **任务持久化** | 基于 SQLite 三张表（task_meta / task_deps / task_schedule）存储任务元数据、依赖关系和调度信息 |
| **TaskManager API** | 统一的 CRUD + 调度 + 统计接口，封装所有任务操作 |
| **TaskScheduler** | 优先级队列调度器，支持依赖解析、并发控制（max 3）、事件驱动 |
| **四种执行器** | SimpleTaskExecutor / CompositeTaskExecutor / LoopTaskExecutor / ConditionalTaskExecutor |
| **超时与重试** | 超时管理 + 指数退避重试机制，失败任务自动重试 |
| **LLM 任务工具** | 向 LLM 暴露 12 个任务工具，覆盖创建、查询、更新、控制、分解、管理全流程 |
| **任务分解** | LLM 辅助的任务分解工具，将复杂目标拆解为可执行的子任务列表 |

### 1.2 与已有模块的关系

| 模块 | 关系说明 |
|------|----------|
| **V11 记忆系统 v1** | 任务执行经验可通过 memory_store 存入 `task_experience` 类型记忆，供 LLM 后续参考 |
| **V12 地图索引** | 任务中的位置相关操作可调用地图工具获取坐标信息 |
| **V3 工作区管理** | 任务按工作区隔离，每个任务的 workspaceId 关联到对应的工作区 |
| **V4 Function Calling Pipeline** | 任务执行器通过 context.callTool() 调用 Pipeline 系统中已注册的工具 |
| **V5 提示词系统** | 任务执行结果可注入到 LLM 上下文中，辅助后续决策 |
| **V9 日志系统** | 任务调度和执行过程记录到日志系统，支持调试回溯 |
| **V14 事件触发器** | 条件任务的 condition.type='event' 依赖事件系统驱动（V14 实现） |

### 1.3 功能需求列表

| 需求 ID | 需求名称 | 优先级 | 实现状态 |
|---------|----------|:------:|:--------:|
| AC-TASK-01 | SQLite 任务表（task_meta / task_deps / task_schedule） | P0 | 待实现 |
| AC-TASK-02 | TaskManager API（CRUD + 调度 + 统计） | P0 | 待实现 |
| AC-TASK-03 | TaskScheduler（优先级队列 + 依赖解析 + 并发控制 max 3） | P0 | 待实现 |
| AC-TASK-04 | SimpleTaskExecutor（单次一次性工具调用） | P0 | 待实现 |
| AC-TASK-05 | CompositeTaskExecutor（按序执行子任务） | P0 | 待实现 |
| AC-TASK-06 | LoopTaskExecutor（按次数/间隔/条件重复） | P0 | 待实现 |
| AC-TASK-07 | ConditionalTaskExecutor（等待条件满足后执行） | P0 | 待实现 |
| AC-TASK-08 | 超时管理 + 重试机制（指数退避重试） | P0 | 待实现 |
| AC-TASK-09 | task_create / task_query 工具 | P0 | 待实现 |
| AC-TASK-10 | task_update / task_control（暂停/恢复/取消/重试）工具 | P0 | 待实现 |
| AC-TASK-11 | task_decompose 工具（LLM 辅助任务分解） | P0 | 待实现 |
| AC-TASK-12 | task_config / task_manage 工具（优先级/依赖/统计/清理/导入导出） | P0 | 待实现 |

#### AC-TASK-01 SQLite 任务表详细需求

| 子需求 | 说明 |
|--------|------|
| task_meta 表 | 任务元数据表：id（UUID v4）、workspace_id、name、description、type（simple/composite/loop/conditional）、status（pending/running/paused/completed/failed/cancelled）、progress（0-100）、priority（critical/high/normal/low）、timeout、tags（JSON array）、metadata（JSON）、action_json（ToolCall JSON）、subtask_ids（JSON array）、loop_config_json、condition_json、retry_config_json、schedule_config_json、result_json、error、retry_count、created_at、started_at、completed_at、updated_at |
| task_deps 表 | 任务依赖表：task_id、depends_on_id，复合主键，外键级联删除 |
| task_schedule 表 | 任务调度表：id（自增）、task_id（UNIQUE）、schedule_mode（immediate/delayed/cron/event）、scheduled_at、cron_expression、trigger_event、last_triggered_at |
| 索引策略 | task_meta：workspace_id/status/priority/type/created_at 各建索引；task_deps：task_id/depends_on_id 各建索引；task_schedule：scheduled_at/trigger_event 各建索引 |

#### AC-TASK-02 TaskManager API 详细需求

| 子需求 | 说明 |
|--------|------|
| 创建任务 | `create(params)` — 验证参数 → 写入 SQLite → 加入调度队列 → 返回 task_id |
| 批量创建 | `batchCreate(params)` — 批量创建多个任务，返回所有 ID |
| 按条件查询 | `query(params)` — 按 status/priority/type/tags/workspaceId/时间范围等条件过滤，支持排序和分页 |
| 按 ID 获取 | `getById(id)` — 获取单个任务详情 |
| 获取进度 | `getProgress(id)` — 获取任务进度和状态 |
| 更新属性 | `update(id, updates)` — 更新任务名称/描述/优先级/标签等 |
| 暂停/恢复/取消 | `pause(id)` / `resume(id)` / `cancel(id, reason?)` — 状态管理 |
| 标记完成/失败 | `complete(id, result?)` / `fail(id, error)` — 内部使用 |
| 调度管理 | `schedule(id, config)` / `setPriority(id, priority)` / `addDependency(id, dependsOnId)` / `removeDependency(id, dependsOnId)` |
| 重试 | `retry(id, force?)` — 重试失败任务 |
| 统计 | `stats()` — 按状态/优先级/类型分布统计，完成率，平均耗时 |
| 清理 | `cleanup(options?)` — 清理已完成/失败/取消的任务 |
| 导入导出 | `export(options?)` / `import(json)` — 任务数据迁移 |

#### AC-TASK-03 TaskScheduler 详细需求

| 子需求 | 说明 |
|--------|------|
| 优先级队列 | 按 critical > high > normal > low 优先级排序，同优先级 FIFO |
| 依赖解析 | 检查任务依赖是否全部完成，未完成则等待（标记 waiting_for） |
| 并发控制 | 同时最多执行 3 个任务，达到上限后新任务排队等待 |
| 调度循环 | 每 1s 轮询一次队列，检查可执行的任务 |
| 事件通知 | 调度事件：task_started / task_completed / task_failed / task_dependency_met / queue_empty |
| 失败重试提升 | 重试任务的优先级临时提升一级（避免饿死） |

#### AC-TASK-04 ~ AC-TASK-07 四种执行器详细需求

| 执行器 | 触发条件 | 执行逻辑 | 完成条件 |
|--------|----------|----------|----------|
| SimpleTaskExecutor | task.type === 'simple' | 从 task.action 获取 toolName 和 parameters，调用 context.callTool() | 工具执行完成（成功或失败） |
| CompositeTaskExecutor | task.type === 'composite' | 按 subtaskIds 顺序依次将子任务加入调度队列，等待全部完成 | 所有子任务完成 |
| LoopTaskExecutor | task.type === 'loop' | 按 loopConfig.mode 决定循环方式：count 模式执行 N 次、interval 模式每间隔执行一次、condition 模式条件为 true 时执行 | 达到 maxIterations 或条件不满足 |
| ConditionalTaskExecutor | task.type === 'conditional' | 先评估条件是否满足，不满足则轮询等待（time 模式用定时器、event 模式监听事件、state/expression 模式轮询求值） | 条件满足后执行一次 action |

#### AC-TASK-08 超时管理 + 重试机制详细需求

| 子需求 | 说明 |
|--------|------|
| 超时定时器 | 任务启动时注册超时定时器，超时后标记为失败（reason='timeout'） |
| 默认超时 | 300 秒（可配置），长时间运行的任务（如条件任务）不设超时 |
| 重试机制 | 失败后检查 retryConfig：最大重试次数（默认 3）、初始间隔（默认 30s）、退避乘数（默认 2.0） |
| 指数退避 | 第 1 次重试等待 30s，第 2 次 60s，第 3 次 120s |
| 重试优先级提升 | 重试任务临时提升一级优先级，避免饿死 |

#### AC-TASK-09 ~ AC-TASK-12 任务工具详细需求

| 工具名 | 对应 TaskManager 方法 | 功能 |
|--------|----------------------|------|
| task_create | create() | 创建新任务 |
| task_batch_create | batchCreate() | 批量创建任务 |
| task_query | query() | 按条件查询任务 |
| task_get_by_id | getById() | 按 ID 获取任务详情 |
| task_get_progress | getProgress() | 获取任务进度 |
| task_list | list() | 列出所有任务（分页） |
| task_update | update() | 更新任务属性 |
| task_pause | pause() | 暂停任务 |
| task_resume | resume() | 恢复任务 |
| task_cancel | cancel() | 取消任务 |
| task_retry | retry() | 重试失败任务 |
| task_decompose | decompose() | 分解复杂任务（LLM 辅助） |
| task_set_priority | setPriority() | 设置优先级 |
| task_add_dependency | addDependency() | 添加依赖 |
| task_remove_dependency | removeDependency() | 移除依赖 |
| task_schedule | schedule() | 调度任务执行 |
| task_stats | stats() | 任务统计 |
| task_cleanup | cleanup() | 清理已完成任务 |
| task_export | export() | 导出任务 |
| task_import | import() | 导入任务 |

### 1.4 任务状态机

```
                   ┌──────────────────────────────┐
                   │         pending              │
                   └──┬──────────┬──────────┬─────┘
                      │          │          │
              调度执行 │   暂停   │   取消   │
                      ▼          ▼          ▼
               ┌──────────┐ ┌───────┐ ┌──────────┐
               │ running  │ │paused │ │cancelled │
               └──┬───┬───┘ └──┬────┘ └──────────┘
                  │   │      恢复
              完成 │   │失败    │
                  ▼   ▼       ▼
           ┌──────────┐ ┌───────┐
           │completed │ │failed │
           └──────────┘ └───────┘
               ↑
          failed 但重试后 → pending
```

必须严格执行状态转换，禁止非法转换（如 `pending → completed`）。

### 1.5 任务类型与选择指南

| 类型 | 用途 | 示例 |
|------|------|------|
| simple | 单次操作，调用一个工具 | "挖 10 个钻石" → `mine_block(diamond_ore, 10)` |
| composite | 多个子任务，有依赖关系 | "建造房屋" → 收集材料 → 搭建结构 → 装修 |
| loop | 按次数/间隔/条件重复 | "每 5 分钟巡逻基地" → interval 模式 |
| conditional | 等待条件满足后执行 | "饥饿时吃东西" → 监测 hunger 状态 |

### 1.6 验收标准

| # | 验收条件 | 验证方法 | 测量指标 |
|---|---------|----------|----------|
| 13.1 | 创建 simple 类型任务 | `task_create({type:'simple', action:{toolName:'mine_block', parameters:{target:'diamond_ore'}}})` | 返回 task_id，状态='pending' |
| 13.2 | 创建 composite 类型任务 | 包含 3 个子任务，指定 subtask_ids | 所有子任务创建成功 |
| 13.3 | 创建 loop 类型任务 | loopConfig.mode='count', count=5 | 执行 5 次后自动停止 |
| 13.4 | 创建 conditional 类型任务 | condition.type='time', value=未来时间戳 | 到达时间后自动执行 |
| 13.5 | 任务调度执行 | pending 任务被调度器获取 | 状态变为 'running' |
| 13.6 | 优先级调度 | high 和 low 两个任务同时 pending | high 先执行 |
| 13.7 | 依赖管理 | 任务 B 依赖任务 A | A 完成后 B 自动开始 |
| 13.8 | 并发控制 | 同时 push 5 个任务 | 最多 3 个 running |
| 13.9 | 任务暂停/恢复 | 暂停 running 任务 | 状态变为 paused，恢复后继续 |
| 13.10 | 任务取消 | 取消 pending 任务 | 状态变为 cancelled，不执行 |
| 13.11 | 任务失败重试 | 工具执行失败 | 重试 3 次，间隔递增 |
| 13.12 | 任务分解 | `task_decompose({task_description:'建造房屋'})` | 返回子任务列表（含依赖关系） |
| 13.13 | 任务统计 | 查询 stats | total=当前总数，byType 分布正确 |
| 13.14 | 任务工具全部可调用 | 检查注册的工具列表 | 包含全部 12 个任务工具 |

---

## 第二部分：架构设计

### 2.1 总体架构

```
                        LLM（大脑）
                           │ 任务工具调用
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                      任务系统                                  │
│                                                              │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐   │
│  │  TaskManager   │  │  TaskScheduler  │  │  TaskExecutor │   │
│  │  · CRUD 操作    │  │  · 优先级队列    │  │  · 工具调用    │   │
│  │  · 任务分解     │  │  · 依赖管理     │  │  · 结果收集    │   │
│  │  · 统计导出     │  │  · 并发控制     │  │  · 进度跟踪    │   │
│  └───────┬────────┘  └───────┬────────┘  └──────┬───────┘   │
│          │                   │                   │           │
│  ┌───────▼───────────────────▼───────────────────▼───────┐   │
│  │                  存储层 (SQLite)                        │   │
│  │         task_meta · task_deps · task_schedule         │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │               TaskRunner 执行引擎                          │ │
│  │  简单执行器 · 复合执行器 · 循环执行器 · 条件执行器         │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────┬───────────────────────────────────┘
                           │ 调用工具
                           ▼
                    ┌──────────────┐
                    │  Pipeline 系统 │
                    │  (工具分发执行)  │
                    └──────────────┘
```

### 2.2 核心数据流

#### 创建任务流程

```
LLM 调用 task_create({name:"挖10个钻石", type:"simple", action:{toolName:"mine_block", ...}})
  → TaskManager.create()
    → 验证参数（type/action 合法性）
    → 生成 UUID v4
    → 写入 SQLite task_meta 表（status='pending'）
    → 写入 task_deps 表（如果有 dependencies）
    → 写入 task_schedule 表（如果有 scheduleConfig）
    → 加入 TaskScheduler 调度队列
  → 返回 { task_id, created_at }
```

#### 调度执行流程

```
TaskScheduler 调度循环（每 1s 轮询）:
  → 检查 running 任务数 < maxConcurrent(3)
  → 从队列中取出最高优先级的 pending 任务
  → 检查依赖是否全部完成（task_deps 表查询）
     → 未完成 → 标记 waiting_for，放回队列
     → 已完成 → 交给 TaskExecutor.execute()
       → switch(task.type):
           simple → SimpleTaskExecutor
           composite → CompositeTaskExecutor
           loop → LoopTaskExecutor
           conditional → ConditionalTaskExecutor
       → 更新状态为 'running'
       → 注册超时定时器
       → 执行（调用 context.callTool()）
         → 成功: 标记 'completed'，触发后续依赖任务
         → 失败: 检查 retryConfig → 可重试 → 指数退避后放回队列
```

#### 任务分解流程

```
LLM 调用 task_decompose({task_description:"建造一个简易木屋", context:{...}})
  → TaskManager.decompose()
    → 将 task_description 和 context 发送给 LLM
    → LLM 返回子任务列表（含依赖关系）
    → 解析和验证返回结果
    → 批量创建子任务（通过 create()）
    → 创建复合任务关联这些子任务
  → 返回 { subtasks: [...] }
```

### 2.3 数据库设计

#### 新增 SQLite 表结构

```sql
-- 任务元数据表
CREATE TABLE IF NOT EXISTS task_meta (
  id TEXT PRIMARY KEY,                              -- UUID v4
  workspace_id TEXT NOT NULL,                       -- 所属工作区
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK(type IN ('simple', 'composite', 'loop', 'conditional')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK(priority IN ('critical', 'high', 'normal', 'low')),
  timeout INTEGER,                                  -- 超时（秒）
  tags TEXT NOT NULL DEFAULT '[]',                   -- JSON array
  metadata TEXT,                                    -- 扩展属性 JSON

  -- JSON 字段（按任务类型不同）
  action_json TEXT,                                 -- ToolCall JSON
  subtask_ids TEXT,                                 -- JSON array of string
  loop_config_json TEXT,                            -- LoopConfig JSON
  condition_json TEXT,                              -- Condition JSON
  retry_config_json TEXT,                           -- RetryConfig JSON
  schedule_config_json TEXT,                        -- ScheduleConfig JSON

  -- 执行结果
  result_json TEXT,                                 -- 执行结果 JSON
  error TEXT,                                       -- 错误信息
  retry_count INTEGER NOT NULL DEFAULT 0,

  -- 时间戳
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_task_meta_workspace ON task_meta(workspace_id);
CREATE INDEX IF NOT EXISTS idx_task_meta_status ON task_meta(status);
CREATE INDEX IF NOT EXISTS idx_task_meta_priority ON task_meta(priority);
CREATE INDEX IF NOT EXISTS idx_task_meta_type ON task_meta(type);
CREATE INDEX IF NOT EXISTS idx_task_meta_created ON task_meta(created_at);

-- 任务依赖表
CREATE TABLE IF NOT EXISTS task_deps (
  task_id TEXT NOT NULL,
  depends_on_id TEXT NOT NULL,                       -- 依赖的任务 ID
  PRIMARY KEY (task_id, depends_on_id),
  FOREIGN KEY (task_id) REFERENCES task_meta(id) ON DELETE CASCADE,
  FOREIGN KEY (depends_on_id) REFERENCES task_meta(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_deps_task ON task_deps(task_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_depends ON task_deps(depends_on_id);

-- 任务调度表（定时/延迟任务）
CREATE TABLE IF NOT EXISTS task_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL UNIQUE,
  schedule_mode TEXT NOT NULL CHECK(schedule_mode IN ('immediate', 'delayed', 'cron', 'event')),
  scheduled_at INTEGER,                              -- 计划执行时间（unix timestamp）
  cron_expression TEXT,                              -- cron 表达式
  trigger_event TEXT,                                -- 触发事件名
  last_triggered_at INTEGER,                         -- 上次触发时间
  FOREIGN KEY (task_id) REFERENCES task_meta(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_schedule_scheduled ON task_schedule(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_task_schedule_event ON task_schedule(trigger_event);
```

#### 配置表新增

```sql
INSERT INTO config (key, value, value_type, description) VALUES
('task_max_concurrent', '3', 'number', '最大并发任务数'),
('task_default_timeout', '300', 'number', '默认任务超时（秒）'),
('task_default_retry_count', '3', 'number', '默认重试次数'),
('task_default_retry_delay', '30', 'number', '默认重试间隔（秒）'),
('task_cleanup_keep_recent', '100', 'number', '清理时保留最近任务数');
```

### 2.4 模块接口设计

#### TaskManager 类

```typescript
class TaskManager {
  constructor(config: TaskConfig, sqlite: SQLiteStore, llmProvider?: LLMProvider);

  // ─── 创建 ───
  async create(params: CreateTaskParams): Promise<CreateTaskResult>;
  async batchCreate(params: BatchCreateParams): Promise<BatchCreateResult>;
  async decompose(params: DecomposeParams): Promise<DecomposeResult>;

  // ─── 查询 ───
  async query(params: QueryParams): Promise<QueryResult>;
  async getById(id: string): Promise<Task | null>;
  async getProgress(id: string): Promise<{ progress: number; status: TaskStatus }>;
  async list(params: ListParams): Promise<ListResult>;

  // ─── 更新 ───
  async update(id: string, updates: UpdateTaskParams): Promise<void>;
  async pause(id: string): Promise<void>;
  async resume(id: string): Promise<void>;
  async cancel(id: string, reason?: string): Promise<void>;
  async complete(id: string, result?: any): Promise<void>;
  async fail(id: string, error: string): Promise<void>;

  // ─── 调度 ───
  async schedule(id: string, config: ScheduleConfig): Promise<ScheduleResult>;
  async setPriority(id: string, priority: TaskPriority): Promise<void>;
  async addDependency(id: string, dependsOnId: string): Promise<void>;
  async removeDependency(id: string, dependsOnId: string): Promise<void>;
  async retry(id: string, force?: boolean): Promise<void>;

  // ─── 统计 & 管理 ───
  async stats(): Promise<TaskStats>;
  async cleanup(options?: CleanupOptions): Promise<CleanupResult>;
  async export(options?: ExportOptions): Promise<string>;
  async import(json: string): Promise<ImportResult>;
}
```

#### TaskScheduler 接口

```typescript
interface TaskScheduler {
  /** 启动调度循环 */
  start(): void;
  /** 停止调度循环 */
  stop(): void;
  /** 加入调度队列 */
  enqueue(task: Task): Promise<void>;
  /** 从队列移除 */
  dequeue(taskId: string): Promise<void>;
  /** 获取队列状态 */
  getQueueStatus(): QueueStatus;
  /** 注册调度事件监听 */
  on(event: SchedulerEvent, handler: SchedulerEventHandler): void;
}

interface QueueStatus {
  pendingCount: number;
  runningCount: number;
  maxConcurrent: number;
  queue: Array<{ id: string; priority: TaskPriority; waitingFor?: string[] }>;
}

type SchedulerEvent =
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'task_dependency_met'
  | 'queue_empty';
```

#### TaskRunner 接口（四种执行器统一接口）

```typescript
interface TaskRunner {
  /** 执行任务 */
  execute(task: Task, context: ExecutionContext): Promise<TaskResult>;
  /** 检查任务是否可以执行 */
  canExecute(task: Task): Promise<{ ok: boolean; reason?: string }>;
  /** 估算任务耗时 */
  estimateDuration(task: Task): Promise<number>;
}

interface ExecutionContext {
  workspaceId: string;
  /** 调用其他工具的接口 */
  callTool(toolName: string, params: Record<string, any>): Promise<any>;
  /** 获取子任务 */
  getSubTask(id: string): Promise<Task | null>;
  /** 更新任务进度 */
  updateProgress(taskId: string, progress: number): Promise<void>;
  /** 记录日志 */
  log(taskId: string, message: string): Promise<void>;
  /** 中止信号 */
  abortSignal?: AbortSignal;
}

interface TaskResult {
  success: boolean;
  data?: any;
  error?: string;
  durationMs: number;
}
```

#### 关键类型定义

```typescript
// ==========================================
// V13 新增类型：任务系统
// ==========================================

/** 任务类型 */
export type TaskType = 'simple' | 'composite' | 'loop' | 'conditional';

/** 任务状态 */
export type TaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

/** 任务优先级 */
export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';

/** 任务 — 核心数据模型 */
export interface Task {
  id: string;
  name: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  progress: number;
  action?: ToolCall;
  subtaskIds?: string[];
  loopConfig?: LoopConfig;
  condition?: Condition;
  priority: TaskPriority;
  dependencies?: string[];
  timeout?: number;
  retryConfig?: RetryConfig;
  scheduleConfig?: ScheduleConfig;
  result?: any;
  error?: string;
  retryCount: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
  workspaceId: string;
  tags: string[];
  metadata?: Record<string, any>;
}

/** 工具调用 */
export interface ToolCall {
  toolName: string;
  parameters: Record<string, any>;
}

/** 循环配置 */
export interface LoopConfig {
  mode: 'count' | 'interval' | 'condition';
  count?: number;
  interval?: number;
  condition?: string;
  maxIterations: number;
}

/** 条件配置 */
export interface Condition {
  type: 'time' | 'event' | 'state' | 'expression';
  value: any;
  description?: string;
}

/** 重试配置 */
export interface RetryConfig {
  maxRetries: number;
  retryDelay: number;
  backoffMultiplier?: number;
}

/** 调度配置 */
export interface ScheduleConfig {
  mode: 'immediate' | 'delayed' | 'cron' | 'event';
  delay?: number;
  cron?: string;
  event?: string;
}
```

#### 任务工具 Schema

```typescript
// task_create 工具 Schema
{
  name: 'task_create',
  description: '创建一个新任务，支持 4 种类型：简单/复合/循环/条件',
  category: 'task',
  parameters: {
    name: { type: 'string', description: '任务名称', required: true },
    description: { type: 'string', description: '任务描述', required: true },
    type: { type: 'string', enum: ['simple', 'composite', 'loop', 'conditional'], description: '任务类型', required: true },
    action: { type: 'object', description: '简单/循环/条件任务需要指定调用的工具和参数', required: false },
    subtask_ids: { type: 'array', description: '复合任务的子任务 ID 列表', required: false },
    loop_config: { type: 'object', description: '循环任务的配置', required: false },
    condition: { type: 'object', description: '条件任务的触发条件', required: false },
    priority: { type: 'string', enum: ['critical', 'high', 'normal', 'low'], description: '优先级（默认 normal）', required: false },
    dependencies: { type: 'array', description: '依赖的任务 ID 列表', required: false },
    timeout: { type: 'number', description: '超时时间（秒）', required: false },
    tags: { type: 'array', description: '标签', required: false },
  },
}

// task_query 工具 Schema
{
  name: 'task_query',
  description: '按条件查询任务列表，支持状态/优先级/类型/标签过滤',
  category: 'task',
  parameters: {
    status: { type: 'string', enum: ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'], description: '按状态筛选', required: false },
    priority: { type: 'string', enum: ['critical', 'high', 'normal', 'low'], description: '按优先级筛选', required: false },
    type: { type: 'string', enum: ['simple', 'composite', 'loop', 'conditional'], description: '按类型筛选', required: false },
    tags: { type: 'array', description: '按标签筛选', required: false },
    workspace_id: { type: 'string', description: '工作区 ID', required: false },
    limit: { type: 'number', description: '返回数量上限（默认 20）', required: false },
    offset: { type: 'number', description: '偏移量', required: false },
    sort_by: { type: 'string', enum: ['priority', 'created_at', 'updated_at', 'progress'], description: '排序字段', required: false },
    sort_dir: { type: 'string', enum: ['asc', 'desc'], description: '排序方向', required: false },
  },
}

// task_decompose 工具 Schema
{
  name: 'task_decompose',
  description: '将复杂任务分解为一系列子任务，含依赖关系',
  category: 'task',
  parameters: {
    task_description: { type: 'string', description: '要分解的任务描述', required: true },
    context: { type: 'object', description: '上下文信息（当前资源、位置等）', required: false },
  },
}

// task_control 工具 Schema（统一接口：暂停/恢复/取消/重试）
{
  name: 'task_control',
  description: '控制任务状态：暂停/恢复/取消/重试',
  category: 'task',
  parameters: {
    task_id: { type: 'string', description: '任务 ID', required: true },
    action: { type: 'string', enum: ['pause', 'resume', 'cancel', 'retry'], description: '控制动作', required: true },
    reason: { type: 'string', description: '取消原因（action=cancel 时可选）', required: false },
    force: { type: 'boolean', description: '是否强制重试（action=retry 时可选）', required: false },
  },
}
```

### 2.5 调度算法

```
每轮调度循环（每 1s 执行一次）:

1. 获取当前 running 任务数 runningCount
2. 如果 runningCount >= maxConcurrent(3) → 跳过本轮

3. 从优先级队列中按顺序取出 pending 任务：
   for priority in ['critical', 'high', 'normal', 'low']:
     for task in queue[priority]:
       if runningCount >= maxConcurrent → 停止取出
       if task.status !== 'pending' → 跳过
       if task 有依赖:
         deps = getDependencies(task.id)
         unsatisfied = deps.filter(d => d.status !== 'completed')
         if unsatisfied.length > 0:
           task.waitingFor = unsatisfied.map(d => d.id)
           continue
       → 执行任务
       runningCount++

4. 执行完成后：
   → 成功: emit 'task_completed', 检查后续依赖任务
   → 失败: emit 'task_failed', 检查重试配置
```

### 2.6 四种执行器实现策略

#### SimpleTaskExecutor

```
execute(task, ctx):
  1. 校验 task.action 存在
  2. 调用 ctx.callTool(toolName, parameters)
  3. 收集结果
  4. 工具失败 → 抛出异常，由调度器处理重试
  5. 返回 { success, data, durationMs }
```

#### CompositeTaskExecutor

```
execute(task, ctx):
  1. 校验 task.subtaskIds 存在且非空
  2. 遍历 subtaskIds:
     获取子任务 → 加入调度队列
     等待子任务完成
     更新复合任务进度
  3. 所有子任务完成 → 标记复合任务完成
  4. 子任务失败 → 复合任务标记为失败
```

#### LoopTaskExecutor

```
execute(task, ctx):
  1. 校验 task.loopConfig 和 task.action 存在
  2. 根据 mode 决定循环策略:
     count → 执行 N 次后停止
     interval → 每间隔 N 秒执行一次
     condition → 条件为 true 时执行
  3. 每次循环: 检查中止信号 → 执行 action → 休眠等待
  4. 达到 maxIterations → 自动停止
  5. count 模式更新进度: iteration / count * 100
```

#### ConditionalTaskExecutor

```
execute(task, ctx):
  1. 校验 task.condition 和 task.action 存在
  2. 根据 condition.type 决定等待策略:
     time → 计算目标时间，setTimeout 等待
     event → 监听事件总线，超时返回 false
     state/expression → 轮询求值（1s 间隔）
  3. 条件满足 → 执行一次 action
  4. 超时未满足 → 标记失败
```

### 2.7 关键设计决策

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| **任务状态管理** | 枚举 / 位掩码 / 状态机 | **枚举 + 状态机校验** | 6 种状态清晰可枚举，状态转换规则简单，适合枚举校验 |
| **调度算法** | 简单轮询 / 优先级队列 / 时间片轮转 | **优先级队列 + 依赖解析** | LLM 创建的任务数量有限（通常几十个），优先级队列够用且实现简单 |
| **并发控制方式** | 信号量 / 线程池 / 计数器 | **计数器 + 轮询检查** | 单进程 Node.js，计数器简单可靠，无需额外依赖 |
| **执行器架构** | 策略模式 / 工厂模式 / 责任链 | **策略模式（TaskExecutor 按 type 分发）** | 四种执行器逻辑独立，策略模式扩展性好，新增类型只需添加新执行器 |
| **超时实现** | AbortController / setTimeout / 定时器轮询 | **setTimeout + AbortSignal** | 原生 Node.js 支持，AbortSignal 可传递中止信号给工具调用 |
| **重试策略** | 固定间隔 / 指数退避 / 立即重试 | **指数退避（×2.0）** | 避免重试风暴，给下游系统恢复时间 |
| **任务分解方式** | 规则模板 / LLM 生成 / 混合 | **LLM 辅助生成** | 任务分解依赖语义理解，LLM 最适合；规则模板适用于重复性任务 |
| **存储与内存** | 全 SQLite / 全内存 / 混合 | **SQLite 持久化 + 内存缓存** | 任务数量通常不多（< 1000），全 SQLite 查询足够快，无需额外内存索引 |

### 2.8 文件结构

```
packages/agent-core/src/main/task/
├── index.ts                  # 模块导出
├── types.ts                  # 任务相关类型定义
├── schema.sql               # SQLite DDL 追加
├── task-manager.ts           # TaskManager 统一 API
├── task-scheduler.ts         # TaskScheduler 调度器
├── timeout-manager.ts        # 超时管理
├── executors/
│   ├── index.ts              # 执行器统一导出
│   ├── simple-executor.ts    # SimpleTaskExecutor
│   ├── composite-executor.ts # CompositeTaskExecutor
│   ├── loop-executor.ts      # LoopTaskExecutor
│   └── conditional-executor.ts # ConditionalTaskExecutor
├── tools/
│   ├── index.ts              # 工具统一导出 + TOOL_SCHEMAS 列表
│   ├── task_create.ts        # task_create / task_batch_create
│   ├── task_query.ts         # task_query / task_get_by_id / task_get_progress / task_list
│   ├── task_update.ts        # task_update
│   ├── task_control.ts       # task_pause / task_resume / task_cancel / task_retry
│   ├── task_decompose.ts     # task_decompose
│   └── task_manage.ts        # task_stats / task_cleanup / task_export / task_import

packages/agent-core/__tests__/task/
├── task-manager.test.ts      # TaskManager 单元测试
├── task-scheduler.test.ts    # TaskScheduler 单元测试
├── executors.test.ts         # 四种执行器单元测试
├── task-tools.test.ts        # 任务工具单元测试
└── integration.test.ts       # 集成测试
```

### 2.9 非功能需求

| 指标 | 目标 | 测量方式 |
|------|------|----------|
| 任务创建 | < 10ms（含 SQLite 写入） | 计时日志 |
| 任务查询 | < 20ms（1000 条任务中按条件查询） | 基准测试 |
| 调度循环延迟 | < 1ms（每轮调度检查） | 计时日志 |
| 调度事件响应 | < 100ms（任务完成后触发后续任务） | 计时日志 |
| 简单任务执行开销 | < 5ms（不含工具调用耗时） | 计时日志 |
| 超时检测精度 | ±100ms | 计时日志 |
| 任务分解响应 | < 5s（含 LLM 调用） | 计时日志 |
| 内存占用 | < 10MB（1000 个任务） | 运行时监控 |
| 任务统计查询 | < 50ms | 基准测试 |

---

## 第三部分：实施计划

### 3.1 实施顺序

```
Step 1: SQLite 任务表 DDL + 类型定义
  ↓
Step 2: TaskManager 核心 CRUD 实现
  ↓
Step 3: TaskScheduler 调度器
  ↓
Step 4: TimeoutManager 超时管理
  ↓
Step 5: 四种执行器
  ↓
Step 6: 任务工具（task_create / task_query 等）
  ↓
Step 7: 集成测试
```

### 3.2 详细实施步骤

#### Step 1: SQLite 任务表 DDL + 类型定义

**文件**：
- `packages/agent-core/src/main/task/schema.sql`（新增）
- `packages/agent-core/src/main/task/types.ts`（新增）

**任务**：
1. 创建 `schema.sql`，包含 task_meta / task_deps / task_schedule 三张表的 DDL
2. 创建 `types.ts`，定义 Task / TaskType / TaskStatus / TaskPriority / ToolCall / LoopConfig / Condition / RetryConfig / ScheduleConfig 等类型
3. 定义所有参数的接口（CreateTaskParams / QueryParams / UpdateTaskParams / TaskStats 等）
4. 定义默认配置常量（DEFAULT_TASK_CONFIG）

**预估工时**：3h

#### Step 2: TaskManager 核心 CRUD

**文件**：`packages/agent-core/src/main/task/task-manager.ts`（新增）

**任务**：
1. 实现 `create()` — 创建任务、写入 SQLite、加入调度队列
2. 实现 `batchCreate()` — 批量创建
3. 实现 `query()` — 按条件查询（多条件组合过滤）
4. 实现 `getById()` / `list()` — 单条查询和分页查询
5. 实现 `update()` — 更新任务属性
6. 实现 `pause()` / `resume()` / `cancel()` — 状态管理（含状态机校验）
7. 实现 `complete()` / `fail()` — 内部回调
8. 实现 `setPriority()` / `addDependency()` / `removeDependency()` — 依赖管理
9. 实现 `retry()` — 重试逻辑
10. 实现 `stats()` / `cleanup()` — 统计和清理
11. 实现 `export()` / `import()` — 导入导出

**关键实现要点**：

```typescript
class TaskManager {
  private sqlite: SQLiteStore;
  private scheduler: TaskScheduler;
  private config: TaskConfig;

  async create(params: CreateTaskParams): Promise<CreateTaskResult> {
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);

    // 1. 写入 task_meta
    this.sqlite.run(
      `INSERT INTO task_meta (id, workspace_id, name, description, type, priority, timeout,
        tags, metadata, action_json, subtask_ids, loop_config_json, condition_json,
        retry_config_json, schedule_config_json, retry_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [id, params.workspaceId, params.name, params.description, params.type,
       params.priority || 'normal', params.timeout || this.config.defaults.timeout,
       JSON.stringify(params.tags || []), params.metadata ? JSON.stringify(params.metadata) : null,
       params.action ? JSON.stringify(params.action) : null,
       params.subtaskIds ? JSON.stringify(params.subtaskIds) : null,
       params.loopConfig ? JSON.stringify(params.loopConfig) : null,
       params.condition ? JSON.stringify(params.condition) : null,
       params.retryConfig ? JSON.stringify(params.retryConfig) : null,
       params.scheduleConfig ? JSON.stringify(params.scheduleConfig) : null,
       now, now]
    );

    // 2. 写入依赖
    if (params.dependencies && params.dependencies.length > 0) {
      for (const depId of params.dependencies) {
        this.sqlite.run(
          'INSERT INTO task_deps (task_id, depends_on_id) VALUES (?, ?)',
          [id, depId]
        );
      }
    }

    // 3. 写入调度表
    if (params.scheduleConfig) {
      this.sqlite.run(
        `INSERT INTO task_schedule (task_id, schedule_mode, scheduled_at, cron_expression, trigger_event)
         VALUES (?, ?, ?, ?, ?)`,
        [id, params.scheduleConfig.mode, params.scheduleConfig.delay
          ? now + params.scheduleConfig.delay : null,
         params.scheduleConfig.cron || null, params.scheduleConfig.event || null]
      );
    }

    // 4. 加入调度队列
    const task = await this.getById(id) as Task;
    await this.scheduler.enqueue(task);

    return { id, createdAt: now };
  }
}
```

**预估工时**：8h

#### Step 3: TaskScheduler 调度器

**文件**：`packages/agent-core/src/main/task/task-scheduler.ts`（新增）

**任务**：
1. 实现 `start()` / `stop()` — 调度循环启停
2. 实现 `enqueue()` / `dequeue()` — 队列管理
3. 实现调度循环（每 1s 轮询）
4. 实现优先级排序（critical > high > normal > low）
5. 实现依赖解析（检查 task_deps 表）
6. 实现并发控制（max 3）
7. 实现事件通知（EventEmitter）
8. 实现失败重试（重试任务优先级提升）

**关键实现要点**：

```typescript
class PriorityTaskScheduler implements TaskScheduler {
  private running = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private queue: Task[] = [];
  private runningCount = 0;
  private maxConcurrent: number;
  private pollIntervalMs: number;
  private eventEmitter = new EventEmitter();

  start(): void {
    this.running = true;
    this.pollTimer = setInterval(() => this.scheduleCycle(), this.pollIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async scheduleCycle(): Promise<void> {
    if (this.runningCount >= this.maxConcurrent) return;
    if (this.queue.length === 0) {
      this.eventEmitter.emit('queue_empty');
      return;
    }

    // 按优先级排序
    this.sortByPriority();

    for (const task of this.queue) {
      if (this.runningCount >= this.maxConcurrent) break;
      if (task.status !== 'pending') continue;

      // 检查依赖
      const deps = this.sqlite.queryAll(
        'SELECT td.*, tm.status FROM task_deps td JOIN task_meta tm ON td.depends_on_id = tm.id WHERE td.task_id = ?',
        [task.id]
      );

      const unsatisfied = deps.filter((d: any) => d.status !== 'completed');
      if (unsatisfied.length > 0) {
        task.metadata = { ...task.metadata, waitingFor: unsatisfied.map((d: any) => d.depends_on_id) };
        continue;
      }

      // 执行任务
      this.runningCount++;
      this.queue = this.queue.filter(t => t.id !== task.id);
      this.eventEmitter.emit('task_started', { taskId: task.id, task });

      // 异步执行，不阻塞调度循环
      this.executeTask(task).finally(() => {
        this.runningCount--;
      });
    }
  }

  private sortByPriority(): void {
    const priorityOrder = ['critical', 'high', 'normal', 'low'];
    this.queue.sort((a, b) => {
      const pa = priorityOrder.indexOf(a.priority);
      const pb = priorityOrder.indexOf(b.priority);
      if (pa !== pb) return pa - pb;
      return a.createdAt - b.createdAt; // FIFO
    });
  }

  private async executeTask(task: Task): Promise<void> {
    // 由 TaskExecutor 执行，结果通过回调通知
    // 成功 → emit 'task_completed'
    // 失败 → emit 'task_failed', 检查重试
  }
}
```

**预估工时**：6h

#### Step 4: TimeoutManager 超时管理

**文件**：`packages/agent-core/src/main/task/timeout-manager.ts`（新增）

**任务**：
1. 实现 `register(task)` — 注册超时定时器
2. 实现 `unregister(taskId)` — 取消超时定时器
3. 实现 `refresh(taskId)` — 刷新超时（如进度更新）
4. 超时处理：标记为失败，原因="timeout"，发送中止信号

**预估工时**：2h

#### Step 5: 四种执行器

**文件**：
- `packages/agent-core/src/main/task/executors/index.ts`（新增）
- `packages/agent-core/src/main/task/executors/simple-executor.ts`（新增）
- `packages/agent-core/src/main/task/executors/composite-executor.ts`（新增）
- `packages/agent-core/src/main/task/executors/loop-executor.ts`（新增）
- `packages/agent-core/src/main/task/executors/conditional-executor.ts`（新增）

**任务**：
1. 实现 `TaskExecutor` 统一入口（按 type 分发）
2. 实现 `SimpleTaskExecutor` — 单次工具调用
3. 实现 `CompositeTaskExecutor` — 按序执行子任务
4. 实现 `LoopTaskExecutor` — 三种循环模式
5. 实现 `ConditionalTaskExecutor` — 四种条件等待策略

**预估工时**：8h

#### Step 6: 任务工具

**文件**：
- `packages/agent-core/src/main/task/tools/index.ts`（新增）
- `packages/agent-core/src/main/task/tools/task_create.ts`（新增）
- `packages/agent-core/src/main/task/tools/task_query.ts`（新增）
- `packages/agent-core/src/main/task/tools/task_update.ts`（新增）
- `packages/agent-core/src/main/task/tools/task_control.ts`（新增）
- `packages/agent-core/src/main/task/tools/task_decompose.ts`（新增）
- `packages/agent-core/src/main/task/tools/task_manage.ts`（新增）

**任务**：
1. 创建 `task_create` 工具（含 batch_create）
2. 创建 `task_query` 工具（含 get_by_id / get_progress / list）
3. 创建 `task_update` 工具
4. 创建 `task_control` 工具（pause / resume / cancel / retry）
5. 创建 `task_decompose` 工具（LLM 辅助分解）
6. 创建 `task_manage` 工具（stats / cleanup / export / import / set_priority / add_dependency / remove_dependency / schedule）
7. 注册所有工具到 TOOL_SCHEMAS 列表

**预估工时**：10h

#### Step 7: 集成测试

**文件**：
- `packages/agent-core/__tests__/task/task-manager.test.ts`（新增）
- `packages/agent-core/__tests__/task/task-scheduler.test.ts`（新增）
- `packages/agent-core/__tests__/task/executors.test.ts`（新增）
- `packages/agent-core/__tests__/task/task-tools.test.ts`（新增）
- `packages/agent-core/__tests__/task/integration.test.ts`（新增）

**任务**：
1. 编写 TaskManager 单元测试（CRUD + 状态机 + 统计）
2. 编写 TaskScheduler 单元测试（优先级 + 依赖 + 并发）
3. 编写四种执行器单元测试
4. 编写任务工具单元测试
5. 集成测试：全链路验证（创建 → 调度 → 执行 → 完成）

**预估工时**：6h

### 3.3 任务分配

#### 开发者 A 任务

| # | 任务 | 产出物 | 预计工时 |
|---|------|--------|:--------:|
| A13.1 | task_create 工具（含 batch_create） | `src/main/task/tools/task_create.ts` | 3h |
| A13.2 | task_query 工具（含 get_by_id / get_progress / list） | `src/main/task/tools/task_query.ts` | 2h |
| A13.3 | task_update 工具 | `src/main/task/tools/task_update.ts` | 1h |
| A13.4 | task_control 工具（pause/resume/cancel/retry） | `src/main/task/tools/task_control.ts` | 2h |
| A13.5 | task_decompose 工具（LLM 辅助分解） | `src/main/task/tools/task_decompose.ts` | 2h |

#### 开发者 B 任务

| # | 任务 | 产出物 | 预计工时 |
|---|------|--------|:--------:|
| B13.1 | SQLite 任务表 DDL + 类型定义 | `src/main/task/schema.sql` + `types.ts` | 3h |
| B13.2 | TaskManager 核心 CRUD | `src/main/task/task-manager.ts` | 8h |
| B13.3 | TaskScheduler 调度器 | `src/main/task/task-scheduler.ts` | 6h |
| B13.4 | TimeoutManager 超时管理 | `src/main/task/timeout-manager.ts` | 2h |
| B13.5 | 四种执行器（Simple / Composite / Loop / Conditional） | `src/main/task/executors/` | 8h |
| B13.6 | task_manage 工具（stats/cleanup/export/import/依赖管理/调度） | `src/main/task/tools/task_manage.ts` | 3h |
| B13.7 | 模块入口 + 工具注册 | `src/main/task/index.ts` + `tools/index.ts` | 1h |

**实施顺序**：B13.1 → B13.2 → B13.3 → B13.4 → B13.5 → B13.6 → B13.7 → A13.1 → A13.2 → A13.3 → A13.4 → A13.5

---

### 3.4 文件变更清单

#### 新增文件

```
packages/agent-core/src/main/task/
├── index.ts                     # 模块导出
├── types.ts                     # 任务类型定义
├── schema.sql                   # SQLite DDL
├── task-manager.ts              # TaskManager API
├── task-scheduler.ts            # TaskScheduler 调度器
├── timeout-manager.ts           # 超时管理
├── executors/
│   ├── index.ts                 # 执行器统一导出
│   ├── simple-executor.ts       # SimpleTaskExecutor
│   ├── composite-executor.ts    # CompositeTaskExecutor
│   ├── loop-executor.ts         # LoopTaskExecutor
│   └── conditional-executor.ts  # ConditionalTaskExecutor
├── tools/
│   ├── index.ts                 # 工具统一导出 + TOOL_SCHEMAS
│   ├── task_create.ts           # task_create / task_batch_create
│   ├── task_query.ts            # task_query / task_get_by_id / task_get_progress / task_list
│   ├── task_update.ts           # task_update
│   ├── task_control.ts          # task_pause / task_resume / task_cancel / task_retry
│   ├── task_decompose.ts        # task_decompose
│   └── task_manage.ts           # task_stats / task_cleanup / task_export / task_import / 依赖/调度

packages/agent-core/__tests__/task/
├── task-manager.test.ts          # TaskManager 测试
├── task-scheduler.test.ts        # TaskScheduler 测试
├── executors.test.ts             # 执行器测试
├── task-tools.test.ts            # 工具测试
└── integration.test.ts           # 集成测试
```

#### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `packages/agent-core/src/main/memory/schema.sql` | 追加 task_meta / task_deps / task_schedule 三张表 DDL |
| `packages/agent-core/src/main/memory/types.ts` | 追加任务系统相关类型定义 |
| `packages/agent-core/src/main/memory/index.ts` | 导出 TaskManager / TaskScheduler / 执行器 |
| `packages/agent-core/src/main/trigger/index.ts` | 留空，V14 实现事件触发器 |
| `packages/agent-core/src/main/index.ts` | 在初始化流程中启动 TaskScheduler |

---

## 第四部分：测试计划

### 4.1 TaskManager 单元测试

| # | 测试用例 | 输入 | 预期结果 |
|---|---------|------|----------|
| 1.1 | 创建 simple 任务 | `create({name:'test', type:'simple', action:{toolName:'mine_block', parameters:{}}})` | 返回 id，状态='pending' |
| 1.2 | 创建 composite 任务 | `create({name:'test', type:'composite', subtaskIds:['id1','id2']})` | 创建成功，subtaskIds 正确 |
| 1.3 | 创建 loop 任务 | `create({name:'test', type:'loop', loopConfig:{mode:'count', count:5, maxIterations:100}})` | 创建成功，loopConfig 正确 |
| 1.4 | 创建 conditional 任务 | `create({name:'test', type:'conditional', condition:{type:'time', value:1000}})` | 创建成功，condition 正确 |
| 1.5 | 按 ID 查询 | `getById('task_001')` | 返回完整 Task 对象 |
| 1.6 | 按状态过滤查询 | `query({filter:{status:'pending'}})` | 只返回 pending 任务 |
| 1.7 | 更新任务属性 | `update('task_001', {priority:'high'})` | priority 更新为 'high' |
| 1.8 | 暂停任务 | `pause('task_001')`（running 状态） | 状态变为 'paused' |
| 1.9 | 恢复任务 | `resume('task_001')`（paused 状态） | 状态变为 'pending' |
| 1.10 | 取消任务 | `cancel('task_001')`（pending 状态） | 状态变为 'cancelled' |
| 1.11 | 非法状态转换 | `pause('task_001')`（completed 状态） | 抛出错误 |
| 1.12 | 添加依赖 | `addDependency('task_B', 'task_A')` | task_deps 表新增记录 |
| 1.13 | 任务统计 | `stats()` | 返回正确的统计信息 |
| 1.14 | 清理任务 | `cleanup({keepRecent:10})` | 清理后保留最近 10 条 |
| 1.15 | 导出/导入 | `export()` → `import(json)` | 导入后数量一致 |

### 4.2 TaskScheduler 单元测试

| # | 测试用例 | 输入 | 预期结果 |
|---|---------|------|----------|
| 2.1 | 启动调度器 | `start()` | 调度循环开始，pollTimer 不为空 |
| 2.2 | 停止调度器 | `stop()` | 调度循环停止，pollTimer 为空 |
| 2.3 | 单任务调度 | enqueue 1 个 pending 任务 | 任务被调度执行 |
| 2.4 | 优先级排序 | enqueue 2 个任务（high, low） | high 先执行 |
| 2.5 | 同优先级 FIFO | enqueue 2 个任务（同 priority） | 先创建的先执行 |
| 2.6 | 依赖解析 | 任务 B 依赖任务 A，A 未完成 | B 等待，不执行 |
| 2.7 | 依赖满足后执行 | A 完成后，检查 B | B 自动开始执行 |
| 2.8 | 并发控制 | enqueue 5 个任务（maxConcurrent=3） | 最多 3 个 running |
| 2.9 | 空队列事件 | 队列为空时 | emit 'queue_empty' |
| 2.10 | 重试优先级提升 | 失败任务重试 | 优先级临时提升一级 |

### 4.3 执行器单元测试

| # | 测试用例 | 执行器 | 输入 | 预期结果 |
|---|---------|--------|------|----------|
| 3.1 | 简单任务成功 | Simple | `action={toolName:'test', parameters:{}}`，callTool 返回成功 | 返回 success=true |
| 3.2 | 简单任务失败 | Simple | callTool 抛出异常 | 返回 success=false |
| 3.3 | 简单任务无 action | Simple | 未设置 action | 返回错误 |
| 3.4 | 复合任务顺序执行 | Composite | 3 个子任务 | 按顺序执行 |
| 3.5 | 复合任务子任务失败 | Composite | 某个子任务失败 | 复合任务标记失败 |
| 3.6 | 循环计数模式 | Loop | count=5 | 执行 5 次 |
| 3.7 | 循环间隔模式 | Loop | interval=1s | 每 1s 执行一次 |
| 3.8 | 循环条件模式 | Loop | condition='task.progress<50' | 条件满足时执行 |
| 3.9 | 循环 maxIterations | Loop | maxIterations=3 | 超过 3 次后停止 |
| 3.10 | 条件时间模式 | Conditional | type='time' | 到达时间后执行 |
| 3.11 | 条件超时 | Conditional | timeout=1s，条件不满足 | 标记失败 |

### 4.4 工具测试

| # | 测试用例 | 工具 | 输入 | 预期结果 |
|---|---------|------|------|----------|
| 4.1 | 创建工具 | task_create | `{name:'test', type:'simple', ...}` | 返回 task_id |
| 4.2 | 查询工具 | task_query | `{status:'pending'}` | 返回任务列表 |
| 4.3 | 获取进度 | task_get_progress | `{task_id:'...'}` | 返回 progress 和 status |
| 4.4 | 更新工具 | task_update | `{task_id:'...', priority:'high'}` | 更新成功 |
| 4.5 | 控制工具 | task_control | `{task_id:'...', action:'pause'}` | 暂停成功 |
| 4.6 | 分解工具 | task_decompose | `{task_description:'建造房屋'}` | 返回子任务列表 |
| 4.7 | 统计工具 | task_stats | 无参数 | 返回统计信息 |

### 4.5 集成测试

| # | 测试场景 | 步骤 | 预期结果 |
|---|---------|------|----------|
| 5.1 | 全链路：创建 → 调度 → 执行 → 完成 | 1. 创建 simple 任务<br>2. 启动调度器<br>3. 等待执行完成 | 任务状态：pending → running → completed |
| 5.2 | 全链路：依赖链 | 1. 创建任务 A、B（B 依赖 A）<br>2. 启动调度器<br>3. 等待 | A 先执行，A 完成后 B 自动执行 |
| 5.3 | 全链路：失败重试 | 1. 创建 simple 任务（callTool 会失败）<br>2. 启动调度器<br>3. 等待 | 重试 3 次，每次间隔递增，最终标记 failed |
| 5.4 | 全链路：暂停恢复 | 1. 创建任务<br>2. 启动调度器<br>3. 暂停任务<br>4. 恢复任务 | 状态：pending → running → paused → pending → running |
| 5.5 | 全链路：任务分解 | 1. 调用 task_decompose<br>2. 创建子任务<br>3. 执行所有子任务 | 子任务全部完成，复合任务标记 completed |
| 5.6 | 持久化验证 | 1. 创建多个任务<br>2. 重启 Agent Core<br>3. 查询任务 | 重启前创建的任务仍可查询，状态不变 |

---

## 第五部分：集成检查点

- [ ] task_create 可创建 4 种类型任务（simple / composite / loop / conditional）
- [ ] task_query 可按状态/优先级/类型/标签过滤
- [ ] task_control 可暂停/恢复/取消/重试任务
- [ ] task_decompose 可将复杂目标分解为子任务列表
- [ ] TaskScheduler 按优先级调度，同优先级 FIFO
- [ ] 依赖解析正确：依赖未完成的任务等待，完成后自动触发
- [ ] 并发控制：最多 3 个任务同时执行
- [ ] 失败重试：指数退避（30s / 60s / 120s），最多 3 次
- [ ] 超时检测：超时任务自动标记为失败
- [ ] 四种执行器均可正常运行
- [ ] 任务统计准确（总数 / 按状态分布 / 按类型分布 / 完成率）
- [ ] 任务清理可正确删除过期任务
- [ ] 任务导出/导入数据完整
- [ ] 重启后任务状态不丢失

---

## 第六部分：风险与应对

| 风险 | 影响 | 概率 | 应对措施 |
|------|------|:----:|----------|
| 任务分解调用 LLM 耗时过长 | 用户等待时间长 | 中 | 默认超时 10s，问题响应超时合理，或返回缓存结果供用户调整 |
| 并发任务过多导致工具调用冲突 | 工具执行结果不可预期 | 中 | 并发控制 max 3，且工具调用通过 Pipeline 系统的 Batch 机制管理 |
| 条件任务的事件等待无响应 | 任务永远处于 waiting 状态 | 低 | 条件任务设置超时，超时后标记为失败，不阻塞调度器 |
| 循环任务无限循环 | 资源耗尽 | 低 | maxIterations 默认 100，强制上限，循环次数超过后自动停止 |
| 任务状态机非法转换 | 数据不一致 | 低 | 状态转换方法中做严格校验，非法转换抛出异常 |
| 数据库写入失败导致任务丢失 | 任务数据丢失 | 低 | 写入操作使用事务，失败时回滚，调度器捕获异常后重试 |