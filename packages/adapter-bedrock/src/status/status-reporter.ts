/**
 * StatusReporter — 状态上报模块
 *
 * 周期性采集假人状态（生命、位置、装备、背包摘要），
 * 每 2s 通过 TCP 发送 status_report 通知到 Agent Core。
 */

// logger 为 LLSE 全局变量，无需导入

// ── 状态上报类型 ──

export interface StatusReport {
  timestamp: string;
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

// ── StatusReporter ──

export class StatusReporter {
  private sendNotification: (method: string, params: any) => void;
  private isConnected: () => boolean;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private enabled: boolean = false;

  constructor(options: {
    sendNotification: (method: string, params: any) => void;
    isConnected: () => boolean;
    intervalMs?: number;
  }) {
    this.sendNotification = options.sendNotification;
    this.isConnected = options.isConnected;
    this.intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS;
  }

  // ── 生命周期 ──

  /**
   * 启动定时上报
   */
  start(): void {
    if (this.timer !== null) return;
    this.enabled = true;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
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
   * 采集当前状态数据
   */
  collect(): StatusReport {
    // @ts-ignore — LLSE 全局变量
    const pl = mc.getPlayerList()[0];
    const now = new Date().toISOString();

    return {
      timestamp: now,
      health: {
        health: pl ? pl.health : 0,
        max_health: pl ? pl.maxHealth : 20,
        hunger: pl ? pl.hunger : 20,
        saturation: 0,
        air: pl ? pl.air : 300,
      },
      position: {
        x: pl ? pl.pos.x : 0,
        y: pl ? pl.pos.y : 64,
        z: pl ? pl.pos.z : 0,
        dimension: pl ? String(pl.pos.dimid) : '0',
        yaw: pl ? pl.direction.yaw : 0,
        pitch: pl ? pl.direction.pitch : 0,
      },
      equipment: pl ? {
        hand: pl.getHand()?.name || null,
        offhand: pl.getOffHand()?.name || null,
        helmet: pl.getArmor()?.getItem(0)?.name || null,
        chestplate: pl.getArmor()?.getItem(1)?.name || null,
        leggings: pl.getArmor()?.getItem(2)?.name || null,
        boots: pl.getArmor()?.getItem(3)?.name || null,
      } : {},
      inventory_summary: this.collectInventorySummary(pl),
    };
  }

  /**
   * 采集背包摘要
   */
  private collectInventorySummary(pl: any): StatusReport['inventory_summary'] {
    if (!pl) {
      return { used_slots: 0, total_slots: 36, items: [] };
    }

    const inventory = pl.getInventory();
    const totalSlots = inventory.size;
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
  }

  // ── 上报 ──

  /**
   * 立即上报一次状态
   */
  report(): void {
    if (!this.isConnected()) return;

    const startTime = Date.now();
    const report = this.collect();

    this.sendNotification('status_report', report);

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