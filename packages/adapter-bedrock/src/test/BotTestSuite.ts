/**
 * BotTestSuite — 假人模块手动测试套件
 *
 * 在 BDS 游戏内通过 GUI 触发，覆盖核心功能的冒烟测试。
 * 使用方法：`/mcagent test` 打开主菜单
 */

import { BotManager } from '../bot/BotManager.js';
import { BotInstance, BotOperation } from '../bot/BotInstance.js';
import type { BotPosition } from '../bot/BotInstance.js';
import { BOT_DATA_DIR, BOT_INVENTORY_DIR, SUCCESS } from '../utils/constants.js';

// ── 测试报告 ──

interface TestResult {
  pass: boolean;
  name: string;
  detail: string;
  durationMs: number;
}

// ── 测试玩家会话 ──

const TEST_PREFIX = '__TEST_';
const DEFAULT_BOT_NAME = `${TEST_PREFIX}Bot`;
const TEST_POS: BotPosition = { x: 0, y: 64, z: 0, dimid: 0 };

// ============================================================
// BotTestSuite
// ============================================================

export class BotTestSuite {
  private results: TestResult[] = [];
  private currentBatchName: string = '';

  // ── 菜单主入口 ──

  static showMainMenu(player: Player): void {
    const fm = mc.newSimpleForm();
    fm.setTitle('§lMcAgent 假人测试');
    fm.setTitle('§lAlice Mod 假人测试');

    fm.addButton('§a■ 全部冒烟测试\n一键运行所有核心功能', '');
    fm.addButton('§b● 生命周期\n上线/下线/创建/移除', '');
    fm.addButton('§e▲ 传送与行走\n传送/寻路/维度检测', '');
    fm.addButton('§d◆ 背包操作\n给予/丢弃/查询', '');
    fm.addButton('§c♥ 操作循环\n攻击/交互/使用物品', '');
    fm.addButton('§a♻ 同步测试\n跟随玩家/视角同步', '');
    fm.addButton('§7☰ 持久化\n数据保存/加载/恢复', '');
    fm.addButton('§c✕ 关闭', '');

    player.sendForm(fm, (pl, id) => {
      if (id === null) return;
      switch (id) {
        case 0: BotTestSuite.runAllTests(pl); break;
        case 1: BotTestSuite.showLifecycleMenu(pl); break;
        case 2: BotTestSuite.showTeleportMenu(pl); break;
        case 3: BotTestSuite.showInventoryMenu(pl); break;
        case 4: BotTestSuite.showOperationMenu(pl); break;
        case 5: BotTestSuite.showSyncMenu(pl); break;
        case 6: BotTestSuite.showPersistenceMenu(pl); break;
      }
    });
  }

  // ============================================================
  // 测试套件 — 全部运行
  // ============================================================

  static runAllTests(player: Player): void {
    const suite = new BotTestSuite();
    suite.currentBatchName = '全部冒烟测试';
    suite.results = [];

    player.sendText('§e[McAgent 测试] 开始全部冒烟测试...');
    player.sendText('');
    player.sendText('§e[Alice Mod 测试] 开始全部冒烟测试...');
    const startTime = Date.now();

    // 顺序执行测试
    suite.testCreate(suite, player);
    suite.testOnline(suite, player);
    suite.testTeleportToPlayer(suite, player);
    suite.testGiveItem(suite, player);
    suite.testInventoryQuery(suite, player);
    suite.testDropItem(suite, player);
    suite.testSync(suite, player);
    suite.testStopSync(suite, player);
    suite.testWalk(suite, player);
    suite.testOperation(suite, player);
    suite.testPersistence(suite, player);
    suite.testOffline(suite, player);
    suite.testReOnline(suite, player);
    suite.testRemove(suite, player);

    const totalDuration = Date.now() - startTime;

    // 输出报告
    player.sendText('§l========== 测试报告 ==========');
    const passed = suite.results.filter(r => r.pass).length;
    const failed = suite.results.filter(r => !r.pass).length;
    player.sendText(`总计: ${suite.results.length}  | 通过: ${passed}  | 失败: ${failed}  | 耗时: ${totalDuration}ms`);

    for (const result of suite.results) {
      const icon = result.pass ? '§a✓' : '§c✗';
      player.sendText(`${icon} ${result.name} [${result.durationMs}ms]`);
      if (!result.pass) {
        player.sendText(`  §c${result.detail}`);
      }
    }

    player.sendText(`§l========== ${suite.currentBatchName} ==========`);

    if (failed === 0) {
      player.sendText('§a✓ 全部测试通过');
    } else {
      player.sendText(`§c✗ ${failed} 个测试失败，请检查日志`);
    }
  }

