/**
 * Vitest 全局测试设置
 *
 * Mock Electron 模块以避免测试时下载 Electron 二进制文件。
 */

import { vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';

vi.mock('electron', () => {
  return {
    app: {
      getPath: () => path.join(os.tmpdir(), 'mcagent-test-app'),
      getVersion: () => '0.0.0',
      getName: () => 'mcagent-test',
    },
  };
});
