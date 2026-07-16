/**
 * JE 端到端集成测试（L2）
 *
 * 测试流程：
 * 1. 启动 AC TCP 服务器（in-process）
 * 2. 启动 JE Minecraft 服务器
 * 3. 等待 JE 模组连接并注册工具
 * 4. 调用 bot_spawn 创建假人
 * 5. 调用 bot_info 查询假人
 * 6. 调用 move_to 移动假人
 * 7. 错误路径测试
 * 8. 清理：销毁假人、停止 AC 服务器
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { startAcMinimalServer, type AcMinimalContext } from '../fixtures/ac-minimal-server'

// 环境检查：缺少 JDK 21 时跳过整个测试套件
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
    } catch { /* 忽略 */ }
  }
  return false
}
const isJavaAvailable = hasJava21()

const SLEEP_INTERVAL = 500
const MAX_WAIT_MS = 60_000

async function waitFor<T>(
  fn: () => T | null | Promise<T | null>,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const timeout = opts.timeoutMs ?? MAX_WAIT_MS
  const interval = opts.intervalMs ?? SLEEP_INTERVAL
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await fn()
    if (result !== null && result !== undefined) return result
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`Timeout after ${timeout}ms`)
}

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
      // MC 服务端启动完成后会输出 "Done" 和启动时间
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

