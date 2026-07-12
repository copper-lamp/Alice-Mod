/**
 * Alice Mod BE - 插件入口
 * 集成了 V2 TCP 客户端 + V3 工具注册/状态上报/JSON入口
 * 适配 Agent Core 实际实现的通信协议
 */

import { TcpClient, ConnectionState } from './tcp/TcpClient.js';
import type { JsonRpcMessage, JsonRpcRequest } from './tcp/json-rpc.js';
import { JsonRpcCodec, JSONRPC_ERROR_CODES } from './tcp/json-rpc.js';
import { ToolRegistry } from './registry/tool-registry.js';
import { ToolManager } from './registry/tool-manager.js';
import { ToolContextImpl } from './registry/tool-context.js';
import { StatusReporter } from './status/status-reporter.js';
import { InstanceFileHelper } from './entry/instance-file.js';
import { TOOLS_DIR } from './utils/constants.js';

const _VER: [number, number, number] = [1, 0, 0];
const _NAME = 'Alice Mod BE';

let _initialized = false;

// ── 全局变量 ──

let tcpClient: TcpClient;
let toolRegistry: ToolRegistry;
let toolManager: ToolManager;
let statusReporter: StatusReporter;

// ============================================================
// 初始化
// ============================================================

function initPlugin(): void {
  logger.setTitle('Alice Mod');
  logger.info(`=== ${_NAME} v${_VER.join('.')} 启动 ===`);

  // 注册插件
  ll.registerPlugin(_NAME, 'Alice Mod BE', _VER);

  // 1. 加载或创建实例 ID
  const instanceId = InstanceFileHelper.loadOrCreateInstanceId();

  // 2. 加载或创建认证令牌
  const authToken = InstanceFileHelper.loadOrCreateAuthToken();

  // 3. 初始化 TCP 客户端（适配 AC 的 handshake 协议）
  tcpClient = new TcpClient({
    host: '127.0.0.1',
    port: 27541,
    authToken,  // 加载自文件
    instanceId,
    gameVersion: '1.21.0',
  });

  // 3. 初始化工具注册器
  toolRegistry = new ToolRegistry({
    toolsDir: TOOLS_DIR,
  });
  toolManager = new ToolManager(toolRegistry);

  // 4. 注册 TCP 消息处理器
  tcpClient.onMessage((msg) => {
    handleMessage(msg);
  });

  // 5. TCP 连接状态变化处理
  tcpClient.onStateChange((state) => {
    handleStateChange(state);
  });

  // 6. 加载传统模块
  const BotManager = loadModule('./bot/BotManager.js', 'BotManager');
  if (!BotManager) return;

  const BotTestSuite = loadModule('./test/BotTestSuite.js', 'BotTestSuite');

  BotManager.init();
  _initialized = true;

  // 7. 初始化状态上报（暂不启动），注入 BotManager 在线假人列表
  statusReporter = new StatusReporter({
    sendNotification: (method, params) => tcpClient.sendNotification(method, params),
    isConnected: () => tcpClient.isConnected(),
    getBots: () => BotManager.getAll(),
    intervalMs: 2000,
  });

  // 注册事件
  registerEvents(BotManager);
  registerCommands(BotManager, BotTestSuite);

  logger.info(`${_NAME} 启动完成，等待服务器就绪...`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadModule(path: string, name: string): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(path);
    logger.debug(`模块已加载: ${name}`);
    return mod[name];
  } catch (e) {
    logger.error(`模块加载失败: ${name}`, e);
    return null;
  }
}

// ============================================================
// 事件监听
// ============================================================

