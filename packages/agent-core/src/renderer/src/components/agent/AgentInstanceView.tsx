import React, { useEffect, useState } from 'react'
import { Tabs, Modal, useOverlayState, Button, Switch } from '@heroui/react'
import { Trash2, AlertTriangle, Wifi, WifiOff, Power } from 'lucide-react'
import { useUIStore } from '../../stores/uiStore'
import { useAgentStore } from '../../stores/agentStore'
import ChatPanel from '../chat/ChatPanel'
import AgentConfigForm from './AgentConfigForm'
import QQPanel from './QQPanel'

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} 小时前`
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

const AgentInstanceView: React.FC = () => {
  const { agentViewTab, setAgentViewTab, setLayoutMode } = useUIStore()
  const { currentAgent, fetchAgent, agents, currentAgentId, deleteAgent } = useAgentStore()
  const [qqStatus, setQqStatus] = useState<string>('disconnected')
  const deleteState = useOverlayState()
  const [deleting, setDeleting] = useState(false)

  // V28: 智能体启用/禁用状态
  const [enabled, setEnabled] = useState<boolean>(true)
  const [botOnline, setBotOnline] = useState<boolean>(false)
  const [botLoading, setBotLoading] = useState(false)

  useEffect(() => {
    if (currentAgentId && !currentAgent) {
      fetchAgent(currentAgentId)
    }
  }, [currentAgentId])

  // 同步 currentAgent.enabled 到本地状态
  useEffect(() => {
    if (currentAgent) {
      setEnabled(currentAgent.enabled !== false)
    }
  }, [currentAgent])

  // V24: 获取 Agent 运行时状态（含 QQ 连接状态）
  // V28: 扩展为包含 botOnline 字段
  useEffect(() => {
    if (!currentAgentId) return
    const fetchStatus = async () => {
      try {
        const result = await window.electronAPI.invoke('agent:get-status', { id: currentAgentId }) as {
          status: string
          qqStatus: string
          botOnline?: boolean
        }
        setQqStatus(result.qqStatus ?? 'disconnected')
        if (result.botOnline !== undefined) {
          setBotOnline(result.botOnline)
        }
      } catch {
        // agent:get-status 可能未注册
      }
    }
    fetchStatus()
    const interval = setInterval(fetchStatus, 30000) // 每30秒刷新
    return () => clearInterval(interval)
  }, [currentAgentId])

  const currentSummary = agents.find(a => a.id === currentAgentId)

  const handleDelete = async () => {
    if (!currentAgentId) return
    setDeleting(true)
    try {
      await deleteAgent(currentAgentId)
      deleteState.close()
      setLayoutMode('nav-view')
    } catch {
      // 删除失败由 store 内部处理
    } finally {
      setDeleting(false)
    }
  }

  // V28: 切换智能体启用/禁用
  const handleToggleEnabled = async () => {
    if (!currentAgentId) return
    const newEnabled = !enabled
    try {
      await window.electronAPI.invoke('agent:set-enabled', { id: currentAgentId, enabled: newEnabled })
      setEnabled(newEnabled)
    } catch {
      // 忽略
    }
  }

  // V28: 控制假人上线/下线
  const handleBotControl = async (action: 'online' | 'offline') => {
    if (!currentAgentId) return
    setBotLoading(true)
    try {
      const result = await window.electronAPI.invoke('agent:bot-control', { id: currentAgentId, action }) as {
        success: boolean
        error?: string
      }
      if (result.success) {
        setBotOnline(action === 'online')
      } else {
        console.warn('[AgentInstanceView] bot-control 失败:', result.error)
      }
    } catch {
      console.warn('[AgentInstanceView] bot-control 调用异常')
    } finally {
      setBotLoading(false)
    }
  }

  if (!currentAgentId || !currentSummary) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white rounded-xl shadow-sm border border-gray-200 animate-fadeIn">
        <div className="text-center">
          <div className="text-4xl mb-3 text-gray-300">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto">
              <rect x="3" y="11" width="18" height="10" rx="2" />
              <circle cx="12" cy="5" r="2" />
              <path d="M12 7v4" />
              <line x1="8" y1="16" x2="8" y2="16" />
              <line x1="16" y1="16" x2="16" y2="16" />
            </svg>
          </div>
          <p className="text-sm text-gray-400">未选择智能体</p>
          <p className="text-xs text-gray-400 mt-1">请从左侧列表选择一个智能体查看</p>
        </div>
      </div>
    )
  }

  return (
    <>
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-white rounded-xl shadow-sm border border-gray-200 animate-fadeIn">
      {/* 标题栏 - 上栏：头像、名字、状态、控制按钮、Tabs */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center border border-gray-200 flex-shrink-0">
            {(currentSummary.skinData || currentAgent?.skinData) ? (
              <img
                src={currentSummary.skinData || currentAgent?.skinData}
                alt="头像"
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-sm font-medium text-gray-500">
                {currentSummary.name.charAt(0)}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-gray-800">{currentSummary.name}</span>
              {/* V28: 启用/禁用开关 */}
              <Switch
                isSelected={enabled}
                onChange={handleToggleEnabled}
              >
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch.Content>
              </Switch>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-xs ${enabled ? 'text-green-600' : 'text-gray-400'}`}>
                {enabled ? '已启用' : '已禁用'}
              </span>
              <span className="text-xs text-gray-400 ml-1 capitalize">{currentSummary.status}</span>
              <span className="text-xs text-gray-400 ml-1">
                {currentSummary.lastActiveAt ? `最后活跃: ${formatTime(currentSummary.lastActiveAt)}` : '未运行'}
              </span>
              {/* V24: QQ 连接状态 */}
              {currentAgent?.qqBinding?.enabled && (
                <span className={`ml-1 inline-flex items-center gap-1 text-xs ${qqStatus === 'connected' ? 'text-green-500' : 'text-gray-400'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${qqStatus === 'connected' ? 'bg-green-500' : 'bg-gray-300'}`} />
                  QQ: {qqStatus === 'connected' ? '在线' : qqStatus === 'connecting' ? '连接中' : '离线'}
                </span>
              )}
              {/* V28: 假人上线状态 */}
              <span className={`ml-1 inline-flex items-center gap-1 text-xs ${botOnline ? 'text-green-500' : 'text-gray-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${botOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
                假人: {botOnline ? '在线' : '离线'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* V28: 上线/下线按钮 - 使用 HeroUI Button 的 onPress 避免与 react-aria-components 的事件冲突 */}
          <Button
            onPress={() => handleBotControl(botOnline ? 'offline' : 'online')}
            isDisabled={botLoading}
            isPending={botLoading}
            variant="ghost"
            size="sm"
            className={`${botOnline ? 'bg-orange-50 text-orange-600 hover:bg-orange-100 border border-orange-200' : 'bg-green-50 text-green-600 hover:bg-green-100 border border-green-200'} ${botLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {botOnline ? <WifiOff size={12} /> : <Wifi size={12} />}
            {botLoading ? '处理中...' : botOnline ? '下线' : '上线'}
          </Button>
          <Tabs
            selectedKey={agentViewTab}
            onSelectionChange={(key) => setAgentViewTab(key as 'info' | 'config' | 'qq')}
          >
            <Tabs.ListContainer>
              <Tabs.List aria-label="智能体视图">
                <Tabs.Tab id="info">
                  信息
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="config">
                  配置
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="qq">
                  QQ
                  <Tabs.Indicator />
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>
          <button
            onClick={() => deleteState.open()}
            className="ml-1 p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            title="删除智能体"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* 内容区 - 下栏：高度由父容器决定，由子组件自行处理滚动 */}
      <div className="flex-1 min-h-0 flex flex-col">
        {agentViewTab === 'info' ? (
          <ChatPanel />
        ) : agentViewTab === 'config' ? (
          <AgentConfigForm agentId={currentAgentId} />
        ) : (
          <QQPanel agentId={currentAgentId} />
        )}
      </div>
    </div>

    {/* 删除确认弹窗 */}
    {currentSummary && (
        <Modal state={deleteState}>
          <div />
          <Modal.Backdrop>
            <Modal.Container size="xs">
              <Modal.Dialog className="sm:max-w-[360px]">
                {() => (
                  <>
                    <Modal.Header>
                      <Modal.Icon className="bg-danger-soft text-danger-soft-foreground">
                        <AlertTriangle size={16} />
                      </Modal.Icon>
                      <Modal.Heading>确认删除</Modal.Heading>
                    </Modal.Header>
                    <Modal.Body>
                      <p className="text-sm text-gray-600">
                        确定要删除智能体 <strong>{currentSummary.name}</strong>？此操作不可恢复。
                      </p>
                    </Modal.Body>
                    <Modal.Footer>
                      <Button
                        variant="secondary"
                        isDisabled={deleting}
                        onPress={() => {
                          deleteState.close()
                        }}
                      >
                        取消
                      </Button>
                      <Button
                        isDisabled={deleting}
                        isPending={deleting}
                        onPress={handleDelete}
                      >
                        {deleting ? '删除中...' : '确认删除'}
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

export default AgentInstanceView