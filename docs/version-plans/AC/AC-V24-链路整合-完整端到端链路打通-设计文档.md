# AC-V24 链路整合：完整端到端链路打通

## 1. 背景与目标

### 1.1 背景
经过 V20（主链路组装）、V22（LLM 工作流编排）、V23（QQ Agent 继承 MainAgent）三个版本迭代，核心模块已基本就绪，但各模块之间缺乏串联，导致：
- 创建智能体后，MainAgent 实例未在 MainAgentRegistry 中预热
- QQ 消息到达 OneBot 后，仅做日志记录，未路由到 QQAgent
- 两份 QQ Sub-Agent 实现（旧 QQSubAgent 独立版 vs 新 QQAgent 继承版）并存，但实际链路使用旧版
- 智能体数据分散在 SQLite 和 JSON 文件中，迁移不便

### 1.2 目标
**核心目标**：用户从前端创建智能体 → 绑定 QQ 账号 → 发送 QQ 消息触发完整 Agent 逻辑，整条链路全部打通。

**具体要求**：
1. 智能体实例数据全部存在模组储存文件夹（`Alice/agents/`），支持快速迁移
2. QQ 机器人具备完整 Agent 逻辑，用户发消息即可触发
3. 从前端到后端（Electron 主进程 → Agent Core → QQ Bot → LLM → 回复）链路完整可用
4. 无需用户手动重启或额外配置

---

## 2. 当前实现状态评估

### 2.1 ✅ 已完成模块

| 模块 | 文件 | 状态 |
|------|------|------|
| MainAgent 主体 | `main-agent.ts` | ✅ 完整实现，支持多轮 LLM 循环、工具调用、历史持久化 |
| MainAgentRegistry | `main-agent-registry.ts` | ✅ 完整实现，按 (workspaceId, agentId) 缓存 MainAgent 实例 |
| QQAgent（V23 新） | `qq-bot/qq-agent.ts` | ✅ 继承 MainAgent，实现 `handleQQMessage()` 方法 |
| NapCat 管理器 | `qq-bot/napcat-manager.ts` | ✅ 完整生命周期管理（下载、安装、启动、扫码登录、崩溃恢复） |
| OneBot 客户端 | `qq-bot/onebot-client.ts` | ✅ WebSocket 客户端，消息收发、心跳、自动重连 |
| Agent 配置管理 | `agent/agent-config-manager.ts` | ✅ CRUD 操作，SQLite 持久化 |
| Agent 文件导出 | `agent/agent-file-exporter.ts` | ✅ 导出到 `Alice/agents/` 模组目录 |
| QQ IPC 处理器 | `ipc/qq-bot-handler.ts` | ✅ 完整 QQ 账号管理后台（添加、删除、启停、扫码登录） |
| 前端 QQ 机器人页 | `renderer/…/RobotPage.tsx` | ✅ 账号列表、详情、添加面板、安装向导 |
| 前端智能体向导 | `renderer/…/AgentCreateWizard.tsx` | ✅ 5 步向导，含 QQ 绑定步骤 |
| V22 编排层 | `orchestration/` | ✅ PlanStore、Orchestrator、SkillInjector 等 |
| 触发器模块 | `trigger/` | ✅ TriggerModule、ActionExecutor、QQ 触发器适配器 |
| 启动引导 | `ipc/index.ts` `bootstrapAndWireAgents()` | ✅ bootstrap LLM 系统 + 构造 MainAgentRegistry |

### 2.2 ❌ 缺失 / 需修复的链路

