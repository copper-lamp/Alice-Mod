/**
 * Vitest 全局测试设置
 *
 * Mock Electron 模块以避免测试时下载 Electron 二进制文件。
 */

import { vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';

class MockBrowserWindow {
  constructor() {
    this.loadURL = vi.fn();
    this.loadFile = vi.fn();
    this.webContents = { setWindowOpenHandler: vi.fn() };
    this.on = vi.fn();
    this.once = vi.fn();
    this.show = vi.fn();
    this.close = vi.fn();
  }
  static getAllWindows() { return [] }
}

vi.mock('electron', () => {
  return {
    app: {
      getPath: () => path.join(os.tmpdir(), 'alice-mod-test'),
      getVersion: () => '0.0.0',
      getName: () => 'alice-mod-test',
      whenReady: () => Promise.resolve(),
      quit: vi.fn(),
      on: vi.fn(),
    },
    BrowserWindow: MockBrowserWindow as any,
    ipcMain: {
      handle: vi.fn(),
    },
    Notification: Object.assign(vi.fn(), {
      isSupported: () => false,
    }) as any,
    shell: { openExternal: vi.fn() },
  };
});
