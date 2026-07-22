import { app } from 'electron'
import { autoUpdater, type UpdateCheckResult } from 'electron-updater'
import { EventEmitter } from 'node:events'
import type { UpdateInfo } from './types'

/**
 * 简化版自动更新器
 *
 * 配置为从 `copper-lamp/Alice-App` 的 GitHub Releases 拉取更新。
 * 所有用户使用同一通道（stable），无 tier 区分。
 */
export class Updater extends EventEmitter {
  private state: UpdateInfo = {
    available: false,
    currentVersion: app.getVersion(),
    downloadProgress: 0,
    status: 'idle',
  }

  private initialized = false
  private logger: (msg: string) => void

  constructor(logger?: (msg: string) => void) {
    super()
    this.logger = logger ?? (() => {})
  }

  /** 当前状态快照 */
  getState(): UpdateInfo {
    return { ...this.state }
  }

  /**
   * 初始化并检查更新。
   * 在 app.whenReady() 之后调用，不阻塞启动流程。
   */
  init(): void {
    if (this.initialized) return
    this.initialized = true

    // 配置 electron-updater 使用 GitHub Releases
    // 官方仓库：https://github.com/copper-lamp/Alice-App
    autoUpdater.setFeedURL({
      provider: 'github',
      repo: 'Alice-App',
      owner: 'copper-lamp',
      private: false,
    })

    // 不自动下载，由我们控制下载时机
    autoUpdater.autoDownload = false
    // 允许预发布通道（方便未来 beta 测试）
    autoUpdater.allowPrerelease = false

    // ── 事件绑定 ──

    autoUpdater.on('checking-for-update', () => {
      this.state.status = 'checking'
      this.logger('[Updater] 正在检查更新...')
      this.emit('state-change', this.getState())
    })

    autoUpdater.on('update-available', (info) => {
      this.state.available = true
      this.state.version = info.version
      this.state.status = 'available'
      this.logger(`[Updater] 发现新版本: ${info.version}`)
      this.emit('state-change', this.getState())
      this.emit('update-available', info.version)
    })

    autoUpdater.on('update-not-available', () => {
      this.state.available = false
      this.state.version = undefined
      this.state.status = 'idle'
      this.logger('[Updater] 已是最新版本')
      this.emit('state-change', this.getState())
    })

    autoUpdater.on('download-progress', (progress) => {
      this.state.status = 'downloading'
      this.state.downloadProgress = Math.round(progress.percent)
      this.emit('state-change', this.getState())
      this.emit('download-progress', progress.percent)
    })

    autoUpdater.on('update-downloaded', () => {
      this.state.status = 'downloaded'
      this.state.downloadProgress = 100
      this.logger('[Updater] 更新下载完成，等待重启安装')
      this.emit('state-change', this.getState())
      this.emit('update-downloaded')
    })

    autoUpdater.on('error', (err) => {
      this.state.status = 'error'
      this.state.error = err.message
      this.logger(`[Updater] 错误: ${err.message}`)
      this.emit('state-change', this.getState())
      this.emit('update-error', err.message)
    })

    // 启动检查（异步，不阻塞）
    this.checkForUpdates()
  }

  /** 检查更新 */
  async checkForUpdates(): Promise<void> {
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      // 网络错误等静默处理，不阻塞用户
      this.state.status = 'error'
      this.state.error = (err as Error).message
      this.logger(`[Updater] 检查更新失败: ${(err as Error).message}`)
      this.emit('state-change', this.getState())
    }
  }

  /** 下载更新 */
  async downloadUpdate(): Promise<void> {
    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      this.state.status = 'error'
      this.state.error = (err as Error).message
      this.logger(`[Updater] 下载更新失败: ${(err as Error).message}`)
      this.emit('state-change', this.getState())
    }
  }

  /** 安装更新并重启应用 */
  installAndRestart(): void {
    this.state.status = 'installing'
    this.emit('state-change', this.getState())
    autoUpdater.quitAndInstall()
  }
}

/** 全局单例 */
export const updater = new Updater()