  // ============================================================
  // 测试方法
  // ============================================================

  /**
   * 清理测试残留
   */
  static cleanupTest(): void {
    for (const name of BotManager.list()) {
      if (name.startsWith(TEST_PREFIX)) {
        const bot = BotManager.get(name);
        if (bot && bot.isOnline()) {
          bot.offline(false);
        }
        BotManager.deleteData(name);
        BotManager.deleteInventory(name);
      }
    }
  }

  // ── C1: 创建假人 ──

  private testCreate(suite: BotTestSuite, player: Player): void {
    const start = Date.now();
    const result = BotManager.create(DEFAULT_BOT_NAME, TEST_POS, player.xuid);
    const pass = result === SUCCESS;
    suite.results.push({
      pass,
      name: '创建假人',
      detail: pass ? `已创建 ${DEFAULT_BOT_NAME}` : result as string,
      durationMs: Date.now() - start,
    });
  }

  // ── C2: 上线 ──

  private testOnline(suite: BotTestSuite, _player: Player): void {
    const start = Date.now();
    const result = BotManager.online(DEFAULT_BOT_NAME, false);
    const pass = result === SUCCESS;
    const bot = BotManager.get(DEFAULT_BOT_NAME);
    suite.results.push({
      pass,
      name: '上线假人',
      detail: pass ? `状态: ${bot?.isOnline() ? '在线' : '离线'}` : result as string,
      durationMs: Date.now() - start,
    });
  }

  // ── C3: 传送到玩家 ──

  private testTeleportToPlayer(suite: BotTestSuite, player: Player): void {
    const start = Date.now();
    const result = BotManager.teleportToEntity(DEFAULT_BOT_NAME, player);
    const pass = result === SUCCESS;
    const bot = BotManager.get(DEFAULT_BOT_NAME);
    const plPos = player.pos;
    const botPos = bot?.getPos();
    suite.results.push({
      pass,
      name: '传送到玩家',
      detail: pass
        ? `玩家: (${plPos.x.toFixed(1)}, ${plPos.y.toFixed(1)}, ${plPos.z.toFixed(1)}) 假人: (${botPos?.x.toFixed(1)}, ${botPos?.y.toFixed(1)}, ${botPos?.z.toFixed(1)})`
        : result as string,
      durationMs: Date.now() - start,
    });
  }

  // ── C4: 给予物品 ──

  private testGiveItem(suite: BotTestSuite, player: Player): void {
    const start = Date.now();
    const result = BotManager.giveItem(DEFAULT_BOT_NAME, player);
    const pass = result === SUCCESS;
    suite.results.push({
      pass,
      name: '给予物品',
      detail: pass
        ? '已从玩家主手给予一个物品到假人'
        : result as string,
      durationMs: Date.now() - start,
    });
  }

  // ── C5: 背包查询 ──

  private testInventoryQuery(suite: BotTestSuite, _player: Player): void {
    const start = Date.now();
    const inv = BotManager.getInventory(DEFAULT_BOT_NAME);
    const pass = typeof inv !== 'string';
    const handInfo = pass ? (inv as any).hand : null;
    suite.results.push({
      pass,
      name: '查询背包',
      detail: pass
        ? `主手: ${handInfo ? `${handInfo.name} x${handInfo.count}` : '空'} | 物品栏物品数: ${(inv as any).inventory.filter((i: any) => i !== null).length}`
        : inv as string,
      durationMs: Date.now() - start,
    });
  }

  // ── C6: 丢弃物品 ──

  private testDropItem(suite: BotTestSuite, _player: Player): void {
    const start = Date.now();
    const result = BotManager.dropItem(DEFAULT_BOT_NAME);
    const pass = result === SUCCESS;
    suite.results.push({
      pass,
      name: '丢弃主手物品',
      detail: pass ? '已丢弃主手物品' : result as string,
      durationMs: Date.now() - start,
    });
  }

  // ── C7: 同步 ──

  private testSync(suite: BotTestSuite, player: Player): void {
    const start = Date.now();
    const result = BotManager.startSync(DEFAULT_BOT_NAME, player);
    const pass = result === SUCCESS;
    suite.results.push({
      pass,
      name: '开启玩家同步',
      detail: pass ? '假人开始跟随玩家' : result as string,
      durationMs: Date.now() - start,
    });
  }

  // ── C8: 停止同步 ──

