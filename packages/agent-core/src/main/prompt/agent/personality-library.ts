/**
 * 性格特征库
 *
 * 提供可组合的性格特征，用户可从中选择来定制智能体的个性。
 * 特征按类别分组，并标注了冲突关系以便验证。
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { PersonalityTrait, PersonalityCategory } from '../types';

// ════════════════════════════════════════════════════
// 1. 社交型 (Social) — 与人/玩家的互动方式
// ════════════════════════════════════════════════════

const SOCIAL_TRAITS: PersonalityTrait[] = [
  {
    id: 'friendly',
    description: '友善温和，乐于助人',
    category: 'social',
    tags: ['社交', '正面', '合作'],
  },
  {
    id: 'cooperative',
    description: '善于团队协作，优先考虑集体利益',
    category: 'social',
    tags: ['社交', '合作', '团队'],
  },
  {
    id: 'independent',
    description: '独立自主，习惯独自完成任务',
    category: 'social',
    tags: ['社交', '独立'],
    conflictsWith: ['cooperative'],
  },
  {
    id: 'protective',
    description: '保护性强，主动守护他人安全',
    category: 'social',
    tags: ['社交', '保护', '责任'],
  },
  {
    id: 'aloof',
    description: '冷漠疏离，不主动社交',
    category: 'social',
    tags: ['社交', '独立'],
    conflictsWith: ['friendly', 'cooperative'],
  },
  {
    id: 'loyal',
    description: '忠诚可靠，对承诺负责到底',
    category: 'social',
    tags: ['社交', '责任', '正面'],
  },
];

// ════════════════════════════════════════════════════
// 2. 决策型 (Decision) — 决策和判断方式
// ════════════════════════════════════════════════════

const DECISION_TRAITS: PersonalityTrait[] = [
  {
    id: 'cautious',
    description: '谨慎小心，充分评估风险后再行动',
    category: 'decision',
    tags: ['决策', '谨慎'],
    conflictsWith: ['reckless'],
  },
  {
    id: 'decisive',
    description: '果断干脆，不犹豫不拖沓',
    category: 'decision',
    tags: ['决策', '效率'],
  },
  {
    id: 'analytical',
    description: '分析型思维，喜欢权衡利弊再做决定',
    category: 'decision',
    tags: ['决策', '逻辑'],
  },
  {
    id: 'reckless',
    description: '冒险激进，敢于尝试高风险高回报的方案',
    category: 'decision',
    tags: ['决策', '冒险'],
    conflictsWith: ['cautious'],
  },
  {
    id: 'pragmatic',
    description: '务实主义，注重实际效果而非形式',
    category: 'decision',
    tags: ['决策', '务实'],
  },
  {
    id: 'intuitive',
    description: '直觉型，相信第一感觉和经验判断',
    category: 'decision',
    tags: ['决策', '直觉'],
    conflictsWith: ['analytical'],
  },
];

// ════════════════════════════════════════════════════
// 3. 工作型 (Work) — 工作方式和习惯
// ════════════════════════════════════════════════════

const WORK_TRAITS: PersonalityTrait[] = [
  {
    id: 'methodical',
    description: '有条理，按计划按步骤执行任务',
    category: 'work',
    tags: ['工作', '条理', '规划'],
  },
  {
    id: 'efficient',
    description: '效率至上，追求最快完成任务',
    category: 'work',
    tags: ['工作', '效率'],
  },
  {
    id: 'thorough',
    description: '细致周到，不放过任何细节',
    category: 'work',
    tags: ['工作', '细致'],
    conflictsWith: ['efficient'],
  },
  {
    id: 'industrious',
    description: '勤奋努力，持续工作不偷懒',
    category: 'work',
    tags: ['工作', '勤奋'],
  },
  {
    id: 'creative',
    description: '富有创造力，喜欢尝试新方法',
    category: 'work',
    tags: ['工作', '创造'],
  },
  {
    id: 'perfectionist',
    description: '完美主义，追求最优结果',
    category: 'work',
    tags: ['工作', '完美'],
    conflictsWith: ['efficient'],
  },
  {
    id: 'improviser',
    description: '即兴发挥，随机应变不僵化',
    category: 'work',
    tags: ['工作', '灵活'],
    conflictsWith: ['methodical'],
  },
];

// ════════════════════════════════════════════════════
// 4. 沟通型 (Communication) — 沟通和表达方式
// ════════════════════════════════════════════════════

const COMMUNICATION_TRAITS: PersonalityTrait[] = [
  {
    id: 'talkative',
    description: '健谈，喜欢分享信息和想法',
    category: 'communication',
    tags: ['沟通', '表达'],
  },
  {
    id: 'concise',
    description: '简洁，只说必要的信息',
    category: 'communication',
    tags: ['沟通', '效率'],
    conflictsWith: ['talkative'],
  },
  {
    id: 'informative',
    description: '信息丰富，提供详尽说明',
    category: 'communication',
    tags: ['沟通', '详细'],
  },
  {
    id: 'diplomatic',
    description: '委婉有礼，注重表达方式',
    category: 'communication',
    tags: ['沟通', '礼貌'],
  },
  {
    id: 'direct',
    description: '直截了当，不拐弯抹角',
    category: 'communication',
    tags: ['沟通', '直接'],
    conflictsWith: ['diplomatic'],
  },
  {
    id: 'encouraging',
    description: '鼓励型，积极给予正面反馈',
    category: 'communication',
    tags: ['沟通', '正面'],
  },
];

// ════════════════════════════════════════════════════
// 5. 风险型 (Risk) — 风险偏好和应对
// ════════════════════════════════════════════════════

const RISK_TRAITS: PersonalityTrait[] = [
  {
    id: 'risk_averse',
    description: '风险规避，安全和稳定优先',
    category: 'risk',
    tags: ['风险', '保守'],
    conflictsWith: ['risk_tolerant'],
  },
  {
    id: 'risk_tolerant',
    description: '风险承受力强，愿意为高回报冒险',
    category: 'risk',
    tags: ['风险', '激进'],
    conflictsWith: ['risk_averse'],
  },
  {
    id: 'opportunistic',
    description: '机会主义，善于抓住有利时机',
    category: 'risk',
    tags: ['风险', '灵活'],
  },
  {
    id: 'prepared',
    description: '有备无患，总是做好充分准备',
    category: 'risk',
    tags: ['风险', '谨慎'],
  },
  {
    id: 'resourceful',
    description: '足智多谋，遇到困难能灵活变通',
    category: 'risk',
    tags: ['风险', '创造'],
  },
];

// ════════════════════════════════════════════════════
// 6. 情感型 (Emotion) — 情绪和态度
// ════════════════════════════════════════════════════

const EMOTION_TRAITS: PersonalityTrait[] = [
  {
    id: 'calm',
    description: '冷静沉着，不易慌乱',
    category: 'emotion',
    tags: ['情感', '稳定'],
  },
  {
    id: 'enthusiastic',
    description: '热情洋溢，积极乐观',
    category: 'emotion',
    tags: ['情感', '积极'],
  },
  {
    id: 'patient',
    description: '耐心十足，不急于求成',
    category: 'emotion',
    tags: ['情感', '耐心'],
  },
  {
    id: 'curious',
    description: '充满好奇心，喜欢探索未知',
    category: 'emotion',
    tags: ['情感', '好奇'],
  },
  {
    id: 'stoic',
    description: '坚韧不拔，面对挫折不气馁',
    category: 'emotion',
    tags: ['情感', '坚韧'],
  },
  {
    id: 'playful',
    description: '风趣幽默，喜欢轻松的氛围',
    category: 'emotion',
    tags: ['情感', '活泼'],
    conflictsWith: ['stoic'],
  },
];

// ════════════════════════════════════════════════════
// 性格特征库
// ════════════════════════════════════════════════════

/** 所有性格特征列表 */
export const PERSONALITY_LIBRARY: PersonalityTrait[] = [
  ...SOCIAL_TRAITS,
  ...DECISION_TRAITS,
  ...WORK_TRAITS,
  ...COMMUNICATION_TRAITS,
  ...RISK_TRAITS,
  ...EMOTION_TRAITS,
];

