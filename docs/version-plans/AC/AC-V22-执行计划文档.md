# AC-V22 + 任务工具收敛 — 执行计划文档

> 日期：2026-07-16
> 关联设计文档：
> - [14-任务与目标规划工具设计.md](../../tools/14-任务与目标规划工具设计.md)（v2.0，6 工具）
> - [AC-V22-LLM工作流编排新架构-设计文档.md](../version-plans/AC/AC-V22-LLM工作流编排新架构-设计文档.md)

---

## 1. 任务目标

1. **任务工具收敛**：把现有 20 个 task_* 工具收敛为 6 个（task_create / task_query / task_update / task_control / task_decompose / task_manage）
2. **V22 元编排层**：在 V20 MainAgent 之上新增 Orchestrator 包装层，实现执行计划/进展状态/技能注入/记忆压缩/update_plan 工具

## 2. 执行阶段

### 阶段 1：任务工具收敛（20→6）
- 重写 `task/tools/index.ts` 导出 6 个 ToolSchema
- 重写 `task/tools/task_create.ts`（单条+批量合一）
- 重写 `task/tools/task_query.ts`（detail/progress/list 三模式）
- 扩展 `task/tools/task_update.ts`（补 metadata/retry_config）
- 重写 `task/tools/task_manage.ts`（9 action 合并）
- task_control / task_decompose 保持不变
- TaskManager 后端方法全部复用，不改

### 阶段 2：V22 元编排层骨架
- 新建 `orchestration/types.ts`（ExecutionPlan / PlanTodo / ProgressState / TaskMemory 等类型）
- 新建 `orchestration/index.ts`（模块聚合导出）
- 新建 `orchestration/orchestrator.ts`（Orchestrator 主体）

### 阶段 3：PlanManager + update_plan 工具
- 新建 `orchestration/plan-manager.ts`
- 新建 `orchestration/plan-store.ts`（SQLite DAO）
- 新建 `orchestration/tools/update-plan.ts`（工具 schema + handler）

### 阶段 4：ProgressStateManager + MemoryCompressor
- 新建 `orchestration/progress-state-manager.ts`
- 新建 `orchestration/memory-compressor.ts`

### 阶段 5：SkillInjector + 技能文档
- 新建 `orchestration/skill-injector.ts`
- 新建 `orchestration/skills/plan-mode.md`
- 新建 `orchestration/skills/execute.md`
- 新建 `orchestration/skills/transfer.md`
- 新建 `orchestration/skills/summarize.md`

### 阶段 6：TaskMemoryStore + LongTermMemoryHook
- 新建 `orchestration/task-memory-store.ts`
- 新建 `orchestration/long-term-memory-hook.ts`

### 阶段 7：MainAgentRegistry + ActionExecutor 改造
- 修改 `agent/main-agent-registry.ts`（Orchestrator 1:1 绑定）
- 修改 `trigger/action-executor.ts`（注入 Orchestrator）
- 修改 `trigger/types.ts`（EventTrigger 加 complex 字段）

### 阶段 8：PromptBuilder 扩展 + 集成
- 修改 `prompt/types.ts`（BuildParams.extraContext 加 progress/skills）
- 修改 `prompt/builder/prompt-builder.ts`（注入区域 7/8）
- 修改 `prompt/builder/system-prompt-builder.ts`（追加区域 7/8）
- 编译验证

## 3. 进展状态

（执行过程中动态更新，≤200 token）

## 4. 关键接口摘要

- TaskManager: create/batchCreate/query/getById/getProgress/update/pause/resume/cancel/retry/setPriority/addDependency/removeDependency/schedule/decompose/stats/cleanup/export/import
- MainAgent: handle(event: MainAgentEvent): Promise<MainAgentResult>
- MainAgentRegistry: get(ws,agentId) / getSync(ws,agentId)
- ActionExecutorDeps.mainAgentProvider: (params) => { handle(event) } | undefined
- BuildParams.extraContext: Record<string, unknown>
- ToolSchema: { name, description, parameters: Record<string, ParamDefinition>, category }
- ToolResult<T>: { success, data?, error?, duration? }
