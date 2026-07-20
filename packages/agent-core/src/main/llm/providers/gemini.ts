/**
 * Gemini Provider — Google Gemini API
 */

import { BaseProvider, ProviderError } from './base-provider';
import type {
  ProviderMetadata, LLMResponse, LLMChunk, Message, ChatOptions, ToolDefinition, HealthCheckResult, AssistantMessage, ToolCallContent, TextContent,
} from '../types';

export class GeminiProvider extends BaseProvider {
  readonly metadata: ProviderMetadata = {
    id: 'gemini',
    displayName: 'Gemini (Google)',
    supportedModels: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-pro'],
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsEmbedding: true,
    version: '1.0.0',
  };

  protected getAuthHeaders(): Record<string, string> {
    return { 'x-goog-api-key': this.apiKey! };
  }

  protected parseErrorResponse(response: Response): Promise<Error> {
    return response.json().then((data: any) => {
      const msg = data?.error?.message || `HTTP ${response.status}`;
      const code = data?.error?.code?.toString() || 'GEMINI_ERROR';
      return new ProviderError(response.status, msg, code, {
        'retry-after': response.headers.get('retry-after') || '',
      });
    }).catch(() => {
      return new ProviderError(response.status, `HTTP ${response.status}`, 'GEMINI_ERROR');
    });
  }

  async doChat(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    const model = (options?.extra?.model as string) || this.config.defaultModel;
    const body = this.buildRequestBody(messages, tools, options);
    const data = await this.request<any>(
      `/models/${model}:generateContent`,
      body,
      { timeout: options?.timeout, retryCount: options?.retryCount },
    );

    return this.parseResponse(data, model, startTime);
  }

  async *chatStream(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): AsyncIterable<LLMChunk> {
    const model = options?.extra?.model || this.config.defaultModel;
    const body = this.buildRequestBody(messages, tools, { ...options, stream: true });

    for await (const line of this.streamRequest(`/models/${model}:streamGenerateContent`, body)) {
      if (!line.trim()) continue;
      const data = JSON.parse(line);
      const candidate = data.candidates?.[0];
      if (!candidate) continue;

      const part = candidate.content?.parts?.[0];
      const finishReason = candidate.finishReason;

      if (finishReason) {
        yield {
          content: part?.text || '',
          isLast: true,
          finishReason: this.mapFinishReason(finishReason),
        };
      } else {
        yield {
          content: part?.text || '',
          toolCallDelta: part?.functionCall?.args ? JSON.stringify(part.functionCall.args) : undefined,
          isLast: false,
        };
      }
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      const model = this.config.defaultModel;
      await this.request(
        `/models/${model}:generateContent`,
        { contents: [{ parts: [{ text: 'ping' }] }] },
        { timeout: 5000 },
      );
      return {
        available: true,
        latencyMs: Date.now() - startTime,
        model,
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
    const body: Record<string, unknown> = {
      contents: this.convertMessages(messages),
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens ?? 4096,
        topP: options?.topP ?? 1.0,
        stopSequences: options?.stop,
      },
    };

    const systemInstruction = this.extractSystemMessage(messages);
    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    if (tools?.length) {
      body.tools = [{ function_declarations: this.convertTools(tools) }];
    }

    return body;
  }

  private convertMessages(messages: Message[]): unknown[] {
    return messages
      .filter(m => m.role !== 'system')
      .map(m => {
        const role = m.role === 'assistant' ? 'model' : 'user';
        const assistantMsg = m as AssistantMessage;
        const toolCalls = assistantMsg.tool_calls;

        if (toolCalls?.length) {
          const parts: unknown[] = [];
          if (typeof m.content === 'string' && m.content) {
            parts.push({ text: m.content });
          }
          parts.push(...toolCalls.map(tc => ({
            functionCall: { name: tc.toolName, args: tc.arguments },
          })));
          return { role, parts };
        }

        if (m.role === 'tool') {
          let parsedContent: unknown = {};
          try {
            parsedContent = typeof m.content === 'string' ? JSON.parse(m.content) : m.content;
          } catch { /* ignore parse errors */ }
          return {
            role: 'function',
            parts: [{
              functionResponse: {
                name: m.tool_call_id ?? '',
                response: parsedContent,
              },
            }],
          };
        }

        return {
          role,
          parts: typeof m.content === 'string'
            ? [{ text: m.content }]
            : this.convertContentParts(m.content),
        };
      });
  }

  private convertTools(tools: ToolDefinition[]): unknown[] {
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    }));
  }

  private parseResponse(data: any, model: string, startTime: number): LLMResponse {
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const textPart = parts.find((p: any) => p.text);
    const functionCalls = parts.filter((p: any) => p.functionCall);

    return {
      message: {
        role: 'assistant',
        content: textPart?.text || '',
        tool_calls: functionCalls.length > 0
          ? functionCalls.map((fc: any) => ({
            type: 'tool_call' as const,
            toolCallId: fc.functionCall.name,
            toolName: fc.functionCall.name,
            arguments: fc.functionCall.args || {},
          }))
          : undefined,
      },
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount || 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata?.totalTokenCount || 0,
      },
      model,
      requestId: '',
      durationMs: Date.now() - startTime,
      truncated: candidate?.finishReason === 'MAX_TOKENS',
      finishReason: this.mapFinishReason(candidate?.finishReason || ''),
    };
  }

  private extractSystemMessage(messages: Message[]): { parts: Array<{ text: string }> } | undefined {
    const systemMsg = messages.find(m => m.role === 'system');
    if (systemMsg && typeof systemMsg.content === 'string') {
      return { parts: [{ text: systemMsg.content }] };
    }
    return undefined;
  }

  private convertContentParts(content: import('../types').MessageContent[]): unknown[] {
    return content.map(c => {
      if (c.type === 'text') return { text: (c as TextContent).text };
      if (c.type === 'image') {
        return { text: '[Image]' }; // Gemini 支持图片但格式不同，简化处理
      }
      return c;
    });
  }

  private mapFinishReason(reason: string): 'stop' | 'length' | 'tool_calls' | 'error' {
    switch (reason) {
      case 'STOP': return 'stop';
      case 'MAX_TOKENS': return 'length';
      case 'TOOL_CALL': return 'tool_calls';
      default: return 'error';
    }
  }
}