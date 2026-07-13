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
import { DefaultParamProvider } from './DefaultParamProvider.js';
import { TestEnvironmentPreparer } from './TestEnvironmentPreparer.js';
import type {
  GuiTestConfig,
  MainMenuAction,
  PlayerSession,
  SmokeTestCase,
  ToolSelectAction,
} from './types.js';

const SUPPORTED_CATEGORIES = new Set(['movement', 'inventory', 'survival', 'block']);

/** 默认冒烟测试工具列表（参数由 DefaultParamProvider 基于假人环境生成） */
const DEFAULT_SMOKE_TOOLS = [
  'move_to',
  'ride',
  'dismount',
  'drop_item',
  'take_from_container',
  'put_to_container',
  'equip_item',
  'eat',
  'sleep',
  'use_item',
  'mine_block',
  'place_block',
  'use_block',
  'area_operation',
];

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
      (action) => this.handleToolSelectAction(player, action),
      () => this.showMainMenu(player),
    );
  }

  /**
   * 处理工具选择动作
   */
  private async handleToolSelectAction(player: Player, action: ToolSelectAction): Promise<void> {
    if (action.type === 'quick') {
      await this.quickTest(player, action.toolName);
    } else {
      this.showToolForm(player, action.toolName);
    }
  }

  /**
   * 快速测试：使用推荐默认值直接执行
   */
  private async quickTest(player: Player, toolName: string): Promise<void> {
    const tool = this.toolManager.getRegistry().get(toolName);
    if (!tool) {
      ToolResultRenderer.renderError(player, `工具 ${toolName} 未找到`, (pl) => this.showMainMenu(pl));
      return;
    }

    const session = this.getSession(player);
    const botPlayer = BotManager.get(session.activeBot)?.getPlayer();
    if (!botPlayer) {
      ToolResultRenderer.renderError(player, `假人 ${session.activeBot} 不在线`, (pl) => this.showMainMenu(pl));
      return;
    }

    // 单项测试不准备环境，完全依赖当前世界状态
    let params: Record<string, unknown>;
    if (toolName === 'move_to') {
      // 快速测试 move_to：寻路到发起测试的玩家所在位置，禁用传送兜底
      const feet = this.getPlayerFeet(player);
      params = {
        target_type: 'coordinate',
        target: feet,
        options: { timeout: 30000, allowSprint: true, allowSwim: true, allowGlide: true, allowTeleportFallback: false },
      };
    } else {
      params = DefaultParamProvider.generate(botPlayer, tool.metadata);
    }
    logger.info(`[InGameToolTester] 快速测试 ${toolName}, params=${JSON.stringify(params)}`);
    this.executeTool(player, toolName, params);
  }

  /**
   * 聊天命令：快速测试指定工具
   */
  quickTestCommand(player: Player, toolName: string): void {
    if (!this.checkPermission(player)) {
      player.sendText('§c需要 OP 权限或白名单才能使用测试工具');
      return;
    }

    const onlineBots = this.getOnlineBots();
    if (onlineBots.length === 0) {
      player.sendText('§c没有在线假人');
      return;
    }

    this.ensureSession(player, onlineBots);
    this.quickTest(player, toolName);
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
    logger.info(`[InGameToolTester] doExecute: tool=${toolName}, bot=${session.activeBot}, params=${JSON.stringify(params)}`);

    try {
      const result = await this.toolManager.executeTool(toolName, params, ctx);
      logger.info(`[InGameToolTester] doExecute 完成: tool=${toolName}, success=${result.success}, error=${result.error || 'none'}`);
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
      const stack = err instanceof Error ? err.stack : '';
      logger.error(`[InGameToolTester] doExecute 异常: tool=${toolName}, error=${message}\n${stack || ''}`);
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
    const session = this.getSession(player);
    const botPlayer = BotManager.get(session.activeBot)?.getPlayer();
    if (!botPlayer) {
      ToolResultRenderer.renderError(player, `目标假人 ${session.activeBot} 不在线`, (pl) => this.showMainMenu(pl));
      return;
    }

    player.sendText('§e[测试] 正在准备测试环境...');
    await TestEnvironmentPreparer.prepare(session.activeBot, botPlayer);

    const cases = this.buildSmokeCases(player);
    const results: { tool: string; result: ToolResult }[] = [];

    for (let i = 0; i < cases.length; i++) {
      const { tool, params } = cases[i];
      ToolResultRenderer.sendProgress(player, i + 1, cases.length, tool);

      try {
        const ctx = new ToolContextImpl({ activeBotName: session.activeBot });
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
    const session = this.getSession(player);
    const botPlayer = BotManager.get(session.activeBot)?.getPlayer();

    for (const name of DEFAULT_SMOKE_TOOLS) {
      const tool = registry.get(name);
      if (!tool) continue;

      // 允许配置覆盖
      const configured = this.config.smoke_cases[name];
      if (configured) {
        cases.push({ tool: configured.tool, params: configured.params });
        continue;
      }

      // 基于假人环境生成默认参数
      const params = botPlayer
        ? DefaultParamProvider.generate(botPlayer, tool.metadata)
        : {};
      cases.push({ tool: name, params });
    }

    return cases;
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

  /**
   * 获取人类玩家的脚部坐标（整数方块坐标）
   */
  private getPlayerFeet(player: Player): { x: number; y: number; z: number; dimid: number } {
    const feet = player.feetPos
      ? { x: player.feetPos.x, y: player.feetPos.y, z: player.feetPos.z }
      : { x: player.pos.x, y: player.pos.y - 1.62, z: player.pos.z };
    return {
      x: Math.floor(feet.x),
      y: Math.floor(feet.y),
      z: Math.floor(feet.z),
      dimid: player.pos.dimid,
    };
  }
}
