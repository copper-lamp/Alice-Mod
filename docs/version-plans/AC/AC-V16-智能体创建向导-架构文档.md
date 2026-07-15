# Alice Mod Core V16 — 智能体创建向导 架构文档

> 版本：v1.0
> 日期：2026-07-15
> 版本号：V16
> 关联文档：[AC-V16-智能体创建向导-需求文档.md](AC-V16-智能体创建向导-需求文档.md)、[AC-V8-主控制面板与游戏状态面板.md](AC-V8-主控制面板与游戏状态面板.md)

---

## 第1章 整体架构

### 1.1 架构定位

V16 智能体创建向导是 AC 前端的一个**核心功能模块**，横跨渲染进程（UI）和主进程（数据管理），并依赖 SQLite 数据库进行持久化。

```
┌──────────────────────────────────────────────────────────────────────┐
│                        渲染进程 (Renderer)                            │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                      AgentCreateWizard                        │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │    │
│  │  │ Step1:   │  │ Step2:   │  │ Step3:   │  │ Step4:   │     │    │
│  │  │ Basic    │→│ Persona  │→│ Tools    │→│ Robot    │→...  │    │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘     │    │
│  │       │              │              │              │         │    │
│  │       ▼              ▼              ▼              ▼         │    │
│  │  ┌──────────────────────────────────────────────────────┐    │    │
│  │  │                  Zustand Store                        │    │    │
│  │  │  wizardStore | agentStore | modelStore | qqBotStore  │    │    │
│  │  └───────────────────────┬──────────────────────────────┘    │    │
│  │                          │                                    │    │
│  │  ┌───────────────────────▼──────────────────────────────┐    │    │
│  │  │                   IPC Bridge                           │    │    │
│  │  │  agent:create/update | preset:list/save/delete        │    │    │
│  │  │  tool:list | qq:list-accounts                         │    │    │
│  │  └───────────────────────┬──────────────────────────────┘    │    │
│  ───────────────────────────┼───────────────────────────────────────┘ │
│                             │ IPC                                      │
│  ┌──────────────────────────┼──────────────────────────────────────┐  │
│  │                   主进程 (Main)                                   │  │
│  │                          ▼                                      │  │
│  │  ┌───────────────────────────────────────────────────────────┐  │  │
│  │  │                  IPC Handler 层                            │  │  │
│  │  │  agent-handler.ts (扩展) · preset-handler.ts (新增)       │  │  │
│  │  │  tool-handler.ts (新增 · 工具列表获取)                    │  │  │
│  │  └───────────────────────┬───────────────────────────────────┘  │  │
│  │                          │                                      │  │
│  │  ┌───────────────────────▼───────────────────────────────────┐  │  │
│  │  │                  业务服务层                                 │  │  │
│  │  │  AgentConfigManager (扩展 · SQLite 持久化)                  │  │  │
│  │  │  PersonaPresetManager (新增 · 预设 CRUD)                   │  │  │
│  │  │  ToolRegistry (复用 · 获取已注册工具)                      │  │  │
│  │  └───────────────────────┬───────────────────────────────────┘  │  │
│  │                          │                                      │  │
│  │  ┌───────────────────────▼───────────────────────────────────┐  │  │
│  │  │                数据库层 (SQLite)                            │  │  │
│  │  │  agents 表 · persona_presets 表                            │  │  │
│  │  └───────────────────────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.2 模块依赖关系

| 依赖模块 | 关系 | 用途 |
|----------|------|------|
| AC-V8 AgentStore | 修改 | 更新 AgentConfig 数据结构，新增创建/更新方法 |
| AC-V8 uiStore | 复用 | 布局模式切换，用于进入/退出创建向导 |
| AC-V6 modelStore | 复用 | 获取已配置模型列表 |
| AC-V10 qqBotStore | 复用 | 获取已登录的 QQ 账号列表 |
| AC-V3 ToolRegistry | 复用 | 获取所有已注册的工具列表 |
| AC-V8 prompt/identity-templates | 复用 | 内置人设预设数据 |
| AC-V8 prompt/personality-library | 复用 | 性格特征库 |
| AC-V8 prompt/workflow-templates | 复用 | 工作流模板 |
| AC-V8 prompt/behavior-presets | 复用 | 行为规范预设 |
| AC-V2 DatabaseManager | 复用 | SQLite 数据库管理 |

---

## 第2章 前端组件架构

### 2.1 组件目录结构

```
src/renderer/src/components/agent/
├── AgentCreateWizard.tsx          ← 新增: 创建向导容器（步骤路由 + 状态管理）
├── wizard/                        ← 新增: 向导步骤组件
│   ├── StepIndicator.tsx          # 步骤指示器组件
│   ├── StepBasicInfo.tsx          # 步骤1: 基本信息
│   ├── StepPersona.tsx            # 步骤2: 人设配置
│   ├── StepPersonaPreset.tsx      # 步骤2-预设模式: 预设选择列表
│   ├── StepPersonaAdvanced.tsx    # 步骤2-高级模式: 自定义表单
│   ├── StepTools.tsx              # 步骤3: 工具配置
│   ├── StepRobot.tsx              # 步骤4: 机器人绑定
│   └── StepLLM.tsx                # 步骤5: LLM 模型配置
├── sections/
│   ├── BasicInfoSection.tsx       ← 修改: 新增备注字段
│   ├── IdentitySection.tsx        ← 删除: 替换为 StepPersona
│   ├── ToolConfigSection.tsx      ← 删除: 替换为 StepTools
│   ├── MemoryConfigSection.tsx    ← 删除: 不再需要独立配置
│   ├── ExecutionRulesSection.tsx  ← 删除: 移入人设高级模式
│   ├── QQBindSection.tsx          ← 修改: 新增机器人设置项
│   └── ScheduleSection.tsx        ← 删除: 不再需要独立配置
├── AgentConfigForm.tsx            ← 删除: 不再使用
├── AgentCreatePage.tsx            ← 修改: 包装 AgentCreateWizard
└── AgentInstanceView.tsx          ← 不改: 保持三栏布局

