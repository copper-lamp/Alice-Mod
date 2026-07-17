import React, { useEffect, useState } from 'react'
import { Button, ProgressBar } from '@heroui/react'

interface InstallStatus {
  installed: boolean
  installDir: string
  defaultInstallDir: string
  dockerVersion?: string
  isDockerInstalled?: boolean
  napcatInstalled?: boolean
  error?: string
}

interface InstallProgress {
  percent: number
  stage: string
  message: string
}

interface Props {
  onComplete: () => void
}

type SetupMode = 'choose' | 'docker' | 'desktop'
type DesktopSubMode = 'auto' | 'manual'

const STAGE_LABELS: Record<string, string> = {
  checking_docker: '检查 Docker 环境',
  pulling_image: '拉取镜像中',
  installing: '安装 NapCat 中',
  done: '安装完成',
}

export const NapCatSetupWizard: React.FC<Props> = ({ onComplete }) => {
  const [step, setStep] = useState<SetupMode>('choose')
  const [desktopSubMode, setDesktopSubMode] = useState<DesktopSubMode>('auto')
  const [dockerStatus, setDockerStatus] = useState<{ available: boolean; version?: string; error?: string; isDockerInstalled?: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null)
  const [installDir, setInstallDir] = useState<string | null>(null)
  const [manualVerifyResult, setManualVerifyResult] = useState<{ success: boolean; installDir?: string; error?: string } | null>(null)

  useEffect(() => {
    checkDockerStatus()
  }, [])

  const checkDockerStatus = async () => {
    try {
      const result = await window.electronAPI.invoke('qq-bot:get-install-status') as InstallStatus
      setDockerStatus({
        available: result.installed,
        version: result.dockerVersion,
        isDockerInstalled: result.isDockerInstalled,
        error: result.error,
      })
    } catch (err) {
      setDockerStatus({ available: false, error: '获取安装状态失败' })
    }
  }

  const installDocker = async () => {
    setLoading(true)
    setError(null)
    setInstallProgress({ percent: 0, stage: 'checking_docker', message: '正在检查 Docker 环境...' })

    try {
      const result = await window.electronAPI.invoke('qq-bot:install-napcat', 'docker') as { success: boolean; message?: string; error?: string }
      if (result.success) {
        setInstallProgress({ percent: 100, stage: 'done', message: 'NapCat 镜像已就绪' })
        setTimeout(() => onComplete(), 800)
      } else {
        setError(result.error || '拉取镜像失败')
        setInstallProgress(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '拉取镜像失败')
      setInstallProgress(null)
    } finally {
      setLoading(false)
    }
  }

  const installDesktop = async (dir?: string) => {
    setLoading(true)
    setError(null)
    setInstallProgress({ percent: 0, stage: 'installing', message: '正在安装 NapCat 桌面版...' })

    try {
      const result = await window.electronAPI.invoke('qq-bot:install-napcat', 'desktop', dir) as { success: boolean; message?: string; error?: string }
      if (result.success) {
        setInstallProgress({ percent: 100, stage: 'done', message: 'NapCat 桌面版已安装完成' })
        setTimeout(() => onComplete(), 800)
      } else {
        setError(result.error || '安装失败')
        setInstallProgress(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '安装失败')
      setInstallProgress(null)
    } finally {
      setLoading(false)
    }
  }

  const verifyManualInstall = async (dir: string) => {
    setLoading(true)
    setError(null)
    setManualVerifyResult(null)

    try {
      const result = await window.electronAPI.invoke('qq-bot:verify-napcat-install', dir) as { success: boolean; installDir?: string; error?: string }
      setManualVerifyResult(result)
      if (result.success) {
        // 验证成功，延迟完成
        setTimeout(() => onComplete(), 1200)
      }
    } catch (err) {
      setManualVerifyResult({ success: false, error: err instanceof Error ? err.message : '验证安装目录失败' })
    } finally {
      setLoading(false)
    }
  }

  const progressColor = (pct: number) => {
    if (pct < 30) return 'danger' as const
    if (pct < 70) return 'warning' as const
    return 'success' as const
  }

  // ======== 第一步：选择部署方式 ========
  if (step === 'choose') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-xl shadow-sm border border-gray-200 p-8 overflow-hidden">
        <div className="w-20 h-20 rounded-full bg-blue-50 flex items-center justify-center mb-5">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-blue-500">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          </svg>
        </div>

        <h1 className="text-xl font-semibold text-gray-800 mb-2">选择 NapCat 部署方式</h1>
        <p className="text-sm text-gray-500 mb-6 text-center max-w-md">
          NapCat 是 QQ 机器人协议适配器，有两种部署方式可选
        </p>

        <div className="w-full max-w-lg flex flex-col gap-4">
          {/* Docker 方案 */}
          <button
            className="w-full flex items-start gap-4 p-4 rounded-lg border-2 border-gray-200 hover:border-blue-400 hover:bg-blue-50/50 transition-colors text-left"
            onClick={() => {
              setStep('docker')
              checkDockerStatus()
            }}
          >
            <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center shrink-0 mt-1">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-blue-500">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v8M8 12h8" />
              </svg>
            </div>
            <div>
              <h3 className="font-medium text-gray-800">Docker 容器方案（推荐）</h3>
              <p className="text-sm text-gray-500 mt-1">
                通过 Docker 运行 NapCat，跨平台、自动重启、多账号隔离。<br />
                需要安装 Docker Desktop。
              </p>
            </div>
          </button>

          {/* 桌面版方案 */}
          <button
            className="w-full flex items-start gap-4 p-4 rounded-lg border-2 border-gray-200 hover:border-blue-400 hover:bg-blue-50/50 transition-colors text-left"
            onClick={() => setStep('desktop')}
          >
            <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center shrink-0 mt-1">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-green-500">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            </div>
            <div>
              <h3 className="font-medium text-gray-800">桌面版 NapCat</h3>
              <p className="text-sm text-gray-500 mt-1">
                直接在本机运行 NapCat 进程，无需 Docker。<br />
                适合已有 NapCat 使用经验的用户。
              </p>
            </div>
          </button>
        </div>
      </div>
    )
  }

  // ======== Docker 方案流程 ========

  // Docker 未安装或未运行
  if (step === 'docker' && dockerStatus && !dockerStatus.available) {
    const isInstalled = dockerStatus.isDockerInstalled === true
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-xl shadow-sm border border-gray-200 p-8 overflow-hidden">
        <div className="w-20 h-20 rounded-full bg-red-50 flex items-center justify-center mb-5">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-red-500">
            <path d="M12 9v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        </div>

        <h1 className="text-xl font-semibold text-gray-800 mb-2">
          {isInstalled ? 'Docker 未运行' : '需要 Docker 环境'}
        </h1>

        {isInstalled ? (
          <p className="text-sm text-gray-500 mb-6 text-center max-w-md">
            已检测到 Docker Desktop，但守护进程未运行。
            <br />
            请启动 Docker Desktop 后再重新检测。
          </p>
        ) : (
          <p className="text-sm text-gray-500 mb-6 text-center max-w-md">
            NapCat Docker 方案需要 Docker Desktop 才能运行。
            <br />
            请先安装 Docker Desktop 后再继续。
          </p>
        )}

        {dockerStatus.error && (
          <div className="w-full max-w-lg text-sm text-red-500 bg-red-50 rounded-lg p-3 border border-red-100 mb-4">
            {dockerStatus.error}
          </div>
        )}

        <div className="flex flex-col gap-3 w-64">
          {isInstalled ? (
            <>
              <Button
                size="lg"
                onPress={() => {
                  setLoading(true)
                  checkDockerStatus().finally(() => setLoading(false))
                }}
                isPending={loading}
              >
                启动 Docker 后，点击重新检测
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onPress={() => setStep('choose')}
              >
                返回选择其他部署方式
              </Button>
            </>
          ) : (
            <>
              <Button
                size="lg"
                onPress={() => window.open('https://www.docker.com/products/docker-desktop/')}
              >
                下载 Docker Desktop
              </Button>
              <Button
                size="lg"
                variant="secondary"
                onPress={() => {
                  setLoading(true)
                  checkDockerStatus().finally(() => setLoading(false))
                }}
                isPending={loading}
              >
                我已安装，重新检测
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onPress={() => setStep('choose')}
              >
                返回选择其他部署方式
              </Button>
            </>
          )}
        </div>
      </div>
    )
  }

  // Docker 检查中
  if (step === 'docker' && !dockerStatus) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin" width="24" height="24" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="text-gray-200" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" className="text-blue-500" strokeLinecap="round" />
          </svg>
          <span className="text-sm text-gray-400">正在检查 Docker 环境...</span>
        </div>
      </div>
    )
  }

  // Docker 已就绪 → 拉取镜像
  if (step === 'docker' && dockerStatus?.available) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-xl shadow-sm border border-gray-200 p-8 overflow-hidden">
        <div className="w-20 h-20 rounded-full bg-blue-50 flex items-center justify-center mb-5">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-blue-500">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
        </div>

        <h1 className="text-xl font-semibold text-gray-800 mb-2">NapCat Docker 安装向导</h1>
        <p className="text-sm text-gray-500 mb-6 text-center max-w-md">
          NapCat 将以 Docker 容器方式运行，无需手动下载安装包。
          <br />
          点击下方按钮拉取 NapCat 镜像即可开始使用。
        </p>

        <div className="w-full max-w-lg">
          {installProgress ? (
            <div className="flex flex-col items-center gap-4 py-4">
              <ProgressBar value={installProgress.percent} color={progressColor(installProgress.percent)} size="md" className="w-full">
                <ProgressBar.Track>
                  <ProgressBar.Fill />
                </ProgressBar.Track>
              </ProgressBar>
              <div className="flex justify-between w-full text-sm">
                <span className="text-gray-600">{STAGE_LABELS[installProgress.stage] || installProgress.stage}</span>
                <span className="text-gray-700 font-semibold">{installProgress.percent}%</span>
              </div>
              <span className="text-xs text-gray-400">{installProgress.message}</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="w-full bg-gray-50 rounded-lg p-3 border border-gray-200">
                <div className="flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-500 shrink-0">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  <span className="text-sm text-gray-700">Docker 已就绪</span>
                </div>
                {dockerStatus.version && (
                  <div className="text-xs text-gray-400 mt-1 ml-6">Docker Engine: v{dockerStatus.version}</div>
                )}
              </div>

              <Button size="lg" isPending={loading} onPress={installDocker} className="w-64">
                {loading ? '正在拉取镜像...' : '拉取 NapCat 镜像'}
              </Button>

              <Button size="sm" variant="ghost" onPress={() => setStep('choose')}>
                返回选择其他部署方式
              </Button>

              {error && (
                <div className="w-full text-sm text-red-500 bg-red-50 rounded-lg p-3 border border-red-100">{error}</div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ======== 桌面版方案流程 ========
  if (step === 'desktop') {
    return (
      <div className="flex-1 flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {/* 顶部标题 */}
        <div className="flex flex-col items-center pt-8 pb-4 px-8 shrink-0">
          <div className="w-20 h-20 rounded-full bg-green-50 flex items-center justify-center mb-5">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-green-500">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
          </div>

          <h1 className="text-xl font-semibold text-gray-800 mb-2">NapCat 桌面版安装向导</h1>
          <p className="text-sm text-gray-500 text-center max-w-md">
            NapCat 将直接在本机运行，可选择自动下载或手动安装。
          </p>
        </div>

        {/* 安装方式切换 */}
        <div className="flex justify-center gap-2 px-8 mb-4">
          <button
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              desktopSubMode === 'auto'
                ? 'bg-green-100 text-green-700'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
            onClick={() => { setDesktopSubMode('auto'); setManualVerifyResult(null); setError(null) }}
          >
            自动安装
          </button>
          <button
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              desktopSubMode === 'manual'
                ? 'bg-green-100 text-green-700'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
            onClick={() => { setDesktopSubMode('manual'); setError(null) }}
          >
            手动安装
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-8 pb-8">
          <div className="max-w-lg mx-auto">
            {desktopSubMode === 'auto' ? (
              /* ── 自动安装 ── */
              <div>
                {installProgress ? (
                  <div className="flex flex-col items-center gap-4 py-4">
                    <ProgressBar value={installProgress.percent} color={progressColor(installProgress.percent)} size="md" className="w-full">
                      <ProgressBar.Track>
                        <ProgressBar.Fill />
                      </ProgressBar.Track>
                    </ProgressBar>
                    <div className="flex justify-between w-full text-sm">
                      <span className="text-gray-600">{STAGE_LABELS[installProgress.stage] || installProgress.stage}</span>
                      <span className="text-gray-700 font-semibold">{installProgress.percent}%</span>
                    </div>
                    <span className="text-xs text-gray-400">{installProgress.message}</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-full bg-gray-50 rounded-lg p-3 border border-gray-200">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-gray-500 mb-1">安装目录</div>
                          <div className="text-sm text-gray-700 truncate font-mono">
                            {installDir || '默认位置（软件安装目录/Alice/qq-bot/napcat-install/）'}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          onPress={async () => {
                            const dir = await window.electronAPI.invoke('qq-bot:choose-install-dir') as string | null
                            if (dir) setInstallDir(dir)
                          }}
                        >
                          选择目录
                        </Button>
                      </div>
                    </div>

                    <Button size="lg" isPending={loading} onPress={() => installDesktop(installDir || undefined)} className="w-64">
                      {loading ? '正在安装...' : '安装 NapCat 桌面版'}
                    </Button>

                    {error && (
                      <div className="w-full text-sm text-red-500 bg-red-50 rounded-lg p-3 border border-red-100">{error}</div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              /* ── 手动安装 ── */
              <div>
                {manualVerifyResult?.success ? (
                  <div className="flex flex-col items-center gap-4 py-8">
                    <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-green-500">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    </div>
                    <h2 className="text-lg font-semibold text-gray-800">验证通过</h2>
                    <p className="text-sm text-gray-500 text-center">
                      NapCat 手动安装已确认，安装目录：
                    </p>
                    <div className="text-sm text-gray-700 font-mono bg-gray-50 rounded-lg px-4 py-2 border border-gray-200 w-full break-all">
                      {manualVerifyResult.installDir}
                    </div>
                    <p className="text-xs text-gray-400 mt-2">即将跳转...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-full bg-blue-50 rounded-lg p-4 border border-blue-100">
                      <h3 className="text-sm font-medium text-blue-800 mb-2">手动安装说明</h3>
                      <ol className="text-xs text-blue-700 space-y-1.5 list-decimal list-inside">
                        <li>前往 GitHub Releases 下载 NapCat 安装包（如 NapCat.Shell.Windows.OneKey.zip）</li>
                        <li>将安装包解压到任意目录</li>
                        <li>点击下方"选择目录"，选择已解压的 NapCat 目录</li>
                        <li>点击"验证安装"确认 NapCat 完整性</li>
                      </ol>
                    </div>

                    <div className="w-full bg-gray-50 rounded-lg p-3 border border-gray-200">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-gray-500 mb-1">NapCat 安装目录</div>
                          <div className="text-sm text-gray-700 truncate font-mono">
                            {installDir || '请选择已解压的 NapCat 目录'}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          onPress={async () => {
                            const dir = await window.electronAPI.invoke('qq-bot:choose-install-dir') as string | null
                            if (dir) setInstallDir(dir)
                          }}
                        >
                          选择目录
                        </Button>
                      </div>
                    </div>

                    <Button
                      size="lg"
                      isPending={loading}
                      isDisabled={!installDir}
                      onPress={() => verifyManualInstall(installDir!)}
                      className="w-64"
                    >
                      {loading ? '验证中...' : '验证安装'}
                    </Button>

                    {manualVerifyResult && !manualVerifyResult.success && (
                      <div className="w-full text-sm text-red-500 bg-red-50 rounded-lg p-3 border border-red-100">
                        {manualVerifyResult.error}
                      </div>
                    )}

                    {error && (
                      <div className="w-full text-sm text-red-500 bg-red-50 rounded-lg p-3 border border-red-100">{error}</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 返回按钮 */}
            {!loading && !manualVerifyResult?.success && !installProgress && (
              <div className="flex justify-center mt-4">
                <Button size="sm" variant="ghost" onPress={() => { setStep('choose'); setDesktopSubMode('auto'); setManualVerifyResult(null); }}>
                  返回选择其他部署方式
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return null
}