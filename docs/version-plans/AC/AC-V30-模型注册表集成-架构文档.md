# Alice Mod Core V30 — 模型注册表集成

> 版本：v1.0
> 日期：2026-07-20
> 版本号：V30
> 关联文档：[需求文档](AC-V30-模型注册表集成-需求文档.md)、[执行文档](AC-V30-模型注册表集成-执行文档.md)

---

## 第1章 系统架构

### 1.1 三层数据源架构

模型元数据采用**三层数据源**架构，按优先级从高到低：

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Layer 1: 远程注册表 (models.dev)             │
│                                                                     │
│  · 启动时异步拉取，缓存到内存 + 本地文件                               │
│  · 每小时后台刷新一次                                                 │
│  · 提供精确的 contextWindow + supportsFunctionCalling                 │
│  · 拉取失败 → 使用本地缓存 / Provider 默认值                            │
└─────────────────────────┬───────────────────────────────────────────┘
                          │  精确匹配 modelName
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Layer 2: Provider 默认值 (PROVIDER_DEFAULTS)       │
│                                                                     │
│  · 内置在代码中，按 providerId 分组                                   │
│  · 覆盖 16 个主流 Provider                                            │
│  · 不需要网络，零延迟                                                  │
└─────────────────────────┬───────────────────────────────────────────┘
                          │  按 providerId 前缀匹配
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Layer 3: 用户手动输入                              │
│                                                                     │
│  · 前端表单允许用户填写 contextWindow 和 FC 支持                       │
│  · 作为最终兜底，适用于私有模型 / 自定义部署                             │
│  · 数据保存到 SQLite，持久化可用                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 模块职责

| 模块 | 文件 | 职责 |
|------|------|------|
| Registry 拉取 | `model-handler.ts` | 启动时异步拉取、缓存、定时刷新 |
| 缓存管理 | `model-handler.ts` | 内存缓存 + 本地文件缓存 |
| 三层查询 | `model-handler.ts` | `getAutoContextWindow()` / `getAutoFC()` 按优先级查询 |
| Provider 默认值 | `model-handler.ts` | `PROVIDER_DEFAULTS` 常量 |
| Provider 统一列表 | `model-handler.ts` | `provider:full-list` IPC 端点 |
| 前端添加表单 | `ModelAddForm.tsx` | 调用 `model:auto-context`，显示自动检测值 |
| 前端模型列表 | `ModelList.tsx` | 从后端获取 Provider 列表，消除硬编码 |

---

## 第2章 数据模型

### 2.1 Registry 响应格式 (models.dev)

```json
{
  "deepseek": {
    "api": "https://api.deepseek.com/v1",
    "env": ["DEEPSEEK_API_KEY"],
    "models": {
      "deepseek/deepseek-v4-flash": {
        "id": "deepseek/deepseek-v4-flash",
        "name": "DeepSeek V4 Flash",
        "tool_call": true,
        "limit": { "context": 65536, "output": 65536 },
        "modalities": { "input": ["text"], "output": ["text"] },
        "cost": { "input": 0.15, "output": 0.6 }
      }
    }
  }
}
```

### 2.2 内部缓存结构

```typescript
interface RegistryCache {
  /** model.id → RegistryModelEntry 的映射 */
  models: Map<string, RegistryModelEntry>
  /** 最后更新时间戳 */
  lastUpdated: number
  /** 缓存是否已过期 */
  expired: boolean
}

interface RegistryModelEntry {
  contextWindow: number
  supportsFunctionCalling: boolean
}
```

### 2.3 Provider 默认值结构

```typescript
const PROVIDER_DEFAULTS: Record<string, { contextWindow: number; supportsFC: boolean }> = {
  openai:    { contextWindow: 128000, supportsFC: true },
  claude:    { contextWindow: 200000, supportsFC: true },
  gemini:    { contextWindow: 1048576, supportsFC: false },
  ollama:    { contextWindow: 4096,   supportsFC: false },
  deepseek:  { contextWindow: 65536,  supportsFC: true },
  qwen:      { contextWindow: 131072, supportsFC: true },
  moonshot:  { contextWindow: 131072, supportsFC: false },
  zhipu:     { contextWindow: 131072, supportsFC: true },
  ernie:     { contextWindow: 131072, supportsFC: true },
  doubao:    { contextWindow: 131072, supportsFC: true },
  yi:        { contextWindow: 32768,  supportsFC: true },
  baichuan:  { contextWindow: 32768,  supportsFC: true },
  minimax:   { contextWindow: 16384,  supportsFC: false },
  spark:     { contextWindow: 8192,   supportsFC: false },
  sensechat: { contextWindow: 131072, supportsFC: false },
  stepfun:   { contextWindow: 8192,   supportsFC: false },
  huggingface: { contextWindow: 8192, supportsFC: false },
}
```

---

## 第3章 关键流程

### 3.1 启动流程

```
应用启动
    │
    ├─ 1. 尝试从本地缓存文件加载注册表数据
    │     ├─ 成功 → 加载到内存，设置 lastUpdated
    │     └─ 失败 → 空缓存
    │
    ├─ 2. 异步拉取远程注册表
    │     ├─ 成功 → 覆盖内存缓存，写入本地文件
    │     └─ 失败 → 保留原有缓存 / Provider 默认值
    │
    └─ 3. 启动定时器 (1 小时间隔)
          └─ 每次触发 → 重新拉取注册表
```

### 3.2 模型查询流程

```
getAutoContextWindow(modelName, providerId)
    │
    ├─ 1. 精确匹配 registry 缓存
    │     ├─ 命中 → 返回 registry 值
    │     └─ 未命中 →
    │           ├─ 2. 按 providerId 查 PROVIDER_DEFAULTS
    │           │     ├─ 命中 → 返回默认值
    │           │     └─ 未命中 → 返回 4096
    │           └─ 3. (前端层) 用户可手动输入覆盖
    │
    └─ 返回结果
```

### 3.3 注册表数据映射

拉取后的注册表数据需要映射到内部格式：

```
registry model.id = "deepseek/deepseek-v4-flash"  → 缓存 key: "deepseek/deepseek-v4-flash"
registry model.tool_call                         → supportsFunctionCalling
registry model.limit.context                      → contextWindow
```

---

## 第4章 接口设计

### 4.1 IPC 接口

| 频道 | 方向 | 参数 | 返回值 | 说明 |
|------|------|------|--------|------|
| `model:auto-context` | 渲染器 → 主进程 | `{ modelName }` | `{ contextWindow, supportsFunctionCalling }` | 三层查询 |
| `provider:full-list` | 渲染器 → 主进程 | 无 | `[{ id, name, baseUrl }]` | 返回所有内置 Provider |
| `model:list` | 渲染器 → 主进程 | 无 | `ModelConfigItem[]` | 列出已保存模型 |
| `model:add` | 渲染器 → 主进程 | `ModelConfigItem` | `{ success }` | 添加模型（含自动配置） |

### 4.2 内部接口

```typescript
/** 初始化注册表（启动时调用） */
function initModelRegistry(): Promise<void>

/** 注册表缓存查询 */
function getRegistryContextWindow(modelName: string): number | null
function getRegistryFC(modelName: string): boolean | null

/** Provider 默认值查询 */
function getProviderDefaultContextWindow(providerId: string): number | null
function getProviderDefaultFC(providerId: string): boolean | null

/** 三层聚合查询（供 IPC handler 调用） */
function getAutoContextWindow(modelName: string, providerId: string): number
function getAutoFC(modelName: string, providerId: string): boolean
```