src/renderer/src/stores/
├── wizardStore.ts                 ← 新增: 向导状态管理
└── agentStore.ts                  ← 修改: 支持新数据结构

src/renderer/src/lib/
├── types.ts                       ← 修改: 新增 PersonaPreset, AgentLLMConfig 等类型
└── ipc.ts                         ← 修改: 新增 preset/tool 相关 API

src/main/
├── ipc/
│   ├── agent-handler.ts           ← 修改: 重构 AgentConfigManager, 支持 SQLite 持久化
│   ├── preset-handler.ts          ← 新增: 人设预设 CRUD IPC Handler
│   └── tool-handler.ts            ← 新增: 工具列表获取 IPC Handler
├── agent/
│   ├── agent-config-manager.ts    ← 新增: 重构后的 AgentConfigManager（SQLite 持久化）
│   └── persona-preset-manager.ts  ← 新增: 人设预设管理器
└── database/
    └── schema.sql                 ← 修改: 新增 agents 表和 persona_presets 表
```

### 2.2 核心组件关系

```
AgentCreatePage
└── AgentCreateWizard
    ├── StepIndicator (5 steps, 可点击已完成步骤)
    ├── [step=0] StepBasicInfo
    │   └── 名称 / 备注 / 皮肤上传
    ├── [step=1] StepPersona
    │   ├── [mode=preset] StepPersonaPreset
    │   │   └── 预设卡片列表 + 搜索过滤
    │   └── [mode=advanced] StepPersonaAdvanced
    │       └── 身份 / 专业 / 性格 / 工作流 / 保存为预设
    ├── [step=2] StepTools
    │   └── 工具分类折叠列表 + 逐工具开关 + 悬停详情
    ├── [step=3] StepRobot
    │   └── QQ 绑定开关 + 账号选择 + 群组选择 + 机器人设置
    ├── [step=4] StepLLM
    │   └── 主模型 / QQ 模型 / 压缩模型 选择
    └── [上一步] / [下一步/确定] 按钮
```

### 2.3 向导状态管理（wizardStore）

```typescript
interface WizardState {
  // 当前步骤（0-4）
  currentStep: number
  // 已完成步骤集合
  completedSteps: Set<number>
  // 表单数据
  formData: WizardFormData
  // 是否正在提交
  submitting: boolean

  // Actions
  goToStep: (step: number) => void
  nextStep: () => void
  prevStep: () => void
  updateFormData: (partial: Partial<WizardFormData>) => void
  submit: () => Promise<string | null>  // 返回 agentId
}

