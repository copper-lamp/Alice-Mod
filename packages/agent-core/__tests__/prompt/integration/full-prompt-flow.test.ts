/**
 * 全流程集成测试
 *
 * 测试完整的提示词构建流程：
 * 1. AgentProfile → PromptBuilder → 组装消息 → 校验各区域
 * 2. 工具提示注入 + 格式适配
 * 3. 上下文窗口裁剪 + 缓存 key
 * 4. 缓存命中验证
 * 5. 智能体配置变更
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PromptBuilder, DefaultToolPromptAssembler, DefaultContextWindowManager, DEFAULT_CONTEXT_WINDOW_CONFIG } from '../../../src/main/prompt';
import { ToolCategory } from '@mcagent/shared';
import type { ToolSchema } from '@mcagent/shared';
import type { BuildParams, PlayerState, ConversationMessage, AgentProfile, PromptFragment } from '../../../src/main/prompt';

// 模拟 20 个工具
const allTools: ToolSchema[] = [
  { name: 'move_to', description: '移动到目标位置', category: ToolCategory.Movement, parameters: { x: { type: 'number', description: 'X', required: true }, z: { type: 'number', description: 'Z', required: true } } },
  { name: 'dig_block', description: '挖掘方块', category: ToolCategory.Block, parameters: { x: { type: 'number', description: 'X', required: true }, y: { type: 'number', description: 'Y', required: true }, z: { type: 'number', description: 'Z', required: true } } },
  { name: 'place_block', description: '放置方块', category: ToolCategory.Block, parameters: { x: { type: 'number', description: 'X', required: true }, y: { type: 'number', description: 'Y', required: true }, z: { type: 'number', description: 'Z', required: true }, block: { type: 'string', description: '方块名称', required: true } } },
  { name: 'look_at', description: '查看位置', category: ToolCategory.Perception, parameters: { x: { type: 'number', description: 'X', required: true }, z: { type: 'number', description: 'Z', required: true } } },
  { name: 'attack_entity', description: '攻击实体', category: ToolCategory.Entity, parameters: { entity: { type: 'string', description: '实体名称', required: true } } },
  { name: 'use_item', description: '使用物品', category: ToolCategory.Survival, parameters: { slot: { type: 'number', description: '物品栏', required: true } } },
  { name: 'equip_item', description: '装备物品', category: ToolCategory.Inventory, parameters: { slot: { type: 'number', description: '物品栏', required: true } } },
  { name: 'chat_message', description: '发送聊天消息', category: ToolCategory.Chat, parameters: { message: { type: 'string', description: '消息', required: true } } },
  { name: 'memory_query', description: '搜索记忆', category: ToolCategory.Memory, parameters: { query: { type: 'string', description: '查询', required: true } } },
  { name: 'memory_edit', description: '编辑记忆', category: ToolCategory.Memory, parameters: { action: { type: 'string', description: '操作', required: true } } },
  { name: 'inventory_list', description: '列出背包', category: ToolCategory.Inventory, parameters: {} },
  { name: 'task_create', description: '创建任务', category: ToolCategory.Task, parameters: { description: { type: 'string', description: '描述', required: true } } },
  { name: 'task_list', description: '列出任务', category: ToolCategory.Task, parameters: {} },
  { name: 'jump', description: '跳跃', category: ToolCategory.Movement, parameters: {} },
  { name: 'sneak', description: '潜行', category: ToolCategory.Movement, parameters: {} },
  { name: 'sprint', description: '冲刺', category: ToolCategory.Movement, parameters: {} },
  { name: 'eat', description: '进食', category: ToolCategory.Survival, parameters: { slot: { type: 'number', description: '物品栏', required: true } } },
  { name: 'interact', description: '交互', category: ToolCategory.Entity, parameters: { entity: { type: 'string', description: '实体', required: true } } },
  { name: 'craft', description: '合成', category: ToolCategory.Survival, parameters: { recipe: { type: 'string', description: '配方', required: true }, count: { type: 'number', description: '数量' } } },
  { name: 'smelt', description: '烧炼', category: ToolCategory.Survival, parameters: { fuel: { type: 'string', description: '燃料', required: true }, item: { type: 'string', description: '物品', required: true } } },
];

const mockState: PlayerState = {
  health: 20,
  hunger: 18,
  saturation: 5,
  position: { x: 100, y: 64, z: 200, dimension: 'overworld', biome: 'plains' },
  equipment: { mainhand: '铁镐' },
  inventory: { usedSlots: 10, totalSlots: 36, items: ['圆石 x32', '木棍 x4', '铁锭 x8'] },
  statusEffects: [],
};

function createMockRegistry() {
  return { getTools: (_ws: string) => allTools };
}

describe('完整提示词构建流程', () => {
  let builder: PromptBuilder;
  const registry = createMockRegistry();

  beforeEach(() => {
    const assembler = new DefaultToolPromptAssembler(registry);
    const contextManager = new DefaultContextWindowManager();
    builder = new PromptBuilder({
      toolRegistry: registry,
      assembler,
      contextManager,
    });
  });

  it('1. 完整构建流程 — 校验各区域', async () => {
    const result = await builder.build({
      workspaceId: 'ws-1',
      userInput: '帮我收集一些圆石',
      history: [],
      state: mockState,
      source: 'user',
    });

    // 校验消息结构
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[result.messages.length - 1].role).toBe('user');

    // 校验 system prompt 区域
    const systemContent = result.messages[0].content;
    expect(systemContent).toContain('McAgent');
    expect(systemContent).toContain('行为准则');
    expect(systemContent).toContain('性格特点');

    // 校验 user message 包含状态注入
    const userContent = result.messages[result.messages.length - 1].content;
    expect(userContent).toContain('当前状态');
    expect(userContent).toContain('生命: 20/20');
    expect(userContent).toContain('收集一些圆石');

    // 校验工具列表
    expect(result.tools.length).toBe(20);
    expect(result.tools[0].category).toBe('perception'); // 感知类优先

    // 校验缓存信息
    expect(result.cache.key).toBeTruthy();
    expect(result.cache.staticTokens).toBeGreaterThan(0);
    expect(result.cache.dynamicTokens).toBeGreaterThan(0);
  });

  it('2. 工具提示注入 + 分类过滤', async () => {
    // 自定义格式器
    const assembler = new DefaultToolPromptAssembler(registry);
    assembler.registerFormatter('move_to', {
      format: (tool) => ({
        ...tool,
        description: `${tool.description}（自动避障）`,
      }),
    });

    builder = new PromptBuilder({ toolRegistry: registry, assembler });

    const result = await builder.build({
      workspaceId: 'ws-1',
      userInput: '移动到坐标',
      history: [],
      state: mockState,
      source: 'user',
    });

    const moveTool = result.tools.find(t => t.name === 'move_to');
    expect(moveTool?.description).toContain('自动避障');
  });

  it('3. 上下文窗口裁剪 — 50 轮对话', async () => {
    // 使用严格的上下文窗口管理器以触发裁剪
    const strictManager = new DefaultContextWindowManager({
      historyMaxTokens: 200,
      keepRecentRounds: 3,
    });
    const strictBuilder = new PromptBuilder({
      toolRegistry: registry,
      assembler: new DefaultToolPromptAssembler(registry),
      contextManager: strictManager,
    });

    // 生成 50 轮对话
    const history: ConversationMessage[] = [];
    for (let i = 0; i < 50; i++) {
      history.push({ role: 'user', content: `用户输入第 ${i} 轮，这是一段较长的内容来占用 tokens 预算。` });
      history.push({ role: 'assistant', content: `AI 回复第 ${i} 轮，这也是一段较长的内容。` });
    }

    const result = await strictBuilder.build({
      workspaceId: 'ws-1',
      userInput: '继续任务',
      history,
      state: mockState,
      source: 'user',
    });

    // 裁剪后总消息数应小于原始消息数
    const totalHistoryMessages = history.length;
    const resultMessages = result.messages;
    // 系统消息 + 裁剪后的历史 + 用户输入
    expect(resultMessages.length).toBeLessThan(totalHistoryMessages + 2);
    // 但应至少包含系统消息和用户输入
    expect(resultMessages.length).toBeGreaterThanOrEqual(2);
  });

  it('4. 缓存命中验证 — 相同配置连续构建', async () => {
    const params: BuildParams = {
      workspaceId: 'ws-1',
      userInput: '测试',
      history: [],
      state: mockState,
      source: 'user',
    };

    // 第一次构建
    const result1 = await builder.build(params);
    expect(result1.cacheHit).toBe(false);

    // 第二次构建（相同配置）
    const result2 = await builder.build(params);
    expect(result2.cacheHit).toBe(true);
    expect(result2.cache.key).toBe(result1.cache.key);

    // 第三次构建（相同配置）
    const result3 = await builder.build(params);
    expect(result3.cacheHit).toBe(true);
    expect(result3.cache.key).toBe(result1.cache.key);
  });

  it('5. 智能体配置变更 — 缓存 key 变化', async () => {
    const params: BuildParams = {
      workspaceId: 'ws-1',
      userInput: '测试',
      history: [],
      state: mockState,
      source: 'user',
    };

    const result1 = await builder.build(params);

    // 修改配置
    builder.updateProfile({
      name: 'BuilderBot',
      identity: '我是一个建筑机器人',
      personality: ['热爱建筑'],
    });

    const result2 = await builder.build(params);
    expect(result2.cache.key).not.toBe(result1.cache.key);
    expect(result2.cacheHit).toBe(false);

    // 系统提示词应反映新配置
    const systemContent = result2.messages[0].content;
    expect(systemContent).toContain('BuilderBot');
    expect(systemContent).toContain('建筑机器人');
  });

  it('6. 系统提示词覆盖 + 自定义片段', async () => {
    builder.registerFragment({
      name: 'morning_plan',
      template: '## 今日计划\n- 上午采集资源\n- 下午探索',
      position: 'system_end',
      enabled: true,
    });

    const result = await builder.build({
      workspaceId: 'ws-1',
      userInput: '今天做什么？',
      history: [],
      state: mockState,
      source: 'user',
      systemOverride: '你是 TaskBot，一个任务执行智能体。\n## 规则\n- 按计划执行',
    });

    const systemContent = result.messages[0].content;
    expect(systemContent).toContain('TaskBot');
    expect(systemContent).toContain('按计划执行');
    expect(systemContent).not.toContain('McAgent');

    // 自定义片段应在 system 消息中
    const allSystemContent = result.messages[0].content;
    expect(allSystemContent).toContain('今日计划');

    const userContent = result.messages[result.messages.length - 1].content;
    expect(userContent).toContain('当前状态');
  });

  it('7. 状态注入格式正确', async () => {
    const complexState: PlayerState = {
      health: 15,
      hunger: 8,
      saturation: 2,
      position: { x: -150, y: 45, z: 300, dimension: 'nether', biome: 'crimson_forest' },
      equipment: { mainhand: '钻石剑', helmet: '铁头盔', chestplate: '铁胸甲' },
      inventory: { usedSlots: 25, totalSlots: 36, items: ['腐肉 x5', '金锭 x3', '末影珍珠 x12'] },
      statusEffects: ['夜视', '防火'],
      specialStatus: '注意：附近有猪灵',
    };

    const result = await builder.build({
      workspaceId: 'ws-1',
      userInput: '检查状态',
      history: [],
      state: complexState,
      source: 'system',
    });

    const userContent = result.messages[result.messages.length - 1].content;
    expect(userContent).toContain('生命: 15/20');
    expect(userContent).toContain('饥饿: 8/20');
    expect(userContent).toContain('下界');
    expect(userContent).toContain('crimson_forest');
    expect(userContent).toContain('钻石剑');
    expect(userContent).toContain('铁头盔');
    expect(userContent).toContain('夜视, 防火');
    expect(userContent).toContain('注意：附近有猪灵');
  });

  it('8. 缓存统计监控', async () => {
    // 5 次构建
    for (let i = 0; i < 3; i++) {
      await builder.build({
        workspaceId: 'ws-1',
        userInput: `请求 ${i}`,
        history: [],
        state: mockState,
        source: 'user',
      });
    }

    // 2 次相同配置（应命中）
    await builder.build({
      workspaceId: 'ws-1',
      userInput: '相同请求',
      history: [],
      state: mockState,
      source: 'user',
    });
    await builder.build({
      workspaceId: 'ws-1',
      userInput: '相同请求',
      history: [],
      state: mockState,
      source: 'user',
    });

    const stats = builder.getCacheStats();
    expect(stats.totalBuilds).toBe(5);
    expect(stats.cacheHits).toBeGreaterThanOrEqual(1);
    expect(stats.cacheMisses).toBeGreaterThanOrEqual(1);
  });
});