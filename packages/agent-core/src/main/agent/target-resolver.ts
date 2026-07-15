/**
 * V20 §4.8 send_llm target 解析
 *
 * 把 SendLLMActionConfig.target ('main' | 'qq_sub_agent') 解析为
 * (workspaceId, agentId)，给 Trigger ActionExecutor 用。
 *
 * 解析规则（按设计文档 §4.8）：
 * - target='main'：从 AgentConfigManager 找出 event.workspaceId 下 isMain=true 的 agent
 * - target='qq_sub_agent'：用 trigger.targetAgentId 直接定位
 * - 解析失败：返回 undefined，由 ActionExecutor 返回 {success:false, error:'无法解析 target'}
 *
 * 启动时若 workspace 无 is_main agent，由 `markMainAgentOnStart` 自动标记第一个。
 */

import type { AgentConfigManager } from './agent-config-manager';
import type { AgentEvent, EventTrigger } from '../trigger/types';

export interface ResolvedTarget {
  workspaceId: string;
  agentId: string;
}

/**
 * 创建 target 解析器。
 *
 * @param agentConfigManager Agent 配置管理器
 * @returns resolveTarget 函数（注入到 ActionExecutorDeps）
 */
export function createTargetResolver(
  agentConfigManager: AgentConfigManager,
): (
  target: 'main' | 'qq_sub_agent',
  event: AgentEvent,
  trigger?: EventTrigger,
) => Promise<ResolvedTarget | undefined> {
  return async (
    target: 'main' | 'qq_sub_agent',
    event: AgentEvent,
    trigger?: EventTrigger,
  ): Promise<ResolvedTarget | undefined> => {
    const workspaceId = event.workspaceId || '';

    if (target === 'main') {
      // 1. 找出 workspace 内 isMain=true 的 agent
      let mainAgent = await agentConfigManager.getMainAgent(workspaceId);

      // 2. 兜底：若 workspace 无 is_main，取该 workspace 内第一个 agent 并标记
      if (!mainAgent) {
        const agents = await agentConfigManager.listByWorkspace(workspaceId);
        if (agents.length === 0) return undefined;
        const first = agents[0];
        await agentConfigManager.markMain(first.id!);
        mainAgent = first;
      }

      return {
        workspaceId,
        agentId: mainAgent.id!,
      };
    }

    // target === 'qq_sub_agent'
    // 优先用 trigger.targetAgentId
    const targetAgentId = trigger?.targetAgentId;
    if (targetAgentId) {
      const cfg = await agentConfigManager.get(targetAgentId);
      if (cfg) {
        return {
          workspaceId: cfg.workspaceId ?? workspaceId,
          agentId: targetAgentId,
        };
      }
      return undefined;
    }

    // trigger.targetAgentId 为空：解析失败（按设计文档存量数据迁移说明）
    return undefined;
  };
}
