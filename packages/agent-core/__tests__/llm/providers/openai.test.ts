/**
 * OpenAI Provider 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../../../src/main/llm/providers/openai';
import type { Message, AssistantMessage, ToolDefinition, ProviderConfig, LLMResponse } from '../../../src/main/llm/types';

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new OpenAIProvider({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      defaultModel: 'gpt-4o',
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
      expect(provider.metadata.id).toBe('openai');
      expect(provider.metadata.supportsStreaming).toBe(true);
      expect(provider.metadata.supportsFunctionCalling).toBe(true);
      expect(provider.metadata.supportsEmbedding).toBe(true);
      expect(provider.metadata.supportedModels).toContain('gpt-4o');
    });
  });

  describe('chat()', () => {
    const mockSuccessResponse = {
      id: 'chatcmpl-123',
      model: 'gpt-4o',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Hello!' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };

    it('应成功发送聊天请求并解析响应', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSuccessResponse),
      });

      const result = await provider.chat([{ role: 'user', content: 'Hi' }]);
      expect(result.message.content).toBe('Hello!');
      expect(result.usage.totalTokens).toBe(15);
      expect(result.model).toBe('gpt-4o');
      expect(result.finishReason).toBe('stop');
    });

    it('应正确构建包含工具的请求体', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSuccessResponse),
      });

      const tools: ToolDefinition[] = [{
        name: 'get_weather',
        description: 'Get weather',
        input_schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
      }];

      await provider.chat([{ role: 'user', content: 'Weather?' }], tools);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].function.name).toBe('get_weather');
    });

    it('应解析工具调用响应', async () => {
      const toolCallResponse = {
        id: 'chatcmpl-456',
        model: 'gpt-4o',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"Beijing"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 15, completion_tokens: 10, total_tokens: 25 },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(toolCallResponse),
      });

      const result = await provider.chat([{ role: 'user', content: 'Weather?' }]);
      expect(result.message.tool_calls).toHaveLength(1);
      expect(result.message.tool_calls![0].toolName).toBe('get_weather');
      expect(result.message.tool_calls![0].arguments.city).toBe('Beijing');
      expect(result.finishReason).toBe('tool_calls');
    });

    it('缺失 choices 时应抛出错误', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await expect(provider.chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow('Missing choices in response');
    });

    it('truncated 标志应正确设置', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          ...mockSuccessResponse,
          choices: [{ ...mockSuccessResponse.choices[0], finish_reason: 'length' }],
        }),
      });

      const result = await provider.chat([{ role: 'user', content: 'Hi' }]);
      expect(result.truncated).toBe(true);
      expect(result.finishReason).toBe('length');
    });

    it('cachedTokens 应正确解析', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          ...mockSuccessResponse,
          usage: {
            ...mockSuccessResponse.usage,
            prompt_tokens_details: { cached_tokens: 50 },
          },
        }),
      });

      const result = await provider.chat([{ role: 'user', content: 'Hi' }]);
      expect(result.usage.cachedTokens).toBe(50);
    });
  });

  describe('convertMessages', () => {
    it('应正确处理 system 类型消息', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: '1', model: 'gpt-4o',
          choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }),
      });

      await provider.chat([{ role: 'system', content: 'You are a bot' }, { role: 'user', content: 'Hi' }]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[0].content).toBe('You are a bot');
    });

    it('应正确处理 tool 类型消息', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: '1', model: 'gpt-4o',
          choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }),
      });

      const toolMsg: Message = {
        role: 'tool',
        content: [{ type: 'tool_call', toolCallId: 'call_1', toolName: 'get_weather', arguments: {} } as any],
      };

      await provider.chat([toolMsg]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].role).toBe('tool');
    });

    it('应处理 assistant 消息中的 tool_calls', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: '1', model: 'gpt-4o',
          choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }),
      });

      const assistantMsg: AssistantMessage = {
        role: 'assistant',
        content: 'Let me check',
        tool_calls: [{ type: 'tool_call', toolCallId: 'call_1', toolName: 'get_weather', arguments: { city: 'Beijing' } }],
      };

      await provider.chat([assistantMsg]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].tool_calls).toHaveLength(1);
    });
  });

  describe('healthCheck()', () => {
    it('健康时应返回 available=true', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'gpt-4o' }] }),
      });

      const result = await provider.healthCheck();
      expect(result.available).toBe(true);
    });

    it('不健康时应返回 available=false', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await provider.healthCheck();
      expect(result.available).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('chatStream()', () => {
    it('应正确解析流式响应', async () => {
      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n'),
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}\n'),
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: [DONE]\n'),
          })
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

      expect(chunks).toHaveLength(3);
      expect(chunks[0].content).toBe('Hello');
      expect(chunks[1].content).toBe(' world');
      expect(chunks[2].isLast).toBe(true);
    });

    it('流式请求失败应抛出错误', async () => {
      mockFetch.mockResolvedValue({
        ok: false, status: 500,
        json: () => Promise.resolve({ error: { message: 'Stream error' } }),
      });

      const iter = provider.chatStream([{ role: 'user', content: 'Hi' }]);
      await expect(iter.next()).rejects.toThrow();
    });
  });
});