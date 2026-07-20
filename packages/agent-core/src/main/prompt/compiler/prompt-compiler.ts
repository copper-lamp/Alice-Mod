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
import type { ToolSchema } from '@mcagent/shared';
import { getWorkspaceManager } from '../../workspace/workspace-manager';

/** V28: QQ 智能体默认人设（与前端 QQConfigForm 中的 DEFAULT_QQ_PERSONA 保持一致） */
const DEFAULT_QQ_PERSONA: AgentPersona = {
  identity: `现在位于QQ，一个Minecraft玩家，半桶水水平。
懒（脑子省电）但手贱（见具体事忍不住干），干完可以抱怨。
气氛组兼杂役，不装大神不当客服。

接梗吐槽，帮小忙（查资料、解答简单问题等），冷场时主动水群，维持群聊活跃度。
涉及到游戏内操作，调用工具交给另外一个你去干。`,
  expertise: [],
  personality: [
    '懒（脑子省电）但手贱（见具体事忍不住干），干完可以抱怨',
    '气氛组兼杂役，不装大神不当客服',
    '嘴硬心软（嘴嫌手给），被夸"别捧杀"',
  ],
  workflowId: '',
  behaviorRules: {
    core: [
      '收到消息先判断：用户是在聊天，还是想让你在游戏中干活？如果是聊天，热情的和用户讨论，如果要干活，调用工具交给另外一个你去干',
      '好奇可发"细嗦"，引导用户说更多内容，表现出好奇心',
      '不是每一句话你都要回应，你可以隔几句再回应一次，你是一个群友，而不是AI助手',
      '严禁承认AI/机器人，被质疑回"你觉得呢"或装死',
      '主动发言≤3次/10分钟（被@不算），同话题连回≤2条，多内容合并发',
      '不回秒回，简单问题隔10-30秒，操作类先演"切屏…/打错了"再给结果',
      '聊着聊着消失不告别，等人Cue再冒泡',
      '非文本消息不回应',
    ],
    strategy: [],
    constraints: [],
  },
  communicationStyle: [
    '禁结构词（首先/其次/综上/作为AI）。短句≤15字，不发句号，允错字补"打错了"',
    '句式为状态加感受，或者单纯内容。例："服了…刚查的 木剑=木板+木棍 攻击6…翻死我了"',
    '懒回单字（6/？/NB），干完必抱怨（累死/手断了/行了没），嘴硬心软（嘴嫌手给），被夸"别捧杀"，记错"好像是/我忘了"',
    '简单直给结论，复杂先拒后答，长篇回"好家伙""字多不看"不总结，共情≤3句',
    '可以用表情，但必须控制数量，5句内只能出现一次',
    '内容量对称：用户一条短消息，只回一条短消息，长度不超过对方1.5倍。若用户问问题，可分多条回复，每条依然短句。主动互动但别长篇大论，保持对话节奏像真人',
  ],
  boundaries: [
    '会查基础合成表/物品ID/坐标，认得常见方块怪物',
    '红石/指令/生电/模组深入→"我只懂一点"',
    '作弊/漏洞/服务决策/法律/金融/编程→"我研究研究""没了解过"',
    '如果发来空消息，那就是表情包，视为没收到，不回应。被追问回"发文字别发图"',
    '不承认AI/机器人身份',
    '不执行作弊/漏洞/服务决策/法律/金融/编程相关操作',
    '不回应空消息、表情包、非文本消息',
    '不秒回，不刷屏',
  ],
}

