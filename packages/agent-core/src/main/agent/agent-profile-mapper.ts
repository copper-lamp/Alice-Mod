/**
 * V20 主链路组装 — AgentConfig → AgentProfile Mapper
 *
 * 把 wizard 写入 DB 的 AgentConfig（renderer/src/lib/types.ts:155）转换成
 * PromptBuilder 消费的 AgentProfile（prompt/types.ts:49）。
 *
 * 容错规则（与 V19 一致）：
 * - 字段缺失 → 走 DEFAULT_AGENT_PROFILE 对应字段
 * - workflowId 无效 → 落到 DEFAULT_AGENT_PROFILE.workApproach
 * - behaviorRules 不存在 → 走 DEFAULT_AGENT_PROFILE.rules
 * - personaPresetId 存在 → 表示用了预设，personality 不合并 wizard 自定义
 */

import type { AgentConfig } from '../../renderer/src/lib/types';
import {
  type AgentProfile,
  type BehaviorRules,
  type PromptFragment,
  DEFAULT_AGENT_PROFILE,
} from '../prompt/types';
import { getWorkflowTemplate } from '../prompt/agent/workflow-templates';

/** 工作流模板查询接口（用于解耦 + 测试 mock） */
export interface WorkflowTemplateProvider {
  getWorkflowTemplate(id: string): { description: string; name?: string } | undefined;
}

/** 默认 provider（直接调用 V5 内置） */
const defaultWorkflowProvider: WorkflowTemplateProvider = {
  getWorkflowTemplate(id: string) {
    const t = getWorkflowTemplate(id);
    return t ? { description: t.description, name: t.name } : undefined;
  },
};

/**
 * 把 AgentConfig 映射为 AgentProfile。
 *
 * @param config wizard 写入的原始配置
 * @param templates 可选的工作流模板提供者（测试可传 mock）
 */
export function mapAgentConfigToProfile(
  config: AgentConfig,
  templates?: WorkflowTemplateProvider,
): AgentProfile {
  const provider = templates ?? defaultWorkflowProvider;
  const persona = config?.persona;
  const defaults = DEFAULT_AGENT_PROFILE;

  // ── 1. 基础字段 ──
  const name = config?.name || defaults.name;
  const identity = persona?.identity || defaults.identity;
  const expertise = persona?.expertise && persona.expertise.length > 0
    ? [...persona.expertise]
    : undefined;
  const communicationStyle = persona?.communicationStyle && persona.communicationStyle.length > 0
    ? [...persona.communicationStyle]
    : undefined;
  const boundaries = persona?.boundaries && persona.boundaries.length > 0
    ? [...persona.boundaries]
    : undefined;

  // ── 2. personality（preset 模式不合并 wizard 自定义） ──
  let personality: string[];
  if (config?.personaPresetId) {
    // 预设模式：用默认 personality（wizard 自定义不覆盖）
    personality = [...defaults.personality];
  } else if (persona?.personality && persona.personality.length > 0) {
    personality = [...persona.personality];
  } else {
    personality = [...defaults.personality];
  }

  // ── 3. rules（behaviorRules 缺失走 DEFAULT） ──
  const rules = mapBehaviorRules(persona?.behaviorRules, defaults.rules);

  // ── 4. workflowDescription（按 workflowId 查表） ──
  let workflowDescription: string | undefined;
  if (persona?.workflowId) {
    const tpl = provider.getWorkflowTemplate(persona.workflowId);
    if (tpl) {
      workflowDescription = tpl.description;
    } else {
      workflowDescription = defaults.workApproach?.[0];
    }
  } else {
    workflowDescription = defaults.workApproach?.[0];
  }

  // ── 5. preferences（直接复用 DEFAULT，wizard 暂未暴露此字段） ──
  const preferences = { ...defaults.preferences };

  // ── 6. fragments（默认空，MainAgent / QQSubAgent 可后续注入） ──
  const fragments: PromptFragment[] = [];

  return {
    name,
    identity,
    expertise,
    personality,
    rules,
    preferences,
    fragments,
    communicationStyle,
    workflowDescription,
    boundaries,
  };
}

/**
 * 取 enabledTools 中 false 的工具名作为 excludeTools。
 * PromptBuilder 通过 extraContext.excludeTools 透传给 ToolPromptAssembler。
 */
export function getExcludeTools(config: AgentConfig): string[] {
  const enabled = config?.tools?.enabledTools;
  if (!enabled || typeof enabled !== 'object') return [];
  return Object.keys(enabled).filter(k => enabled[k] === false);
}

/** behaviorRules 映射（缺失走 DEFAULT） */
function mapBehaviorRules(
  raw: AgentConfig['persona']['behaviorRules'] | undefined,
  fallback: BehaviorRules,
): BehaviorRules {
  if (!raw) return { ...fallback };

  return {
    core: raw.core && raw.core.length > 0 ? [...raw.core] : [...fallback.core],
    strategy: raw.strategy && raw.strategy.length > 0
      ? raw.strategy.map(s => ({ ...s }))
      : fallback.strategy.map(s => ({ ...s })),
    constraints: raw.constraints && raw.constraints.length > 0
      ? raw.constraints.map(c => ({ ...c }))
      : fallback.constraints.map(c => ({ ...c })),
  };
}
