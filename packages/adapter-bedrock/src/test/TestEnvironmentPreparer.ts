/**
 * 为人类测试者自动准备测试环境。
 * 给假人物品、放置测试用容器/床、生成可骑乘实体等。
 */

export interface PrepareOptions {
  /** 是否在假人脚下清理出一块平地 */
  clearPlatform?: boolean;
  /** 是否给予测试物品 */
  giveItems?: boolean;
  /** 是否放置测试容器 */
  placeContainer?: boolean;
  /** 是否放置床 */
  placeBed?: boolean;
  /** 是否生成可骑乘实体（船） */
  spawnRideable?: boolean;
}

export class TestEnvironmentPreparer {
  static readonly DEFAULT_OPTIONS: PrepareOptions = {
    clearPlatform: true,
    giveItems: true,
    placeContainer: true,
    placeBed: true,
    spawnRideable: true,
  };

  /** 最后一次生成的可骑乘实体 ID，供 DefaultParamProvider 使用 */
  static lastRideableEntityId: string | null = null;
  /** 最后一次生成的可骑乘实体类型 */
  static lastRideableEntityType: string | null = null;
  /** 为 mine_block 测试准备的可挖掘方块坐标 */
  static preparedMineBlockPos: { x: number; y: number; z: number; dimid: number } | null = null;
  /** 为 place_block / area_operation 测试准备的空气位置坐标 */
  static preparedPlaceBlockPos: { x: number; y: number; z: number; dimid: number } | null = null;

