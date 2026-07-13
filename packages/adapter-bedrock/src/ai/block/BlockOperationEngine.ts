/**
 * V6 方块操作引擎 — 核心引擎
 *
 * 统一封装 mineBlock / placeBlock / useBlock / areaOperation 四种方块操作。
 */

import type { Vec3 } from '../pathfinding/types.js';
import type {
  AreaMode,
  AreaResult,
  BlockOperationEngineOptions,
  MineResult,
  PlaceResult,
  UseBlockResult,
} from './types.js';

import { configManager } from '../../config/index.js';
import { BotManager } from '../../bot/BotManager.js';
import { waitFor } from '../../utils/helpers.js';
import { InventoryEngine, normalizeName } from '../inventory/InventoryEngine.js';
import { aiEngine } from '../index.js';
import { ToolSelector } from './ToolSelector.js';
import { BlockValidator } from './BlockValidator.js';
import { AreaPlanner } from './AreaPlanner.js';

/**
 * 获取方块内部类型标识（优先 type，避免 name 被本地化）
 */
function getBlockType(block: any): string {
  return normalizeName(block?.type || block?.name || 'air');
}

/** 操作超时时间（毫秒） */
const OPERATION_TIMEOUT_MS = 120000;

export class BlockOperationEngine {
  private player: any;
  private botName: string;
  private inventoryEngine: InventoryEngine;
  private world: any;
  private toolSelector: ToolSelector;
  private blockValidator: BlockValidator;
  private areaPlanner: AreaPlanner;

  constructor(options: BlockOperationEngineOptions) {
    this.player = options.player;
    this.botName = options.botName;
    this.inventoryEngine = options.inventoryEngine;
    this.world = options.world;
    this.toolSelector = new ToolSelector();
    this.blockValidator = new BlockValidator();
    this.areaPlanner = new AreaPlanner(this.world);
  }

  /**
   * 挖掘指定坐标方块
   */
  async mineBlock(pos: Vec3): Promise<MineResult> {
    const start = Date.now();

    // 1. 移动靠近（保持在 3 格内以便挖掘）
    const approachPos = this.computeApproachPos(pos, 3);
    const moveResult = await aiEngine.moveTo(this.botName, approachPos);
    if (!moveResult.success) {
      return { success: false, error: moveResult.reason, duration_ms: Date.now() - start };
    }

    // 2. 获取方块
    const block = this.safeGetBlock(pos);
    const blockName = getBlockType(block);

    if (blockName === 'air') {
      return { success: true, block: 'air', drops: [], duration_ms: 0 };
    }

    if (this.toolSelector.isUnbreakable(blockName)) {
      return { success: false, error: 'BLOCK_UNBREAKABLE', duration_ms: Date.now() - start };
    }

    // 3. 选择工具
    const inventory = this.inventoryEngine.list();
    let toolRec = this.toolSelector.selectToolForBlock(blockName, inventory);

    if (!toolRec.canHandMine && toolRec.toolSlot === null) {
      return { success: false, error: 'NO_SUITABLE_TOOL', duration_ms: Date.now() - start };
    }

    // 4. 耐久检查与切换
    if (toolRec.toolSlot !== null) {
      const slotOk = this.inventoryEngine.selectSlot(toolRec.toolSlot);
      if (!slotOk) {
        logger.warn(`[BlockOperationEngine] 选择工具槽位 ${toolRec.toolSlot} 失败`);
      }
      const selectedItem = this.inventoryEngine.getSelectedItem();
      if (selectedItem) {
        const damage = this.inventoryEngine.getItemDamage(selectedItem);
        const maxDamage = this.inventoryEngine.getItemMaxDamage(selectedItem);
        const threshold = configManager.block.tool_durability_threshold;
        if (maxDamage > 0 && damage + threshold >= maxDamage) {
          const alt = this.toolSelector.findAlternativeTool(blockName, inventory, toolRec.toolSlot);
          if (alt) {
            this.inventoryEngine.selectSlot(alt.slot);
            toolRec = { ...toolRec, toolSlot: alt.slot, toolName: alt.name };
          } else {
            return { success: false, error: 'TOOL_DURABILITY_LOW', duration_ms: Date.now() - start };
          }
        }
      }
    }

    // 5. 看向方块并持续执行挖掘，直到方块被破坏或超时
    this.lookAt(pos);
    await this.sleep(250); // 等视角同步
    const mineStart = Date.now();
    const maxMineMs = 15000;
    const dimid = this.player.pos?.dimid ?? 0;
    const blockFp = new FloatPos(pos.x, pos.y, pos.z, dimid);

    try {
      // LLSE simulateDestroy 需要每 tick 持续调用才会持续破坏方块。
      // 参考 FakePlayer 实现：在循环中不断调用 simulateDestroy，直到方块破坏。
      while (Date.now() - mineStart < maxMineMs) {
        if (this.blockValidator.confirmBroken(pos, this.world)) break;

        if (typeof this.player.simulateDestroy === 'function') {
          // 优先无参数版本：破坏视线前方方块
          this.player.simulateDestroy();
        } else if (typeof this.player.simulateDestroyBlock === 'function') {
          this.player.simulateDestroyBlock(pos);
        }

        await this.sleep(100);
      }

      // 若仍未破坏，尝试带 FloatPos 参数版本（部分 LLSE 版本需要传入目标坐标）
      if (!this.blockValidator.confirmBroken(pos, this.world)) {
        while (Date.now() - mineStart < maxMineMs) {
          if (this.blockValidator.confirmBroken(pos, this.world)) break;
          if (typeof this.player.simulateDestroy === 'function') {
            try {
              this.player.simulateDestroy(blockFp);
            } catch (e) {
              this.player.simulateDestroy();
            }
          } else if (typeof this.player.simulateDestroyBlock === 'function') {
            this.player.simulateDestroyBlock(pos);
          }
          await this.sleep(100);
        }
      }
    } catch (e) {
      logger.warn('[BlockOperationEngine] 挖掘调用失败', e);
    }

    // 6. 等待方块破坏（轮询校验），失败时使用命令兜底
    let broken = this.blockValidator.confirmBroken(pos, this.world);
    if (!broken) {
      try {
        const cmd = `setblock ${pos.x} ${pos.y} ${pos.z} air destroy`;
        if (this.runServerCommand(cmd)) {
          logger.warn(`[BlockOperationEngine] 模拟挖掘未生效，使用命令兜底: ${cmd}`);
          await this.sleep(200);
          broken = this.blockValidator.confirmBroken(pos, this.world);
        }
      } catch (e) {
        // ignore
      }
    }

    // 7. 保存背包
    BotManager.saveInventory(this.botName);

    return {
      success: broken,
      block: blockName,
      drops: [],
      tool_damage: 1,
      duration_ms: Date.now() - start,
      error: broken ? undefined : 'OPERATION_TIMEOUT',
    };
  }

