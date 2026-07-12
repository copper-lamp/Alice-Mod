/**
 * V6-T 游戏内 GUI 工具测试器
 *
 * 通过 /mcagent test 打开 GUI 菜单，直接调用已注册工具进行可用性验证。
 */

import type { ToolManager } from '../registry/tool-manager.js';
import { ToolContextImpl } from '../registry/tool-context.js';
import type { ToolResult } from '../registry/tool-module.types.js';
import { BotManager } from '../bot/BotManager.js';
import { ToolMenuGui } from './ToolMenuGui.js';
import { ToolParamFormBuilder } from './ToolParamFormBuilder.js';
import { ToolResultRenderer } from './ToolResultRenderer.js';
import { ToolTestReport } from './ToolTestReport.js';
import type {
  GuiTestConfig,
  MainMenuAction,
  PlayerSession,
  SmokeTestCase,
} from './types.js';

const SUPPORTED_CATEGORIES = new Set(['movement', 'inventory', 'survival', 'block']);

/** 默认冒烟测试用例 */
const DEFAULT_SMOKE_CASES: Record<string, SmokeTestCase> = {
  move_to: { tool: 'move_to', params: { target_type: 'coordinate', target: { x: '{bot.x}', y: '{bot.y}', z: '{bot.z}' } } },
  ride: { tool: 'ride', params: { target_type: 'nearby_rideable' } },
  dismount: { tool: 'dismount', params: {} },
  drop_item: { tool: 'drop_item', params: { slot: 0, count: 1 } },
  take_from_container: { tool: 'take_from_container', params: { direction: 'front', take_all: true } },
  put_to_container: { tool: 'put_to_container', params: { direction: 'front', slot: 0, count: 1 } },
  equip_item: { tool: 'equip_item', params: { slot: 0, destination: 'head' } },
  eat: { tool: 'eat', params: { food_name: '' } },
  sleep: { tool: 'sleep', params: { force_wake: false } },
  use_item: { tool: 'use_item', params: { slot: 0 } },
  mine_block: { tool: 'mine_block', params: { x: '{view.x}', y: '{view.y}', z: '{view.z}' } },
  place_block: { tool: 'place_block', params: { block_name: 'dirt', x: '{feet.x}', y: '{feet.y}', z: '{feet.z}' } },
  use_block: { tool: 'use_block', params: { x: '{view.x}', y: '{view.y}', z: '{view.z}' } },
  area_operation: { tool: 'area_operation', params: { action: 'clear', from: '{feet.x},{feet.y},{feet.z}', to: '{feet.x+2},{feet.y+2},{feet.z+2}' } },
};

export class InGameToolTester {
  private sessions = new Map<string, PlayerSession>();
  private report: ToolTestReport;

  constructor(
    private toolManager: ToolManager,
    private config: GuiTestConfig,
  ) {
    this.report = new ToolTestReport(config.max_report_entries);
  }

  /**
   * 命令入口
   */
  onCommand(player: Player): void {
    logger.info(`[InGameToolTester] onCommand 被调用, player=${player?.realName}, xuid=${player?.xuid}`);

    if (!this.checkPermission(player)) {
      logger.info('[InGameToolTester] 权限检查失败');
      player.sendText('§c需要 OP 权限或白名单才能使用测试工具');
      return;
    }

    const onlineBots = this.getOnlineBots();
    logger.info(`[InGameToolTester] 在线假人: ${onlineBots.join(',')}`);
    if (onlineBots.length === 0) {
      player.sendText('§c没有在线假人，请先创建并上线假人');
      return;
    }

    this.ensureSession(player, onlineBots);
    logger.info('[InGameToolTester] 准备显示主菜单');
    this.showMainMenu(player);
  }

  /**
   * 显示主菜单
   */
  private showMainMenu(player: Player): void {
    const session = this.getSession(player);
    const onlineBots = this.getOnlineBots();

    ToolMenuGui.showMainMenu(
      player,
      session.activeBot,
      onlineBots.length > 1,
      (action) => this.handleMenuAction(player, action),
    );
  }

  /**
   * 处理主菜单动作
   */
  private handleMenuAction(player: Player, action: MainMenuAction): void {
    switch (action.type) {
      case 'category':
        if (action.category && SUPPORTED_CATEGORIES.has(action.category)) {
          this.showCategoryMenu(player, action.category);
        }
        break;
      case 'smoke':
        this.runSmokeTest(player);
        break;
      case 'report':
        this.showReport(player);
        break;
      case 'selectBot':
        this.showBotSelector(player);
        break;
      case 'legacy':
        player.sendText('§e请输入 §a/mcagent legacytest §e打开旧版测试套件');
        break;
      case 'close':
      default:
        break;
    }
  }

