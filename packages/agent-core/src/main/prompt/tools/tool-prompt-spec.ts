/**
 * 工具提示词写作规范
 *
 * 定义工具提示词（Tool Prompt）的写作标准和质量检查规则。
 * 确保所有工具的描述、参数和示例符合 LLM 最佳理解形式。
 */

import type {
  ToolPromptDefinition,
  ToolPromptWritingSpec,
  ToolDescriptionQualityCheck,
} from '../types';
import {
  ToolDescriptionQuality,
  ToolNamingConvention,
} from '../types';

// ════════════════════════════════════════════════════
// 写作规范定义
// ════════════════════════════════════════════════════

/** 推荐的命名规范 (动作前缀 + 目标) */
export const ACTION_TARGET_SPEC: ToolPromptWritingSpec = {
  namingConvention: ToolNamingConvention.ActionTarget,
  descriptionRules: {
    requiredElements: [
      '工具完成什么操作',
      '操作的对象或目标',
      '操作的前提条件（如果有）',
    ],
    recommendedElements: [
      '操作的结果或效果',
      '失败的可能原因',
      '使用场景示例',
    ],
    forbiddenContent: [
      'LLM 内部实现细节',
      '技术架构信息',
      '无关的上下文信息',
      '模糊的承诺（如"可能成功"）',
    ],
    maxLength: 200,
  },
  parameterRules: {
    descriptionRequired: true,
    requiredMarking: true,
    suggestDefault: true,
    suggestEnum: true,
    suggestExample: true,
  },
  exampleRules: {
    minExamples: 1,
    requiredFields: ['description', 'arguments'],
  },
};

/** 动词开头命名规范 (get, set, find, etc.) */
export const VERB_FIRST_SPEC: ToolPromptWritingSpec = {
  namingConvention: ToolNamingConvention.VerbFirst,
  descriptionRules: {
    requiredElements: [
      '工具完成什么操作',
      '操作的对象或目标',
      '返回值或结果',
    ],
    recommendedElements: [
      '操作的前提条件',
      '错误处理方式',
      '性能注意点',
    ],
    forbiddenContent: [
      'LLM 内部实现细节',
      '技术架构信息',
    ],
    maxLength: 150,
  },
  parameterRules: {
    descriptionRequired: true,
    requiredMarking: true,
    suggestDefault: true,
    suggestEnum: false,
    suggestExample: true,
  },
  exampleRules: {
    minExamples: 1,
    requiredFields: ['description', 'arguments'],
  },
};

/** 领域+操作命名规范 (inventory.sort, chat.send) */
export const DOMAIN_ACTION_SPEC: ToolPromptWritingSpec = {
  namingConvention: ToolNamingConvention.DomainAction,
  descriptionRules: {
    requiredElements: [
      '工具完成什么操作',
      '所属领域',
      '操作的范围',
    ],
    recommendedElements: [
      '操作的副作用',
      '权限要求',
      '时效性说明',
    ],
    forbiddenContent: [
      '跨领域的信息',
      '实现细节',
    ],
    maxLength: 180,
  },
  parameterRules: {
    descriptionRequired: true,
    requiredMarking: true,
    suggestDefault: true,
    suggestEnum: true,
    suggestExample: true,
  },
  exampleRules: {
    minExamples: 1,
    requiredFields: ['description', 'arguments'],
  },
};

// ════════════════════════════════════════════════════
// 工具分类规范
// ════════════════════════════════════════════════════

/** 工具分类定义 */
export interface ToolCategorySpec {
  /** 分类标识 */
  id: string;
  /** 分类名称 */
  name: string;
  /** 分类描述 */
  description: string;
  /** 命名前缀建议 */
  namingPrefix: string;
  /** 典型工具示例 */
  examples: string[];
}

