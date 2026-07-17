import React, { useState } from 'react'
import {
  Dropdown,
  Header,
  Separator,
  toast,
  Modal,
  useOverlayState,
  Button,
} from '@heroui/react'
import { FolderOpen, Trash2, ChevronDown, Pencil, AlertTriangle, Pickaxe, Leaf } from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { workspaceApi } from '../../lib/ipc'
import WorkspaceConfirmDialog from './WorkspaceConfirmDialog'

const avatarColors = [
  'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500',
  'bg-pink-500', 'bg-teal-500', 'bg-indigo-500', 'bg-rose-500',
]

const getAvatarColor = (name: string) => {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return avatarColors[Math.abs(hash) % avatarColors.length]
}

const getAvatarLetter = (name: string) => name.charAt(0).toUpperCase()

const editionLabel: Record<string, string> = {
  bedrock: 'BE',
  java: 'JE',
}

const editionIcons: Record<string, React.ReactNode> = {
  bedrock: <Pickaxe size={28} />,
  java: <Leaf size={28} />,
}

const WorkspaceDropdown: React.FC = () => {
  const {
    workspaces,
    currentWorkspaceId,
    setCurrentWorkspace,
    selectAndValidate,
    pendingValidation,
    removeWorkspace,
    openInExplorer,
    renameWorkspace,
    refreshWorkspaces,
  } = useWorkspaceStore()

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; online: boolean } | null>(null)
  const [editTarget, setEditTarget] = useState<{ id: string; name: string; iconData?: string; edition: string } | null>(null)
  const [editName, setEditName] = useState('')
  const [editIconData, setEditIconData] = useState<string | undefined>(undefined)

  const deleteState = useOverlayState()
  const editState = useOverlayState()

  const currentWorkspace = workspaces.find(w => w.id === currentWorkspaceId)

  const statusDotClass = (state: string) => {
    switch (state) {
      case 'online': return 'bg-green-400'
      case 'connecting': return 'bg-yellow-400'
      default: return 'bg-gray-400'
    }
  }

  const versionLabel = (ws: typeof workspaces[0]) => {
    if (ws.gameVersion) {
      return `${editionLabel[ws.edition] ?? ws.edition} ${ws.gameVersion}`
    }
    return editionLabel[ws.edition] ?? ws.edition
  }

  const handleConnect = async () => {
    try {
      await selectAndValidate()
    } catch (err) {
      toast.danger('连接失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await removeWorkspace(deleteTarget.id, deleteTarget.online ? true : undefined)
      toast.success(`工作区 "${deleteTarget.name}" 已删除`)
      deleteState.close()
      setDeleteTarget(null)
    } catch (err) {
      toast.danger('删除失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const confirmEdit = async () => {
    if (!editTarget || !editName.trim()) return
    try {
      // 重命名
      await renameWorkspace(editTarget.id, editName.trim())
      // 如果图标有变更，保存新图标
      if (editIconData && editIconData !== editTarget.iconData) {
        await workspaceApi.updateIcon(editTarget.id, editIconData)
      }
      await refreshWorkspaces()
      toast.success(`已保存工作区设置`)
      editState.close()
      setEditTarget(null)
      setEditIconData(undefined)
    } catch (err) {
      toast.danger('保存失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const handleOpenDir = async (filePath?: string) => {
    if (!filePath) {
      toast.warning('该工作区没有配置文件路径')
      return
    }
    try {
      await openInExplorer(filePath)
      toast.success('已打开文件目录')
    } catch {
      toast.warning('无法打开文件目录')
    }
  }

  return (
    <>
      <Dropdown>
        <Dropdown.Trigger>
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-200/60 cursor-pointer transition-colors"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <span className={`w-2 h-2 rounded-full ${statusDotClass(currentWorkspace?.state ?? 'offline')}`} />
            <span>{currentWorkspace?.alias || currentWorkspace?.name || '未选择工作区'}</span>
            <ChevronDown size={12} className="text-gray-400" />
          </div>
        </Dropdown.Trigger>

        <Dropdown.Popover className="min-w-[300px]">
          <Dropdown.Menu
            onAction={(key) => {
              const ks = key as string
              if (ks === 'connect') {
                handleConnect()
                return
              }
              const ws = workspaces.find(w => w.id === ks)
              if (ws) {
                setCurrentWorkspace(ks)
                toast.info(`已切换到工作区 "${ws.alias || ws.name}"`)
              }
            }}
          >
            <Dropdown.Item
              key="connect"
              id="connect"
              textValue="连接 Alice Mod"
              className="text-center font-medium justify-center"
            >
              连接 Alice Mod
            </Dropdown.Item>

            {workspaces.length > 0 && (
              <>
                <Separator />

                <Dropdown.Section>
                  <Header>已添加</Header>
                  {workspaces.map(ws => {
                    const displayName = ws.alias || ws.name
                    const initial = getAvatarLetter(displayName)
                    const color = getAvatarColor(displayName)
                    return (
                      <Dropdown.Item
                        key={ws.id}
                        id={ws.id}
                        textValue={displayName}
                        className="group/item"
                      >
                        <div className="flex items-center gap-2 w-full">
                          {/* 头像 */}
                          {ws.iconData ? (
                            <img src={ws.iconData} alt="" className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                          ) : (
                            <div className={`w-6 h-6 rounded-full ${color} flex items-center justify-center text-white text-xs font-semibold flex-shrink-0`}>
                              {initial}
                            </div>
                          )}

                          {/* 名称 + 版本 */}
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="text-xs font-medium text-gray-700 truncate">
                              {displayName}
                            </span>
                            <span className="text-[10px] text-gray-400 truncate leading-tight">
                              {versionLabel(ws)}
                            </span>
                          </div>

                          {/* 操作图标（始终可见，hover 时加深） */}
                          <div
                            className="flex items-center gap-0.5 opacity-60 hover:opacity-100 transition-opacity flex-shrink-0"
                            onClick={e => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="inline-flex items-center justify-center w-5 h-5 rounded text-gray-500 hover:text-gray-700 hover:bg-gray-200 transition-colors"
                              title="打开文件目录"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleOpenDir(ws.filePath)
                              }}
                            >
                              <FolderOpen size={12} />
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center justify-center w-5 h-5 rounded text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                              title="编辑名称"
                              onClick={(e) => {
                                e.stopPropagation()
                                setEditTarget({ id: ws.id, name: displayName, iconData: ws.iconData, edition: ws.edition })
                                setEditName(displayName)
                                setEditIconData(ws.iconData)
                                editState.open()
                              }}
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center justify-center w-5 h-5 rounded text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                              title="删除工作区"
                              onClick={(e) => {
                                e.stopPropagation()
                                setDeleteTarget({ id: ws.id, name: displayName, online: ws.state === 'online' })
                                deleteState.open()
                              }}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      </Dropdown.Item>
                    )
                  })}
                </Dropdown.Section>
              </>
            )}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      {pendingValidation && <WorkspaceConfirmDialog />}

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <Modal state={deleteState}>
          <div />
          <Modal.Backdrop>
            <Modal.Container size="xs">
              <Modal.Dialog className="sm:max-w-[360px]">
                {(renderProps) => (
                  <>
                    <Modal.Header>
                      <Modal.Icon className="bg-danger-soft text-danger-soft-foreground">
                        <AlertTriangle size={16} />
                      </Modal.Icon>
                      <Modal.Heading>确认删除</Modal.Heading>
                    </Modal.Header>
                    <Modal.Body>
                      <p className="text-sm text-gray-600">
                        确定要删除工作区 <strong>{deleteTarget.name}</strong>？
                      </p>
                      {deleteTarget.online && (
                        <p className="flex items-center gap-1.5 text-xs text-yellow-600 bg-yellow-50 border border-yellow-200 rounded-lg p-2.5 mt-3">
                          <AlertTriangle size={12} className="flex-shrink-0" />
                          该工作区有活跃连接，删除后将断开连接。
                        </p>
                      )}
                    </Modal.Body>
                    <Modal.Footer>
                      <Button
                        variant="secondary"
                        onPress={() => {
                          deleteState.close()
                          setDeleteTarget(null)
                        }}
                      >
                        取消
                      </Button>
                      <Button onPress={confirmDelete}>
                        {deleteTarget.online ? '断开并删除' : '确认删除'}
                      </Button>
                    </Modal.Footer>
                  </>
                )}
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      )}

      {/* 编辑名称弹窗 */}
      {editTarget && (
        <Modal state={editState}>
          <div />
          <Modal.Backdrop>
            <Modal.Container size="xs">
              <Modal.Dialog className="sm:max-w-[360px]">
                {(renderProps) => (
                  <>
                    <Modal.Header>
                      <Modal.Icon className="bg-default text-foreground">
                        <Pencil size={16} />
                      </Modal.Icon>
                      <Modal.Heading>编辑名称</Modal.Heading>
                    </Modal.Header>
                    <Modal.Body>
                      <div className="flex items-center gap-4 mb-4">
                        <button
                          type="button"
                          onClick={async () => {
                            const result = await workspaceApi.selectIcon()
                            if (result.iconData) {
                              setEditIconData(result.iconData)
                              toast.success('图标已更新')
                            } else if (result.error) {
                              toast.danger('选择图标失败: ' + result.error)
                            }
                          }}
                          className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center text-gray-600 flex-shrink-0 hover:bg-gray-200 transition-colors overflow-hidden"
                          title="点击更换图标"
                        >
                          {editIconData ? (
                            <img src={editIconData} alt="" className="w-full h-full object-cover" />
                          ) : (
                            editionIcons[editTarget.edition] ?? <Pickaxe size={28} />
                          )}
                        </button>
                        <div className="flex-1">
                          <label className="block text-xs text-gray-500 mb-1">工作区名称</label>
                          <input
                            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:outline-none"
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            placeholder="请输入工作区名称"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && editName.trim()) {
                                confirmEdit()
                              }
                            }}
                          />
                        </div>
                      </div>
                    </Modal.Body>
                    <Modal.Footer>
                      <Button
                        variant="secondary"
                        onPress={() => {
                          editState.close()
                          setEditTarget(null)
                        }}
                      >
                        取消
                      </Button>
                      <Button
                        onPress={confirmEdit}
                        isDisabled={!editName.trim()}
                      >
                        保存
                      </Button>
                    </Modal.Footer>
                  </>
                )}
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      )}
    </>
  )
}

export default WorkspaceDropdown