  /**
   * 在指定坐标放置方块
   */
  async placeBlock(pos: Vec3, blockName: string, facing?: string): Promise<PlaceResult> {
    const start = Date.now();

    // 1. 材料检查与替代
    let material = normalizeName(blockName);
    let slot = this.inventoryEngine.find(material);

    if (!slot && configManager.block.allow_alternative_materials) {
      const alt = this.toolSelector.selectAlternativeBlock(material, this.inventoryEngine.list());
      if (alt) {
        material = alt;
        slot = this.inventoryEngine.find(material);
      }
    }

    if (!slot) {
      return { success: false, error: 'ITEM_NOT_FOUND', duration_ms: Date.now() - start };
    }

    // 2. 移动靠近（保持 2 格内以便放置）
    const approachPos = this.computeApproachPos(pos, 2);
    const moveResult = await aiEngine.moveTo(this.botName, approachPos);
    if (!moveResult.success) {
      return { success: false, error: moveResult.reason, duration_ms: Date.now() - start };
    }

    // 3. 邻接面选择
    const playerPos = this.player.pos;
    const face = this.blockValidator.findPlacementFace(pos, this.world, playerPos);
    if (!face) {
      return { success: false, error: 'PLACE_BLOCKED', duration_ms: Date.now() - start };
    }

    // 4. 切换到方块
    const slotOk = this.inventoryEngine.selectSlot(slot.slot);
    if (!slotOk) {
      logger.warn(`[BlockOperationEngine] 选择方块槽位 ${slot.slot} 失败`);
    }

    // 计算放置面中心（视线应落在邻接方块的面上），而不是邻接方块中心。
    // 否则看向箱子等可交互方块时 simulateUseItem 会打开容器。
    const faceCenter = {
      x: pos.x + 0.5 + face.face.x * 0.5,
      y: pos.y + 0.5 + face.face.y * 0.5,
      z: pos.z + 0.5 + face.face.z * 0.5,
    };
    this.lookAt(faceCenter);
    // 给 LLSE 一帧时间应用视角
    await this.sleep(200);

    let placed = false;
    const dimid = this.player.pos?.dimid ?? 0;
    const placeStart = Date.now();
    const maxPlaceMs = 5000;
    try {
      while (Date.now() - placeStart < maxPlaceMs) {
        // LLSE 实际 API：simulateUseItemOnBlock(targetPos, clickBlockPos)
        // targetPos 是要放置方块的位置，clickBlockPos 是被点击的邻接方块。
        if (typeof this.player.simulateUseItemOnBlock === 'function') {
          const targetFp = new FloatPos(pos.x, pos.y, pos.z, dimid);
          const faceFp = new FloatPos(face.neighbor.x, face.neighbor.y, face.neighbor.z, dimid);
          this.player.simulateUseItemOnBlock(targetFp, faceFp);
        } else if (typeof this.player.simulateUseItem === 'function') {
          this.player.simulateUseItem();
        }

        await this.sleep(100);
        if (this.blockValidator.confirmPlaced(pos, this.world, material)) {
          placed = true;
          break;
        }
      }
    } catch (e) {
      logger.warn('[BlockOperationEngine] 放置调用失败', e);
    }

    // 5. 验证，若模拟放置未成功则使用命令兜底
    if (!placed) {
      placed = this.blockValidator.confirmPlaced(pos, this.world, material);
    }
    if (!placed) {
      try {
        const cmd = `setblock ${pos.x} ${pos.y} ${pos.z} ${material}`;
        if (this.runServerCommand(cmd)) {
          logger.warn(`[BlockOperationEngine] 模拟放置未生效，使用命令兜底: ${cmd}`);
          await this.sleep(200);
          placed = this.blockValidator.confirmPlaced(pos, this.world, material);
        }
      } catch (e) {
        // ignore
      }
    }

    // 6. 保存背包
    BotManager.saveInventory(this.botName);

    return {
      success: placed,
      block: material,
      position: pos,
      duration_ms: Date.now() - start,
      error: placed ? undefined : 'PLACE_BLOCKED',
    };
  }

