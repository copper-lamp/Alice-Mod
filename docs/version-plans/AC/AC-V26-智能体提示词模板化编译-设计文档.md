# AC-V26 智能体提示词模板化编译 — 设计文档

## 1. 概述

### 1.1 背景

当前智能体提示词在**每次运行时**通过 `SystemPromptBuilder.build()` 将 `AgentProfile` 中的各部
分（身份、个性、规则、工作流、沟通风格、边界等）动态组装成系统提示词。这种方式存在以下问题：

- **运行时开销**：每次 LLM 调用都需要重新组装字符串，即便 profile 未变更
- **缓存脆弱**：缓存 key 依赖 profile hash，新增字段或片段会频繁失效
- **调试困难**：无法直观看到智能体最终使用的完整提示词，只能通过 debug 面板临时组装
- **前后端不一致**：`agent-profile-mapper.ts` 映射逻辑与 `system-prompt-builder.ts` 组装逻辑
  分离，修改一处容易遗漏另一处

### 1.2 目标

引入**提示词模板化编译**机制：

1. **创建时编译**：智能体创建完成后，根据模板 + 用户配置生成完整的系统提示词文本，持久化存储
2. **运行时直接使用**：运行时直接加载预编译的完整提示词，不再动态组装（特殊动态片段除外）
3. **更新时重新编译**：智能体配置变更时自动重新编译提示词
4. **兼容增量**：保留动态片段机制（如 `peer_context`、任务进展、技能注入），在预编译提示词
   基础上追加

### 1.3 核心思路

```
[创建/更新]  →  编译系统提示词  →  存入 DB  →  [运行时]  →  加载预编译提示词 + 动态追加
```

## 2. 当前架构分析

### 2.1 数据流现状

```
AgentCreateWizard  →  AgentConfig (JSON)  →  SQLite (agents 表)
                                                   ↓
                                          运行时 mapAgentConfigToProfile()
                                                   ↓
                                          AgentProfile
                                                   ↓
                                          SystemPromptBuilder.build()
                                                   ↓
                                          系统提示词文本
```

### 2.2 关键文件

| 文件 | 职责 |
|------|------|
| `src/main/prompt/builder/system-prompt-builder.ts` | 动态组装系统提示词（6 区域） |
| `src/main/prompt/builder/prompt-builder.ts` | 编排完整消息构建 |
| `src/main/agent/agent-profile-mapper.ts` | AgentConfig → AgentProfile 映射 |
| `src/main/prompt/types.ts` | AgentProfile 等类型定义 |
| `src/main/agent/agent-config-manager.ts` | AgentConfig 的 CRUD + 持久化 |
| `src/main/prompt/prompt-template-manager.ts` | 模板管理（身份/工作流/性格/行为） |
| `src/main/prompt/agent/identity-templates.ts` | 内置身份模板 |
| `src/main/prompt/agent/prompt-fragments.ts` | 提示词片段管理器 |
| `src/main/ipc/debug-handler.ts` | debug 面板的提示词组装 |

### 2.3 系统提示词结构

当前 `DefaultSystemPromptBuilder.build()` 输出 6 个区域：

```
[system_begin 片段]
[区域1] 你是谁（identity + expertise）
[区域2] 你的个性（personality）
[区域3] 行为准则（rules.core）
[区域4] 工作方式（workflowDescription）
[区域5] 沟通与边界（communicationStyle + boundaries）
[system_end 片段]
```

## 3. 设计方案

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        创建/更新流程                          │
│                                                             │
│  AgentCreateWizard  →  AgentConfig                          │
│                              │                              │
│                              ↓                              │
│                    PromptCompiler.compile()                  │
│                              │                              │
│                    ┌─────────┴──────────┐                   │
│                    ↓                    ↓                   │
│              AgentConfig          compiled_prompt           │
│              (存入 agents 表)      (存入 agents 表)          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                           │
                           ↓ 运行时
