/**
 * QQ 机器人集成模块
 *
 * 负责将 QQ Bot 各组件（OneBotClient、MessageHandler、QQSubAgent、
 * RemoteCommandParser、ProactiveNotifier）组装为统一模块，
 * 并接入主流程的事件总线、任务系统和工具调度器。
 */

import type { QQMessage, QQBotConfig, QQPermission, BridgeConfig } from './types';
import type { IEventBus } from '../trigger/types';
import { QQPermission as QQPerm } from './types';
import { OneBotClient } from './onebot-client';
import { PermissionManager } from './permission';
import { MessageBridge } from './message-bridge';
import { MessageHandler } from './message-handler';
import { QQSubAgent } from './qq-sub-agent';
import { RemoteCommandParser } from './remote-command-parser';
import { ProactiveNotifier } from './proactive-notifier';
import { mainAgentTaskQueue } from './main-agent-queue';
import type { IModelRouter, LLMProvider } from '../llm/types';
import { DefaultModelRouter, providerRegistry, LLM_CONFIG_DEFAULTS } from '../llm';
import type { TaskManager } from '../task';
import { getWorkspaceManager } from '../workspace';
import { getToolDispatcher } from '../pipeline/tool-dispatcher';
import { stickerGroupRegistry } from '../agent/main-agent-registry';

export interface QQBotIntegrationDeps {
  /** 任务系统（远程指令 / 主 Agent 队列使用） */
  taskManager?: TaskManager;
  /** 模型路由，未提供时使用默认配置 */
  modelRouter?: IModelRouter;
  /** Provider 获取函数，未提供时使用全局 providerRegistry */
  getProvider?: (id: string) => LLMProvider | undefined;
}

export interface QQBotIntegration {
  start(config?: Partial<QQBotConfig>): Promise<void>;
  stop(): Promise<void>;
  sendMessage(target: string, content: string, messageType: 'group' | 'private'): Promise<boolean>;
  getClient(): OneBotClient | null;
  setBridges(bridges: BridgeConfig[]): void;
  setPermissionConfig(config: Partial<{
    ownerId: string;
    admins: string[];
    whitelist: string[];
    defaultPermission: QQPermission;
    cooldownSeconds: number;
  }>): void;
  /** 绑定事件总线（供主动通知器使用） */
  bindEventBus(eventBus: IEventBus): void;
}

interface InternalState {
  client: OneBotClient | null;
  permissionManager: PermissionManager | null;
  messageHandler: MessageHandler | null;
  subAgent: QQSubAgent | null;
  commandParser: RemoteCommandParser | null;
  notifier: ProactiveNotifier | null;
  bridge: MessageBridge | null;
  config: Partial<QQBotConfig>;
  running: boolean;
}

const state: InternalState = {
  client: null,
  permissionManager: null,
  messageHandler: null,
  subAgent: null,
  commandParser: null,
  notifier: null,
  bridge: null,
  config: {},
  running: false,
};

let deps: QQBotIntegrationDeps = {};

/**
 * 初始化 QQ 机器人集成
 *
 * 注意：QQ Bot 为可选模块，初始化失败不应阻塞主流程。
 */
export function initQQBotIntegration(integrationDeps: QQBotIntegrationDeps = {}): QQBotIntegration {
  deps = integrationDeps;

  return {
    start: startIntegration,
    stop: stopIntegration,
    sendMessage: sendQQMessage,
    getClient: () => state.client,
    setBridges: configureBridges,
    setPermissionConfig: configurePermission,
    bindEventBus: (eventBus) => state.notifier?.bindEventBus?.(eventBus) ?? undefined as unknown as void,
  };
}