  /**
   * 右键使用方块
   */
  async useBlock(pos: Vec3): Promise<UseBlockResult> {
    const start = Date.now();

    // 1. 移动靠近
    const approachPos = this.computeApproachPos(pos, 3);
    const moveResult = await aiEngine.moveTo(this.botName, approachPos);
    if (!moveResult.success) {
      return { success: false, error: moveResult.reason, duration_ms: Date.now() - start };
    }

    // 2. 获取方块
    const block = this.safeGetBlock(pos);
    const blockName = getBlockType(block);

    if (blockName === 'air') {
      return { success: false, error: 'PLACE_BLOCKED', duration_ms: Date.now() - start };
    }

    // 3. 看向方块并交互
    this.lookAt(pos);
    this.player.simulateInteract();

    BotManager.saveInventory(this.botName);

    return {
      success: true,
      block: blockName,
      duration_ms: Date.now() - start,
    };
  }

  /**
   * 区域操作
   */
  async areaOperation(
    mode: AreaMode,
    from: Vec3,
    to?: Vec3,
    blockName?: string,
    radius?: number,
  ): Promise<AreaResult> {
    const start = Date.now();

    // 1. 生成队列
    const queue = this.areaPlanner.buildQueue(mode, from, to, blockName, radius);
    const volumeCheck = this.areaPlanner.checkVolumeLimit(queue.length);

    if (!volumeCheck.ok) {
      return {
        success: false,
        error: 'AREA_TOO_LARGE',
        mode,
        total_blocks: queue.length,
        success_count: 0,
        fail_count: 0,
        duration_ms: Date.now() - start,
      };
    }

    if (mode === 'vein' && queue.length >= volumeCheck.max) {
      return {
        success: false,
        error: 'VEIN_TOO_LARGE',
        mode,
        total_blocks: queue.length,
        success_count: 0,
        fail_count: 0,
        duration_ms: Date.now() - start,
      };
    }

    let successCount = 0;
    let failCount = 0;
    const drops: Record<string, number> = {};

    for (let i = 0; i < queue.length; i++) {
      const pos = queue[i];
      let result: MineResult | PlaceResult;

      if (mode === 'fill') {
        if (!blockName) {
          failCount++;
          continue;
        }
        result = await this.placeBlock(pos, blockName);
      } else {
        result = await this.mineBlock(pos);
        if (mode === 'break' && result.success && result.block) {
          this.mergeDrops(drops, this.estimateDrops(result.block));
        }
      }

      if (result.success) {
        successCount++;
      } else {
        failCount++;
      }

      // 每 8 个操作 yield 一次，避免 tick 阻塞
      if ((i + 1) % 8 === 0) {
        await this.sleep(0);
      }

      // 超时检查
      if (Date.now() - start > OPERATION_TIMEOUT_MS) {
        return {
          success: false,
          error: 'OPERATION_TIMEOUT',
          mode,
          total_blocks: queue.length,
          success_count: successCount,
          fail_count: failCount,
          drops,
          duration_ms: Date.now() - start,
        };
      }
    }

    return {
      success: failCount === 0,
      mode,
      total_blocks: queue.length,
      success_count: successCount,
      fail_count: failCount,
      drops,
      duration_ms: Date.now() - start,
      error: failCount === 0 ? undefined : `部分方块操作失败: ${failCount}/${queue.length}`,
    };
  }

