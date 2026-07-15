# Alice Mod Core V17 — 提示词模板 JSON 存储重构

> 版本：v1.0
> 日期：2026-07-15
> 版本号：V17
> 关联文档：[AC-V5-提示词工程.md](AC-V5-提示词工程.md)、[AC-V16-智能体创建向导-架构文档.md](AC-V16-智能体创建向导-架构文档.md)

---

## 第1章 概述

### 1.1 背景

现有提示词系统（V5）中，所有模板数据（身份模板、工作流模板、性格特征库、行为规范预设）都以 **TypeScript 硬编码** 形式定义在代码文件中。这种方式存在以下问题：

| 问题 | 影响 |
|------|------|
| 数据与逻辑耦合 | 修改模板需要修改 TypeScript 代码，增加出错风险 |
| 添加模板需要改代码 | 内置模板必须编辑 `.ts` 文件并重新构建 |
| 用户自定义模板无持久化 | `DefaultTemplateRegistry` 仅保存在内存，重启丢失 |
| 难以工具化编辑 | 无法通过 UI 直接管理模板内容 |

### 1.2 目标

- 将内置模板数据迁移到 **JSON 文件** 中存储
- 保留 TypeScript 硬编码数据作为 **Fallback**（JSON 加载失败时使用）
- 用户自定义模板通过 **SQLite 持久化**
- 提供 **统一的管理入口**（PromptTemplateManager）
- 提供 **IPC 接口** 供前端调用
- **向后兼容**：所有现有导出和函数保持可用

### 1.3 核心变更

| 变更项 | 现状 | 目标 |
|--------|------|------|
| 模板存储 | TypeScript 硬编码对象 | JSON 文件 + 内存缓存 |
| 加载策略 | 模块加载时直接可用 | 优先 JSON → Fallback 硬编码 |
| 用户模板持久化 | 内存 Map（重启丢失） | SQLite `prompt_templates` 表 |
| 管理入口 | 分散在多个模块 | 统一的 `PromptTemplateManager` |
| IPC 接口 | 无 | 13 个模板相关 IPC Channel |

---

## 第2章 架构设计

### 2.1 数据流

```
┌──────────────────────────────────────────────────────────────────────┐
│                          PromptTemplateManager                       │
│                                                                      │
│  初始化:                                                            │
│    ├─ loadIdentityTemplates()    ──→ templates/identities/*.json     │
│    │                                (Fallback: identity-templates.ts)│
│    ├─ loadWorkflowTemplates()    ──→ templates/workflows/*.json      │
│    │                                (Fallback: workflow-templates.ts)│
│    ├─ loadPersonalityLibrary()   ──→ templates/personalities/*.json │
│    │                                (Fallback: personality-library.ts)│
│    ├─ loadBehaviorPresets()      ──→ templates/behaviors/*.json     │
│    │                                (Fallback: behavior-presets.ts)  │
│    └─ loadCustomTemplates()      ──→ SQLite: prompt_templates 表    │
│                                                                      │
│  运行时:                                                            │
│    ├─ 内置模板: get/listIdentityTemplate()    ← identityTemplates[] │
│    ├─ 工作流:   get/listWorkflowTemplate()    ← workflowTemplates[] │
│    ├─ 性格:     getPersonalityByCategory()    ← personalityLibrary  │
│    ├─ 行为:     get/listBehaviorPreset()      ← behaviorPresets[]   │
│    └─ 自定义:   save/get/delete/listCustom()  ← customTemplates[]   │
│                                                  ↕ (SQLite 同步)    │
│                                               prompt_templates 表   │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 文件结构

```
packages/agent-core/src/main/prompt/
├── prompt-template-manager.ts     ← 新增：统一的模板管理器（单例）
├── template-registry.ts           ← 修改：委托 PromptTemplateManager
├── index.ts                       ← 修改：导出 PromptTemplateManager
├── types.ts                       ← 不变：所有类型定义
├── agent/
│   ├── identity-templates.ts      ← 修改：添加 JSON 优先加载逻辑
│   ├── workflow-templates.ts      ← 修改：添加 JSON 优先加载逻辑
│   ├── personality-library.ts     ← 修改：添加 JSON 优先加载逻辑
│   ├── behavior-presets.ts        ← 修改：添加 JSON 优先加载逻辑
│   ├── agent-profile.ts           ← 不变
│   ├── behavior-rules.ts          ← 不变
│   └── prompt-fragments.ts        ← 不变
├── templates/                     ← 新增：JSON 模板文件目录
│   ├── identities/                ← 7 个身份模板 JSON
│   │   ├── default.json
│   │   ├── logistics.json
│   │   ├── survival_companion.json
│   │   ├── killer.json
│   │   ├── builder.json
│   │   ├── explorer.json
│   │   └── farmer.json
│   ├── workflows/                 ← 7 个工作流模板 JSON
│   │   ├── explore_gather.json
│   │   ├── combat_loot.json
│   │   ├── build_construct.json
│   │   ├── guard_patrol.json
│   │   ├── farm_harvest.json
│   │   ├── mine_quarry.json
│   │   └── trade_barter.json
│   ├── personalities/
│   │   └── personality-library.json  ← 36 个性格特征
│   └── behaviors/
│       └── behavior-presets.json     ← 8 个行为预设

