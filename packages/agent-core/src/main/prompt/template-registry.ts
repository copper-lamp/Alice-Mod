/**
 * 模板注册器
 *
 * 管理内置模板和用户自定义模板的注册、加载、保存功能。
 * 支持身份模板、行为规范模板、工作流模板和完整智能体模板。
 */

import type {
  AgentProfile,
  UserTemplate,
  IdentityTemplate,
  WorkflowTemplate,
  ITemplateRegistry,
} from './types';

import {
  BUILTIN_IDENTITY_TEMPLATES,
  listIdentityTemplates,
  getIdentityTemplate,
  createProfileFromIdentity,
} from './agent/identity-templates';

import { WORKFLOW_TEMPLATES, getWorkflowTemplate } from './agent/workflow-templates';

// ════════════════════════════════════════════════════
// 默认模板注册器实现
// ════════════════════════════════════════════════════

/**
 * 默认模板注册器
 * 支持：
 * - 获取内置身份模板和工作流模板
 * - 从身份模板创建 AgentProfile
 * - 保存/加载/删除用户自定义模板
 * - 从自定义模板创建 AgentProfile
 */
export class DefaultTemplateRegistry implements ITemplateRegistry {
  private userTemplates: Map<string, UserTemplate> = new Map();

  // ════════════════════════════════════════════════════
  // 内置身份模板管理
  // ════════════════════════════════════════════════════

  getIdentityTemplate(id: string): IdentityTemplate {
    const template = getIdentityTemplate(id);
    if (!template) {
      throw new Error(`身份模板未找到: ${id}`);
    }
    return template;
  }

  listIdentityTemplates(): IdentityTemplate[] {
    return listIdentityTemplates();
  }

  // ════════════════════════════════════════════════════
  // 内置工作流模板管理
  // ════════════════════════════════════════════════════

  getWorkflowTemplate(id: string): WorkflowTemplate {
    const template = getWorkflowTemplate(id);
    if (!template) {
      throw new Error(`工作流模板未找到: ${id}`);
    }
    return template;
  }

  listWorkflowTemplates(): WorkflowTemplate[] {
    return [...WORKFLOW_TEMPLATES];
  }

  // ════════════════════════════════════════════════════
  // 从模板创建 AgentProfile
  // ════════════════════════════════════════════════════

  createProfileFromIdentity(
    id: string,
    overrides?: Partial<AgentProfile>,
  ): AgentProfile {
    return createProfileFromIdentity(id, overrides);
  }

  createProfileFromCustom(templateId: string): AgentProfile | undefined {
    const userTemplate = this.userTemplates.get(templateId);
    if (!userTemplate || userTemplate.type !== 'full_agent') {
      return undefined;
    }

    const data = userTemplate.data as Record<string, unknown>;
    return data as unknown as AgentProfile;
  }

  // ════════════════════════════════════════════════════
  // 用户自定义模板管理
  // ════════════════════════════════════════════════════

  save(template: UserTemplate): void {
    const now = Date.now();
    const existing = this.userTemplates.get(template.id);

    this.userTemplates.set(template.id, {
      ...template,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  load(id: string): UserTemplate | undefined {
    const template = this.userTemplates.get(id);
    return template ? { ...template } : undefined;
  }

  delete(id: string): void {
    this.userTemplates.delete(id);
  }

  list(type?: UserTemplate['type']): UserTemplate[] {
    const all = Array.from(this.userTemplates.values());
    if (type) {
      return all.filter(t => t.type === type);
    }
    return all.map(t => ({ ...t }));
  }

  // ════════════════════════════════════════════════════
  // 辅助方法
  // ════════════════════════════════════════════════════

  /** 保存 AgentProfile 为用户自定义模板 */
  saveProfileAsTemplate(
    profile: AgentProfile,
    name: string,
    description: string,
    tags: string[] = [],
  ): UserTemplate {
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

    this.save(template);
    return template;
  }

  /** 导出模板为 JSON 字符串 */
  exportTemplate(id: string): string | undefined {
    const template = this.load(id);
    if (!template) return undefined;
    return JSON.stringify(template, null, 2);
  }

  /** 从 JSON 字符串导入模板 */
  importTemplate(json: string): UserTemplate | undefined {
    try {
      const data = JSON.parse(json) as UserTemplate;
      if (!data.id || !data.name || !data.type) {
        throw new Error('无效的模板格式');
      }
      this.save(data);
      return data;
    } catch {
      return undefined;
    }
  }

  /** 获取模板数量 */
  get count(): number {
    return this.userTemplates.size;
  }

  /** 清空所有自定义模板 */
  clear(): void {
    this.userTemplates.clear();
  }
}