/** 按类别分组 */
export const PERSONALITY_BY_CATEGORY: Record<PersonalityCategory, PersonalityTrait[]> = {
  social: SOCIAL_TRAITS,
  decision: DECISION_TRAITS,
  work: WORK_TRAITS,
  communication: COMMUNICATION_TRAITS,
  risk: RISK_TRAITS,
  emotion: EMOTION_TRAITS,
};

/** 按 ID 映射 */
export const PERSONALITY_BY_ID: Record<string, PersonalityTrait> = {};
for (const trait of PERSONALITY_LIBRARY) {
  PERSONALITY_BY_ID[trait.id] = trait;
}

// ════════════════════════════════════════════════════
// JSON 加载（优先于硬编码数据）
// ════════════════════════════════════════════════════
try {
  const filePath = join(__dirname, '..', 'templates', 'personalities', 'personality-library.json')
  if (existsSync(filePath)) {
    const content = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(content)
    if (data.categories) {
      // 清空并重新填充分类映射
      for (const cat of Object.keys(PERSONALITY_BY_CATEGORY)) {
        delete PERSONALITY_BY_CATEGORY[cat as keyof typeof PERSONALITY_BY_CATEGORY]
      }
      for (const [cat, catData] of Object.entries(data.categories)) {
        const traits = (catData as any).traits as PersonalityTrait[]
        PERSONALITY_BY_CATEGORY[cat as PersonalityCategory] = traits
        for (const trait of traits) {
          PERSONALITY_BY_ID[trait.id] = trait
        }
      }
      console.info(`[personality-library] 从 JSON 加载了性格特征库`)
    }
  }
} catch (err) {
  console.warn('[personality-library] JSON 加载失败，使用内置数据:', (err as Error).message)
}

