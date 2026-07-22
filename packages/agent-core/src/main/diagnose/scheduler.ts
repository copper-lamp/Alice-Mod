/**
 * 诊断信息自动调度器
 *
 * 自动在以下时机生成诊断包：
 * 1. 应用启动时
 * 2. 检测到上次异常崩溃后（下次启动时）
 * 3. 每 24 小时定时生成
 *
 * 自动清理旧文件，保留最近 N 份。
 */

import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { generateDiagnoseZip, getDefaultConfig } from './packer'

/** 崩溃标记文件名 */
const CRASH_MARKER_FILE = 'diagnose_crash_marker'

/** 调度器实例 */
let schedulerInstance: DiagnoseScheduler | null = null

/**
 * 诊断信息调度器
 */
export class DiagnoseScheduler {
  private outputDir: string
  private maxKeep: number
  private intervalMs: number
  private timer: ReturnType<typeof setInterval> | null = null
  private crashMarkerPath: string
  private initialized = false

  constructor(outputDir?: string) {
    const config = getDefaultConfig()
    this.outputDir = outputDir ?? path.join(app.getPath('userData'), 'diagnose')
    this.maxKeep = config.maxKeep
    this.intervalMs = config.intervalMs
    this.crashMarkerPath = path.join(app.getPath('userData'), CRASH_MARKER_FILE)
  }

  /**
   * 初始化调度器
   */
  init(): void {
    if (this.initialized) return
    this.initialized = true

    fs.mkdirSync(this.outputDir, { recursive: true })

    // 1. 检测上次是否崩溃
    this.detectCrash()

    // 2. 启动时生成
    this.generateWithCleanup({ reason: 'boot' }).catch(err => {
      console.error('[Diagnose] 启动时生成诊断包失败:', err)
    })

    // 3. 设置定时器（每 24 小时）
    this.timer = setInterval(() => {
      this.generateWithCleanup().catch(err => {
        console.error('[Diagnose] 定时生成诊断包失败:', err)
      })
    }, this.intervalMs)

    // 4. 注册崩溃标记（进程退出时标记，但实际上 clean shutdown 会删除标记）
    this.writeCrashMarker()

    console.log(
      `[Diagnose] 调度器已启动，输出目录: ${this.outputDir}，` +
      `定时间隔: ${this.intervalMs / 3600000}h，保留: ${this.maxKeep} 份`,
    )
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    // 清理崩溃标记（正常退出）
    this.removeCrashMarker()
    this.initialized = false
    console.log('[Diagnose] 调度器已停止')
  }

  /**
   * 生成诊断包并清理旧文件
   */
  private async generateWithCleanup(options?: {
    reason?: string
    lastExitCode?: number
    lastRunCrashed?: boolean
  }): Promise<void> {
    try {
      await generateDiagnoseZip(this.outputDir, options)
      this.cleanupOldFiles()
    } catch (err) {
      console.error('[Diagnose] 生成失败:', err)
    }
  }

  /**
   * 检测上次是否崩溃
   */
  private detectCrash(): void {
    try {
      if (fs.existsSync(this.crashMarkerPath)) {
        console.log('[Diagnose] 检测到上次异常退出，正在生成崩溃诊断包')
        this.generateWithCleanup({
          reason: 'crash',
          lastRunCrashed: true,
        }).catch(err => {
          console.error('[Diagnose] 崩溃诊断包生成失败:', err)
        })
      }
    } catch {
      // 忽略检测失败
    }
  }

  /**
   * 写入崩溃标记
   */
  private writeCrashMarker(): void {
    try {
      fs.writeFileSync(this.crashMarkerPath, String(Date.now()), 'utf-8')
    } catch {
      // 忽略写入失败
    }
  }

  /**
   * 移除崩溃标记（正常退出时调用）
   */
  removeCrashMarker(): void {
    try {
      if (fs.existsSync(this.crashMarkerPath)) {
        fs.unlinkSync(this.crashMarkerPath)
      }
    } catch {
      // 忽略
    }
  }

  /**
   * 清理旧诊断包，保留最近 N 份
   */
  private cleanupOldFiles(): void {
    try {
      const files = fs.readdirSync(this.outputDir)
        .filter(f => f.endsWith('.zip'))
        .map(f => ({
          name: f,
          time: fs.statSync(path.join(this.outputDir, f)).mtimeMs,
        }))
        .sort((a, b) => b.time - a.time) // 最新在前

      const toDelete = files.slice(this.maxKeep)
      for (const f of toDelete) {
        fs.unlinkSync(path.join(this.outputDir, f.name))
        console.log(`[Diagnose] 清理旧诊断包: ${f.name}`)
      }
    } catch {
      // 忽略清理失败
    }
  }

  /** 获取输出目录 */
  getOutputDir(): string {
    return this.outputDir
  }
}

/**
 * 初始化诊断调度器
 */
export function initDiagnoseScheduler(outputDir?: string): DiagnoseScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new DiagnoseScheduler(outputDir)
    schedulerInstance.init()
  }
  return schedulerInstance
}

/**
 * 获取诊断调度器实例
 */
export function getDiagnoseScheduler(): DiagnoseScheduler | null {
  return schedulerInstance
}

/**
 * 停止诊断调度器
 */
export function stopDiagnoseScheduler(): void {
  if (schedulerInstance) {
    schedulerInstance.stop()
    schedulerInstance = null
  }
}