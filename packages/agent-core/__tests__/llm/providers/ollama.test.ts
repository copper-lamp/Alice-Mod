/**
 * Ollama Provider 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaProvider } from '../../../src/main/llm/providers/ollama';
import type { ProviderConfig } from '../../../src/main/llm/types';

describe('OllamaProvider', () => {
  let provider: OllamaProvider;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    // 初始化时不请求模型列表
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ models: [] }) });

    provider = new OllamaProvider({
      baseUrl: 'http://localhost:11434',
      defaultModel: 'qwen2.5:7b',
      timeout: 120000,
      maxRetries: 2,
    } as ProviderConfig);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('metadata', () => {
    it('应正确设置元数据', () => {
      expect(provider.metadata.id).toBe('ollama');
      expect(provider.metadata.supportsStreaming).toBe(true);
      expect(provider.metadata.supportsEmbedding).toBe(false);
    });
  });

  describe('chat()', () => {
    const mockResponse = {
      model: 'qwen2.5:7b',
      message: { role: 'assistant', content: 'Hello from Ollama!' },
      prompt_eval_count: 10,
      eval_count: 5,
      done: true,
    };

    it('应成功发送聊天请求并解析响应', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await provider.chat([{ role: 'user', content: 'Hi' }]);
      expect(result.message.content).toBe('Hello from Ollama!');
      expect(result.usage.totalTokens).toBe(15);
      expect(result.finishReason).toBe('stop');
    });

    it('应解析工具调用响应', async () => {
      const toolResponse = {
        ...mockResponse,
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{
            function: { name: 'get_weather', arguments: '{"city":"Beijing"}' },
          }],
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(toolResponse),
      });

      const result = await provider.chat([{ role: 'user', content: 'Weather?' }]);
      expect(result.message.tool_calls).toHaveLength(1);
      expect(result.message.tool_calls![0].toolName).toBe('get_weather');
      expect(result.message.tool_calls![0].arguments.city).toBe('Beijing');
    });

    it('请求体应包含 model 和 stream:false', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await provider.chat([{ role: 'user', content: 'Hi' }]);

      // 第 0 次调用是构造函数中的 refreshModels，第 1 次是 chat 请求
      const chatCall = mockFetch.mock.calls.find((c: any[]) => c[0]?.includes('/api/chat'));
      expect(chatCall).toBeDefined();
      const body = JSON.parse(chatCall![1].body);
      expect(body.model).toBe('qwen2.5:7b');
      expect(body.stream).toBe(false);
    });
  });

  describe('healthCheck()', () => {
    it('健康时应返回 available=true 并刷新模型列表', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [{ name: 'qwen2.5:7b' }, { name: 'llama3:8b' }] }),
      });

      const result = await provider.healthCheck();
      expect(result.available).toBe(true);
    });

    it('不健康时应返回 available=false', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

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
            value: new TextEncoder().encode(
              'data: {"message":{"content":"Hello"},"done":false}\ndata: {"message":{"content":" world"},"done":true}\n',
            ),
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

      expect(chunks).toHaveLength(2);
      expect(chunks[0].content).toBe('Hello');
      expect(chunks[1].content).toBe(' world');
      expect(chunks[1].isLast).toBe(true);
      expect(chunks[1].finishReason).toBe('stop');
    });
  });
});