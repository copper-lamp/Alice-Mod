/**
 * 基础 Provider 抽象类
 *
 * 提供通用的 HTTP 请求发送、重试、超时控制、错误处理逻辑。
 * 所有具体 Provider（OpenAI / Claude / Gemini / Ollama）继承此类。
 */

import { getLLMObserver } from '../observer/llm-observer'
import type { ProviderConfig, LLMProvider, ProviderMetadata, LLMResponse, LLMChunk, Message, ChatOptions, ToolDefinition, HealthCheckResult } from '../types';

/** Provider 内部错误 */
export class ProviderError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly headers?: Record<string, string>;

  constructor(status: number, message: string, code: string = 'PROVIDER_ERROR', headers?: Record<string, string>) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

/**
 * 基础 Provider 抽象类
 */
export abstract class BaseProvider implements LLMProvider {
  abstract readonly metadata: ProviderMetadata;

  protected baseUrl: string;
  protected apiKey?: string;
  protected config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.config = config;
  }

  /**
   * 发送 HTTP 请求并处理响应
   * 内置重试逻辑和超时控制
   */
  protected async request<T>(
    path: string,
    body: unknown,
    options?: { timeout?: number; retryCount?: number },
  ): Promise<T> {
    const timeout = options?.timeout ?? this.config.timeout ?? 60000;
    const maxRetries = options?.retryCount ?? this.config.maxRetries ?? 3;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.getAuthHeaders(),
            ...this.config.headers,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw await this.parseErrorResponse(response);
        }

        return await response.json() as T;
      } catch (error: unknown) {
        lastError = error as Error;

        // 认证错误不重试
        if (error instanceof ProviderError) {
          if (error.status === 401 || error.status === 403) {
            throw error;
          }
          // 限流错误等待后重试
          if (error.status === 429 && attempt < maxRetries) {
            const retryAfter = parseInt(error.headers?.['retry-after'] || '5', 10);
            await this.delay(retryAfter * 1000);
            continue;
          }
        }

        // 最后一次尝试失败则抛出
        if (attempt === maxRetries) {
          throw error;
        }

        // 指数退避
        await this.delay(Math.min(1000 * Math.pow(2, attempt), 16000));
      }
    }

    throw lastError || new Error('Unexpected error');
  }

  /**
   * 流式请求
   * 返回 AsyncIterable，逐 chunk 处理
   */
  protected async *streamRequest(
    path: string,
    body: unknown,
    options?: { timeout?: number },
  ): AsyncIterable<string> {
    const timeout = options?.timeout ?? this.config.timeout ?? 60000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
          ...this.config.headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw await this.parseErrorResponse(response);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            yield line.slice(6);
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** 获取认证头（子类实现） */
  protected abstract getAuthHeaders(): Record<string, string>;

  /** 解析错误响应（子类实现） */
  protected abstract parseErrorResponse(response: Response): Promise<Error>;

  /**
   * 发送聊天请求（自动通过 LLM Observer 记录 Token 用量）
   */
  async chat(messages: Message[], tools?: ToolDefinition[], options?: ChatOptions): Promise<LLMResponse> {
    const observer = getLLMObserver()
    const model = options?.extra?.model as string || this.config.defaultModel
    return observer.wrap(this.metadata.id, model, () => this.doChat(messages, tools, options))
  }

  /** 子类实现具体的聊天请求逻辑 */
  protected abstract doChat(messages: Message[], tools?: ToolDefinition[], options?: ChatOptions): Promise<LLMResponse>;

  abstract chatStream(messages: Message[], tools?: ToolDefinition[], options?: ChatOptions): AsyncIterable<LLMChunk>;
  abstract healthCheck(): Promise<HealthCheckResult>;

  protected delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}