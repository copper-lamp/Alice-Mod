# AC-V27 — QQAgent 逻辑验证与修改计划

> 版本：v2.0
> 日期：2026-07-18
> 版本号：V27
> 类型：修改计划 / 差异分析 / 实施报告
> 关联文档：
>
> - [AC-V23-QQ-MainAgent记忆共享与汇报机制-设计文档.md](AC-V23-QQ-MainAgent记忆共享与汇报机制-设计文档.md)
> - [AC-V14-事件触发器与QQ完善-架构文档.md](AC-V14-事件触发器与QQ完善-架构文档.md)
> - [AC-V10-QQ机器人模块.md](AC-V10-QQ机器人模块.md)
> - [AC-V5-PromptEngineering.md](AC-V5-PromptEngineering.md)

---

## 第1章 概述

### 1.1 验证目标

验证当前 QQAgent 逻辑是否符合以下设计要求：

1. **系统提示词**：由固定模板创建，创建后用户可自由修改（不包含工具提示词部分）
2. **Skill 启用**：可选择启用 skill（表格加开关按钮）
3. **触发逻辑**：支持被 @、定时（某时间段随机上线）、被主 Agent 调度三种触发方式
4. **工具完整性**：工具列表完整，符合之前的设计文档

### 1.2 实施状态总览

| # | 需求项 | 当前状态 | 说明 |
|---|--------|---------|------|
| 1 | 系统提示词模板创建 | ✅ 已验证 | MainAgent 使用 `PromptCompiler` + `SystemPromptBuilder` 从模板构建；新版 QQAgent (qq-agent.ts) 继承 MainAgent 链路 |
| 2 | 用户可自由修改提示词 | ✅ 已验证 | AgentConfig.identity 可由用户编辑，`AgentConfigForm` 提供文本编辑区；工具提示词分离不可编辑 |
| 3 | Skill 表格加开关按钮 | ✅ 已实现 | SkillsView 已改造为表格+开关；AgentConfigForm 已有 skill 配置区（v2.0 新增） |
| 4 | 被 @ 触发 | ✅ 已实现 | `QQTriggerAdapter.isAtBot()` 检测；`message-router.ts` 新增 `mentionOnly` 过滤（v2.0 新增） |
| 5 | 定时触发（随机上线） | ❌ 未实现 | `CronTriggerAdapter` 支持标准 cron，但无"某时间段随机上线"逻辑 |
| 6 | 被主 Agent 调度 | ✅ 已实现 | `QQAgent.sendQQMessage()` 已实现（v2.0）；`notify_qq` 工具已注册 + Pipeline 中间件已集成（v2.1） |
| 7 | 工具完整性 | ✅ 已验证 | 所有工具已实现（`qq_info` 已确认正确调用 OneBot API，`notify_qq` 已注册），消息队列系统为 P2 可选 |

### 1.3 修改文件清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/main/qq-bot/message-router.ts` | 修改 | 新增 `mentionOnly` 过滤 + `isAtBot()` 辅助函数 |
| `src/main/qq-bot/qq-agent.ts` | 修改 | 新增 `sendQQMessage()` 方法 |
| `src/renderer/src/lib/types.ts` | 修改 | `QQBinding` 新增 `mentionOnly`；`AgentConfig` 新增 `skills` 字段 |
| `src/renderer/src/components/agent/sections/QQBindSection.tsx` | 修改 | 新增"仅 @ 触发"开关 UI |
| `src/renderer/src/components/agent/wizard/StepRobot.tsx` | 修改 | 新增"仅 @ 触发"开关 UI |
| `src/renderer/src/components/knowledge/SkillsView.tsx` | 重写 | 从列表改为表格+开关布局 |
| `src/renderer/src/components/agent/AgentConfigForm.tsx` | 修改 | 新增"技能配置"区域，加载可用技能列表并显示表格开关 |
| `src/main/qq-bot/tools/notify_qq.ts` | 新增 | `notify_qq` 工具定义（ToolSchema 格式，v2.1 新增） |
| `src/main/workspace/tool-registry.ts` | 修改 | 新增 `registerLocal()` 支持本地工具；`getTools()` 合并本地工具（v2.1 新增） |
| `src/main/agent/main-agent-registry.ts` | 修改 | 注册 `notify_qq` 本地工具 + 添加 Pipeline 中间件处理本地调用（v2.1 新增） |