| 链路缺口 | 影响 | 严重程度 |
|----------|------|----------|
| 创建 Agent 后未预热 MainAgent | 首次 QQ 消息触发时 MainAgent 还未构造，需等待异步初始化 | 高 |
| OneBot 消息未路由到 QQAgent | `connectOneBot()` 的 `onMessage` 仅做日志，不处理消息 | 致命 |
| QQ Agent 绑定未持久化到模组目录 | 迁移后丢失 QQ 绑定关系 | 中 |
| 旧 QQSubAgent 仍在使用 | `integration.ts` 使用旧版，而非新 QQAgent | 中 |
| 前端 StepRobot 仍使用 MOCK 账号 | 已修复，但需确认 | 低 |
| 模组目录缺少 agents 子目录创建逻辑 | `AgentFileExporter` 在无实例时跳过导出 | 中 |

---

## 3. 架构设计

### 3.1 完整数据流

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端（Electron Renderer）                   │
│  AgentCreateWizard → agent:create (IPC)                         │
│  RobotPage → qq-bot:toggle-account (IPC)                        │
└───────────────────────────┬─────────────────────────────────────┘
                            │ IPC
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Electron 主进程（Main Process）                  │
│                                                                  │
│  ┌─────────────────────┐    ┌───────────────────────────────┐   │
│  │  AgentConfigManager  │    │     qq-bot-handler.ts         │   │
│  │  - create()          │    │  - connectOneBot()            │   │
│  │  - SQLite 持久化      │    │  - onMessage → 路由到 QQAgent │   │
│  │  - 导出到 Alice/agents/│    │  - 管理 NapCat + OneBot 连接 │   │
│  └──────────┬──────────┘    └──────────────┬────────────────┘   │
│             │                               │                    │
│             ▼                               ▼                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                 MainAgentRegistry                          │   │
│  │  - get(workspaceId, agentId) → MainAgent                  │   │
│  │  - 预热：Agent 创建后立即构造 MainAgent 实例                │   │
│  │  - 缓存 agentId → MainAgent 映射                          │   │
│  └──────────────────────────┬───────────────────────────────┘   │
│                             │                                    │
│              ┌──────────────┴──────────────┐                    │
│              ▼                              ▼                    │
│  ┌─────────────────────┐     ┌────────────────────────┐         │
│  │  MainAgent (主 Agent) │     │  QQAgent (QQ 子 Agent)  │         │
│  │  - 处理游戏操作        │     │  - extends MainAgent   │         │
│  │  - source='trigger'  │     │  - handleQQMessage()   │         │
│  │  - 使用 mainModel    │     │  - source='qq'         │         │
│  └─────────────────────┘     │  - 使用 qqBotModel      │         │
│                               └───────────┬────────────┘         │
│                                           │                      │
│                                    OneBotClient.sendMessage()    │
│                                           │                      │
└───────────────────────────────────────────┼──────────────────────┘
                                            │ WebSocket
                                            ▼
                               ┌──────────────────────┐
                               │  NapCat (OneBot 实现)  │
                               │  - 接收 QQ 消息        │
                               │  - 转发到 WebSocket    │
                               │  - 发送消息到 QQ       │
                               └──────────────────────┘
                                            │
                                            ▼
                                     ┌──────────────┐
                                     │   QQ 服务器    │
                                     │   (腾讯)       │
                                     └──────────────┘
```

### 3.2 核心链路：QQ 消息 → Agent 回复

```
步骤1: QQ 用户发送消息 → QQ 服务器 → NapCat
步骤2: NapCat → OneBot WebSocket → OneBotClient.onMessage()
步骤3: qq-bot-handler.ts 的 onMessage 回调
步骤4: 查找账号绑定的 Agent（通过 AgentConfig → qqBinding.accountId 匹配）
步骤5: 通过 MainAgentRegistry.get(workspaceId, agentId) 获取 QQAgent 实例
步骤6: QQAgent.handleQQMessage(msg)
步骤7: MainAgent.handle({ source: 'qq', prompt: ... })
步骤8: LLM 调用 → 工具调用 → pipeline 执行
步骤9: 回复文本通过 OneBotClient.sendMessage() 返回给 QQ 用户
```

### 3.3 核心链路：创建 Agent → 预热 → 可用

```
步骤1: 用户前端填写向导 → 提交
步骤2: agent:create IPC → AgentConfigManager.create()
步骤3: SQLite 持久化
步骤4: AgentFileExporter.export() → 导出到 Alice/agents/<agentId>.json
步骤5: 若 qqBinding.enabled === true:
  步骤5a: 通过 MainAgentRegistry.get() 预热 MainAgent 实例
  步骤5b: 若 qqBinding.accountId 对应的 QQ 账号未连接，自动触发连接
