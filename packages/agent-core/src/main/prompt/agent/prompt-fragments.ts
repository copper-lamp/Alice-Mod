/**
 * PromptFragment 管理
 *
 * 提供提示词片段的注册、查询和条件渲染功能。
 */

import type { PromptFragment, IPromptTemplateEngine } from '../types';

/**
 * 提示词片段管理器
 */
export class PromptFragmentManager {
  private fragments: Map<string, PromptFragment> = new Map();

  constructor(fragments?: PromptFragment[]) {
    if (fragments) {
      for (const f of fragments) {
        this.fragments.set(f.name, { ...f });
      }
    }
  }

  /** 注册片段 */
  register(fragment: PromptFragment): void {
    this.fragments.set(fragment.name, { ...fragment });
  }

  /** 取消注册 */
  unregister(name: string): void {
    this.fragments.delete(name);
  }

  /** 获取片段 */
  get(name: string): PromptFragment | undefined {
    const f = this.fragments.get(name);
    return f ? { ...f } : undefined;
  }

  /** 获取所有片段 */
  getAll(): PromptFragment[] {
    return Array.from(this.fragments.values()).map(f => ({ ...f }));
  }

  /** 获取启用的片段 */
  getEnabled(): PromptFragment[] {
    return this.getAll().filter(f => f.enabled);
  }

  /** 按位置获取启用的片段 */
  getByPosition(position: PromptFragment['position']): PromptFragment[] {
    return this.getEnabled().filter(f => f.position === position);
  }

  /** 启用/禁用片段 */
  toggle(name: string, enabled: boolean): void {
    const f = this.fragments.get(name);
    if (f) {
      f.enabled = enabled;
    }
  }

  /** 渲染片段 */
  render(
    fragment: PromptFragment,
    engine: IPromptTemplateEngine,
    variables: Record<string, unknown>,
  ): string {
    if (!fragment.enabled) return '';
    return engine.render(fragment.template, variables);
  }

  /** 检查条件是否满足 */
  checkCondition(fragment: PromptFragment, _context: Record<string, unknown>): boolean {
    if (!fragment.enabled) return false;
    if (!fragment.condition) return true;
    // 简单条件判断：TODO 后续实现更复杂的条件引擎
    return true;
  }

  /** 清空 */
  clear(): void {
    this.fragments.clear();
  }

  /** 数量 */
  get count(): number {
    return this.fragments.size;
  }
}