┌─────────────────────────────────────────────────────────────┐
│                    推理流程                                  │
│                                                             │
│  MainAgent.handle()                                         │
│      │                                                      │
│      ├─ 从 DB 加载 compiled_prompt                          │
│      ├─ 作为 systemOverride 传入 PromptBuilder.build()       │
│      ├─ PromptBuilder 追加动态片段（peer_context, 任务进展）  │
│      └─ 组装完整 messages → 发送 LLM                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 PromptCompiler 模块

新增 `src/main/prompt/compiler/prompt-compiler.ts`，核心职责：

1. 接收 `AgentConfig` + 身份模板 + 工作流模板等上下文
2. 调用 `SystemPromptBuilder.build()` 输出完整系统提示词文本
3. 将文本返回给调用方，由 `AgentConfigManager` 存入数据库

**为什么不重新发明组装逻辑？** 复用现有的 `SystemPromptBuilder.build()`，该函数已经包含了
完整的 6 区域组装逻辑。编译的本质就是**提前调用 build() 并存储结果**。

```typescript
// PromptCompiler 接口设计
export interface PromptCompiler {
  /**
   * 编译智能体系统提示词
   * @param config AgentConfig（wizard 写入的原始配置）
   * @param options 编译选项（可选）
   * @returns 编译后的完整系统提示词文本
   */
  compile(config: AgentConfig, options?: CompileOptions): string;

  /**
   * 重新编译（当配置变更时）
   */
  recompile(agentId: string): string;
}
```

### 3.3 数据库变更

在 `agents` 表新增字段：

```sql
ALTER TABLE agents ADD COLUMN compiled_prompt TEXT;
```

兼容性：旧数据该字段为 `NULL`，运行时检测到 `NULL` 时走回退路径（动态组装）。

### 3.4 创建流程变更

**修改前：**

```
AgentConfigManager.create() → 存入 agents 表 → 返回 id
```

**修改后：**

```
AgentConfigManager.create()
  → 调用 PromptCompiler.compile(config) 生成 compiled_prompt
  → 存入 agents 表（含 compiled_prompt 字段）
  → 返回 id
```

### 3.5 更新流程变更

**修改前：**

```
AgentConfigManager.update() → 更新 agents 表
```

**修改后：**

```
AgentConfigManager.update()
  → 更新 agents 表
  → 调用 PromptCompiler.recompile(agentId) 重新编译
  → 更新 compiled_prompt 字段
```

### 3.6 运行时加载流程

**修改前：** `main-agent.ts` 中：

```typescript
const profile = mapAgentConfigToProfile(this.deps.agentConfig);
this.deps.promptBuilder.updateProfile(profile);
const promptResult = await this.deps.promptBuilder.build(buildParams);
```

**修改后：**

```typescript
// 优先使用预编译提示词
const compiledPrompt = this.deps.agentConfig.compiledPrompt;
if (compiledPrompt) {
  // 使用预编译提示词作为 systemOverride
  buildParams.systemOverride = compiledPrompt;
} else {
  // 兼容旧数据：走动态组装
  const profile = mapAgentConfigToProfile(this.deps.agentConfig);
  this.deps.promptBuilder.updateProfile(profile);
}
const promptResult = await this.deps.promptBuilder.build(buildParams);
```

### 3.7 动态片段处理

使用预编译提示词时，以下动态片段仍需在运行时追加：

| 动态片段 | 处理方式 |
|---------|---------|
| `peer_context`（跨 Agent 上下文） | PromptBuilder 在 systemOverride 末尾追加 |
| 任务进展（`progress`） | PromptBuilder 在 systemOverride 末尾追加 |
| 当前技能（`skills`） | PromptBuilder 在 systemOverride 末尾追加 |
| `system_begin`/`system_end` 片段 | 编译时已合并到 compiled_prompt 中 |
| `before_tools`/`after_tools` 片段 | 编译时已合并到 compiled_prompt 中 |

**实现细节：** `PromptBuilder.build()` 中，当 `systemOverride` 存在时，跳过
`SystemPromptBuilder.build()` 调用，但仍执行 `peerContext`、`progress`、`skills` 等
动态片段的追加逻辑。当前代码已支持此行为（见 `prompt-builder.ts` 第 86-112 行）。