步骤6: 前端跳转到 Agent 详情页，显示"就绪"状态
```

---

## 4. 详细实现

### 4.1 模块：Agent 创建后预热 MainAgent

**文件**: `agent-handler.ts`

**修改点**: 在 `agent:create` IPC handler 中，创建成功后，若 `qqBinding.enabled` 则预热 MainAgent。

```typescript
// 在 registerAgentHandlers() 的 agent:create 中
ipcMain.handle('agent:create', async (_event, config: AgentConfig) => {
  try {
    const id = await agentConfigManager.create(config)
    
    // V24: 若启用了 QQ 绑定，预热 MainAgent 实例
    if (config.qqBinding?.enabled) {
      const workspaceId = config.workspaceId ?? ''
      const registry = getMainAgentRegistry()
      // 异步预热，不阻塞前端响应
      registry.get(workspaceId, id).catch(err =>
        console.warn(`[AgentHandler] 预热 MainAgent 失败 (${id}):`, err)
      )
    }
    
    return { id, success: true }
  } catch (err) {
    return { id: '', success: false, error: (err as Error).message }
  }
})
```

### 4.2 模块：QQ 消息路由到 QQAgent

**文件**: `qq-bot-handler.ts`

**核心修改点**: `connectOneBot()` 中的 `onMessage` 回调，从日志记录改为路由到 QQAgent。

```typescript
// registerQQBotHandlers() 内部，connectOneBot 函数
async function connectOneBot(account: QQAccount): Promise<void> {
  // ... 现有代码 ...
  
  client.onMessage((msg: QQMessage) => {
    // 1. 日志记录（保留）
    appendLog(account.id, { /* ... */ })
    
    // 2. V24: 路由到绑定的 QQAgent
    routeQQMessageToAgent(account.id, msg).catch(err =>
      console.error(`[QQBot] 路由消息到 Agent 失败:`, err)
    )
  })
  
  // ... 现有代码 ...
}
```

**新增函数**: `routeQQMessageToAgent()`

```typescript
/**
 * V24: 将 QQ 消息路由到绑定的 Agent 实例
 * 
 * 查找策略：
 * 1. 遍历 AgentConfigManager 缓存，找到 qqBinding.accountId 匹配的 Agent
 * 2. 通过 MainAgentRegistry.get() 获取 MainAgent 实例
 * 3. 通过 QQAgent.handleQQMessage() 处理消息
 * 4. 将回复发送回 QQ
 */
