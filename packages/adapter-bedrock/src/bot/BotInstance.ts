/**
 * BotInstance — 假人实例
 *
 * 封装单个假人的完整生命周期：生成、上线、下线、传送、
 * 状态同步、操作循环、数据序列化。
 */

import { getEntityFeetPos } from '../utils/helpers.js';
import { BotManager } from './BotManager.js';

// ── 枚举 ──

export enum BotStatus {
  OFFLINE = 0,
  ONLINE = 1,
}

export enum BotOperation {
  ATTACK = 'attack',
  DESTROY = 'destroy',
  INTERACT = 'interact',
  USE_ITEM = 'useitem',
  CLEAR = 'clear',
}

// ── 接口 ──

export interface BotPosition {
  x: number;
  y: number;
  z: number;
  dimid: number;
}

export interface BotDirection {
  yaw: number;
  pitch: number;
}

export interface InventorySnapshot {
  hand: { name: string; count: number } | null;
  offHand: { name: string; count: number } | null;
  inventory: ({ name: string; count: number } | null)[];
  armor: ({ name: string; count: number } | null)[];
}

export interface BotData {
  _version: number;
  name: string;
  pos: BotPosition;
  direction: number;
  gameMode: number;
  owner: string;
  isOnline: boolean;
  operation: string;
  opInterval: number;
  opMaxTimes: number;
  opLength: number;
  syncTarget: string;
}

export interface BotInfo {
  name: string;
  pos: BotPosition;
  direction: number;
  gameMode: number;
  isOnline: boolean;
  owner: string;
  operation: string;
  opInterval: number;
  opMaxTimes: number;
  opLength: number;
  syncTarget: string;
}

// ── 常量 ──

const SHORT_OPERATIONS = ['attack', 'interact', 'destroy'];
const LONG_OPERATIONS = ['useitem'];
const DEATH_COUNTER_THRESHOLD = 5;
const DEATH_COUNTER_WINDOW_MS = 20000;

// ── BotInstance 类 ──

export class BotInstance {
  readonly name: string;

  private _pos: BotPosition;
  private _direction: number;
  private _gameMode: number;
  private _status: BotStatus;
  private _owner: string;
  private _operation: string;
  private _opInterval: number;
  private _opMaxTimes: number;
  private _opLength: number;
  private _syncTarget: string;
  private _opTimer: any;
  private _lastSyncPos: BotPosition | null;

  // 死亡计数器
  private _deathCount: number = 0;
  private _deathTimers: any[] = [];

  constructor(
    name: string,
    pos: BotPosition,
    operation: string = '',
    opInterval: number = 1000,
    opMaxTimes: number = 1,
    opLength: number = 1000,
    syncTarget: string = '',
    isOnline: boolean = false,
    owner: string = '',
    direction: number = 0,
    gameMode: number = 5,
  ) {
    this.name = name;
    this._pos = pos;
    this._direction = direction;
    this._gameMode = gameMode;
    this._status = isOnline ? BotStatus.ONLINE : BotStatus.OFFLINE;
    this._owner = owner;
    this._operation = operation;
    this._opInterval = opInterval;
    this._opMaxTimes = opMaxTimes;
    this._opLength = opLength;
    this._syncTarget = syncTarget;
    this._opTimer = null;
    this._lastSyncPos = null;
  }

  // ── 生命周期 ──

  online(): boolean {
    if (mc.getPlayer(this.name) != null) return true;

    const spawnPos = new FloatPos(
      eval(String(this._pos.x)),
      eval(String(this._pos.y)),
      eval(String(this._pos.z)),
      eval(String(this._pos.dimid)),
    );

    const pl = mc.spawnSimulatedPlayer(this.name, spawnPos);
    if (!pl) return false;

    this._status = BotStatus.ONLINE;

    // 二次传送确保位置准确
    if (!pl.teleport(spawnPos)) return false;

    // 恢复方向
    this.applyDirection();
    // 恢复游戏模式
    this.applyGameMode();
    // 恢复操作循环
    if (this._operation !== '') {
      this.startOperationLoop();
    }

    return true;
  }

  offline(updateData: boolean = true): boolean {
    if (!this.isOnline()) return true;

    const pl = this.getPlayer();
    if (!pl) return false;

    this.stopOperationLoop();

    if (updateData) {
      this.updatePos();
      this.updateDirection();
      this.updateGameMode();
    }

    const success = pl.simulateDisconnect();
    if (!success) return false;

    this._status = BotStatus.OFFLINE;
    return true;
  }

  isOnline(): boolean {
    return this._status === BotStatus.ONLINE;
  }

  // ── 位置 ──

  getPos(): BotPosition {
    return this._pos;
  }

  setPos(x: number, y: number, z: number, dimid: number): void {
    this._pos.x = x;
    this._pos.y = y;
    this._pos.z = z;
    this._pos.dimid = dimid;
  }

  updatePos(): void {
    const pl = this.getPlayer();
    if (pl) {
      const pos = getEntityFeetPos(pl);
      this.setPos(pos.x, pos.y, pos.z, pos.dimid);
    }
  }

