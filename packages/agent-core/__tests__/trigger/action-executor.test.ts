/**
 * ActionExecutor 单元测试
 *
 * 覆盖场景：
 * - create_task / call_tool / send_llm / send_qq / store_memory / none
 * - 模板渲染（字符串、对象递归、默认值）
 * - 依赖缺失时的错误处理
 * - 异常捕获
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ActionExecutor } from '../../src/main/trigger/action-executor';
import type { AgentEvent, TriggerAction } from '../../src/main/trigger/types';

function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: 'evt_001',
    type: 'game_chat',
    source: 'game_chat',
    workspaceId: 'ws_001',
    timestamp: Date.now(),
    payload: { message: 'hello world', playerId: 'p1' },
    ...overrides,
  };
}

describe('ActionExecutor', () => {
  let executor: ActionExecutor;

  beforeEach(() => {
    executor = new ActionExecutor();
  });

  describe('create_task', () => {
    it('应创建任务并返回 taskId', async () => {
      const createMock = vi.fn().mockResolvedValue({ id: 'task_001' });
      executor.setDeps({
        taskManager: { create: createMock },
      });

      const action: TriggerAction = {
        type: 'create_task',
        config: {
          name: '任务: {{event.type}}',
          description: '来自 {{event.payload.playerId}}',
          taskType: 'simple',
          priority: 'high',
          action: { toolName: 'move_to', parameters: { x: 1 } },
          tags: ['chat'],
        },
      };

      const result = await executor.execute(action, makeEvent());
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ taskId: 'task_001' });
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws_001',
          name: '任务: game_chat',
          description: '来自 p1',
          type: 'simple',
          priority: 'high',
          tags: ['chat'],
        }),
      );
    });

    it('缺少 taskManager 应返回错误', async () => {
      const action: TriggerAction = { type: 'create_task', config: {} };
      const result = await executor.execute(action, makeEvent());
      expect(result.success).toBe(false);
      expect(result.error).toBe('TaskManager 未配置');
    });
  });

  describe('call_tool', () => {
    it('应调用指定工具并渲染参数', async () => {
      const callToolMock = vi.fn().mockResolvedValue({ ok: true });
      executor.setDeps({ callTool: callToolMock });

      const action: TriggerAction = {
        type: 'call_tool',
        config: {
          toolName: 'send_msg',
          parameters: { target: '{{event.payload.playerId}}', message: '{{event.payload.message}}' },
        },
      };

      const result = await executor.execute(action, makeEvent());
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ ok: true });
      expect(callToolMock).toHaveBeenCalledWith('ws_001', 'send_msg', {
        target: 'p1',
        message: 'hello world',
      });
    });

    it('缺少 callTool 依赖应返回错误', async () => {
      const action: TriggerAction = { type: 'call_tool', config: { toolName: 't' } };
      const result = await executor.execute(action, makeEvent());
      expect(result.success).toBe(false);
      expect(result.error).toBe('callTool 未配置');
    });
  });

  describe('send_llm', () => {
    it('应发送提示词并包含事件上下文', async () => {
      const sendLLMMock = vi.fn().mockResolvedValue('reply');
      executor.setDeps({ sendLLM: sendLLMMock });

      const action: TriggerAction = {
        type: 'send_llm',
        config: { target: 'main', prompt: '玩家说: {{event.payload.message}}', includeEventContext: true },
      };

      const event = makeEvent();
      const result = await executor.execute(action, event);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ response: 'reply' });
      expect(sendLLMMock).toHaveBeenCalledWith(
        'main',
        expect.stringContaining('玩家说: hello world'),
        event,
      );
    });

    it('includeEventContext=false 时不追加上下文', async () => {
      const sendLLMMock = vi.fn().mockResolvedValue('reply');
      executor.setDeps({ sendLLM: sendLLMMock });

      const action: TriggerAction = {
        type: 'send_llm',
        config: { target: 'qq_sub_agent', prompt: 'hi', includeEventContext: false },
      };

      await executor.execute(action, makeEvent());
      expect(sendLLMMock).toHaveBeenCalledWith('qq_sub_agent', 'hi', expect.anything());
    });

    it('缺少 sendLLM 依赖应返回错误', async () => {
      const action: TriggerAction = { type: 'send_llm', config: { target: 'main', prompt: 'hi' } };
      const result = await executor.execute(action, makeEvent());
      expect(result.success).toBe(false);
      expect(result.error).toBe('sendLLM / mainAgentProvider 未配置');
    });
  });

  describe('send_qq', () => {
    it('应发送 QQ 消息并渲染目标与内容', async () => {
      const sendQQMock = vi.fn().mockResolvedValue(true);
      executor.setDeps({ sendQQ: sendQQMock });

      const action: TriggerAction = {
        type: 'send_qq',
        config: { target: 'group_{{event.workspaceId}}', content: '收到: {{event.payload.message}}', messageType: 'group' },
      };

      const result = await executor.execute(action, makeEvent());
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ target: 'group_ws_001', content: '收到: hello world', messageType: 'group' });
      expect(sendQQMock).toHaveBeenCalledWith('group_ws_001', '收到: hello world', 'group');
    });

    it('sendQQ 返回 false 时应标记失败', async () => {
      executor.setDeps({ sendQQ: vi.fn().mockResolvedValue(false) });
      const action: TriggerAction = { type: 'send_qq', config: { target: 'g', content: 'hi' } };
      const result = await executor.execute(action, makeEvent());
      expect(result.success).toBe(false);
    });

    it('缺少 sendQQ 依赖应返回错误', async () => {
      const action: TriggerAction = { type: 'send_qq', config: { target: 'g', content: 'hi' } };
      const result = await executor.execute(action, makeEvent());
      expect(result.success).toBe(false);
      expect(result.error).toBe('sendQQ 未配置');
    });
  });

  describe('store_memory', () => {
    it('应存储记忆并渲染内容', async () => {
      const storeMemoryMock = vi.fn().mockResolvedValue(undefined);
      executor.setDeps({ storeMemory: storeMemoryMock });

      const action: TriggerAction = {
        type: 'store_memory',
        config: {
          memoryType: 'event',
          branch: 'chat',
          content: '玩家 {{event.payload.playerId}} 说: {{event.payload.message}}',
          importance: 8,
          tags: ['qq'],
        },
      };

      const result = await executor.execute(action, makeEvent());
      expect(result.success).toBe(true);
      expect(storeMemoryMock).toHaveBeenCalledWith('ws_001', {
        memoryType: 'event',
        branch: 'chat',
        content: '玩家 p1 说: hello world',
        importance: 8,
        tags: ['qq'],
      });
    });

    it('缺少 storeMemory 依赖应返回错误', async () => {
      const action: TriggerAction = { type: 'store_memory', config: { memoryType: 'event', content: 'hi' } };
      const result = await executor.execute(action, makeEvent());
      expect(result.success).toBe(false);
      expect(result.error).toBe('storeMemory 未配置');
    });
  });

  describe('none 与未知动作', () => {
    it('none 应直接成功', async () => {
      const result = await executor.execute({ type: 'none', config: {} }, makeEvent());
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ skipped: true });
    });

    it('未知动作类型应返回错误', async () => {
      const result = await executor.execute({ type: 'unknown' as any, config: {} }, makeEvent());
      expect(result.success).toBe(false);
      expect(result.error).toContain('未知动作类型');
    });
  });

  describe('模板渲染', () => {
    it('应支持嵌套路径', () => {
      const event = makeEvent({ payload: { player: { name: 'Alice', health: 5 } } });
      expect(executor.renderTemplate('{{event.payload.player.name}}', event)).toBe('Alice');
      expect(executor.renderTemplate('health: {{event.payload.player.health}}', event)).toBe('health: 5');
    });

    it('不存在的路径应渲染为空字符串', () => {
      expect(executor.renderTemplate('{{event.payload.missing}}', makeEvent())).toBe('');
    });

    it('非字符串输入应转为字符串', () => {
      expect(executor.renderTemplate(123 as any, makeEvent())).toBe('123');
      expect(executor.renderTemplate(true as any, makeEvent())).toBe('true');
    });
  });

  describe('异常处理', () => {
    it('动作执行异常应捕获并返回错误', async () => {
      executor.setDeps({
        sendQQ: vi.fn().mockRejectedValue(new Error('network error')),
      });
      const action: TriggerAction = { type: 'send_qq', config: { target: 'g', content: 'hi' } };
      const result = await executor.execute(action, makeEvent());
      expect(result.success).toBe(false);
      expect(result.error).toBe('network error');
    });
  });
});
