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
import { registerMemoryHandlers, setMemoryManager } from './memory-handler'
import { registerWorkspaceHandlers } from './workspace-handler'
import { registerWorldHandlers } from './world-handler'
import { registerWikiHandlers, setWikiClient, WikiClient } from '../wiki'
import { registerSearchHandlers, setSearchClient, SearchClient } from '../search'
import { registerDialogHandlers } from './dialog-handler'
import { registerTemplateHandlers } from './template-handler'
import { registerPresetHandlers } from './preset-handler'
import { registerToolHandlers } from './tool-handler'
import { registerDebugHandlers } from './debug-handler'

export { setMemoryManager }
export function registerAllIpcHandlers(mainWindow: BrowserWindow): void {
  // 初始化 Wiki 客户端
  setWikiClient(new WikiClient())
  registerWikiHandlers()

  // 初始化搜索客户端
  setSearchClient(new SearchClient())
  registerSearchHandlers()

  registerChatHandlers()
  registerConfigHandlers()
  registerWindowHandlers(mainWindow)
  registerDashboardHandlers()
  registerAgentHandlers()
  registerModelHandlers()
  registerQQBotHandlers(mainWindow)
  registerLogHandlers()
  registerToolCallHandlers()
  registerMemoryHandlers()
  registerDialogHandlers()
  registerWorkspaceHandlers(mainWindow)
  registerWorldHandlers(mainWindow)
  registerPresetHandlers()
  registerToolHandlers()
  registerTemplateHandlers()
  registerDebugHandlers()
}