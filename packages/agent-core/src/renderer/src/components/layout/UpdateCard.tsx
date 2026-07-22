import React from 'react'
import { useUpdaterStore } from '../../stores/updaterStore'

/**
 * 更新提示卡片
 *
 * 显示在页面左下角，有可用更新时展示：
 * - 更新可用 → 显示"下载更新"按钮
 * - 下载中 → 显示进度条
 * - 下载完成 → 显示"重启安装"按钮
 * - 错误 → 显示错误信息和"重试"按钮
 * - 可点击 × 关闭
 */
const UpdateCard: React.FC = () => {
  const { info, dismissed, dismiss, download, install, clearError } = useUpdaterStore()
  const { status, version, currentVersion, downloadProgress, error } = info

  // 只在需要展示的状态下显示卡片
  const visible = !dismissed && (
    status === 'available' ||
    status === 'downloading' ||
    status === 'downloaded' ||
    (status === 'error' && version !== undefined)
  )

  if (!visible) return null

  const isProgress = status === 'downloading'
  const isDownloaded = status === 'downloaded'
  const isError = status === 'error'

  return (
    <div className="fixed bottom-4 left-4 z-50 w-80">
      <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span className="text-sm font-semibold text-gray-800">更新可用</span>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="p-0.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="关闭"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 版本信息 */}
        <div className="px-4 py-2">
          <div className="text-xs text-gray-500 space-y-0.5">
            <div className="flex justify-between">
              <span>当前版本</span>
              <span className="font-mono text-gray-700">{currentVersion || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span>最新版本</span>
              <span className="font-mono text-blue-600 font-medium">{version || '-'}</span>
            </div>
          </div>
        </div>

        {/* 进度条 */}
        {isProgress && (
          <div className="px-4 pb-2">
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
            <div className="text-[10px] text-gray-400 text-right mt-0.5">
              {downloadProgress}%
            </div>
          </div>
        )}

        {/* 错误信息 */}
        {isError && error && (
          <div className="px-4 pb-2">
            <div className="text-[11px] text-red-500 bg-red-50 rounded px-2 py-1 break-words">
              {error}
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="px-4 pb-3 flex gap-2">
          {isError && (
            <button
              type="button"
              onClick={() => { clearError(); download() }}
              className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors"
            >
              重试下载
            </button>
          )}

          {status === 'available' && (
            <button
              type="button"
              onClick={download}
              className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors"
            >
              下载更新
            </button>
          )}

          {isDownloaded && (
            <button
              type="button"
              onClick={install}
              className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-green-500 rounded-lg hover:bg-green-600 transition-colors"
            >
              重启安装
            </button>
          )}

          {/* 下载中禁用 */}
          {isProgress && (
            <button
              type="button"
              disabled
              className="flex-1 px-3 py-1.5 text-xs font-medium text-gray-400 bg-gray-100 rounded-lg cursor-not-allowed"
            >
              下载中...
            </button>
          )}

          {/* 非错误 / 非下载中都可关闭 */}
          {!isError && !isProgress && (
            <button
              type="button"
              onClick={dismiss}
              className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              稍后
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default UpdateCard