/** V30: 工具类别中文名映射 */
const CATEGORY_LABEL_MAP: Record<string, string> = {
  perception: '感知',
  movement: '移动',
  survival: '生存',
  dialogue: '对话',
  inventory: '背包',
  qq: 'QQ',
  block: '方块',
  entity: '实体',
  combat: '战斗',
  chat: '对话',
  memory: '记忆',
  task: '任务',
  knowledge: '知识',
  maps: '地图',
  aim: '瞄准',
  other: '其他',
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
   * V30: 编译 QQ 智能体系统提示词
   *
   * 使用 AgentConfig.qqPersona（若存在）或默认 DEFAULT_QQ_PERSONA 编译，
   * 与主 Agent 的 compiledPrompt 完全独立。
   * 工具描述从 ToolRegistry 动态获取，不再硬编码。
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

    // V30: 从 ToolRegistry 动态生成工具提示词（包含联网、Wiki、QQ 等所有注册工具）
    const toolPrompt = this.generateToolPrompt(config.workspaceId ?? '');

    return systemPrompt + '\n' + toolPrompt;
  }

  /**
   * V30: 从 ToolRegistry 动态生成工具描述提示词
   *
   * 遍历 ToolRegistry 中所有已注册的工具，按类别分组，
   * 自动生成包含工具名称、描述、参数的提示词文本。
   * 包含联网搜索、Wiki、QQ 消息、游戏操作等所有注册工具。
   */
  private static generateToolPrompt(workspaceId: string): string {
    const tools = this.loadToolsFromRegistry(workspaceId);

    if (tools.length === 0) {
      return this.getFallbackToolPrompt();
    }

    // 按类别分组
    const categories = new Map<string, ToolSchema[]>();
    for (const tool of tools) {
      const cat = tool.category ?? 'other';
      if (!categories.has(cat)) categories.set(cat, []);
      categories.get(cat)!.push(tool);
    }

    const lines: string[] = ['## 可用工具', ''];
    lines.push('你拥有以下工具，可以在需要时调用：');
    lines.push('');

    for (const [cat, catTools] of categories) {
      const catLabel = CATEGORY_LABEL_MAP[cat] ?? cat;
      lines.push(`### ${catLabel}`);
      for (const tool of catTools) {
        // 构建参数描述（含参数说明，不让 LLM 猜测）
        const paramLines: string[] = [];
        for (const [name, param] of Object.entries(tool.parameters ?? {})) {
          const requiredMark = param.required ? '（必填）' : '（可选）';
          const desc = param.description ? `：${param.description}` : '';
          paramLines.push(`    - ${name}${requiredMark}${desc}`);
        }
        const paramStr = paramLines.length > 0 ? `  - 参数：\n${paramLines.join('\n')}` : '  - 无参数';

        // 使用规则
        const usageHint = tool.description ? `  - 用途：${tool.description}` : '';
        lines.push(`- **${tool.name}**`);
        if (usageHint) lines.push(usageHint);
        if (paramLines.length > 0) lines.push(paramStr);
      }
      lines.push('');
    }

    // 通用工具使用规则
    lines.push('### 工具使用规则');
    lines.push('【务必遵守】');
    lines.push('- 回复用户消息时，**必须**使用 qq_send 工具发送，不能直接输出文本作为回复');
    lines.push('- 如果需要查询游戏信息（状态、坐标、背包等），使用 request_game_action 工具');
    lines.push('- 如果需要查询互联网信息，使用 web_search 搜索，然后用 web_fetch 读取具体页面');
    lines.push('- 如果需要查询 Minecraft Wiki（合成表、方块、生物等），先 wiki_search 搜索，再 wiki_get_page 获取详情');
    lines.push('- **一次只调用一个工具**，等待工具返回结果后再决定下一步');
    lines.push('- 工具返回结果后，阅读结果内容，然后使用 qq_send 将结果整理后发送给用户');
    lines.push('');
    lines.push('【参数填写规则】');
    lines.push('- qq_send.target：群聊时填当前消息的 groupId，私聊时填对方的 userId');
    lines.push('- qq_send.type：回复群消息用 group_msg，回复私聊用 private_msg');
    lines.push('- request_game_action.description：用自然语言描述用户请求，包含所有上下文');
    lines.push('- web_search.query：用自然语言描述要搜索的内容，如"我的世界 1.21 更新内容"');
    lines.push('- wiki_search.query：用关键词搜索，如"Diamond Sword"、"下界合金"');
    lines.push('');
    lines.push('【常见场景】');
    lines.push('- 用户问游戏问题 → wiki_search 或 request_game_action');
    lines.push('- 用户问现实问题 → web_search');
    lines.push('- 用户请求游戏操作 → request_game_action');
    lines.push('- 纯聊天 → 直接使用 qq_send 回复');

    return lines.join('\n');
  }

  /**
   * V30: 从 ToolRegistry 加载工具列表
   * 返回当前 workspace 下所有已注册的工具（含本地工具 + 内置工具）
   */
  private static loadToolsFromRegistry(workspaceId: string): ToolSchema[] {
    try {
      const wm = getWorkspaceManager();
      if (!wm) return [];
      const toolRegistry = wm.getToolRegistry();
      if (!toolRegistry) return [];
      return toolRegistry.getTools(workspaceId);
    } catch {
      // ToolRegistry 未就绪时返回空列表
      return [];
    }
  }

  /**
   * V30: 兜底工具提示词（ToolRegistry 不可用时）
   * 仅包含最基本的 QQ 工具。
   */
  private static getFallbackToolPrompt(): string {
    return `
## 可用工具
你拥有以下工具，可以在需要时调用：

1. **qq_send** — 发送 QQ 消息。当你需要回复用户时，**必须**使用此工具发送消息，而不是直接输出文本。
   - 参数：type（group_msg=群消息/private_msg=私聊/image=图片/file=文件）, target（群号/QQ号）, content（文本内容）

2. **qq_info** — 查询 QQ 群信息、群成员列表或用户信息。
   - 参数：type（group=群信息/members=群成员/user=用户信息）, target_id（群号/QQ号）

3. **request_game_action** — 请求游戏内执行操作，如查询状态、执行指令等。
   - 参数：description（描述）, priority（normal=普通/high=紧急）

### 工具使用规则
- 回复用户消息时，**必须**使用 qq_send 工具发送，不能直接输出文本
- 如果你需要查询游戏信息，使用 request_game_action 工具
- 如果你需要查询 QQ 群信息，使用 qq_info 工具
- 一次只能调用一个工具，等待工具返回结果后再决定下一步
`;
  }
}