/**
 * 诊断信息打包器
 *
 * 将采集到的诊断信息打包为 ZIP 文件，包含体积校验和严格模式回退。
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
  maxLogBytes: 500 * 1024,      // 500KB
  toolCallCount: 50,
  maxZipSize: 200 * 1024 * 1024, // 200MB
  intervalMs: 24 * 60 * 60 * 1000, // 24h
  strictMaxLogBytes: 100 * 1024,  // 100KB
  strictToolCallCount: 20,
}

/**
 * 生成诊断 ZIP 包
 *
 * @param outputDir 输出目录
 * @param options 可选参数
 * @returns ZIP 文件路径
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

  // 确保输出目录存在
  fs.mkdirSync(outputDir, { recursive: true })

  // 采集信息
  const info = await collectDiagnoseInfo({
    maxLogBytes: config.maxLogBytes,
    toolCallCount: config.toolCallCount,
    lastExitCode: options?.lastExitCode,
    lastRunCrashed: options?.lastRunCrashed,
  })

  // 生成文件名
  const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
  const suffix = options?.reason ? `_${options.reason}` : ''
  const fileName = `diagnose_${timestamp}${suffix}.zip`
  const outputPath = path.join(outputDir, fileName)

  // 打包
  await packToZip(info, outputPath)

  // 校验体积
  const size = fs.statSync(outputPath).size
  if (size > config.maxZipSize) {
    console.warn(`[Diagnose] ZIP 体积 ${size} 超过 200MB 限制，重新生成`)
    fs.unlinkSync(outputPath)

    // 严格模式：缩减日志和工具调用量
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
      throw new Error(
        `诊断包体积 ${finalSize} 仍超过 200MB 限制，请检查是否存在异常大文件`,
      )
    }

    console.warn(`[Diagnose] 严格模式重新生成成功: ${fileName} (${finalSize} bytes)`)
  }

  console.log(`[Diagnose] 诊断包已生成: ${outputPath} (${size} bytes)`)
  return outputPath
}

/**
 * 将诊断信息打包为 ZIP
 */
function packToZip(info: DiagnoseInfo, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath)
    const archive = new ZipArchive({ zlib: { level: 9 } }) // 最高压缩

    output.on('close', resolve)
    archive.on('error', reject)

    archive.pipe(output)

    // 所有 JSON 使用紧凑格式（无缩进）
    archive.append(JSON.stringify(info.info), { name: 'info.json' })
    archive.append(JSON.stringify(info.config), { name: 'config_snapshot.json' })
    archive.append(info.logs, { name: 'recent_logs.txt' })
    archive.append(info.toolCalls, { name: 'tool_call_history.json' })
    archive.append(JSON.stringify(info.gameState), { name: 'game_state.json' })
    archive.append(JSON.stringify(info.workspaces), { name: 'workspace_list.json' })

    archive.finalize()
  })
}

/** 获取默认配置 */
export function getDefaultConfig(): DiagnoseConfig {
  return { ...DEFAULT_CONFIG }
}