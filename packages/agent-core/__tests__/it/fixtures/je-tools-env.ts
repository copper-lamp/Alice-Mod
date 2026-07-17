/**
 * JE 工具全覆盖测试辅助函数
 *
 * 提供环境准备、环境清理、MC 命令发送等工具函数。
 */

import type { ChildProcess } from 'node:child_process'
import type { AcMinimalContext } from './ac-minimal-server'

/** 等待条件满足 */
export async function waitFor<T>(
  fn: () => T | null | Promise<T | null>,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const timeout = opts.timeoutMs ?? 60_000
  const interval = opts.intervalMs ?? 500
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await fn()
    if (result !== null && result !== undefined) return result
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`超过超时时间 ${timeout}ms`)
}

/** 确保假人在线，不在线则创建 */
export async function ensureBotOnline(
  dispatcher: AcMinimalContext['toolDispatcher'],
  workspaceId: string,
  name: string,
  x: number,
  y: number,
  z: number,
): Promise<any> {
  try {
    const info = await dispatcher.callTool(workspaceId, 'bot_info', { name }, 5000) as any
    if (info.online) return info
    await dispatcher.callTool(workspaceId, 'bot_respawn', { name }, 5000)
    return info
  } catch {
    return dispatcher.callTool(workspaceId, 'bot_spawn', { name, x, y, z }, 15000)
  }
}

/** 清理假人 */
export async function cleanupBot(
  dispatcher: AcMinimalContext['toolDispatcher'],
  workspaceId: string,
  name: string,
): Promise<void> {
  try { await dispatcher.callTool(workspaceId, 'bot_dismiss', { name }, 5000) } catch { /* ignore */ }
}

/** 向 MC 服务端发送命令（通过 stdin） */
export function sendMcCommand(mcProcess: ChildProcess, command: string): void {
  if (mcProcess.stdin && !mcProcess.stdin.destroyed) {
    mcProcess.stdin.write(`${command}\n`)
  }
}

/** 等待指定毫秒 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 设置假人游戏模式 */
export async function setGameMode(mcProcess: ChildProcess, botName: string, mode: string): Promise<void> {
  sendMcCommand(mcProcess, `/gamemode ${mode} ${botName}`)
  await sleep(500)
}

/** 给假人物品 */
export async function giveItem(mcProcess: ChildProcess, botName: string, item: string, count = 1): Promise<void> {
  sendMcCommand(mcProcess, `/give ${botName} ${item} ${count}`)
  await sleep(500)
}

/** 在指定位置放置方块 */
export async function setBlockAt(mcProcess: ChildProcess, x: number, y: number, z: number, block: string): Promise<void> {
  sendMcCommand(mcProcess, `/setblock ${x} ${y} ${z} ${block}`)
  await sleep(500)
}

/** 在指定位置生成实体 */
export async function summonEntityAt(mcProcess: ChildProcess, entity: string, x: number, y: number, z: number): Promise<void> {
  sendMcCommand(mcProcess, `/summon ${entity} ${x} ${y} ${z}`)
  await sleep(500)
}

/** 设置世界时间 */
export async function setWorldTime(mcProcess: ChildProcess, time: number): Promise<void> {
  sendMcCommand(mcProcess, `/time set ${time}`)
  await sleep(300)
}

/** 填充区域方块 */
export async function fillArea(mcProcess: ChildProcess, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, block: string): Promise<void> {
  sendMcCommand(mcProcess, `/fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} ${block}`)
  await sleep(500)
}

/** 清除区域方块 */
export async function clearArea(mcProcess: ChildProcess, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): Promise<void> {
  sendMcCommand(mcProcess, `/fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} air`)
  await sleep(500)
}

/** 工具调用辅助：包装 callTool，返回成功数据和错误信息 */
export async function callToolSafe(
  dispatcher: AcMinimalContext['toolDispatcher'],
  workspaceId: string,
  toolName: string,
  parameters: Record<string, unknown>,
  timeoutMs = 10000,
): Promise<{ success: true; data: any } | { success: false; error: string }> {
  try {
    const data = await dispatcher.callTool(workspaceId, toolName, parameters, timeoutMs)
    return { success: true, data }
  } catch (err: any) {
    const errMsg = err.message ?? String(err)
    console.log(`[TEST] ${toolName} 失败: ${errMsg}`)
    return { success: false, error: errMsg }
  }
}