interface WizardFormData {
  // Step 1: 基本信息
  name: string
  alias: string
  skinData?: string

  // Step 2: 人设
  personaMode: 'preset' | 'advanced'
  personaPresetId?: string
  persona: AgentPersona

  // Step 3: 工具
  enabledTools: Record<string, boolean>

  // Step 4: 机器人
  qqBinding: QQBinding

  // Step 5: LLM
  llmConfig: AgentLLMConfig
}
```

### 2.4 各步骤组件设计

#### 2.4.1 StepBasicInfo

- 使用 @heroui/react 的 TextField 组件
- 新增备注字段（alias），与名称并列显示
- 皮肤上传复用现有 BasicInfoSection 逻辑

#### 2.4.2 StepPersona

- 预设模式：从 PersonaPresetManager 获取预设列表，卡片式展示
- 高级模式：分四个区域（身份设定、专业设定、性格、工作流）
  - 身份设定：TextArea 输入
  - 专业设定：多选标签 / Checkbox 组
  - 性格：按类别分组展示从 PERSONALITY_LIBRARY 获取的性格特征
  - 工作流：单选按钮组从 WORKFLOW_TEMPLATES 获取
- 切换模式时数据互转（preset → advanced 填充，advanced → preset 确认提示）

#### 2.4.3 StepTools

- 从 ToolRegistry 获取所有已注册的工具列表
- 工具按 category 分组，使用 CollapsibleSection 折叠
- 每个工具渲染为一行，包含 Checkbox + 中文名 + 描述 + 标签
- 中文名通过 localeMap 映射（从 tool-handler 获取或前端维护）
- 悬停详情使用 Tooltip 组件，显示工具 schema 的 description 和参数
- 顶部统计栏显示已启用/总数

#### 2.4.4 StepRobot

- QQ 绑定开关控制子选项显隐
- 账号选择从 qqBotStore 获取已登录账号列表
- 群组选择支持多选标签
- 机器人设置项（响应前缀、自动回复等）

#### 2.4.5 StepLLM

- 三个模型选择区域：主智能体、QQ 机器人、压缩
- 每个区域包含 Provider 下拉 + Model 下拉
- QQ 和压缩模型支持"与主智能体相同"开关
- 模型列表从 modelStore 获取
- 显示选中模型的上下文窗口和 FC 支持状态

---

## 第3章 后端数据层设计

### 3.1 SQLite 表结构

```sql
-- 智能体配置表
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  alias TEXT,
  skin_data TEXT,
  persona_json TEXT NOT NULL,      -- 序列化的 AgentPersona JSON
  tools_json TEXT NOT NULL,         -- 序列化的 AgentToolConfig JSON
  qq_binding_json TEXT NOT NULL,    -- 序列化的 QQBinding JSON
  llm_config_json TEXT NOT NULL,    -- 序列化的 AgentLLMConfig JSON
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 人设预设表
CREATE TABLE IF NOT EXISTS persona_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  identity TEXT NOT NULL,
  expertise_json TEXT NOT NULL,     -- JSON 数组
  personality_json TEXT NOT NULL,   -- JSON 数组
  workflow_id TEXT NOT NULL,
  behavior_rules_json TEXT,        -- 序列化的行为规则
  recommended_tool_categories_json TEXT,  -- JSON 数组
  is_builtin INTEGER DEFAULT 0,    -- 0=自定义, 1=内置
  created_at INTEGER NOT NULL
);
```

### 3.2 数据流

```
创建流程:
  Step1 → Step2 → Step3 → Step4 → Step5 → [确定]
                                              │
                                              ▼
                                     wizardStore.submit()
                                              │
                                              ▼
                                    IPC: agent:create
                                              │
                                              ▼
                                    AgentConfigManager.create()
                                              │
                                    ┌─────────┴─────────┐
                                    ▼                   ▼
                              SQLite: INSERT     返回 agentId
                                    │
                                    ▼
                            前端: 刷新实例列表
                                    │
                                    ▼
                            跳转到智能体实例视图
```

### 3.3 AgentConfigManager 重构

将现有内存存储的 `AgentConfigManager` 重构为 SQLite 持久化版本：

```
class AgentConfigManager {
  // 内存缓存（启动时从 SQLite 加载）
  private cache: Map<string, AgentConfig>

