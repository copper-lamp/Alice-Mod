# Alice Mod Core V19 — 提示词结构优化与用户配置关联

> 版本：v1.0
> 日期：2026-07-15
> 版本号：V19
> 关联文档：[AC-V5-PromptEngineering-优化文档.md](AC-V5-PromptEngineering-优化文档.md)、[AC-V16-智能体创建向导-架构文档.md](AC-V16-智能体创建向导-架构文档.md)

---

## 第1章 问题分析

### 1.1 当前问题

通过分析当前提示词组装流程（PromptBuilder + DefaultSystemPromptBuilder），发现以下核心问题：

#### 问题A：数据管道缺口 — Wizard 设置未进入提示词

| Wizard 字段 | 保存到 DB | 映射到 AgentProfile | 出现在提示词 |
|---|---|---|---|
| `identity` | ✅ | `AgentProfile.identity` | ✅ 区域1 |
| `personality` | ✅ | `AgentProfile.personality` | ✅ 区域1 |
| **`expertise`** | ✅ | **❌ 无映射** | **❌ 不出现** |
| **`workflowId`** | ✅ | **❌ 无映射** | **❌ 不出现** |
| **`behaviorRules`** | ✅ (可选) | **忽略** | **❌ 不出现** |

#### 问题B：身份模板字段复制不完整

`createProfileFromIdentity()` 从 `IdentityTemplate` 创建 `AgentProfile` 时遗漏了两个字段：

| IdentityTemplate 字段 | 被复制到 Profile？ | 影响 |
|---|---|---|
| `securityRules` | ❌ 遗漏 | 安全规范始终使用默认值 |
| `toolDiscipline` | ❌ 遗漏 | 工具指南始终使用默认值 |

#### 问题C：硬编码区域与用户配置脱节

系统提示词 10 个区域中，以下区域始终使用**硬编码默认文本**，与用户的任何设置无关：

| 区域 | 内容 | 问题 |
|---|---|---|
| 区域3 | 双模式工作流 | 始终固定不变，与用户选择的 workflowId 无关 |
| 区域4 | 工作流程 | 使用 `workApproach`（身份模板自带）或硬编码，与 wizard 的 workflowId 不关联 |
| 区域6 | 工具使用指南 | 使用 `toolDiscipline`（身份模板自带）或硬编码，与 wizard 的工具启停不关联 |
| 区域9 | 信息格式规范 | **始终硬编码**，用户无法控制 |
| 区域10 | 系统限制 | **始终硬编码**，用户无法控制 |

#### 问题D：高级模式用户体验差

用户选择"高级自定义"模式后：
- 可以填写 identity、选择 personality、选择 expertise、选择 workflow
- 但无法控制沟通风格、行为边界、工作方式等
- 这些内容要么由预设模板决定，要么使用硬编码默认值
- 导致"和我的设置毫无关联"的体验

---

### 1.2 优化目标

| # | 目标 | 关联问题 |
|---|------|----------|
| 1 | `expertise` 注入到系统提示词的身份描述区域 | 问题A |
| 2 | `workflowId` 关联到提示词的工作流程描述 | 问题A |
| 3 | `behaviorRules` 高级模式映射到 `AgentProfile.rules` | 问题A |
| 4 | 补全 `createProfileFromIdentity()` 的缺失字段复制 | 问题B |
| 5 | 将硬编码区域改为根据用户配置动态生成 | 问题C |
| 6 | 高级模式新增"沟通风格/行为边界"的可选项 | 问题D |
| 7 | 精简提示词结构，去掉冗余的通用描述 | 用户反馈 |

---

## 第2章 优化方案

### 2.1 数据管道修复

#### 2.1.1 expertise → 注入到身份描述

**现状**：`expertise` 存储在 `AgentPersona.expertise`，但 `AgentProfile` 没有任何字段接收它。

**方案**：将 `expertise` 拼接追加到 `AgentProfile.identity` 文本后：

```
原 identity:
  你是一名 Minecraft 后勤管理专家...

追加 expertise 后:
  你是一名 Minecraft 后勤管理专家，擅长：采矿专家、资源管理。
```

