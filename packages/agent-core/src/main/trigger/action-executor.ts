/**
 * ActionExecutor — 触发器动作执行器
 *
 * 根据触发器配置执行以下动作：
 * - create_task: 创建 V13 任务
 * - call_tool: 调用指定工具
 * - send_llm: 发送给 LLM 生成回复
 * - send_qq: 发送 QQ 消息
 * - store_memory: 存储记忆
 * - none: 空操作
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentEvent,
  EventTrigger,
  TriggerAction,
  ActionResult,
  ActionExecutorDeps,
  CreateTaskActionConfig,
  CallToolActionConfig,
  SendLLMActionConfig,
  SendQQActionConfig,
  StoreMemoryActionConfig,
} from './types';

export class ActionExecutor {
  private deps: ActionExecutorDeps;

  constructor(deps: ActionExecutorDeps = {}) {
    this.deps = deps;
  }

  setDeps(deps: ActionExecutorDeps): void {
    this.deps = deps;
  }

  /**
   * 执行触发器动作
   *
   * @param action 动作配置
   * @param event 触发事件
   * @param trigger 触发器实体（V20 新增，用于 send_llm 解析 targetAgentId）
   */
  async execute(action: TriggerAction, event: AgentEvent, trigger?: EventTrigger): Promise<ActionResult> {
    try {
      switch (action.type) {
        case 'create_task':
          return await this.executeCreateTask(action.config as CreateTaskActionConfig, event);
        case 'call_tool':
          return await this.executeCallTool(action.config as CallToolActionConfig, event);
        case 'send_llm':
          return await this.executeSendLLM(action.config as SendLLMActionConfig, event, trigger);
        case 'send_qq':
          return await this.executeSendQQ(action.config as SendQQActionConfig, event);
        case 'store_memory':
          return await this.executeStoreMemory(action.config as StoreMemoryActionConfig, event);
        case 'none':
          return { success: true, data: { skipped: true } };
        default:
          return { success: false, error: `未知动作类型: ${(action as TriggerAction).type}` };
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async executeCreateTask(config: CreateTaskActionConfig, event: AgentEvent): Promise<ActionResult> {
    if (!this.deps.taskManager) {
      return { success: false, error: 'TaskManager 未配置' };
    }

    const taskName = this.renderTemplate(config.name ?? `事件触发任务: ${event.type}`, event);
    const description = this.renderTemplate(config.description ?? `由 ${event.source} 事件 ${event.type} 触发`, event);

    const result = await this.deps.taskManager.create({
      workspaceId: event.workspaceId || 'global',
      name: taskName,
      description,
      type: config.taskType ?? 'simple',
      priority: config.priority ?? 'normal',
      action: config.action,
      tags: config.tags ?? ['event-triggered'],
      metadata: {
        ...(config.metadata ?? {}),
        triggerEventId: event.id,
        triggerEventType: event.type,
        triggerSource: event.source,
      },
    });

    return { success: true, data: { taskId: result.id } };
  }

  private async executeCallTool(config: CallToolActionConfig, event: AgentEvent): Promise<ActionResult> {
    if (!this.deps.callTool) {
      return { success: false, error: 'callTool 未配置' };
    }

    const parameters = this.renderObject(config.parameters ?? {}, event);
    const result = await this.deps.callTool(event.workspaceId || 'global', config.toolName, parameters);
    return { success: true, data: result };
  }

  private async executeSendLLM(
    config: SendLLMActionConfig,
    event: AgentEvent,
    trigger?: EventTrigger,
  ): Promise<ActionResult> {
    // V22 优先走 Orchestrator 路径
    if (this.deps.orchestratorProvider && this.deps.resolveTarget) {
      const resolved = this.deps.resolveTarget(config.target, event, trigger);
      if (!resolved) {
        return {
          success: false,
          error: `无法解析 send_llm target='${config.target}'（trigger=${trigger?.id ?? 'unknown'}）`,
        };
      }
      const orch = this.deps.orchestratorProvider(resolved);
      if (orch) {
        const prompt = this.renderTemplate(config.prompt, event);
        const finalPrompt = config.includeEventContext !== false
          ? `${prompt}\n\n事件上下文: ${JSON.stringify(event.payload)}`
          : prompt;

        const result = await orch.dispatch({
          source: 'trigger',
          prompt: finalPrompt,
          metadata: {
            eventId: event.id,
            eventType: event.type,
            triggerSource: event.source,
            triggerId: trigger?.id,
            workspaceId: event.workspaceId,
            complex: trigger?.complex ?? false,
          },
        });
        return { success: true, data: { response: result } };
      }
    }

    // V20 fallback：走 MainAgent 路径（mainAgentProvider + resolveTarget）
    if (this.deps.mainAgentProvider && this.deps.resolveTarget) {
      const resolved = this.deps.resolveTarget(config.target, event, trigger);
      if (!resolved) {
        return {
          success: false,
          error: `无法解析 send_llm target='${config.target}'（trigger=${trigger?.id ?? 'unknown'}）`,
        };
      }
      const agent = this.deps.mainAgentProvider(resolved);
      if (!agent) {
        return {
          success: false,
          error: `未找到 MainAgent: ${resolved.workspaceId}:${resolved.agentId}`,
        };
      }

      const prompt = this.renderTemplate(config.prompt, event);
      const finalPrompt = config.includeEventContext !== false
        ? `${prompt}\n\n事件上下文: ${JSON.stringify(event.payload)}`
        : prompt;

      const result = await agent.handle({
        source: 'trigger',
        prompt: finalPrompt,
        metadata: {
          eventId: event.id,
          eventType: event.type,
          triggerSource: event.source,
          triggerId: trigger?.id,
          workspaceId: event.workspaceId,
        },
      });
      return { success: true, data: { response: result } };
    }

    // 兼容旧式 sendLLM 回调（V20 之前）
    if (!this.deps.sendLLM) {
      return { success: false, error: 'sendLLM / mainAgentProvider 未配置' };
    }

    const prompt = this.renderTemplate(config.prompt, event);
    const finalPrompt = config.includeEventContext !== false
      ? `${prompt}\n\n事件上下文: ${JSON.stringify(event.payload)}`
      : prompt;

    const result = await this.deps.sendLLM(config.target, finalPrompt, event);
    return { success: true, data: { response: result } };
  }

  private async executeSendQQ(config: SendQQActionConfig, event: AgentEvent): Promise<ActionResult> {
    if (!this.deps.sendQQ) {
      return { success: false, error: 'sendQQ 未配置' };
    }

    const target = this.renderTemplate(config.target, event);
    const content = this.renderTemplate(config.content, event);
    const messageType = config.messageType ?? 'group';

    const ok = await this.deps.sendQQ(target, content, messageType);
    return { success: ok, data: { target, content, messageType } };
  }

  private async executeStoreMemory(config: StoreMemoryActionConfig, event: AgentEvent): Promise<ActionResult> {
    if (!this.deps.storeMemory) {
      return { success: false, error: 'storeMemory 未配置' };
    }

    await this.deps.storeMemory(event.workspaceId || 'global', {
      memoryType: config.memoryType,
      branch: config.branch ?? 'experience',
      content: this.renderTemplate(config.content, event),
      importance: config.importance ?? 5,
      tags: config.tags ?? ['event-triggered'],
    });

    return { success: true };
  }

  /** 渲染模板字符串，支持 {{event.payload.xxx}} 占位符 */
  renderTemplate(template: string, event: AgentEvent): string {
    if (typeof template !== 'string') return String(template ?? '');

    return template.replace(/\{\{(.*?)\}\}/g, (_, path: string) => {
      const value = this.getValueByPath({ event }, path.trim());
      return value !== undefined ? String(value) : '';
    });
  }

  /** 递归渲染对象中的模板字符串 */
  private renderObject(obj: Record<string, unknown>, event: AgentEvent): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        result[key] = this.renderTemplate(value, event);
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result[key] = this.renderObject(value as Record<string, unknown>, event);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  /** 根据点号路径获取对象值 */
  private getValueByPath(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
}

/** 生成唯一事件 ID */
export function generateEventId(): string {
  return `${Date.now()}_${randomUUID().slice(0, 8)}`;
}
