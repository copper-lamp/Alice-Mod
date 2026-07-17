/**
 * knowledge_query — 知识库查询工具
 *
 * 查询知识库，获取与查询相关的领域知识（合成配方、生物特性、方块属性等）。
 * 知识库内容由预设数据填充，AI 不可修改。
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared';
import { ToolCategory } from '@mcagent/shared';
import type { MemoryManager } from '../memory-manager';

// ════════════════════════════════════════════════════════════════
// Schema
// ════════════════════════════════════════════════════════════════

export const KNOWLEDGE_QUERY_TOOL: ToolSchema = {
  name: 'knowledge_query',
  description: '查询知识库，获取与查询相关的领域知识（合成配方、生物特性、方块属性、生存技巧等），知识库内容由预设数据填充，AI 不可修改',
  category: ToolCategory.Knowledge,
  parameters: {
    query: {
      type: 'string',
      description: '自然语言查询，例如"如何合成钻石剑"、"苦力怕怕什么"',
      required: true,
    },
    limit: {
      type: 'number',
      description: '返回结果上限，默认 5',
      required: false,
      default: 5,
    },
  },
};

// ════════════════════════════════════════════════════════════════
// 内置知识库（预设数据）
// ════════════════════════════════════════════════════════════════

interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
}

const BUILTIN_KNOWLEDGE: KnowledgeEntry[] = [
  // 合成配方
  { id: 'kn_crafting_001', title: '工作台合成', content: '工作台由 4 个木板合成，是制作大多数工具和物品的基础', category: 'crafting', tags: ['工作台', '合成', '基础'] },
  { id: 'kn_crafting_002', title: '木镐合成', content: '木镐由 3 个木板和 2 根木棍在工作台中合成', category: 'crafting', tags: ['木镐', '工具', '合成'] },
  { id: 'kn_crafting_003', title: '石镐合成', content: '石镐由 3 个圆石和 2 根木棍在工作台中合成', category: 'crafting', tags: ['石镐', '工具', '合成'] },
  { id: 'kn_crafting_004', title: '铁镐合成', content: '铁镐由 3 个铁锭和 2 根木棍在工作台中合成', category: 'crafting', tags: ['铁镐', '工具', '合成'] },
  { id: 'kn_crafting_005', title: '钻石镐合成', content: '钻石镐由 3 颗钻石和 2 根木棍在工作台中合成', category: 'crafting', tags: ['钻石镐', '工具', '合成'] },
  { id: 'kn_crafting_006', title: '钻石剑合成', content: '钻石剑由 2 颗钻石和 1 根木棍在工作台中合成', category: 'crafting', tags: ['钻石剑', '武器', '合成'] },
  { id: 'kn_crafting_007', title: '熔炉合成', content: '熔炉由 8 个圆石在 工作台中围成一圈合成', category: 'crafting', tags: ['熔炉', '烧炼', '合成'] },
  { id: 'kn_crafting_008', title: '箱子合成', content: '箱子由 8 个木板在 工作台中围成一圈合成', category: 'crafting', tags: ['箱子', '存储', '合成'] },
  { id: 'kn_crafting_009', title: '床合成', content: '床由 3 个羊毛和 3 个木板在工作台中合成，羊毛颜色必须一致', category: 'crafting', tags: ['床', '睡觉', '合成'] },

  // 生存技巧
  { id: 'kn_survival_001', title: '初始生存步骤', content: '开局先砍树获得木板，合成工作台和木镐，挖圆石升级石镐，找洞穴或挖矿获得铁，建临时庇护所过夜', category: 'survival', tags: ['生存', '开局', '新手'] },
  { id: 'kn_survival_002', title: '钻石矿分布', content: '钻石矿在 Y=16 以下生成，Y=-64 到 Y=16 之间，以 Y=-59 最为密集', category: 'survival', tags: ['钻石', '挖矿', 'Y坐标'] },
  { id: 'kn_survival_003', title: '食物来源', content: '初期食物来源：击杀动物（牛、猪、羊、鸡）获得生肉，用熔炉烤熟。也可种植小麦制作面包', category: 'survival', tags: ['食物', '生存', '动物'] },
  { id: 'kn_survival_004', title: '铁矿石分布', content: '铁矿石在 Y=72 以下生成，Y=15 和 Y=232 处最为密集', category: 'survival', tags: ['铁', '挖矿', 'Y坐标'] },
  { id: 'kn_survival_005', title: '庇护所建造', content: '初期庇护所建议建在丘陵或山脚，用圆石建造至少 3x3 大小，留门和窗户，插火把防怪物生成', category: 'survival', tags: ['庇护所', '建筑', '安全'] },

  // 生物特性
  { id: 'kn_mob_001', title: '苦力怕', content: '苦力怕怕猫，会在玩家接近时膨胀并自爆，爆炸伤害极高。建议用弓箭远程击杀或举盾格挡', category: 'combat', tags: ['苦力怕', '怪物', '爆炸'] },
  { id: 'kn_mob_002', title: '僵尸', content: '僵尸会在阳光下着火，怕铁傀儡。击杀掉落腐肉和金锭（小概率），建议用剑打头', category: 'combat', tags: ['僵尸', '怪物', '掉落'] },
  { id: 'kn_mob_003', title: '骷髅弓箭手', content: '骷髅弓箭手远程射击，建议用盾牌格挡箭矢后近战击杀，或使用弓箭对射', category: 'combat', tags: ['骷髅', '怪物', '远程'] },
  { id: 'kn_mob_004', title: '蜘蛛', content: '蜘蛛白天不主动攻击（除非被攻击），夜晚会攻击玩家。会爬墙，建议用剑击杀', category: 'combat', tags: ['蜘蛛', '怪物', '爬墙'] },
  { id: 'kn_mob_005', title: '末影人', content: '末影人中立生物，直视其眼睛会激怒它。不怕远程攻击（会瞬移躲避），下雨会受到伤害，怕水', category: 'combat', tags: ['末影人', '怪物', '中立'] },

  // 红石
  { id: 'kn_redstone_001', title: '红石基础', content: '红石粉可以传递红石信号，信号强度随距离衰减（最长 15 格），可用红石中继器延长', category: 'redstone', tags: ['红石', '基础', '电路'] },
  { id: 'kn_redstone_002', title: '红石火把', content: '红石火把是永久的红石信号源，可以激活红石线，但受强充能时熄灭', category: 'redstone', tags: ['红石火把', '信号源', '电路'] },
  { id: 'kn_redstone_003', title: '活塞', content: '活塞可以推动方块（最多 12 个），粘性活塞可以拉回方块', category: 'redstone', tags: ['活塞', '机械', '红石'] },

  // 下界
  { id: 'kn_nether_001', title: '下界传送门', content: '下界传送门由黑曜石搭建（最小 4x5，最大 23x23），用打火石激活。下界 1 格 = 主世界 8 格', category: 'survival', tags: ['下界', '传送门', '黑曜石'] },
  { id: 'kn_nether_002', title: '下界合金', content: '下界合金装备是游戏最强装备。用钻石装备 + 下界合金锭在锻造台升级，不会烧毁在岩浆中', category: 'survival', tags: ['下界合金', '装备', '锻造'] },
];

// ════════════════════════════════════════════════════════════════
// 执行函数
// ════════════════════════════════════════════════════════════════

/**
 * 简单的关键词匹配搜索
 */