---

## 第2章 系统提示词对比分析

### 2.1 当前实现

#### MainAgent 提示词构建链路

```
AgentConfig (用户可编辑 identity)
  → mapAgentConfigToProfile() → AgentProfile
    → PromptCompiler.compile() → compiledPrompt (预编译缓存)
      或
      PromptBuilder.build() → SystemPromptBuilder.build() → 系统提示词
```

**`SystemPromptBuilder` 6 区域结构**：

```
[区域1] 你是谁（identity + expertise）
[区域2] 你的个性（personality）
[区域3] 行为准则（rules.core / strategy / constraints）
[区域4] 工作方式（workflowDescription / workApproach）
[区域5] 沟通与边界（communicationStyle + boundaries）
[区域6] 自定义片段（system_begin / system_end 位置）
```

**工具提示词位置**：由 `ToolPromptAssembler` 组装，通过 `PromptBuilder.assembleMessages()` 以半静态区域（Region 2）注入，**与系统提示词分离**，用户不可编辑。

#### QQAgent 旧版 (qq-sub-agent.ts) 提示词

```typescript
const QQ_SUB_AGENT_PROFILE: AgentProfile = {
  name: 'QQ 机器人助手',
  identity: `你是 McAgent 的 QQ 机器人助手...`,  // 硬编码
  personality: ['友好、耐心、乐于助人', ...],       // 硬编码
  rules: { core: [...], strategy: [], constraints: [] },  // 硬编码
  preferences: { ... },
  fragments: [],
};
```

`buildSystemPrompt()` 函数直接从 profile 构建，**不支持用户编辑**。

#### QQAgent 新版 (qq-agent.ts) 提示词

继承 `MainAgent`，使用 `MainAgent.handle()` 内部流程：
- 通过 `mapAgentConfigToProfile(config)` 映射配置
- 通过 `PromptBuilder.build()` 构建
- 用户 identity 来自 `AgentConfig.persona.identity`（可编辑）

### 2.2 差异分析

| 对比项 | MainAgent | QQAgent (旧版) | QQAgent (新版) |
|--------|-----------|----------------|----------------|
| 提示词来源 | AgentConfig → Profile | 硬编码 profile | 继承 MainAgent 链路 |
| 用户可编辑 identity | ✅ | ❌ | ✅（继承） |
| 工具提示词分离 | ✅ | ✅ | ✅（继承） |
| 模板创建 | ✅ PromptCompiler | ❌ 无模板 | ✅（继承） |
| 自定义片段 | ✅ fragments | ❌ | ✅（继承） |

### 2.3 结论

**无需修改**。新版 QQAgent 已满足要求。

---

## 第3章 Skill 启用机制对比分析

### 3.1 修改前现状

#### Skill 存储与加载

- **存储**：`memory` 表，`type='skill'`，`content` 为 `{name, description, text}`
- **管理 UI**：`SkillsView.tsx` — 列表展示、新建、编辑、删除，**无开关按钮**
- **注入机制**：`Orchestrator` 通过 `SkillInjector` 按阶段（plan/execute/transfer/summarize）注入

#### SkillInjector 技能选择逻辑

```typescript
pick(phase, enabledSkills?, disabledSkills?): Skill[] {
  // enabledSkills 非空 → 白名单
  // enabledSkills 空/undefined → enabledByDefault=true
  // disabledSkills → 黑名单（差集）
  // 按 totalSkillBudget 裁剪
}
```

#### 修改前 Agent 配置中的 Skill 控制

