/**
 * 为人类测试者生成常用工具的推荐默认参数。
 * 基于目标假人（而不是人类玩家）的环境：位置、视角、背包、周围方块。
 */

import type { ToolMetadata } from '../registry/tool-module.types.js';
import { TestEnvironmentPreparer } from './TestEnvironmentPreparer.js';

type Vec3Like = { x: number; y: number; z: number; dimid?: number };

const CONTAINER_TYPES = new Set([
  'chest', 'trapped_chest', 'barrel', 'furnace', 'blast_furnace', 'smoker',
  'hopper', 'dropper', 'dispenser', 'brewing_stand', 'shulker_box',
]);

const INTERACTIVE_BLOCKS = new Set([
  'crafting_table', 'furnace', 'blast_furnace', 'smoker', 'chest', 'trapped_chest',
  'barrel', 'anvil', 'enchanting_table', 'door', 'trapdoor', 'lever', 'button',
  'noteblock', 'bed', 'brewing_stand', 'hopper', 'dropper', 'dispenser',
]);

const FOODS = new Set([
  'apple', 'bread', 'cooked_beef', 'cooked_chicken', 'cooked_mutton', 'cooked_porkchop',
  'cooked_rabbit', 'beef', 'chicken', 'mutton', 'porkchop', 'rabbit', 'cookie',
  'melon_slice', 'pumpkin_pie', 'carrot', 'potato', 'baked_potato', 'beetroot',
  'sweet_berries', 'golden_apple', 'enchanted_golden_apple', 'chorus_fruit',
]);

const EXCLUDED_BLOCKS = new Set([
  'air', 'cave_air', 'void_air', 'water', 'flowing_water', 'lava', 'flowing_lava',
  'bedrock', 'barrier', 'command_block', 'repeating_command_block', 'chain_command_block',
]);

export class DefaultParamProvider {
  /**
   * 根据假人玩家对象和工具元数据生成合理的默认参数。
   */
  static generate(botPlayer: Player, metadata: ToolMetadata): Record<string, unknown> {
    switch (metadata.name) {
      case 'move_to':
        return this.moveTo(botPlayer);
      case 'ride':
        return this.ride(botPlayer);
      case 'dismount':
        return {};
      case 'drop_item':
        return this.dropItem(botPlayer);
      case 'take_from_container':
        return this.takeFromContainer(botPlayer);
      case 'put_to_container':
        return this.putToContainer(botPlayer);
      case 'equip_item':
        return this.equipItem(botPlayer);
      case 'eat':
        return this.eat(botPlayer);
      case 'sleep':
        return this.sleep(botPlayer);
      case 'use_item':
        return this.useItem(botPlayer);
      case 'mine_block':
        return this.mineBlock(botPlayer);
      case 'place_block':
        return this.placeBlock(botPlayer);
      case 'use_block':
        return this.useBlock(botPlayer);
      case 'area_operation':
        return this.areaOperation(botPlayer);
      default:
        return this.fromSchema(metadata);
    }
  }

  // ==================== 各工具专用生成器 ====================

  private static moveTo(botPlayer: Player): Record<string, unknown> {
    const feet = this.getFeetPos(botPlayer);
    // 在假人脚下的 5x5 平台范围内选择同高度目标，确保可达
    const target = this.findPlatformTarget(feet, 2);
    return {
      target_type: 'coordinate',
      target,
      distance: 1,
      options: { timeout: 30000, allowSprint: true, allowSwim: true, allowTeleportFallback: true },
    };
  }

  private static ride(botPlayer: Player): Record<string, unknown> {
    const entity = this.findNearestRideableEntity(botPlayer, 8);
    if (entity) {
      return { entity_id: String(entity.uniqueId ?? entity.id ?? '') };
    }
    // 回退到环境准备器记录的可骑乘实体 ID（spawnEntity/summon 生成的船）
    const fallbackId = TestEnvironmentPreparer.lastRideableEntityId;
    if (fallbackId) {
      logger.info(`[DefaultParamProvider] 使用环境准备器记录的可骑乘实体 ID: ${fallbackId}`);
      return { entity_id: fallbackId };
    }
    return { entity_id: '' };
  }

