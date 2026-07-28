import { useState } from 'react'
import { Alert, Button, Modal, ProgressBar, toast, useOverlayState } from '@heroui/react'
import { AlertTriangle } from 'lucide-react'
import { useAgentLogs } from '../../../hooks/useAgentLogs'
import type { AgentLogSource, AgentLogType } from '../../../lib/types'
import MessageList from '../../chat/MessageList'
import ChannelRail from './ChannelRail'
import RuntimeSummary from './RuntimeSummary'
import RuntimeToolbar from './RuntimeToolbar'

interface Props { agentId: string; workspaceId: string }

export default function AgentRuntimeView({ agentId, workspaceId }: Props) {
  const [source, setSource] = useState<AgentLogSource>('all')
  const [type, setType] = useState<AgentLogType>('all')
  const [channelExpanded, setChannelExpanded] = useState(true)
  const [summaryExpanded, setSummaryExpanded] = useState(() => window.innerWidth >= 1280)
  const [autoFollow, setAutoFollow] = useState(true)
  const clearState = useOverlayState()
  const logs = useAgentLogs(agentId, workspaceId, source, type)

  const clearQQ = async () => {
    try {
      await logs.clearQQHistory()
      clearState.close()
      toast.success('QQ 历史已清空')
    } catch (reason) {
      toast.danger(reason instanceof Error ? reason.message : '清空 QQ 历史失败')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-surface">
      <ChannelRail source={source} expanded={channelExpanded} onSourceChange={setSource} onExpandedChange={setChannelExpanded} />
      <main className="flex min-w-0 flex-1 flex-col">
        <RuntimeToolbar source={source} type={type} autoFollow={autoFollow} refreshing={logs.refreshing} summaryExpanded={summaryExpanded} onTypeChange={setType} onAutoFollowChange={setAutoFollow} onRefresh={() => void logs.refresh()} onClearQQ={clearState.open} onSummaryExpandedChange={setSummaryExpanded} />
        {logs.error ? <Alert status="danger" className="m-3"><Alert.Content><Alert.Title>运行日志加载失败</Alert.Title><Alert.Description>{logs.error}</Alert.Description></Alert.Content><Button size="sm" variant="secondary" onPress={() => void logs.retry()}>重试</Button></Alert> : null}
        {logs.streamError ? <Alert status="danger" className="mx-3 mt-3"><Alert.Content><Alert.Title>LLM 响应失败</Alert.Title><Alert.Description>{logs.streamError}</Alert.Description></Alert.Content></Alert> : null}
        {logs.loading && !logs.hasMessages ? <div className="flex flex-1 items-center justify-center"><ProgressBar isIndeterminate size="sm" className="w-52" /></div> : !logs.error ? (
          <MessageList messages={logs.messages} isStreaming={logs.isStreaming} streamingEvents={logs.streamingEvents} autoFollow={autoFollow} onAutoFollowChange={setAutoFollow} emptyTitle="暂无运行日志" emptyDescription="等待游戏或 QQ 产生新的运行事件" header={logs.hasMessages ? <div className="mb-3 text-center"><Button size="sm" variant="ghost" onPress={logs.loadEarlier}>加载更早记录</Button></div> : null} />
        ) : null}
        {logs.isStreaming ? <p className="shrink-0 px-4 pb-2 text-xs text-muted">LLM 响应中…{source !== 'all' ? '完成后将刷新当前来源' : ''}</p> : null}
      </main>
      {summaryExpanded ? <RuntimeSummary workspaceId={workspaceId} /> : null}
      <Modal state={clearState}>
        <Modal.Backdrop><Modal.Container size="xs"><Modal.Dialog>{() => <><Modal.Header><Modal.Icon className="bg-danger-soft text-danger-soft-foreground"><AlertTriangle size={16} /></Modal.Icon><Modal.Heading>清空 QQ 历史</Modal.Heading></Modal.Header><Modal.Body><p className="text-sm text-muted">将永久清空当前智能体的 QQ 对话历史，此操作不可恢复。</p></Modal.Body><Modal.Footer><Button variant="secondary" isDisabled={logs.clearing} onPress={clearState.close}>取消</Button><Button variant="danger" isPending={logs.clearing} isDisabled={logs.clearing} onPress={() => void clearQQ()}>确认清空</Button></Modal.Footer></>}</Modal.Dialog></Modal.Container></Modal.Backdrop>
      </Modal>
    </div>
  )
}