  /**
   * 计算玩家应移动到的目标位置，使其与方块保持指定距离
   */
  private computeApproachPos(target: Vec3, distance: number): Vec3 {
    const playerPos = this.player.pos;
    if (!playerPos) return target;

    const dx = playerPos.x - (target.x + 0.5);
    const dy = playerPos.y - (target.y + 0.5);
    const dz = playerPos.z - (target.z + 0.5);
    const horizontal = Math.sqrt(dx * dx + dz * dz);

    if (horizontal <= distance) {
      return {
        x: playerPos.x,
        y: playerPos.y,
        z: playerPos.z,
      };
    }

    const ratio = distance / horizontal;
    return {
      x: target.x + 0.5 + dx * ratio,
      y: target.y + 0.5 + dy * Math.min(ratio, 1),
      z: target.z + 0.5 + dz * ratio,
    };
  }

  /**
   * 安全读取世界方块
   */
  private safeGetBlock(pos: Vec3): any | null {
    try {
      if (this.world && typeof this.world.getBlock === 'function') {
        return this.world.getBlock(pos.x, pos.y, pos.z);
      }
      return mc.getBlock(pos.x, pos.y, pos.z, 0);
    } catch (e) {
      return null;
    }
  }

  /**
   * 让玩家看向指定方块中心
   */
  private lookAt(pos: Vec3): void {
    try {
      const target = new FloatPos(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5, this.player.pos?.dimid ?? 0);
      if (typeof this.player.simulateLookAt === 'function') {
        this.player.simulateLookAt(target);
      } else if (typeof this.player.lookAt === 'function') {
        this.player.lookAt(target);
      }
    } catch (e) {
      // 忽略看向失败
    }
  }

  /**
   * 非阻塞休眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 以玩家上下文优先执行服务器命令。
   */
  private runServerCommand(cmd: string): boolean {
    try {
      if (typeof this.player.runCmd === 'function') {
        const ok = this.player.runCmd(cmd);
        if (ok) return true;
      }
    } catch (e) {
      // ignore
    }

    try {
      const api = mc as any;
      if (typeof api.runCmd === 'function') {
        return api.runCmd(cmd);
      }
      if (typeof api.runcmdEx === 'function') {
        const res = api.runcmdEx(cmd);
        return res?.success ?? false;
      }
      if (typeof api.runcmd === 'function') {
        api.runcmd(cmd);
        return true;
      }
    } catch (e) {
      // ignore
    }
    return false;
  }

  /**
   * 合并掉落物统计
   */
  private mergeDrops(target: Record<string, number>, source: Record<string, number>): void {
    for (const [name, count] of Object.entries(source)) {
      target[name] = (target[name] ?? 0) + count;
    }
  }

  /**
   * 估算方块掉落物（简化版本）
   */
  private estimateDrops(blockName: string): Record<string, number> {
    const normalized = normalizeName(blockName);

    if (normalized === 'stone') return { cobblestone: 1 };
    if (normalized === 'deepslate') return { cobbled_deepslate: 1 };
    if (normalized === 'grass_block' || normalized === 'dirt') return { dirt: 1 };
    if (normalized === 'sand') return { sand: 1 };
    if (normalized === 'gravel') return { gravel: 1 };
    if (/_ore$/.test(normalized)) {
      // 简化：矿石掉落自身或对应矿物
      return { [normalized]: 1 };
    }
    if (/_log$/.test(normalized)) {
      return { [normalized]: 1 };
    }

    return { [normalized]: 1 };
  }
}
