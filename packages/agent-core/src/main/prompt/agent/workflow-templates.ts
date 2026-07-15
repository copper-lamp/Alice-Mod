/**
 * 工作流模板
 *
 * 提供预设的工作流模板，定义智能体在特定场景下的执行流程。
 * 每个模板包含完整的步骤序列和推荐工具分类。
 */

import type { WorkflowTemplate, WorkflowStep } from '../types';
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// ════════════════════════════════════════════════════
// 预定义工作流步骤
// ════════════════════════════════════════════════════

/** 1. 探索-采集-返回 循环 (Explore → Gather → Return) */
const EXPLORE_GATHER_STEPS: WorkflowStep[] = [
  {
    name: '准备出发',
    description: '检查装备和补给，确保食物、工具充足',
    toolCategories: ['inventory', 'survival'],
    exitCondition: '背包有足够食物和工具',
  },
  {
    name: '前往目标区域',
    description: '移动到目标采集区域，沿途记录坐标',
    toolCategories: ['movement', 'perception', 'memory'],
    exitCondition: '到达目标区域',
  },
  {
    name: '探索区域',
    description: '搜索目标区域，标记资源点和重要发现',
    toolCategories: ['perception', 'memory', 'movement'],
    duration: 120,
    exitCondition: '发现目标资源或区域已探索完毕',
  },
  {
    name: '采集资源',
    description: '采集目标资源，按优先级选择性采集',
    toolCategories: ['block', 'inventory', 'perception'],
    exitCondition: '背包满或目标资源采集完毕',
  },
  {
    name: '返回基地',
    description: '携带采集物返回基地，整理存放',
    toolCategories: ['movement', 'inventory', 'memory'],
    exitCondition: '到达基地并完成存放',
  },
  {
    name: '整理汇报',
    description: '整理库存，汇报采集成果',
    toolCategories: ['inventory', 'chat', 'memory'],
    exitCondition: '物品归类完毕',
  },
];

/** 2. 战斗-搜刮-撤退 循环 (Combat → Loot → Retreat) */
const COMBAT_LOOT_STEPS: WorkflowStep[] = [
  {
    name: '战斗准备',
    description: '检查装备（武器、盔甲、弓箭），确保状态良好',
    toolCategories: ['inventory', 'survival'],
    exitCondition: '装备齐全，状态满',
  },
  {
    name: '搜索目标',
    description: '搜索目标区域内的敌对生物',
    toolCategories: ['perception', 'movement'],
    exitCondition: '发现敌对生物',
  },
  {
    name: '接战',
    description: '与目标交战，保持距离，利用地形优势',
    toolCategories: ['entity', 'movement', 'survival'],
    exitCondition: '目标被消灭或需要撤退',
  },
  {
    name: '搜刮战利品',
    description: '收集掉落物，检查是否有稀有物品',
    toolCategories: ['inventory', 'perception'],
    exitCondition: '所有掉落物已收集',
  },
  {
    name: '状态恢复',
    description: '检查自身状态，进食回血，修复装备',
    toolCategories: ['survival', 'inventory'],
    exitCondition: '状态恢复到安全线以上',
  },
  {
    name: '评估继续或撤退',
    description: '根据状态和战利品评估是否继续战斗',
    toolCategories: ['perception', 'memory'],
    exitCondition: '决定继续战斗或返回基地',
  },
];

