/**
 * Claude Provider — Anthropic Messages API
 */

import { BaseProvider, ProviderError } from './base-provider';
import type {
  ProviderMetadata, LLMResponse, LLMChunk, Message, ChatOptions, ToolDefinition, HealthCheckResult, AssistantMessage, ToolCallContent, TextContent, ImageContent,
} from '../types';

export class ClaudeProvider extends BaseProvider {
  readonly metadata: ProviderMetadata = {
    id: 'claude',
    displayName: 'Claude (Anthropic)',
    supportedModels: [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-opus-4-20250514',
      'claude-sonnet-4-20250514',
    ],
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsEmbedding: false,
    version: '1.0.0',
  };

  private apiVersion: string;

  constructor(config: import('../types').ProviderConfig) {
    super(config);
    this.apiVersion = config.apiVersion || '2023-06-01';
  }

  protected getAuthHeaders(): Record<string, string> {
    return {
      'x-api-key': this.apiKey!,
      'anthropic-version': this.apiVersion,
    };
  }

  protected parseErrorResponse(response: Response): Promise<Error> {
    return response.json().then((data: any) => {
      const msg = data?.error?.message || `HTTP ${response.status}`;
      const type = data?.error?.type || 'CLAUDE_ERROR';
      return new ProviderError(response.status, msg, type, {
        'retry-after': response.headers.get('retry-after') || '',
      });
    }).catch(() => {
      return new ProviderError(response.status, `HTTP ${response.status}`, 'CLAUDE_ERROR');
    });
  }

  async doChat(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    const body = this.buildRequestBody(messages, tools, options);
    const data = await this.request('/messages', body, {
      timeout: options?.timeout,
      retryCount: options?.retryCount,
    });

    return this.parseResponse(data, startTime);
  }

  async *chatStream(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): AsyncIterable<LLMChunk> {
    const body = this.buildRequestBody(messages, tools, { ...options, stream: true });

    for await (const line of this.streamRequest('/messages', body)) {
      const event = this.parseSSEEvent(line);
      if (!event) continue;

      switch (event.type) {
        case 'content_block_delta':
          if (event.delta?.type === 'text_delta') {
            yield { content: event.delta.text, isLast: false };
          } else if (event.delta?.type === 'input_json_delta') {
            yield { content: '', toolCallDelta: event.delta.partial_json, isLast: false };
          }
          break;
        case 'message_delta':
          if (event.delta?.stop_reason) {
            yield {
              content: '',
              isLast: true,
              finishReason: this.mapStopReason(event.delta.stop_reason),
              usage: event.usage ? {
                promptTokens: event.usage.input_tokens || 0,
                completionTokens: event.usage.output_tokens || 0,
                totalTokens: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0),
              } : undefined,
            };
          }
          break;
        case 'message_stop':
          yield { content: '', isLast: true, finishReason: 'stop' };
          break;
        case 'error':
          yield { content: '', isLast: true, finishReason: 'error' };
          break;
      }
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      const body = {
        model: this.config.defaultModel,
        max_tokens: 10,
        messages: [{ role: 'user' as const, content: 'ping' }],
      };
      await this.request('/messages', body, { timeout: 5000 });
      return {
        available: true,
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

  private buildRequestBody(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions & { stream?: boolean },
  ): Record<string, unknown> {
    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');

    return {
      model: options?.extra?.model || this.config.defaultModel,
      system: typeof systemMsg?.content === 'string' ? systemMsg.content : undefined,
      messages: this.convertMessages(nonSystemMsgs),
      tools: tools?.length ? this.convertTools(tools) : undefined,
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      top_p: options?.topP ?? 1.0,
      stop_sequences: options?.stop,
      stream: options?.stream ?? false,
    };
  }

  private convertMessages(messages: Message[]): unknown[] {
    return messages.map(m => {
      if (m.role === 'user') {
        return {
          role: 'user',
          content: typeof m.content === 'string'
            ? m.content
            : this.convertContentParts(m.content),
        };
      }
      if (m.role === 'assistant') {
        const msg: Record<string, unknown> = { role: 'assistant' };
        const assistantMsg = m as AssistantMessage;
        const toolCalls = assistantMsg.tool_calls;

        if (toolCalls?.length) {
          const parts: unknown[] = [];
          if (typeof m.content === 'string' && m.content) {
            parts.push({ type: 'text', text: m.content });
          }
          parts.push(...toolCalls.map(tc => ({
            type: 'tool_use' as const,
            id: tc.toolCallId,
            name: tc.toolName,
            input: tc.arguments,
          })));
          msg.content = parts;
        } else {
          msg.content = typeof m.content === 'string' ? m.content : '';
        }
        return msg;
      }
      if (m.role === 'tool') {
        return {
          role: 'user',
          content: [{
            type: 'tool_result' as const,
            tool_use_id: m.tool_call_id ?? '',
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            is_error: false,
          }],
        };
      }
      return m;
    });
  }

  private convertTools(tools: ToolDefinition[]): unknown[] {
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));
  }

  private parseResponse(data: any, startTime: number): LLMResponse {
    const content = data.content || [];
    const textContent = content.find((c: any) => c.type === 'text');
    const toolUseContent = content.filter((c: any) => c.type === 'tool_use');

    return {
      message: {
        role: 'assistant',
        content: textContent?.text || '',
        tool_calls: toolUseContent.length > 0
          ? toolUseContent.map((tc: any) => ({
            type: 'tool_call' as const,
            toolCallId: tc.id,
            toolName: tc.name,
            arguments: tc.input,
          }))
          : undefined,
      },
      usage: {
        promptTokens: data.usage?.input_tokens || 0,
        completionTokens: data.usage?.output_tokens || 0,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
        cachedTokens: data.usage?.cache_creation_input_tokens || data.usage?.cache_read_input_tokens,
      },
      model: data.model,
      requestId: data.id,
      durationMs: Date.now() - startTime,
      truncated: data.stop_reason === 'max_tokens',
      finishReason: this.mapStopReason(data.stop_reason),
    };
  }

  private parseSSEEvent(line: string): { type: string; delta?: any; usage?: any } | null {
    if (!line.trim()) return null;

    // Anthropic SSE 格式: data: {...}
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }

  private convertContentParts(content: import('../types').MessageContent[]): unknown[] {
    return content.map(c => {
      if (c.type === 'text') return { type: 'text', text: (c as TextContent).text };
      if (c.type === 'image') {
        const img = c as ImageContent;
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.mimeType,
            data: img.data,
          },
        };
      }
      return c;
    });
  }

  private mapStopReason(reason: string): 'stop' | 'length' | 'tool_calls' | 'error' {
    switch (reason) {
      case 'end_turn': return 'stop';
      case 'max_tokens': return 'length';
      case 'tool_use': return 'tool_calls';
      case 'stop_sequence': return 'stop';
      default: return 'error';
    }
  }
}