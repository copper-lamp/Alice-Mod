import React, { useEffect, useState } from 'react'
import { Button, Spinner, Tabs } from '@heroui/react'
import QRCode from 'qrcode'
import { useQQBotStore } from '../../../stores/qqBotStore'
import { ManualConfig } from '../dialog/ManualConfig'

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}分${String(s).padStart(2, '0')}秒`
}

export const AddAccountPanel: React.FC = () => {
  const addMode = useQQBotStore(s => s.addMode)
  const qrCodeData = useQQBotStore(s => s.qrCodeData)
  const qrCodeExpiresAt = useQQBotStore(s => s.qrCodeExpiresAt)
  const qrCodeStatus = useQQBotStore(s => s.qrCodeStatus)
  const isConfiguring = useQQBotStore(s => s.isConfiguring)
  const setAddMode = useQQBotStore(s => s.setAddMode)
  const refreshQRCode = useQQBotStore(s => s.refreshQRCode)
  const cancelAddAccount = useQQBotStore(s => s.cancelAddAccount)

  const [qrImage, setQrImage] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(0)

  useEffect(() => {
    if (qrCodeData?.url) {
      QRCode.toDataURL(qrCodeData.url, { width: 200, margin: 2, color: { dark: '#000000', light: '#ffffff' } })
        .then(setQrImage)
        .catch(() => setQrImage(null))
    } else {
      setQrImage(null)
    }
  }, [qrCodeData])

  useEffect(() => {
    if (!qrCodeExpiresAt) return
    const update = () => {
      const remaining = Math.max(0, Math.floor((qrCodeExpiresAt - Date.now()) / 1000))
      setCountdown(remaining)
    }
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [qrCodeExpiresAt])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
        <h2 className="text-base font-semibold text-gray-800">添加QQ账号</h2>
        <Button size="sm" variant="secondary" onPress={cancelAddAccount} isDisabled={isConfiguring}>
          取消
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <Tabs aria-label="添加方式" selectedKey={addMode} onSelectionChange={(key) => { if (key) setAddMode(key as 'qr' | 'manual') }}>
          <Tabs.List>
            <Tabs.Tab id="qr">扫码登录</Tabs.Tab>
            <Tabs.Tab id="manual">手动配置</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel id="qr" className="pt-4">
            <div className="flex flex-col items-center gap-3 max-w-md mx-auto">
              <div className="w-52 h-52 bg-white border border-gray-200 rounded-xl flex items-center justify-center overflow-hidden p-2">
                {qrCodeStatus === 'loading' ? (
                  <Spinner />
                ) : qrImage ? (
                  <img src={qrImage} alt="登录二维码" className="w-48 h-48" />
                ) : (
                  <span className="text-gray-400 text-sm">加载中...</span>
                )}
              </div>

              <div className="text-center">
                {qrCodeStatus === 'success' ? (
                  <>
                    <p className="text-sm font-medium text-green-600">登录成功</p>
                    <p className="text-xs text-gray-400 mt-1">正在加载账号信息...</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-gray-700">请使用手机QQ扫描二维码登录</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {countdown > 0
                        ? `二维码将在 ${formatCountdown(countdown)} 后过期`
                        : qrCodeStatus === 'ready' ? '二维码已过期，请点击刷新' : '正在生成二维码...'}
                    </p>
                  </>
                )}
              </div>

              {qrCodeStatus !== 'success' && qrCodeStatus !== 'loading' && (
                <Button variant="secondary" size="sm" onPress={refreshQRCode}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <polyline points="23 4 23 10 17 10" />
                    <polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                  刷新二维码
                </Button>
              )}

              {qrCodeStatus === 'error' && (
                <div className="flex items-center gap-2 text-red-500 text-sm">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                  <span>二维码生成失败或登录异常，请重试</span>
                </div>
              )}

              <div className="text-xs text-gray-400 bg-gray-50 rounded-lg p-3 w-full">
                <p>提示：</p>
                <ul className="list-disc list-inside mt-1 space-y-0.5">
                  <li>请确保手机QQ已登录</li>
                  <li>二维码有效期内只能扫描一次</li>
                  <li>扫描后请在手机上确认登录</li>
                </ul>
              </div>
            </div>
          </Tabs.Panel>

          <Tabs.Panel id="manual" className="pt-4">
            <div className="max-w-md mx-auto">
              <ManualConfig />
            </div>
          </Tabs.Panel>
        </Tabs>
      </div>
    </div>
  )
}
