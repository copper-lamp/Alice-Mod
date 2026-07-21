/**
 * Function Calling Pipeline 测试
 *
 * 覆盖：
 * - ResponseParser 解析
 * - DependencyAnalyzer 依赖分析
 * - BatchScheduler 调度
 * - ResultInjector 回注
 * - FallbackManager 兜底
 * - 完整管线流程
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultResponseParser } from '../../src/main/pipeline/response-parser';
import { DefaultDependencyAnalyzer } from '../../src/main/pipeline/dependency-analyzer';
import { DefaultBatchScheduler } from '../../src/main/pipeline/batch-scheduler';
import { DefaultResultInjector } from '../../src/main/pipeline/result-injector';
import { DefaultFallbackManager } from '../../src/main/pipeline/fallback/fallback-manager';
import { RetryStrategy } from '../../src/main/pipeline/fallback/retry-strategy';
import { DegradeStrategy } from '../../src/main/pipeline/fallback/degrade-strategy';
import { FunctionCallingPipeline } from '../../src/main/pipeline/pipeline';
import { LoggerMiddleware } from '../../src/main/pipeline/middleware/builtin/logger-middleware';
import { MetricsMiddleware } from '../../src/main/pipeline/middleware/builtin/metrics-middleware';
import { ValidatorMiddleware } from '../../src/main/pipeline/middleware/builtin/validator-middleware';
import type {
  LLMResponse,
  ToolCallContent,
  Conversation,
  IToolDispatcher,
  IResultCollector,
  ScheduledBatch,
  BatchExecuteResult,
  CollectResult,
  ToolResultContent,
  ExecutionLayer,
  ToolSchema,
} from '../../src/main/pipeline/types';

// ═══════════════════════════════════════════════════════════
// Mock 辅助
// ═══════════════════════════════════════════════════════════

function makeToolCallResponse(tools: Array<{ name: string; args?: Record<string, unknown>; id?: string }>): LLMResponse {
  return {
    message: {
      role: 'assistant',
      content: null,
      tool_calls: tools.map((t, i) => ({
        id: t.id || `call_${i}`,
        type: 'function' as const,
        function: {
          name: t.name,
          arguments: JSON.stringify(t.args || {}),
        },
      })),
    },
    finish_reason: 'tool_calls',
  };
}

function makeEmptyResponse(): LLMResponse {
  return {
    message: { role: 'assistant', content: 'Hello, I can help you.' },
    finish_reason: 'stop',
  };
}

function makeMockConversation(): Conversation {
  const messages: import('../../src/main/pipeline/types').LLMMessage[] = [];
  return {
    messages,
    addMessage(msg) { messages.push(msg); },
    getMessages() { return messages; },
  };
}

// ═══════════════════════════════════════════════════════════
// ResponseParser 测试
// ═══════════════════════════════════════════════════════════

describe('DefaultResponseParser', () => {
  const parser = new DefaultResponseParser();

  it('应正确解析 tool_calls', () => {
    const response = makeToolCallResponse([
      { name: 'move_to', args: { x: 100, z: 200 } },
      { name: 'dig_block', args: { x: 10, y: 5, z: 20 } },
    ]);

    const result = parser.parse(response);
    expect(result).toHaveLength(2);
    expect(result[0].toolName).toBe('move_to');
    expect(result[0].arguments).toEqual({ x: 100, z: 200 });
    expect(result[1].toolName).toBe('dig_block');
  });

  it('无 tool_calls 时应返回空数组', () => {
    const result = parser.parse(makeEmptyResponse());
    expect(result).toHaveLength(0);
  });

  it('应处理空参数', () => {
    const response = makeToolCallResponse([
      { name: 'chat', args: { message: 'hello' } },
    ]);
    const result = parser.parse(response);
    expect(result[0].arguments).toEqual({ message: 'hello' });
  });

  it('参数解析失败时使用空对象', () => {
    const response: LLMResponse = {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'test', arguments: 'invalid json' },
        }],
      },
      finish_reason: 'tool_calls',
    };
    const result = parser.parse(response);
    expect(result[0].arguments).toEqual({});
  });

  it('应校验参数合法性', () => {
    const definition: ToolSchema = {
      name: 'move_to',
      description: 'Move to a position',
      parameters: {
        x: { type: 'number', required: true },
        z: { type: 'number', required: true },
      },
      category: { Perception: 'perception' } as any,
    };

    // 合法参数
    const validCall: ToolCallContent = {
      type: 'tool_call',
      toolCallId: '1',
      toolName: 'move_to',
      arguments: { x: 100, z: 200 },
    };
    expect(parser.validate(validCall, definition).valid).toBe(true);

    // 缺少必填参数
    const invalidCall: ToolCallContent = {
      type: 'tool_call',
      toolCallId: '2',
      toolName: 'move_to',
      arguments: { x: 100 },
    };
    expect(parser.validate(invalidCall, definition).valid).toBe(false);
    expect(parser.validate(invalidCall, definition).errors).toContain('缺少必填参数: z');
  });
});

// ═══════════════════════════════════════════════════════════
// DependencyAnalyzer 测试
// ═══════════════════════════════════════════════════════════

describe('DefaultDependencyAnalyzer', () => {
  const analyzer = new DefaultDependencyAnalyzer();

  it('无依赖时应全部放在同一层', () => {
    const calls: ToolCallContent[] = [
      { type: 'tool_call', toolCallId: '1', toolName: 'chat', arguments: { message: 'hi' } },
      { type: 'tool_call', toolCallId: '2', toolName: 'qq_info', arguments: {} },
    ];

    const layers = analyzer.analyze(calls);
    expect(layers).toHaveLength(1);
    expect(layers[0].calls).toHaveLength(2);
  });

  it('冲突工具应分到不同层级', () => {
    const calls: ToolCallContent[] = [
      { type: 'tool_call', toolCallId: '1', toolName: 'move_to', arguments: { x: 0, z: 0 } },
      { type: 'tool_call', toolCallId: '2', toolName: 'dig_block', arguments: { x: 10, y: 5, z: 20 } },
    ];

    const layers = analyzer.analyze(calls);
    // move 和 dig 冲突，应分不同层
    expect(layers.length).toBeGreaterThanOrEqual(2);
  });

  it('参数引用依赖应产生层级', () => {
    const calls: ToolCallContent[] = [
      { type: 'tool_call', toolCallId: '1', toolName: 'move_to', arguments: { x: 100, z: 200 } },
      { type: 'tool_call', toolCallId: '2', toolName: 'dig_block', arguments: { '${move_to.result.x}': '${move_to.result.x}' } },
    ];

    const layers = analyzer.analyze(calls);
    expect(layers.length).toBeGreaterThanOrEqual(2);
  });

  it('循环依赖应抛出异常', () => {
    const calls: ToolCallContent[] = [
      { type: 'tool_call', toolCallId: '1', toolName: 'move_to', arguments: { '${dig_block.result.x}': '${dig_block.result.x}' } },
      { type: 'tool_call', toolCallId: '2', toolName: 'dig_block', arguments: { '${move_to.result.x}': '${move_to.result.x}' } },
    ];

    expect(() => analyzer.analyze(calls)).toThrow('循环依赖');
  });

  it('空数组应返回空', () => {
    expect(analyzer.analyze([])).toHaveLength(0);
  });

  it('自定义冲突规则应生效', () => {
    analyzer.registerConflictRule({
      name: 'test_rule',
      priority: 1,
      check: (a, b) => a.toolName === 'move_to' && b.toolName === 'chat',
    });

    const calls: ToolCallContent[] = [
      { type: 'tool_call', toolCallId: '1', toolName: 'move_to', arguments: {} },
      { type: 'tool_call', toolCallId: '2', toolName: 'chat', arguments: { message: 'hi' } },
    ];

    const layers = analyzer.analyze(calls);
    expect(layers.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════
// BatchScheduler 测试
// ═══════════════════════════════════════════════════════════

describe('DefaultBatchScheduler', () => {
  const scheduler = new DefaultBatchScheduler();

  it('分层调度应正确', () => {
    const layers: ExecutionLayer[] = [
      { level: 0, calls: [{ type: 'tool_call', toolCallId: '1', toolName: 'chat', arguments: {} }] },
      { level: 1, calls: [{ type: 'tool_call', toolCallId: '2', toolName: 'dig_block', arguments: { x: 1, y: 2, z: 3 } }] },
    ];

    const batches = scheduler.schedule(layers);
    expect(batches).toHaveLength(2);
    expect(batches[0].level).toBe(0);
    expect(batches[1].level).toBe(1);
    expect(batches[0].calls[0].params.tool_name).toBe('chat');
  });

  it('顺序调度应每个工具一个 Batch', () => {
    scheduler.setStrategy('sequential');
    const layers: ExecutionLayer[] = [
      { level: 0, calls: [
        { type: 'tool_call', toolCallId: '1', toolName: 'chat', arguments: {} },
        { type: 'tool_call', toolCallId: '2', toolName: 'qq_info', arguments: {} },
      ]},
    ];

    const batches = scheduler.schedule(layers);
    expect(batches).toHaveLength(2);
  });

  it('贪心调度应受 maxConcurrency 限制', () => {
    scheduler.setStrategy('greedy');
    const layers: ExecutionLayer[] = [
      { level: 0, calls: [
        { type: 'tool_call', toolCallId: '1', toolName: 'chat', arguments: {} },
        { type: 'tool_call', toolCallId: '2', toolName: 'qq_info', arguments: {} },
        { type: 'tool_call', toolCallId: '3', toolName: 'memory_query', arguments: {} },
      ]},
    ];

    const batches = scheduler.schedule(layers, { maxConcurrency: 2, globalTimeoutMs: 60000, layerTimeoutMs: 30000, onError: 'continue' });
    expect(batches).toHaveLength(2); // 3个工具，每批2个 = 2批
    expect(batches[0].calls).toHaveLength(2);
    expect(batches[1].calls).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════
// ResultInjector 测试
// ═══════════════════════════════════════════════════════════

describe('DefaultResultInjector', () => {
  const injector = new DefaultResultInjector();

  it('应正确回注结果到对话', () => {
    const conv = makeMockConversation();
    const result: CollectResult = {
      results: [{
        type: 'tool_result',
        toolCallId: 'call_1',
        toolName: 'move_to',
        success: true,
        data: { position: { x: 100, z: 200 } },
        durationMs: 1500,
      }],
      successCount: 1,
      failCount: 0,
      totalDurationMs: 1500,
      toolDurations: [{ toolName: 'move_to', durationMs: 1500, success: true }],
      hasErrors: false,
    };

    injector.inject(result, conv);
    expect(conv.getMessages()).toHaveLength(1);
    expect(conv.getMessages()[0].role).toBe('tool');
    expect(conv.getMessages()[0].tool_call_id).toBe('call_1');
  });

  it('应跳过取消的调用', () => {
    const conv = makeMockConversation();
    const result: CollectResult = {
      results: [{
        type: 'tool_result',
        toolCallId: 'call_1',
        success: false,
        durationMs: 0,
        cancelled: true,
      }],
      successCount: 0,
      failCount: 0,
      totalDurationMs: 0,
      toolDurations: [],
      hasErrors: false,
    };

    injector.inject(result, conv);
    expect(conv.getMessages()).toHaveLength(0);
  });

  it('自定义格式化器应生效', () => {
    injector.registerFormatter('move_to', (result) => ({
      ...result,
      data: { formatted: true, original: result.data },
    }));

    const conv = makeMockConversation();
    const result: CollectResult = {
      results: [{
        type: 'tool_result',
        toolCallId: 'call_1',
        toolName: 'move_to',
        success: true,
        data: { x: 100 },
        durationMs: 100,
      }],
      successCount: 1,
      failCount: 0,
      totalDurationMs: 100,
      toolDurations: [{ toolName: 'move_to', durationMs: 100, success: true }],
      hasErrors: false,
    };

    injector.inject(result, conv);
    const content = JSON.parse(conv.getMessages()[0].content as string);
    expect(content.data.formatted).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// FallbackManager 测试
// ═══════════════════════════════════════════════════════════

describe('DefaultFallbackManager', () => {
  const fallback = new DefaultFallbackManager();

  it('重试策略应匹配可重试错误', () => {
    const strategy = new RetryStrategy();
    const call: ToolCallContent = { type: 'tool_call', toolCallId: '1', toolName: 'move_to', arguments: {} };

    expect(strategy.shouldApply(call, {
      workspaceId: 'ws1',
      attemptCount: 1,
      previousErrors: ['timeout'],
      allResults: [],
      metadata: {},
    })).toBe(true);

    expect(strategy.shouldApply(call, {
      workspaceId: 'ws1',
      attemptCount: 4, // 超过最大重试次数
      previousErrors: ['timeout'],
      allResults: [],
      metadata: {},
    })).toBe(false);
  });

  it('降级策略应 Mock 感知类工具', async () => {
    const strategy = new DegradeStrategy();
    const call: ToolCallContent = { type: 'tool_call', toolCallId: '1', toolName: 'memory_query', arguments: {} };

    const result = await strategy.execute(call, {
      workspaceId: 'ws1',
      attemptCount: 4,
      previousErrors: ['timeout'],
      allResults: [],
      metadata: {},
    });

    expect(result.resolved).toBe(true);
    expect(result.result.data).toBeDefined();
  });

  it('所有策略不适用时返回失败', async () => {
    const result = await fallback.handle(
      { type: 'tool_call', toolCallId: '1', toolName: 'unknown_tool', arguments: {} },
      { workspaceId: 'ws1', attemptCount: 0, previousErrors: ['unknown'], allResults: [], metadata: {} },
    );

    expect(result.resolved).toBe(false);
    expect(result.strategyUsed).toBe('none');
  });
});

// ═══════════════════════════════════════════════════════════
// 完整管线流程测试
// ═══════════════════════════════════════════════════════════

describe('FunctionCallingPipeline', () => {
  let pipeline: FunctionCallingPipeline;
  let mockDispatcher: IToolDispatcher;
  let mockCollector: IResultCollector;

  beforeEach(() => {
    pipeline = new FunctionCallingPipeline();

    // Mock Collector
    mockCollector = {
      collect: vi.fn().mockResolvedValue({
        results: [] as ToolResultContent[],
        successCount: 0,
        failCount: 0,
        totalDurationMs: 0,
        toolDurations: [],
        hasErrors: false,
      }),
      onResult: vi.fn(),
    };

    // Mock Dispatcher
    mockDispatcher = {
      executeBatch: vi.fn().mockResolvedValue({
        results: [] as ToolResultContent[],
        totalDurationMs: 0,
      }),
      registerStrategy: vi.fn(),
    };

    pipeline.setDispatcher(mockDispatcher);
    pipeline.setCollector(mockCollector);
  });

  it('无 tool_calls 时应返回空结果', async () => {
    const result = await pipeline.process(
      makeEmptyResponse(),
      'ws-1',
      makeMockConversation(),
    );
    expect(result.stats.total).toBe(0);
    expect(result.hasErrors).toBe(false);
  });

  it('应正确完成完整管线流程', async () => {
    const mockResults: ToolResultContent[] = [
      { type: 'tool_result', toolCallId: 'call_0', toolName: 'chat', success: true, data: {}, durationMs: 100 },
    ];

    mockCollector.collect = vi.fn().mockResolvedValue({
      results: mockResults,
      successCount: 1,
      failCount: 0,
      totalDurationMs: 100,
      toolDurations: [{ toolName: 'chat', durationMs: 100, success: true }],
      hasErrors: false,
    });

    mockDispatcher.executeBatch = vi.fn().mockResolvedValue({
      results: [{ id: 'call_0', toolName: 'chat', success: true, data: {}, durationMs: 100 }],
      totalDurationMs: 100,
    });

    const response = makeToolCallResponse([{ name: 'chat', args: { message: 'hello' } }]);
    const result = await pipeline.process(response, 'ws-1', makeMockConversation());

    expect(result.stats.total).toBe(1);
    expect(result.stats.success).toBe(1);
    expect(result.hasErrors).toBe(false);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('中间件注册应生效', async () => {
    const middleware = new LoggerMiddleware();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    pipeline.use(middleware);

    const response = makeToolCallResponse([{ name: 'chat', args: { message: 'hi' } }]);
    mockCollector.collect = vi.fn().mockResolvedValue({
      results: [{ type: 'tool_result', toolCallId: 'call_0', toolName: 'chat', success: true, data: {}, durationMs: 100 }],
      successCount: 1,
      failCount: 0,
      totalDurationMs: 100,
      toolDurations: [{ toolName: 'chat', durationMs: 100, success: true }],
      hasErrors: false,
    });
    mockDispatcher.executeBatch = vi.fn().mockResolvedValue({
      results: [{ id: 'call_0', toolName: 'chat', success: true, data: {}, durationMs: 100 }],
      totalDurationMs: 100,
    });

    await pipeline.process(response, 'ws-1', makeMockConversation());
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('事件应正确触发', async () => {
    const startSpy = vi.fn();
    const completeSpy = vi.fn();
    pipeline.onEvent('pipeline:start' as any, startSpy);
    pipeline.onEvent('pipeline:complete' as any, completeSpy);

    mockCollector.collect = vi.fn().mockResolvedValue({
      results: [],
      successCount: 0,
      failCount: 0,
      totalDurationMs: 0,
      toolDurations: [],
      hasErrors: false,
    });

    const response = makeToolCallResponse([{ name: 'chat', args: { message: 'hello' } }]);
    mockDispatcher.executeBatch = vi.fn().mockResolvedValue({
      results: [{ id: 'call_0', toolName: 'chat', success: true, data: {}, durationMs: 100 }],
      totalDurationMs: 100,
    });

    await pipeline.process(response, 'ws-1', makeMockConversation());
    expect(startSpy).toHaveBeenCalled();
    expect(completeSpy).toHaveBeenCalled();
  });

  it('未设置 Dispatcher 时应抛出错误', async () => {
    const emptyPipeline = new FunctionCallingPipeline();
    // 不设置 dispatcher
    emptyPipeline.setCollector(mockCollector);

    const response = makeToolCallResponse([{ name: 'chat', args: { message: 'hi' } }]);
    const result = await emptyPipeline.process(response, 'ws-1', makeMockConversation());
    expect(result.hasErrors).toBe(true);
    expect(result.errors[0].code).toBe('FCP_500');
  });

  it('getStatus 应返回当前状态', () => {
    const status = pipeline.getStatus();
    expect(status.phase).toBe('idle');
  });

  it('reset 应重置状态', () => {
    pipeline.reset();
    const status = pipeline.getStatus();
    expect(status.phase).toBe('idle');
    expect(status.callCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// 集成测试：依赖分析 + 调度
// ═══════════════════════════════════════════════════════════

describe('Pipeline Integration', () => {
  it('无依赖的 3 个工具应分到同一层', () => {
    const analyzer = new DefaultDependencyAnalyzer();
    const scheduler = new DefaultBatchScheduler();

    const calls: ToolCallContent[] = [
      { type: 'tool_call', toolCallId: '1', toolName: 'chat', arguments: { message: 'a' } },
      { type: 'tool_call', toolCallId: '2', toolName: 'qq_info', arguments: {} },
      { type: 'tool_call', toolCallId: '3', toolName: 'memory_query', arguments: {} },
    ];

    const layers = analyzer.analyze(calls);
    expect(layers).toHaveLength(1);

    const batches = scheduler.schedule(layers);
    expect(batches).toHaveLength(1);
    expect(batches[0].calls).toHaveLength(3);
  });

  it('复杂依赖应正确分多层', () => {
    const analyzer = new DefaultDependencyAnalyzer();
    const scheduler = new DefaultBatchScheduler();

    // Layer 0: move_to, chat (可并行)
    // Layer 1: dig_block (依赖 move_to 完成)
    // Layer 2: place_block (依赖 dig_block 完成)
    const calls: ToolCallContent[] = [
      { type: 'tool_call', toolCallId: '1', toolName: 'chat', arguments: { message: 'hi' } },
      { type: 'tool_call', toolCallId: '2', toolName: 'move_to', arguments: { x: 100, z: 200 } },
      { type: 'tool_call', toolCallId: '3', toolName: 'dig_block', arguments: { '${move_to.result.x}': '${move_to.result.x}' } },
      { type: 'tool_call', toolCallId: '4', toolName: 'place_block', arguments: { '${dig_block.result.x}': '${dig_block.result.x}' } },
    ];

    const layers = analyzer.analyze(calls);
    // chat 和 move_to 可并行，但 conflict 矩阵标记为冲突...
    // 实际上 chat 和 move_to 不冲突，所以它们在同一层
    // dig_block 依赖 move_to，所以它在下一层
    // place_block 依赖 dig_block，所以它在再下一层
    expect(layers.length).toBeGreaterThanOrEqual(2);

    const batches = scheduler.schedule(layers);
    expect(batches.length).toBe(layers.length);
    expect(batches[0].calls.length).toBeGreaterThanOrEqual(1);
  });
});