describe.skipIf(!isJavaAvailable)('L2 端到端: JE 工具注册与调用', () => {
  let ac: AcMinimalContext
  let workspaceId: string
  let mcProcess: ReturnType<typeof spawn> | null = null

  beforeAll(async () => {
    // 1. 先启动 AC TCP 服务器
    console.log('[TEST] 启动 AC TCP 服务器...')
    ac = await startAcMinimalServer(27541, 'mct_64cf4ca6c0c64a75aaf9a5b0')
    console.log(`[TEST] AC 服务器已启动，端口 ${ac.port}`)

    // 2. 启动 Minecraft 服务端（确保 AC 已就绪，JE 首次连接即成功）
    const serverJavaDir = path.resolve(__dirname, '../../../../../serverjava')
    // 按优先级查找 Java 路径：JAVA_HOME > JDK 21 安装目录 > PATH 中的 java
    // 使用 fs.realpathSync 解析符号链接/目录交接点，避免 spawn ENOENT
    let javaPath: string | undefined
    const candidates = [
      process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java.exe') : undefined,
      'C:\\Program Files\\Java\\latest\\jdk-21\\bin\\java.exe',
      'java.exe',
    ].filter(Boolean) as string[]
    for (const candidate of candidates) {
      try {
        const resolved = fs.realpathSync(candidate)
        if (fs.existsSync(resolved)) {
          javaPath = resolved
          break
        }
      } catch {
        // try next candidate
      }
    }
    if (!javaPath) javaPath = 'java.exe'
    console.log(`[TEST] 使用 Java 路径: ${javaPath}`)
    console.log('[TEST] 启动 Minecraft 服务端...')
    mcProcess = spawn(javaPath, ['-Xmx2G', '-jar', 'fabric-server-launch.jar', 'nogui'], {
      cwd: serverJavaDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    mcProcess.stdout?.on('data', (d: Buffer) => process.stdout.write(`[MC] ${d.toString()}`))
    mcProcess.stderr?.on('data', (d: Buffer) => process.stderr.write(`[MC:err] ${d.toString()}`))
    mcProcess.on('exit', (code) => console.log(`[TEST] MC 服务端退出，code=${code}`))

    // 3. 等待 MC 服务端完成初始化
    console.log('[TEST] 等待 MC 服务端初始化...')
    await waitForMcReady(mcProcess, 180_000)
    console.log('[TEST] MC 服务端已就绪')

    // 4. 等待 JE 连接并注册工具
    console.log('[TEST] 等待 JE 连接...')
    workspaceId = await waitFor(() => {
      const online = ac.workspaceManager.getOnlineWorkspaces()
      if (online.length > 0) {
        const tools = ac.workspaceManager.getWorkspaceTools(online[0].id)
        if (tools.length >= 3) {
          return online[0].id
        }
      }
      return null
    }, { timeoutMs: 60_000, intervalMs: 1000 })
    console.log(`[TEST] JE 已连接，workspaceId: ${workspaceId}`)
  }, 300_000)

  afterAll(async () => {
    // 清理：销毁假人
    try {
      await ac.toolDispatcher.callTool(workspaceId, 'bot_dismiss', { name: 'AliceBot_IT' }, 5000)
    } catch { /* ignore */ }
    try {
      await ac.toolDispatcher.callTool(workspaceId, 'bot_dismiss', { name: 'AliceBot_Move' }, 5000)
    } catch { /* ignore */ }

    // 停止 MC 服务端
    if (mcProcess && mcProcess.pid) {
      console.log('[TEST] 停止 MC 服务端...')
      try {
        process.kill(mcProcess.pid, 'SIGTERM')
      } catch { /* process may have already exited */ }
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

  it('L2-05: 工具注册数量 >= 3', () => {
    const tools = ac.workspaceManager.getWorkspaceTools(workspaceId)
    console.log(`[TEST] 已注册工具: ${tools.length} 个`)
    for (const t of tools) {
      console.log(`  - ${t.name} (${t.category}): ${Object.keys(t.parameters).length} 个参数`)
    }
    expect(tools.length).toBeGreaterThanOrEqual(3)
  })

  it('L2-07: bot_spawn 创建假人', async () => {
    console.log('[TEST] 创建假人 AliceBot_IT...')
    try {
      const data = await ac.toolDispatcher.callTool(workspaceId, 'bot_spawn', {
        name: 'AliceBot_IT',
        x: 0,
        y: 64,
        z: 0,
      }, 15000) as any
      console.log(`[TEST] bot_spawn 结果:`, JSON.stringify(data))
      expect(data).toBeDefined()
      expect(data.name).toBe('AliceBot_IT')
      if (data.uuid) {
        expect(data.uuid).toMatch(/^[0-9a-f-]{36}$/)
      }
    } catch (err: any) {
      console.log(`[TEST] bot_spawn 失败: ${err.message}`)
      throw err
    }
  })

  it('L2-09: bot_info 查询假人信息', async () => {
    console.log('[TEST] 查询假人 AliceBot_IT 信息...')
    try {
      const data = await ac.toolDispatcher.callTool(workspaceId, 'bot_info', {
        name: 'AliceBot_IT',
      }, 10000) as any
      console.log(`[TEST] bot_info 结果:`, JSON.stringify(data))
      expect(data).toBeDefined()
      expect(data.online).toBe(true)
      expect(data.name).toBe('AliceBot_IT')
    } catch (err: any) {
      console.log(`[TEST] bot_info 失败: ${err.message}`)
      throw err
    }
  })

  it('L2-11: move_to 移动假人', async () => {
    // 先 spawn 一个专用的移动假人
    console.log('[TEST] 创建移动假人 AliceBot_Move...')
    try {
      const spawnData = await ac.toolDispatcher.callTool(workspaceId, 'bot_spawn', {
        name: 'AliceBot_Move',
        x: 0,
        y: 64,
        z: 0,
      }, 15000) as any
      console.log(`[TEST] bot_spawn 结果:`, JSON.stringify(spawnData))
      expect(spawnData).toBeDefined()
      expect(spawnData.name).toBe('AliceBot_Move')

    // 移动到目标位置（move_to 移动第一个可用假人，不指定 name）
    const targetX = 100
    const targetY = 70
    const targetZ = -50
    console.log(`[TEST] 移动假人到 (${targetX}, ${targetY}, ${targetZ})...`)
    const moveData = await ac.toolDispatcher.callTool(workspaceId, 'move_to', {
      x: targetX,
      y: targetY,
      z: targetZ,
    }, 15000) as any
    console.log(`[TEST] move_to 结果:`, JSON.stringify(moveData))
    expect(moveData).toBeDefined()
    } catch (err: any) {
      console.log(`[TEST] move_to 测试失败: ${err.message}`)
      throw err
    }
  })

  it('L2-12: 错误路径 - 不存在的假人返回错误', async () => {
    console.log('[TEST] 查询不存在的假人...')
    await expect(
      ac.toolDispatcher.callTool(workspaceId, 'bot_info', { name: 'NonExistBot' }, 5000)
    ).rejects.toThrow()
  })
})