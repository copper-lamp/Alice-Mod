import React, { useEffect, useState } from 'react'
import { Spinner } from '@heroui/react'
import { useQQBotStore, type AccountStatusUpdate } from '../../stores/qqBotStore'
import { AccountListView } from './list/AccountListView'
import { AccountDetailView } from './detail/AccountDetailView'
import { AddAccountPanel } from './detail/AddAccountPanel'
import { EmptyState } from './list/EmptyState'
import { NapCatSetupWizard } from './setup/NapCatSetupWizard'

interface InstallStatus {
  installed: boolean
  installDir: string
  defaultInstallDir: string
  dockerVersion?: string
  isDockerInstalled?: boolean
  napcatInstalled?: boolean
  error?: string
}

export const RobotPage: React.FC = () => {
  const accounts = useQQBotStore(s => s.accounts)
  const loading = useQQBotStore(s => s.loading)
  const isAddingAccount = useQQBotStore(s => s.isAddingAccount)
  const loadAccounts = useQQBotStore(s => s.loadAccounts)

  const [installStatus, setInstallStatus] = useState<InstallStatus | null>(null)
  const [checkingInstall, setCheckingInstall] = useState(true)

  useEffect(() => {
    loadAccounts()
    checkInstallStatus()

    // 监听账号状态推送
    const unsubscribe = window.electronAPI.on('qq-bot:status-update', (update: unknown) => {
      useQQBotStore.getState().handleStatusUpdate(update as AccountStatusUpdate)
    })
    return () => {
      unsubscribe?.()
    }
  }, [loadAccounts])

  const checkInstallStatus = async () => {
    try {
      const status = await window.electronAPI.invoke('qq-bot:get-install-status') as InstallStatus
      setInstallStatus(status)
    } catch {
      setInstallStatus({ installed: false, installDir: '', defaultInstallDir: '' })
    } finally {
      setCheckingInstall(false)
    }
  }

  if (checkingInstall || (loading && accounts.length === 0)) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white rounded-xl shadow-sm border border-gray-200">
        <Spinner />
        <span className="ml-2 text-sm text-gray-400">加载中...</span>
      </div>
    )
  }

  // 未安装 NapCat 时强制显示安装向导
  if (!installStatus?.installed) {
    return <NapCatSetupWizard onComplete={checkInstallStatus} />
  }

  if (accounts.length === 0 && !isAddingAccount) {
    return (
      <div className="flex-1 flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 p-6 overflow-hidden">
        <EmptyState />
      </div>
    )
  }

  return (
    <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">
      {/* 左侧账号列表 */}
      <div className="w-80 flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <AccountListView />
      </div>

      {/* 右侧详情 / 添加面板 */}
      <div className="flex-1 flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {isAddingAccount ? <AddAccountPanel /> : <AccountDetailView />}
      </div>
    </div>
  )
}
