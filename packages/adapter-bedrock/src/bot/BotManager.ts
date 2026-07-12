/**
 * BotManager — 假人管理器
 *
 * 单例静态管理器，负责所有假人的全局管理、上线/下线调度、数据持久化。
 */

import { BotInstance, BotPosition, InventorySnapshot } from './BotInstance.js';
import { BOT_DATA_DIR, BOT_INVENTORY_DIR, SUCCESS, DEFAULT_SELECT_SLOT } from '../utils/constants.js';
import { getEntityFeetPos, calcPosFromViewDirection } from '../utils/helpers.js';

// ── WalkResult 类型 ──

export interface WalkResult {
  isFullPath: boolean;
  path: number[][];
}

// ── BotManager 类 ──

export type BotEventType = 'online' | 'offline' | 'death' | 'created' | 'removed';

export interface BotEvent {
  type: BotEventType;
  botName: string;
  timestamp: number;
}

export type BotEventListener = (event: BotEvent) => void;

export class BotManager {
  private static instances: Record<string, BotInstance> = {};
  private static tickInstances: Record<string, BotInstance> = {};
  private static eventListeners: BotEventListener[] = [];

  // ── 事件监听 ──

  static onEvent(listener: BotEventListener): void {
    BotManager.eventListeners.push(listener);
  }

  static offEvent(listener: BotEventListener): void {
    BotManager.eventListeners = BotManager.eventListeners.filter((l) => l !== listener);
  }

