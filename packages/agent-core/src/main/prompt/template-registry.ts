/**
 * 模板注册器
 *
 * 管理内置模板和用户自定义模板的注册、加载、保存功能。
 * 支持身份模板、行为规范模板、工作流模板和完整智能体模板。
 *
 * V16 变更：委托 PromptTemplateManager 从 JSON+SQLite 加载模板数据。
 * 内置模板数据来自 templates/ 目录的 JSON 文件；
 * 用户自定义模板通过 SQLite 持久化。
 */

import type {
  AgentProfile,
  UserTemplate,
  IdentityTemplate,
  WorkflowTemplate,
  IdentityTemplateId,
  WorkflowTemplateId,
  ITemplateRegistry,
} from './types';

import { PromptTemplateManager } from './prompt-template-manager';

// ════════════════════════════════════════════════════
// 默认模板注册器实现
// ════════════════════════════════════════════════════

/**
 * 默认模板注册器
 * 支持：
 * - 获取内置身份模板和工作流模板（来自 JSON + SQLite）
 * - 从身份模板创建 AgentProfile
 * - 保存/加载/删除用户自定义模板（SQLite 持久化）
 * - 从自定义模板创建 AgentProfile
 */
export class DefaultTemplateRegistry implements ITemplateRegistry {
  private templateManager: PromptTemplateManager;

  constructor() {
    this.templateManager = PromptTemplateManager.getInstance();
  }

  // ════════════════════════════════════════════════════
  // 内置身份模板管理
  // ════════════════════════════════════════════════════

  getIdentityTemplate(id: IdentityTemplateId): IdentityTemplate {
    const template = this.templateManager.getIdentityTemplate(id);
    if (!template) {
      throw new Error(`身份模板未找到: ${id}`);
    }
    return template;
  }

  listIdentityTemplates(): IdentityTemplate[] {
    return this.templateManager.listIdentityTemplates();
  }

  // ════════════════════════════════════════════════════
  // 内置工作流模板管理
  // ════════════════════════════════════════════════════

  getWorkflowTemplate(id: WorkflowTemplateId): WorkflowTemplate {
    const template = this.templateManager.getWorkflowTemplate(id);
    if (!template) {
      throw new Error(`工作流模板未找到: ${id}`);
    }
    return template;
  }

  listWorkflowTemplates(): WorkflowTemplate[] {
    return this.templateManager.listWorkflowTemplates();
  }

  // ════════════════════════════════════════════════════
  // 从模板创建 AgentProfile
  // ════════════════════════════════════════════════════

  createProfileFromIdentity(
    id: string,
    overrides?: Partial<AgentProfile>,
  ): AgentProfile {
    return this.templateManager.createProfileFromIdentity(id, overrides);
  }

  async createProfileFromCustom(templateId: string): Promise<AgentProfile | undefined> {
    const userTemplate = await this.templateManager.getCustomTemplate(templateId);
    if (!userTemplate || userTemplate.type !== 'full_agent') {
      return undefined;
    }

    const data = userTemplate.data as Record<string, unknown>;
    return data as unknown as AgentProfile;
  }

  // ════════════════════════════════════════════════════
  // 用户自定义模板管理（委托到 PromptTemplateManager）
  // ════════════════════════════════════════════════════

  async save(template: UserTemplate): Promise<void> {
    await this.templateManager.saveCustomTemplate(template);
  }

  async load(id: string): Promise<UserTemplate | undefined> {
    return await this.templateManager.getCustomTemplate(id);
  }

  async delete(id: string): Promise<void> {
    await this.templateManager.deleteCustomTemplate(id);
  }

  async list(type?: UserTemplate['type']): Promise<UserTemplate[]> {
    return await this.templateManager.listCustomTemplates(type);
  }

  // ════════════════════════════════════════════════════
  // 辅助方法
  // ════════════════════════════════════════════════════

  /** 保存 AgentProfile 为用户自定义模板 */
  async saveProfileAsTemplate(
    profile: AgentProfile,
    name: string,
    description: string,
    tags: string[] = [],
  ): Promise<UserTemplate> {
    const template: UserTemplate = {
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      description,
      type: 'full_agent',
      data: profile as unknown as Record<string, unknown>,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags,
    };

    await this.save(template);
    return template;
  }

  /** 导出模板为 JSON 字符串 */
  async exportTemplate(id: string): Promise<string | undefined> {
    const template = await this.load(id);
    if (!template) return undefined;
    return JSON.stringify(template, null, 2);
  }

  /** 从 JSON 字符串导入模板 */
  async importTemplate(json: string): Promise<UserTemplate | undefined> {
    try {
      const data = JSON.parse(json) as UserTemplate;
      if (!data.id || !data.name || !data.type) {
        throw new Error('无效的模板格式');
      }
      await this.save(data);
      return data;
    } catch {
      return undefined;
    }
  }

  /** 获取模板数量 */
  async count(): Promise<number> {
    const templates = await this.templateManager.listCustomTemplates();
    return templates.length;
  }

  /** 清空所有自定义模板 */
  async clear(): Promise<void> {
    const templates = await this.templateManager.listCustomTemplates();
    for (const t of templates) {
      await this.templateManager.deleteCustomTemplate(t.id);
    }
  }
}
