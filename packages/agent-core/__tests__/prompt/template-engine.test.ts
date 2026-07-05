/**
 * 模板引擎单元测试
 */

import { describe, it, expect } from 'vitest';
import { DefaultPromptTemplateEngine } from '../../src/main/prompt';

describe('DefaultPromptTemplateEngine', () => {
  const engine = new DefaultPromptTemplateEngine();

  it('应替换简单变量', () => {
    const result = engine.render('Hello {{name}}', { name: 'World' });
    expect(result).toBe('Hello World');
  });

  it('应替换嵌套变量', () => {
    const result = engine.render('生命: {{player.health}}/20', {
      player: { health: 18 },
    });
    expect(result).toBe('生命: 18/20');
  });

  it('应支持默认值', () => {
    const result = engine.render('你好 {{name|朋友}}', {});
    expect(result).toBe('你好 朋友');
  });

  it('应处理条件渲染（真）', () => {
    const result = engine.render('{{#if flag}}条件成立{{/if}}', { flag: true });
    expect(result).toBe('条件成立');
  });

  it('应处理条件渲染（假）', () => {
    const result = engine.render('{{#if flag}}条件成立{{/if}}', { flag: false });
    expect(result).toBe('');
  });

  it('应处理条件渲染（undefined）', () => {
    const result = engine.render('{{#if flag}}条件成立{{/if}}', {});
    expect(result).toBe('');
  });

  it('应处理循环渲染', () => {
    const result = engine.render('{{#each items}}- {{item}}\n{{/each}}', {
      items: ['苹果', '香蕉', '橘子'],
    });
    expect(result).toContain('苹果');
    expect(result).toContain('香蕉');
    expect(result).toContain('橘子');
  });

  it('循环中应支持 item/index/first/last', () => {
    const result = engine.render('{{#each items}}{{item}}:{{first}}/{{last}}\n{{/each}}', {
      items: ['a', 'b'],
    });
    const lines = result.trim().split('\n');
    expect(lines[0]).toBe('a:true/false');
    expect(lines[1]).toBe('b:false/true');
  });

  it('空列表应返回空字符串', () => {
    const result = engine.render('{{#each items}}x{{/each}}', { items: [] });
    expect(result).toBe('');
  });

  it('应支持自定义函数', () => {
    engine.registerFunction('greet', (name: string) => `你好, ${name}!`);
    const result = engine.render('{{greet Alice}}', {});
    expect(result).toBe('你好, Alice!');
  });

  it('应支持内置函数 upper', () => {
    const result = engine.render('{{upper hello world}}', {});
    expect(result).toBe('HELLO WORLD');
  });

  it('应支持内置函数 lower', () => {
    const result = engine.render('{{lower Hello World}}', {});
    expect(result).toBe('hello world');
  });

  it('应支持内置函数 capitalize', () => {
    const result = engine.render('{{capitalize hello}}', {});
    expect(result).toBe('Hello');
  });

  it('应支持内置函数 join', () => {
    const result = engine.render('{{join , a b c}}', {});
    expect(result).toBe('a,b,c');
  });

  it('应支持内置函数 length', () => {
    const result = engine.render('{{length hello}}', {});
    expect(result).toBe('5');
  });

  it('复杂模板组合', () => {
    const template = [
      '## 角色',
      '名称: {{agent.name}}',
      '生命: {{agent.health}}/20',
      '{{#if agent.hungry}}饥饿: {{agent.health}}/20{{/if}}',
      '物品:',
      '{{#each items}}- {{item.name}} x{{item.count}}',
      '{{/each}}',
    ].join('\n');

    const result = engine.render(template, {
      agent: { name: 'Steve', health: 18, hungry: true },
      items: [
        { name: '圆石', count: 32 },
        { name: '木棍', count: 4 },
      ],
    });

    expect(result).toContain('Steve');
    expect(result).toContain('18/20');
    expect(result).toContain('圆石 x32');
    expect(result).toContain('木棍 x4');
  });
});