  private static emitEvent(type: BotEventType, botName: string): void {
    const event: BotEvent = { type, botName, timestamp: Date.now() };
    for (const listener of BotManager.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error(`[BotManager] 事件监听异常: ${err}`);
      }
    }
  }

  // ── 初始化 ──

  static init(): void {
    // 确保数据目录存在
    if (!File.exists(BOT_DATA_DIR)) {
      File.mkdir(BOT_DATA_DIR);
    }
    if (!File.exists(BOT_INVENTORY_DIR)) {
      File.mkdir(BOT_INVENTORY_DIR);
    }
    logger.info('[McAgent] BotManager 已就绪');
  }

  // ── CRUD ──

  static create(
    name: string,
    pos: BotPosition,
    owner: string = '',
  ): string | void {
    if (name in BotManager.instances) {
      return `假人 ${name} 已存在`;
    }

    const bot = new BotInstance(name, pos);
    bot.setOwner(owner);
    BotManager.instances[name] = bot;
    BotManager.saveData(name);
    BotManager.emitEvent('created', name);
    return SUCCESS;
  }

  static remove(name: string): string | void {
    if (!(name in BotManager.instances)) {
      return `假人 ${name} 不存在`;
    }

    const bot = BotManager.instances[name];
    if (bot.isOnline()) {
      BotManager.offline(name, false);
    }

    delete BotManager.instances[name];
    if (name in BotManager.tickInstances) {
      delete BotManager.tickInstances[name];
    }

    BotManager.deleteData(name);
    BotManager.deleteInventory(name);
    BotManager.emitEvent('removed', name);
    return SUCCESS;
  }

  static get(name: string): BotInstance | null {
    return BotManager.instances[name] || null;
  }

  static getAll(): BotInstance[] {
    return Object.values(BotManager.instances);
  }

  static forEach(callback: (name: string, bot: BotInstance) => void): void {
    for (const name in BotManager.instances) {
      callback(name, BotManager.instances[name]);
    }
  }

  static list(): string[] {
    return Object.keys(BotManager.instances);
  }

  // ── 上线/下线 ──

  static online(name: string, failIfOnline: boolean = true): string | void {
    const bot = BotManager.instances[name];
    if (!bot) return `假人 ${name} 不存在`;

    if (failIfOnline && bot.isOnline()) {
      return `假人 ${name} 已在线`;
    }

    if (!bot.online()) return `假人 ${name} 上线失败`;

    if (bot.isNeedTick()) {
      BotManager.tickInstances[name] = bot;
    }

    BotManager.saveData(name, false);
    BotManager.loadInventory(name);
    BotManager.emitEvent('online', name);
    return SUCCESS;
  }

  static offline(name: string, failIfOffline: boolean = true): string | void {
    const bot = BotManager.instances[name];
    if (!bot) return `假人 ${name} 不存在`;

    if (failIfOffline && !bot.isOnline()) {
      return `假人 ${name} 已离线`;
    }

    if (name in BotManager.tickInstances) {
      delete BotManager.tickInstances[name];
    }

    if (!BotManager.saveInventory(name)) {
      logger.warn(`[McAgent] 保存假人 ${name} 的背包数据失败`);
    }

    if (!bot.offline()) return `假人 ${name} 下线失败`;

    BotManager.saveData(name, false);
    BotManager.emitEvent('offline', name);
    return SUCCESS;
  }

  static onlineAll(executor?: any): [string, string[]] {
    let resultStr = '';
    const successNames: string[] = [];

    BotManager.forEach((name, bot) => {
      if (!bot.isOnline()) {
        const result = BotManager.online(name, false);
        if (result !== SUCCESS) {
          resultStr += result + '\n';
        } else {
          successNames.push(name);
        }
      }
    });

    if (resultStr === '') return [SUCCESS, successNames];
    return [resultStr.substring(0, resultStr.length - 1), successNames];
  }

  static offlineAll(executor?: any): [string, string[]] {
    let resultStr = '';
    const successNames: string[] = [];

    BotManager.forEach((name, bot) => {
      if (bot.isOnline()) {
        const result = BotManager.offline(name, false);
        if (result !== SUCCESS) {
          resultStr += result + '\n';
        } else {
          successNames.push(name);
        }
      }
    });

    if (resultStr === '') return [SUCCESS, successNames];
    return [resultStr.substring(0, resultStr.length - 1), successNames];
  }

  // ── 传送 ──

  static teleportToPos(name: string, pos: any): string | void {
    const bot = BotManager.instances[name];
    if (!bot) return `假人 ${name} 不存在`;
    if (!bot.isOnline()) return `假人 ${name} 不在线`;

    const pl = bot.getPlayer();
    if (!pl) return `无法获取假人 ${name} 的玩家对象`;

    // LLSE 的 teleport 要求 FloatPos/IntPos 实例
    const fp = new FloatPos(pos.x, pos.y, pos.z, pos.dimid);
    if (!pl.teleport(fp)) return `传送假人 ${name} 到目标位置失败`;

    bot.setPos(pos.x, pos.y, pos.z, pos.dimid);
    BotManager.saveData(name, false);
    return SUCCESS;
  }

  static teleportToEntity(name: string, entity: any): string | void {
    if (!entity) return `目标实体无效`;

    const bot = BotManager.instances[name];
    if (!bot) return `假人 ${name} 不存在`;
    if (!bot.isOnline()) return `假人 ${name} 不在线`;

    const pl = bot.getPlayer();
    if (!pl) return `无法获取假人 ${name} 的玩家对象`;

    const pos = getEntityFeetPos(entity);
    if (!pl.teleport(pos)) return `传送假人 ${name} 到目标实体失败`;

    bot.setPos(pos.x, pos.y, pos.z, pos.dimid);
    BotManager.saveData(name);
    return SUCCESS;
  }

  // ── 行走 ──

  static walkToPos(name: string, pos: any): WalkResult | string {
    const bot = BotManager.instances[name];
    if (!bot) return `假人 ${name} 不存在`;
    if (!bot.isOnline()) return `假人 ${name} 不在线`;

    const pl = bot.getPlayer();
    if (!pl) return `无法获取假人 ${name} 的玩家对象`;

    if (pos.dimid !== pl.pos.dimid) {
      return `假人 ${name} 不在目标维度`;
    }

    // LLSE 的 simulateNavigateTo 要求 FloatPos 实例，不能传 plain object
    const fp = new FloatPos(pos.x, pos.y, pos.z, pos.dimid);
    const res = pl.simulateNavigateTo(fp);
    if (!res) return `假人 ${name} 寻路失败`;

    if (res.path.length > 0) {
      const last = res.path[res.path.length - 1];
      bot.setPos(last[0], last[1], last[2], pos.dimid);
      BotManager.saveData(name);
    }

    return res;
  }

  static walkToEntity(name: string, entity: any): WalkResult | string {
    if (!entity) return `目标实体无效`;

    const bot = BotManager.instances[name];
    if (!bot) return `假人 ${name} 不存在`;
    if (!bot.isOnline()) return `假人 ${name} 不在线`;

    const pl = bot.getPlayer();
    if (!pl) return `无法获取假人 ${name} 的玩家对象`;

    if (pl.pos.dimid !== entity.pos.dimid) {
      return `假人 ${name} 不在目标维度`;
    }

    const feetPos = getEntityFeetPos(entity);
    const res = pl.simulateNavigateTo(feetPos);
    if (!res) return `假人 ${name} 寻路失败`;

    if (res.path.length > 0) {
      const last = res.path[res.path.length - 1];
      bot.setPos(last[0], last[1], last[2], entity.pos.dimid);
      BotManager.saveData(name);
    }

    return res;
  }

  // ── 背包 ──

  static getInventory(name: string): InventorySnapshot | string {
    const bot = BotManager.instances[name];
    if (!bot) return `假人 ${name} 不存在`;
    if (!bot.isOnline()) return `假人 ${name} 不在线`;

    const pl = bot.getPlayer();
    if (!pl) return `无法获取假人 ${name} 的玩家对象`;

    const result: InventorySnapshot = {
      hand: null,
      offHand: null,
      inventory: [],
      armor: [],
    };

    // 主手
    const handItem = pl.getHand();
    if (!handItem.isNull()) {
      result.hand = { name: handItem.name, count: handItem.count };
    }

    // 副手
    const offHandItem = pl.getOffHand();
    if (!offHandItem.isNull()) {
      result.offHand = { name: offHandItem.name, count: offHandItem.count };
    }

    // 物品栏
    const inventory = pl.getInventory();
    for (const item of inventory.getAllItems()) {
      if (item.isNull()) {
        result.inventory.push(null);
      } else {
        result.inventory.push({ name: item.name, count: item.count });
      }
    }

    // 盔甲栏
    const armor = pl.getArmor();
    for (const item of armor.getAllItems()) {
      if (item.isNull()) {
        result.armor.push(null);
      } else {
        result.armor.push({ name: item.name, count: item.count });
      }
    }

    return result;
  }

  static giveItem(name: string, source: Player): string | void {
    if (!source) return `来源玩家无效`;

    const bot = BotManager.instances[name];
    if (!bot) return `假人 ${name} 不存在`;
    if (!bot.isOnline()) return `假人 ${name} 不在线`;

    const pl = bot.getPlayer();
    if (!pl) return `无法获取假人 ${name} 的玩家对象`;

    const itemOld = source.getHand();
    if (itemOld.isNull()) return SUCCESS;

    const itemNew = itemOld.clone();
    const inventory = pl.getInventory();

    if (inventory.hasRoomFor(itemNew)) {
      if (!inventory.addItem(itemNew)) {
        return `给假人 ${name} 物品失败`;
      }
    } else {
      // 先丢出主手物品腾空间
      const dropResult = BotManager.dropItem(name, DEFAULT_SELECT_SLOT);
      if (dropResult !== SUCCESS) return `背包已满，腾出空间失败: ${dropResult}`;

      if (!inventory.addItem(itemNew)) {
        return `给假人 ${name} 物品失败`;
      }
    }

    itemOld.setNull();
    source.refreshItems();
    pl.refreshItems();

    if (!BotManager.saveInventory(name)) {
      logger.warn(`[McAgent] 保存假人 ${name} 的背包数据失败`);
    }

    return SUCCESS;
  }

  static dropItem(name: string, slotId?: number): string | void {
    const bot = BotManager.instances[name];
    if (!bot) return `假人 ${name} 不存在`;
    if (!bot.isOnline()) return `假人 ${name} 不在线`;

    const pl = bot.getPlayer();
    if (!pl) return `无法获取假人 ${name} 的玩家对象`;

    if (slotId == null) slotId = DEFAULT_SELECT_SLOT;

    const inventory = pl.getInventory();
    const item = inventory.getItem(slotId);
    if (item.isNull()) return `栏位 ${slotId} 为空`;

    // 在假人面前 2 格处生成掉落物
    const dropPos = calcPosFromViewDirection(
      getEntityFeetPos(pl),
      pl.direction,
      2,
    );
    if (!mc.spawnItem(item.clone(), dropPos)) {
      return `生成掉落物失败`;
    }

    if (!inventory.removeItem(slotId, item.count)) {
      return `删除栏位 ${slotId} 的物品失败`;
    }

    if (!BotManager.saveInventory(name)) {
      logger.warn(`[McAgent] 保存假人 ${name} 的背包数据失败`);
    }

    return SUCCESS;
  }

  static dropAllItems(name: string): string | void {
    const bot = BotManager.instances[name];
    if (!bot) return `假人 ${name} 不存在`;
    if (!bot.isOnline()) return `假人 ${name} 不在线`;

    const pl = bot.getPlayer();
    if (!pl) return `无法获取假人 ${name} 的玩家对象`;

    const inventory = pl.getInventory();
    const size = inventory.size;
    let resultStr = '';

    for (let slotId = 0; slotId < size; slotId++) {
      const item = inventory.getItem(slotId);
      if (item.isNull()) continue;

      const dropPos = calcPosFromViewDirection(
        getEntityFeetPos(pl),
        pl.direction,
        2,
      );
      if (!mc.spawnItem(item.clone(), dropPos)) {
        resultStr += `栏位 ${slotId} 掉落失败\n`;
      }
      if (!inventory.removeItem(slotId, item.count)) {
        resultStr += `栏位 ${slotId} 删除失败\n`;
      }
    }

    if (!BotManager.saveInventory(name)) {
      logger.warn(`[McAgent] 保存假人 ${name} 的背包数据失败`);
    }

    return resultStr === '' ? SUCCESS : resultStr.substring(0, resultStr.length - 1);
  }

  // ── 同步 ──

  static startSync(name: string, target: Player): string | void {
    if (!target) return `目标玩家无效`;
    if (target.isSimulatedPlayer()) return `不能同步到另一个假人`;

    const bot = BotManager.instances[name];
    if (!bot) return `假人 ${name} 不存在`;
    if (!bot.isOnline()) return `假人 ${name} 不在线`;

    bot.startSync(target.xuid);
    BotManager.tickInstances[name] = bot;
    BotManager.saveData(name);
    return SUCCESS;
  }

  static stopSync(name: string): string | void {
    const bot = BotManager.instances[name];
    if (!bot) return `假人 ${name} 不存在`;
    if (!bot.isOnline()) return `假人 ${name} 不在线`;

    bot.stopSync();
    const pl = bot.getPlayer();
    if (pl) {
      pl.simulateStopMoving();
    }
    if (name in BotManager.tickInstances) {
      delete BotManager.tickInstances[name];
    }
    BotManager.saveData(name);
    bot.applyDirection();
    return SUCCESS;
  }

  // ── 事件回调 ──

  static onTick(): void {
    for (const key in BotManager.tickInstances) {
      BotManager.tickInstances[key].tickLoop();
    }
  }

  static onPlayerDie(player: Player, _source: any): void {
    if (!player) return;

    const name = player.realName;
    const bot = BotManager.get(name);
    if (!bot) return;
    if (!bot.isOnline()) return;

    BotManager.emitEvent('death', name);

    // 死亡频率检测
    if (bot.increaseDeathCount()) {
      // 死亡过于频繁，自动下线
      BotManager.offline(name);
      mc.broadcast(`§e[McAgent] 假人 ${name} 因死亡过于频繁已自动下线§r`);
      logger.warn(`[McAgent] 假人 ${name} 因死亡过于频繁已自动下线`);
      return;
    }

    logger.warn(`[McAgent] 假人 ${name} 死亡，正在重生...`);

    // 下线后重新上线以重生
    if (!bot.offline(false)) {
      logger.warn(`[McAgent] 假人 ${name} 下线失败`);
      return;
    }

    setTimeout(() => {
      if (!bot.online()) {
        logger.warn(`[McAgent] 假人 ${name} 重生失败`);
      } else {
        logger.warn(`[McAgent] 假人 ${name} 已重生`);
      }
    }, 500);
  }

  // ── 持久化：假人数据 ──

  static saveData(name: string, updatePos: boolean = true): boolean {
    const bot = BotManager.instances[name];
    if (!bot) return false;

    if (updatePos) {
      bot.updatePos();
      bot.updateDirection();
      bot.updateGameMode();
    }

    const data = JSON.stringify(bot.serialize(), null, 4);
    return File.writeTo(BOT_DATA_DIR + `${name}.json`, data);
  }

  static loadAllData(): boolean {
    if (!File.exists(BOT_DATA_DIR)) {
      File.mkdir(BOT_DATA_DIR);
      return true;
    }

    const fileNames = File.getFilesList(BOT_DATA_DIR);
    for (const fileName of fileNames) {
      const path = BOT_DATA_DIR + fileName;
      if (File.checkIsDir(path) || !fileName.endsWith('.json')) continue;

      const botName = fileName.substring(0, fileName.length - 5); // 去掉 .json
      const jsonStr = File.readFrom(path);
      if (jsonStr.length === 0 || jsonStr === '{}') continue;

      try {
        const data = JSON.parse(jsonStr);
        if (!(data instanceof Object)) return false;

        BotManager.instances[botName] = BotInstance.deserialize(botName, data);
        BotManager.saveData(botName, false);
      } catch (err) {
        logger.error(`[McAgent] 解析假人 ${botName} 的数据时出错: ${err}`);
        return false;
      }
    }

    return true;
  }

  static deleteData(name: string): boolean {
    return File.deleteFile(BOT_DATA_DIR + `${name}.json`);
  }

  // ── 持久化：背包数据 ──

  static saveInventory(name: string): boolean {
    const bot = BotManager.instances[name];
    if (!bot) return false;
    if (!bot.getPlayer()) return false;

    const snbt = bot.serializeInventory();
    if (!snbt) return false;

    if (!File.exists(BOT_INVENTORY_DIR)) {
      File.mkdir(BOT_INVENTORY_DIR);
    }
    return File.writeTo(BOT_INVENTORY_DIR + `${name}.snbt`, snbt);
  }

  static loadInventory(name: string): boolean {
    const bot = BotManager.instances[name];
    if (!bot) return false;
    if (!bot.getPlayer()) return false;

    if (!File.exists(BOT_INVENTORY_DIR)) {
      File.mkdir(BOT_INVENTORY_DIR);
      return false;
    }

    const snbt = File.readFrom(BOT_INVENTORY_DIR + `${name}.snbt`);
    if (!snbt) return false;

    return bot.deserializeInventory(snbt);
  }

  static deleteInventory(name: string): boolean {
    return File.deleteFile(BOT_INVENTORY_DIR + `${name}.snbt`);
  }

  // ── 自动恢复（服务器启动时） ──

  static initialAutoOnline(): string | void {
    let resultStr = '';

    BotManager.forEach((name, bot) => {
      if (bot.isOnline()) {
        const result = BotManager.online(name, false);
        if (result !== SUCCESS) {
          resultStr += result + '\n';
        }
      }
    });

    return resultStr === '' ? SUCCESS : resultStr.substring(0, resultStr.length - 1);
  }
}