修改前 `AgentConfig` 中**没有** `skills` 字段，`SkillInjector.pick()` 的 `enabledSkills` / `disabledSkills` 参数没有来源。

### 3.2 修改内容

#### 3.2.1 SkillsView 改造为表格+开关 (v2.0)

**文件**：`SkillsView.tsx`

**修改内容**：
- 从列表改为表格布局，每行包含：启用开关、名称、描述、操作（编辑/删除）
- 开关按钮可逐个启用/禁用技能，状态持久化到 `content.enabled` 字段
- 保留新建/编辑/删除功能

**UI 效果**：

```
┌─────────────────────────────────────────────────────────┐
│ 技能管理                                        [+ 新建] │
│                                                         │
│ 通过开关启用/禁用技能。启用的技能将注入到智能体的系统提示   │
│ 词中。如需个别智能体单独配置，请在智能体配置页中覆盖。     │
│                                                         │
│ ┌──────┬──────────┬──────────────┬──────────────┐       │
│ │ 启用  │ 名称     │ 描述          │ 操作          │       │
│ ├──────┼──────────┼──────────────┼──────────────┤       │
│ │ [✓]  │ plan     │ 计划模式      │ 编辑  删除    │       │
│ │ [✗]  │ mine     │ 挖矿指南      │ 编辑  删除    │       │
│ │ [✓]  │ fight    │ 战斗技巧      │ 编辑  删除    │       │
│ └──────┴──────────┴──────────────┴──────────────┘       │
└─────────────────────────────────────────────────────────┘
```

**数据流**：

```
开关点击 → toggleEnabled(skill)
  → memoryApi.update(skill.id, { content: { ...skill, enabled: newEnabled } })
  → 本地状态更新（setSkills）
```

#### 3.2.2 AgentConfig 新增 skill 配置 (v2.0)

**文件**：`types.ts` (renderer)

**新增类型**：

```typescript
/** V27：技能配置 */
interface AgentSkillConfig {
  /** 启用的技能名称列表（空 = 使用全局默认） */
  enabledSkills?: string[]
  /** 禁用的技能名称列表 */
  disabledSkills?: string[]
}

/** AgentConfig 新增字段 */
interface AgentConfig {
  // ... 现有字段
  /** V27：技能配置（启用/禁用列表） */
  skills?: AgentSkillConfig
}
```

#### 3.2.3 AgentConfigForm 新增技能配置区 (v2.0)

**文件**：`AgentConfigForm.tsx`

**修改内容**：
- 在 QQ 绑定区与系统提示词区之间新增"技能配置"区域
- 加载所有可用技能（从 `memoryApi.list({ type: 'skill' })`）
- 以表格+开关形式展示，支持白名单/黑名单两种模式

**白名单/黑名单切换逻辑**：

```
if (enabledSkills && enabledSkills.length > 0) {
  // 白名单模式：仅 enabledSkills 中的技能启用
  toggle → 从 enabledSkills 添加/移除
} else {
  // 黑名单模式：不在 disabledSkills 中的技能启用
  toggle → 从 disabledSkills 添加/移除
}
```

### 3.3 待完成

| 项目 | 说明 | 依赖 |
|------|------|------|
| QQAgent 集成 SkillInjector | 在 `QQAgent.handleQQMessage()` 中注入 skill 内容 | 需 `Orchestrator` 将 `AgentConfig.skills` 传递给 `SkillInjector.pick()` |

---

## 第4章 触发逻辑对比分析

### 4.1 修改前现状

#### 4.1.1 被 @ 触发

**链路**：

```
QQ 群消息 → OneBotClient.onMessage → qq-bot-handler.ts
  → routeQQMessageToAgent()
    → findBoundAgent() → 按 accountId 查找绑定的 Agent
    → 群组过滤（检查 groupIds）
    → agent.handleQQMessage(msg) 或 agent.handle({ source: 'qq', prompt })
```

**`QQTriggerAdapter` 判断 @**：