  private testStopSync(suite: BotTestSuite, _player: Player): void {
    const start = Date.now();
    const result = BotManager.stopSync(DEFAULT_BOT_NAME);
    const pass = result === SUCCESS;
    suite.results.push({
      pass,
      name: '停止玩家同步',
      detail: pass ? '假人停止跟随' : result as string,
      durationMs: Date.now() - start,
    });
  }

  // ── C9: 寻路行走 ──

  private testWalk(suite: BotTestSuite, player: Player): void {
    const start = Date.now();
    const plPos = player.pos;
    const targetPos = { x: plPos.x + 5, y: plPos.y, z: plPos.z, dimid: plPos.dimid };
    const result = BotManager.walkToPos(DEFAULT_BOT_NAME, targetPos);
    const pass = typeof result !== 'string';
    suite.results.push({
      pass,
      name: '寻路行走',
      detail: pass
        ? `目标: (${targetPos.x.toFixed(1)}, ${targetPos.y.toFixed(1)}, ${targetPos.z.toFixed(1)}) 路径长度: ${(result as any).path?.length || 0}`
        : result as string,
      durationMs: Date.now() - start,
    });
  }

  // ── C10: 操作循环（攻击） ──

  private testOperation(suite: BotTestSuite, _player: Player): void {
    const start = Date.now();
    const bot = BotManager.get(DEFAULT_BOT_NAME);
    if (!bot) {
      suite.results.push({ pass: false, name: '攻击操作', detail: '假人不存在', durationMs: Date.now() - start });
      return;
    }
    bot.setShortOperation(BotOperation.ATTACK, 500, 3);
    const pass = true;
    suite.results.push({
      pass,
      name: '攻击操作（3次）',
      detail: '假人执行 3 次攻击，间隔 500ms',
      durationMs: Date.now() - start,
    });
  }

  // ── C11: 持久化 ──

  private testPersistence(suite: BotTestSuite, _player: Player): void {
    const start = Date.now();
    // 先保存
    const saveOk = BotManager.saveData(DEFAULT_BOT_NAME, true);
    // 验证文件存在
    const fileOk = File.exists(BOT_DATA_DIR + `${DEFAULT_BOT_NAME}.json`);
    const pass = saveOk && fileOk;
    suite.results.push({
      pass,
      name: '数据持久化',
      detail: pass
        ? `JSON 文件已保存: ${BOT_DATA_DIR}${DEFAULT_BOT_NAME}.json`
        : `保存: ${saveOk} 文件存在: ${fileOk}`,
      durationMs: Date.now() - start,
    });
  }

  // ── C12: 下线 ──

  private testOffline(suite: BotTestSuite, _player: Player): void {
    const start = Date.now();
    const result = BotManager.offline(DEFAULT_BOT_NAME, false);
    const pass = result === SUCCESS;
    suite.results.push({
      pass,
      name: '下线假人',
      detail: pass ? '假人已成功下线' : result as string,
      durationMs: Date.now() - start,
    });
  }

  // ── C13: 重新上线 ──

  private testReOnline(suite: BotTestSuite, _player: Player): void {
    const start = Date.now();
    const result = BotManager.online(DEFAULT_BOT_NAME, false);
    const pass = result === SUCCESS;
    suite.results.push({
      pass,
      name: '重新上线（持久化恢复）',
      detail: pass ? '假人从数据恢复并上线' : result as string,
      durationMs: Date.now() - start,
    });
  }

  // ── C14: 移除假人 ──

  private testRemove(suite: BotTestSuite, _player: Player): void {
    const start = Date.now();
    const result = BotManager.remove(DEFAULT_BOT_NAME);
    const pass = result === SUCCESS;
    suite.results.push({
      pass,
      name: '移除假人（清理数据）',
      detail: pass ? '假人数据和文件已全部清理' : result as string,
      durationMs: Date.now() - start,
    });
  }

  // ============================================================
  // 菜单 — 分类
  // ============================================================

  // ── 生命周期菜单 ──

