import { BrowserWindow } from 'electron'
import { registerChatHandlers } from './chat-handler'
import { registerConfigHandlers } from './config-handler'
import { registerWindowHandlers } from './window-handler'
import { registerDashboardHandlers } from './dashboard-handler'
import { registerAgentHandlers, getSharedAgentConfigManager } from './agent-handler'
import { registerModelHandlers } from './model-handler'
import { registerQQBotHandlers } from './qq-bot-handler'
import { registerLogHandlers } from './log-handler'
import { registerToolCallHandlers } from './tool-call-handler'
import { registerMemoryHandlers, setMemoryManager } from './memory-handler'
import { registerWorkspaceHandlers } from './workspace-handler'
import { registerWorldHandlers } from './world-handler'
import { registerWikiHandlers, setWikiClient, WikiClient } from '../wiki'
import { registerSearchHandlers, setSearchClient, SearchClient } from '../search'
import { registerDialogHandlers } from './dialog-handler'
import { registerTemplateHandlers } from './template-handler'
import { registerPresetHandlers } from './preset-handler'
import { registerToolHandlers } from './tool-handler'
import { registerDebugHandlers } from './debug-handler'

// V20 主链路组装相关
import { bootstrapLlmSystem } from '../llm/bootstrap'
import { MainAgentRegistry } from '../agent/main-agent-registry'
import { ConnectionResolver } from '../agent/connection-resolver'
import {
  DefaultLLMConfigManager,
  DefaultModelRouter,
  DefaultLlmRequestScheduler,
  providerRegistry,
  LLM_CONFIG_DEFAULTS,
  getLLMObserver,
} from '../llm'
import { SqliteChatHistoryStore } from '../chat-history'
import { FunctionCallingPipeline } from '../pipeline/pipeline'
import { PromptBuilder } from '../prompt/builder/prompt-builder'
import { getDatabaseManager } from '../database'
import { getWorkspaceManager } from '../workspace'
import type { TcpServer } from '../tcp'
import type { AgentEvent, EventTrigger } from '../trigger/types'

export { setMemoryManager, getSharedAgentConfigManager }

export function registerAllIpcHandlers(mainWindow: BrowserWindow): void {
  // 初始化 Wiki 客户端
  setWikiClient(new WikiClient())
  registerWikiHandlers()

  // 初始化搜索客户端
  setSearchClient(new SearchClient())
  registerSearchHandlers()

  registerChatHandlers()
  registerConfigHandlers()
  registerWindowHandlers(mainWindow)
  registerDashboardHandlers()
  registerAgentHandlers()
  registerModelHandlers()
  registerQQBotHandlers(mainWindow)
  registerLogHandlers()
  registerToolCallHandlers()
  registerMemoryHandlers()
  registerDialogHandlers()
  registerWorkspaceHandlers(mainWindow)
  registerWorldHandlers(mainWindow)
  registerPresetHandlers()
  registerToolHandlers()
  registerTemplateHandlers()
  registerDebugHandlers()
}

// ════════════════════════════════════════════════════════════════
// V20 主链路组装：bootstrap + MainAgentRegistry
// ════════════════════════════════════════════════════════════════

/** 共享的单例（首次 bootstrapAndWireAgents 时构造） */
let _agentRegistry: MainAgentRegistry | null = null
let _configManager: DefaultLLMConfigManager | null = null
let _modelRouter: DefaultModelRouter | null = null
let _scheduler: DefaultLlmRequestScheduler | null = null
let _historyStore: SqliteChatHistoryStore | null = null
let _connectionResolver: ConnectionResolver | null = null

/**
 * V20 §4.5 + §4.9：启动时引导 LLM 子系统 + 构造 MainAgentRegistry。
 *
 * 必须在 TriggerModule 构造之前调用，以便把 mainAgentProvider + resolveTarget
 * 注入到 ActionExecutor 的 actionDeps。
 *
 * 幂等：重复调用直接返回已构造的 Registry。
 *
 * @param tcpServer 主进程已构造的 TcpServer 实例（避免循环 import main/index.ts）
 */
