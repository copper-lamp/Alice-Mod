/**
 * McAgent Adapter BE - 插件入口
 *
 * 参考 LLSE-FakePlayer 实现模式：
 * - 无 module.exports 生命周期钩子
 * - main() 在文件末尾直接调用
 * - 命令注册在 onServerStarted 事件中
 * - 全链路日志跟踪
 */

// ── 启动日志 ──
// 注意：此处的 logger 可能尚未初始化，用 console 作为后备

const _VER: [number, number, number] = [1, 0, 0];
const _NAME = 'McAgent Adapter BE';

let _initialized = false;
let _logReady = false;

function log(...args: any[]): void {
  try {
    if (_logReady) logger.info('[McAgent]', ...args);
    else console.log('[McAgent]', ...args);
  } catch (_e) {
    console.log('[McAgent]', ...args);
  }
}

function logWarn(...args: any[]): void {
  try {
    if (_logReady) logger.warn('[McAgent]', ...args);
    else console.warn('[McAgent]', ...args);
  } catch (_e) {
    console.warn('[McAgent]', ...args);
  }
}

function logError(...args: any[]): void {
  try {
    if (_logReady) logger.error('[McAgent]', ...args);
    else console.error('[McAgent]', ...args);
  } catch (_e) {
    console.error('[McAgent]', ...args);
  }
}

// ── 模块加载（懒加载，用 require 而非 import） ──

let BotManager: any = null;
let BotTestSuite: any = null;

function loadModules(): boolean {
  try {
    log('加载模块: BotManager...');
    BotManager = require('./bot/BotManager.js').BotManager;
    log('加载模块: BotManager OK');
  } catch (e) {
    logError('加载 BotManager 失败:', e);
    return false;
  }

  try {
    log('加载模块: BotTestSuite...');
    BotTestSuite = require('./test/BotTestSuite.js').BotTestSuite;
    log('加载模块: BotTestSuite OK');
  } catch (e) {
    logWarn('加载 BotTestSuite 失败（非致命）:', e);
  }

  return true;
}

// ── 初始化 ──

function initPlugin(): void {
  log('=== McAgent Adapter BE 启动 ===');
  log('版本:', _VER.join('.'));

  // 注册插件信息
  try {
    ll.registerPlugin(_NAME, 'McAgent 基岩版接入核心', _VER);
    log('ll.registerPlugin 完成');
  } catch (e) {
    logError('ll.registerPlugin 失败:', e);
  }

  // 设置日志标题
  try {
    logger.setTitle('McAgent');
    _logReady = true;
    log('logger 已就绪');
  } catch (e) {
    console.error('[McAgent] logger.setTitle 失败:', e);
  }

  // 加载核心模块
  if (!loadModules()) {
    logError('核心模块加载失败，插件无法运行');
    return;
  }

  // 初始化 BotManager
  try {
    BotManager.init();
    log('BotManager.init() 完成');
  } catch (e) {
    logError('BotManager.init() 失败:', e);
    return;
  }

  _initialized = true;
  log('初始化阶段完成，开始注册事件监听...');

  // ============================================================
  // 事件监听
  // ============================================================

  // 1. onServerStarted — 命令注册 + 数据加载 (重要!)
  try {
    mc.listen('onServerStarted', () => {
      log('>>>> onServerStarted 事件触发 <<<<');

      // 注册命令
      registerCommands();

      // 加载假人数据
      try {
        BotManager.loadAllData();
        log('BotManager.loadAllData() 完成');
      } catch (e) {
        logWarn('loadAllData() 失败:', e);
      }

      // 自动上线
      try {
        const res = BotManager.initialAutoOnline();
        log('initialAutoOnline() 完成, 结果:', JSON.stringify(res));
      } catch (e) {
        logWarn('initialAutoOnline() 失败:', e);
      }

      log('全部初始化完成，插件已就绪');
    });
    log('已注册 onServerStarted 事件');
  } catch (e) {
    logError('注册 onServerStarted 失败:', e);
  }

  // 2. onTick — 驱动假人同步
  try {
    mc.listen('onTick', () => {
      if (_initialized) BotManager.onTick();
      return true;
    });
    log('已注册 onTick 事件');
  } catch (e) {
    logError('注册 onTick 失败:', e);
  }

  // 3. onPlayerDie — 假人死亡重生
  try {
    mc.listen('onPlayerDie', (player: any, source: any) => {
      if (_initialized) BotManager.onPlayerDie(player, source);
      return true;
    });
    log('已注册 onPlayerDie 事件');
  } catch (e) {
    logError('注册 onPlayerDie 失败:', e);
  }

  // 4. onJoin — 玩家加入日志
  try {
    mc.listen('onJoin', (pl: any) => {
      if (pl && !pl.isSimulatedPlayer()) {
        log('玩家加入:', pl.realName);
      }
      return true;
    });
    log('已注册 onJoin 事件');
  } catch (e) {
    logError('注册 onJoin 失败:', e);
  }

  // 5. onLeft — 玩家离开日志
  try {
    mc.listen('onLeft', (pl: any) => {
      if (pl && !pl.isSimulatedPlayer()) {
        log('玩家离开:', pl.realName);
      }
      return true;
    });
    log('已注册 onLeft 事件');
  } catch (e) {
    logError('注册 onLeft 失败:', e);
  }

  // 6. onServerStop — 清理
  try {
    mc.listen('onServerStop', () => {
      log('>>>> onServerStop 事件触发 <<<<');
      if (_initialized) {
        try { BotManager.offlineAll(); } catch (e) { logWarn('offlineAll() 失败:', e); }
      }
      log('清理完成');
      return true;
    });
    log('已注册 onServerStop 事件');
  } catch (e) {
    logError('注册 onServerStop 失败:', e);
  }

  log('所有事件注册完成');
}

