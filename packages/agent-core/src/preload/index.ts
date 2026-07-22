import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // 平台信息
  platform: process.platform,

  // IPC 通信
  send: (channel: string, ...args: unknown[]) => {
    ipcRenderer.send(channel, ...args)
  },

  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, subscription)
    return () => ipcRenderer.removeListener(channel, subscription)
  },

  invoke: (channel: string, ...args: unknown[]) => {
    return ipcRenderer.invoke(channel, ...args)
  },

  // 窗口控制
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized')
  },

  // 自动更新
  updater: {
    getState: () => ipcRenderer.invoke('updater:get-state'),
    checkNow: () => ipcRenderer.invoke('updater:check-now'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onStateChange: (callback: (state: unknown) => void) => {
      const subscription = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state)
      ipcRenderer.on('updater:state-change', subscription)
      return () => ipcRenderer.removeListener('updater:state-change', subscription)
    },
    onUpdateAvailable: (callback: (version: string) => void) => {
      const subscription = (_event: Electron.IpcRendererEvent, version: string) => callback(version)
      ipcRenderer.on('updater:update-available', subscription)
      return () => ipcRenderer.removeListener('updater:update-available', subscription)
    },
    onDownloadProgress: (callback: (percent: number) => void) => {
      const subscription = (_event: Electron.IpcRendererEvent, percent: number) => callback(percent)
      ipcRenderer.on('updater:download-progress', subscription)
      return () => ipcRenderer.removeListener('updater:download-progress', subscription)
    },
    onUpdateDownloaded: (callback: () => void) => {
      const subscription = () => callback()
      ipcRenderer.on('updater:update-downloaded', subscription)
      return () => ipcRenderer.removeListener('updater:update-downloaded', subscription)
    },
    onUpdateError: (callback: (error: string) => void) => {
      const subscription = (_event: Electron.IpcRendererEvent, error: string) => callback(error)
      ipcRenderer.on('updater:update-error', subscription)
      return () => ipcRenderer.removeListener('updater:update-error', subscription)
    }
  }
})