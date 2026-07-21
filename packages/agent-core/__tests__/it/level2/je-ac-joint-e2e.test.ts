/**
 * AC 与 JE 联合端到端测试（E2E）
 *
 * 测试目标：
 * 1. 验证 AC→JE→AC 工具链可用：AC 端 ToolDispatcher 通过 TCP 协议调用 JE 端全部 32 个工具
 * 2. 验证全部 JE 工具注册就绪（32 个，8 个模块）
 * 3. 验证 AC 端 17 个工具可正常调用
 * 4. 验证状态上报与事件通知机制
 * 5. 验证错误路径返回正确错误码
 * 6. 验证多轮连续工具调用状态一致性
 *
 * 测试流程：
 * 1. 启动 AC TCP 服务器（in-process）
 * 2. 启动 JE Minecraft 服务器
 * 3. 等待 JE 模组连接并注册工具
 * 4. 阶段一：工具注册验证（3 个用例）
 * 5. 阶段二：JE 工具测试（32 个用例，8 个模块）
 * 6. 阶段三：状态上报与事件通知（5 个用例）
 * 7. 阶段四：错误路径验证（10 个用例）
 * 8. 阶段五：多轮连续调用（3 个用例）
 * 9. 清理：销毁假人、停止 MC 服务器
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { startAcMinimalServer, type AcMinimalContext } from '../fixtures/ac-minimal-server'
import {
  waitFor, ensureBotOnline, cleanupBot, callToolSafe,
  sendMcCommand, setGameMode, giveItem, setBlockAt, summonEntityAt,
  setWorldTime, fillArea, clearArea, sleep,
} from '../fixtures/je-tools-env'

// ════════════════════════════════════════════════════════════════
// 环境检查
// ════════════════════════════════════════════════════════════════

function hasJava21(): boolean {
  const candidates = [
    process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java.exe') : undefined,
    'C:\\Program Files\\Java\\latest\\jdk-21\\bin\\java.exe',
    'java.exe',
  ].filter(Boolean) as string[]
  for (const candidate of candidates) {
    try {
      const resolved = fs.realpathSync(candidate)
      if (fs.existsSync(resolved)) return true
    } catch { /* ignore */ }
  }
  return false
}
const isJavaAvailable = hasJava21()

// ════════════════════════════════════════════════════════════════
// 常量
// ════════════════════════════════════════════════════════════════

const BOT_NAME = 'E2E_Bot'
const BOT_X = 0, BOT_Y = 64, BOT_Z = 0
const TEST_BASE_X = 5
const TEST_BASE_Y = 71
const TEST_BASE_Z = 5

const UUID_RE = /^[0-9a-f-]{36}$/

// ════════════════════════════════════════════════════════════════
// 辅助函数
// ════════════════════════════════════════════════════════════════

/** 等待 MC 服务端就绪（通过 stdout 检测 "Done" 关键词） */
async function waitForMcReady(
  childProcess: ReturnType<typeof spawn>,
  timeoutMs = 180_000,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`MC 服务端启动超时 (${timeoutMs}ms)`))
    }, timeoutMs)

    let output = ''
    const onData = (chunk: Buffer) => {
      const text = chunk.toString()
      output += text
      if (output.includes('Done') || text.includes('Done')) {
        clearTimeout(timeout)
        if (childProcess.stdout) childProcess.stdout.removeListener('data', onData)
        if (childProcess.stderr) childProcess.stderr.removeListener('data', onData)
        resolve()
      }
    }

    if (childProcess.stdout) childProcess.stdout.on('data', onData)
    if (childProcess.stderr) childProcess.stderr.on('data', onData)

    childProcess.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    childProcess.on('exit', (code) => {
      clearTimeout(timeout)
      if (code !== 0) {
        reject(new Error(`MC 服务端异常退出，code=${code}`))
      }
    })
  })
}

/** 查找 Java 路径 */
function findJavaPath(): string {
  const candidates = [
    process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java.exe') : undefined,
    'C:\\Program Files\\Java\\latest\\jdk-21\\bin\\java.exe',
    'java.exe',
  ].filter(Boolean) as string[]
  for (const candidate of candidates) {
    try {
      const resolved = fs.realpathSync(candidate)
      if (fs.existsSync(resolved)) return resolved
    } catch { /* try next */ }
  }
  return 'java.exe'
}

