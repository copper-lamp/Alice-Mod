/**
 * Ollama Provider — 本地 Ollama 部署模型
 */

import { BaseProvider, ProviderError } from './base-provider';
import type {
  ProviderMetadata, LLMResponse, LLMChunk, Message, ChatOptions, ToolDefinition, HealthCheckResult, AssistantMessage, ToolCallContent,
} from '../types';

export class OllamaProvider extends BaseProvider {
  readonly metadata: ProviderMetadata = {
    id: 'ollama',
    displayName: 'Ollama (Local)',
    supportedModels: [],
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsEmbedding: false,
    version: '1.0.0',
  };

  constructor(config: import('../types').ProviderConfig) {
    super(config);
    this.refreshModels();
  }

  protected getAuthHeaders(): Record<string, string> {
    return {};
  }

  protected parseErrorResponse(response: Response): Promise<Error> {
    return response.json().then((data: any) => {
      const msg = data?.error || `HTTP ${response.status}`;
      return new ProviderError(response.status, msg, 'OLLAMA_ERROR');
    }).catch(() => {
      return new ProviderError(response.status, `HTTP ${response.status}`, 'OLLAMA_ERROR');
    });
  }

  async doChat(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    const body = this.buildRequestBody(messages, tools, options);
    const data = await this.request<any>('/api/chat', body, {
      timeout: options?.timeout,
      retryCount: options?.retryCount,
    });

    return {
      message: {
        role: 'assistant',
        content: data.message?.content || '',
        tool_calls: data.message?.tool_calls?.map((tc: any) => ({
          type: 'tool_call' as const,
          toolCallId: `${tc.function.name}_${startTime}`,
          toolName: tc.function.name,
          arguments: typeof tc.function.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : tc.function.arguments || {},
        })) as ToolCallContent[] | undefined,
      },
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
      model: data.model,
      requestId: '',
      durationMs: Date.now() - startTime,
      truncated: false,
      finishReason: data.done ? 'stop' : 'error',
    };
  }

  async *chatStream(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): AsyncIterable<LLMChunk> {
    const body = this.buildRequestBody(messages, tools, { ...options, stream: true });

    for await (const line of this.streamRequest('/api/chat', body)) {
      if (!line.trim()) continue;
      const data = JSON.parse(line);

      yield {
        content: data.message?.content || '',
        toolCallDelta: data.message?.tool_calls?.[0]?.function?.arguments,
        isLast: data.done || false,
        finishReason: data.done ? 'stop' : undefined,
      };
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const data = await response.json() as { models: Array<{ name: string }> };
        this.metadata.supportedModels = data.models?.map(m => m.name) || [];
      }
      return {
        available: response.ok,
        latencyMs: Date.now() - startTime,
        model: this.config.defaultModel,
      };
    } catch (e: unknown) {
      return {
        available: false,
        latencyMs: Date.now() - startTime,
        model: this.config.defaultModel,
        error: (e as Error).message,
      };
    }
  }

  private async refreshModels(): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        const data = await response.json() as { models: Array<{ name: string }> };
        this.metadata.supportedModels = data.models?.map(m => m.name) || [];
      }
    } catch {
      // 首次获取失败不影响初始化
    }
  }

  private buildRequestBody(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions & { stream?: boolean },
  ): Record<string, unknown> {
    return {
      model: options?.extra?.model || this.config.defaultModel,
      messages: this.convertMessages(messages),
      tools: tools?.length ? this.convertTools(tools) : undefined,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens ?? 4096,
        top_p: options?.topP ?? 1.0,
        stop: options?.stop,
      },
      stream: options?.stream ?? false,
    };
  }

  private convertMessages(messages: Message[]): unknown[] {
    return messages.map(m => {
      if (m.role === 'system' && typeof m.content === 'string') {
        return { role: 'system', content: m.content };
      }
      if (m.role === 'user') {
        return { role: 'user', content: typeof m.content === 'string' ? m.content : '' };
      }
      if (m.role === 'assistant') {
        const msg: Record<string, unknown> = { role: 'assistant', content: typeof m.content === 'string' ? m.content : '' };
        const assistantMsg = m as AssistantMessage;
        if (assistantMsg.tool_calls?.length) {
          msg.tool_calls = assistantMsg.tool_calls.map(tc => ({
            type: 'function',
            function: { name: tc.toolName, arguments: tc.arguments },
          }));
        }
        return msg;
      }
      if (m.role === 'tool') {
        return { role: 'tool', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) };
      }
      return m;
    });
  }

  private convertTools(tools: ToolDefinition[]): unknown[] {
    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }
}