import React, { useEffect, useState } from 'react'
import { Button, Spinner, Tabs } from '@heroui/react'

interface InstallStatus {
  installed: boolean
  installDir: string
  executablePath?: string
  defaultInstallDir: string
}

interface Props {
  onComplete: () => void
}

export const NapCatSetupWizard: React.FC<Props> = ({ onComplete }) => {
  const [status, setStatus] = useState<InstallStatus | null>(null)
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const [installDir, setInstallDir] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [installLog, setInstallLog] = useState<string[]>([])

  useEffect(() => {
    loadStatus()
  }, [])

  useEffect(() => {
    if (status) {
      setInstallDir(status.defaultInstallDir)
    }
  }, [status])

  const loadStatus = async () => {
    try {
      const result = await window.electronAPI.invoke('qq-bot:get-install-status') as InstallStatus
      setStatus(result)
      setInstallDir(result.defaultInstallDir)
    } catch {
      setError('获取安装状态失败')
    }
  }

  const chooseDir = async () => {
    setError(null)
    try {
      const dir = await window.electronAPI.invoke('qq-bot:choose-install-dir') as string | null
      if (dir) {
        setInstallDir(dir)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '选择目录失败')
    }
  }

  const installNapCat = async () => {
    setLoading(true)
    setError(null)
    setInstallLog([])
    try {
      const result = await window.electronAPI.invoke('qq-bot:install-napcat', installDir) as { success: boolean; installDir?: string; error?: string }
      if (result.success) {
        setInstallLog(prev => [...prev, `安装成功: ${result.installDir}`])
        await loadStatus()
        onComplete()
      } else {
        setError(result.error || '安装失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '安装失败')
    } finally {
      setLoading(false)
    }
  }

  const setManualDir = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.invoke('qq-bot:set-napcat-dir', installDir) as { success: boolean; error?: string }
      if (result.success) {
        await loadStatus()
        onComplete()
      } else {
        setError(result.error || '目录校验失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '目录校验失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-xl shadow-sm border border-gray-200 p-8 overflow-hidden">
      <div className="w-20 h-20 rounded-full bg-blue-50 flex items-center justify-center mb-5">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-blue-500">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      </div>

      <h1 className="text-xl font-semibold text-gray-800 mb-2">NapCat 安装向导</h1>
      <p className="text-sm text-gray-500 mb-6 text-center max-w-md">
        首次使用 QQ 机器人前，需要先安装 NapCat。你可以选择自动下载安装，或手动指定已解压的 NapCat 目录。
      </p>

      <div className="w-full max-w-lg">
        <Tabs selectedKey={mode} onSelectionChange={(k) => { if (k) setMode(k as 'auto' | 'manual') }}>
          <Tabs.List className="mb-4">
            <Tabs.Tab id="auto">自动下载安装</Tabs.Tab>
            <Tabs.Tab id="manual">手动指定目录</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel id="auto">
            <div className="flex flex-col gap-4">
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                <div className="text-xs text-gray-500 mb-1">安装位置</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 text-sm text-gray-700 truncate font-mono">{installDir}</div>
                  <Button size="sm" variant="secondary" onPress={chooseDir}>更改</Button>
                </div>
                <p className="text-xs text-gray-400 mt-1">推荐选择非系统盘目录，避免占用 C 盘空间</p>
              </div>

              <Button
                size="lg"
                isPending={loading}
                onPress={installNapCat}
              >
                {loading ? '正在下载安装...' : '开始安装 NapCat'}
              </Button>

              {error && (
                <div className="text-sm text-red-500 bg-red-50 rounded-lg p-3 border border-red-100">
                  {error}
                </div>
              )}

              {installLog.length > 0 && (
                <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 border border-gray-200 max-h-32 overflow-y-auto font-mono">
                  {installLog.map((line, i) => <div key={i}>{line}</div>)}
                </div>
              )}
            </div>
          </Tabs.Panel>

          <Tabs.Panel id="manual">
            <div className="flex flex-col gap-4">
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                <div className="text-xs text-gray-500 mb-1">NapCat 目录</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 text-sm text-gray-700 truncate font-mono">{installDir || '未选择'}</div>
                  <Button size="sm" variant="secondary" onPress={chooseDir}>选择目录</Button>
                </div>
                <p className="text-xs text-gray-400 mt-1">需要包含 napcat.exe 或 launcher.bat 等可执行文件</p>
              </div>

              <Button
                size="lg"
                isPending={loading}
                isDisabled={!installDir}
                onPress={setManualDir}
              >
                {loading ? '校验中...' : '确认使用该目录'}
              </Button>

              {error && (
                <div className="text-sm text-red-500 bg-red-50 rounded-lg p-3 border border-red-100">
                  {error}
                </div>
              )}
            </div>
          </Tabs.Panel>
        </Tabs>
      </div>

      <div className="mt-6 text-xs text-gray-400">
        默认安装位置：{status?.defaultInstallDir ?? '加载中...'}
      </div>
    </div>
  )
}