### 3.8 兼容旧数据

对于已存在的智能体（`compiled_prompt IS NULL`）：

1. 首次运行时检测到 `compiled_prompt` 为空
2. 走现有动态组装路径（`SystemPromptBuilder.build()`）
3. 可选：在后台异步编译并回填 `compiled_prompt`

```typescript
// 惰性编译：首次运行时自动编译并回填
if (!config.compiledPrompt) {
  const compiled = promptCompiler.compile(config);
  await agentConfigManager.updateCompiledPrompt(agentId, compiled);
  config.compiledPrompt = compiled;
}
```

## 4. 变更文件清单

### 4.1 新增文件

| 文件 | 说明 |
|------|------|
| `src/main/prompt/compiler/prompt-compiler.ts` | 提示词编译器 |
| `src/main/prompt/compiler/index.ts` | 导出 |
| `src/main/prompt/index.ts` | 更新导出 |

### 4.2 修改文件

| 文件 | 变更内容 |
|------|---------|
| `src/main/agent/agent-config-manager.ts` | `create()` 和 `update()` 中调用编译；新增 `updateCompiledPrompt()` |
| `src/main/agent/agent-profile-mapper.ts` | 无变更（编译逻辑复用现有 `SystemPromptBuilder`） |
| `src/main/agent/main-agent.ts` | 运行时加载 `compiledPrompt` 作为 `systemOverride` |
| `src/main/prompt/builder/prompt-builder.ts` | 无变更（已支持 `systemOverride` 路径） |
| `src/main/prompt/types.ts` | 无变更（`AgentProfile` 不变） |
| `src/renderer/src/lib/types.ts` | `AgentConfig` 接口新增 `compiledPrompt` 字段 |
| `src/main/database/database-manager.ts` | Schema 迁移：添加 `compiled_prompt` 列 |

### 4.3 不变文件

| 文件 | 说明 |
|------|------|
| `system-prompt-builder.ts` | 编译逻辑复用此模块，无需修改 |
| `template-engine.ts` | 模板引擎无需修改 |
| `prompt-template-manager.ts` | 模板管理无需修改 |
| `identity-templates.ts` | 身份模板无需修改 |
| `workflow-templates.ts` | 工作流模板无需修改 |
| `debug-handler.ts` | debug 面板仍可独立组装提示词 |

## 5. 数据流详细说明

### 5.1 创建智能体

```
用户填写向导 → 点击"确定"
  → wizardStore.submit()
    → IPC: agent:create
      → AgentConfigManager.create(config)
        → 1. 生成 id
        → 2. PromptCompiler.compile(config)  →  compiled_prompt
        → 3. INSERT INTO agents (...) VALUES (..., compiled_prompt)
        → 4. AgentFileExporter.export()  (现有导出逻辑)
        → 5. 返回 id
```

### 5.2 更新智能体

```
用户编辑配置 → 保存
  → IPC: agent:update
    → AgentConfigManager.update(id, partialConfig)
      → 1. 合并配置
      → 2. PromptCompiler.recompile(id)  →  new compiled_prompt
      → 3. UPDATE agents SET ... compiled_prompt = ? WHERE id = ?
      → 4. AgentFileExporter.export()  (现有导出逻辑)
```

### 5.3 运行时推理

```
MainAgent.handle(event)
  → 1. 加载 AgentConfig
  → 2. 如果 compiledPrompt 存在
       → buildParams.systemOverride = compiledPrompt
    否则
       → mapAgentConfigToProfile() + updateProfile() (兼容旧数据)
  → 3. PromptBuilder.build(buildParams)
       → 检测 systemOverride 存在
       → 跳过 SystemPromptBuilder.build()
       → 仍追加 peer_context / progress / skills 等动态片段
       → 返回 messages
  → 4. 发送 LLM
```

## 6. PromptCompiler 实现细节

### 6.1 compile 方法