packages/agent-core/src/main/ipc/
├── template-handler.ts           ← 新增：模板 CRUD IPC Handler

packages/agent-core/src/main/database/
├── database-manager.ts           ← 修改：添加 prompt_templates 表
```

### 2.3 加载策略（优先级）

```
JSON 文件存在？ ──是──→ 从 JSON 加载
      │
      否
      │
      ▼
TypeScript 硬编码数据（Fallback）
```

- JSON 加载成功 → 使用 JSON 数据
- JSON 目录/文件不存在 → 静默 Fallback 到 TypeScript 硬编码
- JSON 解析失败 → catch 异常，Fallback 并输出错误日志

### 2.4 SQLite 表结构

```sql
CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('identity', 'workflow', 'personality', 'behavior', 'full_agent')),
  template_json TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

---

## 第3章 核心实现

### 3.1 PromptTemplateManager

**设计模式**：单例（饿汉式，首次 `getInstance()` 时初始化）

```typescript
export class PromptTemplateManager {
  private static instance: PromptTemplateManager;
  private templatesDir: string;

  // 四类内置模板缓存
  private identityTemplates: Map<string, IdentityTemplate>
  private workflowTemplates: Map<string, WorkflowTemplate>
  private personalityLibrary: Map<PersonalityCategory, PersonalityTrait[]>
  private behaviorPresets: Map<string, BehaviorPreset>

  // 用户自定义模板缓存（SQLite 同步）
  private customTemplates: Map<string, UserTemplate>

  static getInstance(): PromptTemplateManager
}
```

**公有 API 分类**：

| 类别 | 方法 |
|------|------|
| 身份模板 | `getIdentityTemplate()`, `listIdentityTemplates()`, `createProfileFromIdentity()` |
| 工作流模板 | `getWorkflowTemplate()`, `listWorkflowTemplates()` |
| 性格特征 | `getPersonalityByCategory()`, `getAllPersonalityCategories()`, `getAllPersonalityTraits()` |
| 行为预设 | `getBehaviorPreset()`, `listBehaviorPresets()`, `getPresetsForIdentity()` |
| 用户模板 CRUD | `saveCustomTemplate()`, `getCustomTemplate()`, `deleteCustomTemplate()`, `listCustomTemplates()` |
| 重新加载 | `reloadBuiltinTemplates()`, `reloadCustomTemplates()` |

### 3.2 向后兼容策略

原有的模板数据文件（`identity-templates.ts` 等）**保留所有硬编码数据**，仅在模块加载时尝试从 JSON 文件提前覆盖：

```
identity-templates.ts 加载流程:
  1. 定义所有硬编码模板常量 (DEFAULT_IDENTITY_TEMPLATE, LOGISTICS_TEMPLATE, ...)
  2. 导出 BUILTIN_IDENTITY_TEMPLATES (硬编码 Record)
  3. 尝试从 templates/identities/*.json 加载
  4. 成功 → 覆盖 BUILTIN_IDENTITY_TEMPLATES 中的条目
  5. 失败 → 静默 Fallback，保留硬编码数据
```

所有依赖 `BUILTIN_IDENTITY_TEMPLATES`、`WORKFLOW_TEMPLATES` 等导出的代码 **无需任何修改**。

### 3.3 IPC 通道

