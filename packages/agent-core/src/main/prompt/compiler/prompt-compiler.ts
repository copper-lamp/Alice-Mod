/**
 * V26 PromptCompiler — 提示词编译器
 *
 * 职责：
 * 1. 接收 AgentConfig，调用 SystemPromptBuilder.build() 生成完整系统提示词
 * 2. 在智能体创建/更新时由 AgentConfigManager 调用，结果存入 agents.compiled_prompt
 * 3. 运行时 MainAgent 直接使用预编译提示词，不再动态组装
 *
 * 设计原则：
 * - 复用现有 SystemPromptBuilder 和 mapAgentConfigToProfile
 * - 编译 = 提前调用 build() 并存储结果
 * - 不修改任何现有组装逻辑
 */

import { mapAgentConfigToProfile } from '../../agent/agent-profile-mapper';
import { DefaultSystemPromptBuilder } from '../builder/system-prompt-builder';
import { DefaultPromptTemplateEngine } from '../builder/template-engine';
import type { AgentConfig, AgentPersona } from '../../../renderer/src/lib/types';

/** V28: QQ 智能体默认人设（与前端 QQConfigForm 中的 DEFAULT_QQ_PERSONA 保持一致） */
const DEFAULT_QQ_PERSONA: AgentPersona = {
  identity: `你是 McAgent 的 QQ 机器人助手，负责处理 QQ 群聊和私聊中的消息。

你的职责：
1. 回复 QQ 用户的问题，提供友好的对话体验
2. 当用户需要游戏内操作（如查询状态、执行指令）时，使用 request_game_action 工具请求主 Agent

你的限制：
- 你无法直接操作游戏，所有游戏操作必须通过 request_game_action 请求主 Agent 执行
- 你需要将主 Agent 返回的结果以友好的方式回复给 QQ 用户
- 纯 QQ 相关的查询（如群信息、成员列表）可以直接使用 qq_info 工具`,
  expertise: ['QQ 群聊管理', '消息回复', '游戏状态查询'],
  personality: [
    '友好、耐心、乐于助人',
    '回复简洁明了，不啰嗦',
    '使用与 QQ 用户相同的语言回复',
    '遇到不懂的问题诚实告知，不编造答案',
  ],
  workflowId: '',
  behaviorRules: {
    core: [
      '不要直接执行游戏操作，使用 request_game_action 请求主 Agent',
      '将主 Agent 返回的结果转换成自然语言回复给用户',
      '尊重用户隐私，不泄露其他用户的信息',
      '群聊中回复时 @ 对应用户',
      '工具可能失败，失败后向用户解释原因并提供替代方案',
    ],
    strategy: [],
    constraints: [],
  },
  communicationStyle: [
    '使用亲切友好的语气',
    '回复简洁，避免冗长',
  ],
  boundaries: [
    '不执行任何游戏内操作',
    '不泄露管理员或其他用户的隐私信息',
  ],
}

export class PromptCompiler {
  private static systemPromptBuilder = new DefaultSystemPromptBuilder(
    new DefaultPromptTemplateEngine(),
  );

  /**
   * 编译智能体系统提示词
   *
   * @param config AgentConfig（wizard 写入的原始配置）
   * @returns 编译后的完整系统提示词文本
   */
  static compile(config: AgentConfig): string {
    // 1. AgentConfig → AgentProfile（复用现有映射器）
    const profile = mapAgentConfigToProfile(config);

    // 2. 构建系统提示词（复用现有构建器）
    const systemPrompt = this.systemPromptBuilder.build(profile);

    return systemPrompt;
  }

  /**
   * V28: 编译 QQ 智能体系统提示词
   *
   * 使用 AgentConfig.qqPersona（若存在）或默认 DEFAULT_QQ_PERSONA 编译，
   * 与主 Agent 的 compiledPrompt 完全独立。
   *
   * @param config AgentConfig
   * @returns 编译后的 QQ 系统提示词文本
   */
  static compileQQ(config: AgentConfig): string {
    const qqPersona = config.qqPersona ?? DEFAULT_QQ_PERSONA;

    // 构建一个仅包含 QQ persona 的配置用于 profile 映射
    const qqConfig = { ...config, persona: qqPersona as AgentConfig['persona'] };
    const profile = mapAgentConfigToProfile(qqConfig);

    // 构建系统提示词
    const systemPrompt = this.systemPromptBuilder.build(profile);

    return systemPrompt;
  }
}