  async create(config: AgentConfig): Promise<string>
  async update(id: string, config: Partial<AgentConfig>): Promise<boolean>
  async delete(id: string): Promise<boolean>
  list(): AgentSummary[]
  get(id: string): AgentConfig | undefined

  // 持久化
  private async loadFromDb(): Promise<void>
  private async saveToDb(id: string, config: AgentConfig): Promise<void>
  private async removeFromDb(id: string): Promise<void>
}
```

### 3.4 PersonaPresetManager

新增类，管理内置预设和用户自定义预设：

```
class PersonaPresetManager {
  // 内置预设（从代码加载）
  private builtinPresets: Map<string, PersonaPreset>
  // 自定义预设（从 SQLite 加载）
  private customPresets: Map<string, PersonaPreset>

  list(): PersonaPreset[]          // 合并内置 + 自定义
  get(id: string): PersonaPreset | undefined
  async create(preset: PersonaPreset): Promise<string>   // 保存自定义预设
  async update(id: string, preset: Partial<PersonaPreset>): Promise<boolean>
  async delete(id: string): Promise<boolean>              // 仅可删除自定义预设

  // 初始化时从内置模板加载
  private loadBuiltinPresets(): void
  private async loadCustomPresets(): Promise<void>
}
```

### 3.5 工具列表获取

新增 IPC channel `tool:list-all`，从 ToolRegistry 获取所有已注册的工具，并合并中文翻译：

```
IPC: tool:list-all
  → ToolRegistry: 遍历所有工作区，收集不重复的工具
  → 合并中文翻译映射（localeMap）
  → 返回 ToolInfo[]（含中文名称、描述、分类）

ToolInfo {
  name: string              // 英文名（工具注册名）
  displayName: string       // 中文显示名
  description: string       // 中文描述
  category: string          // 分类
  categoryLabel: string     // 中文分类名
  parameters: ParamInfo[]   // 参数列表
  example?: string          // 使用示例
}
```

---

## 第4章 类型定义变更

### 4.1 新增类型

```typescript
// ==========================================
// V16 新增类型
// ==========================================

/** 向导表单数据 */
export interface WizardFormData {
  name: string
  alias: string
  skinData?: string
  personaMode: 'preset' | 'advanced'
  personaPresetId?: string
  persona: AgentPersona
  enabledTools: Record<string, boolean>
  qqBinding: QQBinding
  llmConfig: AgentLLMConfig
}

/** 人设配置 */
export interface AgentPersona {
  identity: string
  expertise: string[]
  personality: string[]
  workflowId: string
  behaviorRules?: {
    core: string[]
    strategy: StrategyRule[]
    constraints: ConstraintRule[]
  }
}

/** 人设预设 */
export interface PersonaPreset {
  id: string
  name: string
  description: string
  identity: string
  expertise: string[]
  personality: string[]
  workflowId: string
  behaviorRules: {
    core: string[]
    strategy: StrategyRule[]
    constraints: ConstraintRule[]
  }
  recommendedToolCategories: string[]
  isBuiltin: boolean
  createdAt?: number
}

/** LLM 模型配置 */
export interface AgentLLMConfig {
  mainModel: ModelSelection
  qqBotModel: ModelSelection
  compressionModel: ModelSelection
}

/** 模型选择 */
export interface ModelSelection {
  providerId: string
  modelId: string
  modelName: string
  sameAsMain?: boolean
}

/** 工具展示信息 */
export interface ToolInfo {
  name: string
  displayName: string
  description: string
  category: string
  categoryLabel: string
  parameters: ToolParamInfo[]
  example?: string
}

/** 工具参数信息 */
export interface ToolParamInfo {
  name: string
  type: string
  description: string
  required: boolean
  defaultValue?: unknown
}

/** 策略规则（复用 V5 定义） */
export interface StrategyRule {
  name: string
  description: string
  priority: number
}