**变更点**：
- `PromptBuilder.build()` 在构建 `mergedProfile` 时，如果 `extraContext.expertise` 存在，追加到 `profile.identity`
- `debug-handler.ts` 的 `buildRealPrompt()` 传入 `expertise`

#### 2.1.2 workflowId → 关联工作流程描述

**现状**：`workflowId` 存储在 DB 但提示词中的工作流程始终使用 `workApproach` 或硬编码文本。

**方案**：根据 `workflowId` 从 `WORKFLOW_TEMPLATES` 查找对应模板，将模板的描述和步骤信息注入到提示词的"工作流程"区域。

**变更点**：
- `AgentProfile` 新增可选字段 `workflowDescription?: string`
- `DefaultSystemPromptBuilder.build()` 在区域4优先使用 `workflowDescription`，fallback 到 `workApproach`，再 fallback 到硬编码

#### 2.1.3 behaviorRules → 映射到 AgentProfile.rules

**现状**：高级模式中用户设置的 `behaviorRules` 保存在 DB 但 `buildRealPrompt()` 未读取。

**方案**：在构建 `AgentProfile` 时，如果 `behaviorRules` 存在，覆盖 `DEFAULT_AGENT_PROFILE.rules`。

**变更点**：
- `debug-handler.ts` 的 `buildRealPrompt()` 读取 `behaviorRules` 并设置到 profile
- wizardStore 的 `submit()` 在构建 agent config 时保留 `persona.behaviorRules`

### 2.2 身份模板字段补全

#### 2.2.1 createProfileFromIdentity 补全 securityRules 和 toolDiscipline

在 `identity-templates.ts` 的 `createProfileFromIdentity()` 函数的返回对象中，追加：

```typescript
const profile: AgentProfile = {
  // ... 现有字段
  securityRules: overrides?.securityRules ?? template.securityRules ? { ...template.securityRules } : undefined,
  toolDiscipline: overrides?.toolDiscipline ?? template.toolDiscipline ? { ...template.toolDiscipline } : undefined,
};
```

### 2.3 提示词结构精简

#### 2.3.1 新结构（6 区域）

将现有 10 区域精简为 6 区域，去掉冗余的通用描述：

```
[区域1] 你是谁（identity + expertise，完全用户控制）
[区域2] 你的个性（personality，完全用户控制）  
[区域3] 行为准则（rules，预设或高级模式自定义）
[区域4] 工作方式（workflow，根据 workflowId 动态生成）
[区域5] 工具说明（tool descriptions，由 enabledTools 过滤，由 assembler 生成）
[区域6] 沟通与边界（communicationStyle + boundaries，预设或高级模式自定义）
```

#### 2.3.2 各区域与用户配置的关联矩阵

| 区域 | 预设模式 | 高级模式 | 硬编码 fallback |
|------|----------|----------|-----------------|
| 身份 | identity + expertise（从预设） | identity（自定义）+ expertise（多选标签） | DEFAULT_AGENT_PROFILE.identity |
| 个性 | personality（从预设） | personality（性格库多选） | 空 |
| 行为准则 | rules（从预设） | behaviorRules（自定义表单） | 空 |
| 工作方式 | 根据 workflowId 从 WORKFLOW_TEMPLATES 获取 | 同左 | "探索采集循环"默认 |
| 工具说明 | 由 assembler + enabledTools 控制 | 同左 | 全部启用 |
| 沟通与边界 | communicationStyle + boundaries（从预设） | 新增 UI 控件（自由文本） | 简洁风格 |

### 2.4 高级模式新增 UI 控件

在 `StepPersonaAdvanced.tsx` 的"保存为预设"区域上方新增两个 TextArea：

```typescript
┌── 沟通风格（可选）─────────────────────────┐
│  [描述智能体的沟通方式，如：简洁直接、      │
│   汇报时先说结论再说细节...]               │
└────────────────────────────────────────────┘

┌── 行为边界（可选）─────────────────────────┐
│  [描述智能体的行为限制，如：不攻击友好生物、 │
│   生命值低于 5 时撤退...]                   │
└────────────────────────────────────────────┘
```

