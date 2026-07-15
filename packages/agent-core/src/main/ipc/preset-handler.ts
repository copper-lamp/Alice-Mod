import { ipcMain } from 'electron'
import { PersonaPresetManager } from '../agent/persona-preset-manager'

const presetManager = new PersonaPresetManager()

export function registerPresetHandlers(): void {
  ipcMain.handle('preset:list', async () => await presetManager.list())
  ipcMain.handle('preset:get', async (_event, { id }) => await presetManager.get(id) ?? null)
  ipcMain.handle('preset:create', async (_event, preset) => {
    try {
      const id = await presetManager.create(preset)
      return { id, success: true }
    } catch (err) {
      return { id: '', success: false, error: (err as Error).message }
    }
  })
  ipcMain.handle('preset:update', async (_event, { id, preset }) => {
    const success = await presetManager.update(id, preset)
    return { success }
  })
  ipcMain.handle('preset:delete', async (_event, { id }) => {
    const success = await presetManager.delete(id)
    return { success }
  })
}