  // ── 方向 ──

  getDirection(): number {
    return this._direction;
  }

  setDirection(dir: number, applyNow: boolean = true): void {
    this._direction = dir;
    if (applyNow) this.applyDirection();
  }

  updateDirection(): void {
    const pl = this.getPlayer();
    if (pl) {
      this._direction = pl.direction.yaw;
    }
  }

  applyDirection(): void {
    const pl = this.getPlayer();
    if (pl) {
      pl.simulateSetBodyRotation(this._direction);
    }
  }

  // ── 游戏模式 ──

  getGameMode(): number {
    return this._gameMode;
  }

  setGameMode(mode: number, applyNow: boolean = true): void {
    this._gameMode = mode;
    if (applyNow) this.applyGameMode();
  }

  updateGameMode(): void {
    const pl = this.getPlayer();
    if (pl) {
      this._gameMode = pl.gameMode;
    }
  }

  applyGameMode(): void {
    const pl = this.getPlayer();
    if (pl) {
      pl.setGameMode(this._gameMode);
    }
  }

  // ── 所有者 ──

  getOwner(): string {
    return this._owner;
  }

  setOwner(owner: string): void {
    this._owner = owner;
  }

  // ── 操作循环 ──

  private static opCallback(instance: BotInstance): () => void {
    return () => {
      if (instance._operation === '' || !instance.isOnline()) return;

      const pl = instance.getPlayer();
      if (!pl) return;

      const isLong = LONG_OPERATIONS.includes(instance._operation);

      switch (instance._operation) {
        case BotOperation.ATTACK:
          pl.simulateAttack();
          break;
        case BotOperation.DESTROY:
          pl.simulateDestroy();
          break;
        case BotOperation.INTERACT:
          pl.simulateInteract();
          break;
        case BotOperation.USE_ITEM:
          pl.simulateUseItem();
          break;
      }

      if (isLong) {
        // 长操作：持续执行后再停止
        instance._opTimer = setTimeout(
          BotInstance.opReachLength(instance),
          instance._opLength,
        );
      } else {
        // 短操作：检查次数，继续下一轮
        if (instance._opMaxTimes > 0) {
          instance._opMaxTimes--;
          if (instance._opMaxTimes === 0) {
            instance.clearOperation();
            return;
          }
        }
        instance._opTimer = setTimeout(
          BotInstance.opCallback(instance),
          instance._opInterval,
        );
      }
    };
  }

  private static opReachLength(instance: BotInstance): () => void {
    return () => {
      if (instance._operation === '' || !instance.isOnline()) return;

      const pl = instance.getPlayer();
      if (!pl) return;

      switch (instance._operation) {
        case BotOperation.USE_ITEM:
          pl.simulateStopUsingItem();
          break;
      }

      if (instance._opMaxTimes > 0) {
        instance._opMaxTimes--;
        if (instance._opMaxTimes === 0) {
          instance.clearOperation();
          return;
        }
      }

      instance._opTimer = setTimeout(
        BotInstance.opCallback(instance),
        instance._opInterval,
      );
    };
  }

  startOperationLoop(): void {
    BotInstance.opCallback(this)();
  }

  stopOperationLoop(): void {
    if (this._opTimer) {
      clearTimeout(this._opTimer);
      this._opTimer = null;
    }
  }

  setShortOperation(
    operation: string,
    opInterval: number = 1000,
    opMaxTimes: number = 1,
  ): void {
    this.stopOperationLoop();
    this._operation = operation;
    this._opInterval = opInterval;
    this._opMaxTimes = opMaxTimes;
    this.startOperationLoop();
    BotManager.saveData(this.name);
  }

  setLongOperation(
    operation: string,
    opInterval: number = 1000,
    opMaxTimes: number = 1,
    opLength: number = 1000,
  ): void {
    this.stopOperationLoop();
    this._operation = operation;
    this._opInterval = opInterval;
    this._opMaxTimes = opMaxTimes;
    this._opLength = opLength;
    this.startOperationLoop();
    BotManager.saveData(this.name);
  }

  clearOperation(): void {
    this.stopOperationLoop();
    const pl = this.getPlayer();
    if (pl) {
      switch (this._operation) {
        case BotOperation.DESTROY:
          pl.simulateStopDestroyingBlock();
          break;
        case BotOperation.INTERACT:
          pl.simulateStopInteracting();
          break;
        case BotOperation.USE_ITEM:
          pl.simulateStopUsingItem();
          break;
      }
    }
    this._operation = '';
    BotManager.saveData(this.name);
  }

  // ── 玩家同步 ──

  startSync(targetXuid: string): void {
    this._syncTarget = targetXuid;
  }

  stopSync(): void {
    this._syncTarget = '';
    this._lastSyncPos = null;
  }

  isNeedTick(): boolean {
    return this._syncTarget !== '';
  }