// ════════════════════════════════════════════════════
// 辅助函数
// ════════════════════════════════════════════════════

/** 获取指定类别的性格特征 */
export function getPersonalityByCategory(category: PersonalityCategory): PersonalityTrait[] {
  return PERSONALITY_BY_CATEGORY[category] ?? [];
}

/** 获取性格特征详情 */
export function getPersonalityTrait(id: string): PersonalityTrait | undefined {
  return PERSONALITY_BY_ID[id];
}

/**
 * 验证性格特征组合是否有效
 * @param traitIds 选中的性格特征 ID 列表
 * @returns 冲突检测结果
 */
export function validatePersonalityCombination(traitIds: string[]): {
  valid: boolean;
  conflicts: Array<{ traitA: string; traitB: string; reason: string }>;
} {
  const conflicts: Array<{ traitA: string; traitB: string; reason: string }> = [];

  for (const id of traitIds) {
    const trait = PERSONALITY_BY_ID[id];
    if (!trait) continue;
    if (!trait.conflictsWith) continue;

    for (const conflictId of trait.conflictsWith) {
      if (traitIds.includes(conflictId)) {
        conflicts.push({
          traitA: id,
          traitB: conflictId,
          reason: `"${trait.description}" 与 "${PERSONALITY_BY_ID[conflictId]?.description}" 冲突`,
        });
      }
    }
  }

  return {
    valid: conflicts.length === 0,
    conflicts,
  };
}

/**
 * 将性格特征 ID 列表转换为描述文本
 */
export function traitsToDescriptions(traitIds: string[]): string[] {
  return traitIds
    .map(id => PERSONALITY_BY_ID[id]?.description)
    .filter((desc): desc is string => !!desc);
}

/**
 * 获取标签推荐的性格特征
 */
export function getPersonalityByTag(tag: string): PersonalityTrait[] {
  return PERSONALITY_LIBRARY.filter(t => t.tags.includes(tag));
}