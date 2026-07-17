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
import type { AgentConfig } from '../../../renderer/src/lib/types';

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
}