function registerEvents(BotManager: any): void {
  // 假人状态变更事件监听（online / offline / death / created / removed）
  BotManager.onEvent((event: { type: string; botName: string; timestamp: number }) => {
    if (!tcpClient.isConnected()) return;

    const eventTypeMap: Record<string, string> = {
      online: 'bot_online',
      offline: 'bot_offline',
      death: 'death',
      created: 'bot_created',
      removed: 'bot_removed',
    };

    const eventType = eventTypeMap[event.type];
    if (!eventType) return;

    pushEvent(eventType, {
      player_name: event.botName,
      bot_name: event.botName,
      timestamp: new Date(event.timestamp).toISOString(),
    });
  });

  // 服务器启动完成 — 连接 TCP + 加载数据 + 自动上线
  mc.listen('onServerStarted', () => {
    logger.info('服务器已就绪，开始初始化...');

    // V2: 连接 TCP（使用 handshake 协议）
    tcpClient.connect().catch((err) => {
      logger.error(`[Alice Mod] TCP 连接失败: ${err}`);
    });

    // V3: 扫描并注册工具
    toolRegistry.scanAndRegister().then((count) => {
      logger.info(`[Alice Mod] 已注册 ${count} 个工具`);

      // V3: 工具注册完成后生成 JSON 入口文件（含工具分类信息）
      const authToken = InstanceFileHelper.loadOrCreateAuthToken();
      InstanceFileHelper.generate({
        instanceId: tcpClient.instanceId,
        instanceName: 'McAgent',
        authToken,
        isConnected: () => tcpClient.isConnected(),
        totalTools: toolRegistry.count,
        toolCategories: buildToolCategories(),
      });
    });

    // V3: 启动状态上报
    statusReporter.start();

    // 传统模块：加载假人数据 + 自动上线
    try { BotManager.loadAllData(); } catch (e) { logger.warn('加载假人数据失败', e); }
    try { BotManager.initialAutoOnline(); } catch (e) { logger.warn('自动上线失败', e); }

    logger.info(`${_NAME} 已就绪`);
  });

  // Tick — 驱动假人同步
  mc.listen('onTick', () => {
    if (_initialized) BotManager.onTick();
    return true;
  });

  // 假人死亡 — 推送事件通知
  mc.listen('onPlayerDie', (player: any, source: any) => {
    if (_initialized) BotManager.onPlayerDie(player, source);

    // 推送死亡事件到 Agent Core
    if (player && tcpClient.isConnected()) {
      const bot = BotManager.get(player.realName);
      if (bot) {
        pushEvent('death', {
          player_name: player.realName,
          source: source ? String(source) : 'unknown',
        });
      }
    }

    return true;
  });

  // 玩家聊天 — 推送事件通知
  mc.listen('onChat', (player: any, msg: string) => {
    if (_initialized && tcpClient.isConnected()) {
      pushEvent('player_chat', {
        player_name: player?.realName || 'unknown',
        message: msg,
      });
    }
    return true;
  });

  // 玩家加入
  safeListen('onJoin', (player: any) => {
    if (_initialized && tcpClient.isConnected()) {
      pushEvent('player_join', {
        player_name: player?.realName || 'unknown',
      });
    }
  });

  // 玩家离开
  safeListen('onLeft', (player: any) => {
    if (_initialized && tcpClient.isConnected()) {
      pushEvent('player_leave', {
        player_name: player?.realName || 'unknown',
      });
    }
  });

  // V14: 实体攻击事件 — 假人被攻击时推送
  safeListen('onMobHurt', (mob: any, source: any, damage: number) => {
    if (!_initialized || !tcpClient.isConnected()) return;
    if (!mob || !mob.isSimulatedPlayer || !mob.isSimulatedPlayer()) return;

    const bot = BotManager.get(mob.realName);
    if (!bot) return;

    pushEvent('entity_attack', {
      player_name: mob.realName,
      bot_name: mob.realName,
      attacker: source ? String(source) : 'unknown',
      damage: typeof damage === 'number' ? damage : 0,
    });
  });

  // V14: 低血量 / 低饥饿值周期性检测
  const thresholdState: Record<string, { healthLow: boolean; hungerLow: boolean }> = {};
  setInterval(() => {
    if (!_initialized || !tcpClient.isConnected()) return;

    for (const bot of BotManager.getAll()) {
      if (!bot.isOnline()) {
        delete thresholdState[bot.name];
        continue;
      }

      const pl = bot.getPlayer();
      if (!pl) continue;

      const health = pl.getHealth();
      const hunger = pl.getHunger();
      const maxHealth = pl.getMaxHealth();
      const healthThreshold = Math.max(3, Math.floor(maxHealth * 0.3));
      const hungerThreshold = 6;

      const state = thresholdState[bot.name] || { healthLow: false, hungerLow: false };
      const healthLow = health <= healthThreshold;
      const hungerLow = hunger <= hungerThreshold;

      if (healthLow && !state.healthLow) {
        pushEvent('health_low', {
          player_name: bot.name,
          bot_name: bot.name,
          health,
          max_health: maxHealth,
          threshold: healthThreshold,
        });
      }

      if (hungerLow && !state.hungerLow) {
        pushEvent('hunger_low', {
          player_name: bot.name,
          bot_name: bot.name,
          hunger,
          threshold: hungerThreshold,
        });
      }

      thresholdState[bot.name] = { healthLow, hungerLow };
    }
  }, 2000);

  // 注意：onServerStop 事件在部分 LSE 版本中不可用，跳过清理注册
  // （BDS 关闭时会自动释放资源）
}