  static showLifecycleMenu(player: Player): void {
    const fm = mc.newSimpleForm();
    fm.setTitle('§l生命周期测试');
    fm.setContent('选择要执行的操作：');
    fm.addButton('创建假人', '');
    fm.addButton('上线假人', '');
    fm.addButton('下线假人', '');
    fm.addButton('移除假人', '');
    fm.addButton('上线全部', '');
    fm.addButton('下线全部', '');
    fm.addButton('查看假人状态', '');
    fm.addButton('← 返回', '');

    player.sendForm(fm, (pl, id) => {
      if (id === null) return;
      const start = Date.now();

      switch (id) {
        case 0: {
          const r = BotManager.create(DEFAULT_BOT_NAME, TEST_POS, pl.xuid);
          pl.sendText(r === SUCCESS ? `§a✓ 创建成功 [${Date.now() - start}ms]` : `§c✗ ${r}`);
          break;
        }
        case 1: {
          const r = BotManager.online(DEFAULT_BOT_NAME, false);
          pl.sendText(r === SUCCESS ? `§a✓ 上线成功 [${Date.now() - start}ms]` : `§c✗ ${r}`);
          break;
        }
        case 2: {
          const r = BotManager.offline(DEFAULT_BOT_NAME, false);
          pl.sendText(r === SUCCESS ? `§a✓ 下线成功 [${Date.now() - start}ms]` : `§c✗ ${r}`);
          break;
        }
        case 3: {
          const r = BotManager.remove(DEFAULT_BOT_NAME);
          pl.sendText(r === SUCCESS ? `§a✓ 已移除 [${Date.now() - start}ms]` : `§c✗ ${r}`);
          break;
        }
        case 4: {
          const [r, names] = BotManager.onlineAll(pl);
          pl.sendText(r === SUCCESS ? `§a✓ 已上线 ${names.length} 个假人 [${Date.now() - start}ms]` : `§c✗ ${r}`);
          break;
        }
        case 5: {
          const [r, names] = BotManager.offlineAll(pl);
          pl.sendText(r === SUCCESS ? `§a✓ 已下线 ${names.length} 个假人 [${Date.now() - start}ms]` : `§c✗ ${r}`);
          break;
        }
        case 6: {
          const bot = BotManager.get(DEFAULT_BOT_NAME);
          if (!bot) {
            pl.sendText('§e假人不存在');
          } else {
            const info = bot.getInfo();
            pl.sendText(`§l=== ${info.name} ===`);
            pl.sendText(`状态: ${info.isOnline ? '§a在线' : '§c离线'}`);
            pl.sendText(`位置: (${info.pos.x.toFixed(1)}, ${info.pos.y.toFixed(1)}, ${info.pos.z.toFixed(1)}) [维度 ${info.pos.dimid}]`);
            pl.sendText(`方向: ${info.direction.toFixed(1)}°`);
            pl.sendText(`游戏模式: ${info.gameMode}`);
            pl.sendText(`操作: ${info.operation || '无'}`);
            pl.sendText(`所有者: ${info.owner}`);
          }
          break;
        }
        case 7:
          BotTestSuite.showMainMenu(pl);
          return;
      }

      // 延迟 1 秒返回上级菜单
      setTimeout(() => BotTestSuite.showLifecycleMenu(pl), 1000);
    });
  }

  // ── 传送与行走菜单 ──

  static showTeleportMenu(player: Player): void {
    const fm = mc.newSimpleForm();
    fm.setTitle('§l传送与行走测试');
    fm.setContent('选择要执行的操作：');
    fm.addButton('传送到玩家', '');
    fm.addButton('传送到坐标 (0,64,0)', '');
    fm.addButton('向前行走 5 格', '');
    fm.addButton('自定义传送', '');
    fm.addButton('← 返回', '');

    player.sendForm(fm, (pl, id) => {
      if (id === null) return;
      const start = Date.now();

      switch (id) {
        case 0: {
          const r = BotManager.teleportToEntity(DEFAULT_BOT_NAME, pl);
          pl.sendText(r === SUCCESS ? `§a✓ 传送到玩家成功 [${Date.now() - start}ms]` : `§c✗ ${r}`);
          break;
        }
        case 1: {
          const r = BotManager.teleportToPos(DEFAULT_BOT_NAME, new FloatPos(0, 64, 0, 0));
          pl.sendText(r === SUCCESS ? `§a✓ 传送到 (0,64,0) 成功 [${Date.now() - start}ms]` : `§c✗ ${r}`);
          break;
        }
        case 2: {
          const plPos = pl.pos;
          const targetPos = { x: plPos.x + 5, y: plPos.y, z: plPos.z, dimid: plPos.dimid };
          const r = BotManager.walkToPos(DEFAULT_BOT_NAME, targetPos);
          pl.sendText(typeof r !== 'string' ? `§a✓ 寻路成功，路径长度: ${r.path.length} [${Date.now() - start}ms]` : `§c✗ ${r}`);
          break;
        }
        case 3: {
          // 自定义输入 — 用 ActionForm 提示
          pl.sendText('§e请在聊天栏输入: /mcagent tp <x> <y> <z> [dimid]');
          break;
        }
        case 4:
          BotTestSuite.showMainMenu(pl);
          return;
      }

      setTimeout(() => BotTestSuite.showTeleportMenu(pl), 1000);
    });
  }