  tickLoop(): void {
    if (this._syncTarget === '') return;

    const pl = this.getPlayer();
    if (!pl) return;

    const targetPlayer = mc.getPlayer(this._syncTarget);
    if (!targetPlayer) return;

    // 同步移动
    let isMoving = false;
    if (!this._lastSyncPos) {
      this._lastSyncPos = getEntityFeetPos(targetPlayer);
    } else {
      const oldPos = this._lastSyncPos;
      const newPos = getEntityFeetPos(targetPlayer);

      if (oldPos.dimid !== newPos.dimid) {
        // 跨维度传送
        this._pos.x = newPos.x;
        this._pos.y = newPos.y;
        this._pos.z = newPos.z;
        this._pos.dimid = newPos.dimid;
        pl.teleport(newPos);
        this._lastSyncPos = newPos;
        isMoving = true;
      } else {
        const dx = newPos.x - oldPos.x;
        const dy = newPos.y - oldPos.y;
        const dz = newPos.z - oldPos.z;

        if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1 && Math.abs(dz) < 0.1) {
          pl.simulateStopMoving();
        } else {
          this._pos.x += dx;
          this._pos.y += dy;
          this._pos.z += dz;
          this._pos.dimid = newPos.dimid;
          pl.simulateMoveTo(
            new FloatPos(this._pos.x, this._pos.y, this._pos.z, this._pos.dimid),
          );
          this._lastSyncPos = newPos;
          isMoving = true;
        }
      }
    }

    // 未移动时同步视角
    if (!isMoving) {
      const dir = targetPlayer.direction.yaw;
      this.setDirection(dir, false);
      pl.simulateSetBodyRotation(dir);

      const targetEntity = targetPlayer.getEntityFromViewVector();
      if (targetEntity) {
        pl.simulateLookAt(targetEntity);
      } else {
        const targetBlock = targetPlayer.getBlockFromViewVector();
        if (targetBlock) {
          pl.simulateLookAt(targetBlock);
        }
      }
    }
  }

  // ── 死亡频率检测 ──

  increaseDeathCount(): boolean {
    this._deathCount++;
    if (this._deathCount > DEATH_COUNTER_THRESHOLD) {
      // 清理所有计时器
      this._deathTimers.forEach((t) => clearTimeout(t));
      this._deathTimers = [];
      this._deathCount = 0;
      return true;
    }
    this._deathTimers.push(
      setTimeout(() => {
        this._deathCount--;
      }, DEATH_COUNTER_WINDOW_MS),
    );
    return false;
  }

  // ── 序列化 ──

  serialize(): BotData {
    return {
      _version: 1,
      name: this.name,
      pos: this._pos,
      direction: this._direction,
      gameMode: this._gameMode,
      owner: this._owner,
      isOnline: this.isOnline(),
      operation: this._operation,
      opInterval: this._opInterval,
      opMaxTimes: this._opMaxTimes,
      opLength: this._opLength,
      syncTarget: this._syncTarget,
    };
  }

  static deserialize(name: string, data: BotData): BotInstance {
    if (name !== data.name) {
      throw new Error('Bot data name mismatch');
    }
    return new BotInstance(
      data.name,
      data.pos,
      data.operation,
      data.opInterval,
      data.opMaxTimes,
      data.opLength,
      data.syncTarget,
      data.isOnline,
      data.owner,
      data.direction,
      data.gameMode,
    );
  }

  // ── NBT 物品序列化 ──

  serializeInventory(): string | null {
    const pl = this.getPlayer();
    if (!pl) return null;

    const compound = new NbtCompound();
    const plNbt = pl.getNbt();

    compound.setTag('Inventory', plNbt.getTag('Inventory'));
    compound.setTag('Armor', plNbt.getTag('Armor'));
    compound.setTag('Offhand', plNbt.getTag('Offhand'));

    const snbt = compound.toSNBT();
    compound.removeTag('Inventory').removeTag('Armor').removeTag('Offhand').destroy();
    return snbt;
  }

  deserializeInventory(snbt: string): boolean {
    const pl = this.getPlayer();
    if (!pl) return false;

    const compound = NBT.parseSNBT(snbt);
    if (!compound) return false;

    const plNbt = pl.getNbt();
    plNbt.setTag('Inventory', compound.getTag('Inventory'));
    plNbt.setTag('Armor', compound.getTag('Armor'));
    plNbt.setTag('Offhand', compound.getTag('Offhand'));

    const result = pl.setNbt(plNbt);
    compound.removeTag('Inventory').removeTag('Armor').removeTag('Offhand').destroy();
    return result;
  }

  // ── 查询 ──

  getPlayer(): Player | null {
    const pl = mc.getPlayer(this.name);
    if (!pl || !pl.isSimulatedPlayer()) return null;
    return pl;
  }

  getInfo(): BotInfo {
    return {
      name: this.name,
      pos: this._pos,
      direction: this._direction,
      gameMode: this._gameMode,
      isOnline: this.isOnline(),
      owner: this._owner,
      operation: this._operation,
      opInterval: this._opInterval,
      opMaxTimes: this._opMaxTimes,
      opLength: this._opLength,
      syncTarget: this._syncTarget,
    };
  }
}