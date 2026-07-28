import { describe, expect, it } from 'vitest';
import { PromptCompiler } from '../../src/main/prompt/compiler/prompt-compiler';
import type { AgentConfig } from '../../src/renderer/src/lib/types';

describe('PromptCompiler QQ 发送规范', () => {
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
});
