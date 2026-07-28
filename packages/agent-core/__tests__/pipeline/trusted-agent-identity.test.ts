import { describe, expect, it, vi } from 'vitest';
import { BatchToolDispatcher } from '../../src/main/pipeline/batch-tool-dispatcher';
import { buildTrustedAgentIdentity, deriveBotName, identityProtocolFields } from '../../src/main/agent/agent-identity';
import type { ConnectionResolver } from '../../src/main/agent/connection-resolver';

const config = {
  name: '原始 名称',
  alias: 'Bot!Alias-LongerThan16',
  botUuid: 'uuid-trusted',
};

describe('可信 Agent 工具身份', () => {
  it('bot_name 与 Java 一致：alias 优先、非法字符替换、截断 16 字符', () => {
    expect(deriveBotName(config)).toBe('Bot_Alias_Longer');
  });

  it('协议允许未 bootstrap 的 bot_uuid 为 null', () => {
    const identity = buildTrustedAgentIdentity('agent-trusted', { name: 'BootstrapBot', alias: '', botUuid: undefined });
    expect(identityProtocolFields(identity)).toEqual({
      agent_id: 'agent-trusted', bot_name: 'BootstrapBot', bot_uuid: null,
    });
  });

  it('批调用在顶层携带可信身份且不受 parameters 同名字段影响', async () => {
    const sendRequestAndAwait = vi.fn().mockResolvedValue({
      jsonrpc: '2.0',
      id: 'response',
      result: [{
        success: false,
        error: {
          reason: 'BOT_DEAD',
          detail: 'dead waiting',
          details: { state: 'dead_waiting', respawn_in_ticks: 12 },
        },
        duration_ms: 2,
      }],
    });
    const resolver = {
      resolve: vi.fn().mockReturnValue({ sendRequestAndAwait }),
    } as unknown as ConnectionResolver;
    const dispatcher = new BatchToolDispatcher(
      resolver,
      () => buildTrustedAgentIdentity('agent-trusted', config),
    );

    const result = await dispatcher.executeBatch({
      level: 0,
      timeoutMs: 1000,
      calls: [{
        id: 'call-1',
        method: 'tool_call',
        params: {
          tool_name: 'move_to',
          parameters: {
            x: 1,
            agent_id: 'forged',
            bot_name: 'forged',
            bot_uuid: 'forged',
          },
        },
      }],
    }, 'ws-1');

    expect(sendRequestAndAwait).toHaveBeenCalledWith('tool_call_batch', expect.objectContaining({
      agent_id: 'agent-trusted',
      bot_name: 'Bot_Alias_Longer',
      bot_uuid: 'uuid-trusted',
      calls: [expect.objectContaining({
        parameters: expect.objectContaining({ agent_id: 'forged' }),
      })],
    }), expect.anything());
    expect(result.results[0]).toMatchObject({
      success: false,
      errorCode: 'BOT_DEAD',
      error: 'dead waiting',
      errorDetails: { state: 'dead_waiting', respawn_in_ticks: 12 },
    });
  });

  it('每次批调用重新读取可信身份 provider', async () => {
    const sendRequestAndAwait = vi.fn().mockResolvedValue({ jsonrpc: '2.0', id: 'response', result: [] });
    const resolver = { resolve: vi.fn().mockReturnValue({ sendRequestAndAwait }) } as unknown as ConnectionResolver;
    let botUuid: string | undefined;
    const dispatcher = new BatchToolDispatcher(resolver, () =>
      buildTrustedAgentIdentity('agent-trusted', { ...config, botUuid }),
    );
    const batch = { level: 0, timeoutMs: 1000, calls: [] };

    await dispatcher.executeBatch(batch, 'ws-1');
    botUuid = 'uuid-after-bootstrap';
    await dispatcher.executeBatch(batch, 'ws-1');

    expect(sendRequestAndAwait.mock.calls[0]![1]).toMatchObject({ bot_uuid: null });
    expect(sendRequestAndAwait.mock.calls[1]![1]).toMatchObject({ bot_uuid: 'uuid-after-bootstrap' });
  });
});
