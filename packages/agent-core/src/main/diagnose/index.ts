/**
 * 诊断信息打包工具 - 模块入口
 *
 * 后台自动生成诊断信息 ZIP 包，用户只需要找到压缩包文件发给开发者。
 *
 * 触发时机：
 * - 应用启动时自动生成
 * - 检测到上次崩溃后下次启动时额外生成
 * - 每 24 小时定时生成
 * - 保留最近 3 份，自动清理旧的
 *
 * 输出位置：%APPDATA%/alice-mod/diagnose/diagnose_YYYYMMDD_HHmmss.zip
 */

export { initDiagnoseScheduler, stopDiagnoseScheduler, getDiagnoseScheduler, DiagnoseScheduler } from './scheduler'
export { generateDiagnoseZip } from './packer'
export { collectDiagnoseInfo } from './collector'
export type {
  DiagnoseInfo, EnvironmentInfo, GameStateInfo, WorkspaceInfo, DiagnoseConfig,
  PerformanceMetrics, LlmStatsInfo, ErrorSummaryInfo, QQBotStatsInfo,
  AgentStatsInfo, MemoryStatsInfo, NetworkStatsInfo, TimelineEntry,
  DatabaseSchemaInfo, SystemDetailInfo,
} from './types'