/**
 * StatusReporter — 状态上报模块
 *
 * 周期性采集假人状态（生命、位置、装备、背包摘要），
 * 每 2s 通过 TCP 发送 status_report 通知到 Agent Core。
 * 支持多假人独立上报，按 BotManager 维护的在线假人列表采集。
 */

// logger 为 LLSE 全局变量，无需导入

// ── 状态上报类型 ──

export interface StatusReport {
  timestamp: string;
  bot_id: string;
  health: {
    health: number;
    max_health: number;
    hunger: number;
    saturation: number;
    air: number;
  };
  position: {
    x: number;
    y: number;
    z: number;
    dimension: string;
    yaw: number;
    pitch: number;
  };
  equipment: Record<string, string | null>;
  inventory_summary: {
    used_slots: number;
    total_slots: number;
    items: Array<{ name: string; count: number }>;
  };
}

// ── 默认间隔 ──

const DEFAULT_INTERVAL_MS = 2000;
const WARN_THRESHOLD_MS = 100;

// ── 维度名称映射 ──

const DIMENSION_NAMES: Record<number, string> = {
  0: 'overworld',
  1: 'nether',
  2: 'end',
};

function getDimensionName(dimid: number): string {
  return DIMENSION_NAMES[dimid] ?? String(dimid);
}

// ── StatusReporter ──

export class StatusReporter {
  private sendNotification: (method: string, params: any) => void;
  private isConnected: () => boolean;
  private getBots: (() => any[]) | null;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private enabled: boolean = false;

  constructor(options: {
    sendNotification: (method: string, params: any) => void;
    isConnected: () => boolean;
    getBots?: () => any[];
    intervalMs?: number;
  }) {
    this.sendNotification = options.sendNotification;
    this.isConnected = options.isConnected;
    this.getBots = options.getBots || null;
    this.intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS;
  }

  // ── 生命周期 ──

  /**
   * 启动定时上报
   */
  start(): void {
    if (this.timer !== null) return;
    this.enabled = true;
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        logger.error(`[StatusReporter] 未捕获的上报错误: ${err}`);
      });
    }, this.intervalMs);
    logger.info(`[StatusReporter] 已启动 (间隔 ${this.intervalMs}ms)`);
  }

  /**
   * 停止定时上报
   */
  stop(): void {
    this.enabled = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('[StatusReporter] 已停止');
  }

  /**
   * 是否正在运行
   */
  isRunning(): boolean {
    return this.timer !== null;
  }

  // ── 数据采集 ──

  /**
   * 采集所有在线假人的状态数据
   */
  collect(): StatusReport[] {
    // 已接入 BotManager：仅按在线假人采集，无在线假人时返回空数组
    if (this.getBots) {
      return this.getBots()
        .filter((b) => b.isOnline())
        .map((bot) => this.collectForBot(bot));
    }

    // 降级：未接入 BotManager 时取首个在线玩家
    const pl = mc.getOnlinePlayers()[0];
    return pl ? [this.buildReport(pl, pl.realName)] : [];
  }

  /**
   * 为单个假人采集状态
   */
  private collectForBot(bot: any): StatusReport {
    const pl = bot.getPlayer ? bot.getPlayer() : null;
    return this.buildReport(pl, bot.name);
  }

  /**
   * 构造状态报文
   */
  private buildReport(pl: any, botId: string): StatusReport {
    const now = new Date().toISOString();

    return {
      timestamp: now,
      bot_id: botId,
      health: {
        health: typeof pl?.getHealth === 'function' ? pl.getHealth() : 0,
        max_health: typeof pl?.getMaxHealth === 'function' ? pl.getMaxHealth() : 20,
        hunger: typeof pl?.getHunger === 'function' ? pl.getHunger() : 20,
        saturation: typeof pl?.getSaturation === 'function' ? pl.getSaturation() : 0,
        air: typeof pl?.getAir === 'function' ? pl.getAir() : 300,
      },
      position: {
        x: pl?.pos?.x ?? 0,
        y: pl?.pos?.y ?? 64,
        z: pl?.pos?.z ?? 0,
        dimension: pl?.pos ? getDimensionName(pl.pos.dimid) : 'overworld',
        yaw: pl?.direction?.yaw ?? 0,
        pitch: pl?.direction?.pitch ?? 0,
      },
      equipment: this.collectEquipment(pl),
      inventory_summary: this.collectInventorySummary(pl),
    };
  }

  /**
   * 采集装备信息，兼容 SimulatedPlayer 可能缺少 API 的情况
   */
  private collectEquipment(pl: any): StatusReport['equipment'] {
    if (!pl) return {};

    const armor = typeof pl.getArmor === 'function' ? pl.getArmor() : null;
    const getArmorItem = (slot: number) => {
      try {
        return armor?.getItem(slot)?.name || null;
      } catch {
        return null;
      }
    };

    return {
      hand: typeof pl.getHand === 'function' ? pl.getHand()?.name || null : null,
      offhand: typeof pl.getOffHand === 'function' ? pl.getOffHand()?.name || null : null,
      helmet: getArmorItem(0),
      chestplate: getArmorItem(1),
      leggings: getArmorItem(2),
      boots: getArmorItem(3),
    };
  }

  /**
   * 采集背包摘要
   */
  private collectInventorySummary(pl: any): StatusReport['inventory_summary'] {
    if (!pl || typeof pl.getInventory !== 'function') {
      return { used_slots: 0, total_slots: 36, items: [] };
    }

    try {
      const inventory = pl.getInventory();
      const totalSlots = inventory?.size ?? 36;
      const items: Array<{ name: string; count: number }> = [];
      let usedSlots = 0;

      for (let i = 0; i < totalSlots; i++) {
        const item = inventory.getItem(i);
        if (item && !item.isNull()) {
          usedSlots++;
          items.push({ name: item.name, count: item.count });
        }
      }

      return {
        used_slots: usedSlots,
        total_slots: totalSlots,
        items,
      };
    } catch (err) {
      logger.error(`[StatusReporter] 采集背包摘要失败: ${err}`);
      return { used_slots: 0, total_slots: 36, items: [] };
    }
  }

  // ── 上报 ──

  /**
   * 立即上报一次状态
   */
  report(): void {
    if (!this.isConnected()) return;

    const startTime = Date.now();
    const reports = this.collect();

    for (const report of reports) {
      this.sendNotification('status_report', report);
    }

    const elapsed = Date.now() - startTime;
    if (elapsed > WARN_THRESHOLD_MS) {
      logger.warn(`[StatusReporter] 状态上报耗时 ${elapsed}ms（阈值 ${WARN_THRESHOLD_MS}ms）`);
    }
  }

  private async tick(): Promise<void> {
    if (!this.enabled) return;
    try {
      this.report();
    } catch (err) {
      logger.error(`[StatusReporter] 上报失败: ${err}`);
    }
  }
}