  private static dropItem(botPlayer: Player): Record<string, unknown> {
    const hand = botPlayer.getHand();
    let itemName = '';
    if (hand && !hand.isNull()) {
      itemName = this.normalizeItemId(hand.type || hand.name);
    } else {
      const items = this.getInventoryItems(botPlayer);
      const first = items.find((it) => this.normalizeItemId(it.type || it.name) !== 'air');
      itemName = first ? this.normalizeItemId(first.type || first.name) : 'apple';
    }
    return { item_name: itemName, count: 1 };
  }

  private static takeFromContainer(botPlayer: Player): Record<string, unknown> {
    const pos = this.findNearbyBlock(botPlayer, 5, (b) => CONTAINER_TYPES.has(this.normalizeBlockId(b.type)));
    return {
      container_position: pos ?? this.offsetPos(botPlayer, 1, 0, 0),
      item_name: 'apple',
      count: 8,
    };
  }

  private static putToContainer(botPlayer: Player): Record<string, unknown> {
    const pos = this.findNearbyBlock(botPlayer, 5, (b) => CONTAINER_TYPES.has(this.normalizeBlockId(b.type)));
    const items = this.getInventoryItems(botPlayer);
    // 优先放入 dirt，避免把食物/工具都放进箱子
    const blockItem = items.find((it) => this.isBlockItem(this.normalizeItemId(it.type || it.name)));
    return {
      container_position: pos ?? this.offsetPos(botPlayer, 1, 0, 0),
      item_name: blockItem ? this.normalizeItemId(blockItem.type || blockItem.name) : 'dirt',
      count: 1,
    };
  }

  private static equipItem(botPlayer: Player): Record<string, unknown> {
    const items = this.getInventoryItems(botPlayer);
    const armor = items.find((it) => this.isArmor(this.normalizeItemId(it.type || it.name)));
    return {
      item_name: armor ? this.normalizeItemId(armor.type || armor.name) : 'leather_chestplate',
      slot: 'chest',
    };
  }

  private static eat(botPlayer: Player): Record<string, unknown> {
    const items = this.getInventoryItems(botPlayer);
    const food = items.find((it) => FOODS.has(this.normalizeItemId(it.type || it.name)));
    return { food_name: food ? this.normalizeItemId(food.type || food.name) : 'apple' };
  }

  private static sleep(botPlayer: Player): Record<string, unknown> {
    const pos = this.findNearbyBlock(botPlayer, 5, (b) => /(^|_)bed$/.test(this.normalizeBlockId(b.type)));
    if (pos) {
      logger.info(`[DefaultParamProvider] 为 sleep 工具找到床: ${pos.x},${pos.y},${pos.z}`);
    } else {
      logger.warn('[DefaultParamProvider] 未找到附近床方块');
    }
    return {
      action: 'sleep',
      wait_seconds: 0,
      bed_pos: pos ?? undefined,
    };
  }

  private static useItem(botPlayer: Player): Record<string, unknown> {
    const hand = botPlayer.getHand();
    const itemName = hand.isNull() ? 'apple' : this.normalizeItemId(hand.type || hand.name);
    return { item_name: itemName, mode: 'use' };
  }

