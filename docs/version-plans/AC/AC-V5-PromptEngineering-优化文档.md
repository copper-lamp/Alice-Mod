# V5 提示词工程 — 优化文档

> 版本：v1.1
> 日期：2026-07-05
> 对应：V5 提示词工程模块的提示词内容优化
> 参考来源：ANTHROPIC、DEVIN、CURSOR 系统提示词
> 关联文档：[AC-V5-PromptEngineering.md](AC-V5-PromptEngineering.md)

---

## 目录

1. [优化背景](#1-优化背景)
2. [参考分析](#2-参考分析)
3. [优化方案](#3-优化方案)
4. [代码变更](#4-代码变更)
5. [使用指南](#5-使用指南)
6. [扩展指南](#6-扩展指南)

---

## 1. 优化背景

### 1.1 优化目标

对 V5 提示词工程模块的**系统提示词内容**进行全面优化，引入工业级 AI 系统的提示词设计最佳实践，使生成的系统提示词：

- 更准确地指导 LLM 行为
- 更清晰地定义工作流程
- 更严格地约束行为边界
- 更高效地规范沟通方式

### 1.2 参考来源

优化基于三个业界领先的 AI 系统提示词设计：

| 来源 | 文件 | 行数 | 特点 |
|------|------|------|------|
| **ANTHROPIC** | Claude-Design-Sys-Prompt.txt | 419 行 | 设计专家定位，完整工作流，丰富内容规范，行为边界明确 |
| **DEVIN** | Devin_2.0.txt | 62 行 | 简洁高效，沟通边界清晰，双模式工作法，安全规范 |
| **CURSOR** | Cursor_2.0_Sys_Prompt.txt | 432 行 | 沟通风格直接，工具调用规范详细，代码更改规范 |

---

## 2. 参考分析

### 2.1 ANTHROPIC 提示词分析

**结构特点**：
1. 身份先行："你是专家设计师"
2. 明确禁止行为（Do not divulge）
3. 完整工作流（6 步：理解→探索→计划→构建→完成→验证）
4. 创作规范详细（命名、文件大小、颜色使用、组件库）
5. 验证流程（done → fork_verifier_agent）
6. 上下文管理（snip 机制）

**可借鉴的要点**：

| 要点 | 说明 | 应用方式 |
|------|------|----------|
| **工作流定义** | 6 步清晰流程 | 注入到系统提示词的"工作方式"部分 |
| **行为边界** | 明确禁止什么 | 注入到"行为边界"部分 |
| **内容规范** | 输出格式标准 | 注入到"信息格式规范"部分 |
| **验证流程** | 完成→验证双阶段 | 注入到"工作流程"的迭代验证步骤 |

### 2.2 DEVIN 提示词分析

**结构特点**：
1. 身份定义："软件工程师，real code-wiz"
2. 沟通边界（何时联系用户）
3. 工作方法（困难时先收集信息）
4. 编码最佳实践（不加注释、先理解风格）
5. 双模式（Plan + Standard）
6. 数据安全规范

**可借鉴的要点**：

| 要点 | 说明 | 应用方式 |
|------|------|----------|
| **沟通边界** | 明确定义何时与用户沟通 | 注入到"沟通规范"部分 |
| **信息收集** | 困难时先收集信息再下结论 | 注入到"错误处理"部分 |
| **数据安全** | 不暴露密钥、不泄露系统提示 | 注入到"行为边界"的禁止行为 |
| **编码规范** | 先理解现有代码风格 | 注入到"工作方式"的通用规则 |

### 2.3 CURSOR 提示词分析

**结构特点**：
1. 沟通风格（直接简洁）
2. 工具调用规范（NEVER 提及工具名）
3. 代码更改规范（先读再改、修复错误）
4. 搜索和阅读规范

**可借鉴的要点**：

| 要点 | 说明 | 应用方式 |
|------|------|----------|
| **沟通风格** | 简洁直接，用反引号引用 | 注入到"沟通规范"的第一条 |
| **工具调用规范** | 只在必要时调用 | 注入到"工具使用指南" |
| **错误修复** | 优先修复而非重写 | 注入到"错误处理"的兜底策略 |
| **不主动创建** | 优先编辑现有文件 | 注入到"行为边界"的约束规则 |

---

## 3. 优化方案

### 3.1 系统提示词结构优化

**原结构**（V5 初始版本）：

```
你是 {name}，一个运行在 Minecraft 世界中的 AI 智能体。
## 你的身份
{identity}
## 个性特征
{personality}
## 核心规则
{core rules}
## 策略规则
{strategy rules}
## 约束规则
{constraints}
## 交互格式
- 思考 → 工具调用 → 等待结果 → 分析
```

**优化后的结构**（8 个区域）：

```
# {name} - 系统提示词

## 你是谁
{identity}

## 你的个性
{personality}

## 核心行为规范
### 基本规则
### 决策策略
### 约束边界

## 你的工作方式
### 工作流程（5 步：理解→规划→执行→分析→迭代/汇报）

## 沟通规范
- 简洁直接
- 结构化输出
- 主动汇报
- 问题报告格式
- 何时联系玩家

## 工具使用指南
### 工具调用规范
### 错误处理
### 冲突检测规则

## 行为边界
### 安全红线
### 禁止行为

## 信息格式规范
### 坐标格式
### 物品数量
### 状态报告

## 系统限制
### 能力边界
### 你应该记住
```

### 3.2 身份模板优化

为每个身份模板新增 4 个字段：

| 字段 | 来源 | 说明 |
|------|------|------|
| `communicationStyle` | CURSOR | 沟通风格描述 |
| `workApproach` | ANTHROPIC | 工作流程步骤 |
| `boundaries` | DEVIN | 行为边界规则 |
| `recommendedWorkflow` | ANTHROPIC | 推荐工作流模板 |

### 3.3 行为规范扩展

新增两个行为规范预设：

| 预设 | 来源 | 说明 |
|------|------|------|
| `security_aware` | DEVIN | 信息安全与系统保护规范 |
| `boundary_discipline` | ANTHROPIC | 明确的行为边界规范 |

---

## 4. 代码变更

### 4.1 变更文件清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `types.ts` | 修改 | 为 `AgentProfile` 和 `IdentityTemplate` 添加新字段 |
| `system-prompt-builder.ts` | 重写 | 全新 8 区域结构，注入三大参考最佳实践 |
| `identity-templates.ts` | 修改 | 7 个模板全部添加沟通风格/工作方式/行为边界 |
| `behavior-presets.ts` | 修改 | 新增 `security_aware` 和 `boundary_discipline` 预设 |
| `index.ts` | 修改 | 导出新组件（身份模板、性格库、行为预设、工作流模板、工具提示词规范） |

### 4.2 核心变更说明

#### 4.2.1 `types.ts` — AgentProfile 新增字段

```typescript
export interface AgentProfile {
  // ... 原有字段
  /** 沟通风格（参考 CURSOR 沟通规范） */
  communicationStyle?: string[];
  /** 工作方式（参考 ANTHROPIC 工作流） */
  workApproach?: string[];
  /** 行为边界（参考 DEVIN 安全红线） */
  boundaries?: string[];
}
```

#### 4.2.2 `types.ts` — IdentityTemplate 新增字段

```typescript
export interface IdentityTemplate {
  // ... 原有字段
  /** 沟通风格（参考 CURSOR 沟通规范） */
  communicationStyle?: string[];
  /** 工作方式（参考 ANTHROPIC 工作流） */
  workApproach?: string[];
  /** 行为边界（参考 DEVIN 安全红线） */
  boundaries?: string[];
  /** 推荐工作流模板 */
  recommendedWorkflow?: WorkflowTemplateId;
}
```

#### 4.2.3 `system-prompt-builder.ts` — 优化要点

```typescript
// 优化前的构建逻辑：4 个区域
// 你是 {name}
// ## 你的身份
// ## 核心规则/策略/约束
// ## 交互格式

// 优化后的构建逻辑：8 个区域 + 个性化内容注入
// # {name} - 系统提示词
// ## 你是谁 + 你的个性
// ## 核心行为规范（基本规则/决策策略/约束边界）
// ## 你的工作方式（使用 profile.workApproach 或默认）
// ## 沟通规范（使用 profile.communicationStyle 或默认）
// ## 工具使用指南（工具调用/错误处理/冲突检测）
// ## 行为边界（使用 profile.boundaries 或默认）
// ## 信息格式规范（坐标/物品/状态）
// ## 系统限制（能力边界/记住要点）
```

---

## 5. 使用指南

### 5.1 快速开始

```typescript
import { createProfileFromIdentity, DefaultSystemPromptBuilder } from './prompt';

// 从身份模板创建智能体
const profile = createProfileFromIdentity('logistics', {
  name: '我的后勤助手',
  // 可覆盖任何字段
  boundaries: ['自定义边界规则'],
});

// 构建系统提示词
const builder = new DefaultSystemPromptBuilder();
const systemPrompt = builder.build(profile);
console.log(systemPrompt);
```

### 5.2 自定义模板

```typescript
import { createProfileFromIdentity, DefaultTemplateRegistry } from './prompt';

const registry = new DefaultTemplateRegistry();

// 从身份模板创建
const profile = createProfileFromIdentity('killer', {
  name: '暗影猎手',
  personality: [
    '冷静果断',
    '擅长伏击',
  ],
});

// 保存为自定义模板
registry.saveProfileAsTemplate(profile, '暗影猎手', '夜战特化杀手');
```

### 5.3 组合行为规范

```typescript
import { BehaviorRulesManager, getBehaviorPreset } from './prompt';

const manager = new BehaviorRulesManager();

// 添加安全生存规范
const safePreset = getBehaviorPreset('safe_survival');
if (safePreset) safePreset.core.forEach(r => manager.addCoreRule(r));

// 添加安全屏障规范
const securityPreset = getBehaviorPreset('security_aware');
if (securityPreset) securityPreset.core.forEach(r => manager.addCoreRule(r));
```

---

## 6. 扩展指南

### 6.1 添加新的身份模板

在 `identity-templates.ts` 中添加：

```typescript
const MY_TEMPLATE: IdentityTemplate = {
  id: 'my_custom_role',        // 唯一标识
  name: '自定义角色',            // 显示名称
  description: '描述',          // 简短描述
  identity: '你是一个...',       // 身份描述
  personality: [...],            // 个性特征
  rules: { ... },                // 行为规则
  preferences: { ... },          // 偏好设置
  recommendedToolCategories: [], // 推荐工具分类
  communicationStyle: [...],     // 沟通风格（参考 CURSOR）
  workApproach: [...],           // 工作方式（参考 ANTHROPIC）
  boundaries: [...],             // 行为边界（参考 DEVIN）
  recommendedWorkflow: '...',    // 推荐工作流
};

// 注册到模板映射表
export const BUILTIN_IDENTITY_TEMPLATES: Record<string, IdentityTemplate> = {
  // ... 已有模板
  my_custom_role: MY_TEMPLATE,
};
```

### 6.2 添加新的性格特征

在 `personality-library.ts` 中添加：

```typescript
const MY_TRAITS: PersonalityTrait[] = [
  {
    id: 'my_trait_id',
    description: '特征描述',
    category: 'social',       // 所属类别
    tags: ['标签1', '标签2'],
    conflictsWith: ['other_trait'],  // 冲突特征
  },
];

// 添加到库
export const PERSONALITY_LIBRARY: PersonalityTrait[] = [
  ...SOCIAL_TRAITS,
  ...MY_TRAITS,
  // ...
];
```

### 6.3 添加新的行为规范预设

在 `behavior-presets.ts` 中添加：

```typescript
{
  id: 'my_preset',
  name: '我的预设',
  description: '描述',
  core: ['规则1', '规则2'],
  strategy: [
    { name: '策略名', description: '策略描述', priority: 80 },
  ],
  constraints: [
    { name: '约束名', description: '约束描述', consequence: 'block' },
  ],
  suitableFor: ['default', 'logistics'],
}
```

### 6.4 添加新的工作流模板

在 `workflow-templates.ts` 中添加：

```typescript
const MY_STEPS: WorkflowStep[] = [
  {
    name: '步骤1',
    description: '步骤描述',
    toolCategories: ['movement', 'perception'],
    exitCondition: '退出条件',
  },
  // ...
];

// 添加到列表
export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  // ... 已有模板
  {
    id: 'my_workflow',
    name: '我的工作流',
    description: '描述',
    applicableScenarios: ['场景1'],
    steps: MY_STEPS,
    rulesOverride: { strategy: [...] },
  },
];
```

---

## 附录 A：参考来源对比

| 维度 | ANTHROPIC | DEVIN | CURSOR | 本系统 |
|------|-----------|-------|--------|--------|
| 身份定义 | ✅ 明确 | ✅ 明确 | ✅ 明确 | ✅ 身份模板 |
| 工作流 | ✅ 6 步 | ✅ 双模式 | ❌ 无 | ✅ 5 步 + 模板 |
| 行为边界 | ✅ 详细 | ✅ 明确 | ✅ 包含 | ✅ 3 层(规则/策略/约束) |
| 沟通规范 | ✅ 包含 | ✅ 明显 | ✅ 重点 | ✅ 独立章节 |
| 工具规范 | ❌ 无 | ❌ 无 | ✅ 详细 | ✅ 独立章节 |
| 安全规范 | ❌ 无 | ✅ 重点 | ❌ 无 | ✅ 独立章节 |
| 内容格式 | ✅ 详细 | ❌ 无 | ❌ 无 | ✅ 独立章节 |
| 系统限制 | ✅ 包含 | ✅ 包含 | ✅ 包含 | ✅ 独立章节 |
| 可扩展性 | ❌ 硬编码 | ❌ 硬编码 | ❌ 硬编码 | ✅ 模板化 |
| 身份多样性 | ❌ 单一 | ❌ 单一 | ❌ 单一 | ✅ 7 种内置 |

## 附录 B：优化效果对比

| 指标 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| 系统提示词区域数 | 4 个 | 8 个 | +100% |
| 身份模板字段数 | 9 个 | 13 个 | +44% |
| 行为规范预设数 | 5 个 | 7 个 | +40% |
| 模块导出数 | 10 个 | 25+ 个 | +150% |
| 参考来源 | 无 | 3 个业界系统 | 新增 |
| 个性化内容注入 | 不支持 | 支持 | 新增 |