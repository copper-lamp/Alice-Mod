import { create } from 'zustand'
import type { WorkspaceItem, WorkspaceFileValidation } from '../lib/types'
import { workspaceApi } from '../lib/ipc'

/** 待确认的校验结果（解析成功等待用户确认） */
interface PendingValidation {
  instanceId: string
  name: string
  edition: 'bedrock' | 'java'
  host: string
  port: number
  authToken: string
  filePath: string
  gameVersion?: string
  isDuplicate: boolean
  duplicateName?: string
}

interface WorkspaceState {
  // ── 列表 ──
  workspaces: WorkspaceItem[]
  currentWorkspaceId: string | null
  loading: boolean

  // ── 确认弹窗 ──
  pendingValidation: PendingValidation | null

  // ── Actions: 列表 ──
  refreshWorkspaces: () => Promise<void>
  setCurrentWorkspace: (id: string) => void

  // ── Actions: 创建流程 ──
  /** 打开文件选择器 → 校验 → 存入 pendingValidation（失败则 throw） */
  selectAndValidate: () => Promise<void>
  /** 用户确认创建，传入可编辑的名称和可选的图标 */
  confirmCreate: (name: string, iconData?: string) => Promise<void>
  /** 取消创建，关闭弹窗 */
  cancelCreate: () => void

  // ── Actions: 管理 ──
  renameWorkspace: (id: string, name: string) => Promise<void>
  removeWorkspace: (id: string, force?: boolean) => Promise<void>
  openInExplorer: (filePath: string) => Promise<void>
  selectAndSetIcon: (id: string) => Promise<void>

  // ── Actions: 事件 ──
  handleStateChange: (event: { id: string; state: string }) => void
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  // ── 初始状态 ──
  workspaces: [],
  currentWorkspaceId: null,
  loading: false,
  pendingValidation: null,

  // ── 列表管理 ──

  refreshWorkspaces: async () => {
    set({ loading: true })
    try {
      const list = await workspaceApi.list()
      const currentId = get().currentWorkspaceId
      const stillExists = currentId ? list.some(ws => ws.id === currentId) : false
      set({
        workspaces: list,
        currentWorkspaceId: stillExists ? currentId : (list[0]?.id ?? null),
        loading: false,
      })
    } catch {
      set({ loading: false })
    }
  },

  setCurrentWorkspace: (id) => {
    set({ currentWorkspaceId: id })
    window.dispatchEvent(new CustomEvent('workspace:changed', { detail: { id } }))
  },

  // ── 创建流程：选择文件 → 校验 → 提示确认 ──

  selectAndValidate: async () => {
    // 1. 打开文件选择器
    const result = await workspaceApi.selectFile()
    if (!result.filePath) return // 用户取消

    // 2. 校验文件
    const validation: WorkspaceFileValidation = await workspaceApi.validateFile(result.filePath)
    if (!validation.valid || !validation.instance) {
      throw new Error(validation.errors.join('\n'))
    }

    const inst = validation.instance

    // 3. 存入待确认状态（弹出确认弹窗）
    set({
      pendingValidation: {
        instanceId: inst.instanceId,
        name: inst.name,
        edition: inst.edition,
        host: inst.host,
        port: inst.port,
        authToken: inst.authToken,
        filePath: inst.filePath ?? result.filePath,
        gameVersion: inst.gameVersion,
        isDuplicate: validation.isDuplicate ?? false,
        duplicateName: validation.duplicateName,
      },
    })
  },

  confirmCreate: async (name: string, iconData?: string) => {
    const pv = get().pendingValidation
    if (!pv) throw new Error('没有待确认的实例')

    // 创建
    const result = await workspaceApi.create({
      filePath: pv.filePath,
      name,
      iconData,
    })

    if (!result.success) {
      throw new Error(result.error ?? '创建工作区失败')
    }

    // 关闭弹窗 + 刷新列表
    set({ pendingValidation: null })
    await get().refreshWorkspaces()

    // 自动切换
    if (result.id) {
      get().setCurrentWorkspace(result.id)
    }
  },

  cancelCreate: () => {
    set({ pendingValidation: null })
  },

  // ── 管理操作 ──

  renameWorkspace: async (id, name) => {
    await workspaceApi.rename(id, name)
    await get().refreshWorkspaces()
  },

  removeWorkspace: async (id, force) => {
    const result = await workspaceApi.remove(id, force)
    if (!result.success && result.online) {
      const error = new Error(result.message ?? '工作区在线，无法删除')
      ;(error as Error & { online: boolean }).online = true
      throw error
    }
    if (get().currentWorkspaceId === id) {
      set({ currentWorkspaceId: null })
    }
    await get().refreshWorkspaces()
  },

  openInExplorer: async (filePath) => {
    await workspaceApi.openInExplorer(filePath)
  },

  selectAndSetIcon: async (id) => {
    const result = await workspaceApi.selectIcon()
    if (result.iconData) {
      await workspaceApi.updateIcon(id, result.iconData)
      await get().refreshWorkspaces()
    } else if (result.error) {
      throw new Error(result.error)
    }
  },

  // ── 事件处理 ──

  handleStateChange: (event) => {
    set(state => ({
      workspaces: state.workspaces.map(ws =>
        ws.id === event.id
          ? { ...ws, state: event.state as WorkspaceItem['state'] }
          : ws
      ),
    }))
  },
}))
