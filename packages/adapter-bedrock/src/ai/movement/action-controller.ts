/**
 * 动作控制器
 *
 * 将高层移动指令转换为 LLSE 玩家模拟 API 调用。
 * 实现时以 LeviLamina/LLSE 实际 API 为准，缺失的 API 会安全降级。
 */

import type { Vec3 } from '../pathfinding/types.js';
import type { IActionController } from './types.js';

export class ActionController implements IActionController {
  private player: any;

  constructor(player: any) {
    this.player = player;
  }

  /**
   * 移动到指定坐标
   */
  async moveTo(pos: Vec3, speed: number): Promise<boolean> {
    if (!this.ensurePlayer()) return false;
    try {
      const fp = new FloatPos(pos.x, pos.y, pos.z, this.player.pos.dimid);

      // 优先使用 simulateMoveTo，回退到 simulateNavigateTo
      if (typeof this.player.simulateMoveTo === 'function') {
        return !!this.player.simulateMoveTo(fp);
      }

      if (typeof this.player.simulateNavigateTo === 'function') {
        const res = this.player.simulateNavigateTo(fp);
        return !!res;
      }

      return false;
    } catch (e) {
      logger.warn('[ActionController] moveTo 失败', e);
      return false;
    }
  }

  /**
   * 设置疾跑状态
   */
  sprint(enabled: boolean): boolean {
    if (!this.ensurePlayer()) return false;
    try {
      if (typeof this.player.simulateSprint === 'function') {
        return !!this.player.simulateSprint(enabled);
      }
      if (typeof this.player.sprinting !== 'undefined') {
        this.player.sprinting = enabled;
        return true;
      }
      return false;
    } catch (e) {
      logger.warn('[ActionController] sprint 失败', e);
      return false;
    }
  }

  /**
   * 跳跃
   */
  jump(): boolean {
    if (!this.ensurePlayer()) return false;
    try {
      if (typeof this.player.simulateJump === 'function') {
        return !!this.player.simulateJump();
      }
      return false;
    } catch (e) {
      logger.warn('[ActionController] jump 失败', e);
      return false;
    }
  }

  /**
   * 看向指定坐标
   */
  lookAt(pos: Vec3): boolean {
    if (!this.ensurePlayer()) return false;
    try {
      const dx = pos.x - this.player.pos.x;
      const dy = pos.y - (this.player.pos.y - 1.62);
      const dz = pos.z - this.player.pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const yaw = Math.atan2(dz, dx) * (180 / Math.PI) - 90;
      const pitch = -Math.atan2(dy, dist) * (180 / Math.PI);

      if (typeof this.player.simulateLookAt === 'function') {
        return !!this.player.simulateLookAt(new FloatPos(pos.x, pos.y, pos.z, this.player.pos.dimid));
      }
      if (typeof this.player.setRot === 'function') {
        this.player.setRot(yaw, pitch);
        return true;
      }
      if (typeof this.player.teleport === 'function') {
        this.player.teleport(this.player.pos, yaw, pitch);
        return true;
      }
      return false;
    } catch (e) {
      logger.warn('[ActionController] lookAt 失败', e);
      return false;
    }
  }

  /**
   * 停止移动
   */
  stopMoving(): void {
    if (!this.ensurePlayer()) return;
    try {
      if (typeof this.player.simulateStopMoving === 'function') {
        this.player.simulateStopMoving();
      }
      this.sprint(false);
    } catch (e) {
      logger.warn('[ActionController] stopMoving 失败', e);
    }
  }

  /**
   * 破坏方块
   */
  async breakBlock(pos: Vec3, toolName?: string): Promise<boolean> {
    if (!this.ensurePlayer()) return false;
    try {
      // 切到工具
      if (toolName) {
        this.selectItem(toolName);
      }

      const fp = new FloatPos(pos.x, pos.y, pos.z, this.player.pos.dimid);

      if (typeof this.player.simulateDestroy === 'function') {
        return !!this.player.simulateDestroy(fp);
      }
      if (typeof this.player.simulateStartDestroyingBlock === 'function') {
        return !!this.player.simulateStartDestroyingBlock(fp);
      }
      return false;
    } catch (e) {
      logger.warn('[ActionController] breakBlock 失败', e);
      return false;
    }
  }

  /**
   * 放置方块
   */
  async placeBlock(pos: Vec3, blockName: string, face?: Vec3): Promise<boolean> {
    if (!this.ensurePlayer()) return false;
    try {
      // 切到方块
      this.selectItem(blockName);

      const dimid = this.player.pos.dimid;
      const targetFp = new FloatPos(pos.x, pos.y, pos.z, dimid);
      const faceFp = face
        ? new FloatPos(pos.x + face.x, pos.y + face.y, pos.z + face.z, dimid)
        : new FloatPos(pos.x, pos.y - 1, pos.z, dimid);

      if (typeof this.player.simulateUseItemOnBlock === 'function') {
        return !!this.player.simulateUseItemOnBlock(targetFp, faceFp);
      }
      if (typeof this.player.simulateUseItem === 'function') {
        return !!this.player.simulateUseItem();
      }
      return false;
    } catch (e) {
      logger.warn('[ActionController] placeBlock 失败', e);
      return false;
    }
  }

  /**
   * 使用烟花火箭
   */
  useFirework(): boolean {
    if (!this.ensurePlayer()) return false;
    try {
      this.selectItem('firework_rocket');
      if (typeof this.player.simulateUseItem === 'function') {
        return !!this.player.simulateUseItem();
      }
      return false;
    } catch (e) {
      logger.warn('[ActionController] useFirework 失败', e);
      return false;
    }
  }

  /**
   * 开始滑翔（需要已装备鞘翅并处于空中）
   */
  startGliding(): boolean {
    if (!this.ensurePlayer()) return false;
    try {
      // LLSE 可能没有直接 API，尝试模拟跳跃+使用烟花
      this.jump();
      return true;
    } catch (e) {
      logger.warn('[ActionController] startGliding 失败', e);
      return false;
    }
  }

  /**
   * 停止滑翔
   */
  stopGliding(): boolean {
    if (!this.ensurePlayer()) return false;
    try {
      // 通常落地自动停止
      return true;
    } catch (e) {
      logger.warn('[ActionController] stopGliding 失败', e);
      return false;
    }
  }

  /**
   * 选择物品栏位
   */
  selectSlot(slot: number): boolean {
    if (!this.ensurePlayer()) return false;
    try {
      if (typeof this.player.setSelectedSlot === 'function') {
        return !!this.player.setSelectedSlot(slot);
      }
      return false;
    } catch (e) {
      logger.warn('[ActionController] selectSlot 失败', e);
      return false;
    }
  }

  /**
   * 获取当前选中栏位
   */
  getSelectedSlot(): number {
    if (!this.ensurePlayer()) return 0;
    try {
      return this.player.selectedSlot ?? 0;
    } catch (e) {
      return 0;
    }
  }

  /**
   * 在背包中选择指定物品（优先主手）
   */
  selectItem(name: string): boolean {
    if (!this.ensurePlayer()) return false;
    try {
      const inv = this.player.getInventory();
      const size = inv.size ?? 36;
      for (let i = 0; i < size; i++) {
        const item = inv.getItem(i);
        if (item && !item.isNull() && item.name === name) {
          return this.selectSlot(i);
        }
      }
      return false;
    } catch (e) {
      logger.warn('[ActionController] selectItem 失败', e);
      return false;
    }
  }

  private ensurePlayer(): boolean {
    if (!this.player) return false;
    if (typeof this.player.isOnline === 'function' && !this.player.isOnline()) return false;
    return true;
  }
}
