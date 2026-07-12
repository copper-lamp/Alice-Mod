/**
 * 床搜索与入睡条件检查
 */

import type { Vec3 } from '../pathfinding/types.js';

const BED_NAMES = new Set([
  'bed',
  'white_bed',
  'orange_bed',
  'magenta_bed',
  'light_blue_bed',
  'yellow_bed',
  'lime_bed',
  'pink_bed',
  'gray_bed',
  'light_gray_bed',
  'cyan_bed',
  'purple_bed',
  'blue_bed',
  'brown_bed',
  'green_bed',
  'red_bed',
  'black_bed',
]);

const HOSTILE_MOBS = [
  'zombie',
  'skeleton',
  'creeper',
  'spider',
  'enderman',
  'witch',
  'slime',
  'phantom',
  'drowned',
  'husk',
  'stray',
  'evoker',
  'vindicator',
  'pillager',
  'ravager',
  'vex',
  'piglin_brute',
  'hoglin',
  'zoglin',
];

export type SleepConditionReason = 'NOT_SLEEP_TIME' | 'MONSTERS_NEARBY' | 'BED_UNAVAILABLE';

export interface SleepConditionCheck {
  ok: boolean;
  reason?: SleepConditionReason;
}

export interface BedFinderWorld {
  getBlock(x: number, y: number, z: number): any;
  getTime(): number;
  getWeather(): string;
  getEntities(options?: any): any[];
}

export class BedFinder {
  constructor(private world: BedFinderWorld) {}

  /**
   * 在指定半径内搜索最近的床方块
   */
  findNearest(position: Vec3, radius: number): { pos: Vec3; block: any } | null {
    const baseX = Math.floor(position.x);
    const baseY = Math.floor(position.y);
    const baseZ = Math.floor(position.z);

    let best: { pos: Vec3; block: any; distance: number } | null = null;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const x = baseX + dx;
          const y = baseY + dy;
          const z = baseZ + dz;

          const block = this.world.getBlock(x, y, z);
          if (!block || !isBed(block.name)) continue;

          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (!best || distance < best.distance) {
            best = { pos: { x, y, z }, block, distance };
          }
        }
      }
    }

    return best ? { pos: best.pos, block: best.block } : null;
  }

  /**
   * 检查指定床的入睡条件
   */
  checkSleepConditions(bedPos: Vec3, _player: any): SleepConditionCheck {
    const time = this.safeGetTime();
    const weather = this.safeGetWeather();

    const isNight = time >= 12541 && time <= 23458;
    const isThunder = weather === 'thunder';
    if (!isNight && !isThunder) {
      return { ok: false, reason: 'NOT_SLEEP_TIME' };
    }

    if (this.hasMonstersNearby(bedPos)) {
      return { ok: false, reason: 'MONSTERS_NEARBY' };
    }

    const block = this.world.getBlock(bedPos.x, bedPos.y, bedPos.z);
    if (!block || !isBed(block.name) || isBedOccupied(block)) {
      return { ok: false, reason: 'BED_UNAVAILABLE' };
    }

    return { ok: true };
  }

  private hasMonstersNearby(bedPos: Vec3, radius = 8): boolean {
    try {
      const entities = this.world.getEntities();
      for (const e of entities) {
        const type = String(e.type || e.name || '').toLowerCase();
        if (!HOSTILE_MOBS.some((h) => type.includes(h))) continue;

        const ex = e.pos?.x ?? 0;
        const ey = e.pos?.y ?? 0;
        const ez = e.pos?.z ?? 0;
        const dx = ex - bedPos.x;
        const dy = ey - bedPos.y;
        const dz = ez - bedPos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist <= radius) return true;
      }
    } catch (e) {
      // 忽略实体读取失败
    }
    return false;
  }

  private safeGetTime(): number {
    try {
      return this.world.getTime();
    } catch (e) {
      return 6000;
    }
  }

  private safeGetWeather(): string {
    try {
      return this.world.getWeather();
    } catch (e) {
      return 'clear';
    }
  }
}

export function isBed(name: string): boolean {
  return BED_NAMES.has(normalizeName(name));
}

function isBedOccupied(block: any): boolean {
  try {
    if (typeof block.getBlockState === 'function') {
      const state = block.getBlockState();
      if (state) {
        return state.occupied === true || state.Occupied === true;
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^minecraft:/, '')
    .trim();
}
