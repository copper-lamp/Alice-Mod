/**
 * 工作区 IPC Handler
 *
 * 处理工作区列表查询、创建（文件选择+校验+导入）、删除、重命名等操作。
 */

import { ipcMain, dialog, BrowserWindow, shell, nativeImage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getWorkspaceManager, WorkspaceEvent } from '../workspace/workspace-manager'
import { InstanceManager, type ImportResult } from '../instance/instance-manager'
import { InstanceValidator } from '../instance/instance-validator'
import type { InstanceConfig } from '../instance/instance-validator'
import { WorkspaceStore } from '../workspace/workspace-store'

// ── IPC 响应类型 ──

interface WorkspaceListItem {
  id: string
  name: string
  state: 'online' | 'offline' | 'connecting'
  edition: 'bedrock' | 'java'
  host: string
  port: number
  toolCount: number
  filePath?: string
  gameVersion?: string          // 游戏版本号，如 "1.26.10"
  iconData?: string             // 自定义图标 base64
  description?: string
  tags?: string[]
  lastActiveAt?: number
  createdAt: number
}

interface FileValidationResult {
  valid: boolean
  errors: string[]
  instance?: {
    instanceId: string
    name: string
    edition: 'bedrock' | 'java'
    host: string
    port: number
    authToken: string
    filePath?: string
    gameVersion?: string       // 游戏版本号
    description?: string
    tags?: string[]
  }
  /** 该实例是否已存在（重复导入） */
  isDuplicate?: boolean
  /** 已存在的实例名称 */
  duplicateName?: string
}

const instanceManager = new InstanceManager()

// ════════════════════════════════════════════════════════════════
// BE 插件 JSON 格式解析
// ════════════════════════════════════════════════════════════════
//
// BE 插件生成的 instance.json 格式与标准格式不同:
// {
//   "_schema_version": "1.0.0",
//   "instance_id": "uuid",
//   "game": { "edition": "bedrock", ... },
//   "network": { "host": "127.0.0.1", "port": 27541, ... },
//   ...
// }

interface BEPluginJson {
  instance_id?: string
  _schema_version?: string
  mod_version?: string
  game?: { edition?: string }
  network?: { host?: string; port?: number }
  description?: string
}

/** 判断是否为 BE 插件格式 */
function isBEPluginFormat(json: unknown): json is BEPluginJson {
  if (typeof json !== 'object' || json === null) return false
  const obj = json as Record<string, unknown>
  return typeof obj.instance_id === 'string' && !Array.isArray(obj.instances)
}

/** 从解析后的 JSON 中提取 game_version（兼容多种格式） */
function extractGameVersion(parsed: Record<string, unknown>): string | undefined {
  // 协议格式: game_version.version
  if (parsed.game_version && typeof parsed.game_version === 'object') {
    const gv = parsed.game_version as Record<string, unknown>
    if (typeof gv.version === 'string') return gv.version.replace(/^v/i, '')
  }
  // BE 旧格式: game.version
  if (parsed.game && typeof parsed.game === 'object') {
    const g = parsed.game as Record<string, unknown>
    if (typeof g.version === 'string') return (g.version as string).replace(/^v/i, '')
  }
  return undefined
}

/** 解析 BE 插件格式为 ImportResult */
function parseBEPluginFile(filePath: string): ImportResult {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(content)

    if (!isBEPluginFormat(parsed)) {
      return { success: false, instances: [], errors: ['不是有效的 BE 插件 JSON 格式'] }
    }

    const instanceId = parsed.instance_id!
    const edition = parsed.game?.edition === 'java' ? 'java' : 'bedrock'
    const host = parsed.network?.host ?? '127.0.0.1'
    const port = parsed.network?.port ?? 27541
    const name = parsed.mod_version
      ? `${edition === 'bedrock' ? 'BE' : 'JE'} v${parsed.mod_version}`
      : path.basename(path.dirname(filePath))

    const config: InstanceConfig = {
      instance_id: instanceId,
      name,
      edition,
      host,
      port,
      auth_token: `auto-${instanceId.slice(0, 8)}`,
      file_path: filePath,
      game_version: extractGameVersion(parsed as Record<string, unknown>),
      description: parsed.description,
    }

    // 校验 instance_id 格式
    const validationErrors = InstanceValidator.validateInstance(config)
    if (validationErrors.length > 0) {
      return { success: false, instances: [], errors: validationErrors }
    }

    return { success: true, instances: [config], errors: [] }
  } catch (err) {
    return {
      success: false,
      instances: [],
      errors: [`解析文件失败: ${err instanceof Error ? err.message : String(err)}`],
    }
  }
}

