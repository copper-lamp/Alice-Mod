/**
 * V22 §5.4 SkillInjector — 技能注入
 *
 * 在 plan / execute / transfer / summarize 四个阶段，向 LLM system prompt
 * 临时追加对应技能文档（来自 skillsDir 目录下的 .md 文件）。
 *
 * 启动时一次性扫描 skillsDir 下的 .md 文件，按文件名前缀映射到 SkillPhase：
 *   - plan-*     → 'plan'
 *   - execute*   → 'execute'
 *   - transfer*  → 'transfer'
 *   - summarize* → 'summarize'
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import type { Skill, SkillPhase } from './types'

// ════════════════════════════════════════════════════════════════
// 依赖
// ════════════════════════════════════════════════════════════════

export interface SkillInjectorDeps {
  /** 技能目录（启动时扫描 .md 文件） */
  skillsDir: string
  /** 单一 prompt 中所有 skill 的 token 总预算；缺省 600 */
  totalSkillBudget?: number
}

// ════════════════════════════════════════════════════════════════
// SkillInjector 类
// ════════════════════════════════════════════════════════════════

const ALL_PHASES: SkillPhase[] = ['plan', 'execute', 'transfer', 'summarize']

/** 文件名（去扩展名）→ SkillPhase 映射 */
function inferPhase(filename: string): SkillPhase | undefined {
  const base = basename(filename, extname(filename))
  const head = base.split('-')[0].toLowerCase()
  if (ALL_PHASES.includes(head as SkillPhase)) {
    return head as SkillPhase
  }
  // 兼容 plan-mode 这种 head 已匹配的情况
  if (base.toLowerCase().startsWith('plan')) return 'plan'
  return undefined
}

/** 默认 token 估算：字符数 / 4 */
function defaultEstimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export class SkillInjector {
  private readonly skillsByPhase: Record<SkillPhase, Skill[]>
  private readonly totalSkillBudget: number

  constructor(deps: SkillInjectorDeps) {
    this.totalSkillBudget = deps.totalSkillBudget ?? 600
    this.skillsByPhase = this.scanSkillsDir(deps.skillsDir)
  }

  // ── 扫描加载 ──────────────────────────────────────────────────

  /** 扫描 skillsDir，把每个 .md 文件加载为 Skill，按 phase 分组 */
  private scanSkillsDir(skillsDir: string): Record<SkillPhase, Skill[]> {
    const result: Record<SkillPhase, Skill[]> = {
      plan: [],
      execute: [],
      transfer: [],
      summarize: [],
    }
    if (!skillsDir || !existsSync(skillsDir)) {
      return result
    }
    let entries: string[] = []
    try {
      const stat = statSync(skillsDir)
      if (!stat.isDirectory()) return result
      entries = readdirSync(skillsDir)
    } catch {
      return result
    }
    for (const entry of entries) {
      if (extname(entry).toLowerCase() !== '.md') continue
      const phase = inferPhase(entry)
      if (!phase) continue
      const fullPath = join(skillsDir, entry)
      try {
        const content = readFileSync(fullPath, 'utf-8')
        const name = basename(entry, '.md')
        result[phase].push({
          name,
          phase,
          content,
          enabledByDefault: true,
          estimatedTokens: defaultEstimateTokens(content),
        })
      } catch {
        // 单个文件读取失败：跳过，不影响其它技能
      }
    }
    return result
  }

  // ── 公共 API ──────────────────────────────────────────────────

  /** 列出所有技能（按 phase 分组） */
  list(): Record<SkillPhase, Skill[]> {
    // 返回浅拷贝避免外部修改内部状态
    return {
      plan: [...this.skillsByPhase.plan],
      execute: [...this.skillsByPhase.execute],
      transfer: [...this.skillsByPhase.transfer],
      summarize: [...this.skillsByPhase.summarize],
    }
  }

  /**
   * 选当前 phase 的技能：
   *   - enabledSkills 非空时为白名单（仅取交集）；为空/undefined 时取 enabledByDefault=true
   *   - disabledSkills 为黑名单（差集）
   *   - 最后按 totalSkillBudget 裁剪（按 estimatedTokens 累加，超预算则截断）
   */
  pick(
    phase: SkillPhase,
    enabledSkills?: string[],
    disabledSkills?: string[],
  ): Skill[] {
    const candidates = this.skillsByPhase[phase]
    const disabled = new Set(disabledSkills ?? [])
    let picked: Skill[]
    if (enabledSkills && enabledSkills.length > 0) {
      const enabled = new Set(enabledSkills)
      picked = candidates.filter(s => enabled.has(s.name) && !disabled.has(s.name))
    } else {
      picked = candidates.filter(s => s.enabledByDefault && !disabled.has(s.name))
    }
    // 按预算裁剪
    let used = 0
    const result: Skill[] = []
    for (const s of picked) {
      if (used + s.estimatedTokens > this.totalSkillBudget && result.length > 0) {
        break
      }
      result.push(s)
      used += s.estimatedTokens
    }
    return result
  }

  /** 渲染为可注入 prompt 的 markdown 文本 */
  render(skills: Skill[]): string {
    if (skills.length === 0) return ''
    const blocks = skills.map(s => `## 技能：${s.name}\n\n${s.content}`)
    return blocks.join('\n\n---\n\n')
  }
}