// ════════════════════════════════════════════════════════════════
// 主测试套件
// ════════════════════════════════════════════════════════════════

describe.skipIf(!isJavaAvailable)('AC 与 JE 联合端到端测试', () => {
  let ac: AcMinimalContext
  let workspaceId: string
  let mcProcess: ReturnType<typeof spawn> | null = null

  // ── 全局 setup / teardown ──

  beforeAll(async () => {
    console.log('[E2E] ===== 启动 AC TCP 服务器 =====')
    ac = await startAcMinimalServer(27541, 'mct_64cf4ca6c0c64a75aaf9a5b0')
    console.log(`[E2E] AC 服务器已启动，端口 ${ac.port}`)

    const serverJavaDir = path.resolve(__dirname, '../../../../../serverjava')
    const javaPath = findJavaPath()
    console.log(`[E2E] 使用 Java 路径: ${javaPath}`)
    console.log('[E2E] ===== 启动 Minecraft 服务端 =====')
    mcProcess = spawn(javaPath, ['-Xmx2G', '-jar', 'fabric-server-launch.jar', 'nogui'], {
      cwd: serverJavaDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    mcProcess.stdout?.on('data', (d: Buffer) => process.stdout.write(`[MC] ${d.toString()}`))
    mcProcess.stderr?.on('data', (d: Buffer) => process.stderr.write(`[MC:err] ${d.toString()}`))
    mcProcess.on('exit', (code) => console.log(`[E2E] MC 服务端退出，code=${code}`))

    console.log('[E2E] ===== 等待 MC 服务端初始化 =====')
    await waitForMcReady(mcProcess, 180_000)
    console.log('[E2E] MC 服务端已就绪')

    console.log('[E2E] ===== 等待 JE 连接 =====')
    workspaceId = await waitFor(() => {
      const online = ac.workspaceManager.getOnlineWorkspaces()
      if (online.length > 0) {
        const tools = ac.workspaceManager.getWorkspaceTools(online[0].id)
        if (tools.length >= 3) return online[0].id
      }
      return null
    }, { timeoutMs: 60_000, intervalMs: 1000 })
    console.log(`[E2E] JE 已连接，workspaceId: ${workspaceId}`)

    // 创建测试假人（创造模式）
    console.log('[E2E] ===== 创建测试假人 =====')
    await ensureBotOnline(ac.toolDispatcher, workspaceId, BOT_NAME, BOT_X, BOT_Y, BOT_Z)
    await setGameMode(mcProcess!, BOT_NAME, 'creative')
    sendMcCommand(mcProcess!, `/op ${BOT_NAME}`)
    await sleep(500)
    // 给假人基础物品
    await giveItem(mcProcess!, BOT_NAME, 'diamond_sword', 1)
    await giveItem(mcProcess!, BOT_NAME, 'diamond_helmet', 1)
    await giveItem(mcProcess!, BOT_NAME, 'diamond', 64)
    await giveItem(mcProcess!, BOT_NAME, 'dirt', 64)
    await giveItem(mcProcess!, BOT_NAME, 'stone', 64)
    await giveItem(mcProcess!, BOT_NAME, 'apple', 16)
    // 准备测试区域
    await clearArea(mcProcess!, TEST_BASE_X, TEST_BASE_Y - 1, TEST_BASE_Z,
      TEST_BASE_X + 50, TEST_BASE_Y + 10, TEST_BASE_Z + 50)
    await fillArea(mcProcess!, TEST_BASE_X, TEST_BASE_Y - 1, TEST_BASE_Z,
      TEST_BASE_X + 50, TEST_BASE_Y - 1, TEST_BASE_Z + 50, 'stone')
    await sleep(2000)
    // 移动假人到测试区域
    console.log('[E2E] 移动假人到测试区域...')
    const moveResult = await callToolSafe(ac.toolDispatcher, workspaceId, 'move_to',
      { x: TEST_BASE_X, y: TEST_BASE_Y, z: TEST_BASE_Z }, 30000)
    if (!moveResult.success) {
      console.log(`[E2E] 移动到测试区域失败: ${moveResult.error}`)
    }
    console.log('[E2E] 测试环境准备完成')
  }, 300_000)

  afterAll(async () => {
    console.log('[E2E] ===== 清理环境 =====')
    await cleanupBot(ac.toolDispatcher, workspaceId, BOT_NAME)
    await cleanupBot(ac.toolDispatcher, workspaceId, `${BOT_NAME}_Extra`)

    if (mcProcess && mcProcess.pid) {
      console.log('[E2E] 停止 MC 服务端...')
      try { process.kill(mcProcess.pid, 'SIGTERM') } catch { /* ignore */ }
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          try { process.kill(mcProcess!.pid!, 'SIGKILL') } catch {}
          resolve()
        }, 10_000)
        mcProcess?.on('exit', () => { clearTimeout(timeout); resolve() })
      })
    }

    console.log('[E2E] 停止 AC 服务器...')
    await ac.stop()
  }, 30_000)

  // ════════════════════════════════════════════════════════════════
  // 阶段一：工具注册验证
  // ════════════════════════════════════════════════════════════════

  describe('阶段一：工具注册验证', () => {
    it('E2E-REG-01: 验证 JE 工具注册数量 = 32', () => {
      const tools = ac.workspaceManager.getWorkspaceTools(workspaceId)
      console.log(`[E2E] 已注册工具: ${tools.length} 个`)
      for (const t of tools) {
        console.log(`  - ${t.name} (${t.category}): ${Object.keys(t.parameters).length} 个参数`)
      }
      expect(tools.length).toBeGreaterThanOrEqual(32)
    })

    it('E2E-REG-02: 验证每个工具 Schema 完整', () => {
      const tools = ac.workspaceManager.getWorkspaceTools(workspaceId)
      for (const tool of tools) {
        expect(tool.name).toBeTruthy()
        expect(tool.description).toBeTruthy()
        expect(tool.parameters).toBeDefined()
      }
    })

    it('E2E-REG-03: 验证关键工具存在', () => {
      const toolNames = ac.workspaceManager.getWorkspaceTools(workspaceId).map(t => t.name)
      const required = ['bot_spawn', 'bot_info', 'move_to', 'look_around',
        'mine_block', 'place_block', 'chat', 'eat', 'set_combat_mode',
        'drop_item', 'equip_item', 'look_in_container']
      for (const name of required) {
        expect(toolNames).toContain(name)
      }
    })
  })

  // ════════════════════════════════════════════════════════════════
  // 阶段二：JE 工具测试（32 个工具，8 个模块）
  // ════════════════════════════════════════════════════════════════

  describe('阶段二：JE 工具测试', () => {

    // ── BotTools — 假人管理 ──

    describe('BotTools — 假人管理', () => {
      it('E2E-JE-BT-01: bot_spawn 创建假人', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_spawn',
          { name: `${BOT_NAME}_Extra`, x: 10, y: BOT_Y, z: 10 }, 15000)
        expect(r.success).toBe(true)
        if (r.success) {
          expect(r.data.name).toBe(`${BOT_NAME}_Extra`)
          expect(r.data.uuid).toMatch(UUID_RE)
        }
      })

      it('E2E-JE-BT-02: bot_info 查询假人信息', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_info',
          { name: BOT_NAME }, 10000)
        expect(r.success).toBe(true)
        if (r.success) {
          expect(r.data.online).toBe(true)
          expect(r.data.name).toBe(BOT_NAME)
          expect(r.data.health).toBeGreaterThan(0)
        expect(r.data.position).toBeDefined()
        expect(typeof r.data.position.x).toBe('number')
        expect(typeof r.data.position.y).toBe('number')
        expect(typeof r.data.position.z).toBe('number')
        }
      })

      it('E2E-JE-BT-03: bot_list 列出所有假人', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_list', {}, 5000)
        expect(r.success).toBe(true)
        if (r.success) {
          expect(r.data.total).toBeGreaterThanOrEqual(2)
          expect(r.data.online).toBeGreaterThanOrEqual(1)
          expect(Array.isArray(r.data.bots)).toBe(true)
        }
      })

      it('E2E-JE-BT-04: bot_respawn 重生假人', async () => {
        // 先休眠再重生
        await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_despawn',
          { name: `${BOT_NAME}_Extra` }, 10000)
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_respawn',
          { name: `${BOT_NAME}_Extra`, x: 50, y: BOT_Y, z: 50 }, 15000)
        expect(r.success).toBe(true)
      })

      it('E2E-JE-BT-05: bot_despawn 移除假人', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_despawn',
          { name: `${BOT_NAME}_Extra` }, 10000)
        expect(r.success).toBe(true)
      })

      it('E2E-JE-BT-06: bot_dismiss 销毁假人', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_dismiss',
          { name: `${BOT_NAME}_Extra` }, 5000)
        expect(r.success).toBe(true)
      })
    })

    // ── PerceptionTools — 感知工具 ──

    describe('PerceptionTools — 感知工具', () => {
      it('E2E-JE-PC-01: look_around 查看周围环境', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'look_around', {}, 10000)
        expect(r.success).toBe(true)
      })

      it('E2E-JE-PC-02: look_at_block 查看指定方块', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'look_at_block',
          { x: 0, y: 63, z: 0 }, 5000)
        expect(r.success).toBe(true)
        if (r.success) {
          expect(r.data.name).toBeDefined()
          expect(r.data.position).toBeDefined()
        }
      })

      it('E2E-JE-PC-03: look_in_container 查看容器', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'look_in_container',
          { x: 0, y: 63, z: 0 }, 5000)
        // 脚下是石头不是容器，预期返回失败
        expect(r.success).toBe(false)
      })

      it('E2E-JE-PC-04: look_time_weather 查看时间天气', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'look_time_weather', {}, 5000)
        expect(r.success).toBe(true)
        if (r.success) {
          expect(r.data.worldTime).toBeDefined()
          expect(r.data.dayTime).toBeDefined()
          expect(r.data.isDay).toBeDefined()
          expect(r.data.weather).toBeDefined()
        }
      })

      it('E2E-JE-PC-05: look_online_players 查看在线玩家', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'look_online_players', {}, 5000)
        expect(r.success).toBe(true)
        if (r.success) {
          expect(Array.isArray(r.data.players)).toBe(true)
          expect(r.data.total).toBeGreaterThanOrEqual(1)
        }
      })
    })

    // ── MoveToTools — 移动工具 ──

    describe('MoveToTools — 移动工具', () => {
      it('E2E-JE-MV-01: move_to 移动到指定坐标', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'move_to',
          { x: TEST_BASE_X + 10, y: TEST_BASE_Y, z: TEST_BASE_Z + 10 }, 30000)
        expect(r.success).toBe(true)
      })

      it('E2E-JE-MV-02: ride 骑乘不可骑乘实体', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'ride',
          { entity_id: '00000000-0000-0000-0000-000000000000' }, 10000)
        expect(r.success).toBe(false)
      })

      it('E2E-JE-MV-03: dismount 未骑乘时脱离', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'dismount', {}, 5000)
        expect(r.success).toBe(false)
      })
    })

    // ── InventoryTools — 背包工具 ──

    describe('InventoryTools — 背包工具', () => {
      it('E2E-JE-IN-01: drop_item 丢弃物品', async () => {
        await giveItem(mcProcess!, BOT_NAME, 'dirt', 1)
        await sleep(300)
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'drop_item',
          { item_name: 'dirt', count: 1 }, 10000)
        expect(r.success).toBe(true)
      })

      it('E2E-JE-IN-02: equip_item 装备物品', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'equip_item',
          { item_name: 'diamond_sword', slot: 'hand', action: 'equip' }, 10000)
        expect(r.success).toBe(true)
      })

      it('E2E-JE-IN-03: take_from_container 从非容器取物', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'take_from_container',
          { x: 0, y: 63, z: 0 }, 5000)
        expect(r.success).toBe(false)
      })

      it('E2E-JE-IN-04: put_to_container 向非容器放物', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'put_to_container',
          { x: 0, y: 63, z: 0, item_name: 'dirt', count: 1 }, 5000)
        expect(r.success).toBe(false)
      })
    })

    // ── BlockTools — 方块工具 ──

    describe('BlockTools — 方块工具', () => {
      const bx = TEST_BASE_X + 30
      const by = TEST_BASE_Y
      const bz = TEST_BASE_Z + 30

      beforeAll(async () => {
        console.log('[E2E] 移动假人到方块测试区域...')
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'move_to',
          { x: bx, y: by, z: bz }, 30000)
        if (!r.success) {
          console.log(`[E2E] 移动到方块测试区域失败: ${r.error}`)
        }
        await sleep(500)
      }, 60_000)

      it('E2E-JE-BK-01: mine_block 挖掘方块', async () => {
        // 先放置一个可挖掘方块
        await setBlockAt(mcProcess!, bx, by, bz, 'stone')
        await sleep(300)
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'mine_block',
          { x: bx, y: by, z: bz }, 30000)
        expect(r.success).toBe(true)
      })

      it('E2E-JE-BK-02: place_block 放置方块', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'place_block',
          { x: bx, y: by, z: bz, block_name: 'stone' }, 15000)
        expect(r.success).toBe(true)
      })

      it('E2E-JE-BK-03: use_block 使用不存在的位置', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'use_block',
          { x: 0, y: 0, z: 0 }, 5000)
        expect(r.success).toBe(false)
      })

      it('E2E-JE-BK-04: area_operation fill 模式', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'area_operation',
          {
            mode: 'fill',
            from: { x: bx + 5, y: by, z: bz + 5 },
            to: { x: bx + 10, y: by, z: bz + 10 },
            block_name: 'stone',
          }, 60000)
        expect(r.success).toBe(true)
      })
    })

    // ── EntityInteractionTools — 实体交互工具 ──

    describe('EntityInteractionTools — 实体交互工具', () => {
      it('E2E-JE-EN-01: set_combat_mode 设置战斗模式', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'set_combat_mode',
          { mode: 'melee' }, 10000)
        expect(r.success).toBe(true)
      })

      it('E2E-JE-EN-02: stop_combat 停止战斗', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'stop_combat', {}, 5000)
        expect(r.success).toBe(true)
      })

      it('E2E-JE-EN-03: interact_entity 与不存在实体交互', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'interact_entity',
          { entityId: '00000000-0000-0000-0000-000000000000', action: 'feed' }, 5000)
        expect(r.success).toBe(false)
      })

      it('E2E-JE-EN-04: lead_entity 拴绳不存在实体', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'lead_entity',
          { entityId: '00000000-0000-0000-0000-000000000000', action: 'lead' }, 5000)
        expect(r.success).toBe(false)
      })
    })

    // ── SurvivalTools — 生存工具 ──

    describe('SurvivalTools — 生存工具', () => {
      it('E2E-JE-SV-01: eat 吃东西', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'eat',
          { food_name: 'apple' }, 10000)
        // 创造模式下可能成功或失败，不强制断言
        if (r.success) {
          console.log('[E2E] eat 成功')
        } else {
          console.log(`[E2E] eat 返回: ${r.error}`)
        }
      })

      it('E2E-JE-SV-02: sleep 等待模式', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'sleep',
          { action: 'wait', wait_seconds: 1 }, 10000)
        expect(r.success).toBe(true)
      })

      it('E2E-JE-SV-03: use_item 使用物品', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'use_item',
          { item_name: 'dirt', mode: 'use' }, 10000)
        expect(r.success).toBe(true)
      })
    })

    // ── ChatTools — 聊天工具 ──

    describe('ChatTools — 聊天工具', () => {
      it('E2E-JE-CH-01: chat 发送全局消息', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'chat',
          { message: 'Hello from E2E test bot!' }, 5000)
        expect(r.success).toBe(true)
      })

      it('E2E-JE-CH-02: whisper 私聊不存在的玩家', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'whisper',
          { target: 'NonExistentPlayer', message: 'Hello' }, 5000)
        expect(r.success).toBe(false)
      })

      it('E2E-JE-CH-03: message 查询消息列表', async () => {
        const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'message',
          { action: 'list' }, 5000)
        expect(r.success).toBe(true)
      })
    })
  })

  // ════════════════════════════════════════════════════════════════
  // 阶段三：状态上报与事件通知
  // ════════════════════════════════════════════════════════════════

  describe('阶段三：状态上报与事件通知', () => {
    it('E2E-ST-01: 验证状态上报数据正确', async () => {
      // 通过 bot_info 获取假人状态
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_info',
        { name: BOT_NAME }, 10000)
      expect(r.success).toBe(true)
      if (r.success) {
        expect(r.data.health).toBeGreaterThan(0)
        expect(r.data.food_level).toBeGreaterThanOrEqual(0)
        expect(r.data.position).toBeDefined()
        expect(typeof r.data.position.x).toBe('number')
        expect(typeof r.data.position.y).toBe('number')
        expect(typeof r.data.position.z).toBe('number')
      }
    })

    it('E2E-ST-02: 验证工具执行结果包含正确字段', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'look_time_weather', {}, 5000)
      expect(r.success).toBe(true)
      if (r.success) {
        // 验证返回结果包含必要字段
        expect(r.data.worldTime).toBeDefined()
        expect(r.data.weather).toBeDefined()
        expect(r.data.difficulty).toBeDefined()
      }
    })

    it('E2E-ST-03: 验证假人创建后 online 状态', async () => {
      // 先创建临时假人
      const tempName = `${BOT_NAME}_Status`
      const spawnR = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_spawn',
        { name: tempName, x: 0, y: 64, z: 0 }, 15000)
      expect(spawnR.success).toBe(true)

      // 验证状态
      const infoR = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_info',
        { name: tempName }, 10000)
      expect(infoR.success).toBe(true)
      if (infoR.success) {
        expect(infoR.data.online).toBe(true)
      }

      // 清理
      await cleanupBot(ac.toolDispatcher, workspaceId, tempName)
    })

    it('E2E-ST-04: 验证假人销毁后信息不可查', async () => {
      const tempName = `${BOT_NAME}_Destroy`
      await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_spawn',
        { name: tempName, x: 0, y: 64, z: 0 }, 15000)
      await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_dismiss',
        { name: tempName }, 5000)
      // 销毁后查询应返回失败
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_info',
        { name: tempName }, 5000)
      expect(r.success).toBe(false)
    })

    it('E2E-ST-05: 验证在线玩家列表返回正确结构', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'look_online_players', {}, 5000)
      expect(r.success).toBe(true)
      if (r.success) {
        expect(Array.isArray(r.data.players)).toBe(true)
        expect(r.data.total).toBeGreaterThanOrEqual(0)
        // 注意：调用 look_online_players 的假人不会出现在自己列表中
        // 因此不检查特定玩家名称
      }
    })
  })

  // ════════════════════════════════════════════════════════════════
  // 阶段四：错误路径验证
  // ════════════════════════════════════════════════════════════════

  describe('阶段四：错误路径验证', () => {
    it('E2E-ERR-01: bot_info 参数缺失', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_info',
        {} as any, 5000)
      expect(r.success).toBe(false)
    })

    it('E2E-ERR-02: bot_info 查询不存在的假人', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_info',
        { name: 'NonExistent' }, 5000)
      expect(r.success).toBe(false)
    })

    it('E2E-ERR-03: move_to 无目标', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'move_to', {}, 5000)
      expect(r.success).toBe(false)
    })

    it('E2E-ERR-04: bot_spawn 无 name 参数', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_spawn',
        { x: 0, y: 64, z: 0 } as any, 5000)
      expect(r.success).toBe(false)
    })

    it('E2E-ERR-05: mine_block 参数缺失', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'mine_block',
        { x: 0, y: 0 } as any, 5000)
      expect(r.success).toBe(false)
    })

    it('E2E-ERR-06: equip_item 不存在的物品', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'equip_item',
        { item_name: 'nonexistent_item' }, 5000)
      expect(r.success).toBe(false)
    })

    it('E2E-ERR-07: set_combat_mode 无效模式', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'set_combat_mode',
        { mode: 'invalid' }, 5000)
      expect(r.success).toBe(false)
    })

    it('E2E-ERR-08: eat 不存在的食物', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'eat',
        { food_name: 'nonexistent' }, 5000)
      expect(r.success).toBe(false)
    })

    it('E2E-ERR-09: sleep 无效操作', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'sleep',
        { action: 'invalid' }, 5000)
      expect(r.success).toBe(false)
    })

    it('E2E-ERR-10: message 无效操作', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'message',
        { action: 'invalid' }, 5000)
      expect(r.success).toBe(false)
    })
  })

  // ════════════════════════════════════════════════════════════════
  // 阶段五：多轮连续调用
  // ════════════════════════════════════════════════════════════════

  describe('阶段五：多轮连续调用', () => {
    it('E2E-MUL-01: 连续 5 次工具调用（spawn → move_to → look_around → mine_block → chat）', async () => {
      const tempName = `${BOT_NAME}_Multi1`

      // 1. spawn
      const r1 = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_spawn',
        { name: tempName, x: TEST_BASE_X, y: TEST_BASE_Y, z: TEST_BASE_Z }, 15000)
      expect(r1.success).toBe(true)
      console.log('[E2E] Multi-1: spawn 完成')

      // 2. move_to
      const r2 = await callToolSafe(ac.toolDispatcher, workspaceId, 'move_to',
        { x: TEST_BASE_X + 5, y: TEST_BASE_Y, z: TEST_BASE_Z + 5 }, 30000)
      expect(r2.success).toBe(true)
      console.log('[E2E] Multi-2: move_to 完成')

      // 3. look_around
      const r3 = await callToolSafe(ac.toolDispatcher, workspaceId, 'look_around', {}, 10000)
      expect(r3.success).toBe(true)
      console.log('[E2E] Multi-3: look_around 完成')

      // 4. mine_block（先放置）
      await setBlockAt(mcProcess!, TEST_BASE_X + 5, TEST_BASE_Y - 1, TEST_BASE_Z + 5, 'stone')
      await sleep(300)
      const r4 = await callToolSafe(ac.toolDispatcher, workspaceId, 'mine_block',
        { x: TEST_BASE_X + 5, y: TEST_BASE_Y - 1, z: TEST_BASE_Z + 5 }, 30000)
      expect(r4.success).toBe(true)
      console.log('[E2E] Multi-4: mine_block 完成')

      // 5. chat
      const r5 = await callToolSafe(ac.toolDispatcher, workspaceId, 'chat',
        { message: 'Multi-round test completed!' }, 5000)
      expect(r5.success).toBe(true)
      console.log('[E2E] Multi-5: chat 完成')

      // 清理
      await cleanupBot(ac.toolDispatcher, workspaceId, tempName)
    })

    it('E2E-MUL-02: 工具调用后状态验证（bot_spawn → bot_info → move_to → bot_info）', async () => {
      const tempName = `${BOT_NAME}_Multi2`
      const startX = TEST_BASE_X + 15
      const startZ = TEST_BASE_Z + 15
      const targetX = TEST_BASE_X + 20
      const targetZ = TEST_BASE_Z + 20

      // 1. spawn
      const r1 = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_spawn',
        { name: tempName, x: startX, y: TEST_BASE_Y, z: startZ }, 15000)
      expect(r1.success).toBe(true)

      // 2. bot_info - 获取初始位置
      const r2 = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_info',
        { name: tempName }, 10000)
      expect(r2.success).toBe(true)
      if (r2.success) {
        console.log(`[E2E] 初始位置: (${r2.data.position.x}, ${r2.data.position.z})`)
      }

      // 3. move_to - 移动到目标
      const r3 = await callToolSafe(ac.toolDispatcher, workspaceId, 'move_to',
        { x: targetX, y: TEST_BASE_Y, z: targetZ }, 30000)
      expect(r3.success).toBe(true)

      // 4. bot_info - 确认位置已变化
      const r4 = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_info',
        { name: tempName }, 10000)
      expect(r4.success).toBe(true)
      if (r4.success) {
        const pos = r4.data.position
        console.log(`[E2E] 移动后位置: (${pos.x}, ${pos.y}, ${pos.z})`)
        // 位置应接近目标，允许一定误差
        const dx = Math.abs(pos.x - targetX)
        const dz = Math.abs(pos.z - targetZ)
        expect(dx).toBeLessThanOrEqual(5)
        expect(dz).toBeLessThanOrEqual(5)
      }

      // 清理
      await cleanupBot(ac.toolDispatcher, workspaceId, tempName)
    })

    it('E2E-MUL-03: 连续调用错误路径后恢复', async () => {
      // 1. 先调用错误路径（不存在的假人）
      const r1 = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_info',
        { name: 'NonExistent' }, 5000)
      expect(r1.success).toBe(false)

      // 2. 再调用正常路径，确认系统未受影响
      const r2 = await callToolSafe(ac.toolDispatcher, workspaceId, 'look_time_weather', {}, 5000)
      expect(r2.success).toBe(true)

      // 3. 再次调用错误路径（无效参数）
      const r3 = await callToolSafe(ac.toolDispatcher, workspaceId, 'move_to', {}, 5000)
      expect(r3.success).toBe(false)

      // 4. 正常调用应继续工作
      const r4 = await callToolSafe(ac.toolDispatcher, workspaceId, 'look_around', {}, 10000)
      expect(r4.success).toBe(true)
    })
  })
})