async function startIntegration(config: Partial<QQBotConfig> = {}): Promise<void> {
  if (state.running) return;
  state.config = config;
  state.running = true;

  try {
    // V31: 初始化表情组注册表
    stickerGroupRegistry.loadFromConfig(config.stickerGroups);

    const wsUrl = config.external?.wsProtocol && config.external.wsHost && config.external.wsPort
      ? `${config.external.wsProtocol}://${config.external.wsHost}:${config.external.wsPort}`
      : 'ws://127.0.0.1:3001';

    const client = new OneBotClient({
      wsUrl,
      accessToken: config.external?.accessToken,
      reconnectInterval: 5000,
      maxReconnectAttempts: 10,
      heartbeatInterval: 10000,
    });

    const permissionManager = new PermissionManager({
      ownerId: config.authorization?.ownerId ?? '',
      admins: config.authorization?.admins ?? [],
      whitelist: config.authorization?.whitelist ?? [],
      defaultPermission: config.authorization?.defaultPermission ?? QQPerm.BASIC,
      cooldownSeconds: config.authorization?.cooldownSeconds ?? 3,
    });

    const bridge = new MessageBridge();
    if (config.bridges) {
      bridge.configure(config.bridges);
    }

    const modelRouter = deps.modelRouter ?? createDefaultModelRouter();
    const getProvider = deps.getProvider ?? ((id: string) => providerRegistry.get(id));

    const subAgent = new QQSubAgent(modelRouter, getProvider, {
      enabled: config.subAgent?.enabled ?? true,
      maxHistoryRounds: config.subAgent?.maxHistoryRounds ?? 10,
      taskType: config.subAgent?.taskType ?? 'chat',
      gameActionTimeout: config.subAgent?.gameActionTimeout ?? 30_000,
    });
    subAgent.setClient(client);
    subAgent.setPermissionManager(permissionManager);

    const messageHandler = new MessageHandler(permissionManager, bridge, subAgent);
    messageHandler.setAllowPrivate(config.authorization?.defaultPermission !== QQPerm.NONE);

    const commandParser = new RemoteCommandParser({
      taskManager: deps.taskManager,
      getStatus: buildStatusReporter(),
    });

    registerCommands(messageHandler, commandParser, permissionManager);

    const notifier = new ProactiveNotifier({
      eventBus: null,
      client,
      rules: [],
    });
    notifier.start();

    // 监听 QQ 消息
    client.onMessage(async (msg) => {
      await handleIncomingMessage(msg, messageHandler, subAgent, commandParser, bridge, client, permissionManager);
    });

    // 监听桥接事件 → 转发到游戏
    bridge.onBridge((bridgeMsg) => {
      if (bridgeMsg.source === 'qq') {
        forwardToGame(bridgeMsg);
      }
    });

    // 启动 Sub-Agent 上下文
    await subAgent.start();

    state.client = client;
    state.permissionManager = permissionManager;
    state.bridge = bridge;
    state.subAgent = subAgent;
    state.messageHandler = messageHandler;
    state.commandParser = commandParser;
    state.notifier = notifier;

    await client.connect();
    console.info('[QQBotIntegration] QQ 机器人集成已启动');
  } catch (err) {
    state.running = false;
    console.error('[QQBotIntegration] 启动失败:', err instanceof Error ? err.message : String(err));
    throw err;
  }
}

async function stopIntegration(): Promise<void> {
  state.running = false;

  state.notifier?.stop();
  await state.subAgent?.stop();
  await state.client?.disconnect();
  state.permissionManager?.destroy();

  state.client = null;
  state.permissionManager = null;
  state.messageHandler = null;
  state.subAgent = null;
  state.commandParser = null;
  state.notifier = null;
  state.bridge = null;

  console.info('[QQBotIntegration] QQ 机器人集成已停止');
}

/**
 * 发送 QQ 消息（供触发器模块调用）
 */
