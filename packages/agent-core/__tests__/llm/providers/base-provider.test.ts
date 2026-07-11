/**
 * BaseProvider 抽象类测试
 *
 * 测试通用的 HTTP 请求发送、重试、超时控制、错误处理逻辑。
 * 使用具体的 Provider 实现（OpenAIProvider）来测试抽象类行为。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseProvider, ProviderError } from '../../../src/main/llm/providers/base-provider';
import type { ProviderConfig, LLMResponse, LLMChunk, Message, ChatOptions, ToolDefinition, HealthCheckResult, ProviderMetadata } from '../../../src/main/llm/types';

// 一个具体的测试用 Provider 实现
class TestProvider extends BaseProvider {
  readonly metadata: ProviderMetadata = {
    id: 'test', displayName: 'Test', supportedModels: ['test-model'],
    supportsStreaming: true, supportsFunctionCalling: true,
    supportsEmbedding: false, version: '1.0',
  };

  protected getAuthHeaders(): Record<string, string> {
    return { Authorization: 'Bearer test-key' };
  }

  protected parseErrorResponse(response: Response): Promise<Error> {
    const headers: Record<string, string> = {};
    try {
      // 尝试从 mock 或真实 response 中提取 headers
      const h = response.headers as any;
      if (h && typeof h === 'object') {
        if (typeof h.get === 'function') {
          const keys = ['retry-after', 'retry_after'];
          for (const key of keys) {
            const val = h.get(key);
            if (val) headers[key] = val;
          }
        } else {
          Object.assign(headers, h);
        }
      }
    } catch { /* ignore */ }
    return response.json().then((data: any) => {
      return new ProviderError(response.status, data?.error?.message || `HTTP ${response.status}`, 'TEST_ERROR', headers);
    }).catch(() => {
      return new ProviderError(response.status, `HTTP ${response.status}`, 'TEST_ERROR', headers);
    });
  }

  async doChat(messages: Message[], _tools?: ToolDefinition[], _options?: ChatOptions): Promise<LLMResponse> {
    return this.request('/chat', { messages });
  }

  async *chatStream(_messages: Message[], _tools?: ToolDefinition[], _options?: ChatOptions): AsyncIterable<LLMChunk> {
    yield { content: 'test', isLast: true, finishReason: 'stop' };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return { available: true, latencyMs: 0, model: 'test-model' };
  }
}

describe('ProviderError', () => {
  it('应正确设置错误属性', () => {
    const err = new ProviderError(429, 'Rate limited', 'RATE_LIMIT', { 'retry-after': '5' });
    expect(err.status).toBe(429);
    expect(err.message).toBe('Rate limited');
    expect(err.code).toBe('RATE_LIMIT');
    expect(err.headers!['retry-after']).toBe('5');
    expect(err.name).toBe('ProviderError');
  });

  it('应使用默认错误码', () => {
    const err = new ProviderError(500, 'Server error');
    expect(err.code).toBe('PROVIDER_ERROR');
  });

  it('headers 应为可选', () => {
    const err = new ProviderError(401, 'Unauthorized');
    expect(err.headers).toBeUndefined();
  });
});

describe('BaseProvider', () => {
  let provider: TestProvider;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new TestProvider({
      baseUrl: 'https://api.test.com/v1',
      apiKey: 'test-key',
      defaultModel: 'test-model',
      timeout: 10000,
      maxRetries: 2,
    } as ProviderConfig);

    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('request() - 基础请求', () => {
    it('应成功发送 POST 请求并解析 JSON 响应', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'ok' }),
      });

      const result = await provider['request']('/chat', { messages: [] });
      expect(result).toEqual({ result: 'ok' });

      // 验证请求参数
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe('https://api.test.com/v1/chat');
      expect(callArgs[1].method).toBe('POST');
      expect(callArgs[1].headers['Authorization']).toBe('Bearer test-key');
    });

    it('应移除 baseUrl 末尾多余的斜杠', () => {
      const p = new TestProvider({
        baseUrl: 'https://api.test.com/v1/',
        apiKey: 'key',
        defaultModel: 'm',
      } as ProviderConfig);
      expect(p['baseUrl']).toBe('https://api.test.com/v1');
    });
  });

  describe('request() - 认证错误不重试', () => {
    it('401 错误不应重试', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { message: 'Unauthorized', code: '401' } }),
      });

      await expect(provider['request']('/chat', {})).rejects.toThrow(ProviderError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('403 错误不应重试', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: { message: 'Forbidden', code: '403' } }),
      });

      await expect(provider['request']('/chat', {})).rejects.toThrow(ProviderError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('request() - 重试逻辑', () => {
    it('429 限流错误应等待后重试', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: { 'retry-after': '0' } as any,
          json: () => Promise.resolve({ error: { message: 'Rate limited' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ result: 'ok' }),
        });

      const result = await provider['request']('/chat', {});
      expect(result).toEqual({ result: 'ok' });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('5xx 错误应重试（指数退避）', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false, status: 500,
          json: () => Promise.resolve({ error: { message: 'Server Error' } }),
        })
        .mockResolvedValueOnce({
          ok: false, status: 500,
          json: () => Promise.resolve({ error: { message: 'Server Error' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ result: 'ok' }),
        });

      const result = await provider['request']('/chat', {}, { retryCount: 2 });
      expect(result).toEqual({ result: 'ok' });
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('超过重试次数应抛出最后一次错误', async () => {
      mockFetch.mockResolvedValue({
        ok: false, status: 500,
        json: () => Promise.resolve({ error: { message: 'Server Error' } }),
      });

      await expect(provider['request']('/chat', {}, { retryCount: 0 })).rejects.toThrow(ProviderError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('request() - 超时控制', () => {
    it('超时应抛出错误', async () => {
      mockFetch.mockImplementation(async (_url: string, options: any) => {
        // Return a promise that never resolves, letting the timeout abort it
        return new Promise((_, reject) => {
          const timeout = setTimeout(() => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          }, 50);
          // If the signal aborts, reject immediately
          if (options?.signal) {
            options.signal.addEventListener('abort', () => {
              clearTimeout(timeout);
              reject(new DOMException('The operation was aborted', 'AbortError'));
            });
          }
        });
      });

      await expect(provider['request']('/chat', {}, { timeout: 50 })).rejects.toThrow();
    });
  });

  describe('streamRequest() - 流式请求', () => {
    it('应正确解析 SSE 数据流', async () => {
      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: {"text":"hello"}\ndata: {"text":"world"}\n') })
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: [DONE]\n') })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };

      const mockStream = { getReader: () => mockReader } as any;

      mockFetch.mockResolvedValue({
        ok: true,
        body: mockStream,
      });

      const chunks: string[] = [];
      for await (const line of provider['streamRequest']('/chat', {})) {
        chunks.push(line);
      }

      expect(chunks).toEqual(['{"text":"hello"}', '{"text":"world"}', '[DONE]']);
    });

    it('流式请求失败应抛出错误', async () => {
      mockFetch.mockResolvedValue({
        ok: false, status: 500,
        json: () => Promise.resolve({ error: { message: 'Stream error' } }),
      });

      const iter = provider['streamRequest']('/chat', {});
      await expect(iter.next()).rejects.toThrow();
    });
  });

  describe('delay()', () => {
    it('应创建延迟 Promise', async () => {
      vi.useFakeTimers();
      const promise = provider['delay'](100);
      vi.advanceTimersByTime(100);
      await promise;
      vi.useRealTimers();
    });
  });
});