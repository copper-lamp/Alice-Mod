import { create } from 'zustand'
import type { UpdateInfo } from '../lib/types'
import { updaterApi } from '../lib/ipc'

interface UpdaterState {
  /** 当前更新状态 */
  info: UpdateInfo
  /** 卡片是否显式关闭 */
  dismissed: boolean

  /** 初始化：监听 IPC 事件 + 拉取初始快照 */
  init: () => void
  /** 手动隐藏卡片（临时，刷新页面后重置） */
  dismiss: () => void
  /** 下载更新 */
  download: () => Promise<void>
  /** 安装更新并重启 */
  install: () => void
  /** 清除错误 */
  clearError: () => void
}

const DEFAULT_INFO: UpdateInfo = {
  available: false,
  currentVersion: '',
  downloadProgress: 0,
  status: 'idle',
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  info: DEFAULT_INFO,
  dismissed: false,

  init: () => {
    // 浏览器预览模式跳过
    if (!window.electronAPI?.updater) return

    // 1. 拉取初始状态
    updaterApi.getState().then((state) => {
      set({ info: state })
    })

    // 2. 订阅实时状态变化
    const unsubState = updaterApi.onStateChange((state) => {
      set({ info: state })
    })

    // 3. 更新可用时显示卡片（reset dismissed）
    const unsubAvailable = updaterApi.onUpdateAvailable(() => {
      set({ dismissed: false })
    })

    // 4. 下载进度
    const unsubProgress = updaterApi.onDownloadProgress((percent) => {
      set(s => ({ info: { ...s.info, status: 'downloading', downloadProgress: percent } }))
    })

    // 5. 下载完成
    const unsubDownloaded = updaterApi.onUpdateDownloaded(() => {
      set(s => ({ info: { ...s.info, status: 'downloaded', downloadProgress: 100 } }))
    })

    // 6. 错误
    const unsubError = updaterApi.onUpdateError((error) => {
      set(s => ({ info: { ...s.info, status: 'error', error } }))
    })

    // cleanup on page unload (not critical for this app, but good practice)
    window.addEventListener('beforeunload', () => {
      unsubState()
      unsubAvailable()
      unsubProgress()
      unsubDownloaded()
      unsubError()
    })
  },

  dismiss: () => set({ dismissed: true }),

  download: async () => {
    await updaterApi.download()
  },

  install: () => {
    updaterApi.install()
  },

  clearError: () => {
    set(s => ({ info: { ...s.info, error: undefined } }))
  },
}))
