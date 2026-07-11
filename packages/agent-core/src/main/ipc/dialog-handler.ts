/**
 * dialog-handler — 系统对话框 IPC 处理器
 *
 * 提供文件选择对话框等系统交互功能。
 */

import { ipcMain, dialog } from 'electron'
import { readFileSync } from 'node:fs'

const TEXT_EXTENSIONS = [
  '.txt', '.md', '.markdown',
  '.json', '.csv', '.log',
  '.yml', '.yaml', '.toml',
  '.ini', '.cfg', '.conf',
  '.xml', '.yaml', '.properties',
  '.js', '.ts', '.py', '.java',
  '.sql', '.sh', '.bat',
]

export function registerDialogHandlers(): void {
  ipcMain.handle('dialog:open-file', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择文档文件',
      properties: ['openFile'],
      filters: [
        { name: '文本文档', extensions: ['txt', 'md', 'json', 'csv', 'log', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'xml'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true }
    }

    const filePath = result.filePaths[0]
    const fileName = filePath.replace(/^.*[\\/]/, '')
    const ext = fileName.includes('.') ? '.' + fileName.split('.').pop()!.toLowerCase() : ''

    // 只读取文本文件
    if (!TEXT_EXTENSIONS.includes(ext)) {
      return {
        canceled: false,
        filePath,
        fileName,
        content: '',
        error: `不支持的文件格式 ${ext}，请选择文本文件`,
      }
    }

    try {
      const content = readFileSync(filePath, 'utf-8')
      const maxChars = 10000
      return {
        canceled: false,
        filePath,
        fileName,
        content: content.length > maxChars ? content.slice(0, maxChars) + '\n\n... [文件过长，已截断]' : content,
        truncated: content.length > maxChars,
      }
    } catch (err) {
      return {
        canceled: false,
        filePath,
        fileName,
        content: '',
        error: `读取文件失败: ${(err as Error).message}`,
      }
    }
  })
}