| Channel | 用途 |
|---------|------|
| `template:list-identities` | 列出所有身份模板 |
| `template:get-identity` | 获取单个身份模板 |
| `template:list-workflows` | 列出所有工作流模板 |
| `template:get-workflow` | 获取单个工作流模板 |
| `template:list-personalities` | 列出所有性格特征 |
| `template:list-personality-categories` | 列出性格类别（含特征） |
| `template:list-behaviors` | 列出所有行为预设 |
| `template:get-behavior` | 获取单个行为预设 |
| `template:custom-list` | 列出用户自定义模板（支持按类型筛选） |
| `template:custom-get` | 获取单个自定义模板 |
| `template:custom-save` | 保存自定义模板 |
| `template:custom-delete` | 删除自定义模板 |
| `template:reload` | 重新加载所有模板 |

---

## 第4章 如何使用

### 4.1 添加新的内置身份模板

只需在 `templates/identities/` 目录下添加一个新的 JSON 文件：

```json
{
  "id": "engineer",
  "name": "工程师",
  "description": "专精红石机械和自动化设计的工程师",
  "identity": "你是一名 Minecraft 红石工程师...",
  "personality": ["有条理", "创造力", "耐心"],
  "rules": { ... },
  "preferences": { ... },
  "recommendedToolCategories": ["block", "inventory", "perception"],
  "recommendedWorkflow": "build_construct"
}
```

重启应用后自动加载，无需修改任何代码。

### 4.2 添加新的工作流模板

在 `templates/workflows/` 目录下添加 JSON 文件：

```json
{
  "id": "enchanting",
  "name": "附魔循环",
  "description": "附魔和经验的标准化流程",
  "applicableScenarios": ["装备强化", "经验利用"],
  "steps": [ ... ]
}
```

### 4.3 保存用户自定义模板（前端）

```typescript
// 通过 IPC 保存自定义模板
await window.electronAPI.invoke('template:custom-save', {
  id: 'my-template-001',
  name: '我的自定义模板',
  description: '自定义描述',
  type: 'identity',
  data: { identity: '...', personality: [...], ... },
  tags: ['custom', 'mine']
})
```

### 4.4 迁移现有硬编码模板到 JSON

1. 创建对应的 JSON 文件在 `templates/` 目录下
2. 可从现有 TypeScript 常量 `JSON.stringify()` 导出
3. 重启应用后自动生效
4. 验证无误后可考虑删除对应的硬编码数据

---

## 第5章 边界与风险

| 场景 | 处理方式 |
|------|----------|
| JSON 目录不存在 | 静默 Fallback 到硬编码数据 |
| JSON 文件格式错误 | catch 异常，Fallback 并输出错误日志 |
| 缺少部分模板 | 按文件逐个加载，不互相影响 |
| SQLite 表不存在 | `loadCustomTemplates` 仅 warn 不报错 |
| 自定义模板保存失败 | 内存缓存成功但 SQLite 持久化失败时记录 error 日志 |
| 同 ID 覆盖 | 内置模板优先于硬编码，用户模板通过 `INSERT OR REPLACE` |
| 删除内置模板 | `deleteCustomTemplate()` 使用 `AND is_builtin=0` 防止误删 |
| `BUILTIN_IDENTITY_TEMPLATES` 引用 | 因为是 `Record` 对象，修改属性不违反 `const` 语义 |

---

## 第6章 验证清单

| # | 验证项 | 预期 |
|---|--------|------|
| 1 | `listIdentityTemplates()` 返回 7 个模板 | ✅ / ❌ |
| 2 | 修改 `logistics.json` 后重启，数据生效 | ✅ / ❌ |
| 3 | 删除 `templates/identities/` 目录后重启，数据从 Fallback 加载 | ✅ / ❌ |
| 4 | `saveCustomTemplate()` 保存的模板在 `listCustomTemplates()` 出现 | ✅ / ❌ |
| 5 | 重启应用后自定义模板从 SQLite 恢复 | ✅ / ❌ |
| 6 | IPC `template:list-identities` 返回正确数据 | ✅ / ❌ |
| 7 | IPC `template:custom-save` → `template:custom-get` 数据一致 | ✅ / ❌ |
| 8 | 原有代码 import `BUILTIN_IDENTITY_TEMPLATES` 仍可正常使用 | ✅ / ❌ |