async function routeQQMessageToAgent(accountId: string, msg: QQMessage): Promise<void> {
  const registry = getMainAgentRegistry()
  const agentConfigManager = getSharedAgentConfigManager()
  
  // 查找绑定了该 QQ 账号的 Agent
  const agents = await agentConfigManager.list()
  const boundAgent = agents.find(a => {
    // 需要读完整配置获取 qqBinding
    // 简化：通过 agentConfigManager.get(id) 逐个检查
    // 实际应加缓存或索引
    return false // 待实现
  })
  
  if (!boundAgent) {
    console.log(`[QQBot] 账号 ${accountId} 未绑定任何 Agent，消息已记录但不处理`)
    return
  }
  
  // 获取 Agent 完整配置
  const config = await agentConfigManager.get(boundAgent.id)
  if (!config?.qqBinding?.enabled) return
  
  // 检查群组过滤
  if (msg.type === 'group' && msg.groupId) {
    const boundGroups = config.qqBinding.groupIds ?? []
    if (boundGroups.length > 0 && !boundGroups.includes(msg.groupId)) {
      return // 不在监听群组列表中，忽略
    }
  }
  
  // 获取 MainAgent 实例
  const workspaceId = config.workspaceId ?? ''
  const agent = await registry.get(workspaceId, boundAgent.id)
  if (!agent) {
    console.warn(`[QQBot] Agent ${boundAgent.id} 未就绪`)
    return
  }
  
  // 调用 handleQQMessage（需要 QQAgent 类型）
  // 由于 registry 返回的是 MainAgent，需要判断是否为 QQAgent
  try {
    // 检查 agent 是否支持 QQ 消息处理
    if (typeof (agent as any).handleQQMessage !== 'function') {
      console.warn(`[QQBot] Agent ${boundAgent.id} 不是 QQAgent，无法处理 QQ 消息`)
      return
    }
    
    const result = await (agent as QQAgent).handleQQMessage(msg)
    
    // 发送回复
    if (result.response) {
      const target = msg.groupId ?? msg.userId
      const messageType = msg.type === 'group' ? 'sendGroupMsg' : 'sendPrivateMsg'
      // 通过 OneBot 客户端发送
      const client = activeClients.get(accountId)
      if (client) {
        if (msg.type === 'group') {
          await client.sendGroupMsg(target, result.response)
        } else {
          await client.sendPrivateMsg(target, result.response)
        }
      }
    }
  } catch (err) {
    console.error(`[QQBot] Agent 处理 QQ 消息失败:`, err)
  }
}
```

### 4.3 模块：Agent 数据库添加 QQ 绑定索引

**文件**: `database-manager.ts`

**修改点**: 添加 `qq_binding_account_id` 索引，加速 `routeQQMessageToAgent` 中的查找。

```sql
-- V24: QQ 绑定索引，加速 QQ 消息路由时的 Agent 查找
CREATE INDEX IF NOT EXISTS idx_agents_qq_binding 
ON agents (json_extract(qq_binding_json, '$.accountId'));
```

### 4.4 模块：QQ Agent 创建流程

**文件**: `agent-handler.ts` / `ipc/index.ts`

**修改点**: 创建 Agent 时，若 `qqBinding.enabled` 且绑定了账号，自动创建对应的 QQAgent 子类实例。

**设计说明**:
- `MainAgentRegistry.constructAgent()` 目前只构造 `MainAgent`
- 需要根据 AgentConfig 中的 `qqBinding.enabled` 决定构造 `MainAgent` 还是 `QQAgent`
- `QQAgent` 需要额外依赖：`OneBotClient`、`PermissionManager`、`MainAgentRegistry`、`AgentReportBus`、`PlayerIdentityStore`、`MemoryManager`、`mainAgentId`

**方案**: 在 `MainAgentRegistry` 中增加 `constructAgent` 的工厂方法支持。

```typescript
// MainAgentRegistry 新增
private constructAgentForConfig(
  workspaceId: string,
  agentId: string,
  agentConfig: AgentConfig,
  // V24: 额外依赖
  extra?: {
    client?: OneBotClient
    mainAgentRegistry?: MainAgentRegistry
    reportBus?: AgentReportBus
    playerIdentity?: PlayerIdentityStore
    memoryManager?: MemoryManager
    mainAgentId?: string
  }
): MainAgent {
  const isQQAgent = agentConfig.qqBinding?.enabled === true && !!extra?.client
  
  if (isQQAgent) {
    return new QQAgent({
      agentConfig,
      workspaceId,
      agentId,
      toolRegistry: this.deps.toolRegistry,
      promptBuilder: this.deps.promptBuilderFactory(this.deps.toolRegistry),
      modelRouter: this.deps.modelRouter,
      providerRegistry: this.deps.providerRegistry,
      pipeline: this.deps.pipelineFactory(),
      connectionResolver: this.deps.connectionResolver,
      historyStore: this.deps.historyStore,
      scheduler: this.deps.scheduler,
      observer: this.deps.observer,
      maxRounds: this.deps.maxRounds ?? DEFAULT_MAX_ROUNDS,
      // QQAgent 额外依赖
      client: extra!.client!,
      permissionManager: extra!.permissionManager!,
      mainAgentRegistry: extra!.mainAgentRegistry!,
      reportBus: extra!.reportBus!,
      playerIdentity: extra!.playerIdentity!,
      memoryManager: extra!.memoryManager!,
      mainAgentId: extra!.mainAgentId!,
    })
  }
  
  return new MainAgent({ /* ... 现有代码 ... */ })
}
```

### 4.5 模块：数据持久化到模组目录

**文件**: `agent-file-exporter.ts`

**当前状态**: 仅导出 `AgentConfig` 到 `Alice/agents/<agentId>.json`

**V24 增强**: 将 QQ 绑定配置也导出到同一文件，并确保 `Alice/agents/` 目录在无实例时也能创建。

```typescript
// 当前 ExportedAgentConfig 已包含 qq_binding 字段
// 已有：
// qq_binding: {
//   enabled: boolean
//   account_id: string | null
//   group_ids: string[] | null
// }

