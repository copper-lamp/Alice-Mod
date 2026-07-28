import { afterEach, describe, expect, it } from 'vitest';
import { ToolCategory } from '@mcagent/shared';
import { PromptCompiler } from '../../src/main/prompt/compiler/prompt-compiler';
import { WorkspaceManager, resetWorkspaceManager, setWorkspaceManager } from '../../src/main/workspace';
import type { AgentConfig } from '../../src/renderer/src/lib/types';

describe('PromptCompiler QQ 发送规范', () => {
  afterEach(() => resetWorkspaceManager());

  it('QQ 提示词明确要求单次发送并允许完成后结束', () => {
    const prompt = PromptCompiler.compileQQ({
      id: 'qq-agent',
      name: 'QQAgent',
      workspaceId: 'missing-workspace',
    } as AgentConfig);

    expect(prompt).toContain('回复QQ用户必须使用 `qq_send`');
    expect(prompt).toContain('一次回复内容只发送一次');
    expect(prompt).toContain('任务已完成就停止调用工具并结束');
    expect(prompt).toContain('不能把普通文本当作QQ回复');
  });

  it('compileQQ 的工具描述只包含 local tools', () => {
    const workspaceManager = new WorkspaceManager(false);
    setWorkspaceManager(workspaceManager);
    const registry = workspaceManager.getToolRegistry();
    registry.register('ws-qq', [{
      name: 'adapter_game_tool',
      description: 'Adapter 游戏工具描述',
      category: ToolCategory.Movement,
      parameters: {},
    }]);
    registry.registerLocal('ws-qq', [{
      name: 'request_game_action',
      description: '本地委托工具描述',
      category: ToolCategory.QQ,
      parameters: {},
    }]);

    const prompt = PromptCompiler.compileQQ({
      id: 'qq-agent',
      name: 'QQAgent',
      workspaceId: 'ws-qq',
    } as AgentConfig);

    expect(prompt).toContain('request_game_action');
    expect(prompt).toContain('本地委托工具描述');
    expect(prompt).not.toContain('adapter_game_tool');
    expect(prompt).not.toContain('Adapter 游戏工具描述');
  });
});