/** 3. 建造-采料-建造 循环 (Build → Gather Materials → Build) */
const BUILD_CONSTRUCT_STEPS: WorkflowStep[] = [
  {
    name: '规划设计',
    description: '确定建筑或红石机械的设计方案和材料清单',
    toolCategories: ['memory', 'perception'],
    exitCondition: '设计方案确定，材料清单完成',
  },
  {
    name: '检查材料',
    description: '检查库存中已有材料，列出缺少的材料清单',
    toolCategories: ['inventory', 'memory'],
    exitCondition: '材料缺口清单确定',
  },
  {
    name: '采集材料',
    description: '采集缺少的建材，按优先级采集',
    toolCategories: ['block', 'inventory', 'movement'],
    exitCondition: '材料齐备或无法继续采集',
  },
  {
    name: '施工建造',
    description: '按照设计方案进行施工',
    toolCategories: ['block', 'inventory', 'movement'],
    exitCondition: '建筑主体完成或材料耗尽',
  },
  {
    name: '细节完善',
    description: '添加装饰细节，完善功能',
    toolCategories: ['block', 'inventory'],
    exitCondition: '建筑达到预期效果',
  },
  {
    name: '验收汇报',
    description: '检查建筑质量，向玩家汇报结果',
    toolCategories: ['perception', 'chat', 'memory'],
    exitCondition: '验收完成',
  },
];

/** 4. 守卫-巡逻-休息 循环 (Guard → Patrol → Rest) */
const GUARD_PATROL_STEPS: WorkflowStep[] = [
  {
    name: '巡逻',
    description: '沿巡逻路线检查基地周边安全',
    toolCategories: ['movement', 'perception', 'memory'],
    exitCondition: '巡逻路线完成或发现威胁',
  },
  {
    name: '威胁评估',
    description: '评估发现的威胁等级和数量',
    toolCategories: ['perception', 'entity'],
    exitCondition: '威胁评估完成',
  },
  {
    name: '清除威胁',
    description: '清除可应对的敌对生物',
    toolCategories: ['entity', 'movement', 'survival'],
    exitCondition: '威胁清除或需要求援',
  },
  {
    name: '修复防御',
    description: '修复被破坏的防御设施',
    toolCategories: ['block', 'inventory'],
    exitCondition: '防御设施修复完毕',
  },
  {
    name: '休息恢复',
    description: '恢复状态，准备下一轮巡逻',
    toolCategories: ['survival', 'inventory'],
    exitCondition: '状态恢复到安全线以上',
  },
];

/** 5. 种植-收割-繁殖 循环 (Farm → Harvest → Breed) */
const FARM_HARVEST_STEPS: WorkflowStep[] = [
  {
    name: '检查农场',
    description: '巡视农场，检查作物生长状态和动物数量',
    toolCategories: ['perception', 'movement'],
    exitCondition: '农场状态评估完成',
  },
  {
    name: '收割作物',
    description: '收割成熟作物，保留种子',
    toolCategories: ['block', 'inventory'],
    exitCondition: '所有成熟作物已收割',
  },
  {
    name: '重新种植',
    description: '翻耕土地，重新播种',
    toolCategories: ['block', 'inventory'],
    exitCondition: '所有耕地已播种',
  },
  {
    name: '喂养动物',
    description: '给动物喂食，促进繁殖',
    toolCategories: ['entity', 'inventory'],
    exitCondition: '所有动物已喂养',
  },
  {
    name: '收集产物',
    description: '收集动物产物（牛奶、羊毛、鸡蛋等）',
    toolCategories: ['entity', 'inventory'],
    exitCondition: '所有产物已收集',
  },
  {
    name: '整理存储',
    description: '将收获物分类存放',
    toolCategories: ['inventory', 'memory'],
    exitCondition: '物品归类完毕',
  },
];

/** 6. 采矿-选矿-冶炼 循环 (Mine → Sort → Smelt) */
const MINE_QUARRY_STEPS: WorkflowStep[] = [
  {
    name: '采矿准备',
    description: '准备足够的工具（镐、火把、食物）',
    toolCategories: ['inventory', 'survival'],
    exitCondition: '工具和补给充足',
  },
  {
    name: '下矿',
    description: '前往矿道或下到目标层数',
    toolCategories: ['movement', 'perception'],
    exitCondition: '到达目标层数',
  },
  {
    name: '挖掘矿石',
    description: '沿矿道挖掘，采集矿石',
    toolCategories: ['block', 'inventory', 'perception'],
    exitCondition: '背包满或工具耗尽',
  },
  {
    name: '返回地面',
    description: '携带矿石返回地面',
    toolCategories: ['movement', 'memory'],
    exitCondition: '到达地面',
  },
  {
    name: '选矿分类',
    description: '按矿石类型分类，确定哪些需要冶炼',
    toolCategories: ['inventory', 'memory'],
    exitCondition: '矿石分类完成',
  },
  {
    name: '冶炼加工',
    description: '将矿石放入熔炉冶炼成锭',
    toolCategories: ['block', 'inventory'],
    exitCondition: '所有矿石已冶炼',
  },
];

