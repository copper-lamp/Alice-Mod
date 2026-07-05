/**
 * Claude Provider 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaudeProvider } from '../../../src/main/llm/providers/claude';
import type { ProviderConfig } from '../../../src/main/llm/types';

describe('ClaudeProvider', () => {
  let provider: ClaudeProvider;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new ClaudeProvider({
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-ant-test',
      defaultModel: 'claude-3-5-sonnet-20241022',
      apiVersion: '2023-06-01',
      timeout: 30000,
      maxRetries: 2,
    } as ProviderConfig);

    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('metadata', () => {
    it('应正确设置元数据', () => {
      expect(provider.metadata.id).toBe('claude');
      expect(provider.metadata.supportsEmbedding).toBe(false);
      expect(provider.metadata.supportsFunctionCalling).toBe(true);
    });
  });

  describe('chat()', () => {
    const mockResponse = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      model: 'claude-3-5-sonnet-20241022',
      content: [{ type: 'text', text: 'Hello from Claude!' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    };

    it('应成功发送聊天请求并解析响应', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await provider.chat([{ role: 'user', content: 'Hi' }]);
      expect(result.message.content).toBe('Hello from Claude!');
      expect(result.model).toBe('claude-3-5-sonnet-20241022');
      expect(result.finishReason).toBe('stop');
    });

    it('应正确构建包含 system 消息的请求体', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await provider.chat([
        { role: 'system', content: 'You are Claude' },
        { role: 'user', content: 'Hi' },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.system).toBe('You are Claude');
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe('user');
    });

    it('应解析工具调用响应', async () => {
      const toolResponse = {
        ...mockResponse,
        content: [
          { type: 'text', text: 'Getting weather...' },
          { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Beijing' } },
        ],
        stop_reason: 'tool_use',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(toolResponse),
      });

      const result = await provider.chat([{ role: 'user', content: 'Weather?' }]);
      expect(result.message.tool_calls).toHaveLength(1);
      expect(result.message.tool_calls![0].toolName).toBe('get_weather');
      expect(result.message.tool_calls![0].arguments.city).toBe('Beijing');
      expect(result.finishReason).toBe('tool_calls');
    });

    it('应解析 cache tokens', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          ...mockResponse,
          usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 50 },
        }),
      });

      const result = await provider.chat([{ role: 'user', content: 'Hi' }]);
      expect(result.usage.cachedTokens).toBe(50);
    });
  });

  describe('chatStream()', () => {
    it('应正确解析 SSE 流式事件', async () => {
      const events = [
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":10,"output_tokens":5}}',
        'data: {"type":"message_stop"}',
      ];

      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(events.join('\n') + '\n') })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };

      mockFetch.mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const chunks: any[] = [];
      for await (const chunk of provider.chatStream([{ role: 'user', content: 'Hi' }])) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(4);
      expect(chunks[0].content).toBe('Hello');
      expect(chunks[1].content).toBe(' world');
      // message_delta 带 stop_reason 的 chunk
      expect(chunks[2].isLast).toBe(true);
      // message_stop 的 chunk
      expect(chunks[3].isLast).toBe(true);
    });

    it('应解析 input_json_delta', async () => {
      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"Bei"}}\n'),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };

      mockFetch.mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const chunks: any[] = [];
      for await (const chunk of provider.chatStream([{ role: 'user', content: 'Weather?' }])) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0].toolCallDelta).toBeDefined();
    });

    it('error 事件应生成 error finishReason', async () => {
      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: {"type":"error"}\n') })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };

      mockFetch.mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const chunks: any[] = [];
      for await (const chunk of provider.chatStream([{ role: 'user', content: 'Hi' }])) {
        chunks.push(chunk);
      }

      expect(chunks[0].isLast).toBe(true);
      expect(chunks[0].finishReason).toBe('error');
    });
  });

  describe('healthCheck()', () => {
    it('健康时应返回 available=true', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'msg_ping' }),
      });

      const result = await provider.healthCheck();
      expect(result.available).toBe(true);
    });
  });
});