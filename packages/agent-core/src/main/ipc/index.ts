import { BrowserWindow } from 'electron'
import { registerChatHandlers } from './chat-handler'
import { registerConfigHandlers } from './config-handler'
import { registerWindowHandlers } from './window-handler'
import { registerDashboardHandlers } from './dashboard-handler'
import { registerAgentHandlers } from './agent-handler'
import { registerModelHandlers } from './model-handler'
import { registerQQBotHandlers } from './qq-bot-handler'
import { registerLogHandlers } from './log-handler'
import { registerToolCallHandlers } from './tool-call-handler'
import { registerMemoryHandlers } from './memory-handler'

export function registerAllIpcHandlers(mainWindow: BrowserWindow): void {
  registerChatHandlers()
  registerConfigHandlers()
  registerWindowHandlers(mainWindow)
  registerDashboardHandlers()
  registerAgentHandlers()
  registerModelHandlers()
  registerQQBotHandlers()
  registerLogHandlers()
  registerToolCallHandlers()
  registerMemoryHandlers()
}