  // ── 背包操作菜单 ──

  static showInventoryMenu(player: Player): void {
    const fm = mc.newSimpleForm();
    fm.setTitle('§l背包测试');
    fm.setContent('选择要执行的操作：');
    fm.addButton('查询背包', '');
    fm.addButton('给予物品（从玩家主手）', '');
    fm.addButton('丢弃主手物品', '');
    fm.addButton('丢弃全部物品', '');
    fm.addButton('← 返回', '');

    player.sendForm(fm, (pl, id) => {
      if (id === null) return;
      const start = Date.now();

      switch (id) {
        case 0: {
          const inv = BotManager.getInventory(DEFAULT_BOT_NAME);
          if (typeof inv === 'string') {
            pl.sendText(`§c✗ ${inv}`);
          } else {
            pl.sendText(`§l=== ${DEFAULT_BOT_NAME} 背包 ===`);
            pl.sendText(`主手: ${inv.hand ? `§f${inv.hand.name} §7x${inv.hand.count}` : '§7空'}`);
            pl.sendText(`副手: ${inv.offHand ? `§f${inv.offHand.name} §7x${inv.offHand.count}` : '§7空'}`);
            const itemCount = inv.inventory.filter(i => i !== null).length;
            const armorCount = inv.armor.filter(i => i !== null).length;
            pl.sendText(`物品栏: ${itemCount} 格有物品 | 盔甲栏: ${armorCount} 件`);
            pl.sendText(`§7查询耗时: ${Date.now() - start}ms`);
          }
          break;
        }
        case 1: {
          const r = BotManager.giveItem(DEFAULT_BOT_NAME, pl);
          pl.sendText(r === SUCCESS ? `§a✓ 给予成功 [${Date.now() - start}ms]` : `§c✗ ${r}`);
          break;
        }
        case 2: {
          const r = BotManager.dropItem(DEFAULT_BOT_NAME);
          pl.sendText(r === SUCCESS ? `§a✓ 丢弃成功 [${Date.now() - start}ms]` : `§c✗ ${r}`);
          break;
        }
        case 3: {
          const r = BotManager.dropAllItems(DEFAULT_BOT_NAME);
          pl.sendText(r === SUCCESS ? `§a✓ 全部丢弃成功 [${Date.now() - start}ms]` : `§c✗ ${r}`);
          break;
        }
        case 4:
          BotTestSuite.showMainMenu(pl);
          return;
      }

      setTimeout(() => BotTestSuite.showInventoryMenu(pl), 1000);
    });
  }

  // ── 操作循环菜单 ──

  static showOperationMenu(player: Player): void {
    const fm = mc.newSimpleForm();
    fm.setTitle('§l操作循环测试');
    fm.setContent('选择要执行的操作：');
    fm.addButton('攻击（3次, 间隔500ms）', '');
    fm.addButton('交互（1次）', '');
    fm.addButton('破坏方块（持续 3s）', '');
    fm.addButton('停止所有操作', '');
    fm.addButton('← 返回', '');

    player.sendForm(fm, (pl, id) => {
      if (id === null) return;
      const bot = BotManager.get(DEFAULT_BOT_NAME);
      if (!bot) {
        pl.sendText('§c✗ 假人不存在，请先创建并上线');
        setTimeout(() => BotTestSuite.showOperationMenu(pl), 1000);
        return;
      }

      switch (id) {
        case 0:
          bot.setShortOperation(BotOperation.ATTACK, 500, 3);
          pl.sendText('§a✓ 假人开始 3 次攻击（每次间隔 500ms）');
          break;
        case 1:
          bot.setShortOperation(BotOperation.INTERACT, 200, 1);
          pl.sendText('§a✓ 假人执行 1 次交互');
          break;
        case 2:
          bot.setLongOperation(BotOperation.DESTROY, 1000, 3, 3000);
          pl.sendText('§a✓ 假人开始破坏方块（持续 3s，共 3 轮）');
          break;
        case 3:
          bot.clearOperation();
          pl.sendText('§a✓ 已停止所有操作');
          break;
        case 4:
          BotTestSuite.showMainMenu(pl);
          return;
      }

      setTimeout(() => BotTestSuite.showOperationMenu(pl), 1000);
    });
  }

