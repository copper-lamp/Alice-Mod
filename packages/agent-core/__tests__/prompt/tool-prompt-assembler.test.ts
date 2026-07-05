/**
 * 工具提示组装器单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DefaultToolPromptAssembler, OpenAIFormatAdapter } from '../../src/main/prompt';
import { ToolCategory } from '@mcagent/shared';
import type { ToolSchema } from '@mcagent/shared';
import type { ToolPromptDefinition } from '../../src/main/prompt';

// 测试工具数据
const mockTools: ToolSchema[] = [
  {
    name: 'move_to',
    description: '移动到目标位置',
    category: ToolCategory.Movement,
    parameters: {
      x: { type: 'number', description: '目标 X', required: true },
      z: { type: 'number', description: '目标 Z', required: true },
      y: { type: 'number', description: '目标 Y' },
    },
  },
  {
    name: 'dig_block',
    description: '挖掘方块',
    category: ToolCategory.Block,
    parameters: {
      x: { type: 'number', description: '方块 X', required: true },
      y: { type: 'number', description: '方块 Y', required: true },
      z: { type: 'number', description: '方块 Z', required: true },
    },
  },
  {
    name: 'look_at',
    description: '查看某个位置',
    category: ToolCategory.Perception,
    parameters: {
      x: { type: 'number', description: '目标 X', required: true },
      z: { type: 'number', description: '目标 Z', required: true },
    },
  },
  {
    name: 'chat_message',
    description: '发送聊天消息',
    category: ToolCategory.Chat,
    parameters: {
      message: { type: 'string', description: '消息内容', required: true },
    },
  },
];

function createMockRegistry() {
  return {
    getTools: (_workspaceId: string) => mockTools,
  };
}

describe('DefaultToolPromptAssembler', () => {
  let assembler: DefaultToolPromptAssembler;

  beforeEach(() => {
    assembler = new DefaultToolPromptAssembler(createMockRegistry());
  });

  it('应组装所有工具', async () => {
    const tools = await assembler.assemble('ws-1');
    expect(tools).toHaveLength(4);
  });

  it('应按类别过滤', async () => {
    const all = await assembler.assemble('ws-1');
    const filtered = assembler.filterByCategory(all, ['movement', 'perception']);
    expect(filtered).toHaveLength(2);
    expect(filtered.map(t => t.name)).toContain('move_to');
    expect(filtered.map(t => t.name)).toContain('look_at');
  });

  it('应支持 includeCategories 选项', async () => {
    const tools = await assembler.assemble('ws-1', { includeCategories: ['block'] });
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('dig_block');
  });

  it('应支持 excludeCategories 选项', async () => {
    const tools = await assembler.assemble('ws-1', { excludeCategories: ['chat'] });
    expect(tools).toHaveLength(3);
    expect(tools.map(t => t.name)).not.toContain('chat_message');
  });

  it('应支持 includeTools 选项', async () => {
    const tools = await assembler.assemble('ws-1', { includeTools: ['move_to', 'look_at'] });
    expect(tools).toHaveLength(2);
  });

  it('应支持 excludeTools 选项', async () => {
    const tools = await assembler.assemble('ws-1', { excludeTools: ['move_to'] });
    expect(tools).toHaveLength(3);
    expect(tools.map(t => t.name)).not.toContain('move_to');
  });

  it('应按优先级排序', async () => {
    const tools = await assembler.assemble('ws-1');
    // perception(1) < movement(2) < block(5) < chat(7)
    expect(tools[0].category).toBe('perception');
    expect(tools[1].category).toBe('movement');
  });

  it('应支持 maxTools 截断', async () => {
    const tools = await assembler.assemble('ws-1', { maxTools: 2 });
    expect(tools).toHaveLength(2);
  });

  it('应支持自定义格式器', async () => {
    assembler.registerFormatter('move_to', {
      format: (tool: ToolPromptDefinition) => ({
        ...tool,
        description: `${tool.description}（自动避障）`,
      }),
    });

    const tools = await assembler.assemble('ws-1');
    const moveTool = tools.find(t => t.name === 'move_to');
    expect(moveTool?.description).toContain('自动避障');
  });

  it('应缓存结果', async () => {
    const t1 = await assembler.assemble('ws-1');
    const t2 = await assembler.assemble('ws-1');
    expect(t1).toBe(t2); // 相同的引用，因为缓存
  });

  it('useCache=false 应禁用缓存', async () => {
    await assembler.assemble('ws-1', { useCache: false });
    // 清除内部缓存后验证
    const t1 = await assembler.assemble('ws-1', { useCache: false });
    expect(t1).toHaveLength(4);
  });

  it('应支持按条件过滤', async () => {
    const all = await assembler.assemble('ws-1');
    const filtered = assembler.filterByCondition(all, t => t.category !== 'chat');
    expect(filtered).toHaveLength(3);
  });

  it('应正确转换参数格式', async () => {
    const tools = await assembler.assemble('ws-1');
    const moveTool = tools.find(t => t.name === 'move_to')!;
    expect(moveTool.parameters['x'].type).toBe('number');
    expect(moveTool.parameters['x'].required).toBe(true);
    expect(moveTool.parameters['y'].required).toBe(false);
  });

  it('应支持 clearCache', async () => {
    await assembler.assemble('ws-1');
    assembler.clearCache();
    const tools = await assembler.assemble('ws-1');
    expect(tools).toHaveLength(4);
  });
});

describe('OpenAIFormatAdapter', () => {
  it('应转换为 OpenAI Function Calling 格式', () => {
    const adapter = new OpenAIFormatAdapter();
    const tools: ToolPromptDefinition[] = [
      {
        name: 'move_to',
        description: '移动',
        category: 'movement',
        priority: 1,
        parameters: {
          x: { type: 'number', description: 'X', required: true },
          z: { type: 'number', description: 'Z', required: true },
        },
      },
    ];

    const result = adapter.convert(tools) as any[];
    expect(result[0].type).toBe('function');
    expect(result[0].function.name).toBe('move_to');
    expect(result[0].function.parameters.required).toContain('x');
    expect(result[0].function.parameters.required).toContain('z');
  });

  it('应处理 enum 参数', () => {
    const adapter = new OpenAIFormatAdapter();
    const tools: ToolPromptDefinition[] = [
      {
        name: 'set_mode',
        description: '设置模式',
        category: 'survival',
        priority: 1,
        parameters: {
          mode: {
            type: 'string',
            description: '模式',
            required: true,
            enum: ['peaceful', 'survival', 'creative'],
          },
        },
      },
    ];

    const result = adapter.convert(tools) as any[];
    expect(result[0].function.parameters.properties.mode.enum).toHaveLength(3);
  });
});