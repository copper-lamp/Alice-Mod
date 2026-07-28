import React, { useEffect } from 'react'
import { Alert, Button, Modal, ProgressBar, Tabs, useOverlayState } from '@heroui/react'
import { AlertTriangle } from 'lucide-react'
import { useAgentStore } from '../../stores/agentStore'
import { useUIStore } from '../../stores/uiStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import AgentHeader from './AgentHeader'
import AgentConfigForm from './AgentConfigForm'
import AgentRuntimeView from './runtime/AgentRuntimeView'

const AgentInstanceView: React.FC = () => {
  const agentViewTab = useUIStore(s => s.agentViewTab)
  const setAgentViewTab = useUIStore(s => s.setAgentViewTab)
  const hasUnsavedAgentSettings = useUIStore(s => s.hasUnsavedAgentSettings)
  const pendingAgentNavigation = useUIStore(s => s.pendingAgentNavigation)
  const setHasUnsavedAgentSettings = useUIStore(s => s.setHasUnsavedAgentSettings)
  const proceedPendingAgentNavigation = useUIStore(s => s.proceedPendingAgentNavigation)
  const cancelPendingAgentNavigation = useUIStore(s => s.cancelPendingAgentNavigation)
  const setLayoutMode = useUIStore(s => s.setLayoutMode)
  const { currentAgent, currentAgentId, agents, loading, error, fetchAgent } = useAgentStore()
  const workspaceId = useWorkspaceStore(s => s.currentWorkspaceId)
  const navigationState = useOverlayState()
  const summary = agents.find(agent => agent.id === currentAgentId)

  useEffect(() => {
    if (currentAgentId && currentAgent?.id !== currentAgentId) void fetchAgent(currentAgentId)
  }, [currentAgent, currentAgentId, fetchAgent])

  useEffect(() => {
    if (pendingAgentNavigation && hasUnsavedAgentSettings) navigationState.open()
    if (!pendingAgentNavigation) navigationState.close()
  }, [hasUnsavedAgentSettings, navigationState, pendingAgentNavigation])

  if (!currentAgentId) {
    return <div className="flex flex-1 items-center justify-center rounded-xl bg-surface shadow-sm"><div className="text-center"><p className="text-sm text-muted">未选择智能体</p><p className="mt-1 text-xs text-muted">请从左侧列表选择一个智能体查看</p></div></div>
  }

  if (loading && !currentAgent) {
    return <div className="flex flex-1 items-center justify-center rounded-xl bg-surface shadow-sm"><ProgressBar isIndeterminate size="sm" className="w-52" /></div>
  }

  if (error) {
    return <div className="flex flex-1 items-center justify-center rounded-xl bg-surface p-6 shadow-sm"><Alert status="danger" className="max-w-lg"><Alert.Content><Alert.Title>智能体详情加载失败</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Content><Button size="sm" variant="secondary" onPress={() => void fetchAgent(currentAgentId)}>重试</Button></Alert></div>
  }

  if (!currentAgent || !summary) {
    return <div className="flex flex-1 items-center justify-center rounded-xl bg-surface shadow-sm"><p className="text-sm text-muted">暂时无法显示智能体详情</p></div>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-surface shadow-sm">
      <AgentHeader agent={currentAgent} summary={summary} />
      <Tabs selectedKey={agentViewTab} onSelectionChange={key => setAgentViewTab(key as 'runtime' | 'settings')} className="flex min-h-0 flex-1 flex-col">
        <Tabs.ListContainer className="shrink-0 px-5 pt-3"><Tabs.List aria-label="智能体视图"><Tabs.Tab id="runtime">运行<Tabs.Indicator /></Tabs.Tab><Tabs.Tab id="settings">设置<Tabs.Indicator /></Tabs.Tab></Tabs.List></Tabs.ListContainer>
        <Tabs.Panel id="runtime" className="flex min-h-0 flex-1 flex-col"><AgentRuntimeView agentId={currentAgentId} workspaceId={workspaceId ?? currentAgent.workspaceId ?? ''} /></Tabs.Panel>
        <Tabs.Panel id="settings" className="min-h-0 flex-1 overflow-y-auto"><AgentConfigForm agentId={currentAgentId} onDirtyChange={setHasUnsavedAgentSettings} onDeleted={() => { setHasUnsavedAgentSettings(false); setLayoutMode('nav-view') }} /></Tabs.Panel>
      </Tabs>
      <Modal state={navigationState}>
        <Modal.Backdrop><Modal.Container size="xs"><Modal.Dialog>{() => <><Modal.Header><Modal.Icon className="bg-warning-soft text-warning-soft-foreground"><AlertTriangle size={16} /></Modal.Icon><Modal.Heading>放弃未保存修改？</Modal.Heading></Modal.Header><Modal.Body><p className="text-sm text-muted">当前设置存在未保存修改，继续导航将丢失这些修改。</p></Modal.Body><Modal.Footer><Button variant="secondary" onPress={cancelPendingAgentNavigation}>取消</Button><Button variant="danger" onPress={proceedPendingAgentNavigation}>继续离开</Button></Modal.Footer></>}</Modal.Dialog></Modal.Container></Modal.Backdrop>
      </Modal>
    </div>
  )
}

export default AgentInstanceView
