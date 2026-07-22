import { ipcMain, BrowserWindow } from 'electron'
import { updater } from '../updater'

/**
 * 注册自动更新相关的 IPC 通道
 *
 * 渲染进程可通过以下通道与主进程通信：
 * - `updater:get-state` → 获取当前更新状态
 * - `updater:check-now` → 手动触发检查更新
 * - `updater:download` → 下载更新
 * - `updater:install` → 安装并重启
 */
export function registerUpdaterHandlers(): void {
  // 获取当前更新状态
  ipcMain.handle('updater:get-state', () => {
    return updater.getState()
  })

  // 手动触发检查更新
  ipcMain.handle('updater:check-now', async () => {
    await updater.checkForUpdates()
    return updater.getState()
  })

  // 下载更新
  ipcMain.handle('updater:download', async () => {
    await updater.downloadUpdate()
    return updater.getState()
  })

  // 安装并重启
  ipcMain.handle('updater:install', () => {
    updater.installAndRestart()
  })
}

/**
 * 将更新状态变化事件推送到渲染进程
 *
 * 在 updater 初始化后调用，使渲染进程能实时收到更新状态变化
 */
export function forwardUpdaterEvents(mainWindow: BrowserWindow): void {
  updater.on('state-change', (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:state-change', state)
    }
  })

  updater.on('update-available', (version: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:update-available', version)
    }
  })

  updater.on('download-progress', (percent: number) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:download-progress', percent)
    }
  })

  updater.on('update-downloaded', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:update-downloaded')
    }
  })

  updater.on('update-error', (error: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:update-error', error)
    }
  })
}