/**
 * V5 提示词工程模块入口
 *
 * 导出所有类型、接口、默认实现和内置组件。
 */

// 类型定义
export * from './types';

// Agent 系统
export { DefaultAgentProfile } from './agent/agent-profile';
export { BehaviorRulesManager } from './agent/behavior-rules';
export { PromptFragmentManager } from './agent/prompt-fragments';
export { BUILTIN_IDENTITY_TEMPLATES, listIdentityTemplates, getIdentityTemplate, createProfileFromIdentity } from './agent/identity-templates';
export { PERSONALITY_LIBRARY, PERSONALITY_BY_CATEGORY, PERSONALITY_BY_ID, getPersonalityByCategory, getPersonalityTrait, validatePersonalityCombination, traitsToDescriptions } from './agent/personality-library';
export { BEHAVIOR_PRESETS, getBehaviorPreset, getPresetsForIdentity } from './agent/behavior-presets';
export { WORKFLOW_TEMPLATES, getWorkflowTemplate, getWorkflowsForScenario, formatWorkflowTemplate } from './agent/workflow-templates';
export { DEFAULT_MAIN_AGENT_TEMPLATE, renderMainAgentTemplate } from './agent/main-agent-templates';

// Builder 组件
export { PromptBuilder } from './builder/prompt-builder';
export { DefaultSystemPromptBuilder } from './builder/system-prompt-builder';
export { DefaultStateInjector } from './builder/state-injector';
export { DefaultPromptTemplateEngine } from './builder/template-engine';

// 工具提示组件
export { DefaultToolPromptAssembler } from './tools/tool-prompt-assembler';
export { OpenAIFormatAdapter, ClaudeFormatAdapter, GeminiFormatAdapter, createAdapter } from './tools/tool-format-adapters';
export { MinimalToolFormatter, DetailedToolFormatter, ToolFormatterRegistry } from './tools/tool-formatters';

// 上下文管理组件
export { DefaultContextWindowManager } from './context/context-window-manager';
export { DefaultCacheKeyBuilder } from './context/cache-key-builder';
export { SlidingWindowTrimStrategy, SummaryTrimStrategy, PriorityTrimStrategy } from './context/trim-strategies';

// 模板注册器 + 模板管理器
export { DefaultTemplateRegistry } from './template-registry';
export { PromptTemplateManager } from './prompt-template-manager';

// V26: 提示词编译器
export { PromptCompiler } from './compiler';

// 工具提示词规范
export { ACTION_TARGET_SPEC, VERB_FIRST_SPEC, DOMAIN_ACTION_SPEC, TOOL_CATEGORIES, TOOL_DESCRIPTION_TEMPLATES, checkToolDescriptionQuality, checkAllToolsQuality, getToolDescriptionGuide, formatToolForPrompt } from './tools/tool-prompt-spec';