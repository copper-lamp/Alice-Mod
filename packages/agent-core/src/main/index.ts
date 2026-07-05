import { app, BrowserWindow, shell } from 'electron'
import path from 'path'
import { registerAllIpcHandlers } from './ipc'

let mainWindow: BrowserWindow | null = null

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

app.whenReady().then(() => {
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