  /**
   * 显示分类工具菜单
   */
  private showCategoryMenu(player: Player, category: string): void {
    const tools = this.toolManager
      .getRegistry()
      .getAll()
      .filter((t) => t.metadata.category === category)
      .map((t) => ({ name: t.name, description: t.metadata.description }));

    if (tools.length === 0) {
      ToolResultRenderer.renderError(player, `分类 ${category} 下没有已注册工具`, (pl) => this.showMainMenu(pl));
      return;
    }

    ToolMenuGui.showCategoryMenu(
      player,
      category,
      tools,
      (toolName) => this.showToolForm(player, toolName),
      () => this.showMainMenu(player),
    );
  }

  /**
   * 显示工具参数表单
   */
  private showToolForm(player: Player, toolName: string): void {
    const tool = this.toolManager.getRegistry().get(toolName);
    if (!tool) {
      ToolResultRenderer.renderError(player, `工具 ${toolName} 未找到`, (pl) => this.showMainMenu(pl));
      return;
    }

    const built = ToolParamFormBuilder.build(player, tool.metadata);

    player.sendForm(built.form, (_pl, data: any[]) => {
      if (!data || !Array.isArray(data)) {
        this.showCategoryMenu(_pl, tool.metadata.category);
        return;
      }

      const params = built.parse(data);
      this.executeTool(_pl, toolName, params);
    });
  }

  /**
   * 执行单个工具
   */
  private executeTool(player: Player, toolName: string, params: Record<string, unknown>): void {
    const session = this.getSession(player);
    if (session.pendingExecution) {
      player.sendText('§c已有工具正在执行，请等待完成');
      return;
    }

    const bot = BotManager.get(session.activeBot);
    if (!bot || !bot.isOnline()) {
      ToolResultRenderer.renderError(player, `目标假人 ${session.activeBot} 不在线`, (pl) => this.showMainMenu(pl));
      return;
    }

    player.sendText(`§e[测试] 正在执行 ${toolName} ...`);

    session.pendingExecution = this.doExecute(player, toolName, params);
    session.pendingExecution.catch((err) => {
      logger.error('[InGameToolTester] 工具执行异常', err);
    }).finally(() => {
      session.pendingExecution = null;
    });
  }