// ============================================================
// 命令注册
// ============================================================

function registerCommands(): void {
  log('>>>> 开始注册命令 /mcagent <<<<');

  try {
    const cmd = mc.newCommand('mcagent', 'McAgent 插件控制', 0, 0x80);
    log('mc.newCommand() 成功');

    // /mcagent test — GUI 测试菜单
    cmd.setEnum('TestAction', ['test']);
    cmd.mandatory('action', 5, 'TestAction', 'TestAction', 1);
    cmd.overload(['TestAction']);
    log('已配置: /mcagent test');

    // /mcagent info — 查看信息
    cmd.setEnum('InfoAction', ['info', 'status']);
    cmd.mandatory('action', 5, 'InfoAction', 'InfoAction', 1);
    cmd.overload(['InfoAction']);
    log('已配置: /mcagent info');

    // 无参调用
    cmd.overload([]);
    log('已配置: /mcagent (无参数)');

    // 回调
    cmd.setCallback((_cmd: any, _ori: any, out: any, res: any) => {
      try {
        const action = res.action ? String(res.action).toLowerCase() : 'info';
        log('命令被调用, action=' + action);

        if (action === 'test') {
          if (_ori.player) {
            log('打开测试菜单...');
            if (BotTestSuite) {
              BotTestSuite.showMainMenu(_ori.player);
            } else {
              out.error('测试模块未加载');
              logWarn('BotTestSuite 未加载，无法打开 GUI');
            }
          } else {
            out.error('GUI 模式仅限玩家使用');
          }
          return;
        }

        // info / status / 默认
        let msg = '§6=== McAgent Adapter BE ===\n';
        msg += '§e版本: ' + _VER.join('.') + '\n';
        msg += '§e状态: ' + (_initialized ? '§a已就绪' : '§c未就绪') + '\n';
        if (_initialized) {
          msg += '§e假人数量: ' + BotManager.getAll().length + '\n';
          msg += '§e在线假人: ' + BotManager.getAll().filter((b: any) => b.isOnline()).length + '\n';
        }
        msg += '\n§a可用命令:\n';
        msg += '  /mcagent       §7- 查看插件信息\n';
        msg += '  /mcagent test  §7- 打开测试菜单\n';
        msg += '  /mcagent info  §7- 查看插件信息';
        out.success(msg);
      } catch (cmdErr) {
        out.error('指令执行出错，请查看控制台日志');
        logError('指令回调异常:', cmdErr);
      }
    });
    log('已设置命令回调');

    const ok = cmd.setup();
    if (ok) {
      log('★★★★ /mcagent 命令注册成功 ★★★★');
    } else {
      logError('★★★★ /mcagent 命令注册失败 (setup 返回 false) ★★★★');
    }
  } catch (e) {
    logError('命令注册过程抛出异常:', e);
  }
}

// ============================================================
// 启动
// ============================================================

try {
  initPlugin();
} catch (e) {
  console.error('[McAgent] initPlugin() 顶层异常:', e);
}