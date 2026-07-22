/**
 * 简化版自动更新模块类型定义
 *
 * 当前实现：所有用户均可从 `copper-lamp/Alice-App` 拉取 GitHub Releases 更新，无 tier 限制。
 * 未来扩展：多档位订阅、许可证管理、Feature Flag、服务端策略下发。
 */

export interface UpdateInfo {
  /** 是否有可用更新 */
  available: boolean
  /** 新版本号 */
  version?: string
  /** 当前版本号 */
  currentVersion: string
  /** 下载进度（0-100） */
  downloadProgress: number
  /** 更新状态 */
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error'
  /** 错误信息 */
  error?: string
}