/** 所有工具分类规范 */
export const TOOL_CATEGORIES: ToolCategorySpec[] = [
  {
    id: 'movement',
    name: '移动',
    description: '玩家移动、导航、寻路相关',
    namingPrefix: 'move_',
    examples: ['move_to', 'move_forward', 'jump', 'sneak', 'sprint', 'look_at'],
  },
  {
    id: 'perception',
    name: '感知',
    description: '环境感知、信息获取相关',
    namingPrefix: 'look_ / scan_ / get_',
    examples: ['look_at', 'scan_entities', 'get_block', 'check_time', 'read_sign'],
  },
  {
    id: 'inventory',
    name: '背包',
    description: '物品管理、容器操作相关',
    namingPrefix: 'inventory_ / container_',
    examples: ['inventory.sort', 'container.open', 'item.transfer', 'equip.item'],
  },
  {
    id: 'block',
    name: '方块',
    description: '方块操作（挖掘、放置、交互）相关',
    namingPrefix: 'break_ / place_ / interact_',
    examples: ['break_block', 'place_block', 'interact_block', 'fill_area'],
  },
  {
    id: 'entity',
    name: '实体',
    description: '生物交互、战斗相关',
    namingPrefix: 'attack_ / interact_entity_',
    examples: ['attack_entity', 'interact_entity', 'feed_animal', 'tame_entity'],
  },
  {
    id: 'survival',
    name: '生存',
    description: '生存维护（进食、睡眠、治疗）相关',
    namingPrefix: 'eat_ / sleep_ / heal_',
    examples: ['eat_food', 'sleep_bed', 'heal_self', 'check_stats'],
  },
  {
    id: 'chat',
    name: '聊天',
    description: '与玩家或其他实体通信相关',
    namingPrefix: 'chat_ / say_ / tell_',
    examples: ['chat.send', 'chat.reply', 'tell_player'],
  },
  {
    id: 'memory',
    name: '记忆',
    description: '记忆系统相关（存储、检索、查询）',
    namingPrefix: 'memory_ / recall_',
    examples: ['memory.store', 'memory.recall', 'memory.search', 'map_mark'],
  },
  {
    id: 'task',
    name: '任务',
    description: '任务规划、状态管理相关',
    namingPrefix: 'task_ / plan_',
    examples: ['task.create', 'task.update', 'plan.route', 'set_goal'],
  },
  {
    id: 'qq',
    name: 'QQ 集成',
    description: 'QQ 平台交互相关',
    namingPrefix: 'qq_',
    examples: ['qq.send_message', 'qq.get_groups', 'qq.handle_request'],
  },
];

// ════════════════════════════════════════════════════
// 工具描述写作模板
// ════════════════════════════════════════════════════

/** 工具描述模板 */
export const TOOL_DESCRIPTION_TEMPLATES = {
  /** 标准格式模板 */
  standard: `{tool_name}: {action_description}

参数:
{parameter_list}

示例:
{example_list}`,

  /** 简洁格式模板 */
  concise: `{tool_name}: {action_description}
参数: {parameter_list}`,

  /** 详细格式模板 */
  detailed: `{tool_name}: {action_description}

描述: {detailed_description}
前提条件: {prerequisites}
注意事项: {notes}

参数:
{parameter_list}

示例:
{example_list}

预期结果: {expected_result}`,
};

// ════════════════════════════════════════════════════
// 质量检查函数
// ════════════════════════════════════════════════════

/**
 * 检查单个工具的描述质量
 */