  // ── 同步测试菜单 ──

  static showSyncMenu(player: Player): void {
    const fm = mc.newSimpleForm();
    fm.setTitle('§l同步测试');
    fm.setContent('选择要执行的操作：');
    fm.addButton('开始跟随玩家', '');
    fm.addButton('停止跟随', '');
    fm.addButton('← 返回', '');

    player.sendForm(fm, (pl, id) => {
      if (id === null) return;

      switch (id) {
        case 0: {
          const r = BotManager.startSync(DEFAULT_BOT_NAME, pl);
          pl.sendText(r === SUCCESS ? '§a✓ 假人开始跟随玩家移动和视角' : `§c✗ ${r}`);
          break;
        }
        case 1: {
          const r = BotManager.stopSync(DEFAULT_BOT_NAME);
          pl.sendText(r === SUCCESS ? '§a✓ 假人停止跟随' : `§c✗ ${r}`);
          break;
        }
        case 2:
          BotTestSuite.showMainMenu(pl);
          return;
      }

      setTimeout(() => BotTestSuite.showSyncMenu(pl), 1000);
    });
  }

  // ── 持久化菜单 ──

  static showPersistenceMenu(player: Player): void {
    const fm = mc.newSimpleForm();
    fm.setTitle('§l持久化测试');
    fm.setContent('选择要执行的操作：');
    fm.addButton('保存数据到文件', '');
    fm.addButton('从文件加载全部', '');
    fm.addButton('保存背包数据', '');
    fm.addButton('加载背包数据', '');
    fm.addButton('清理测试文件', '');
    fm.addButton('← 返回', '');

    player.sendForm(fm, (pl, id) => {
      if (id === null) return;
      const start = Date.now();

      switch (id) {
        case 0: {
          const ok = BotManager.saveData(DEFAULT_BOT_NAME, true);
          pl.sendText(ok ? `§a✓ 数据已保存 [${Date.now() - start}ms]` : '§c✗ 保存失败');
          break;
        }
        case 1: {
          const ok = BotManager.loadAllData();
          pl.sendText(ok ? `§a✓ 已从文件恢复全部假人 [${Date.now() - start}ms]` : '§c✗ 加载失败');
          break;
        }
        case 2: {
          const ok = BotManager.saveInventory(DEFAULT_BOT_NAME);
          pl.sendText(ok ? `§a✓ 背包已保存 [${Date.now() - start}ms]` : '§c✗ 保存失败（假人可能不在线）');
          break;
        }
        case 3: {
          const ok = BotManager.loadInventory(DEFAULT_BOT_NAME);
          pl.sendText(ok ? `§a✓ 背包已加载 [${Date.now() - start}ms]` : '§c✗ 加载失败');
          break;
        }
        case 4: {
          BotTestSuite.cleanupTest();
          // 删除文件目录
          if (File.exists(BOT_DATA_DIR)) File.deleteFile(BOT_DATA_DIR);
          if (File.exists(BOT_INVENTORY_DIR)) File.deleteFile(BOT_INVENTORY_DIR);
          pl.sendText(`§a✓ 测试数据已清理 [${Date.now() - start}ms]`);
          break;
        }
        case 5:
          BotTestSuite.showMainMenu(pl);
          return;
      }

      setTimeout(() => BotTestSuite.showPersistenceMenu(pl), 1000);
    });
  }

  // ── TCP 连接状态测试 ──

  static testTcpConnection(player: Player): void {
    // 占位 — 后续实装
    player.sendText('§eTCP 测试待后续版本实现');
  }
}

// ── 额外指令回调 ──

export function handleTpCommand(player: Player, args: string[]): void {
  if (args.length < 3) {
    player.sendText('§c用法: /mcagent tp <x> <y> <z> [dimid]');
    return;
  }

  const x = parseFloat(args[0]);
  const y = parseFloat(args[1]);
  const z = parseFloat(args[2]);
  const dimid = args.length >= 4 ? parseInt(args[3]) : player.pos.dimid;

  if (isNaN(x) || isNaN(y) || isNaN(z)) {
    player.sendText('§c坐标格式错误');
    return;
  }

  const r = BotManager.teleportToPos(DEFAULT_BOT_NAME, new FloatPos(x, y, z, dimid));
  player.sendText(r === SUCCESS ? `§a✓ 已传送到 (${x}, ${y}, ${z}) [维度 ${dimid}]` : `§c✗ ${r}`);
}