  /**
   * 为指定假人准备测试环境。
   * @param botName 假人名称
   * @param botPlayer 假人玩家对象
   * @param opts 准备选项
   */
  static async prepare(
    botName: string,
    botPlayer: Player,
    opts: PrepareOptions = {},
  ): Promise<void> {
    const options = { ...this.DEFAULT_OPTIONS, ...opts };
    logger.info(`[TestEnvironmentPreparer] 开始为假人 ${botName} 准备测试环境`);

    // 等待玩家完全进入世界、区块加载
    await this.sleep(1500);

    const feet = botPlayer.feetPos
      ? { x: botPlayer.feetPos.x, y: botPlayer.feetPos.y, z: botPlayer.feetPos.z }
      : { x: botPlayer.pos.x, y: botPlayer.pos.y - 1.62, z: botPlayer.pos.z };
    const pos = { x: Math.floor(feet.x), y: Math.floor(feet.y), z: Math.floor(feet.z) };
    const dim = botPlayer.pos.dimid;

    try {
      // 清理历史测试实体，避免船、掉落物等堆积干扰测试
      await this.clearTestEntities(botPlayer, pos, dim);

      if (options.clearPlatform) {
        // 清理并铺设脚下平台（5x5），确保假人有足够站立和测试地面
        for (let dx = -2; dx <= 2; dx++) {
          for (let dz = -2; dz <= 2; dz++) {
            await this.setBlock(pos.x + dx, pos.y - 1, pos.z + dz, 'stone', dim);
          }
        }
        // 清理上方空间，防止窒息
        for (let dx = -2; dx <= 2; dx++) {
          for (let dz = -2; dz <= 2; dz++) {
            for (let dy = 0; dy <= 3; dy++) {
              await this.setBlock(pos.x + dx, pos.y + dy, pos.z + dz, 'air', dim);
            }
          }
        }
      }

      if (options.giveItems) {
        await this.giveItem(botPlayer, 'apple', 16);
        await this.giveItem(botPlayer, 'dirt', 64);
        await this.giveItem(botPlayer, 'stone', 64);
        await this.giveItem(botPlayer, 'leather_chestplate', 1);
        await this.giveItem(botPlayer, 'wooden_sword', 1);
        await this.giveItem(botPlayer, 'stone_pickaxe', 1);
        await this.sleep(500);
        this.logInventorySnapshot(botPlayer);
      }

      if (options.placeContainer) {
        // 在假人前方 2 格放置箱子，箱子里放点东西
        const cx = pos.x + 2;
        const cz = pos.z;
        await this.setBlock(cx, pos.y, cz, 'chest', dim);
        await this.setBlock(cx, pos.y + 1, cz, 'air', dim);
        // 等待箱子 BlockEntity 初始化
        await this.sleep(300);
        const chestBlock = mc.getBlock(cx, pos.y, cz, dim);
        const chestContainer = chestBlock?.getContainer();
        if (chestContainer) {
          const apple = mc.newItem('apple', 8, null);
          if (apple) chestContainer.setItem(0, apple);
          logger.info(`[TestEnvironmentPreparer] 已放置箱子并放入物品: ${cx},${pos.y},${cz}`);
        } else {
          logger.warn(`[TestEnvironmentPreparer] 箱子容器获取失败: ${cx},${pos.y},${cz}`);
        }

        // 在箱子旁边放置一个泥土方块，供 mine_block 工具测试
        const mineX = cx;
        const mineZ = cz + 1;
        await this.setBlock(mineX, pos.y, mineZ, 'dirt', dim);
        await this.setBlock(mineX, pos.y + 1, mineZ, 'air', dim);
        this.preparedMineBlockPos = { x: mineX, y: pos.y, z: mineZ, dimid: dim };
        logger.info(`[TestEnvironmentPreparer] 已放置可挖掘泥土: ${mineX},${pos.y},${mineZ}`);

        // 在假人侧后方清理一个空气位置，供 place_block / area_operation 测试。
        // 选择位置时确保其唯一实体邻接面是脚下的 stone 平台（避免邻接箱子等可交互方块，
        // 否则 simulateUseItem 会打开容器而不是放置方块）。
        const placeX = pos.x + 1;
        const placeZ = pos.z - 1;
        await this.setBlock(placeX, pos.y, placeZ, 'air', dim);
        await this.setBlock(placeX, pos.y + 1, placeZ, 'air', dim);
        // 确保下方支撑面为实体方块（stone）
        await this.setBlock(placeX, pos.y - 1, placeZ, 'stone', dim);
        this.preparedPlaceBlockPos = { x: placeX, y: pos.y, z: placeZ, dimid: dim };
        logger.info(`[TestEnvironmentPreparer] 已清理可放置空气位置: ${placeX},${pos.y},${placeZ}`);
      }

      if (options.placeBed) {
        const bx = pos.x - 2;
        const bz = pos.z;
        // 清理可能残留的床及上方空间
        await this.setBlock(bx, pos.y, bz, 'air', dim);
        await this.setBlock(bx + 1, pos.y, bz, 'air', dim);
        await this.setBlock(bx, pos.y + 1, bz, 'air', dim);
        await this.setBlock(bx + 1, pos.y + 1, bz, 'air', dim);
        await this.sleep(100);

        // 尝试多种方式放置床，提高兼容性
        const bedPlaced = await this.placeBed(bx, pos.y, bz, dim);
        if (bedPlaced) {
          logger.info(`[TestEnvironmentPreparer] 已放置床: ${bx},${pos.y},${bz}`);
        } else {
          logger.warn(`[TestEnvironmentPreparer] 床放置可能失败: ${bx},${pos.y},${bz}`);
        }

        // 为 sleep 工具创造可入睡时间（夜晚）
        try {
          const api = mc as any;
          if (typeof api.setTime === 'function') {
            api.setTime(13000);
          } else if (typeof api.runcmdEx === 'function') {
            api.runcmdEx('time set 13000');
          } else if (typeof api.runcmd === 'function') {
            api.runcmd('time set 13000');
          } else if (typeof api.runCmd === 'function') {
            api.runCmd('time set 13000');
          }
        } catch (e) { /* ignore */ }
      }

      if (options.spawnRideable) {
        const rx = pos.x;
        const rz = pos.z + 2;
        let spawned = false;
        this.lastRideableEntityId = null;
        this.lastRideableEntityType = null;
        try {
          const api = mc as any;
          // 优先使用 spawnEntity 直接生成并获取实体对象，便于后续骑乘
          if (typeof api.spawnEntity === 'function') {
            try {
              const entity = api.spawnEntity('boat', 1, new FloatPos(rx + 0.5, pos.y, rz + 0.5, dim));
              if (entity) {
                spawned = true;
                this.lastRideableEntityId = String(entity.uniqueId ?? entity.id ?? '');
                this.lastRideableEntityType = String(entity.type || entity.name || 'boat');
                logger.info(`[TestEnvironmentPreparer] 已使用 spawnEntity 生成船, id=${this.lastRideableEntityId}, type=${this.lastRideableEntityType}`);
              }
            } catch (spawnErr) {
              logger.warn(`[TestEnvironmentPreparer] spawnEntity 生成船失败: ${spawnErr instanceof Error ? spawnErr.message : String(spawnErr)}`);
            }
          }

          if (!spawned) {
            // 回退到 summon 命令
            const cmds = [
              `execute in ${this.dimensionName(dim)} run summon boat ${rx} ${pos.y} ${rz}`,
              `summon boat ${rx} ${pos.y} ${rz}`,
            ];
            for (const cmd of cmds) {
              let ok = false;
              try {
                if (typeof api.runCmd === 'function') {
                  ok = api.runCmd(cmd);
                } else if (typeof api.runcmdEx === 'function') {
                  const res = api.runcmdEx(cmd);
                  ok = res?.success ?? true;
                } else if (typeof api.runcmd === 'function') {
                  api.runcmd(cmd);
                  ok = true;
                }
              } catch (e) {
                ok = false;
              }
              if (ok) {
                spawned = true;
                logger.info(`[TestEnvironmentPreparer] 已生成船: ${cmd}`);
                break;
              }
            }
          }
        } catch (e) {
          logger.warn(`[TestEnvironmentPreparer] 生成船失败: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (spawned) {
          // 等待实体同步到世界，提高后续 getEntities 查询成功率
          await this.sleep(2000);
          // 如果是 summon 命令生成，尝试扫描并记录船 ID
          if (!this.lastRideableEntityId) {
            this.scanAndRecordRideable(botPlayer, rx, pos.y, rz);
          }
        } else {
          logger.warn('[TestEnvironmentPreparer] 未能生成船，ride 工具可能无法测试');
        }
      }

      logger.info(`[TestEnvironmentPreparer] 假人 ${botName} 测试环境准备完成`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[TestEnvironmentPreparer] 准备环境失败: ${message}`);
    }
  }

  private static async giveItem(player: Player, itemType: string, count: number): Promise<void> {
    try {
      const realName = player.realName;
      const normalizedType = itemType.replace(/^minecraft:/, '');

      // 先记录给予前的数量，用于后续校验
      const beforeCount = this.countItemInInventory(player, normalizedType);

      // 兜底：直接操作背包（最可靠，不依赖命令权限/同步）
      const item = mc.newItem(itemType, count, null);
      if (item && player.getInventory() && typeof player.getInventory().addItem === 'function') {
        try {
          player.getInventory().addItem(item.clone());
          this.refreshItems(player);
          await this.sleep(50);
          const afterCount = this.countItemInInventory(player, normalizedType);
          if (afterCount > beforeCount) {
            logger.info(`[TestEnvironmentPreparer] 已给予物品(addItem): ${itemType} x${count} (校验通过 ${beforeCount}->${afterCount})`);
            return;
          }
        } catch (e) {
          // 回退到命令
        }
      }

      // 玩家上下文命令
      const cmd = `give "${realName}" ${itemType} ${count}`;
      if (typeof player.runCmd === 'function') {
        try {
          const ok = player.runCmd(cmd);
          if (ok) {
            this.refreshItems(player);
            await this.sleep(100);
            const afterCount = this.countItemInInventory(player, normalizedType);
            if (afterCount > beforeCount) {
              logger.info(`[TestEnvironmentPreparer] 已给予物品(玩家命令): ${itemType} x${count}`);
              return;
            }
          }
        } catch (e) {
          // ignore
        }
      }

      // 服务器命令
      const api = mc as any;
      let cmdOk = false;
      try {
        if (typeof api.runcmdEx === 'function') {
          const res = api.runcmdEx(cmd);
          cmdOk = res?.success ?? false;
        } else if (typeof api.runCmd === 'function') {
          cmdOk = api.runCmd(cmd);
        } else if (typeof api.runcmd === 'function') {
          api.runcmd(cmd);
          cmdOk = true;
        }
      } catch (e) {
        cmdOk = false;
      }
      if (cmdOk) {
        this.refreshItems(player);
        await this.sleep(100);
        const afterCount = this.countItemInInventory(player, normalizedType);
        if (afterCount > beforeCount) {
          logger.info(`[TestEnvironmentPreparer] 已给予物品(服务器命令): ${itemType} x${count}`);
          return;
        }
      }

      logger.warn(`[TestEnvironmentPreparer] 无法确认物品是否进入背包: ${itemType}`);
    } catch (e) {
      logger.warn(`[TestEnvironmentPreparer] 给予物品失败: ${itemType}, ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private static countItemInInventory(player: Player, itemType: string): number {
    try {
      const inv = player.getInventory();
      if (!inv) return 0;
      const size = inv.size ?? 36;
      let total = 0;
      for (let i = 0; i < size; i++) {
        const it = inv.getItem(i);
        if (it && !it.isNull()) {
          const name = String(it.type || it.name || '').replace(/^minecraft:/, '').toLowerCase();
          if (name === itemType.toLowerCase()) {
            total += it.count;
          }
        }
      }
      return total;
    } catch (e) {
      return 0;
    }
  }

  private static logInventorySnapshot(player: Player): void {
    try {
      const inv = player.getInventory();
      if (!inv) {
        logger.warn('[TestEnvironmentPreparer] 无法获取背包快照');
        return;
      }
      const size = inv.size ?? 36;
      const items: string[] = [];
      for (let i = 0; i < size; i++) {
        const it = inv.getItem(i);
        if (it && !it.isNull()) {
          items.push(`[slot=${i} name=${it.name} type=${it.type} count=${it.count}]`);
        }
      }
      logger.info(`[TestEnvironmentPreparer] 背包快照(${items.length}格): ${items.join(', ')}`);
    } catch (e) {
      logger.warn(`[TestEnvironmentPreparer] 背包快照失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private static refreshItems(player: Player): void {
    try {
      if (typeof player.refreshItems === 'function') {
        player.refreshItems();
      }
    } catch (e) {
      // ignore
    }
    try {
      if (typeof (player as any).refreshInventory === 'function') {
        (player as any).refreshInventory();
      }
    } catch (e) {
      // ignore
    }
  }

  private static async setBlock(x: number, y: number, z: number, block: string, dimid: number): Promise<void> {
    // 优先尝试使用玩家上下文执行 setblock（维度正确、权限足够）
    const player = this.findPlayerInDim(dimid);
    if (player && typeof player.runCmd === 'function') {
      try {
        const ok = player.runCmd(`setblock ${x} ${y} ${z} ${block}`);
        if (ok) {
          await this.sleep(30);
          return;
        }
      } catch (e) {
        // 玩家命令失败则回退到服务器命令
      }
    }
    // 兜底：服务器命令
    const api = mc as any;
    const cmd = `execute in ${this.dimensionName(dimid)} run setblock ${x} ${y} ${z} ${block}`;
    if (typeof api.runcmdEx === 'function') {
      api.runcmdEx(cmd);
    } else if (typeof api.runcmd === 'function') {
      api.runcmd(cmd);
    } else if (typeof api.runCmd === 'function') {
      api.runCmd(cmd);
    }
    await this.sleep(30);
  }

  private static findPlayerInDim(dimid: number): Player | null {
    try {
      const players = mc.getOnlinePlayers();
      for (const p of players) {
        if (p.pos.dimid === dimid) return p;
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 清理测试区域内的船、掉落物等历史实体，避免多次测试后堆积干扰。
   */
  private static async clearTestEntities(player: Player, center: { x: number; y: number; z: number }, dimid: number): Promise<void> {
    try {
      const api = mc as any;
      if (typeof api.getEntities !== 'function') return;

      let entities: any[] = [];
      const variants = [
        () => api.getEntities(),
        () => api.getEntities({}),
        () => api.getEntities(new FloatPos(center.x + 0.5, center.y, center.z + 0.5, dimid), 10),
        () => api.getEntities(center.x + 0.5, center.y, center.z + 0.5, dimid, 10),
      ];
      for (const fn of variants) {
        try {
          const res = fn();
          if (Array.isArray(res) && res.length > 0) {
            entities = res;
            break;
          }
        } catch (e) {
          // ignore
        }
      }

      let removed = 0;
      for (const entity of entities) {
        const type = String(entity.type || entity.name || '').toLowerCase();
        if (type.includes('boat') || type === 'minecraft:item' || type === 'item') {
          try {
            if (typeof entity.remove === 'function') {
              entity.remove();
              removed++;
            }
          } catch (e) {
            // ignore
          }
        }
      }
      if (removed > 0) {
        logger.info(`[TestEnvironmentPreparer] 清理历史测试实体: ${removed} 个`);
        await this.sleep(200);
      }
    } catch (e) {
      // ignore
    }
  }

  private static scanAndRecordRideable(player: Player, x: number, y: number, z: number): void {
    try {
      const api = mc as any;
      let entities: any[] = [];
      const variants = [
        () => api.getEntities(),
        () => api.getEntities({}),
        () => api.getEntities({ type: 'boat' }),
        () => api.getEntities({ type: 'minecraft:boat' }),
        () => api.getEntities(new FloatPos(x + 0.5, y, z + 0.5, player.pos.dimid), 5),
        () => api.getEntities(x + 0.5, y, z + 0.5, player.pos.dimid, 5),
      ];
      for (const fn of variants) {
        try {
          const res = fn();
          if (Array.isArray(res) && res.length > 0) {
            entities = res;
            break;
          }
        } catch (e) {
          // ignore
        }
      }
      const center = { x: x + 0.5, y, z: z + 0.5 };
      let best: any = null;
      let bestDist = Infinity;
      for (const entity of entities) {
        const type = String(entity.type || entity.name || '').toLowerCase();
        if (!type.includes('boat') && !type.includes('minecart')) continue;
        const dist = Math.sqrt(
          Math.pow((entity.pos?.x ?? 0) - center.x, 2) +
          Math.pow((entity.pos?.y ?? 0) - center.y, 2) +
          Math.pow((entity.pos?.z ?? 0) - center.z, 2),
        );
        if (dist < bestDist) {
          bestDist = dist;
          best = entity;
        }
      }
      if (best) {
        this.lastRideableEntityId = String(best.uniqueId ?? best.id ?? '');
        this.lastRideableEntityType = String(best.type || best.name || 'boat');
        logger.info(`[TestEnvironmentPreparer] 扫描到船实体, id=${this.lastRideableEntityId}, type=${this.lastRideableEntityType}, dist=${bestDist.toFixed(2)}`);
      } else {
        logger.warn(`[TestEnvironmentPreparer] 扫描后仍未找到船实体, 实体总数=${entities.length}`);
      }
    } catch (e) {
      logger.warn(`[TestEnvironmentPreparer] 扫描船实体失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private static async placeBed(bx: number, by: number, bz: number, dimid: number): Promise<boolean> {
    // Bedrock 床需要同时放置脚部和头部两个方块
    // data 低 2 位为朝向 (0南 1西 2北 3东)，第 3 位为头/脚 (0头 8脚)
    const orientations = [
      { dx: 1, dz: 0, footData: 11, headData: 3 }, // 东
      { dx: -1, dz: 0, footData: 9, headData: 1 }, // 西
      { dx: 0, dz: 1, footData: 8, headData: 0 }, // 南
      { dx: 0, dz: -1, footData: 10, headData: 2 }, // 北
    ];

    const api = mc as any;
    const runSetblock = async (x: number, y: number, z: number, blockDesc: string): Promise<boolean> => {
      const cmd = `execute in ${this.dimensionName(dimid)} run setblock ${x} ${y} ${z} ${blockDesc}`;
      try {
        if (typeof api.runCmd === 'function') return api.runCmd(cmd);
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
    };

    for (const ori of orientations) {
      const hx = bx + ori.dx;
      const hz = bz + ori.dz;
      // 清理两个位置
      await runSetblock(bx, by, bz, 'air');
      await runSetblock(hx, by, hz, 'air');
      await this.sleep(50);
      // 放置脚部和头部
      await runSetblock(bx, by, bz, `bed ${ori.footData}`);
      await runSetblock(hx, by, hz, `bed ${ori.headData}`);
      await this.sleep(200);
      // 验证两个位置都是床
      const footBlock = mc.getBlock(bx, by, bz, dimid);
      const headBlock = mc.getBlock(hx, by, hz, dimid);
      const footType = String(footBlock?.type || footBlock?.name || '').toLowerCase();
      const headType = String(headBlock?.type || headBlock?.name || '').toLowerCase();
      if (/(^|_)bed$/.test(footType) && /(^|_)bed$/.test(headType)) {
        logger.info(`[TestEnvironmentPreparer] 床放置成功: ${bx},${by},${bz} 朝向 dx=${ori.dx},dz=${ori.dz}`);
        return true;
      }
    }

    // 兜底：尝试单个 white_bed
    const fallbackVariants = [
      `setblock ${bx} ${by} ${bz} white_bed`,
      `setblock ${bx} ${by} ${bz} bed`,
      `execute in ${this.dimensionName(dimid)} run setblock ${bx} ${by} ${bz} white_bed`,
    ];
    for (const cmd of fallbackVariants) {
      try {
        let ok = false;
        if (typeof api.runCmd === 'function') {
          ok = api.runCmd(cmd);
        } else if (typeof api.runcmdEx === 'function') {
          const res = api.runcmdEx(cmd);
          ok = res?.success ?? true;
        } else if (typeof api.runcmd === 'function') {
          api.runcmd(cmd);
          ok = true;
        }
        if (ok) {
          await this.sleep(200);
          const block = mc.getBlock(bx, by, bz, dimid);
          const type = String(block?.type || block?.name || '').toLowerCase();
          if (/(^|_)bed$/.test(type)) {
            logger.info(`[TestEnvironmentPreparer] 床兜底放置成功: ${cmd}`);
            return true;
          }
        }
      } catch (e) {
        // ignore
      }
    }
    return false;
  }

  private static dimensionName(dimid: number): string {
    switch (dimid) {
      case 1:
        return 'nether';
      case 2:
        return 'the_end';
      case 0:
      default:
        return 'overworld';
    }
  }
}