/** 约束规则（复用 V5 定义） */
export interface ConstraintRule {
  name: string
  description: string
  consequence: 'warning' | 'block' | 'replan'
}
```

### 4.2 修改类型

```typescript
// 修改后的 AgentConfig
export interface AgentConfig {
  id?: string
  name: string
  alias?: string                    // 新增
  skinData?: string
  persona: AgentPersona             // 新增（替代旧的 identity）
  personaPresetId?: string          // 新增
  tools: AgentToolConfig            // 修改（内部结构变化）
  qqBinding: QQBinding              // 不变
  llmConfig: AgentLLMConfig         // 新增（替代旧的 modelId）
  createdAt?: number
  updatedAt?: number
}

// 修改后的 AgentToolConfig
export interface AgentToolConfig {
  enabledTools: Record<string, boolean>    // 修改（替代旧的 categorySelection）
}

// 删除的类型
// AgentIdentity (由 AgentPersona 替代)
// AgentMemoryConfig (不再需要独立配置)
// ExecutionRule (移入 persona.behaviorRules)
// AgentSchedule (不再需要独立配置)
```

### 4.3 新增 IPC Channel

| Channel | 方向 | 用途 | 请求参数 | 返回值 |
|---------|:----:|------|----------|--------|
| `preset:list` | R→M | 获取所有人设预设 | `{}` | `PersonaPreset[]` |
| `preset:get` | R→M | 获取预设详情 | `{ id }` | `PersonaPreset` |
| `preset:create` | R→M | 创建自定义预设 | `PersonaPreset` | `{ id, success }` |
| `preset:update` | R→M | 更新自定义预设 | `{ id, preset }` | `{ success }` |
| `preset:delete` | R→M | 删除自定义预设 | `{ id }` | `{ success }` |
| `tool:list-all` | R→M | 获取所有已注册工具 | `{}` | `ToolInfo[]` |
| `agent:create` | R→M | 创建智能体（修改） | `AgentConfig` | `{ id, success }` |
| `agent:update` | R→M | 更新智能体（修改） | `{ id, config }` | `{ success }` |

---

## 第5章 与现有模块的集成

| 已有模块 | 集成方式 |
|----------|----------|
| V8 uiStore | 复用 `layoutMode` 和 `navigateToCreate()` 进入创建向导 |
| V8 agentStore | 修改 `createAgent` 方法支持新数据结构，调用 `agent:create` IPC |
| V8 modelStore | 复用 `models` 列表，在 StepLLM 中展示模型选择 |
| V10 qqBotStore | 复用获取已登录 QQ 账号列表 |
| V3 ToolRegistry | 通过 `tool:list-all` IPC 获取已注册工具列表 |
| V5 prompt/identity-templates | 转换为内置预设数据源 |
| V5 prompt/personality-library | 高级模式中性格选择的数据源 |
| V5 prompt/workflow-templates | 高级模式中工作流选择的数据源 |
| V5 prompt/behavior-presets | 高级模式中行为规则的数据源 |
| V2 DatabaseManager | 用于 agents 表和 persona_presets 表的建表和管理 |

---

## 第6章 边界情况处理

| 场景 | 处理方式 |
|------|----------|
| 步骤间切换数据丢失 | 所有步骤数据保存在 wizardStore.formData 中，切换不丢失 |
| 预设模式切换高级模式 | 自动填充预设数据到高级模式表单 |
| 高级模式切换预设模式 | 弹出确认对话框："切换将丢失自定义内容，确认？" |
| 工具列表为空 | 显示"暂无已注册工具，请先连接 Adapter Core"引导 |
| 模型列表为空 | 显示"请先在模型面板添加模型"并提供跳转链接 |
| QQ 账号列表为空 | 显示"暂无已登录的 QQ 账号，请先在机器人面板添加" |
| 创建过程中取消 | 弹出确认对话框："当前配置未保存，确认离开？" |
| 名称重复 | 后端去重检查，重复时提示"该名称已存在" |
| 皮肤文件过大 | 限制文件大小（建议 < 2MB），超限时提示 |
| 预设保存重名 | 同名自定义预设覆盖更新 |

---

## 第7章 性能目标

| 指标 | 目标 | 测量方式 |
|------|------|----------|
| 步骤切换 | < 100ms | React DevTools Profiler |
| 预设列表加载 | < 200ms（含 IPC 请求） | 计时日志 |
| 工具列表加载 | < 200ms | 计时日志 |
| 模型列表加载 | < 100ms | 计时日志 |
| 创建提交 | < 500ms | 计时日志 |
| 人设预设搜索 | < 50ms（过滤响应） | 计时日志 |