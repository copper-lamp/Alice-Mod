# AC-V28 — QQ 智能体独立 Tab 与独立系统提示词

> 版本：v1.0
> 日期：2026-07-18
> 版本号：V28
> 类型：设计文档
> 关联文档：
>
> - [AC-V24-链路整合-完整端到端链路打通-设计文档.md](AC-V24-链路整合-完整端到端链路打通-设计文档.md)
> - [AC-V27-QQAgent逻辑验证与修改计划-设计文档.md](AC-V27-QQAgent逻辑验证与修改计划-设计文档.md)
> - [AC-V23-QQ-MainAgent记忆共享与汇报机制-设计文档.md](AC-V23-QQ-MainAgent记忆共享与汇报机制-设计文档.md)
> - [AC-V16-智能体创建向导-需求文档.md](AC-V16-智能体创建向导-需求文档.md)

***

## 第1章 概述

### 1.1 背景

当前智能体实例页面（`AgentInstanceView`）包含两个 Tab 标签页：

| Tab ID   | 内容                    | 组件                                |
| -------- | --------------------- | --------------------------------- |
| `info`   | 对话面板（ChatPanel）       | 显示主 Agent 的运行日志与对话                |
| `config` | 配置表单（AgentConfigForm） | 编辑智能体名称、模型、人设、工具、QQ 绑定、技能、系统提示词预览 |

QQ 智能体（QQAgent）的配置目前仅作为主 Agent 配置中的一个子区域（`QQBindSection`），系统提示词与主 Agent 共享同一套 `identity`、`personality`、`rules` 等字段。这使得：

1. QQ 机器人的行为无法独立定制——主 Agent 的游戏操作提示词（如"请使用 area\_operation 工具挖掘方块"）会污染 QQ 回复的风格
2. QQ 机器人的对话日志与主 Agent 混合显示在同一个 ChatPanel 中
3. 用户无法单独查看 QQ 机器人的运行状态和对话历史

### 1.2 目标

1. **Tab 独立**：在智能体实例页面新增一个 `qq` Tab，专门展示 QQ 智能体的相关信息
2. **系统提示词独立**：QQ 智能体拥有完全独立于主 Agent 的 `identity`、`personality`、`rules` 等系统提示词配置
3. **对话日志独立**：`qq` Tab 下显示 QQ 智能体的对话日志，与主 Agent 分离
4. **配置页面独立**：`qq` Tab 下提供 QQ 智能体专属的配置表单，允许用户独立编辑其系统提示词

### 1.3 范围

| 范围  | 内容                                                                         |
| --- | -------------------------------------------------------------------------- |
| 包含  | AgentInstanceView 新增 Tab、AgentConfig 新增 qqPersona 字段、QQ 配置页面独立表单、QQ 对话日志展示 |
| 不包含 | QQ Agent 后端逻辑改造（qq-agent.ts 已继承 MainAgent，只需将新配置字段接入即可）                    |
| 不包含 | QQ 消息路由、触发逻辑、工具集等底层行为变更                                                    |

***

## 第2章 当前状态分析

### 2.1 前端 Tab 结构

