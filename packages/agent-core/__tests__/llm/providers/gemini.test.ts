/**
 * Gemini Provider 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiProvider } from '../../../src/main/llm/providers/gemini';
import type { ProviderConfig } from '../../../src/main/llm/types';

describe('GeminiProvider', () => {
  let provider: GeminiProvider;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new GeminiProvider({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'gemini-key',
      defaultModel: 'gemini-2.0-flash',
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
      expect(provider.metadata.id).toBe('gemini');
      expect(provider.metadata.supportedModels).toContain('gemini-2.0-flash');
    });
  });

  const mockResponse = {
    candidates: [{
      content: { parts: [{ text: 'Hello from Gemini!' }], role: 'model' },
      finishReason: 'STOP',
    }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
  };

  describe('chat()', () => {
    it('应成功发送聊天请求并解析响应', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await provider.chat([{ role: 'user', content: 'Hi' }]);
      expect(result.message.content).toBe('Hello from Gemini!');
      expect(result.usage.totalTokens).toBe(15);
      expect(result.finishReason).toBe('stop');
    });

    it('应正确构建包含 systemInstruction 的请求体', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await provider.chat([
        { role: 'system', content: 'You are Gemini' },
        { role: 'user', content: 'Hi' },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.systemInstruction).toBeDefined();
      expect(body.systemInstruction.parts[0].text).toBe('You are Gemini');
    });

    it('应解析工具调用（functionCall）响应', async () => {
      const toolResponse = {
        candidates: [{
          content: {
            parts: [
              { functionCall: { name: 'get_weather', args: { city: 'Beijing' } } },
            ],
            role: 'model',
          },
          finishReason: 'STOP',
        }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
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

    it('MAX_TOKENS finishReason 应映射为 length', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          ...mockResponse,
          candidates: [{ ...mockResponse.candidates[0], finishReason: 'MAX_TOKENS' }],
        }),
      });

      const result = await provider.chat([{ role: 'user', content: 'Hi' }]);
      expect(result.truncated).toBe(true);
      expect(result.finishReason).toBe('length');
    });
  });

  describe('convertMessages', () => {
    it('应转换 tool 角色为 function 角色', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
        }),
      });

      await provider.chat([
        { role: 'user', content: 'Result' },
        { role: 'tool', content: [{ type: 'tool_call' as any, toolCallId: 'call_1', toolName: 'get_weather', result: { temp: 25 }, success: true }] },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // Gemini 将 tool 消息转为 function role
      expect(body.contents[1].role).toBe('function');
    });

    it('应转换 assistant tool_calls 为 functionCall', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
        }),
      });

      await provider.chat([{
        role: 'assistant',
        content: '',
        tool_calls: [{ type: 'tool_call', toolCallId: 'call_1', toolName: 'search', arguments: { q: 'test' } }],
      }]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.contents[0].parts[0].functionCall).toBeDefined();
      expect(body.contents[0].parts[0].functionCall.name).toBe('search');
    });
  });

  describe('healthCheck()', () => {
    it('健康时应返回 available=true', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await provider.healthCheck();
      expect(result.available).toBe(true);
    });
  });

  describe('chatStream()', () => {
    it('应正确解析流式响应', async () => {
      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(
              'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}],"role":"model"},"finishReason":null}]}\n' +
              'data: {"candidates":[{"content":{"parts":[{"text":" world"}],"role":"model"},"finishReason":"STOP"}]}\n',
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