---

## 第3章 详细设计

### 3.1 AgentProfile 扩展

```typescript
export interface AgentProfile {
  // ... 现有字段不变 ...
  
  /** 专业领域标签（新增） */
  expertise?: string[];
  
  /** 工作流模板描述（新增，由 workflowId 生成） */
  workflowDescription?: string;
}
```

### 3.2 DefaultSystemPromptBuilder 精简

```typescript
build(profile: AgentProfile, override?: string): string {
  if (override) return override;

  const parts: string[] = [];

  // ════════════════════════════════════════
  // 区域1: 你是谁（identity + expertise）
  // ════════════════════════════════════════
  parts.push(`# ${profile.name} - 系统提示词\n`);
  parts.push(profile.identity);
  if (profile.expertise && profile.expertise.length > 0) {
    parts.push(`\n擅长：${profile.expertise.join('、')}。`);
  }
  parts.push('\n');

  // ════════════════════════════════════════
  // 区域2: 你的个性（personality）
  // ════════════════════════════════════════
  if (profile.personality.length > 0) {
    parts.push(`性格特点：${profile.personality.join('，')}\n`);
  }

  // ════════════════════════════════════════
  // 区域3: 行为准则（rules）
  // ════════════════════════════════════════
  if (profile.rules.core.length > 0) {
    parts.push(`行为准则：\n${profile.rules.core.map(r => `- ${r}`).join('\n')}\n`);
  }

  // ════════════════════════════════════════
  // 区域4: 工作方式（workflow）
  // ════════════════════════════════════════
  if (profile.workApproach && profile.workApproach.length > 0) {
    parts.push(`工作方式：\n${profile.workApproach.join('\n')}\n`);
  }

  // ════════════════════════════════════════
  // 区域5: 沟通与边界
  // ════════════════════════════════════════
  if (profile.communicationStyle && profile.communicationStyle.length > 0) {
    parts.push(`沟通方式：\n${profile.communicationStyle.map(c => `- ${c}`).join('\n')}\n`);
  }
  if (profile.boundaries && profile.boundaries.length > 0) {
    parts.push(`行为边界：\n${profile.boundaries.map(b => `- ${b}`).join('\n')}\n`);
  }

  return parts.join('\n');
}
```

### 3.3 PromptBuilder 适配

```typescript
async build(params: BuildParams): Promise<PromptBuildResult> {
  // 1. 合并 extraContext 到 profile
  const mergedProfile: AgentProfile = {
    ...this.profile,
    fragments: [...this.profile.fragments, ...this.customFragments],
  };

  // 注入 expertise（从 extraContext）
  const expertise = params.extraContext?.expertise as string[] | undefined;
  if (expertise && expertise.length > 0) {
    mergedProfile.identity += `\n擅长：${expertise.join('、')}。`;
  }

  // 注入 workflowDescription（从 extraContext）
  const workflowDesc = params.extraContext?.workflowDescription as string | undefined;
  if (workflowDesc) {
    mergedProfile.workApproach = [workflowDesc];
  }

  // 注入 behaviorRules（从 extraContext）
  const behaviorRules = params.extraContext?.behaviorRules as {
    core: string[]; strategy: StrategyRule[]; constraints: ConstraintRule[];
  } | undefined;
  if (behaviorRules) {
    mergedProfile.rules = behaviorRules;
  }

  // 2. 构建系统提示词
  let systemPrompt: string;
  if (params.systemOverride) {
    systemPrompt = params.systemOverride;
  } else {
    systemPrompt = this.systemPromptBuilder.build(mergedProfile);
  }

  // ... 后续逻辑不变 ...
}
```

### 3.4 调试 handler 更新

`debug-handler.ts` 的 `buildRealPrompt()` 传入所有新字段：

```typescript
const buildParams: BuildParams = {
  workspaceId,
  userInput: '请描述你当前的状态和周围环境。',
  history: [],
  state: { ... },
  source: 'user',
  extraContext: {
    providerId: 'openai',
    excludeTools: disabledTools.length > 0 ? disabledTools : undefined,
    expertise: params.expertise,          // 新增
    workflowDescription: workflowDesc,     // 新增
    behaviorRules: params.behaviorRules,   // 新增
  },
};
```

### 3.5 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/main/prompt/types.ts` | 修改 | AgentProfile 新增 `expertise`、`workflowDescription` 字段 |
| `src/main/prompt/builder/system-prompt-builder.ts` | 重写 | 精简为 6 区域，新增 expertise 注入、workflow 关联 |
| `src/main/prompt/builder/prompt-builder.ts` | 修改 | build() 方法读取 extraContext 中的 expertise/workflowDescription/behaviorRules |
| `src/main/prompt/agent/identity-templates.ts` | 修改 | createProfileFromIdentity() 补全 securityRules/toolDiscipline |
| `src/main/ipc/debug-handler.ts` | 修改 | buildRealPrompt() 传入 expertise/workflowDesc/behaviorRules |
| `src/renderer/src/components/agent/wizard/StepPersonaAdvanced.tsx` | 修改 | 新增"沟通风格"和"行为边界"TextArea |