export async function bootstrapAndWireAgents(tcpServer: TcpServer): Promise<MainAgentRegistry> {
  if (_agentRegistry) return _agentRegistry

  // 1. 构造共享依赖
  _configManager = new DefaultLLMConfigManager()
  _modelRouter = new DefaultModelRouter(providerRegistry, LLM_CONFIG_DEFAULTS.defaultRouterConfig)
  _scheduler = new DefaultLlmRequestScheduler()
  _historyStore = new SqliteChatHistoryStore(getDatabaseManager().getDb())
  _connectionResolver = new ConnectionResolver(tcpServer, getWorkspaceManager())

  // 2. bootstrap：注册 Provider + 配置 Router workspace 路由
  const agentConfigManager = getSharedAgentConfigManager()
  const bootstrapResult = await bootstrapLlmSystem({
    configManager: _configManager,
    providerRegistry,
    modelRouter: _modelRouter,
    agentConfigManager,
  })
  console.info(
    '[bootstrapAndWireAgents] LLM 子系统就绪：' +
      `${bootstrapResult.registeredProviders.length} 个 Provider，` +
      `${Object.keys(bootstrapResult.workspaceRoutes).length} 个 workspace 路由`,
  )

  // 3. 构造 MainAgentRegistry
  const toolRegistry = getWorkspaceManager().getToolRegistry()
  const observer = getLLMObserver()

  _agentRegistry = new MainAgentRegistry({
    agentConfigManager,
    toolRegistry,
    modelRouter: _modelRouter,
    providerRegistry: providerRegistry,
    connectionResolver: _connectionResolver,
    historyStore: _historyStore,
    scheduler: _scheduler,
    observer,
    pipelineFactory: () => new FunctionCallingPipeline(),
    promptBuilderFactory: (reg) => new PromptBuilder({ toolRegistry: reg }),
    maxRounds: 5,
  })

  return _agentRegistry
}

/** 获取已构造的 MainAgentRegistry（未构造时抛错） */
export function getMainAgentRegistry(): MainAgentRegistry {
  if (!_agentRegistry) {
    throw new Error('MainAgentRegistry 尚未初始化，请确保在 initializeServices 之后调用')
  }
  return _agentRegistry
}

/**
 * V20 §4.4：构造 resolveTarget 函数（给 ActionExecutor 用）。
 *
 * 规则：
 * - target='main'：通过 agentConfigManager.getMainAgent(workspaceId) 找 workspace 内 isMain=true 的 agent
 * - target='qq_sub_agent'：用 trigger.targetAgentId（DB schema 已加此字段）
 *   - trigger.targetAgentId 缺失 → 返回 undefined（由 ActionExecutor 报错）
 *
 * workspaceId 来自 event.workspaceId（trigger engine 已注入）。
 */
export function createResolveTarget(
  agentConfigManager: ReturnType<typeof getSharedAgentConfigManager>,
): (target: 'main' | 'qq_sub_agent', event: AgentEvent, trigger?: EventTrigger) =>
  { workspaceId: string; agentId: string } | undefined {
  return (target, event, trigger) => {
    const workspaceId = event.workspaceId || ''
    if (target === 'main') {
      // 同步查缓存：agentConfigManager 内部已加载到 cache，但 getMainAgent 是 async。
      // 这里走同步路径：直接遍历内存缓存。
      // 注意：若 AgentConfigManager 尚未 ensureLoaded，此调用会返回 undefined。
      // ipc 启动顺序保证 ensureLoaded 在 bootstrap 之前完成。
      const cfg = peekMainAgentSync(agentConfigManager, workspaceId)
      if (!cfg?.id) return undefined
      return { workspaceId, agentId: cfg.id }
    }
    // qq_sub_agent
    if (!trigger?.targetAgentId) return undefined
    return { workspaceId, agentId: trigger.targetAgentId }
  }
}

/**
 * 同步窥探指定 workspace 的 main agent 配置。
 *
 * AgentConfigManager.getMainAgent() 是 async（内部 ensureLoaded），
 * 但 trigger 路径需要同步解析 target。这里直接访问内部 cache
 * （通过 listByWorkspace 的同步包装实现）。
 *
 * 启动顺序保证：bootstrapAndWireAgents 调用前 agentConfigManager 已 ensureLoaded
 * （agent-handler.ts 的 registerAgentHandlers 会触发 list → ensureLoaded）。
 */
function peekMainAgentSync(
  manager: ReturnType<typeof getSharedAgentConfigManager>,
  workspaceId: string,
): { id?: string } | undefined {
  // AgentConfigManager 没有公开同步 API；用 listByWorkspace 的 Promise 立即取值
  // 不行 —— listByWorkspace 也是 async。
  // 折中：用 (manager as any).cache 的内部 Map 直接查（私有 API，谨慎使用）。
  // V20 阶段接受这一耦合；V21 可在 AgentConfigManager 上加 getMainAgentSync()。
  const cache = (manager as unknown as { cache: Map<string, { isMain?: boolean; workspaceId?: string; id?: string }> }).cache
  if (!cache) return undefined
  for (const cfg of cache.values()) {
    if ((cfg.workspaceId ?? '') === workspaceId && cfg.isMain === true) {
      return cfg
    }
  }
  return undefined
}
