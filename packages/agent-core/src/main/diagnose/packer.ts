/**
 * 诊断信息打包器（大规模数据分析版）
 *
 * 将 17 个维度的诊断信息打包为 ZIP 文件。
 * 包含体积校验和严格模式回退。
 */

import fs from 'node:fs'
import path from 'node:path'
import { ZipArchive } from 'archiver'
import { collectDiagnoseInfo } from './collector'
import type { DiagnoseInfo, DiagnoseConfig } from './types'

/** 默认配置 */
const DEFAULT_CONFIG: DiagnoseConfig = {
  outputDir: '',
  maxKeep: 3,
  maxLogBytes: 5 * 1024 * 1024,        // 5MB 日志
  toolCallCount: 500,
  maxZipSize: 200 * 1024 * 1024,        // 200MB
  intervalMs: 24 * 60 * 60 * 1000,       // 24h
  strictMaxLogBytes: 1024 * 1024,        // 1MB
  strictToolCallCount: 100,
  llmRecordCount: 500,
  logQueryLimit: 20000,
  collectPerfMetrics: true,
  collectTimeline: true,
}

/**
 * 生成诊断 ZIP 包
 */
export async function generateDiagnoseZip(
  outputDir: string,
  options?: {
    reason?: string
    lastExitCode?: number
    lastRunCrashed?: boolean
  },
): Promise<string> {
  const config = { ...DEFAULT_CONFIG, outputDir }

  fs.mkdirSync(outputDir, { recursive: true })

  const info = await collectDiagnoseInfo({
    maxLogBytes: config.maxLogBytes,
    toolCallCount: config.toolCallCount,
    lastExitCode: options?.lastExitCode,
    lastRunCrashed: options?.lastRunCrashed,
  })

  const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
  const suffix = options?.reason ? `_${options.reason}` : ''
  const fileName = `diagnose_${timestamp}${suffix}.zip`
  const outputPath = path.join(outputDir, fileName)

  await packToZip(info, outputPath)

  // 体积校验
  const size = fs.statSync(outputPath).size
  if (size > config.maxZipSize) {
    console.warn(`[Diagnose] ZIP ${size} 超过 200MB，严格模式重试中`)
    fs.unlinkSync(outputPath)

    const strictInfo = await collectDiagnoseInfo({
      maxLogBytes: config.strictMaxLogBytes,
      toolCallCount: config.strictToolCallCount,
      lastExitCode: options?.lastExitCode,
      lastRunCrashed: options?.lastRunCrashed,
    })
    await packToZip(strictInfo, outputPath)

    const finalSize = fs.statSync(outputPath).size
    if (finalSize > config.maxZipSize) {
      fs.unlinkSync(outputPath)
      throw new Error(`诊断包体积 ${finalSize} 仍超过 200MB，请检查数据库异常膨胀`)
    }
  }

  console.log(`[Diagnose] 诊断包已生成: ${outputPath} (${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)}MB)`)
  return outputPath
}

/**
 * 将 17 维诊断数据打包为 ZIP
 */
function packToZip(info: DiagnoseInfo, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath)
    const archive = new ZipArchive({ zlib: { level: 9 } })
    archive.pipe(output)

    output.on('close', resolve)
    archive.on('error', reject)

    // ── 17 个文件 ──────────────────────────────────────
    // 所有 JSON 使用紧凑格式

    // 1. 基础环境
    archive.append(JSON.stringify(info.info), { name: '01_info.json' })
    // 2. 配置快照（脱敏）
    archive.append(JSON.stringify(info.config), { name: '02_config_snapshot.json' })
    // 3. 详细系统信息
    archive.append(JSON.stringify(info.systemDetail), { name: '03_system_detail.json' })
    // 4. 性能指标
    archive.append(JSON.stringify(info.performance), { name: '04_performance_metrics.json' })
    // 5. 日志
    archive.append(info.logs, { name: '05_recent_logs.txt' })
    // 6. 错误汇总
    archive.append(JSON.stringify(info.errorSummary), { name: '06_error_summary.json' })
    // 7. 工具调用历史
    archive.append(info.toolCalls, { name: '07_tool_call_history.json' })
    // 8. LLM 统计
    archive.append(JSON.stringify(info.llmStats), { name: '08_llm_stats.json' })
    // 9. LLM 调用明细
    archive.append(info.llmRecords, { name: '09_llm_call_records.json' })
    // 10. Agent 统计
    archive.append(JSON.stringify(info.agentStats), { name: '10_agent_stats.json' })
    // 11. QQ Bot 统计
    archive.append(JSON.stringify(info.qqBotStats), { name: '11_qq_bot_stats.json' })
    // 12. 工作区列表
    archive.append(JSON.stringify(info.workspaces), { name: '12_workspace_list.json' })
    // 13. 游戏状态
    archive.append(JSON.stringify(info.gameState), { name: '13_game_state.json' })
    // 14. 记忆系统统计
    archive.append(JSON.stringify(info.memoryStats), { name: '14_memory_stats.json' })
    // 15. 网络连接统计
    archive.append(JSON.stringify(info.networkStats), { name: '15_network_stats.json' })
    // 16. 数据库表概览
    archive.append(JSON.stringify(info.databaseSchema), { name: '16_database_schema.json' })
    // 17. 事件时间线
    archive.append(JSON.stringify(info.eventTimeline), { name: '17_event_timeline.json' })

    archive.finalize()
  })
}

/** 获取默认配置 */
export function getDefaultConfig(): DiagnoseConfig {
  return { ...DEFAULT_CONFIG }
}