export function checkToolDescriptionQuality(
  tool: ToolPromptDefinition,
  spec: ToolPromptWritingSpec = ACTION_TARGET_SPEC,
): ToolDescriptionQualityCheck {
  const issues: string[] = [];
  const suggestions: string[] = [];

  // 检查描述
  if (!tool.description || tool.description.trim().length === 0) {
    issues.push('缺少工具描述');
    suggestions.push('添加工具描述，说明工具的功能和用途');
  } else {
    const descLen = tool.description.length;
    if (descLen < 10) {
      issues.push('工具描述过短（< 10 字符）');
      suggestions.push('扩展工具描述，至少包含动作、目标和前提条件');
    }
    if (descLen > spec.descriptionRules.maxLength) {
      issues.push(`工具描述过长（${descLen} > ${spec.descriptionRules.maxLength}）`);
      suggestions.push(`精简描述到 ${spec.descriptionRules.maxLength} 字符以内`);
    }

    // 检查必须要素
    for (const element of spec.descriptionRules.requiredElements) {
      const keywords = element.split(' ').filter(k => k.length > 1);
      const hasKeywords = keywords.some(k => tool.description.includes(k));
      if (!hasKeywords) {
        issues.push(`描述缺少要素: ${element}`);
        suggestions.push(`在描述中添加关于"${element}"的内容`);
      }
    }

    // 检查禁止内容
    for (const forbidden of spec.descriptionRules.forbiddenContent) {
      if (tool.description.includes(forbidden)) {
        issues.push(`描述包含禁止内容: "${forbidden}"`);
        suggestions.push(`移除描述中的"${forbidden}"`);
      }
    }
  }

  // 检查参数
  for (const [paramName, param] of Object.entries(tool.parameters)) {
    if (spec.parameterRules.descriptionRequired && (!param.description || param.description.trim().length === 0)) {
      issues.push(`参数 "${paramName}" 缺少描述`);
      suggestions.push(`为参数 "${paramName}" 添加描述说明`);
    }

    if (spec.parameterRules.requiredMarking && param.required === undefined) {
      issues.push(`参数 "${paramName}" 未标注是否必填`);
      suggestions.push(`为参数 "${paramName}" 标注 required 字段`);
    }

    if (spec.parameterRules.suggestDefault && param.default === undefined && param.type === 'number') {
      suggestions.push(`考虑为参数 "${paramName}" 提供默认值`);
    }

    if (spec.parameterRules.suggestEnum && param.type === 'string' && !param.enum) {
      suggestions.push(`如果参数 "${paramName}" 有可选值范围，建议提供 enum 枚举`);
    }

    if (spec.parameterRules.suggestExample && param.example === undefined) {
      suggestions.push(`考虑为参数 "${paramName}" 提供示例值`);
    }
  }

  // 检查示例
  if (!tool.examples || tool.examples.length < spec.exampleRules.minExamples) {
    issues.push(`示例数量不足（需要至少 ${spec.exampleRules.minExamples} 个）`);
    suggestions.push(`添加 ${spec.exampleRules.minExamples - (tool.examples?.length || 0)} 个工具使用示例`);
  }

  // 确定质量等级
  let quality: ToolDescriptionQuality;
  if (issues.length === 0 && suggestions.length <= 2) {
    quality = ToolDescriptionQuality.Excellent;
  } else if (issues.length <= 1) {
    quality = ToolDescriptionQuality.Good;
  } else if (issues.length <= 3) {
    quality = ToolDescriptionQuality.Acceptable;
  } else {
    quality = ToolDescriptionQuality.Poor;
  }

  return {
    name: tool.name,
    quality,
    issues,
    suggestions,
  };
}

/**
 * 批量检查工具列表的描述质量
 */
export function checkAllToolsQuality(
  tools: ToolPromptDefinition[],
  spec?: ToolPromptWritingSpec,
): ToolDescriptionQualityCheck[] {
  return tools.map(t => checkToolDescriptionQuality(t, spec));
}

/**
 * 获取工具描述的写作建议
 */