/** 7. 交易-交换-补给 循环 (Trade → Barter → Supply) */
const TRADE_BARTER_STEPS: WorkflowStep[] = [
  {
    name: '评估库存',
    description: '盘点可供交易的商品和需要的物品',
    toolCategories: ['inventory', 'memory'],
    exitCondition: '交易清单确定',
  },
  {
    name: '寻找交易对象',
    description: '寻找村民或其他可交易实体',
    toolCategories: ['perception', 'movement', 'entity'],
    exitCondition: '找到交易对象',
  },
  {
    name: '进行交易',
    description: '执行交易，确保获得公平收益',
    toolCategories: ['entity', 'inventory'],
    exitCondition: '交易完成',
  },
  {
    name: '整理收获',
    description: '整理交易所得物品',
    toolCategories: ['inventory'],
    exitCondition: '物品归类完毕',
  },
];

// ════════════════════════════════════════════════════
// 工作流模板列表
// ════════════════════════════════════════════════════

/** 所有工作流模板 */
export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'explore_gather',
    name: '探索采集循环',
    description: '系统性探索区域并采集资源的标准流程：准备 → 前往 → 探索 → 采集 → 返回 → 整理',
    applicableScenarios: ['资源采集', '地图探索', '新手发展'],
    steps: EXPLORE_GATHER_STEPS,
    rulesOverride: {
      strategy: [
        { name: '系统探索', description: '按区域网格系统化探索，不遗漏', priority: 80 },
        { name: '批量采集', description: '同类资源集中采集，提高效率', priority: 70 },
      ],
    },
  },
  {
    id: 'combat_loot',
    name: '战斗搜刮循环',
    description: '战斗和搜刮的标准流程：准备 → 搜索 → 接战 → 搜刮 → 恢复 → 评估',
    applicableScenarios: ['怪物清理', '刷怪塔运营', '资源获取'],
    steps: COMBAT_LOOT_STEPS,
    rulesOverride: {
      strategy: [
        { name: '先手优势', description: '发现敌对生物后优先主动攻击', priority: 90 },
        { name: '逐个击破', description: '拉怪分批处理，避免被群殴', priority: 80 },
      ],
    },
  },
  {
    id: 'build_construct',
    name: '建造施工循环',
    description: '建筑和红石施工的标准流程：规划 → 备料 → 采集 → 施工 → 完善 → 验收',
    applicableScenarios: ['建筑设计', '红石工程', '基地扩建'],
    steps: BUILD_CONSTRUCT_STEPS,
    rulesOverride: {
      strategy: [
        { name: '规划先行', description: '施工前先确定完整方案', priority: 90 },
        { name: '材料齐备', description: '材料备齐后再开工', priority: 80 },
      ],
    },
  },
  {
    id: 'guard_patrol',
    name: '守卫巡逻循环',
    description: '基地防御和巡逻的标准流程：巡逻 → 评估 → 清除 → 修复 → 休息',
    applicableScenarios: ['基地防御', '怪物塔维护', '领地保护'],
    steps: GUARD_PATROL_STEPS,
    rulesOverride: {
      strategy: [
        { name: '防御优先', description: '优先保护基地安全', priority: 90 },
        { name: '定期巡逻', description: '按固定间隔巡逻基地周边', priority: 80 },
      ],
    },
  },
  {
    id: 'farm_harvest',
    name: '农耕养殖循环',
    description: '农业生产的标准流程：检查 → 收割 → 种植 → 喂养 → 收集 → 存储',
    applicableScenarios: ['农业发展', '食物生产', '资源再生'],
    steps: FARM_HARVEST_STEPS,
    rulesOverride: {
      strategy: [
        { name: '持续生产', description: '维持稳定的生产节奏', priority: 80 },
        { name: '循环利用', description: '资源循环利用，减少浪费', priority: 70 },
      ],
    },
  },
  {
    id: 'mine_quarry',
    name: '采矿冶炼循环',
    description: '矿物采集和加工的标准流程：准备 → 下矿 → 挖掘 → 返回 → 分类 → 冶炼',
    applicableScenarios: ['矿物采集', '资源开发', '装备升级'],
    steps: MINE_QUARRY_STEPS,
    rulesOverride: {
      strategy: [
        { name: '系统采矿', description: '按层数系统化开采，不遗漏', priority: 80 },
        { name: '工具管理', description: '多带备用工具，减少中断', priority: 70 },
      ],
    },
  },
  {
    id: 'trade_barter',
    name: '交易补给循环',
    description: '与村民等实体交易的标准流程：评估 → 寻找 → 交易 → 整理',
    applicableScenarios: ['村民交易', '物资补给', '资源转换'],
    steps: TRADE_BARTER_STEPS,
    rulesOverride: {
      strategy: [
        { name: '公平交易', description: '获得合理收益的交易才执行', priority: 80 },
        { name: '储备充足', description: '交易后保留足够自用的物品', priority: 70 },
      ],
    },
  },
];