function searchKnowledge(query: string, limit: number): KnowledgeEntry[] {
  const keywords = query.toLowerCase().split(/[\s,，、]+/).filter(Boolean);

  // 对每个知识条目计算匹配分数
  const scored = BUILTIN_KNOWLEDGE.map(entry => {
    let score = 0;
    const searchText = `${entry.title} ${entry.content} ${entry.category} ${entry.tags.join(' ')}`.toLowerCase();

    for (const keyword of keywords) {
      if (searchText.includes(keyword)) {
        score += 1;
        // 标题匹配权重更高
        if (entry.title.toLowerCase().includes(keyword)) score += 2;
        if (entry.tags.some(t => t.toLowerCase().includes(keyword))) score += 1.5;
      }
    }

    return { entry, score };
  });

  // 按分数降序排列，返回 top N
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.entry);
}

export async function knowledgeQuery(
  _manager: MemoryManager,
  params: { query: string; limit?: number },
): Promise<ToolResult<{ results: KnowledgeEntry[] }>> {
  const start = Date.now();
  try {
    if (!params.query || params.query.trim().length === 0) {
      return {
        success: false,
        error: '查询参数 query 不能为空',
        duration: Date.now() - start,
      };
    }

    const results = searchKnowledge(params.query, params.limit ?? 5);

    return {
      success: true,
      data: { results },
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      error: `知识查询失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    };
  }
}