```typescript
private isAtBot(msg: Partial<QQMessage>): boolean {
  return msg.segments.some(
    seg => seg.type === 'at' && seg.data &&
      (seg.data.qq === 'all' || seg.data.qq === String(msg.userId)),
  );
}
```

**问题**：修改前 `message-router.ts` 处理所有群消息（不区分是否 @），仅通过 `groupIds` 做群组过滤。**没有按照"只有 @ 才触发"的规则过滤**。

#### 4.1.2 定时触发（某时间段随机上线）

**当前能力**：`CronTriggerAdapter` 支持的调度方式：

| 调度类型 | 是否支持 | 说明 |
|---------|---------|------|
| Cron 表达式 | ✅ | 标准 cron，如 `0 9 * * *` |
| 固定间隔 | ✅ | 如每 30 分钟 |
| 绝对时间 | ✅ | 一次性定时 |
| 随机时间段 | ❌ | 不支持"9:00-12:00 之间随机选一个时间上线" |

**涉及文件**：
- `trigger/adapters/cron-adapter.ts` — Cron 调度适配器
- `trigger/trigger-engine.ts` — 规则匹配引擎
- `trigger/trigger-store.ts` — 触发器持久化

#### 4.1.3 被主 Agent 调度

**当前能力**：

```
主 Agent → requestGameAction() → QQAgent 处理
  ✅ 子→父：QQAgent.requestGameAction() → 主 Agent 执行游戏操作

父→子：主 Agent 想让 QQAgent 发消息
  ❌ 无完整链路
  ⚠️ 有 AgentReportBus 的 report 机制（父→子推送汇报）
  ⚠️ 但无"主 Agent 主动让 QQ Agent 发消息"的通用机制
```

### 4.2 修改内容

#### 4.2.1 被 @ 触发 — 增加 @ 过滤 (v2.0)

**后端修改**：`message-router.ts`

```typescript
// 新增：检查消息是否 @ 了机器人
function isAtBot(msg: QQMessage): boolean {
  return msg.segments?.some(
    seg => seg.type === 'at' && seg.data?.qq === 'all',
  ) ?? false
}

// 在 routeQQMessageToAgent() 中新增：
// 5. V27: mentionOnly 模式过滤 — 仅处理 @ 机器人的消息
if (config.qqBinding.mentionOnly && !isAtBot(msg)) {
  return false
}
```

**前端修改**：`QQBindSection.tsx` 和 `StepRobot.tsx`

- 新增"仅 @ 触发"开关（`<button role="switch">`）
- 说明文字："开启后仅处理 @ 机器人的群消息，其他消息将被忽略"
- 状态绑定到 `QQBinding.mentionOnly`

**类型修改**：`types.ts` (renderer)

```typescript
interface QQBinding {
  enabled: boolean
  accountId?: string
  groupIds?: string[]
  /** V27：仅处理 @ 机器人的消息 */
  mentionOnly?: boolean
}
```

#### 4.2.2 被主 Agent 调度 — 父→子调度通道 (v2.0)

**后端修改**：`qq-agent.ts`

```typescript
/**
 * V27: 被主 Agent 调度 — 主动发送 QQ 消息
 */
async sendQQMessage(
  target: string,
  content: string,
  type: 'group' | 'private' = 'group',
): Promise<boolean> {
  try {
    if (type === 'group') {
      await this.client.sendGroupMsg(target, content);
    } else {
      await this.client.sendPrivateMsg(target, content);
    }
    return true;
  } catch (err) {
    console.error(`[QQAgent] 发送调度消息失败:`, err);
    return false;
  }
}
```

**待完成**：`notify_qq` 工具注册 — 已实现（v2.1）

`notify_qq` 工具已注册到 workspace 的 ToolRegistry 中（通过 `registerLocal()` 方法），并通过 Pipeline 中间件 `notify_qq_handler` 处理本地调用。中间件在 `before` 阶段拦截 `notify_qq` 调用，通过 `MainAgentRegistry.findQQAgent()` 查找同 workspace 下的 QQAgent 实例，调用 `sendQQMessage()` 方法发送消息。