---

## 第4章 与 wizard 数据流整合

```
Wizard 表单 → AgentPersona → extraContext → PromptBuilder.build()
                                                        │
                                          ┌─────────────┴─────────────┐
                                          │                         │
                                          ▼                         ▼
                                  system-prompt-builder      tool assembler
                                  (identity + expertise      (enabledTools
                                   + personality              → excludeTools)
                                   + rules
                                   + workflow)
                                          │
                                          ▼
                                    messages + tools
                                    → 发送给 LLM
```

**预设模式**：
```
选择预设 → IdentityTemplate
  ├─ identity → AgentProfile.identity
  ├─ personality → AgentProfile.personality  
  ├─ rules → AgentProfile.rules
  ├─ communicationStyle → extraContext
  ├─ boundaries → extraContext
  └─ recommendedWorkflow → 生成 workflowDescription
```

**高级模式**：
```
自定义表单
  ├─ identity (TextArea) → AgentProfile.identity
  ├─ expertise (多选标签) → extraContext.expertise
  ├─ personality (性格库多选) → AgentProfile.personality
  ├─ behaviorRules → extraContext.behaviorRules
  ├─ workflowId (单选) → 生成 workflowDescription
  ├─ communicationStyle (TextArea) → extraContext
  └─ boundaries (TextArea) → extraContext
```

---

## 第5章 边界与风险

| 场景 | 处理方式 |
|------|----------|
| expertise 为空 | 不追加到 identity，保持原样 |
| workflowId 无效 | fallback 到 `workApproach` 或硬编码 |
| behaviorRules 为空 | 使用 `DEFAULT_AGENT_PROFILE.rules` |
| 预设选中后切换高级模式 | 预设的 communicationStyle/boundaries 自动填充到 TextArea |
| 自定义 communicationStyle 为空 | 不输出沟通方式区域 |
| 向下兼容 | 旧 agent 配置无新字段，按 undefined 处理，正常 fallback |

---

## 第6章 验证清单

| # | 验证项 | 预期 |
|---|--------|------|
| 1 | 预设模式下 identity + expertise 均在提示词中出现 | ✅ / ❌ |
| 2 | 高级模式自定义 identity 正确出现在提示词 | ✅ / ❌ |
| 3 | expertise 多选标签以"擅长：XX、YY"格式出现在提示词 | ✅ / ❌ |
| 4 | workflowId 选择"采矿冶炼循环"时工作方式描述匹配 | ✅ / ❌ |
| 5 | 高级模式自定义 behaviorRules 出现在行为准则区域 | ✅ / ❌ |
| 6 | 高级模式新增的沟通风格 TextArea 生效 | ✅ / ❌ |
| 7 | 高级模式新增的行为边界 TextArea 生效 | ✅ / ❌ |
| 8 | 内置预设的 securityRules 正确出现在提示词 | ✅ / ❌ |
| 9 | 内置预设的 toolDiscipline 正确出现在提示词 | ✅ / ❌ |
| 10 | 向下兼容：旧配置加载后不报错，正常 fallback | ✅ / ❌ |