/**
 * 安全注册 LLSE 事件监听，事件不存在时仅记录警告，不抛错
 * LLSE 各版本支持的事件列表不同（如 onJoin 可能不存在于某些旧版本），
 * 使用 safeListen 避免插件因此崩溃
 */
function safeListen(event: string, callback: (...args: any[]) => void): void {
  try {
    mc.listen(event, callback);
  } catch (e) {
    logger.warn(`[Alice Mod] 事件 "${event}" 不可用，已跳过`);
  }
}

// ============================================================
// TCP 消息处理
// ============================================================

function handleMessage(msg: JsonRpcMessage): void {
  if (JsonRpcCodec.isRequest(msg)) {
    const request = msg as JsonRpcRequest;

    switch (request.method) {
      case 'tool_call':
        handleToolCall(request);
        break;
      case 'tool_call_batch':
        handleToolCallBatch(request);
        break;
      default:
        tcpClient.sendRaw(
          JsonRpcCodec.encodeError(
            request.id,
            JSONRPC_ERROR_CODES.METHOD_NOT_FOUND,
            `方法未找到: ${request.method}`,
          ),
        );
    }
  }
}

// 单个工具调用处理
async function handleToolCall(request: JsonRpcRequest): Promise<void> {
  const { tool_name, parameters, bot_id } = request.params || {};

  const ctx = new ToolContextImpl({
    activeBotName: bot_id,
    sendEvent: (event) => tcpClient.sendNotification('event', {
      event_type: event.type,
      severity: getEventSeverity(event.type),
      timestamp: event.timestamp || new Date().toISOString(),
      data: event.data,
    }),
  });

  const result = await toolManager.executeTool(tool_name, parameters, ctx);

  tcpClient.sendRaw(JsonRpcCodec.encodeResponse(request.id, result));
}

// 批量工具调用处理
async function handleToolCallBatch(request: JsonRpcRequest): Promise<void> {
  const calls = request.params?.calls || request.params?.tools || [];
  const results: any[] = [];

  for (const call of calls) {
    const { tool_name, parameters, bot_id } = call;

    const ctx = new ToolContextImpl({
      activeBotName: bot_id,
      sendEvent: (event) => tcpClient.sendNotification('event', {
        event_type: event.type,
        severity: getEventSeverity(event.type),
        timestamp: event.timestamp || new Date().toISOString(),
        data: event.data,
      }),
    });

    const result = await toolManager.executeTool(tool_name, parameters, ctx);
    results.push(result);
  }

  tcpClient.sendRaw(JsonRpcCodec.encodeResponse(request.id, {
    success: true,
    data: results,
    duration_ms: results.reduce((sum: number, r: any) => sum + (r.duration_ms || 0), 0),
  }));
}

// 状态变化处理
function handleStateChange(state: ConnectionState): void {
  // 更新 JSON 入口文件
  const authToken = InstanceFileHelper.loadOrCreateAuthToken();
  InstanceFileHelper.updateStatus({
    instanceId: tcpClient.instanceId,
    instanceName: 'McAgent',
    authToken,
    isConnected: () => tcpClient.isConnected(),
    totalTools: toolRegistry.count,
    toolCategories: buildToolCategories(),
  });

  // 连接成功时自动注册工具
  if (state === ConnectionState.CONNECTED) {
    const payload = toolRegistry.generateRegistrationPayload();
    // 使用 notification 发送 register_tools（AC 端以 notification 方式处理）
    tcpClient.sendNotification('register_tools', {
      tools: payload,
      instance_id: tcpClient.instanceId,
    });
    logger.info(`[Alice Mod] 已向 Agent Core 注册 ${payload.length} 个工具`);

    // 连接成功时也恢复状态上报
    if (statusReporter && !statusReporter.isRunning()) {
      statusReporter.start();
    }
  }

  if (state === ConnectionState.DISCONNECTED) {
    if (statusReporter) {
      statusReporter.stop();
    }
  }
}

