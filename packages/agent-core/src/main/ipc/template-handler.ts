import { ipcMain } from 'electron'
import { PromptTemplateManager } from '../prompt/prompt-template-manager'
import { PromptCompiler } from '../prompt/compiler/prompt-compiler'

const templateManager = PromptTemplateManager.getInstance()

export function registerTemplateHandlers(): void {
  // ════════════════════════════════════════════════════
  // 身份模板相关
  // ════════════════════════════════════════════════════

  ipcMain.handle('template:list-identities', async () => {
    return templateManager.listIdentityTemplates()
  })

  ipcMain.handle('template:get-identity', async (_event, { id }) => {
    return templateManager.getIdentityTemplate(id) ?? null
  })

  // ════════════════════════════════════════════════════
  // 工作流模板相关
  // ════════════════════════════════════════════════════

  ipcMain.handle('template:list-workflows', async () => {
    return templateManager.listWorkflowTemplates()
  })

  ipcMain.handle('template:get-workflow', async (_event, { id }) => {
    return templateManager.getWorkflowTemplate(id) ?? null
  })

  // ════════════════════════════════════════════════════
  // 性格特征相关
  // ════════════════════════════════════════════════════

  ipcMain.handle('template:list-personalities', async () => {
    return templateManager.getAllPersonalityTraits()
  })

  ipcMain.handle('template:list-personality-categories', async () => {
    const categories = templateManager.getAllPersonalityCategories()
    return categories.map(([category, traits]) => ({ category, traits }))
  })

  // ════════════════════════════════════════════════════
  // 行为预设相关
  // ════════════════════════════════════════════════════

  ipcMain.handle('template:list-behaviors', async () => {
    return templateManager.listBehaviorPresets()
  })

  ipcMain.handle('template:get-behavior', async (_event, { id }) => {
    return templateManager.getBehaviorPreset(id) ?? null
  })

  // ════════════════════════════════════════════════════
  // 用户自定义模板 CRUD
  // ════════════════════════════════════════════════════

  ipcMain.handle('template:custom-list', async (_event, { type }) => {
    return await templateManager.listCustomTemplates(type)
  })

  ipcMain.handle('template:custom-get', async (_event, { id }) => {
    return await templateManager.getCustomTemplate(id) ?? null
  })

  ipcMain.handle('template:custom-save', async (_event, template) => {
    try {
      const saved = await templateManager.saveCustomTemplate(template)
      return { success: true, template: saved }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('template:custom-delete', async (_event, { id }) => {
    const success = await templateManager.deleteCustomTemplate(id)
    return { success }
  })

  // ════════════════════════════════════════════════════
  // 重新加载模板
  // ════════════════════════════════════════════════════

  ipcMain.handle('template:reload', async () => {
    try {
      templateManager.reloadBuiltinTemplates()
      await templateManager.reloadCustomTemplates()
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // ════════════════════════════════════════════════════
  // QQ 默认人设
  // ════════════════════════════════════════════════════

  ipcMain.handle('prompt:get-default-qq-persona', async () => {
    return PromptCompiler.getDefaultQQPersona()
  })
}
