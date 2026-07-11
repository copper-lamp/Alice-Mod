/**
 * McAgent Adapter BE - 插件入口
 *
 * 采用 LLSE-FakePlayer 模式：
 * - 无 module.exports 生命周期钩子，文件末尾直接执行
 * - 命令注册在 onServerStarted 事件中
 *
 * V2: TCP 客户端模块（连接/握手/心跳/重连）
 * V3: 工具注册模块 + 状态上报 + JSON 入口生成
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
const _NAME = 'McAgent Adapter BE';

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
  logger.setTitle('McAgent');
  logger.info(`=== ${_NAME} v${_VER.join('.')} 启动 ===`);

  // 注册插件
  ll.registerPlugin(_NAME, 'McAgent 基岩版接入核心', _VER);

  // 1. 加载或创建实例 ID
  const instanceId = InstanceFileHelper.loadOrCreateInstanceId();

  // 2. 初始化 TCP 客户端
  tcpClient = new TcpClient({
    host: '127.0.0.1',
    port: 27541,
    authToken: '',  // 从配置读取
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

  // 6. 初始化状态上报（暂不启动）
  statusReporter = new StatusReporter({
    sendNotification: (method, params) => tcpClient.sendNotification(method, params),
    isConnected: () => tcpClient.isConnected(),
    intervalMs: 2000,
  });

  // 7. 加载传统模块
  const BotManager = loadModule('./bot/BotManager.js', 'BotManager');
  if (!BotManager) return;

  const BotTestSuite = loadModule('./test/BotTestSuite.js', 'BotTestSuite');

  BotManager.init();
  _initialized = true;

  // 注册事件
  registerEvents(BotManager);
  registerCommands(BotManager, BotTestSuite);

  logger.info(`${_NAME} 启动完成，等待服务器就绪...`);
}

function loadModule(path: string, name: string): any {
  try {
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
  // 服务器启动完成 — 连接 TCP + 加载数据 + 自动上线
  mc.listen('onServerStarted', () => {
    logger.info('服务器已就绪，开始初始化...');

    // V2: 连接 TCP
    tcpClient.connect().catch((err) => {
      logger.error(`[McAgent] TCP 连接失败: ${err}`);
    });

    // V3: 扫描并注册工具
    toolRegistry.scanAndRegister().then((count) => {
      logger.info(`[McAgent] 已注册 ${count} 个工具`);
    });

    // V3: 生成 JSON 入口文件
    InstanceFileHelper.generate({
      instanceId: tcpClient.instanceId,
      isConnected: () => tcpClient.isConnected(),
      toolsCount: toolRegistry.count,
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

  // 假人死亡重生
  mc.listen('onPlayerDie', (player: any, source: any) => {
    if (_initialized) BotManager.onPlayerDie(player, source);
    return true;
  });

  // 服务器关闭 — 清理资源
  mc.listen('onServerStop', () => {
    logger.info('服务器关闭，清理资源...');
    if (_initialized) {
      statusReporter.stop();
      tcpClient.disconnect().catch(() => {});
      try { BotManager.offlineAll(); } catch (e) { logger.warn('假人清理失败', e); }
    }
    logger.info('资源清理完成');
    return true;
  });
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

// 工具调用处理
async function handleToolCall(request: JsonRpcRequest): Promise<void> {
  const { tool_name, parameters } = request.params || {};

  const ctx = new ToolContextImpl({
    sendEvent: (event) => tcpClient.sendNotification('event', event),
  });

  const result = await toolManager.executeTool(tool_name, parameters, ctx);

  tcpClient.sendRaw(JsonRpcCodec.encodeResponse(request.id, result));
}

// 状态变化处理
function handleStateChange(state: ConnectionState): void {
  // 更新 JSON 入口文件
  InstanceFileHelper.updateStatus({
    instanceId: tcpClient.instanceId,
    isConnected: () => tcpClient.isConnected(),
    toolsCount: toolRegistry.count,
  });

  // 连接成功时自动注册工具
  if (state === ConnectionState.CONNECTED) {
    const payload = toolRegistry.generateRegistrationPayload();
    tcpClient.sendNotification('register_tools', {
      tools: payload,
      instance_id: tcpClient.instanceId,
    });
    logger.info(`[McAgent] 已向 Agent Core 注册 ${payload.length} 个工具`);
  }

  if (state === ConnectionState.DISCONNECTED) {
    statusReporter.stop();
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
          '§6=== McAgent Adapter BE ===\n' +
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
// 启动
// ============================================================

initPlugin();