  private static mineBlock(botPlayer: Player): Record<string, unknown> {
    const feet = this.getFeetPos(botPlayer);
    const fx = Math.floor(feet.x);
    const fy = Math.floor(feet.y);
    const fz = Math.floor(feet.z);
    const dimid = botPlayer.pos.dimid;
    const easyBlocks = ['dirt', 'grass_block', 'sand', 'gravel', 'clay'];

    // 优先使用环境准备器明确放置的可挖掘泥土
    const prepared = TestEnvironmentPreparer.preparedMineBlockPos;
    if (prepared && prepared.dimid === dimid) {
      const b = mc.getBlock(prepared.x, prepared.y, prepared.z, dimid);
      const type = b ? this.normalizeBlockId(b.type || b.name) : '';
      if (easyBlocks.includes(type)) {
        logger.info(`[DefaultParamProvider] 使用环境准备器放置的可挖掘泥土: ${prepared.x},${prepared.y},${prepared.z}`);
      } else {
        logger.warn(`[DefaultParamProvider] 准备位置 ${prepared.x},${prepared.y},${prepared.z} 当前类型为 ${type}，仍尝试挖掘`);
      }
      return { x: prepared.x, y: prepared.y, z: prepared.z };
    }

    // 优先挖掘假人同层、距离近的容易破坏方块，避免选到脚下远处方块导致移动/视角问题
    const candidates: Array<{ x: number; y: number; z: number; dist: number }> = [];
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = 0; dy <= 1; dy++) {
        for (let dz = -3; dz <= 3; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const x = fx + dx;
          const y = fy + dy;
          const z = fz + dz;
          const b = mc.getBlock(x, y, z, dimid);
          const type = b ? this.normalizeBlockId(b.type) : '';
          if (easyBlocks.includes(type)) {
            const dist = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
            candidates.push({ x, y, z, dist });
          }
        }
      }
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.dist - b.dist);
      logger.info(`[DefaultParamProvider] 选择最近可挖掘泥土: ${candidates[0].x},${candidates[0].y},${candidates[0].z}`);
      return { x: candidates[0].x, y: candidates[0].y, z: candidates[0].z };
    }

    // 兜底：挖掘脚下的平台石块（正前方地面上）
    const stoneCandidates = [
      { x: fx + 1, y: fy - 1, z: fz },
      { x: fx - 1, y: fy - 1, z: fz },
      { x: fx, y: fy - 1, z: fz + 1 },
      { x: fx, y: fy - 1, z: fz - 1 },
    ];
    for (const p of stoneCandidates) {
      const b = mc.getBlock(p.x, p.y, p.z, dimid);
      if (b && !EXCLUDED_BLOCKS.has(this.normalizeBlockId(b.type))) {
        return p;
      }
    }
    return stoneCandidates[0];
  }

  private static placeBlock(botPlayer: Player): Record<string, unknown> {
    const items = this.getInventoryItems(botPlayer);
    const blockItem = items.find((it) => this.isBlockItem(this.normalizeItemId(it.type || it.name)));
    const feet = this.getFeetPos(botPlayer);
    const dimid = botPlayer.pos.dimid;

    // 优先使用环境准备器清理出的可放置空气位置
    let target: Vec3Like | null = null;
    const prepared = TestEnvironmentPreparer.preparedPlaceBlockPos;
    if (prepared && prepared.dimid === dimid) {
      const b = mc.getBlock(prepared.x, prepared.y, prepared.z, dimid);
      if (b && this.isReplaceableForPlacement(this.normalizeBlockId(b.type))) {
        target = { x: prepared.x, y: prepared.y, z: prepared.z };
        logger.info(`[DefaultParamProvider] 使用环境准备器清理的可放置空气位置: ${prepared.x},${prepared.y},${prepared.z}`);
      }
    }

    // 否则寻找有实体邻接面的空气位置，确保 BlockValidator.findPlacementFace 能成功
    if (!target) {
      target = this.findPlaceableAirPosition(feet, dimid, 2);
    }
    if (!target) {
      target = { x: Math.floor(feet.x + 1), y: Math.floor(feet.y), z: Math.floor(feet.z) };
    }
    return {
      ...target,
      block_name: blockItem ? this.normalizeItemId(blockItem.type || blockItem.name) : 'dirt',
    };
  }

  private static useBlock(botPlayer: Player): Record<string, unknown> {
    const pos = this.findNearbyBlock(
      botPlayer,
      4,
      (b) => INTERACTIVE_BLOCKS.has(this.normalizeBlockId(b.type)) || CONTAINER_TYPES.has(this.normalizeBlockId(b.type)),
    );
    if (pos) return pos;
    const feet = this.getFeetPos(botPlayer);
    return { x: Math.floor(feet.x + 2), y: Math.floor(feet.y), z: Math.floor(feet.z) };
  }

  private static areaOperation(botPlayer: Player): Record<string, unknown> {
    const feet = this.getFeetPos(botPlayer);
    const fx = Math.floor(feet.x);
    const fy = Math.floor(feet.y);
    const fz = Math.floor(feet.z);
    const dimid = botPlayer.pos.dimid;
    // 使用 fill 模式放置少量 dirt，避免 clear 挖石头耗时且依赖镐子
    // 优先使用环境准备器清理出的可放置空气位置
    let start: Vec3Like | null = null;
    const prepared = TestEnvironmentPreparer.preparedPlaceBlockPos;
    if (prepared && prepared.dimid === dimid) {
      const b = mc.getBlock(prepared.x, prepared.y, prepared.z, dimid);
      if (b && this.isReplaceableForPlacement(this.normalizeBlockId(b.type))) {
        start = { x: prepared.x, y: prepared.y, z: prepared.z };
        logger.info(`[DefaultParamProvider] area_operation 使用环境准备器清理的可放置空气位置: ${prepared.x},${prepared.y},${prepared.z}`);
      }
    }
    // 否则寻找有实体邻接面的空气位置作为填充起点
    if (!start) {
      start = this.findPlaceableAirPosition(feet, dimid, 2);
    }
    if (!start) {
      start = { x: fx + 1, y: fy, z: fz };
    }
    return {
      mode: 'fill',
      from: start,
      to: start,
      block_name: 'dirt',
    };
  }

  // ==================== 通用 schema 回退 ====================

  private static fromSchema(metadata: ToolMetadata): Record<string, unknown> {
    const schema = (metadata.input_schema || {}) as Record<string, unknown>;
    const properties = (schema.properties || {}) as Record<string, { type?: string; default?: unknown; enum?: unknown[] }>;
    const params: Record<string, unknown> = {};

    for (const [key, prop] of Object.entries(properties)) {
      if (prop.default !== undefined) {
        params[key] = prop.default;
      } else if (prop.enum && prop.enum.length > 0) {
        params[key] = prop.enum[0];
      } else if (prop.type === 'boolean') {
        params[key] = false;
      } else if (prop.type === 'number') {
        params[key] = 0;
      } else if (prop.type === 'string') {
        params[key] = '';
      } else if (prop.type === 'array') {
        params[key] = [];
      }
    }

    return params;
  }

  // ==================== 辅助函数 ====================

  private static normalizeItemId(id: string): string {
    return id.replace(/^minecraft:/, '');
  }

  private static normalizeBlockId(id: string): string {
    return id.replace(/^minecraft:/, '').toLowerCase();
  }

  private static getPos(player: Player): Vec3Like {
    return { x: player.pos.x, y: player.pos.y, z: player.pos.z };
  }

  private static offsetPos(player: Player, dx: number, dy: number, dz: number): Vec3Like {
    const pos = this.getPos(player);
    return { x: Math.floor(pos.x + dx), y: Math.floor(pos.y + dy), z: Math.floor(pos.z + dz) };
  }

  private static getInventoryItems(player: Player): Array<{ name: string; count: number; type: string }> {
    try {
      const container = player.getInventory();
      const items = container.getAllItems ? container.getAllItems() : [];
      return items
        .filter((it) => !it.isNull())
        .map((it) => {
          const type = it.type || it.name;
          logger.info(`[DefaultParamProvider] 背包物品: name=${it.name}, type=${it.type}, count=${it.count}`);
          return { name: it.name, count: it.count, type };
        });
    } catch (e) {
      return [];
    }
  }

  private static findNearbyBlock(
    player: Player,
    radius: number,
    predicate: (block: Block) => boolean,
  ): Vec3Like | null {
    try {
      const center = this.getPos(player);
      const cx = Math.floor(center.x);
      const cy = Math.floor(center.y);
      const cz = Math.floor(center.z);

      for (let r = 1; r <= radius; r++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            for (let dz = -r; dz <= r; dz++) {
              if (Math.abs(dx) !== r && Math.abs(dy) !== r && Math.abs(dz) !== r) continue;
              const x = cx + dx;
              const y = cy + dy;
              const z = cz + dz;
              const block = mc.getBlock(x, y, z, player.pos.dimid);
              if (block && predicate(block)) {
                return { x, y, z };
              }
            }
          }
        }
      }
    } catch (e) {
      // 忽略扫描异常
    }
    return null;
  }

  private static isArmor(name: string): boolean {
    return /_(helmet|chestplate|leggings|boots)$/.test(name);
  }

  private static isBlockItem(name: string): boolean {
    // 简单启发式：不是食物、工具、武器、药水的物品大概率是方块
    if (FOODS.has(name)) return false;
    if (/_(sword|pickaxe|axe|shovel|hoe|helmet|chestplate|leggings|boots)$/.test(name)) return false;
    if (/potion|splash_potion|lingering_potion|arrow$/.test(name)) return false;
    return true;
  }

  /**
   * 在假人周围寻找空气位置用于放置方块。
   * 优先正前方同高度，再向两侧/后方扩展。
   */
  private static findAirPosition(feet: Vec3Like, dimid: number, maxOffset: number): Vec3Like | null {
    const fx = Math.floor(feet.x);
    const fy = Math.floor(feet.y);
    const fz = Math.floor(feet.z);
    for (const ox of [1, -1, 0, 2, -2]) {
      for (const oz of [0, 1, -1, 2, -2]) {
        if (Math.abs(ox) > maxOffset || Math.abs(oz) > maxOffset) continue;
        if (ox === 0 && oz === 0) continue;
        const x = fx + ox;
        const z = fz + oz;
        try {
          const block = mc.getBlock(x, fy, z, dimid);
          if (block && this.normalizeBlockId(block.type) === 'air') {
            return { x, y: fy, z };
          }
        } catch (e) {
          // ignore
        }
      }
    }
    return null;
  }

  /**
   * 与 BlockValidator 保持一致的可替换方块集合（放置时不视为阻挡）。
   */
  private static getReplaceableBlocks(): Set<string> {
    return new Set([
      'air',
      'cave_air',
      'void_air',
      'water',
      'lava',
      'grass',
      'tall_grass',
      'fern',
      'large_fern',
      'dead_bush',
      'seagrass',
      'tall_seagrass',
      'kelp',
      'snow',
    ]);
  }

  /**
   * 判断方块是否可以被放置的方块替换（目标位置可放置）。
   */
  private static isReplaceableForPlacement(type: string): boolean {
    return this.getReplaceableBlocks().has(type);
  }

  /**
   * 寻找可放置方块的空气位置：目标为空气/可替换方块，且至少有一个邻接面是实体方块。
   */
  private static findPlaceableAirPosition(feet: Vec3Like, dimid: number, maxOffset: number): Vec3Like | null {
    const fx = Math.floor(feet.x);
    const fy = Math.floor(feet.y);
    const fz = Math.floor(feet.z);
    const directions = [
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 },
    ];
    const replaceable = this.getReplaceableBlocks();

    for (const ox of [1, -1, 0, 2, -2]) {
      for (const oz of [0, 1, -1, 2, -2]) {
        if (Math.abs(ox) > maxOffset || Math.abs(oz) > maxOffset) continue;
        if (ox === 0 && oz === 0) continue;
        const x = fx + ox;
        const z = fz + oz;
        try {
          const block = mc.getBlock(x, fy, z, dimid);
          const targetType = block ? this.normalizeBlockId(block.type) : 'air';
          if (!replaceable.has(targetType)) continue;

          // 检查是否有实体方块邻接面
          let hasSolidNeighbor = false;
          for (const dir of directions) {
            const nb = mc.getBlock(x + dir.x, fy + dir.y, z + dir.z, dimid);
            const nbType = nb ? this.normalizeBlockId(nb.type) : 'air';
            if (!replaceable.has(nbType)) {
              hasSolidNeighbor = true;
              break;
            }
          }
          if (hasSolidNeighbor) {
            return { x, y: fy, z };
          }
        } catch (e) {
          // ignore
        }
      }
    }
    return null;
  }

  /**
   * 在假人脚下的 5x5 平台范围内寻找同高度可站立目标。
   */
  private static findPlatformTarget(feet: Vec3Like, maxOffset: number): Vec3Like {
    const fx = Math.floor(feet.x);
    const fy = Math.floor(feet.y);
    const fz = Math.floor(feet.z);
    // 优先正前方，再向两侧扩展
    for (const ox of [1, -1, 2, -2, 0]) {
      for (const oz of [0, 1, -1, 2, -2]) {
        if (Math.abs(ox) > maxOffset || Math.abs(oz) > maxOffset) continue;
        if (ox === 0 && oz === 0) continue;
        return { x: fx + ox, y: fy, z: fz + oz };
      }
    }
    return { x: fx + 1, y: fy, z: fz };
  }

  /**
   * 在假人前方寻找可达的地面目标。
   * 要求目标位置脚下有实体方块、 Feet/头部 位置为空气，且与假人同高度或一跳高度内。
   */
  private static findReachableGroundTarget(player: Player, maxDistance: number): Vec3Like {
    const feet = this.getFeetPos(player);
    const yaw = player.direction?.yaw ?? 0;
    const dimid = player.pos.dimid;
    const startY = Math.floor(feet.y);

    // 按距离递增、优先正前方、小角度侧向扫描
    for (let distance = 2; distance <= maxDistance; distance++) {
      for (const lateral of [0, -1, 1, -2, 2]) {
        const angle = yaw + lateral * 15;
        const rad = ((angle - 90) * Math.PI) / 180;
        const bx = Math.floor(feet.x + Math.cos(rad) * distance);
        const bz = Math.floor(feet.z + Math.sin(rad) * distance);

        // 优先同一 Y 层，再尝试上下一格（适应微地形）
        for (const dy of [0, -1, 1]) {
          const by = startY + dy;
          if (this.isValidStandPosition(bx, by, bz, dimid)) {
            return { x: bx, y: by, z: bz };
          }
        }
      }
    }

    // 兜底：正前方 2 格同高度
    return this.offsetPos(player, 2, 0, 0);
  }

  /**
   * 判断 (x,y,z) 是否可以站立：脚下实体、脚部和头部空气。
   */
  private static isValidStandPosition(x: number, y: number, z: number, dimid: number): boolean {
    try {
      const ground = mc.getBlock(x, y - 1, z, dimid);
      const feet = mc.getBlock(x, y, z, dimid);
      const head = mc.getBlock(x, y + 1, z, dimid);
      if (!ground || !feet || !head) return false;
      return !this.isPassable(ground) && this.isPassable(feet) && this.isPassable(head);
    } catch (e) {
      return false;
    }
  }

  /**
   * 判断方块是否可通过（空气、水、岩浆视为不可站立但可通过）。
   * 这里用于站立位置：只接受空气类方块。
   */
  private static isPassable(block: Block): boolean {
    const name = this.normalizeBlockId(block.name || block.type || '');
    return name === 'air' || name === 'cave_air' || name === 'void_air';
  }

  /**
   * 获取假人脚部坐标，优先使用 feetPos 属性。
   */
  private static getFeetPos(player: Player): Vec3Like {
    const dimid = player.pos?.dimid ?? 0;
    if (player.feetPos) {
      return { x: player.feetPos.x, y: player.feetPos.y, z: player.feetPos.z, dimid };
    }
    return { x: player.pos.x, y: player.pos.y - 1.62, z: player.pos.z, dimid };
  }

  /**
   * 安全调用 mc.getEntities，兼容不同 LLSE 版本的参数签名。
   */
  private static safeGetEntities(center?: Vec3Like, radius?: number): any[] {
    if (typeof (mc as any).getEntities !== 'function') return [];
    const api = mc as any;
    const variants: any[] = [
      [],
      [{}],
      [{ type: 'boat' }],
      [{ type: 'minecraft:boat' }],
    ];
    if (center && radius !== undefined) {
      const dimid = typeof center.dimid === 'number' ? center.dimid : 0;
      variants.unshift(
        [new FloatPos(center.x, center.y, center.z, dimid), radius],
        [{ x: center.x, y: center.y, z: center.z, dimid, radius }],
        [{ pos: center, radius }],
        [{ x: center.x, y: center.y, z: center.z, radius }],
      );
    }
    for (const args of variants) {
      try {
        const res = api.getEntities(...args);
        if (Array.isArray(res) && res.length > 0) return res;
      } catch (e) {
        // ignore
      }
    }
    return [];
  }

  /**
   * 查找假人附近最近的 boat/minecart 等可骑乘实体。
   */
  private static findNearestRideableEntity(player: Player, radius: number): any | null {
    try {
      const center = this.getFeetPos(player);
      const entities = this.safeGetEntities(center, radius);
      const rideableTypes = ['boat', 'minecart'];
      let best: any = null;
      let bestDist = Infinity;
      logger.info(`[DefaultParamProvider] 扫描可骑乘实体，总数=${entities.length}, 中心=${JSON.stringify(center)}`);
      for (const entity of entities) {
        const rawType = String(entity.type || entity.name || '');
        const type = this.normalizeBlockId(rawType);
        const dist = Math.sqrt(
          Math.pow((entity.pos?.x ?? 0) - center.x, 2) +
          Math.pow((entity.pos?.y ?? 0) - center.y, 2) +
          Math.pow((entity.pos?.z ?? 0) - center.z, 2),
        );
        logger.info(`[DefaultParamProvider] 实体 type=${rawType} normalized=${type} dist=${dist.toFixed(2)} id=${entity.uniqueId ?? entity.id}`);
        if (!rideableTypes.some((t) => type === t || type.includes(t))) continue;
        if (dist < bestDist && dist <= radius) {
          bestDist = dist;
          best = entity;
        }
      }
      if (best) {
        logger.info(`[DefaultParamProvider] 找到最近可骑乘实体: ${best.uniqueId ?? best.id}, 距离=${bestDist.toFixed(2)}`);
      } else {
        logger.warn('[DefaultParamProvider] 未找到附近可骑乘实体');
      }
      return best;
    } catch (e) {
      logger.warn(`[DefaultParamProvider] 查找可骑乘实体失败: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }
}
