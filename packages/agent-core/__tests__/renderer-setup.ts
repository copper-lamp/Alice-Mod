/**
 * Renderer 测试设置
 *
 * Mock window.electronAPI 以支持渲染进程组件测试。
 */
import '@testing-library/jest-dom'

const mockElectronAPI = {
  platform: 'win32',
  send: () => {},
  on: (_channel: string, _callback: (...args: unknown[]) => void) => {
    return () => {}
  },
  invoke: async (_channel: string, ..._args: unknown[]) => {
    return {}
  },
  window: {
    minimize: async () => {},
    maximize: async () => true,
    close: async () => {},
    isMaximized: async () => false
  }
}

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true
})

// jsdom 不实现 scrollIntoView
Element.prototype.scrollIntoView = () => {}