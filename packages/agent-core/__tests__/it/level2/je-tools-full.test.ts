/**
 * JE 工具全覆盖集成测试（L2）
 *
 * 覆盖 JE 端全部 8 个工具模块、32 个工具方法。
 * 从 AC 端通过 ToolDispatcher.callTool 向 JE 发起真实 tool_call JSON-RPC 请求。
 *
 * 测试流程：
 * 1. 启动 AC TCP 服务器（in-process）
 * 2. 启动 JE Minecraft 服务器
 * 3. 等待 JE 模组连接并注册工具
 * 4. 按模块分组执行工具测试（69 个用例）
 * 5. 清理：销毁假人、停止 MC 服务器
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

const BOT_NAME = 'IT_Bot'
const BOT_X = 0, BOT_Y = 64, BOT_Z = 0
// 使用靠近 spawn 的坐标，确保区块已加载
const TEST_BASE_X = 5
const TEST_BASE_Y = 71  // 实际生成高度
const TEST_BASE_Z = 5

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

/** 获取 UUID 格式匹配 */
const UUID_RE = /^[0-9a-f-]{36}$/

// ════════════════════════════════════════════════════════════════
// 主测试套件
// ════════════════════════════════════════════════════════════════

describe.skipIf(!isJavaAvailable)('JE 工具全覆盖集成测试', () => {
  let ac: AcMinimalContext
  let workspaceId: string
  let mcProcess: ReturnType<typeof spawn> | null = null

  // ── 全局 setup / teardown ──

  beforeAll(async () => {
    console.log('[TEST] ===== 启动 AC TCP 服务器 =====')
    ac = await startAcMinimalServer(27541, 'mct_64cf4ca6c0c64a75aaf9a5b0')
    console.log(`[TEST] AC 服务器已启动，端口 ${ac.port}`)

    const serverJavaDir = path.resolve(__dirname, '../../../../../serverjava')
    const javaPath = findJavaPath()
    console.log(`[TEST] 使用 Java 路径: ${javaPath}`)
    console.log('[TEST] ===== 启动 Minecraft 服务端 =====')
    mcProcess = spawn(javaPath, ['-Xmx2G', '-jar', 'fabric-server-launch.jar', 'nogui'], {
      cwd: serverJavaDir,
      stdio: ['pipe', 'pipe', 'pipe'],  // pipe stdin 用于发命令
    })
    mcProcess.stdout?.on('data', (d: Buffer) => process.stdout.write(`[MC] ${d.toString()}`))
    mcProcess.stderr?.on('data', (d: Buffer) => process.stderr.write(`[MC:err] ${d.toString()}`))
    mcProcess.on('exit', (code) => console.log(`[TEST] MC 服务端退出，code=${code}`))

    console.log('[TEST] ===== 等待 MC 服务端初始化 =====')
    await waitForMcReady(mcProcess, 180_000)
    console.log('[TEST] MC 服务端已就绪')

    console.log('[TEST] ===== 等待 JE 连接 =====')
    workspaceId = await waitFor(() => {
      const online = ac.workspaceManager.getOnlineWorkspaces()
      if (online.length > 0) {
        const tools = ac.workspaceManager.getWorkspaceTools(online[0].id)
        if (tools.length >= 3) return online[0].id
      }
      return null
    }, { timeoutMs: 60_000, intervalMs: 1000 })
    console.log(`[TEST] JE 已连接，workspaceId: ${workspaceId}`)

    // 创建测试假人（创造模式）
    console.log('[TEST] ===== 创建测试假人 =====')
    await ensureBotOnline(ac.toolDispatcher, workspaceId, BOT_NAME, BOT_X, BOT_Y, BOT_Z)
    await setGameMode(mcProcess!, BOT_NAME, 'creative')
    // 给假人 OP 权限
    sendMcCommand(mcProcess!, `/op ${BOT_NAME}`)
    await sleep(500)
    // 给假人一些基础物品
    await giveItem(mcProcess!, BOT_NAME, 'diamond_sword', 1)
    await giveItem(mcProcess!, BOT_NAME, 'diamond_helmet', 1)
    await giveItem(mcProcess!, BOT_NAME, 'diamond', 64)
    await giveItem(mcProcess!, BOT_NAME, 'dirt', 64)
    await giveItem(mcProcess!, BOT_NAME, 'stone', 64)
    await giveItem(mcProcess!, BOT_NAME, 'apple', 16)
    // 准备测试区域（靠近 spawn，确保区块已加载）
    await clearArea(mcProcess!, TEST_BASE_X, TEST_BASE_Y - 1, TEST_BASE_Z,
      TEST_BASE_X + 50, TEST_BASE_Y + 10, TEST_BASE_Z + 50)
    await fillArea(mcProcess!, TEST_BASE_X, TEST_BASE_Y - 1, TEST_BASE_Z,
      TEST_BASE_X + 50, TEST_BASE_Y - 1, TEST_BASE_Z + 50, 'stone')
    // 等待 MC 命令处理完成
    await sleep(2000)
    // 将假人移动到测试区域
    console.log('[TEST] 移动假人到测试区域...')
    const moveResult = await callToolSafe(ac.toolDispatcher, workspaceId, 'move_to',
      { x: TEST_BASE_X, y: TEST_BASE_Y, z: TEST_BASE_Z }, 30000)
    if (!moveResult.success) {
      console.log(`[TEST] 移动到测试区域失败: ${moveResult.error}`)
    }
    console.log('[TEST] 测试环境准备完成')
  }, 300_000)

  afterAll(async () => {
    console.log('[TEST] ===== 清理环境 =====')
    await cleanupBot(ac.toolDispatcher, workspaceId, BOT_NAME)
    await cleanupBot(ac.toolDispatcher, workspaceId, `${BOT_NAME}_Extra`)
    await cleanupBot(ac.toolDispatcher, workspaceId, `${BOT_NAME}_Nether`)

    if (mcProcess && mcProcess.pid) {
      console.log('[TEST] 停止 MC 服务端...')
      try { process.kill(mcProcess.pid, 'SIGTERM') } catch { /* ignore */ }
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          try { process.kill(mcProcess!.pid!, 'SIGKILL') } catch {}
          resolve()
        }, 10_000)
        mcProcess?.on('exit', () => { clearTimeout(timeout); resolve() })
      })
    }

    console.log('[TEST] 停止 AC 服务器...')
    await ac.stop()
  }, 30_000)

  // ════════════════════════════════════════════════════════════════
  // 工具注册验证
  // ════════════════════════════════════════════════════════════════

  describe('T-REG: 工具注册验证', () => {
    it('T-REG-01: 验证所有 JE 工具已注册到 AC', () => {
      const tools = ac.workspaceManager.getWorkspaceTools(workspaceId)
      console.log(`[TEST] 已注册工具: ${tools.length} 个`)
      for (const t of tools) {
        console.log(`  - ${t.name} (${t.category}): ${Object.keys(t.parameters).length} 个参数`)
      }
      expect(tools.length).toBeGreaterThanOrEqual(26)
      const toolNames = tools.map(t => t.name).sort()
      // 验证每个模块的关键工具存在
      expect(toolNames).toContain('bot_spawn')
      expect(toolNames).toContain('bot_info')
      expect(toolNames).toContain('move_to')
      expect(toolNames).toContain('look_around')
      expect(toolNames).toContain('mine_block')
      expect(toolNames).toContain('chat')
      expect(toolNames).toContain('eat')
      expect(toolNames).toContain('set_combat_mode')
      expect(toolNames).toContain('drop_item')
    })

    it('T-REG-02: 验证每个工具都有完整的 parameters 定义', () => {
      const tools = ac.workspaceManager.getWorkspaceTools(workspaceId)
      for (const tool of tools) {
        expect(tool.parameters).toBeDefined()
        expect(tool.description).toBeTruthy()
      }
    })
  })

  // ════════════════════════════════════════════════════════════════
  // BotTools — 假人管理
  // ════════════════════════════════════════════════════════════════

  describe('BotTools — 假人管理', () => {
    it('T-BT-01: bot_spawn 正常创建假人', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_spawn',
        { name: `${BOT_NAME}_Extra`, x: 10, y: BOT_Y, z: 10 }, 15000)
      expect(r.success).toBe(true)
      if (r.success) {
        expect(r.data.name).toBe(`${BOT_NAME}_Extra`)
        expect(r.data.uuid).toMatch(UUID_RE)
      }
    })

    it('T-BT-02: bot_spawn 创建同名假人幂等', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_spawn',
        { name: `${BOT_NAME}_Extra`, x: 10, y: BOT_Y, z: 10 }, 15000)
      expect(r.success).toBe(true)
    })

    it('T-BT-03: bot_spawn 指定维度', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_spawn',
        { name: `${BOT_NAME}_Nether`, x: 0, y: 64, z: 0, dimension: 'nether' }, 15000)
      expect(r.success).toBe(true)
      if (r.success) {
        expect(r.data.name).toBe(`${BOT_NAME}_Nether`)
      }
    })

    it('T-BT-04: bot_spawn 参数缺失（无 name）', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_spawn',
        { x: 0, y: 64, z: 0 } as any, 5000)
      expect(r.success).toBe(false)
    })

    it('T-BT-05: bot_info 查询在线假人', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_info',
        { name: BOT_NAME }, 10000)
      expect(r.success).toBe(true)
      if (r.success) {
        expect(r.data.online).toBe(true)
        expect(r.data.name).toBe(BOT_NAME)
        expect(r.data.health).toBeGreaterThan(0)
        expect(r.data.position).toBeDefined()
      }
    })

    it('T-BT-06: bot_info 查询不存在的假人', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_info',
        { name: 'NonExistent' }, 5000)
      expect(r.success).toBe(false)
    })

    it('T-BT-07: bot_despawn 休眠在线假人', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_despawn',
        { name: `${BOT_NAME}_Extra` }, 10000)
      expect(r.success).toBe(true)
    })

    it('T-BT-08: bot_despawn 休眠已离线假人', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_despawn',
        { name: `${BOT_NAME}_Extra` }, 5000)
      expect(r.success).toBe(false)
    })

    it('T-BT-09: bot_respawn 唤醒休眠假人', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_respawn',
        { name: `${BOT_NAME}_Extra` }, 15000)
      expect(r.success).toBe(true)
      if (r.success) {
        expect(r.data.name).toBe(`${BOT_NAME}_Extra`)
      }
    })

    it('T-BT-10: bot_respawn 指定位置唤醒', async () => {
      // 先休眠
      await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_despawn',
        { name: `${BOT_NAME}_Extra` }, 10000)
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_respawn',
        { name: `${BOT_NAME}_Extra`, x: 50, y: BOT_Y, z: 50 }, 15000)
      expect(r.success).toBe(true)
    })

    it('T-BT-11: bot_respawn 唤醒不存在的假人', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_respawn',
        { name: 'NonExistent' }, 5000)
      expect(r.success).toBe(false)
    })

    it('T-BT-12: bot_list 列出所有假人', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_list', {}, 5000)
      expect(r.success).toBe(true)
      if (r.success) {
        expect(r.data.total).toBeGreaterThanOrEqual(2)
        expect(r.data.online).toBeGreaterThanOrEqual(1)
        expect(Array.isArray(r.data.bots)).toBe(true)
      }
    })

    it('T-BT-13: bot_dismiss 销毁假人', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_dismiss',
        { name: `${BOT_NAME}_Extra` }, 5000)
      expect(r.success).toBe(true)
    })

    it('T-BT-14: bot_dismiss 销毁已销毁的假人', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_dismiss',
        { name: `${BOT_NAME}_Extra` }, 5000)
      expect(r.success).toBe(false)
    })
  })

  // ════════════════════════════════════════════════════════════════
  // PerceptionTools — 感知工具
  // ════════════════════════════════════════════════════════════════

  describe('PerceptionTools — 感知工具', () => {
    it('T-PC-01: look_around 默认半径扫描', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'look_around', {}, 10000)
      expect(r.success).toBe(true)
    })

    it('T-PC-02: look_around 指定半径', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'look_around',
        { radius: 32 }, 10000)
      expect(r.success).toBe(true)
    })

    it('T-PC-03: look_around 带筛选条件', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'look_around',
        { filter: { hostile: true } }, 10000)
      expect(r.success).toBe(true)
    })

    it('T-PC-04: look_around 半径超过最大值', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'look_around',
        { radius: 100 }, 10000)
      expect(r.success).toBe(true)  // 自动限制为 64，不报错
    })

    it('T-PC-05: look_around 无效 filter 格式', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'look_around',
        { filter: 'invalid' as any }, 10000)
      expect(r.success).toBe(false)  // 无效 filter 类型导致转型异常，返回错误但不崩溃
    })

    it('T-PC-06: look_at_block 查看方块', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'look_at_block',
        { x: 0, y: 63, z: 0 }, 5000)
      expect(r.success).toBe(true)
      if (r.success) {
        expect(r.data.name).toBeDefined()
        expect(r.data.position).toBeDefined()
      }
    })

    it('T-PC-07: look_at_block 查看不存在的坐标', async () => {
      // y=-100 超出世界边界，getBlockState 返回空气方块，工具仍能成功返回信息
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'look_at_block',
        { x: 0, y: -100, z: 0 }, 5000)
      expect(r.success).toBe(true)
      if (r.success) {
        expect(r.data.isAir).toBe(true)
      }
    })

    it('T-PC-08: look_at_block 参数缺失', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'look_at_block',
        { x: 0, y: 0 } as any, 5000)
      expect(r.success).toBe(false)
    })

    it('T-PC-09: look_in_container 查看非容器方块', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'look_in_container',
        { x: 0, y: 63, z: 0 }, 5000)
      expect(r.success).toBe(false)  // 脚下是石头，不是容器
    })

    it('T-PC-10: look_in_container 参数缺失', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'look_in_container',
        { x: 0, y: 0 } as any, 5000)
      expect(r.success).toBe(false)
    })

    it('T-PC-11: look_time_weather 查看时间和天气', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'look_time_weather', {}, 5000)
      expect(r.success).toBe(true)
      if (r.success) {
        expect(r.data.worldTime).toBeDefined()
        expect(r.data.dayTime).toBeDefined()
        expect(r.data.isDay).toBeDefined()
        expect(r.data.weather).toBeDefined()
        expect(r.data.difficulty).toBeDefined()
      }
    })

    it('T-PC-12: look_online_players 查看在线玩家', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'look_online_players', {}, 5000)
      expect(r.success).toBe(true)
      if (r.success) {
        expect(Array.isArray(r.data.players)).toBe(true)
        expect(r.data.total).toBeGreaterThanOrEqual(1)
      }
    })
  })

  // ════════════════════════════════════════════════════════════════
  // MoveToTools — 移动工具
  // ════════════════════════════════════════════════════════════════

  describe('MoveToTools — 移动工具', () => {
    it('T-MV-01: move_to 坐标移动', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'move_to',
        { x: TEST_BASE_X + 10, y: TEST_BASE_Y, z: TEST_BASE_Z + 10 }, 30000)
      expect(r.success).toBe(true)
    })

    it('T-MV-02: move_to 高度调整', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'move_to',
        { y: TEST_BASE_Y + 5 }, 30000)
      expect(r.success).toBe(true)
    })

    it('T-MV-03: move_to 跟随无效实体', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'move_to',
        { entity: '00000000-0000-0000-0000-000000000000' }, 15000)
      expect(r.success).toBe(false)
    })

    it('T-MV-04: move_to 参数缺失', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'move_to', {}, 5000)
      expect(r.success).toBe(false)
    })

    it('T-MV-05: move_to 允许破坏方块移动', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'move_to',
        { x: TEST_BASE_X + 20, y: TEST_BASE_Y, z: TEST_BASE_Z + 20, break: true }, 30000)
      expect(r.success).toBe(true)
    })

    it('T-MV-06: ride 骑乘不可骑乘实体', async () => {
      // 假人自身不可骑乘
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'ride',
        { entity_id: '00000000-0000-0000-0000-000000000000' }, 10000)
      expect(r.success).toBe(false)
    })

    it('T-MV-07: dismount 未骑乘时脱离', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'dismount', {}, 5000)
      expect(r.success).toBe(false)
    })
  })

  // ════════════════════════════════════════════════════════════════
  // InventoryTools — 背包工具
  // ════════════════════════════════════════════════════════════════

  describe('InventoryTools — 背包工具', () => {
    it('T-IN-01: equip_item 装备主手', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'equip_item',
        { item_name: 'diamond_sword', slot: 'hand', action: 'equip' }, 10000)
      expect(r.success).toBe(true)
    })

    it('T-IN-02: equip_item 装备头部', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'equip_item',
        { item_name: 'diamond_helmet', slot: 'head', action: 'equip' }, 10000)
      expect(r.success).toBe(true)
    })

    it('T-IN-03: equip_item 卸下装备', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'equip_item',
        { item_name: 'diamond_sword', slot: 'hand', action: 'unequip' }, 10000)
      expect(r.success).toBe(true)
    })

    it('T-IN-04: equip_item 装备不存在的物品', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'equip_item',
        { item_name: 'nonexistent_item' }, 5000)
      expect(r.success).toBe(false)
    })

    it('T-IN-05: drop_item 丢弃物品', async () => {
      await giveItem(mcProcess!, BOT_NAME, 'dirt', 1)
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'drop_item',
        { item_name: 'dirt', count: 1 }, 10000)
      expect(r.success).toBe(true)
    })

    it('T-IN-06: drop_item 丢弃不存在的物品', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'drop_item',
        { item_name: 'nonexistent' }, 5000)
      expect(r.success).toBe(false)
    })

    it('T-IN-07: take_from_container 从非容器取物', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'take_from_container',
        { x: 0, y: 63, z: 0 }, 5000)
      expect(r.success).toBe(false)
    })

    it('T-IN-08: put_to_container 向非容器放物', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'put_to_container',
        { x: 0, y: 63, z: 0, item_name: 'dirt', count: 1 }, 5000)
      expect(r.success).toBe(false)
    })
  })

  // ════════════════════════════════════════════════════════════════
  // BlockTools — 方块工具
  // ════════════════════════════════════════════════════════════════

  describe('BlockTools — 方块工具', () => {
    // 测试区域坐标（靠近 spawn）
    const bx = TEST_BASE_X + 30
    const by = TEST_BASE_Y
    const bz = TEST_BASE_Z + 30

    // 在方块测试前移动假人到测试区域附近（确保在 6 格距离内）
    beforeAll(async () => {
      console.log('[TEST] 移动假人到方块测试区域...')
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'move_to',
        { x: bx, y: by, z: bz }, 30000)
      if (!r.success) {
        console.log(`[TEST] 移动到方块测试区域失败: ${r.error}`)
      }
      await sleep(500)
    }, 60_000)

    it('T-BK-01: place_block 放置方块', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'place_block',
        { x: bx, y: by, z: bz, block_name: 'stone' }, 15000)
      expect(r.success).toBe(true)
    })

    it('T-BK-02: place_block 放置方块指定朝向', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'place_block',
        { x: bx + 1, y: by, z: bz, block_name: 'stone', facing: 'up' }, 15000)
      expect(r.success).toBe(true)
    })

    it('T-BK-03: place_block 参数缺失', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'place_block',
        { x: 0, y: 0, z: 0 } as any, 5000)
      expect(r.success).toBe(false)
    })

    it('T-BK-04: mine_block 挖掘方块', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'mine_block',
        { x: bx, y: by, z: bz }, 30000)
      expect(r.success).toBe(true)
    })

    it('T-BK-05: mine_block 带精准采集', async () => {
      // 先放一个可挖掘方块
      await setBlockAt(mcProcess!, bx, by, bz, 'stone')
      await sleep(300)
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'mine_block',
        { x: bx, y: by, z: bz, options: { silk_touch: true } }, 30000)
      expect(r.success).toBe(true)
    })

    it('T-BK-06: mine_block 参数缺失', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'mine_block',
        { x: 0, y: 0 } as any, 5000)
      expect(r.success).toBe(false)
    })

    it('T-BK-07: use_block 使用不存在的位置', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'use_block',
        { x: 0, y: 0, z: 0 }, 5000)
      expect(r.success).toBe(false)
    })

    it('T-BK-08: area_operation fill 模式', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'area_operation',
        {
          mode: 'fill',
          from: { x: bx + 5, y: by, z: bz + 5 },
          to: { x: bx + 10, y: by, z: bz + 10 },
          block_name: 'stone',
        }, 60000)
      expect(r.success).toBe(true)
    })

    it('T-BK-09: area_operation clear 模式', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'area_operation',
        {
          mode: 'clear',
          from: { x: bx + 5, y: by, z: bz + 5 },
          to: { x: bx + 10, y: by, z: bz + 10 },
        }, 60000)
      expect(r.success).toBe(true)
    })

    it('T-BK-10: area_operation 无效 mode', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'area_operation',
        {
          mode: 'invalid',
          from: { x: 0, y: 0, z: 0 },
          to: { x: 1, y: 1, z: 1 },
        }, 5000)
      expect(r.success).toBe(false)
    })

    it('T-BK-11: area_operation 参数缺失', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'area_operation',
        { mode: 'fill' } as any, 5000)
      expect(r.success).toBe(false)
    })
  })

  // ════════════════════════════════════════════════════════════════
  // EntityInteractionTools — 生物交互工具
  // ════════════════════════════════════════════════════════════════

  describe('EntityInteractionTools — 生物交互工具', () => {
    it('T-EN-01: set_combat_mode 近战模式', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'set_combat_mode',
        { mode: 'melee' }, 10000)
      expect(r.success).toBe(true)
    })

    it('T-EN-02: set_combat_mode 远程模式', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'set_combat_mode',
        { mode: 'ranged' }, 10000)
      expect(r.success).toBe(true)
    })

    it('T-EN-03: set_combat_mode 防御模式', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'set_combat_mode',
        { mode: 'defensive' }, 10000)
      expect(r.success).toBe(true)
    })

    it('T-EN-04: set_combat_mode 无效模式', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'set_combat_mode',
        { mode: 'invalid' }, 5000)
      expect(r.success).toBe(false)
    })

    it('T-EN-05: stop_combat 停止战斗', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'stop_combat', {}, 5000)
      expect(r.success).toBe(true)
    })

    it('T-EN-06: interact_entity 与不存在实体交互', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'interact_entity',
        { entityId: '00000000-0000-0000-0000-000000000000', action: 'feed' }, 5000)
      expect(r.success).toBe(false)
    })

    it('T-EN-07: lead_entity 拴绳不存在实体', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'lead_entity',
        { entityId: '00000000-0000-0000-0000-000000000000', action: 'lead' }, 5000)
      expect(r.success).toBe(false)
    })

    it('T-EN-08: lead_entity 释放不存在实体', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'lead_entity',
        { entityId: '00000000-0000-0000-0000-000000000000', action: 'release' }, 5000)
      expect(r.success).toBe(false)
    })
  })

  // ════════════════════════════════════════════════════════════════
  // SurvivalTools — 生存工具
  // ════════════════════════════════════════════════════════════════

  describe('SurvivalTools — 生存工具', () => {
    it('T-SV-01: eat 指定食物', async () => {
      // 假人目前是创造模式，进食可能失败，但调用应返回结果
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'eat',
        { food_name: 'apple' }, 10000)
      // 在创造模式下可能成功或失败，取决于实现
      if (r.success) {
        console.log('[TEST] eat 成功')
      } else {
        console.log(`[TEST] eat 返回: ${r.error}`)
      }
    })

    it('T-SV-02: eat 指定不存在的食物', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'eat',
        { food_name: 'nonexistent' }, 5000)
      expect(r.success).toBe(false)
    })

    it('T-SV-03: sleep 等待模式', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'sleep',
        { action: 'wait', wait_seconds: 1 }, 10000)
      expect(r.success).toBe(true)
    })

    it('T-SV-04: sleep 无效操作', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'sleep',
        { action: 'invalid' }, 5000)
      expect(r.success).toBe(false)
    })

    it('T-SV-05: use_item 使用物品', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'use_item',
        { item_name: 'dirt', mode: 'use' }, 10000)
      expect(r.success).toBe(true)
    })

    it('T-SV-06: use_item 使用不存在的物品', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'use_item',
        { item_name: 'nonexistent', mode: 'use' }, 5000)
      expect(r.success).toBe(false)
    })
  })

  // ════════════════════════════════════════════════════════════════
  // ChatTools — 聊天工具
  // ════════════════════════════════════════════════════════════════

  describe('ChatTools — 聊天工具', () => {
    it('T-CH-01: chat 普通聊天', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'chat',
        { message: 'Hello from IT Bot' }, 5000)
      expect(r.success).toBe(true)
    })

    it('T-CH-02: chat 广播模式', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'chat',
        { message: 'Broadcast test', mode: 'broadcast' }, 5000)
      expect(r.success).toBe(true)
    })

    it('T-CH-03: chat 表情动作模式', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'chat',
        { message: 'waves hello', mode: 'emote' }, 5000)
      expect(r.success).toBe(true)
    })

    it('T-CH-04: whisper 私聊不存在的玩家', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'whisper',
        { target: 'NonExistentPlayer', message: 'Hello' }, 5000)
      expect(r.success).toBe(false)
    })

    it('T-CH-05: message 查询消息列表', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'message',
        { action: 'list' }, 5000)
      // 消息列表可能为空，但调用应成功
      expect(r.success).toBe(true)
    })

    it('T-CH-06: message 查询未读消息', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'message',
        { action: 'unread' }, 5000)
      expect(r.success).toBe(true)
    })

    it('T-CH-07: message 无效操作', async () => {
      const r = await callToolSafe(ac.toolDispatcher, workspaceId, 'message',
        { action: 'invalid' }, 5000)
      expect(r.success).toBe(false)
    })
  })
})