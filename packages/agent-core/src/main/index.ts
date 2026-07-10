import { app, BrowserWindow, shell } from 'electron'
import path from 'path'
import { initLogger, getLogger, getLogDb } from './log'
import { registerAllIpcHandlers } from './ipc'
import { setLogDb } from './ipc/log-handler'
import { getToolCallCollector, setToolCallCollector } from './ipc/tool-call-handler'
import { PipelineEventCollector } from './pipeline/event-collector'

let mainWindow: BrowserWindow | null = null

async function initializeServices(): Promise<void> {
  // 初始化日志系统（优先，其他模块初始化时即可记录日志）
  const logger = initLogger()
  logger.info('SYSTEM', '日志系统初始化完成')

  // 设置 IPC Handler 的数据库引用
  const logDb = getLogDb()
  if (logDb) {
    setLogDb(logDb)
  }

  // 初始化工具调用事件收集器
  const collector = new PipelineEventCollector()
  if (logDb) {
    collector.setDatabase(logDb)
  }
  setToolCallCollector(collector)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#f3f4f6',
      symbolColor: '#4b5563',
      height: 36
    },
    backgroundColor: '#f3f4f6',
    webPreferences: {
      preload: path.resolve(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false
  })

  // 开发环境加载 dev server，生产环境加载打包后的文件
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.resolve(__dirname, '../renderer/index.html'))
  }

  // 窗口就绪后显示，避免白屏
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // 在外部浏览器打开外部链接
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // 注册 IPC Handler
  registerAllIpcHandlers(mainWindow)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  await initializeServices()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})