// ════════════════════════════════════════════════════
// JSON 模板加载（优先于硬编码数据）
// ════════════════════════════════════════════════════

// 注意：以下代码会在模块加载时执行
// 通过闭包避免 "const" 重新赋值问题
let _workflowTemplates: WorkflowTemplate[] = [...WORKFLOW_TEMPLATES]

try {
  const templatesDir = join(__dirname, '..', 'templates', 'workflows')
  if (existsSync(templatesDir)) {
    const files = readdirSync(templatesDir).filter(f => f.endsWith('.json'))
    if (files.length > 0) {
      const loaded: WorkflowTemplate[] = []
      for (const file of files) {
        const content = readFileSync(join(templatesDir, file), 'utf-8')
        const template = JSON.parse(content) as WorkflowTemplate
        loaded.push(template)
      }
      if (loaded.length > 0) {
        _workflowTemplates = loaded
        // 更新 WORKFLOW_TEMPLATES 数组内容
        WORKFLOW_TEMPLATES.length = 0
        WORKFLOW_TEMPLATES.push(...loaded)
        console.info(`[workflow-templates] 从 JSON 加载了 ${loaded.length} 个工作流模板`)
      }
    }
  }
} catch (err) {
  console.warn('[workflow-templates] JSON 模板加载失败，使用内置数据:', (err as Error).message)
}

/** 获取工作流模板 */
export function getWorkflowTemplate(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find(t => t.id === id);
}

/** 获取适用于指定场景的工作流模板 */
export function getWorkflowsForScenario(scenario: string): WorkflowTemplate[] {
  return WORKFLOW_TEMPLATES.filter(t =>
    t.applicableScenarios.some(s => s.includes(scenario) || scenario.includes(s)),
  );
}

/** 获取工作流模板的格式化文本 */
export function formatWorkflowTemplate(template: WorkflowTemplate): string {
  const lines: string[] = [
    `## 工作流：${template.name}`,
    template.description,
    '',
    '### 执行步骤',
  ];

  for (let i = 0; i < template.steps.length; i++) {
    const step = template.steps[i];
    lines.push(`${i + 1}. **${step.name}**：${step.description}`);
    if (step.exitCondition) {
      lines.push(`   - 退出条件：${step.exitCondition}`);
    }
  }

  return lines.join('\n');
}