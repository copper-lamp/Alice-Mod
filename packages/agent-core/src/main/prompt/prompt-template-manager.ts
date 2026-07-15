/**
 * PromptTemplateManager — 统一的提示词模板管理器
 *
 * 职责：
 * 1. 从 JSON 文件加载内置模板（身份/工作流/性格/行为）
 * 2. 从 SQLite 加载/保存用户自定义模板
 * 3. 提供统一的 CRUD 接口
 *
 * 加载策略：
 * - 优先从 templates 目录下的 JSON 文件加载
 * - 如果 JSON 文件不存在，fallback 到 TypeScript 内置数据
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getDatabaseManager } from '../database';
import type { IdentityTemplate, WorkflowTemplate, PersonalityTrait, PersonalityCategory, UserTemplate, AgentProfile } from './types';
import type { BehaviorPreset } from './agent/behavior-presets';
import { BUILTIN_IDENTITY_TEMPLATES } from './agent/identity-templates';
import { WORKFLOW_TEMPLATES } from './agent/workflow-templates';
import { PERSONALITY_BY_CATEGORY } from './agent/personality-library';
import { BEHAVIOR_PRESETS } from './agent/behavior-presets';

// ════════════════════════════════════════════════════
// PromptTemplateManager
// ════════════════════════════════════════════════════

export class PromptTemplateManager {
  private static instance: PromptTemplateManager;
  private templatesDir: string;

  // 内置模板缓存
  private identityTemplates: Map<string, IdentityTemplate> = new Map();
  private workflowTemplates: Map<string, WorkflowTemplate> = new Map();
  private personalityLibrary: Map<PersonalityCategory, PersonalityTrait[]> = new Map();
  private behaviorPresets: Map<string, BehaviorPreset> = new Map();

  // 用户自定义模板（从 SQLite 加载，惰性加载）
  private customTemplates: Map<string, UserTemplate> = new Map();
  private customLoaded = false;

  private constructor() {
    this.templatesDir = join(__dirname, 'templates');
    this.loadAllBuiltinTemplates();
    // 注意：loadCustomTemplates 改为惰性加载，避免在 DB 未初始化时调用
  }

  static getInstance(): PromptTemplateManager {
    if (!PromptTemplateManager.instance) {
      PromptTemplateManager.instance = new PromptTemplateManager();
    }
    return PromptTemplateManager.instance;
  }

  // ════════════════════════════════════════════════════
  // 内部加载方法
  // ════════════════════════════════════════════════════

  /** 加载所有内置模板 */
  private loadAllBuiltinTemplates(): void {
    this.loadIdentityTemplates();
    this.loadWorkflowTemplates();
    this.loadPersonalityLibrary();
    this.loadBehaviorPresets();
  }

  /** 从 JSON 加载身份模板 */
  private loadIdentityTemplates(): void {
    const dir = join(this.templatesDir, 'identities');
    if (!existsSync(dir)) {
      // fallback 到 TypeScript 内置数据
      this.identityTemplates = new Map(Object.entries(BUILTIN_IDENTITY_TEMPLATES));
      console.info(`[PromptTemplateManager] 使用内置身份模板数据 (${this.identityTemplates.size} 个)`);
      return;
    }
    try {
      const files = readdirSync(dir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const content = readFileSync(join(dir, file), 'utf-8');
        const template = JSON.parse(content) as IdentityTemplate;
        this.identityTemplates.set(template.id, template);
      }
      console.info(`[PromptTemplateManager] 从 JSON 加载了 ${this.identityTemplates.size} 个身份模板`);
    } catch (err) {
      console.error('[PromptTemplateManager] 加载身份模板 JSON 失败，回退到内置数据:', err);
      this.identityTemplates = new Map(Object.entries(BUILTIN_IDENTITY_TEMPLATES));
    }
  }

  /** 从 JSON 加载工作流模板 */
  private loadWorkflowTemplates(): void {
    const dir = join(this.templatesDir, 'workflows');
    if (!existsSync(dir)) {
      for (const t of WORKFLOW_TEMPLATES) {
        this.workflowTemplates.set(t.id, t);
      }
      console.info(`[PromptTemplateManager] 使用内置工作流模板数据 (${this.workflowTemplates.size} 个)`);
      return;
    }
    try {
      const files = readdirSync(dir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const content = readFileSync(join(dir, file), 'utf-8');
        const template = JSON.parse(content) as WorkflowTemplate;
        this.workflowTemplates.set(template.id, template);
      }
      console.info(`[PromptTemplateManager] 从 JSON 加载了 ${this.workflowTemplates.size} 个工作流模板`);
    } catch (err) {
      console.error('[PromptTemplateManager] 加载工作流模板 JSON 失败，回退到内置数据:', err);
      for (const t of WORKFLOW_TEMPLATES) {
        this.workflowTemplates.set(t.id, t);
      }
    }
  }

  /** 从 JSON 加载性格特征库 */
  private loadPersonalityLibrary(): void {
    const filePath = join(this.templatesDir, 'personalities', 'personality-library.json');
    if (!existsSync(filePath)) {
      for (const [cat, traits] of Object.entries(PERSONALITY_BY_CATEGORY)) {
        this.personalityLibrary.set(cat as PersonalityCategory, traits as PersonalityTrait[]);
      }
      console.info(`[PromptTemplateManager] 使用内置性格特征库数据 (${this.personalityLibrary.size} 个类别)`);
      return;
    }
    try {
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      if (data.categories) {
        for (const [cat, categoryData] of Object.entries(data.categories)) {
          this.personalityLibrary.set(cat as PersonalityCategory, (categoryData as { traits: PersonalityTrait[] }).traits);
        }
      } else {
        // 兼容扁平格式
        for (const [cat, traits] of Object.entries(data)) {
          this.personalityLibrary.set(cat as PersonalityCategory, traits as PersonalityTrait[]);
        }
      }
      console.info(`[PromptTemplateManager] 从 JSON 加载了 ${this.personalityLibrary.size} 个性格类别`);
    } catch (err) {
      console.error('[PromptTemplateManager] 加载性格库 JSON 失败，回退到内置数据:', err);
      for (const [cat, traits] of Object.entries(PERSONALITY_BY_CATEGORY)) {
        this.personalityLibrary.set(cat as PersonalityCategory, traits as PersonalityTrait[]);
      }
    }
  }

  /** 从 JSON 加载行为预设 */
  private loadBehaviorPresets(): void {
    const filePath = join(this.templatesDir, 'behaviors', 'behavior-presets.json');
    if (!existsSync(filePath)) {
      for (const p of BEHAVIOR_PRESETS) {
        this.behaviorPresets.set(p.id, p);
      }
      console.info(`[PromptTemplateManager] 使用内置行为预设数据 (${this.behaviorPresets.size} 个)`);
      return;
    }
    try {
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      const presets: BehaviorPreset[] = data.presets ?? data;
      for (const preset of presets) {
        this.behaviorPresets.set(preset.id, preset);
      }
      console.info(`[PromptTemplateManager] 从 JSON 加载了 ${this.behaviorPresets.size} 个行为预设`);
    } catch (err) {
      console.error('[PromptTemplateManager] 加载行为预设 JSON 失败，回退到内置数据:', err);
      for (const p of BEHAVIOR_PRESETS) {
        this.behaviorPresets.set(p.id, p);
      }
    }
  }

  /** 确保自定义模板已从 SQLite 加载（惰性加载） */
  private async ensureCustomLoaded(): Promise<void> {
    if (this.customLoaded) return;
    this.customLoaded = true;
    try {
      const db = getDatabaseManager().getDb();
      const rows = db.prepare('SELECT * FROM prompt_templates WHERE is_builtin = 0').all() as Array<{
        id: string;
        name: string;
        description: string | null;
        type: string;
        template_json: string;
        tags: string | null;
        created_at: number;
        updated_at: number;
      }>;
      for (const row of rows) {
        const userTemplate: UserTemplate = {
          id: row.id,
          name: row.name,
          description: row.description ?? '',
          type: row.type as UserTemplate['type'],
          data: JSON.parse(row.template_json),
          tags: JSON.parse(row.tags ?? '[]'),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
        this.customTemplates.set(row.id, userTemplate);
      }
      console.info(`[PromptTemplateManager] 从 SQLite 加载了 ${this.customTemplates.size} 个用户自定义模板`);
    } catch (err) {
      console.warn('[PromptTemplateManager] 加载自定义模板失败（数据库可能尚未初始化）:', err);
    }
  }

  // ════════════════════════════════════════════════════
  // 公有 API — 身份模板
  // ════════════════════════════════════════════════════

  /**
   * 获取指定身份模板
   * @param id 模板标识
   */
  getIdentityTemplate(id: string): IdentityTemplate | undefined {
    return this.identityTemplates.get(id);
  }

  /** 获取所有身份模板 */
  listIdentityTemplates(): IdentityTemplate[] {
    return Array.from(this.identityTemplates.values());
  }

  /**
   * 从身份模板创建 AgentProfile
   * @param id 模板标识
   * @param overrides 自定义覆盖（可选）
   */
  createProfileFromIdentity(id: string, overrides?: Partial<AgentProfile>): AgentProfile {
    const template = this.getIdentityTemplate(id);
    if (!template) throw new Error(`身份模板未找到: ${id}`);

    const profile: AgentProfile = {
      name: overrides?.name ?? template.name,
      identity: overrides?.identity ?? template.identity,
      personality: overrides?.personality ?? [...template.personality],
      rules: overrides?.rules
        ? {
            core: overrides.rules.core ?? [...template.rules.core],
            strategy: overrides.rules.strategy
              ? overrides.rules.strategy.map(s => ({ ...s }))
              : template.rules.strategy.map(s => ({ ...s })),
            constraints: overrides.rules.constraints
              ? overrides.rules.constraints.map(c => ({ ...c }))
              : template.rules.constraints.map(c => ({ ...c })),
          }
        : {
            core: [...template.rules.core],
            strategy: template.rules.strategy.map(s => ({ ...s })),
            constraints: template.rules.constraints.map(c => ({ ...c })),
          },
      preferences: {
        ...template.preferences,
        ...(overrides?.preferences ?? {}),
      },
      fragments: overrides?.fragments
        ? overrides.fragments.map(f => ({ ...f }))
        : [],
      communicationStyle: overrides?.communicationStyle ?? (template.communicationStyle ? [...template.communicationStyle] : undefined),
      workApproach: overrides?.workApproach ?? (template.workApproach ? [...template.workApproach] : undefined),
      boundaries: overrides?.boundaries ?? (template.boundaries ? [...template.boundaries] : undefined),
      securityRules: overrides?.securityRules ?? (template.securityRules ? { ...template.securityRules } : undefined),
      toolDiscipline: overrides?.toolDiscipline ?? (template.toolDiscipline ? { ...template.toolDiscipline } : undefined),
    };
    return profile;
  }

  // ════════════════════════════════════════════════════
  // 公有 API — 工作流模板
  // ════════════════════════════════════════════════════

  /**
   * 获取指定工作流模板
   * @param id 模板标识
   */
  getWorkflowTemplate(id: string): WorkflowTemplate | undefined {
    return this.workflowTemplates.get(id);
  }

  /** 获取所有工作流模板 */
  listWorkflowTemplates(): WorkflowTemplate[] {
    return Array.from(this.workflowTemplates.values());
  }

  // ════════════════════════════════════════════════════
  // 公有 API — 性格特征
  // ════════════════════════════════════════════════════

  /**
   * 获取指定类别的性格特征
   * @param category 性格类别
   */
  getPersonalityByCategory(category: PersonalityCategory): PersonalityTrait[] {
    return this.personalityLibrary.get(category) ?? [];
  }

  /** 获取所有性格类别及其特征 */
  getAllPersonalityCategories(): [PersonalityCategory, PersonalityTrait[]][] {
    return Array.from(this.personalityLibrary.entries());
  }

  /** 获取所有性格特征（扁平化） */
  getAllPersonalityTraits(): PersonalityTrait[] {
    const result: PersonalityTrait[] = [];
    for (const traits of this.personalityLibrary.values()) {
      result.push(...traits);
    }
    return result;
  }

  // ════════════════════════════════════════════════════
  // 公有 API — 行为预设
  // ════════════════════════════════════════════════════

  /**
   * 获取指定行为预设
   * @param id 预设标识
   */
  getBehaviorPreset(id: string): BehaviorPreset | undefined {
    return this.behaviorPresets.get(id);
  }

  /** 获取所有行为预设 */
  listBehaviorPresets(): BehaviorPreset[] {
    return Array.from(this.behaviorPresets.values());
  }

  /**
   * 获取适合指定身份的行为预设
   * @param identityId 身份模板标识
   */
  getPresetsForIdentity(identityId: string): BehaviorPreset[] {
    return this.listBehaviorPresets().filter(p => p.suitableFor.includes(identityId));
  }

  // ════════════════════════════════════════════════════
  // 公有 API — 用户自定义模板
  // ════════════════════════════════════════════════════

  /**
   * 保存用户自定义模板
   * @param template 模板数据（不含时间戳）
   */
  async saveCustomTemplate(template: Omit<UserTemplate, 'createdAt' | 'updatedAt'>): Promise<UserTemplate> {
    await this.ensureCustomLoaded();
    const now = Date.now();
    const full: UserTemplate = {
      ...template,
      createdAt: now,
      updatedAt: now,
    };
    this.customTemplates.set(template.id, full);
    this.persistCustomTemplate(full);
    return full;
  }

  /**
   * 获取用户自定义模板
   * @param id 模板标识
   */
  async getCustomTemplate(id: string): Promise<UserTemplate | undefined> {
    await this.ensureCustomLoaded();
    return this.customTemplates.get(id);
  }

  /**
   * 删除用户自定义模板
   * @param id 模板标识
   * @returns 是否成功删除
   */
  async deleteCustomTemplate(id: string): Promise<boolean> {
    await this.ensureCustomLoaded();
    const existed = this.customTemplates.delete(id);
    if (existed) {
      try {
        const db = getDatabaseManager().getDb();
        db.prepare('DELETE FROM prompt_templates WHERE id = ? AND is_builtin = 0').run(id);
      } catch {
        // 忽略数据库删除异常
      }
    }
    return existed;
  }

  /**
   * 列出用户自定义模板
   * @param type 按类型筛选（可选）
   */
  async listCustomTemplates(type?: UserTemplate['type']): Promise<UserTemplate[]> {
    await this.ensureCustomLoaded();
    const all = Array.from(this.customTemplates.values());
    return type ? all.filter(t => t.type === type) : all;
  }

  /** 将自定义模板持久化到 SQLite */
  private persistCustomTemplate(template: UserTemplate): void {
    try {
      const db = getDatabaseManager().getDb();
      db.prepare(`
        INSERT OR REPLACE INTO prompt_templates (id, name, type, template_json, tags, is_builtin, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?)
      `).run(
        template.id,
        template.name,
        template.type,
        JSON.stringify(template.data),
        JSON.stringify(template.tags),
        template.createdAt,
        template.updatedAt,
      );
    } catch (err) {
      console.error('[PromptTemplateManager] 持久化自定义模板失败:', err);
    }
  }

  // ════════════════════════════════════════════════════
  // 重新加载
  // ════════════════════════════════════════════════════

  /** 重新加载所有内置模板（从 JSON 或内置数据） */
  reloadBuiltinTemplates(): void {
    this.identityTemplates.clear();
    this.workflowTemplates.clear();
    this.personalityLibrary.clear();
    this.behaviorPresets.clear();
    this.loadAllBuiltinTemplates();
  }

  /** 重新加载用户自定义模板（从 SQLite） */
  async reloadCustomTemplates(): Promise<void> {
    this.customTemplates.clear();
    this.customLoaded = false;
    await this.ensureCustomLoaded();
  }
}