**修改点（v2.1 新增）**：

| 文件 | 修改内容 |
|------|---------|
| `qq-bot/tools/notify_qq.ts` | 新增 `NOTIFY_QQ_TOOL_SCHEMA` 工具定义 |
| `workspace/tool-registry.ts` | 新增 `registerLocal()` 支持本地工具注册 |
| `main-agent-registry.ts` | 注册本地工具 + 添加 Pipeline 中间件 |

### 4.3 需求 vs 修改后状态

| 触发方式 | 需求 | 修改前 | 修改后 | 状态 |
|---------|------|--------|--------|------|
| 被 @ | 群消息中 @ 机器人时触发 | 所有群消息都处理，无 @ 过滤 | 新增 `mentionOnly` 配置，开启后仅 @ 触发 | ✅ 已实现 |
| 定时（随机时间段） | 在某时间段内随机上线 | 仅支持固定 cron/interval | 未修改 | ❌ 未实现 |
| 被主 Agent 调度 | 主 Agent 可主动让 QQ Agent 发消息 | 无父→子调度通道 | 新增 `sendQQMessage()` + `notify_qq` 工具注册 + Pipeline 中间件 | ✅ 已实现 |

---

## 第5章 工具完整性对比分析

### 5.1 设计文档中的工具列表

根据 [12-QQ外部连接工具设计.md](file:///d:/McAgent/docs/tools/12-QQ外部连接工具设计.md) 和 [AC-V10-QQ机器人模块.md](file:///d:/McAgent/docs/version-plans/AC/AC-V10-QQ机器人模块.md) 中的设计：

#### 设计文档预期工具

| 工具名 | 描述 | 设计文档中定义 |
|--------|------|---------------|
| `qq_send` | 发送 QQ 消息（群消息、私聊、图片、文件） | ✅ |
| `qq_info` | 查询 QQ 群信息、群成员列表或用户信息 | ✅ |
| `qq_group_manage` | 群管理操作（踢人、禁言、设置名片、审批入群、撤回消息） | ✅ |
| `qq_notify` | 向指定 QQ 群发送主动通知消息 | ✅ |
| `request_game_action` | 请求主 Agent 执行游戏内操作 | ✅ |
| 消息队列系统 | 消息存储、获取未读消息、标记已读 | ✅（设计文档中定义） |
| `notify_qq`（主 Agent 侧） | 主 Agent 主动通知 QQ 群 | ✅（AC-V27 新增） |

### 5.2 当前实际工具列表

#### QQAgent 工具集（qq-agent.ts，继承 MainAgent）

| 工具名 | 用途 | 参数 | 实现方式 | 状态 |
|--------|------|------|---------|------|
| `qq_send` | 发送 QQ 消息 | type, target, content, file_url?, file_name? | OneBotClient.sendMessage | ✅ |
| `qq_info` | 查询 QQ 信息 | type, target_id | OneBotClient.getGroupInfo / getGroupMemberList / getStrangerInfo | ✅ 已确认 |
| `qq_group_manage` | 群管理操作 | action, group_id, user_id?, duration?, card?, flag?, message_id?, reason?, approve? | OneBotClient API | ✅ |
| `qq_notify` | 主动通知 | group_id, content, template? | OneBotClient.sendGroupMsg | ✅ |
| `request_game_action` | 请求游戏操作 | description, priority? | MainAgentRegistry → MainAgent.handle | ✅ |
| 游戏工具集 | 移动、操作、背包等 | 若干 | 继承 MainAgent 的全部工具 | ✅ |

#### 主 Agent 工具集（已实现）

| 工具名 | 用途 | 参数 | 实现方式 | 状态 |
|--------|------|------|---------|------|
| `notify_qq` | 通知 QQ 群 | content, target? | QQAgent.sendQQMessage → Pipeline 中间件 | ✅ 已注册 |

### 5.3 关键验证：`qq_info` 工具

**验证结论**：`qq_info` 工具已正确实现，调用 OneBot API。

**文件**：`d:\McAgent\packages\agent-core\src\main\qq-bot\qq_info.ts`

**关键代码**：

```typescript
case 'qq_info': {
  const { type, target_id } = args;
  let result;
  switch (type) {
    case 'group':
      result = await this.client.getGroupInfo(target_id);
      break;
    case 'members':
      result = await this.client.getGroupMemberList(target_id);
      break;
    case 'user':
      result = await this.client.getStrangerInfo(target_id);
      break;
  }
  return { success: true, result };
}
```

### 5.4 差异分析

| 设计文档要求 | 当前实现 | 差距 |
|-------------|---------|------|
| `qq_send` | ✅ | 一致 |
| `qq_info` | ✅ | 已确认正确调用 OneBot API |
| `qq_group_manage` | ✅ | 一致 |
| `qq_notify` | ✅ | 一致 |
| `request_game_action` | ✅ | 一致 |
| 消息队列系统 | ❌ | 设计文档中的消息队列（存储、获取未读、标记已读）未实现（P2 可选） |
| 主 Agent 侧 `notify_qq` | ❌ | `sendQQMessage()` 已实现，但工具注册和管道集成待完成 |

---

## 第6章 事件流对比

### 6.1 修改前事件流

#### 消息接收与处理流

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  QQ 用户     │───►│  NapCat      │───►│OneBotClient  │───►│qq-bot-handler│
│  发消息      │    │  WebSocket   │    │  onMessage   │    │  路由消息    │
└──────────────┘    └──────────────┘    └──────────────┘    └──────┬───────┘
                                                                    │
                                                                    ▼
                                                          ┌──────────────────┐
                                                          │ message-router   │
                                                          │ routeQQMsgToAgent│
                                                          │ (无 @ 过滤)      │
                                                          └────────┬─────────┘
                                                                    │
                                               ┌────────────────────┼────┐
                                               ▼                    ▼    ▼
                                        ┌──────────────┐    ┌──────────────┐
                                        │  QQAgent     │    │  MainAgent   │
                                        │  handleQQMsg │    │  handle()    │
                                        └──────────────┘    └──────────────┘
                                               │
                                               ▼
                                        ┌──────────────┐
                                        │  LLM 调用     │
                                        │  → 工具执行   │
                                        │  → 生成回复   │
                                        └──────────────┘
                                               │
                                               ▼
                                        ┌──────────────┐
                                        │  OneBotClient │
                                        │  sendGroupMsg │
                                        └──────────────┘
```

#### 事件触发流

```
                    ┌─────────────────────────────────────────────┐
                    │            TriggerEngine                     │
                    │                                              │
                    │  Adapters:                                    │
                    │    ├─ CronTriggerAdapter  (定时调度)          │
                    │    ├─ GameChatTriggerAdapter (游戏聊天)       │
                    │    ├─ PluginEventTriggerAdapter (插件事件)    │
                    │    └─ QQTriggerAdapter (QQ 消息 → 事件)      │
                    │                                              │
                    │  EventBus → ActionExecutor                    │
                    │    ├─ send_llm → MainAgent / QQAgent         │
                    │    ├─ send_qq → QQ 群/私聊                   │
                    │    ├─ create_task → TaskManager               │
                    │    └─ call_tool → 工具调用                    │
                    └─────────────────────────────────────────────┘
```

### 6.2 修改后事件流

#### 触发方式 1: 被 @ 触发（v2.0 新增）

```
QQ 群消息 (含 @机器人)
  → OneBot 接收
  → routeQQMessageToAgent()
  → 群组过滤（检查 groupIds）
  → [新增] 检查 binding.mentionOnly === true
    → YES → 检查 isAtBot() === true
      → 是 → 调用 QQAgent.handleQQMessage()
      → 否 → return false（忽略）
    → NO （mentionOnly=false）→ 正常处理（兼容旧行为）
  → LLM 处理 → 回复
```

#### 触发方式 2: 定时触发（随机时间段 — 待实现）

```
每天 00:00
  → CronTriggerAdapter 计算当天随机时间点
  → 注册定时器

到达随机时间点
  → CronTriggerAdapter.fire()
  → TriggerEngine 匹配规则
  → ActionExecutor 执行动作
    → send_llm target='qq_sub_agent'
    → QQAgent 处理（可主动发送消息）
```

#### 触发方式 3: 被主 Agent 调度（v2.1 已实现）

```
主 Agent 在游戏中完成任务
  → LLM 决定调用 notify_qq 工具
  → pipeline 解析 tool_calls
  → 中间件 notify_qq_handler 拦截
    → 通过 MainAgentRegistry.findQQAgent() 查找 QQAgent
    → QQAgent.sendQQMessage()（✅ 已实现）
    → OneBotClient.sendGroupMsg()
    → 返回结果注入 pipeline
  → 继续处理其他工具调用
  → QQ 群收到通知
```

### 6.3 差异汇总

| 事件流环节 | 修改前 | 修改后 | 状态 |
|-----------|--------|--------|------|
| @ 触发过滤 | 不过滤，所有消息都处理 | 新增 `mentionOnly` 过滤，仅 @ 消息触发 | ✅ 已实现 |
| 定时触发 | 固定 cron/interval | 未修改 | ❌ 未实现 |
| 主 Agent 调度 | 无父→子调度通道 | 新增 `notify_qq` 工具 + Pipeline 中间件 | ✅ 已实现 |
| 消息队列 | 无 | 未修改 | ❌ P2 可选 |

---

## 第7章 修改清单与实施状态

### 7.1 高优先级（P0 — 核心功能）

| # | 修改项 | 涉及文件 | 工作量 | 状态 |
|---|--------|---------|-------|------|
| 1 | `message-router.ts` 增加 `mentionOnly` 过滤 | `message-router.ts`, `types.ts` | 小 | ✅ 已实现 |
| 2 | `QQAgent` 新增 `sendQQMessage()` 方法 | `qq-agent.ts` | 小 | ✅ 已实现 |
| 3 | 主 Agent 注册 `notify_qq` 工具 | `notify_qq.ts`, `tool-registry.ts`, `main-agent-registry.ts` | 中 | ✅ 已实现 |
| 4 | 修复 `qq_info` 工具 | `qq_info.ts` | 小 | ✅ 已确认正确实现 |

### 7.2 中优先级（P1 — 体验提升）

| # | 修改项 | 涉及文件 | 工作量 | 状态 |
|---|--------|---------|-------|------|
| 5 | SkillsView 改造为表格+开关 | `SkillsView.tsx` | 中 | ✅ 已实现 |
| 6 | AgentConfig 新增 skill 配置 | `types.ts`, `AgentConfigForm.tsx` | 中 | ✅ 已实现 |
| 7 | QQAgent 集成 SkillInjector | `qq-agent.ts`, `orchestrator.ts` | 中 | ❌ 待实现 |
| 8 | 前端 `mentionOnly` 开关 UI | `StepRobot.tsx`, `QQBindSection.tsx` | 小 | ✅ 已实现 |

### 7.3 低优先级（P2 — 扩展功能）

| # | 修改项 | 涉及文件 | 工作量 | 状态 |
|---|--------|---------|-------|------|
| 9 | 随机时间段调度 (`random_window`) | `cron-adapter.ts`, `types.ts` | 大 | ❌ 未实现 |
| 10 | 消息队列系统 | 新建 `msg-queue.ts` | 大 | ❌ 未实现 |
| 11 | 前端触发器配置 UI（随机时间段） | 新建触发器配置组件 | 大 | ❌ 未实现 |

---

## 第8章 详细工具列表（最终版）

### 8.1 QQAgent 工具集

| 工具名 | 用途 | 参数 | 实现方式 | 状态 |
|--------|------|------|---------|------|
| `qq_send` | 发送 QQ 消息 | type, target, content, file_url?, file_name? | OneBotClient.sendMessage | ✅ |
| `qq_info` | 查询 QQ 信息 | type, target_id | OneBotClient.getGroupInfo / getGroupMemberList / getStrangerInfo | ✅ |
| `qq_group_manage` | 群管理操作 | action, group_id, user_id?, duration?, card?, flag?, message_id?, reason?, approve? | OneBotClient API | ✅ |
| `qq_notify` | 主动通知 | group_id, content, template? | OneBotClient.sendGroupMsg | ✅ |
| `request_game_action` | 请求游戏操作 | description, priority? | MainAgentRegistry → MainAgent.handle | ✅ |

### 8.2 主 Agent 工具集

| 工具名 | 用途 | 参数 | 实现方式 | 状态 |
|--------|------|------|---------|------|
| `notify_qq` | 通知 QQ 群 | content, target? | QQAgent.sendQQMessage → Pipeline 中间件 | ✅ 已注册 |

### 8.3 触发器规则类型

| 类型 | 用途 | 配置方式 | 状态 |
|------|------|---------|------|
| `at_bot` | QQ 群 @ 机器人 | 自动检测 | ✅ |
| `keyword` | 关键词匹配 | 配置关键词列表 | ✅ |
| `regex` | 正则匹配 | 配置正则表达式 | ✅ |
| `cron` | 固定 cron 表达式 | 标准 cron | ✅ |
| `interval` | 固定间隔 | 秒数 | ✅ |
| `random_window` | 随机时间段 | windowStart, windowEnd, triggerCount, minInterval | ❌ 新增 |
| `composite` | 组合条件 | and/or + 子条件 | ✅ |

---

## 第9章 实施路线图

### 已完成（v2.0 / v2.1）

```
阶段 1: 核心触发逻辑完善 (P0)
├── ✅ 1.1 @ 触发过滤 (mentionOnly) — message-router.ts + 前端 UI
├── ✅ 1.2 修复 qq_info 工具 — 已确认正确调用 OneBot API
├── ✅ 1.3 主 Agent → QQ Agent 调度 — sendQQMessage() 方法已实现
└── ✅ 1.4 notify_qq 工具注册 + Pipeline 中间件 — v2.1 新增

阶段 2: Skill 管理升级 (P1)
├── ✅ 2.1 SkillsView 表格+开关 — 表格布局 + 启用开关
├── ✅ 2.2 Agent 级 skill 配置 — AgentConfig.skills + AgentConfigForm UI
└── ❌ 2.3 QQAgent 集成 SkillInjector — 待实现
```

### 待完成

```
阶段 2 剩余:
└── ❌ QQAgent 集成 SkillInjector

阶段 3: 高级调度功能 (P2)
├── ❌ 3.1 随机时间段调度
├── ❌ 3.2 消息队列系统
└── ❌ 3.3 前端触发器配置 UI
```

---

## 第10章 风险与未决

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| `mentionOnly` 可能漏掉非 @ 消息 | 用户不 @ 机器人时不会触发 | 默认 `mentionOnly=false`（兼容当前行为），由用户选择开启 |
| `notify_qq` 需要 QQAgent 实例引用 | 若 QQAgent 未启动，工具调用失败 | 中间件中检查 QQAgent 状态，失败时返回明确错误信息 |
| 随机时间段调度依赖 `node-cron` | 每次重启后需重新计算当天调度 | 在 `CronTriggerAdapter.start()` 中重新计算 |
| 旧版 `qq-sub-agent.ts` 与新 `qq-agent.ts` 共存 | 可能造成混淆 | 旧版已标记废弃，建议正式移除 |
| Skill 注入可能超出 token 预算 | QQAgent 的 context 膨胀 | 复用 `SkillInjector` 的 `totalSkillBudget` 控制 |