// ============================================================
// 事件通知推送
// ============================================================

/**
 * 推送事件通知到 Agent Core
 * 遵循协议规范的事件格式
 */
function pushEvent(eventType: string, data: Record<string, any>): void {
  if (!tcpClient.isConnected()) return;

  tcpClient.sendNotification('event', {
    event_type: eventType,
    severity: getEventSeverity(eventType),
    timestamp: new Date().toISOString(),
    data,
  });
}

/**
 * 获取事件严重级别
 */
function getEventSeverity(eventType: string): string {
  switch (eventType) {
    case 'entity_attack':
    case 'health_low':
    case 'hunger_low':
    case 'death':
    case 'tool_broken':
      return 'warning';
    case 'inventory_full':
    case 'player_chat':
    case 'player_join':
    case 'player_leave':
    case 'environment_change':
    case 'task_completed':
    case 'bot_online':
    case 'bot_offline':
    case 'bot_created':
    case 'bot_removed':
      return 'info';
    default:
      return 'info';
  }
}

// ============================================================
// 命令注册
// ============================================================

function registerCommands(BotManager: any, BotTestSuite: any): void {
  try {
    const cmd = mc.newCommand('mcagent', 'McAgent 插件控制', 0, 0x80);

    // /mcagent test
    cmd.setEnum('TestAction', ['test']);
    cmd.mandatory('action', 5, 'TestAction', 'TestAction', 1);
    cmd.overload(['TestAction']);

    // /mcagent info / status
    cmd.setEnum('InfoAction', ['info', 'status']);
    cmd.mandatory('action', 5, 'InfoAction', 'InfoAction', 1);
    cmd.overload(['InfoAction']);

    // /mcagent (无参数)
    cmd.overload([]);

    cmd.setCallback((_cmd: any, _ori: any, out: any, res: any) => {
      try {
        const action = res.action ? String(res.action).toLowerCase() : 'info';

        if (action === 'test') {
          if (_ori.player && BotTestSuite) {
            BotTestSuite.showMainMenu(_ori.player);
          } else if (!_ori.player) {
            out.error('GUI 模式仅限玩家使用');
          } else {
            out.error('测试模块未加载');
          }
          return;
        }

        const info = _initialized
          ? `§e假人数量: ${BotManager.getAll().length}\n` +
            `§e在线假人: ${BotManager.getAll().filter((b: any) => b.isOnline()).length}\n` +
            `§eTCP 状态: ${tcpClient.getState()}\n` +
            `§e已注册工具: ${toolRegistry.count}`
          : '§c插件尚未就绪';

        out.success(
          '§6=== Alice Mod ===\n' +
          `§e版本: ${_VER.join('.')}\n` +
          `§e状态: ${_initialized ? '§a已就绪' : '§c未就绪'}\n` +
          info + '\n' +
          '\n§a可用命令:\n' +
          '  /mcagent       §7- 查看插件信息\n' +
          '  /mcagent test  §7- 打开测试菜单\n' +
          '  /mcagent info  §7- 查看插件信息'
        );
      } catch (e) {
        out.error('指令执行出错');
        logger.error('指令回调异常', e);
      }
    });

    if (cmd.setup()) {
      logger.info('命令已注册: /mcagent');
    } else {
      logger.warn('命令注册失败: /mcagent');
    }
  } catch (e) {
    logger.error('命令注册异常', e);
  }
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 从注册器中构建工具分类计数列表
 * 符合 protocol spec 中 toolset_info.tool_categories 格式
 */
function buildToolCategories(): Array<{ category: string; count: number }> {
  const categories = toolRegistry.getAll().reduce<Record<string, number>>((acc, tool) => {
    const cat = tool.metadata.category;
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {});

  return Object.entries(categories).map(([category, count]) => ({
    category,
    count,
  }));
}

// ============================================================
// 启动
// ============================================================

initPlugin();