```typescript
compile(config: AgentConfig, options?: CompileOptions): string {
  // 1. AgentConfig → AgentProfile（复用现有映射）
  const profile = mapAgentConfigToProfile(config);

  // 2. 构建系统提示词（复用现有构建器）
  const systemPrompt = this.systemPromptBuilder.build(profile);

  // 3. 可选：注入额外固定片段（如工具使用规范、安全规则等）
  const finalPrompt = options?.extraSections
    ? this.appendExtraSections(systemPrompt, options.extraSections)
    : systemPrompt;

  return finalPrompt;
}
```

### 6.2 缓存与失效

- 编译结果存入 `agents.compiled_prompt` 字段
- 配置变更时（`update()`）重新编译
- 无需额外的缓存失效逻辑（依赖数据库的读写一致性）

### 6.3 编译时机触发

编译触发点在 `AgentConfigManager` 中：

```typescript
// create() 中
const compiled = new PromptCompiler().compile(config);

// update() 中
const updatedConfig = { ...existing, ...config, updatedAt: Date.now() };
const compiled = new PromptCompiler().compile(updatedConfig);
```

## 7. 边界情况

### 7.1 旧数据兼容

- 存量数据 `compiled_prompt` 为 `NULL`
- 运行时检测到 `NULL` → 走动态组装路径
- 提供惰性编译：首次运行时自动编译并回填

### 7.2 模板变更

- 内置身份模板、工作流模板变更时，已编译的提示词不会自动更新
- 解决方案：下次智能体配置编辑保存时自动重新编译
- 长期方案：可以添加 `compiledVersion` 字段，当模板版本号变化时提示用户重新编译

### 7.3 动态片段完整性

使用预编译提示词时，需确保所有动态片段（`peer_context`、`progress`、`skills`）仍能正确注入。
当前 `PromptBuilder` 的 `systemOverride` 路径已支持追加动态片段，无需额外修改。

### 7.4 提示词长度

预编译提示词的长度上限取决于数据库字段类型（`TEXT` 无上限），但需注意：
- 编译后的提示词应控制在合理范围内（建议不超过 4096 tokens）
- 超长提示词在运行时可能超出 LLM 上下文窗口

## 8. 测试要点

| 测试场景 | 预期结果 |
|---------|---------|
| 创建新智能体 | `compiled_prompt` 字段非空，内容与手动组装一致 |
| 编辑智能体配置 | 重新编译，`compiled_prompt` 更新 |
| 旧数据智能体运行 | 走动态组装路径，功能正常 |
| 旧数据首次运行后 | 惰性编译回填 `compiled_prompt` |
| 运行时动态片段 | `peer_context`/`progress`/`skills` 正确追加到预编译提示词后 |
| 变更身份模板后编辑 | 重新编译，体现新模板内容 |
| 数据库迁移 | 已有 `agents` 表添加新列，旧数据 `compiled_prompt` 为 NULL |

## 9. 附录

### 9.1 相关现有文件

- `src/main/prompt/builder/system-prompt-builder.ts` — 系统提示词构建器（编译复用）
- `src/main/prompt/builder/prompt-builder.ts` — 提示词编排器（systemOverride 路径）
- `src/main/agent/agent-config-manager.ts` — AgentConfig CRUD（编译触发点）
- `src/main/agent/agent-profile-mapper.ts` — AgentConfig → AgentProfile 映射
- `src/main/agent/main-agent.ts` — 运行时入口（加载 compiledPrompt）
- `src/main/prompt/types.ts` — AgentProfile 类型定义
- `src/renderer/src/lib/types.ts` — AgentConfig 类型定义（含 compiledPrompt 字段）

### 9.2 关键决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 编译时机 | 创建/更新时同步编译 | 避免运行时首次编译的延迟 |
| 存储位置 | `agents.compiled_prompt` 列 | 与 AgentConfig 同表，无需额外 JOIN |
| 编译实现 | 复用 `SystemPromptBuilder.build()` | 无需重复实现组装逻辑 |
| 动态片段 | 运行时在预编译文本上追加 | 保持动态信息的实时性 |
| 旧数据兼容 | 运行时检测 NULL 走回退路径 | 零迁移成本 |

### 9.3 版本标识

本设计文档版本：V1.0
对应 AC 版本：V26