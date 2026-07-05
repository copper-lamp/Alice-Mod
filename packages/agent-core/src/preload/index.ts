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
  }
})