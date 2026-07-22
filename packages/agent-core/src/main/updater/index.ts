/**
 * AC 自动更新模块
 *
 * 当前为简化版实现：
 * - 所有用户均可从 `copper-lamp/Alice-App` 拉取 GitHub Releases 更新
 * - 无许可证/无 tier/无 Feature Flag
 * - 启动时自动检查，有更新则后台下载，下载完成后提示重启
 *
 * 未来完整实现参见 docs/version-plans/AC/AC-V33-自动更新模块-需求文档.md
 */

export { Updater, updater } from './updater'
export type { UpdateInfo } from './types'