/**
 * 提示词模板引擎
 *
 * 支持模板变量替换、条件渲染、循环渲染和自定义函数。
 *
 * 语法：
 *   变量: {{variableName}}
 *   嵌套: {{state.health}}
 *   条件: {{#if condition}}内容{{/if}}
 *   循环: {{#each list}}项目{{/each}}
 *   函数: {{fnName arg1 arg2}}
 *   默认值: {{variableName|defaultValue}}
 */

import type { IPromptTemplateEngine, TemplateFunction } from '../types';

export class DefaultPromptTemplateEngine implements IPromptTemplateEngine {
  private functions: Map<string, TemplateFunction> = new Map();

  constructor() {
    this.registerDefaultFunctions();
  }

  render(template: string, variables: Record<string, unknown>): string {
    let result = template;

    // 1. 处理条件渲染 {{#if condition}}...{{/if}}
    result = this.renderConditionals(result, variables);

    // 2. 处理循环渲染 {{#each list}}...{{/each}}
    result = this.renderEach(result, variables);

    // 3. 处理函数调用 {{fnName arg1 arg2}}
    result = this.renderFunctions(result);

    // 4. 处理变量替换 {{variableName}} 和 {{variableName|default}}
    result = this.renderVariables(result, variables);

    return result;
  }

  registerFunction(name: string, fn: TemplateFunction): void {
    this.functions.set(name, fn);
  }

  /** 获取变量值（支持嵌套路径，如 state.health） */
  private getVariableValue(path: string, variables: Record<string, unknown>): unknown {
    const parts = path.split('.');
    let current: unknown = variables;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current === 'object' && part in (current as Record<string, unknown>)) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  private renderVariables(template: string, variables: Record<string, unknown>): string {
    return template.replace(/\{\{([^}#]+?)(\|([^}]+?))?\}\}/g, (_match, path, _defaultStr, defaultValue) => {
      const trimmedPath = path.trim();
      const value = this.getVariableValue(trimmedPath, variables);
      if (value !== undefined && value !== null) {
        return String(value);
      }
      // 使用默认值
      if (defaultValue !== undefined) {
        return defaultValue.trim();
      }
      return `{{${trimmedPath}}}`;
    });
  }

  private renderConditionals(template: string, variables: Record<string, unknown>): string {
    const ifRegex = /\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
    return template.replace(ifRegex, (_match, condition, content) => {
      const trimmedCondition = condition.trim();
      const value = this.getVariableValue(trimmedCondition, variables);
      const truthy = value !== undefined && value !== null && value !== false && value !== 0 && value !== '';
      return truthy ? content : '';
    });
  }

  private renderEach(template: string, variables: Record<string, unknown>): string {
    const eachRegex = /\{\{#each\s+([^}]+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
    return template.replace(eachRegex, (_match, listPath, content) => {
      const list = this.getVariableValue(listPath.trim(), variables);
      if (!Array.isArray(list)) return '';

      return list.map((item, index) => {
        const itemVars = {
          ...variables,
          item,
          index,
          first: index === 0,
          last: index === list.length - 1,
        };
        return this.render(content, itemVars).replace(/\n$/, '');
      }).join('\n');
    });
  }

  private renderFunctions(template: string): string {
    const fnRegex = /\{\{([a-zA-Z_]\w*)\s+([^}]+)\}\}/g;
    return template.replace(fnRegex, (_match, fnName, argsStr) => {
      const fn = this.functions.get(fnName);
      if (!fn) return _match;
      const args = argsStr.trim().split(/\s+/).map((a: string) => a.trim());
      return fn(...args);
    });
  }

  private registerDefaultFunctions(): void {
    // 大写转换
    this.functions.set('upper', (...args: string[]) => args.join(' ').toUpperCase());
    // 小写转换
    this.functions.set('lower', (...args: string[]) => args.join(' ').toLowerCase());
    // 首字母大写
    this.functions.set('capitalize', (...args: string[]) => {
      const s = args.join(' ');
      return s.charAt(0).toUpperCase() + s.slice(1);
    });
    // 连接字符串
    this.functions.set('join', (...args: string[]) => {
      if (args.length < 2) return args.join('');
      const separator = args[0];
      return args.slice(1).join(separator);
    });
    // 取长度
    this.functions.set('length', (...args: string[]) => String(args.join(' ').length));
  }
}