export async function sendQQMessage(
  target: string,
  content: string,
  messageType: 'group' | 'private' = 'group',
): Promise<boolean> {
  if (!state.client) {
    console.warn('[QQBotIntegration] QQ 客户端未初始化，无法发送消息');
    return false;
  }

  try {
    const result =
      messageType === 'private'
        ? await state.client.sendPrivateMsg(target, content)
        : await state.client.sendGroupMsg(target, content);
    return result.success;
  } catch (err) {
    console.error('[QQBotIntegration] 发送消息失败:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

function configureBridges(bridges: BridgeConfig[]): void {
  state.bridge?.configure(bridges);
}

function configurePermission(config: Partial<{
  ownerId: string;
  admins: string[];
  whitelist: string[];
  defaultPermission: QQPermission;
  cooldownSeconds: number;
}>): void {
  state.permissionManager?.updateConfig(config);
  state.messageHandler?.setAllowPrivate((config.defaultPermission ?? QQPerm.BASIC) !== QQPerm.NONE);
}

async function handleIncomingMessage(
  msg: QQMessage,
  messageHandler: MessageHandler,
  subAgent: QQSubAgent,
  commandParser: RemoteCommandParser,
  bridge: MessageBridge,
  client: OneBotClient,
  permissionManager: PermissionManager,
): Promise<void> {
  // 1. 桥接处理
  bridge.handleQQMessage(msg);

  // 2. 消息路由
  const route = await messageHandler.route(msg);

  switch (route.type) {
    case 'ignored':
      return;

    case 'command': {
      const reply = await messageHandler.executeCommand(route.command, route.args, route.msg);
      if (reply) {
        await sendReply(client, msg, reply);
      }
      return;
    }

    case 'sub_agent': {
      // Sub-Agent 事件监听
      const unsubscribe = subAgent.onEvent(async (event) => {
        if (event.type === 'reply') {
          await sendReply(client, msg, event.reply.content);
          unsubscribe();
        }
      });

      await subAgent.handleMessage(route.msg);
      return;
    }

    default:
      return;
  }
}

function registerCommands(
  messageHandler: MessageHandler,
  commandParser: RemoteCommandParser,
  permissionManager: PermissionManager,
): void {
  messageHandler.registerCommand('status', async (command, args, msg) => {
    if (!permissionManager.checkPermission(msg.userId, msg.groupId ?? null, QQPerm.COMMAND)) {
      return '权限不足，无法执行此指令';
    }
    return commandParser.execute(command, args, msg);
  });

  messageHandler.registerCommand('task', async (command, args, msg) => {
    if (!permissionManager.checkPermission(msg.userId, msg.groupId ?? null, QQPerm.COMMAND)) {
      return '权限不足，无法执行此指令';
    }
    return commandParser.execute(command, args, msg);
  });

  messageHandler.registerCommand('help', async (command, args, msg) => commandParser.execute(command, args, msg));
}

async function sendReply(client: OneBotClient, msg: QQMessage, content: string): Promise<void> {
  if (msg.type === 'private') {
    await client.sendPrivateMsg(msg.userId, content);
  } else {
    await client.sendGroupMsg(msg.groupId ?? '', content);
  }
}

function forwardToGame(bridgeMsg: {
  source: 'qq' | 'game';
  content: string;
  sender: string;
  groupId?: string;
  timestamp: number;
}): void {
  const dispatcher = getToolDispatcher();
  if (!dispatcher) return;

  const workspaceManager = getWorkspaceManager();
  const onlineWorkspaces = workspaceManager.getOnlineWorkspaces();
  if (onlineWorkspaces.length === 0) return;

  // 发送到第一个在线工作区
  const workspace = onlineWorkspaces[0];
  if (!workspace.connectionId) return;

  dispatcher
    .callTool(workspace.id, 'send_chat', { message: `[QQ] ${bridgeMsg.sender}: ${bridgeMsg.content}` })
    .catch((err) => {
      console.error('[QQBotIntegration] 转发消息到游戏失败:', err instanceof Error ? err.message : String(err));
    });
}

function buildStatusReporter(): () => string {
  return () => {
    const wm = getWorkspaceManager();
    const uptime = Math.floor(process.uptime());
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;

    return [
      '📊 Agent Core 状态',
      `运行时间: ${hours}h ${minutes}m ${seconds}s`,
      `在线工作区: ${wm.onlineCount}`,
      `总工作区: ${wm.totalCount}`,
      `Node 版本: ${process.version}`,
      `平台: ${process.platform}`,
    ].join('\n');
  };
}

function createDefaultModelRouter(): IModelRouter {
  return new DefaultModelRouter(providerRegistry, LLM_CONFIG_DEFAULTS.defaultRouterConfig);
}
