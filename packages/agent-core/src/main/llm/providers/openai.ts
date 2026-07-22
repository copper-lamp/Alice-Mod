/**
 * OpenAI Provider — 兼容 OpenAI / Azure OpenAI / DeepSeek 等 OpenAI 兼容 API
 */

import { BaseProvider, ProviderError } from './base-provider';
import type {
  ProviderMetadata, LLMResponse, LLMChunk, Message, ChatOptions, ToolDefinition, HealthCheckResult, AssistantMessage, ToolCallContent, TextContent, ImageContent, MessageContent,
} from '../types';

export class OpenAIProvider extends BaseProvider {
  readonly metadata: ProviderMetadata = {
    id: 'openai',
    displayName: 'OpenAI',
    supportedModels: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'gpt-4.1', 'gpt-4.1-mini'],
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsEmbedding: true,
    version: '1.0.0',
  };

  protected getAuthHeaders(): Record<string, string> {
    return { 'Authorization': `Bearer ${this.apiKey}` };
  }

  protected parseErrorResponse(response: Response): Promise<Error> {
    return response.json().then((data: any) => {
      const msg = data?.error?.message || `HTTP ${response.status}`;
      const code = data?.error?.code || 'OPENAI_ERROR';
      return new ProviderError(response.status, msg, code, {
        'retry-after': response.headers.get('retry-after') || '',
      });
    }).catch(() => {
      return new ProviderError(response.status, `HTTP ${response.status}`, 'OPENAI_ERROR');
    });
  }

  async doChat(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    const body = this.buildRequestBody(messages, tools, options);
    const data = await this.request<any>('/chat/completions', body, {
      timeout: options?.timeout,
      retryCount: options?.retryCount,
    });

    const choice = data.choices?.[0];
    if (!choice) {
      throw new ProviderError(500, 'Missing choices in response', 'INVALID_RESPONSE');
    }

    return {
      message: {
        role: 'assistant',
        content: choice.message?.content || '',
        tool_calls: this.parseToolCalls(choice.message?.tool_calls),
      },
      // V35: 捕获 DeepSeek 等模型的 reasoning_content（思考过程）
      thinking: choice.message?.reasoning_content || undefined,
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
        cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens,
      },
      model: data.model,
      requestId: data.id,
      durationMs: Date.now() - startTime,
      truncated: choice.finish_reason === 'length',
      finishReason: this.mapFinishReason(choice.finish_reason),
    };
  }

  async *chatStream(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): AsyncIterable<LLMChunk> {
    const body = this.buildRequestBody(messages, tools, { ...options, stream: true });

    for await (const line of this.streamRequest('/chat/completions', body)) {
      if (line === '[DONE]') {
        yield { content: '', isLast: true, finishReason: 'stop' };
        break;
      }

      const data = JSON.parse(line);
      const delta = data.choices?.[0]?.delta;
      const finishReason = data.choices?.[0]?.finish_reason;

      if (finishReason) {
        yield {
          content: delta?.content || '',
          thinking: delta?.reasoning_content || undefined,
          toolCallDelta: delta?.tool_calls?.[0]?.function?.arguments,
          isLast: true,
          finishReason: this.mapFinishReason(finishReason),
        };
      } else {
        yield {
          content: delta?.content || '',
          thinking: delta?.reasoning_content || undefined,
          toolCallDelta: delta?.tool_calls?.[0]?.function?.arguments,
          isLast: false,
        };
      }
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      await this.request('/models', undefined, { timeout: 5000 });
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
    return {
      model: options?.extra?.model || this.config.defaultModel,
      messages: this.convertMessages(messages),
      tools: tools?.length ? this.convertTools(tools) : undefined,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
      top_p: options?.topP ?? 1.0,
      stop: options?.stop,
      stream: options?.stream ?? false,
    };
  }

  private convertMessages(messages: Message[]): unknown[] {
    return messages.map(m => {
      if (m.role === 'system' && typeof m.content === 'string') {
        return { role: 'system', content: m.content };
      }
      if (m.role === 'user') {
        return {
          role: 'user',
          content: typeof m.content === 'string'
            ? m.content
            : this.convertContentParts(m.content),
        };
      }
      if (m.role === 'assistant') {
        const msg: Record<string, unknown> = { role: 'assistant', content: typeof m.content === 'string' ? m.content : '' };
        const assistantMsg = m as AssistantMessage;
        if (assistantMsg.tool_calls?.length) {
          msg.tool_calls = assistantMsg.tool_calls.map(tc => ({
            id: tc.toolCallId,
            type: 'function',
            function: { name: tc.toolName, arguments: JSON.stringify(tc.arguments) },
          }));
        }
        return msg;
      }
      if (m.role === 'tool') {
        return { role: 'tool', tool_call_id: m.tool_call_id ?? '', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) };
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

  private parseToolCalls(toolCalls?: any[]): ToolCallContent[] | undefined {
    if (!toolCalls?.length) return undefined;
    return toolCalls.map(tc => ({
      type: 'tool_call' as const,
      toolCallId: tc.id,
      toolName: tc.function.name,
      arguments: typeof tc.function.arguments === 'string'
        ? JSON.parse(tc.function.arguments)
        : tc.function.arguments,
    }));
  }

  private convertContentParts(content: MessageContent[]): unknown[] {
    return content.map(c => {
      if (c.type === 'text') return { type: 'text', text: (c as TextContent).text };
      if (c.type === 'image') {
        const img = c as ImageContent;
        return { type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } };
      }
      return c;
    });
  }

  private mapFinishReason(reason: string): 'stop' | 'length' | 'tool_calls' | 'error' {
    switch (reason) {
      case 'stop': return 'stop';
      case 'length': return 'length';
      case 'tool_calls': return 'tool_calls';
      default: return 'error';
    }
  }
}