当前 `AgentViewTab` 类型定义（[types.ts](file:///d:/McAgent/packages/agent-core/src/renderer/src/lib/types.ts#L96)）：

```typescript
export type AgentViewTab = 'info' | 'config'
```

`AgentInstanceView` 中的 Tab 渲染逻辑（[AgentInstanceView.tsx](file:///d:/McAgent/packages/agent-core/src/renderer/src/components/agent/AgentInstanceView.tsx#L123-L137)）：

```tsx
<Tabs
  selectedKey={agentViewTab}
  onSelectionChange={(key) => setAgentViewTab(key as 'info' | 'config')}
>
  <Tabs.ListContainer>
    <Tabs.List aria-label="智能体视图">
      <Tabs.Tab id="info">信息</Tabs.Tab>
      <Tabs.Tab id="config">配置</Tabs.Tab>
    </Tabs.List>
  </Tabs.ListContainer>
</Tabs>
```

内容区切换逻辑：

```tsx
{agentViewTab === 'info' ? (
  <ChatPanel />
) : (
  <AgentConfigForm agentId={currentAgentId} />
)}
```

### 2.2 当前 QQ 配置结构

`AgentConfig` 中的 QQ 相关字段（[types.ts](file:///d:/McAgent/packages/agent-core/src/renderer/src/lib/types.ts#L155-L175)）：

```typescript
export interface AgentConfig {
  // ...
  qqBinding: QQBinding       // QQ 绑定（账号、群组、mentionOnly）
  persona: AgentPersona       // 主 Agent 人设（identity, expertise, personality, ...）
  llmConfig: AgentLLMConfig   // 含 mainModel 和 qqBotModel
  // ...
}
```

`QQBinding` 接口（[types.ts](file:///d:/McAgent/packages/agent-core/src/renderer/src/lib/types.ts#L191-L197)）：

```typescript
export interface QQBinding {
  enabled: boolean
  accountId?: string
  groupIds?: string[]
  mentionOnly?: boolean
}
```

当前 QQ 配置仅包含绑定信息（账号、群组、触发方式），**不包含任何与系统提示词相关的字段**。

### 2.3 当前 QQ 系统提示词来源

QQ Agent 的系统提示词目前来自两个路径：

1. **旧版 QQSubAgent**（[qq-sub-agent.ts](file:///d:/McAgent/packages/agent-core/src/main/qq-bot/qq-sub-agent.ts#L43-L80)）：硬编码的 `QQ_SUB_AGENT_PROFILE`，固定不可修改
2. **新版 QQAgent**（[qq-agent.ts](file:///d:/McAgent/packages/agent-core/src/main/qq-bot/qq-agent.ts)）：继承 `MainAgent`，使用与主 Agent 相同的 `PromptCompiler` + `SystemPromptBuilder` 链路，从 `AgentConfig.persona` 构建系统提示词

也就是说，新版 QQAgent 与主 Agent **共享同一份 persona 配置**，无法独立定制。

### 2.4 后端数据模型

当前 `AgentConfig` 的后端数据模型（[agent-config-manager.ts](file:///d:/McAgent/packages/agent-core/src/main/agent/agent-config-manager.ts)）对应的 SQLite 表结构包含 `persona` 字段（JSON 存储），但无 QQ 专用的 persona 字段。

***

## 第3章 架构设计

### 3.1 整体方案

```
┌─────────────────────────────────────────────────────────┐
│                    AgentInstanceView                     │
│  ┌──────┬─────────┬──────┐                              │
│  │ 信息 │  配置   │  QQ  │  ← 新增 Tab                  │
│  └──────┴─────────┴──────┘                              │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  info → ChatPanel（主 Agent 对话日志）             │   │
│  │  config → AgentConfigForm（主 Agent 配置）         │   │
│  │  qq → QQPanel（QQ 智能体专属区域）                │   │
│  │         ├── QQChatPanel（QQ 对话日志）             │   │
│  │         └── QQConfigForm（QQ 系统提示词配置）      │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 3.2 数据模型变更

#### 3.2.1 AgentConfig 扩展

在 `AgentConfig` 中新增 `qqPersona` 字段，用于存储 QQ 智能体独立的系统提示词配置：

```typescript
export interface AgentConfig {
  // ... 现有字段不变
  persona: AgentPersona          // 主 Agent 人设（不变）
  qqPersona?: AgentPersona       // 新增：QQ 智能体人设（独立）
  qqBinding: QQBinding           // QQ 绑定（不变）
  llmConfig: AgentLLMConfig     // 模型配置（不变）
}
```

`AgentPersona` 接口已包含系统提示词所需的所有字段，可直接复用：

```typescript
export interface AgentPersona {
  identity: string               // 身份描述（核心系统提示词）
  expertise: string[]            // 擅长领域
  personality: string[]          // 个性特征
  workflowId: string             // 工作流 ID
  behaviorRules?: {
    core: string[]               // 核心规则
    strategy: StrategyRule[]     // 策略规则
    constraints: ConstraintRule[] // 约束规则
  }
  communicationStyle?: string[]  // 沟通风格
  boundaries?: string[]          // 行为边界
}
```

#### 3.2.2 默认 QQ Persona

当用户未配置 `qqPersona` 时，使用以下默认值（与旧版 `QQ_SUB_AGENT_PROFILE` 保持一致）：

const DEFAULT\_QQ\_PERSONA: AgentPersona = {

&#x20; identity: \`你是 McAgent 的 QQ 机器人助手，负责处理 QQ 群聊和私聊中的消息。

<br />

你的职责：

1\. 回复 QQ 用户的问题，提供友好的对话体验

2\. 当用户需要游戏内操作（如查询状态、执行指令）时，使用 request\_game\_action 工具请求主 Agent

<br />

你的限制：

\- 你无法直接操作游戏，所有游戏操作必须通过 request\_game\_action 请求主 Agent 执行

\- 你需要将主 Agent 返回的结果以友好的方式回复给 QQ 用户

\- 纯 QQ 相关的查询（如群信息、成员列表）可以直接使用 qq\_info 工具\`,

&#x20; expertise: \['QQ 群聊管理', '消息回复', '游戏状态查询'],

&#x20; personality: \[

&#x20;   '友好、耐心、乐于助人',

&#x20;   '回复简洁明了，不啰嗦',

&#x20;   '使用与 QQ 用户相同的语言回复',

&#x20;   '遇到不懂的问题诚实告知，不编造答案',

&#x20; ],

&#x20; workflowId: '',

&#x20; behaviorRules: {

&#x20;   core: \[

&#x20;     '不要直接执行游戏操作，使用 request\_game\_action 请求主 Agent',

&#x20;     '将主 Agent 返回的结果转换成自然语言回复给用户',

&#x20;     '尊重用户隐私，不泄露其他用户的信息',

&#x20;     '群聊中回复时 @ 对应用户',

&#x20;     '工具可能失败，失败后向用户解释原因并提供替代方案',

&#x20;   ],

&#x20;   strategy: \[],

&#x20;   constraints: \[],

&#x20; },

&#x20; communicationStyle: \[

&#x20;   '使用亲切友好的语气',

&#x20;   '回复简洁，避免冗长',

&#x20; ],

&#x20; boundaries: \[

&#x20;   '不执行任何游戏内操作',

&#x20;   '不泄露管理员或其他用户的隐私信息',

&#x20; ],

}

### 3.3 前端组件变更

#### 3.3.1 AgentViewTab 类型扩展

```typescript
// types.ts
export type AgentViewTab = 'info' | 'config' | 'qq'
```

#### 3.3.2 AgentInstanceView 新增 Tab

```tsx
// AgentInstanceView.tsx
<Tabs
  selectedKey={agentViewTab}
  onSelectionChange={(key) => setAgentViewTab(key as AgentViewTab)}
>
  <Tabs.ListContainer>
    <Tabs.List aria-label="智能体视图">
      <Tabs.Tab id="info">信息</Tabs.Tab>
      <Tabs.Tab id="config">配置</Tabs.Tab>
      <Tabs.Tab id="qq">QQ</Tabs.Tab>  {/* 新增 */}
    </Tabs.List>
  </Tabs.ListContainer>
</Tabs>
```

内容区切换逻辑改为：

```tsx
{agentViewTab === 'info' ? (
  <ChatPanel />
) : agentViewTab === 'config' ? (
  <AgentConfigForm agentId={currentAgentId} />
) : (
  <QQPanel agentId={currentAgentId} />  {/* 新增 */}
)}
```

#### 3.3.3 QQPanel 组件（新增）

`QQPanel` 是 QQ Tab 下的容器组件，包含两个子区域：

**布局方案 A（推荐）**：上下结构，上方为 QQ 对话日志，下方为 QQ 配置表单，可切换。

```
┌──────────────────────────────────────┐
│  QQ 智能体                            │
│  ┌──────┬────────┐                   │
│  │ 对话  │ 配置   │  ← 子 Tab        │
│  └──────┴────────┘                   │
│                                      │
│  ┌──────────────────────────────┐    │
│  │  对话 Tab → QQChatPanel      │    │
│  │  配置 Tab → QQConfigForm     │    │
│  └──────────────────────────────┘    │
└──────────────────────────────────────┘
```

**布局方案 B（备选）**：左右结构，左侧为对话日志，右侧为配置面板。

方案 A 更符合现有 UI 风格（与主 Agent 的 info/config 结构一致），推荐采用。

#### 3.3.4 QQChatPanel 组件（新增）

`QQChatPanel` 与 `ChatPanel` 类似，但：

- 仅显示 `source === 'qq'` 的消息
- 显示 QQ 消息特有的元信息（群号、发送者 QQ 号）
- 使用 `useChat` hook 时传入 `source: 'qq'` 过滤参数

#### 3.3.5 QQConfigForm 组件（新增）

`QQConfigForm` 是 QQ 智能体的专属配置表单，与 `AgentConfigForm` 类似但精简，仅包含：

1. **QQ 绑定设置**（复用 `QQBindSection` 组件，从主配置表单移入此处）
2. **身份描述**（`qqPersona.identity`，TextArea 编辑）
3. **个性特征**（`qqPersona.personality`，每行一个）
4. **核心规则**（`qqPersona.behaviorRules.core`，每行一条规则）
5. **沟通风格**（`qqPersona.communicationStyle`，每行一条）
6. **行为边界**（`qqPersona.boundaries`，每行一条）
7. **系统提示词预览**（只读，由 `PromptCompiler` 实时编译生成）

#### 3.3.6 AgentConfigForm 调整

从主配置表单中移除 `QQBindSection` 区域，QQ 绑定设置移至 `QQConfigForm` 中。

### 3.4 后端数据流

```
┌──────────┐  保存配置   ┌──────────────┐
│ QQConfig │ ────────→  │ AgentConfig  │
│  Form    │            │ Manager      │
└──────────┘            └──────┬───────┘
                               │
                               ▼
                        ┌──────────────┐
                        │   SQLite     │
                        │  agents 表   │
                        │ persona JSON │
                        │ qqPersona    │
                        │ JSON (新增)  │
                        └──────┬───────┘
                               │
                               ▼
                        ┌──────────────┐
                        │  Prompt      │
                        │  Compiler    │
                        └──────┬───────┘
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
              ┌──────────┐         ┌──────────┐
              │  Main     │         │  QQ      │
              │  Agent    │         │  Agent   │
              │  Prompt   │         │  Prompt  │
              │  (persona)│         │ (qqPersona)│
              └──────────┘         └──────────┘
```

### 3.5 QQ Agent 后端适配

`qq-agent.ts` 中的 `QQAgent` 类继承自 `MainAgent`，当前从 `AgentConfig.persona` 构建系统提示词。适配后应改为：

1. 从 `AgentConfig.qqPersona` 读取配置（若不存在则使用默认值）
2. 通过 `PromptCompiler` 使用 `qqPersona` 编译系统提示词
3. 编译后的提示词存储为 `qqCompiledPrompt`（与 `compiledPrompt` 并列）

后端 `AgentConfig` 对应接口需扩展：

```typescript
export interface AgentConfig {
  // ... 现有字段
  compiledPrompt?: string       // 主 Agent 编译后的系统提示词
  qqCompiledPrompt?: string     // 新增：QQ Agent 编译后的系统提示词
}
```

***

## 第4章 组件树与交互流程

### 4.1 组件树

```
AgentInstanceView
├── 标题栏（头像、名称、状态、Tab 切换、删除按钮）
├── Tabs
│   ├── Tab: info
│   │   └── ChatPanel（主 Agent 对话日志 — 不变）
│   ├── Tab: config
│   │   └── AgentConfigForm（主 Agent 配置 — 移除 QQ 绑定区域）
│   └── Tab: qq（新增）
│       └── QQPanel（新增）
│           ├── 子 Tab 栏
│           │   ├── Tab: chat
│           │   │   └── QQChatPanel（QQ 对话日志，新增）
│           │   └── Tab: config
│           │       └── QQConfigForm（QQ 配置表单，新增）
│           │           ├── QQBindSection（从主配置移入）
│           │           ├── 身份描述编辑
│           │           ├── 个性特征编辑
│           │           ├── 核心规则编辑
│           │           ├── 沟通风格编辑
│           │           ├── 行为边界编辑
│           │           └── 系统提示词预览
│           └── 保存/取消按钮
└── 删除确认弹窗
```

### 4.2 交互流程

**场景 1：用户配置 QQ 智能体系统提示词**

1. 用户点击智能体实例 → 进入 `AgentInstanceView`
2. 点击 `QQ` Tab → 进入 `QQPanel`
3. 默认显示 QQ 对话日志（`chat` 子 Tab）
4. 用户切换到 `config` 子 Tab → 进入 `QQConfigForm`
5. 编辑身份描述、个性特征等字段
6. 点击"保存"按钮 → 调用 `updateAgent(agentId, { qqPersona: {...} })`
7. 后端存储 `qqPersona` 到 SQLite，触发 `PromptCompiler` 编译 `qqCompiledPrompt`
8. 前端显示保存成功，系统提示词预览区域更新

**场景 2：用户查看 QQ 对话日志**

1. 用户点击智能体实例 → 进入 `AgentInstanceView`
2. 点击 `QQ` Tab → 进入 `QQPanel`
3. 默认显示 QQ 对话日志（`chat` 子 Tab）
4. `QQChatPanel` 加载 `source === 'qq'` 的消息列表
5. 每条消息显示 QQ 头像、昵称、群名、时间等元信息

**场景 3：QQ Agent 运行时使用独立系统提示词**

1. QQ 消息到达 → `message-router.ts` 路由到 `QQAgent`
2. `QQAgent.handleQQMessage()` 调用 `PromptCompiler`
3. `PromptCompiler` 检测到 `qqPersona` 存在 → 使用 `qqPersona` 编译系统提示词
4. 编译后的提示词注入 LLM 会话
5. LLM 响应 → 回复 QQ 消息

***

## 第5章 文件变更清单

### 5.1 新增文件

| 文件                                                   | 说明                    |
| ---------------------------------------------------- | --------------------- |
| `src/renderer/src/components/agent/QQPanel.tsx`      | QQ Tab 容器组件，含子 Tab 切换 |
| `src/renderer/src/components/agent/QQChatPanel.tsx`  | QQ 对话日志展示组件           |
| `src/renderer/src/components/agent/QQConfigForm.tsx` | QQ 系统提示词配置表单          |

### 5.2 修改文件

| 文件                                                        | 变更类型 | 说明                                                                       |
| --------------------------------------------------------- | ---- | ------------------------------------------------------------------------ |
| `src/renderer/src/lib/types.ts`                           | 修改   | `AgentViewTab` 新增 `'qq'`；`AgentConfig` 新增 `qqPersona`、`qqCompiledPrompt` |
| `src/renderer/src/stores/uiStore.ts`                      | 修改   | `setAgentViewTab` 支持 `'qq'` 类型                                           |
| `src/renderer/src/components/agent/AgentInstanceView.tsx` | 修改   | 新增 QQ Tab 标签页，新增 `QQPanel` 渲染分支                                          |
| `src/renderer/src/components/agent/AgentConfigForm.tsx`   | 修改   | 移除 `QQBindSection` 区域（移至 `QQConfigForm`）                                 |
| `src/main/agent/agent-config-manager.ts`                  | 修改   | 支持 `qqPersona` 字段的读写                                                     |
| `src/main/qq-bot/qq-agent.ts`                             | 修改   | 从 `qqPersona` 构建系统提示词（而非 `persona`）                                      |
| `src/main/prompt/compiler/prompt-compiler.ts`             | 修改   | 支持为 QQ Agent 编译独立系统提示词                                                   |

### 5.3 后端类型映射

后端 `AgentConfig` 类型（`agent-config-manager.ts`）需同步扩展：

```typescript
export interface AgentConfig {
  id: string
  workspaceId: string
  name: string
  alias?: string
  skinData?: string
  persona: AgentPersona         // 主 Agent 人设
  qqPersona?: AgentPersona      // 新增：QQ 智能体人设
  tools: AgentToolConfig
  qqBinding: QQBinding
  llmConfig: AgentLLMConfig
  isMain?: boolean
  compiledPrompt?: string
  qqCompiledPrompt?: string     // 新增：QQ 编译提示词
  skills?: AgentSkillConfig
  createdAt: number
  updatedAt: number
}
```

***

## 第6章 数据迁移与兼容性

### 6.1 向后兼容

- 已有 `AgentConfig` 记录不含 `qqPersona` 字段 → `QQAgent` 使用默认 `DEFAULT_QQ_PERSONA`
- 已有 `qqCompiledPrompt` 不存在 → `QQAgent` 运行时编译
- 前端 `QQConfigForm` 首次加载时，若 `qqPersona` 不存在，填充默认值

### 6.2 前端兼容

- `AgentConfigForm` 移除 `QQBindSection` 后，不影响已有智能体的配置读取
- 已保存的 `qqBinding` 数据在 `QQConfigForm` 中正常显示
- 旧版前端（无 QQ Tab）不会崩溃，但无法访问 QQ 配置

***

## 第7章 验收清单

| #  | 验收项        | 验收标准                                            | 优先级 |
| -- | ---------- | ----------------------------------------------- | --- |
| 1  | QQ Tab 显示  | 智能体实例页面出现第三个 Tab，标签为"QQ"                        | P0  |
| 2  | QQ Tab 内容  | 点击 QQ Tab 显示 QQPanel，包含对话和配置子 Tab               | P0  |
| 3  | QQ 系统提示词独立 | 修改 QQ 身份描述不影响主 Agent 系统提示词                      | P0  |
| 4  | 主系统提示词独立   | 修改主 Agent 身份描述不影响 QQ 系统提示词                      | P0  |
| 5  | QQ 配置保存    | QQConfigForm 的修改可保存并持久化                         | P0  |
| 6  | QQ 绑定设置迁移  | QQ 绑定（账号、群组、mentionOnly）在 QQConfigForm 中正常使用    | P0  |
| 7  | QQ 对话日志    | QQChatPanel 仅显示 source=qq 的消息                   | P1  |
| 8  | 系统提示词预览    | QQConfigForm 底部显示 QQ 智能体系统提示词预览                 | P1  |
| 9  | 默认值回退      | 无 qqPersona 配置时，QQAgent 使用默认 persona            | P1  |
| 10 | 主配置表单精简    | AgentConfigForm 中不再包含 QQ 绑定区域                   | P1  |
| 11 | 后端数据持久化    | qqPersona 正确写入 SQLite，读取无误                      | P0  |
| 12 | 运行时使用独立提示词 | QQAgent 实际使用 qqCompiledPrompt 而非 compiledPrompt | P0  |

***

## 第8章 风险与注意事项

1. **QQ Agent 运行时注入**：`QQAgent` 类继承自 `MainAgent`，当前 `PromptCompiler` 可能使用 `AgentConfig.persona` 构建提示词。需确保在 `qq-agent.ts` 中覆盖此行为，读取 `qqPersona` 字段。
2. **前端 store 兼容性**：`agentStore` 中的 `currentAgent` 对象类型需同步扩展，确保 `qqPersona` 字段被正确序列化/反序列化。
3. **ChatPanel 消息过滤**：当前 `ChatPanel` 使用 `useChat` hook 加载所有消息。`QQChatPanel` 需要支持按 `source` 过滤，需确认 `useChat` hook 是否支持此参数。
4. **子 Tab 嵌套**：`QQPanel` 内部使用子 Tab（对话/配置），需注意与外部 Tab 的嵌套层级，避免样式冲突。
5. **默认 Persona 的国际化**：当前默认 `DEFAULT_QQ_PERSONA` 使用中文，如有国际化需求需后续扩展。

