/**
 * 缓存命中模拟测试
 *
 * 验证三区域缓存结构是否能最大化缓存命中率：
 * - Region 1（静态前缀）：系统提示词 — 最高缓存命中
 * - Region 2（半静态）：工具定义 — 工具集不变时命中
 * - Region 3（动态内容）：状态注入 + 对话历史 — 每次都不同
 *
 * 模拟场景：Agent 连续执行任务，验证缓存 key 的变化和命中情况。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PromptBuilder,
  DefaultToolPromptAssembler,
  DefaultContextWindowManager,
  DEFAULT_AGENT_PROFILE,
} from '../../src/main/prompt';
import { ToolCategory } from '@mcagent/shared';
import type { ToolSchema, BuildParams, PlayerState, ConversationMessage, AgentProfile } from '../../src/main/prompt';

// ─── 模拟工具数据（20 个工具，与集成测试一致） ───

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

// ─── 模拟玩家状态 ───

const baseState: PlayerState = {
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

// ─── 测试：缓存命中模拟 ───

describe('V5 缓存命中模拟', () => {
  const registry = createMockRegistry();
  let builder: PromptBuilder;

  beforeEach(() => {
    const assembler = new DefaultToolPromptAssembler(registry);
    builder = new PromptBuilder({
      toolRegistry: registry,
      assembler,
    });
  });

  it('场景一：连续相同请求 — 100% 缓存命中', async () => {
    // 模拟 Agent 在 10 轮对话中保持相同配置
    const params: BuildParams = {
      workspaceId: 'ws-1',
      userInput: '帮我挖一些圆石',
      history: [],
      state: baseState,
      source: 'user',
    };

    const results: boolean[] = [];
    for (let i = 0; i < 10; i++) {
      const result = await builder.build({ ...params, userInput: `第 ${i} 轮请求` });
      results.push(result.cacheHit);
    }

    // 第一次是 miss，后面 9 次都是 hit
    expect(results[0]).toBe(false);
    for (let i = 1; i < 10; i++) {
      expect(results[i]).toBe(true);
    }

    const stats = builder.getCacheStats();
    expect(stats.totalBuilds).toBe(10);
    expect(stats.cacheHits).toBe(9);
    expect(stats.hitRate).toBe(0.9);
  });

  it('场景二：状态变化但配置不变 — 缓存命中', async () => {
    // 智能体配置和工具集不变 → 缓存 key 不变 → 命中
    const params1: BuildParams = {
      workspaceId: 'ws-1',
      userInput: '检查状态',
      history: [],
      state: baseState,
      source: 'user',
    };
    const result1 = await builder.build(params1);

    // 状态变化（位置变了，但智能体配置和工具集没变）
    const changedState: PlayerState = {
      ...baseState,
      health: 15,
      hunger: 8,
      position: { x: -150, y: 45, z: 300, dimension: 'nether', biome: 'crimson_forest' },
    };
    const params2: BuildParams = {
      workspaceId: 'ws-1',
      userInput: '检查状态',
      history: [],
      state: changedState,
      source: 'user',
    };
    const result2 = await builder.build(params2);

    // 缓存 key 不变 → 命中（因为 hash 不依赖状态）
    expect(result2.cacheHit).toBe(true);
    expect(result2.cache.key).toBe(result1.cache.key);

    // 但动态内容（stateInjection）变化了
    expect(result2.messages[1].content).toContain('生命: 15/20');
    expect(result1.messages[1].content).toContain('生命: 20/20');
  });

  it('场景三：工具集变化 — 缓存 miss', async () => {
    // 不同工作区有不同工具集
    const result1 = await builder.build({
      workspaceId: 'ws-1',
      userInput: '帮我挖矿',
      history: [],
      state: baseState,
      source: 'user',
    });

    // 模拟第二个工作区只有部分工具
    const miniTools: ToolSchema[] = [
      { name: 'move_to', description: '移动', category: ToolCategory.Movement, parameters: {} },
      { name: 'dig_block', description: '挖掘', category: ToolCategory.Block, parameters: {} },
    ];
    const miniRegistry = { getTools: (_ws: string) => miniTools };
    const miniAssembler = new DefaultToolPromptAssembler(miniRegistry);
    const miniBuilder = new PromptBuilder({
      toolRegistry: miniRegistry,
      assembler: miniAssembler,
    });

    const result2 = await miniBuilder.build({
      workspaceId: 'ws-2',
      userInput: '帮我挖矿',
      history: [],
      state: baseState,
      source: 'user',
    });

    // 不同工作区/工具集 → 不同缓存 key → miss
    expect(result2.cache.key).not.toBe(result1.cache.key);
    expect(result2.tools.length).toBe(2);
  });

  it('场景四：智能体配置变化 — 缓存 miss', async () => {
    const params: BuildParams = {
      workspaceId: 'ws-1',
      userInput: '执行任务',
      history: [],
      state: baseState,
      source: 'user',
    };

    const result1 = await builder.build(params);

    // 修改智能体配置
    builder.updateProfile({
      name: 'MinerBot',
      identity: '我是一个专业的挖矿机器人',
      personality: ['专注于挖矿', '效率至上'],
    });

    const result2 = await builder.build(params);

    // 配置变化 → 系统提示词变化 → 缓存 miss
    expect(result2.cacheHit).toBe(false);
    expect(result2.cache.key).not.toBe(result1.cache.key);
    expect(result2.messages[0].content).toContain('MinerBot');
    expect(result2.messages[0].content).toContain('挖矿机器人');
  });

  it('场景五：相同配置 + 对话历史增长 — 缓存命中', async () => {
    // 模拟连续多轮对话
    let history: ConversationMessage[] = [];
    const params = (input: string) => ({
      workspaceId: 'ws-1',
      userInput: input,
      history,
      state: baseState,
      source: 'user' as const,
    });

    // 第 1 轮：miss
    const r1 = await builder.build(params('开始挖矿'));
    expect(r1.cacheHit).toBe(false);

    // 更新历史
    history.push({ role: 'user', content: '开始挖矿' });
    history.push({ role: 'assistant', content: '好的，我来挖一些圆石' });

    // 第 2 轮：cache key 不变（历史不参与 hash）→ 命中
    const r2 = await builder.build(params('挖了多少了？'));
    expect(r2.cacheHit).toBe(true);

    // 继续增长历史
    history.push({ role: 'user', content: '挖了多少了？' });
    history.push({ role: 'assistant', content: '已经挖了 32 个圆石' });

    // 第 3 轮：依旧命中
    const r3 = await builder.build(params('继续挖'));
    expect(r3.cacheHit).toBe(true);

    const stats = builder.getCacheStats();
    expect(stats.totalBuilds).toBe(3);
    expect(stats.cacheHits).toBe(2);

    // 验证三区域缓存结构
    expect(r3.cache.regions.system).toBe(r1.cache.regions.system);
    expect(r3.cache.regions.tools).toBe(r1.cache.regions.tools);
    // 动态区域每次不同（历史变化）
    expect(r3.cache.regions.dynamic).not.toBe(r1.cache.regions.dynamic);
  });

  it('场景六：缓存命中率统计 — 70 次构建', async () => {
    // 模拟长时间运行的 Agent
    // 设计：同一配置下执行 70 次构建
    // 其中每次 userInput 不同（不参与 hash），状态不同（不参与 hash）
    // 理应：1 次 miss + 69 次 hit

    const count = 70;
    for (let i = 0; i < count; i++) {
      const state: PlayerState = {
        ...baseState,
        health: Math.floor(Math.random() * 20) + 1,
        position: {
          x: Math.floor(Math.random() * 1000),
          y: 64,
          z: Math.floor(Math.random() * 1000),
          dimension: 'overworld',
          biome: 'plains',
        },
      };
      await builder.build({
        workspaceId: 'ws-1',
        userInput: `第 ${i} 次操作`,
        history: [],
        state,
        source: 'user',
      });
    }

    const stats = builder.getCacheStats();
    console.log(`[缓存统计] 总构建: ${stats.totalBuilds}`);
    console.log(`[缓存统计] 命中: ${stats.cacheHits} | Miss: ${stats.cacheMisses}`);
    console.log(`[缓存统计] 命中率: ${(stats.hitRate * 100).toFixed(2)}%`);

    expect(stats.totalBuilds).toBe(count);
    expect(stats.cacheMisses).toBe(1);  // 第一次 miss
    expect(stats.cacheHits).toBe(count - 1);  // 后续全部命中
    expect(stats.hitRate).toBe((count - 1) / count);
  });

  it('输出实际生成的系统提示词', async () => {
    // 使用独立的 builder，传入显式的默认配置，避免被其他测试的 updateProfile 影响
    const freshAssembler = new DefaultToolPromptAssembler(registry);
    const freshBuilder = new PromptBuilder({
      toolRegistry: registry,
      assembler: freshAssembler,
      profile: {
        ...DEFAULT_AGENT_PROFILE,
        name: 'McAgent',
        identity: '你是一个有自主意识的 Minecraft 玩家，会像人类一样思考和探索。',
        fragments: [],
      },
    });

    // 构建一次，输出完整的系统提示词和用户消息，便于审查
    const result = await freshBuilder.build({
      workspaceId: 'ws-1',
      userInput: '帮我收集一些圆石',
      history: [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好！有什么需要帮忙的？' },
      ],
      state: baseState,
      source: 'user',
    });

    console.log('\n═══════════════════════════════════════');
    console.log('        V5 提示词生成模拟输出');
    console.log('═══════════════════════════════════════\n');

    console.log('── Region 1: 系统提示词（静态前缀）──');
    console.log(result.messages[0].content);
    console.log('\n── Region 3: 动态注入（状态 + 用户输入）──');
    console.log(result.messages[result.messages.length - 1].content);

    console.log('\n── 工具列表预览（前 5 个）──');
    for (const tool of result.tools.slice(0, 5)) {
      console.log(`  [${tool.category}] ${tool.name}: ${tool.description}`);
    }
    console.log(`  ... 共 ${result.tools.length} 个工具`);

    console.log('\n── 缓存信息 ──');
    console.log(`  缓存 Key:    ${result.cache.key}`);
    console.log(`  静态 Tokens: ${result.cache.staticTokens}`);
    console.log(`  动态 Tokens: ${result.cache.dynamicTokens}`);
    console.log(`  总 Tokens:    ${result.cache.totalTokens}`);
    console.log(`  静态占比:    ${((result.cache.staticTokens / result.cache.totalTokens) * 100).toFixed(1)}%`);
    console.log(`  Region 缓存: ${JSON.stringify(result.cache.regions, null, 4)}`);

    // 验证三区域结构
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toContain('McAgent');
    expect(result.messages[0].content).toContain('行为准则');
    expect(result.messages[0].content).toContain('性格特点');
  });
});