export function getToolDescriptionGuide(): string {
  return [
    '# 工具提示词写作规范指南',
    '',
    '## 命名规范',
    '',
    '工具命名应遵循 `{动作}_{目标}` 格式，使用蛇形命名法（snake_case）：',
    '- 动作：move, break, place, attack, eat, sleep, scan, check 等',
    '- 目标：to, block, entity, food, area 等',
    '',
    '示例：',
    '- move_to — 移动到目标位置',
    '- break_block — 破坏方块',
    '- attack_entity — 攻击实体',
    '- inventory.sort — 整理背包',
    '',
    '## 描述写作要点',
    '',
    '工具描述应包含：',
    '1. **做什么**：工具完成什么操作（必需）',
    '2. **操作对象**：操作的目标是什么（必需）',
    '3. **前提条件**：什么情况下才能使用（建议）',
    '4. **结果说明**：操作后会有什么效果（建议）',
    '5. **失败原因**：可能失败的原因（建议）',
    '',
    '描述示例：',
    '  ❌ "移动到目标位置" — 缺少信息',
    '  ✅ "移动到指定坐标位置，自动避障，支持跨维度传送" — 完整信息',
    '',
    '## 参数写作要点',
    '',
    '每个参数应包含：',
    '1. **类型**：number, string, boolean, object, array（必需）',
    '2. **描述**：参数的作用和取值范围（必需）',
    '3. **必填标注**：是否必须提供（必需）',
    '4. **默认值**：如果可选，提供默认值（建议）',
    '5. **枚举值**：如果有限定值，提供枚举（建议）',
    '6. **示例值**：提供典型值示例（建议）',
    '',
    '参数示例：',
    '  x: { type: "number", description: "目标 X 坐标", required: true }',
    '  y: { type: "number", description: "目标 Y 坐标（可选，不传则保持当前 Y）", required: false, default: 0 }',
    '  mode: { type: "string", description: "挖掘模式", required: false, enum: ["single", "area"], default: "single" }',
    '',
    '## 示例写作要点',
    '',
    '每个工具至少提供 1 个使用示例，包含：',
    '1. **场景描述**：什么情况下使用此工具',
    '2. **参数示例**：具体的参数值',
    '3. **预期结果**：工具执行后的预期效果',
    '',
    '示例格式：',
    '  {',
    '    description: "移动到坐标为 (100, 64, 200) 的位置",',
    '    arguments: { x: 100, y: 64, z: 200 },',
    '    expectedResult: "玩家移动到 (100, 64, 200)"',
    '  }',
    '',
    '## 分类归属',
    '',
    '每个工具应归属到合适的分类：',
    '| 分类 | 说明 | 命名示例 |',
    '|------|------|----------|',
    '| movement | 移动导航 | move_to, jump, look_at |',
    '| perception | 环境感知 | scan_entities, get_block |',
    '| inventory | 物品管理 | inventory.sort, equip.item |',
    '| block | 方块操作 | break_block, place_block |',
    '| entity | 实体交互 | attack_entity, feed_animal |',
    '| survival | 生存维护 | eat_food, sleep_bed |',
    '| chat | 通信聊天 | chat.send, tell_player |',
    '| memory | 记忆系统 | memory.store, memory.recall |',
    '| task | 任务规划 | task.create, plan.route |',
    '| qq | QQ 集成 | qq.send_message |',
    '',
    '## 避免的常见问题',
    '',
    '1. **描述过于简单**：只写"移动"而不说明如何移动',
    '2. **参数缺少类型**：不标注参数类型，LLM 无法正确生成',
    '3. **不标注必填**：LLM 可能遗漏必填参数',
    '4. **缺少示例**：LLM 对复杂参数的理解需要示例辅助',
    '5. **包含实现细节**：LLM 不需要知道内部实现',
    '6. **模糊承诺**：使用"可能""也许"等不确定表述',
  ].join('\n');
}

/**
 * 生成规范化的工具描述文本（用于注入到提示词）
 */
export function formatToolForPrompt(
  tool: ToolPromptDefinition,
  verbosity: 'minimal' | 'standard' | 'detailed' = 'standard',
): string {
  switch (verbosity) {
    case 'minimal':
      return `${tool.name}: ${tool.description}`;

    case 'standard': {
      const params = Object.entries(tool.parameters)
        .map(([key, param]) => {
          const required = param.required ? '（必填）' : '（可选）';
          return `  ${key}(${param.type})${required}: ${param.description}`;
        })
        .join('\n');

      const examples = tool.examples && tool.examples.length > 0
        ? '\n示例:\n' + tool.examples.map(ex =>
            `  - ${ex.description}: ${JSON.stringify(ex.arguments)}`,
          ).join('\n')
        : '';

      return `${tool.name}: ${tool.description}\n参数:\n${params}${examples}`;
    }

    case 'detailed': {
      const params = Object.entries(tool.parameters)
        .map(([key, param]) => {
          const required = param.required ? '必填' : '可选';
          const defaultStr = param.default !== undefined ? `, 默认: ${param.default}` : '';
          const enumStr = param.enum ? `, 可选值: [${param.enum.join(', ')}]` : '';
          const exampleStr = param.example !== undefined ? `, 示例: ${JSON.stringify(param.example)}` : '';
          return `  - ${key} (${param.type}, ${required}${defaultStr}${enumStr}${exampleStr}): ${param.description}`;
        })
        .join('\n');

      const examples = tool.examples && tool.examples.length > 0
        ? '\n示例:\n' + tool.examples.map(ex => {
            let example = `  - ${ex.description}: ${JSON.stringify(ex.arguments)}`;
            if (ex.expectedResult) example += `\n    → 预期: ${ex.expectedResult}`;
            return example;
          }).join('\n')
        : '';

      const usageHint = tool.usageHint ? `\n使用提示: ${tool.usageHint}` : '';

      return `[${tool.category}] ${tool.name}: ${tool.description}\n参数:\n${params}${examples}${usageHint}`;
    }
  }
}