/** 尝试从文件导入实例（标准格式 + BE 插件格式） */
function importFromFileWithFallback(filePath: string): ImportResult {
  // 先尝试标准格式
  const result = instanceManager.importFromFile(filePath)
  if (result.success) return result

  // 再尝试 BE 插件格式
  const beResult = parseBEPluginFile(filePath)
  if (beResult.success) return beResult

  // 都失败，返回所有错误
  return {
    success: false,
    instances: [],
    errors: [...result.errors, ...beResult.errors],
  }
}

export function registerWorkspaceHandlers(mainWindow?: BrowserWindow): void {
  // 启动时加载持久化的实例配置
  instanceManager.load()
  console.log('[workspace-handler] 已加载实例数:', instanceManager.getAll().length)

  // ── 查询 ──

  /** 获取工作区列表（合并工作区+实例信息） */
  ipcMain.handle('workspace:list', async (): Promise<WorkspaceListItem[]> => {
    const manager = getWorkspaceManager()
    const workspaces = manager.getAllWorkspaces()
    const instances = instanceManager.getAll()
    console.log('[workspace:list] workspaces:', workspaces.length, 'instances:', instances.length)
    if (workspaces.length > 0) {
      console.log('[workspace:list] first ws:', { id: workspaces[0].id, name: workspaces[0].name, instanceId: workspaces[0].instanceId })
    }

    return workspaces.map(ws => {
      const inst = instances.find(i => i.instance_id === ws.instanceId)
      return {
        id: ws.id,
        name: ws.name,
        state: ws.state as WorkspaceListItem['state'],
        edition: (ws.edition ?? inst?.edition ?? 'bedrock') as 'bedrock' | 'java',
        host: inst?.host ?? '',
        port: inst?.port ?? 0,
        toolCount: ws.toolCount,
        filePath: inst?.file_path,
        gameVersion: inst?.game_version,
        iconData: inst?.icon_data,
        description: inst?.description,
        tags: inst?.tags,
        lastActiveAt: ws.lastOnlineAt ?? undefined,
        createdAt: ws.createdAt,
      }
    })
  })

  // ── 文件选择与校验 ──

  /** 打开文件选择对话框 */
  ipcMain.handle('workspace:select-file', async () => {
    if (!mainWindow) return { filePath: null }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择模组入口 JSON 文件',
      filters: [{ name: 'JSON 配置文件', extensions: ['json'] }],
      properties: ['openFile'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { filePath: null }
    }
    return { filePath: result.filePaths[0] }
  })

  /** 校验 JSON 文件并返回解析结果 */
  ipcMain.handle('workspace:validate-file', async (_event, { filePath }: { filePath: string }): Promise<FileValidationResult> => {
    const result = importFromFileWithFallback(filePath)
    if (!result.success || result.instances.length === 0) {
      return { valid: false, errors: result.errors }
    }

    const inst = result.instances[0]

    // 检查是否已存在
    const existing = instanceManager.get(inst.instance_id)
    const existingWs = getWorkspaceManager().getWorkspaceByInstanceId(inst.instance_id)

    return {
      valid: true,
      errors: [],
      instance: {
        instanceId: inst.instance_id,
        name: inst.name,
        edition: inst.edition,
        host: inst.host,
        port: inst.port,
        authToken: inst.auth_token,
        filePath: inst.file_path,
        gameVersion: inst.game_version,
        description: inst.description,
        tags: inst.tags,
      },
      isDuplicate: !!existing,
      duplicateName: existing?.name ?? existingWs?.name,
    }
  })

  // ── 创建 ──

  /**
   * 新建工作区
   * 1. 导入 JSON 中的实例配置
   * 2. 创建工作区
   * 3. 持久化实例信息（含文件路径）
   */
  ipcMain.handle('workspace:create', async (_event, params: {
    filePath: string
    name?: string
    iconData?: string
    description?: string
    tags?: string[]
  }) => {
    try {
      const importResult = importFromFileWithFallback(params.filePath)
      if (!importResult.success || importResult.instances.length === 0) {
        return { success: false, error: importResult.errors.join('; ') }
      }

      const inst = importResult.instances[0]

      // 确保实例已注册（BE 插件格式解析未自动注册到 Manager）
      instanceManager.add(inst)

      // 持久化实例配置（保留所有解析字段）
      instanceManager.update(inst.instance_id, {
        name: params.name ?? inst.name,
        file_path: params.filePath,
        game_version: inst.game_version,
        icon_data: params.iconData,
        description: params.description ?? inst.description,
        tags: params.tags ?? inst.tags,
      })

      // 创建工作区
      const manager = getWorkspaceManager()
      const workspace = manager.createWorkspace({
        instanceId: inst.instance_id,
        edition: inst.edition,
        name: params.name ?? inst.name,
        source: 'manual',
      })

      return { success: true, id: workspace.id }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })

  // ── 管理 ──

  /** 重命名工作区 */
  ipcMain.handle('workspace:rename', async (_event, { id, name }: { id: string; name: string }) => {
    const manager = getWorkspaceManager()
    const ws = manager.getWorkspace(id)
    if (!ws) return { success: false }

    ws.name = name
    // 持久化名称变更到 SQLite
    const store = new WorkspaceStore()
    store.save(ws.toJSON())
    return { success: true }
  })

  /** 删除工作区及对应的实例配置 */
  ipcMain.handle('workspace:remove', async (_event, { id, force }: { id: string; force?: boolean }) => {
    const manager = getWorkspaceManager()
    const ws = manager.getWorkspace(id)
    if (!ws) return { success: false }

    if (ws.isOnline && !force) {
      return { success: false, online: true, message: '该工作区有活跃连接，断开后删除？' }
    }

    if (ws.isOnline && force) {
      manager.setOffline(ws.connectionId!)
    }

    manager.removeWorkspace(id)
    instanceManager.remove(ws.instanceId)

    return { success: true }
  })

  // ── 文件操作 ──

  /** 在文件管理器中打开 JSON 所在目录 */
  ipcMain.handle('workspace:open-in-explorer', async (_event, { filePath }: { filePath: string }) => {
    if (!filePath) return { success: false }
    try {
      shell.showItemInFolder(filePath)
      return { success: true }
    } catch {
      // 如果文件不存在，打开其所在目录
      const dir = path.dirname(filePath)
      if (fs.existsSync(dir)) {
        shell.openPath(dir)
      }
      return { success: true }
    }
  })

  /** 选择并裁剪图标（128×128） */
  ipcMain.handle('workspace:select-icon', async () => {
    if (!mainWindow) return { iconData: null }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择实例图标',
      filters: [
        { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
      ],
      properties: ['openFile'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { iconData: null }
    }

    try {
      const imgPath = result.filePaths[0]
      const img = nativeImage.createFromPath(imgPath)

      if (img.isEmpty()) {
        return { iconData: null, error: '无法读取图片文件' }
      }

      // 裁剪为 128×128（居中裁剪保持比例）
      const size = Math.min(img.getSize().width, img.getSize().height)
      const x = Math.floor((img.getSize().width - size) / 2)
      const y = Math.floor((img.getSize().height - size) / 2)
      const cropped = img.crop({ x, y, width: size, height: size })
      const resized = cropped.resize({ width: 128, height: 128 })

      return { iconData: resized.toDataURL() }
    } catch (err) {
      return {
        iconData: null,
        error: `图标处理失败: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  /** 更新工作区图标 */
  ipcMain.handle('workspace:update-icon', async (_event, { id, iconData }: { id: string; iconData?: string }) => {
    const manager = getWorkspaceManager()
    const ws = manager.getWorkspace(id)
    if (!ws) return { success: false }

    const inst = instanceManager.get(ws.instanceId)
    if (inst) {
      instanceManager.update(ws.instanceId, { icon_data: iconData })
    }
    return { success: true }
  })

  // ── 事件推送 ──

  const manager = getWorkspaceManager()
  manager.on(WorkspaceEvent.StateChanged, (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('workspace:state-changed', {
        id: event.workspaceId,
        state: event.metadata?.newState,
        oldState: event.metadata?.oldState,
        timestamp: event.timestamp,
      })
    }
  })

  manager.on(WorkspaceEvent.Created, (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('workspace:created', {
        id: event.workspaceId,
        instanceId: event.instanceId,
        timestamp: event.timestamp,
      })
    }
  })

  manager.on(WorkspaceEvent.Removed, (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('workspace:removed', {
        id: event.workspaceId,
        timestamp: event.timestamp,
      })
    }
  })

  manager.on(WorkspaceEvent.ToolsUpdated, (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('workspace:tools-updated', {
        workspaceId: event.workspaceId,
        instanceId: event.instanceId,
        toolCount: event.metadata?.toolCount,
        timestamp: event.timestamp,
      })
    }
  })
}

// ── 导出实例管理器（供 AgentFileExporter 等模块使用） ──

export function getInstanceManager(): InstanceManager {
  return instanceManager
}