// V24: 确保 agents 目录始终存在
static async ensureAgentsDir(): Promise<string | null> {
  const aliceDir = this.resolveAliceDir()
  if (!aliceDir) {
    // 尝试使用默认路径
    const defaultDir = path.join(process.cwd(), 'Alice')
    fs.mkdirSync(defaultDir, { recursive: true })
    const agentsDir = path.join(defaultDir, AGENTS_DIR)
    fs.mkdirSync(agentsDir, { recursive: true })
    return agentsDir
  }
  const agentsDir = path.join(aliceDir, AGENTS_DIR)
  fs.mkdirSync(agentsDir, { recursive: true })
  return agentsDir
}
```

**模组目录结构**:
```
Alice/
├── agents/
│   ├── agent-xxxx.json    # 智能体配置（含 QQ 绑定）
│   └── agent-yyyy.json
├── mcagent_instance.json  # 实例配置（已有）
└── qq-bot/                # V24: QQ 机器人数据
    ├── accounts.json      # QQ 账号列表
    └── logs/              # 消息日志
        ├── account-1.json
        └── account-2.json
```

### 4.6 模块：Agent 状态管理

**文件**: `agent-handler.ts` / 新增 IPC

**新增 IPC**: `agent:get-status` 返回 Agent 的运行时状态。

```typescript
// V24: 获取 Agent 运行时状态
ipcMain.handle('agent:get-status', async (_event, { id }) => {
  const config = await agentConfigManager.get(id)
  if (!config) return { status: 'not_found' }
  
  const workspaceId = config.workspaceId ?? ''
  const registry = getMainAgentRegistry()
  const agent = registry.getSync(workspaceId, id)
  
  if (!agent) {
    return { status: 'initializing' }
  }
  
  // 获取 QQ 连接状态
  let qqStatus = 'disconnected'
  if (config.qqBinding?.enabled && config.qqBinding.accountId) {
    const client = activeClients.get(config.qqBinding.accountId)
    if (client) {
      qqStatus = client.getStatus()
    }
  }
  
  return {
    status: 'ready',
    qqStatus,
    roundLimit: 5,
  }
})
```

---

## 5. 前端修改

### 5.1 StepRobot 组件

**文件**: `renderer/…/StepRobot.tsx`

**当前状态**: 已从 qqBotStore 加载真实账号数据，但群组列表从 bridge 配置获取。

**V24 修改**: 无重大修改，已基本可用。

### 5.2 Agent 详情页

**文件**: `renderer/…/AgentInstanceView.tsx`

**V24 新增**: Agent 详情页显示 QQ 状态

```tsx
// 在 Agent 详情页中
{agent.qqBinding?.enabled && (
  <div className="mt-4 p-3 bg-blue-50 rounded-lg">
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${
        qqStatus === 'connected' ? 'bg-green-500' : 'bg-gray-400'
      }`} />
      <span className="text-sm text-gray-600">
        QQ 机器人: {qqStatus === 'connected' ? '在线' : '离线'}
      </span>
    </div>
  </div>
)}
```

---

## 6. 启动流程修改

### 6.1 应用启动时自动预热

**文件**: `main.ts` → `initializeServices()`

**V24 修改**: 启动完成后，自动预热所有启用了 QQ 绑定的 Agent。

```typescript
// 在 initializeServices() 末尾，QQ 集成初始化完成后
// V24: 预热所有启用了 QQ 绑定的 Agent
async function warmupQQAgents(): Promise<void> {
  try {
    const agents = await agentConfigManager.list()
    const registry = getMainAgentRegistry()
    
    for (const agent of agents) {
      const config = await agentConfigManager.get(agent.id)
      if (config?.qqBinding?.enabled) {
        const workspaceId = config.workspaceId ?? ''
        registry.get(workspaceId, agent.id).catch(err =>
          console.warn(`[Boot] 预热 Agent ${agent.id} 失败:`, err)
        )
      }
    }
  } catch (err) {
    console.warn('[Boot] 预热 QQ Agent 失败:', err)
  }
}

// 在 initializeServices 最后调用
warmupQQAgents()
```

### 6.2 模组目录初始化

**文件**: `main.ts` → `initializeServices()`

**V24 修改**: 确保 `Alice/agents/` 目录在启动时存在。

```typescript
// 在 initializeServices 中，数据库初始化之后
// V24: 确保模组代理目录存在
const aliceDir = path.join(app.getAppPath(), 'Alice')
const agentsDir = path.join(aliceDir, 'agents')
fs.mkdirSync(agentsDir, { recursive: true })
```

---

## 7. 文件清单与修改汇总

### 7.1 新增文件

| 文件 | 说明 |
|------|------|
| `packages/agent-core/src/main/qq-bot/message-router.ts` | QQ 消息路由模块，负责将 OneBot 消息路由到绑定的 QQAgent |

### 7.2 修改文件

| 文件 | 修改内容 |
|------|----------|
| `packages/agent-core/src/main/ipc/agent-handler.ts` | `agent:create` 成功后预热 MainAgent；新增 `agent:get-status` IPC |
| `packages/agent-core/src/main/ipc/qq-bot-handler.ts` | `connectOneBot()` 中 `onMessage` 新增消息路由到 QQAgent |
| `packages/agent-core/src/main/agent/main-agent-registry.ts` | 新增 `constructAgentForConfig()` 工厂方法，支持创建 QQAgent |
| `packages/agent-core/src/main/agent/agent-file-exporter.ts` | 增强 `ensureAgentsDir()`，无实例时也创建 `Alice/agents/` |
| `packages/agent-core/src/main/database/database-manager.ts` | 添加 `idx_agents_qq_binding` 索引 |
| `packages/agent-core/src/main/index.ts` | `initializeServices()` 末尾调用 `warmupQQAgents()` |
| `packages/agent-core/src/renderer/…/AgentInstanceView.tsx` | 显示 QQ 连接状态 |

### 7.3 无需修改

| 文件 | 原因 |
|------|------|
| `qq-bot/qq-agent.ts` | V23 已实现完整 `handleQQMessage()` |
| `qq-bot/onebot-client.ts` | 消息收发、心跳、重连均完整 |
| `qq-bot/napcat-manager.ts` | 完整生命周期管理 |
| `qq-bot/config.ts` | 配置完整 |
| `qq-bot/types.ts` | 类型定义完整 |
| `agent/agent-config-manager.ts` | Agent 配置 CRUD 完整 |
| `trigger/action-executor.ts` | 触发器执行器完整 |
| `orchestration/` | V22 编排层完整 |

---

## 8. 验收标准

### 8.1 功能验收

| # | 验收项 | 验收方法 |
|---|--------|----------|
| 1 | 前端创建智能体（5 步向导） | 填写向导 → 点击"确定" → 创建成功 → 跳转到详情页 |
| 2 | 创建后数据持久化到模组目录 | 检查 `Alice/agents/<agentId>.json` 文件存在 |
| 3 | 创建后 MainAgent 预热 | 日志输出 `[MainAgentRegistry] 构造 MainAgent 成功` |
| 4 | QQ 机器人面板添加账号 | 扫码登录 → 账号显示在线 |
| 5 | 智能体绑定 QQ 账号 | 向导步骤 3 选择已登录的 QQ 账号 |
| 6 | QQ 消息触发 Agent 逻辑 | 发送消息 → Agent 回复（有 LLM 回复文字） |
| 7 | QQ 消息触发游戏操作 | 发送"查询服务器状态" → Agent 调用工具 → 回复结果 |
| 8 | 迁移场景：复制模组目录到新电脑 | 启动 → 自动加载 Agent 配置 → QQ 重新连接 |
| 9 | 自动启动：应用重启后自动连接 QQ | 查看日志 `[QQBot] 自动启动账号` |
| 10 | Agent 状态显示 | 前端 Agent 详情页显示 QQ 在线状态 |

### 8.2 性能验收

| # | 验收项 | 标准 |
|---|--------|------|
| 1 | Agent 创建响应时间 | ≤ 1s（不含 LLM 预热） |
| 2 | QQ 消息到回复的延迟 | 取决于 LLM 调用时间，≤ 10s |
| 3 | 启动预热时间 | ≤ 5s |

### 8.3 边界情况

| # | 场景 | 预期行为 |
|---|------|----------|
| 1 | QQ 账号未登录，Agent 已绑定 | 消息不处理，日志记录"QQ 未连接" |
| 2 | Agent 未绑定任何 QQ 账号 | QQ 消息只记录日志，不处理 |
| 3 | 多个 Agent 绑定同一个 QQ 账号 | 只路由到第一个匹配的 Agent |
| 4 | Agent 正在处理时又收到新消息 | 排队等待，按顺序处理 |
| 5 | 模组目录不可写 | 日志警告，降级为仅 SQLite 持久化 |
| 6 | 创建 Agent 后立即删除 | 预热中的 Promise 在 catch 中静默处理 |

---

## 9. 实现顺序

### Phase 1: 核心链路（优先级最高）

1. **`message-router.ts`** - 实现 QQ 消息路由模块
2. **`qq-bot-handler.ts`** - `connectOneBot()` 的 `onMessage` 接入路由
3. **`agent-handler.ts`** - `agent:create` 后预热 MainAgent
4. **`main.ts`** - 启动时预热所有 QQ Agent

### Phase 2: 数据持久化

5. **`agent-file-exporter.ts`** - 增强 `ensureAgentsDir()`
6. **`database-manager.ts`** - 添加 QQ 绑定索引

### Phase 3: UI 增强

7. **`AgentInstanceView.tsx`** - 显示 QQ 状态
8. **`agent-handler.ts`** - 新增 `agent:get-status` IPC

### Phase 4: 测试与验证

9. 编写集成测试
10. 手动端到端验收

---

## 10. 风险与注意事项

### 10.1 已知风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| QQAgent 依赖 `OneBotClient`，但 `connectOneBot()` 和 `MainAgentRegistry` 在不同模块中 | 循环依赖 | 使用 `getMainAgentRegistry()` 和 `activeClients` Map 作为桥梁 |
| 旧版 `QQSubAgent` 和 `integration.ts` 仍在使用 | 新旧混淆 | 明确标记旧版为 `@deprecated`，V24 完成后删除 |
| 多个 QQ 账号限制 | 只能单账号 | V24 保持单账号限制，V25 解除 |
| `MainAgentRegistry.get()` 中的 `constructAgent` 不支持 `QQAgent` | 无法创建 QQAgent 实例 | 添加 `constructAgentForConfig()` 工厂方法 |

### 10.2 注意事项

- `QQAgent` 需要 `OneBotClient` 实例，但 `MainAgentRegistry` 在构造时不一定有 `OneBotClient`
- 解决方案：QQAgent 的构造延迟到第一次 QQ 消息到达时，此时 `OneBotClient` 已就绪
- 或者：在 `routeQQMessageToAgent` 中，若 Agent 尚未构造，携带依赖现场构造
- 迁移时，`Alcie/agents/` 目录和 `mcagent_instance.json` 必须一起复制
- 文档中 `Alcie` 是项目命名，实际目录名为 `Alice`

---

## 附录 A：依赖关系图

```
agent-handler.ts
  ├── AgentConfigManager (create → 预热 → MainAgentRegistry.get)
  ├── MainAgentRegistry (get → cache → MainAgent/QQAgent)
  └── MainAgent (handle → LLM → pipeline)

qq-bot-handler.ts
  ├── connectOneBot (onMessage → routeQQMessageToAgent)
  ├── MainAgentRegistry (get → QQAgent.handleQQMessage)
  ├── AgentConfigManager (find bound agent by accountId)
  └── OneBotClient (send reply)

main.ts
  ├── initializeServices (bootstrapAndWireAgents → MainAgentRegistry)
  ├── warmupQQAgents (AgentConfigManager.list → MainAgentRegistry.get)
  └── autoStartQQBotAccounts (connectOneBot → OneBotClient)
```

## 附录 B：关键代码引用

| 文件 | 行号 | 内容 |
|------|------|------|
| [main.ts](../../../packages/agent-core/src/main/index.ts) | L353-365 | QQ 机器人集成初始化 + `autoStartQQBotAccounts()` |
| [qq-bot-handler.ts](../../../packages/agent-core/src/main/ipc/qq-bot-handler.ts) | L488-506 | `connectOneBot()` 的 `onMessage` 回调（当前仅日志） |
| [qq-bot-handler.ts](../../../packages/agent-core/src/main/ipc/qq-bot-handler.ts) | L997-1054 | `autoStartQQBotAccounts()` 自动启动逻辑 |
| [agent-handler.ts](../../../packages/agent-core/src/main/ipc/agent-handler.ts) | L32-37 | `agent:create` IPC handler |
| [agent-config-manager.ts](../../../packages/agent-core/src/main/agent/agent-config-manager.ts) | L10-24 | `create()` 方法 |
| [main-agent-registry.ts](../../../packages/agent-core/src/main/agent/main-agent-registry.ts) | L92-136 | `get()` 方法（异步构造 + 缓存） |
| [main-agent-registry.ts](../../../packages/agent-core/src/main/agent/main-agent-registry.ts) | L206-234 | `constructAgent()` 方法（仅构造 MainAgent） |
| [qq-agent.ts](../../../packages/agent-core/src/main/qq-bot/qq-agent.ts) | L136-204 | `handleQQMessage()` 完整实现 |
| [agent-file-exporter.ts](../../../packages/agent-core/src/main/agent/agent-file-exporter.ts) | L70-83 | `export()` 方法（导出到 Alice/agents/） |
| [ipc/index.ts](../../../packages/agent-core/src/main/ipc/index.ts) | L118-165 | `bootstrapAndWireAgents()` 启动引导 |
| [database-manager.ts](../../../packages/agent-core/src/main/database/database-manager.ts) | L749-760 | agents 表定义 |
| [StepRobot.tsx](../../../packages/agent-core/src/renderer/src/components/agent/wizard/StepRobot.tsx) | 完整文件 | 前端 QQ 绑定步骤 |