  private async doExecute(
    player: Player,
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    const session = this.getSession(player);
    const ctx = new ToolContextImpl({ activeBotName: session.activeBot });

    try {
      const result = await this.toolManager.executeTool(toolName, params, ctx);
      ToolResultRenderer.render(player, toolName, result, (pl) => this.showMainMenu(pl));
      this.report.append({
        id: `${Date.now()}_${toolName}_${player.realName}`,
        timestamp: Date.now(),
        player: player.realName,
        tool: toolName,
        params,
        success: result.success,
        durationMs: result.duration_ms,
        error: result.error,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ToolResultRenderer.renderError(player, message, (pl) => this.showMainMenu(pl));
    }
  }

  /**
   * 一键冒烟测试
   */
  private runSmokeTest(player: Player): void {
    const session = this.getSession(player);
    if (session.pendingExecution) {
      player.sendText('§c已有工具正在执行，请等待完成');
      return;
    }

    const bot = BotManager.get(session.activeBot);
    if (!bot || !bot.isOnline()) {
      ToolResultRenderer.renderError(player, `目标假人 ${session.activeBot} 不在线`, (pl) => this.showMainMenu(pl));
      return;
    }

    session.pendingExecution = this.doSmokeTest(player);
    session.pendingExecution.catch((err) => {
      logger.error('[InGameToolTester] 冒烟测试异常', err);
    }).finally(() => {
      session.pendingExecution = null;
    });
  }

  private async doSmokeTest(player: Player): Promise<void> {
    const cases = this.buildSmokeCases(player);
    const results: { tool: string; result: ToolResult }[] = [];

    for (let i = 0; i < cases.length; i++) {
      const { tool, params } = cases[i];
      ToolResultRenderer.sendProgress(player, i + 1, cases.length, tool);

      try {
        const ctx = new ToolContextImpl({ activeBotName: this.getSession(player).activeBot });
        const result = await this.toolManager.executeTool(tool, params, ctx);
        results.push({ tool, result });
        this.report.append({
          id: `${Date.now()}_${tool}_${player.realName}`,
          timestamp: Date.now(),
          player: player.realName,
          tool,
          params,
          success: result.success,
          durationMs: result.duration_ms,
          error: result.error,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          tool,
          result: { success: false, error: message, duration_ms: 0 },
        });
      }
    }

    ToolResultRenderer.renderSmokeSummary(player, results, (pl) => this.showMainMenu(pl));
  }

  /**
   * 构建冒烟测试用例
   */
  private buildSmokeCases(player: Player): SmokeTestCase[] {
    const cases: SmokeTestCase[] = [];
    const registry = this.toolManager.getRegistry();

    for (const [name, defaultCase] of Object.entries(DEFAULT_SMOKE_CASES)) {
      // 跳过未注册的工具
      if (!registry.get(name)) continue;

      // 允许配置覆盖
      const configured = this.config.smoke_cases[name];
      const base = configured || defaultCase;
      const resolved = this.resolveParams(base.params, player);
      cases.push({ tool: base.tool, params: resolved });
    }

    return cases;
  }

  /**
   * 解析参数中的占位符
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private resolveParams(value: any, player: Player): any {
    if (typeof value === 'string') {
      return this.resolvePlaceholder(value, player);
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.resolveParams(v, player));
    }
    if (value && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = this.resolveParams(v, player);
      }
      return result;
    }
    return value;
  }

  private resolvePlaceholder(value: string, player: Player): string | number | boolean | Record<string, number> {
    // 逗号分隔坐标字符串："{feet.x},{feet.y},{feet.z}"
    if (value.includes(',')) {
      const parts = value.split(',').map((p) => this.resolvePlaceholder(p.trim(), player));
      // 如果三部分都是数字，尝试组合为对象
      if (
        parts.length === 3 &&
        typeof parts[0] === 'number' &&
        typeof parts[1] === 'number' &&
        typeof parts[2] === 'number'
      ) {
        return { x: parts[0], y: parts[1], z: parts[2] };
      }
      return value.split(',').map((p) => this.resolvePlaceholder(p.trim(), player)).join(',');
    }

    const match = value.match(/^\{([a-zA-Z_]+)\.([a-zA-Z_]+)([+-]\d+)?\}$/);
    if (!match) return value;

    const [, source, axis, offsetStr] = match;
    let base = 0;

    if (source === 'player') {
      if (axis === 'x') base = Math.floor(player.pos.x);
      else if (axis === 'y') base = Math.floor(player.pos.y);
      else if (axis === 'z') base = Math.floor(player.pos.z);
      else if (axis === 'dimid') base = player.pos.dimid;
    } else if (source === 'bot') {
      const bot = BotManager.get(this.getSession(player).activeBot);
      const pl = bot?.getPlayer();
      if (pl) {
        if (axis === 'x') base = Math.floor(pl.pos.x);
        else if (axis === 'y') base = Math.floor(pl.pos.y);
        else if (axis === 'z') base = Math.floor(pl.pos.z);
        else if (axis === 'dimid') base = pl.pos.dimid;
      }
    } else if (source === 'feet') {
      if (axis === 'x') base = Math.floor(player.pos.x);
      else if (axis === 'y') base = Math.floor(player.pos.y) - 1;
      else if (axis === 'z') base = Math.floor(player.pos.z);
    } else if (source === 'view') {
      const block = player.getBlockFromViewVector();
      const pos = block ? block.pos : null;
      if (pos) {
        if (axis === 'x') base = pos.x;
        else if (axis === 'y') base = pos.y;
        else if (axis === 'z') base = pos.z;
      } else {
        if (axis === 'x') base = Math.floor(player.pos.x);
        else if (axis === 'y') base = Math.floor(player.pos.y);
        else if (axis === 'z') base = Math.floor(player.pos.z);
      }
    }

    const offset = offsetStr ? Number(offsetStr) : 0;
    return base + offset;
  }

  /**
   * 显示测试报告
   */
  private showReport(player: Player): void {
    ToolResultRenderer.renderReport(
      player,
      this.report.stats(),
      this.report.recent(20),
      (pl) => this.showMainMenu(pl),
    );
  }

  /**
   * 显示假人选择器
   */
  private showBotSelector(player: Player): void {
    const bots = this.getOnlineBots();
    ToolMenuGui.showBotSelector(
      player,
      bots,
      (name) => {
        this.getSession(player).activeBot = name;
        this.showMainMenu(player);
      },
      () => this.showMainMenu(player),
    );
  }

  /**
   * 权限检查
   */
  private checkPermission(player: Player): boolean {
    if (!this.config.enabled) return false;
    if (this.config.require_op && !player.isOP()) return false;
    if (this.config.allowed_players.length > 0 && !this.config.allowed_players.includes(player.xuid)) {
      return false;
    }
    return true;
  }

  /**
   * 获取在线假人名称列表
   */
  private getOnlineBots(): string[] {
    return BotManager.getAll()
      .filter((b) => b.isOnline())
      .map((b) => b.name)
      .sort();
  }

  /**
   * 确保玩家会话存在
   */
  private ensureSession(player: Player, onlineBots: string[]): void {
    if (this.sessions.has(player.xuid)) return;

    let activeBot = this.config.default_target_bot;
    if (!activeBot || !onlineBots.includes(activeBot)) {
      activeBot = onlineBots[0] || '';
    }

    this.sessions.set(player.xuid, {
      activeBot,
      pendingExecution: null,
    });
  }

  private getSession(player: Player): PlayerSession {
    const session = this.sessions.get(player.xuid);
    if (!session) {
      const onlineBots = this.getOnlineBots();
      this.ensureSession(player, onlineBots);
      return this.sessions.get(player.xuid)!;
    }
    return session;
  }
}
