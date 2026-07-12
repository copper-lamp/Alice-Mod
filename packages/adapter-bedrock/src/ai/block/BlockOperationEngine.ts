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
import { ToolSelector } from './ToolSelector.js';
import { BlockValidator } from './BlockValidator.js';
import { AreaPlanner } from './AreaPlanner.js';
import { InventoryEngine, normalizeName } from '../inventory/InventoryEngine.js';
import { aiEngine } from '../index.js';
import { configManager } from '../../config/index.js';
import { BotManager } from '../../bot/BotManager.js';
import { waitFor } from '../../utils/helpers.js';

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

    // 1. 移动靠近
    const approachPos = this.computeApproachPos(pos, 5);
    const moveResult = await aiEngine.moveTo(this.botName, approachPos);
    if (!moveResult.success) {
      return { success: false, error: moveResult.reason, duration_ms: Date.now() - start };
    }

    // 2. 获取方块
    const block = this.safeGetBlock(pos);
    const blockName = block ? normalizeName(block.name) : 'air';

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
      this.inventoryEngine.selectSlot(toolRec.toolSlot);
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

    // 5. 看向方块并执行挖掘
    this.lookAt(pos);
    this.player.simulateDestroyBlock(pos);

    // 6. 等待方块破坏（轮询校验）
    const broken = await waitFor(() => this.blockValidator.confirmBroken(pos, this.world), 15000, 100);

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
  async placeBlock(pos: Vec3, blockName: string): Promise<PlaceResult> {
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

    // 2. 移动靠近
    const approachPos = this.computeApproachPos(pos, 3);
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

    // 4. 放置
    this.inventoryEngine.selectSlot(slot.slot);
    this.lookAt(face.neighbor);
    this.player.simulatePlaceBlock(pos, face.face);

    // 5. 验证
    await this.sleep(100);
    const placed = this.blockValidator.confirmPlaced(pos, this.world, material);

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
    const blockName = block ? normalizeName(block.name) : 'air';

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
      if (typeof this.player.lookAt === 'function') {
        this.player.lookAt(new FloatPos(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5, this.player.pos?.dimid ?? 0));
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
