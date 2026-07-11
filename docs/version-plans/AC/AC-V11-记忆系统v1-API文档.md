# V11 记忆系统 v1 — API 使用文档

## 1. 概述

记忆系统 v1 是 Agent Core 的后端记忆模块，为 AI 提供持久化记忆能力。采用 **SQLite + Chroma 双写** 架构：

- **SQLite** — 存储结构化元数据（类型、标签、重要度、TTL），支持条件检索和分页
- **Chroma** — 向量索引，支持语义相似度检索
- **EmbeddingModel** — 将记忆内容转为向量，支持 OpenAI 和 Ollama 两种 Provider

### 模块导出

所有公开 API 通过 `@mcagent/agent-core` 的 `src/main/memory/index.ts` 导出：

```typescript
import {
  MemoryManager,
  CleanupEngine,
  SQLiteStore,
  ChromaStore,
  EmbeddingStrategy,
  createEmbeddingModel,
  MEMORY_TOOL_SCHEMAS,  // 11 个 ToolSchema，用于注册到 ToolRegistry
  // 类型
  Memory, MemoryType, MemoryBranch,
  MemoryConfig, MemoryStats,
  StoreParams, RecallParams, SimilarParams,
  // ... 其他类型
} from '@mcagent/agent-core';
```

---

## 2. 快速开始

### 2.1 最小初始化

```typescript
import { MemoryManager, DEFAULT_MEMORY_CONFIG } from '@mcagent/agent-core';

const manager = new MemoryManager({
  sqlitePath: './data/memory.db',
  chroma: {
    clientType: 'http',
    url: 'http://localhost:8000',
    collectionName: 'mcagent_memories',
  },
  embedding: {
    provider: 'openai',
    model: 'text-embedding-3-small',
    dimension: 1536,
    apiKey: process.env.OPENAI_API_KEY,
  },
});

await manager.init();
```

### 2.2 存储一条记忆

```typescript
const { id, createdAt } = await manager.store({
  type: 'task_experience',
  branch: 'experience',
  content: {
    task: 'mine_diamond',
    description: '在 y=11 发现钻石矿脉',
    result: 'success',
  },
  tags: ['mining', 'diamond', 'important'],
  importance: 8,       // 1-10，默认 5
  expiresAt: null,     // 永不过期
}, 'workspace-1');

console.log(`记忆已存储: ${id}`);
```

### 2.3 检索记忆

```typescript
// 按 ID 精确查询
const memory = await manager.getById(id);

// 按条件检索
const result = await manager.recall({
  type: 'task_experience',
  tags: ['mining'],
  minImportance: 5,
  limit: 20,
  offset: 0,
});

// 语义检索（输入自然语言，返回最相似的记忆）
const similar = await manager.recall({
  similarTo: '在哪里可以找到钻石？',
  type: 'task_experience',
  limit: 5,
});
```

### 2.4 更新/删除

```typescript
// 更新内容、重要度、标签
await manager.update(id, {
  content: { task: 'mine_diamond', description: '在 y=-59 发现更多钻石' },
  importance: 10,
  tags: ['mining', 'diamond', 'critical'],
});

// 删除
await manager.forget(id);
```

### 2.5 清理

```typescript
// 清理过期记忆
const result = await manager.cleanup({ mode: 'expired' });
console.log(`删除了 ${result.removed} 条过期记忆`);

// 完整清理（过期 + 低重要度 + 上限控制）
await manager.cleanup({ mode: 'all', importanceThreshold: 2 });
```

---

## 3. 配置

### 3.1 MemoryConfig 完整配置

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `sqlitePath` | `string` | 是 | SQLite 数据库文件路径 |
| `chroma` | `ChromaConfig` | 是 | Chroma 向量数据库配置 |
| `embedding` | `EmbeddingConfig` | 是 | 嵌入模型配置 |
| `autoCleanup` | `AutoCleanupConfig` | 否 | 自动清理配置 |
| `limits` | `MemoryLimits` | 否 | 容量限制 |

### 3.2 ChromaConfig

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `collectionName` | `string` | `'mcagent_memories'` | Chroma 集合名称 |
| `clientType` | `'http' \| 'embedded'` | — | 连接方式 |
| `url` | `string` | — | HTTP 模式下的 URL |
| `persistPath` | `string` | — | 嵌入式模式下的持久化路径 |

### 3.3 EmbeddingConfig

| 字段 | 类型 | 说明 |
|------|------|------|
| `provider` | `'openai' \| 'ollama'` | 嵌入模型提供商 |
| `model` | `string` | 模型名称（如 `text-embedding-3-small`） |
| `apiKey` | `string` | OpenAI 时需要 |
| `baseUrl` | `string` | API 基础地址（可选） |
| `dimension` | `number` | 向量维度 |

### 3.4 默认配置

```typescript
export const DEFAULT_CHROMA_CONFIG: ChromaConfig = {
  collectionName: 'mcagent_memories',
  clientType: 'http',
  url: 'http://localhost:8000',
};

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  provider: 'openai',
  model: 'text-embedding-3-small',
  dimension: 1536,
};

export const DEFAULT_AUTO_CLEANUP_CONFIG: AutoCleanupConfig = {
  enabled: true,
  intervalMs: 86400000, // 24h
  mode: 'all',
  importanceThreshold: 2,
};

export const DEFAULT_MEMORY_LIMITS: MemoryLimits = {
  maxPerType: 1000,
  maxTotal: 10000,
};
```

---

## 4. MemoryManager API

### 4.1 构造函数

```typescript
constructor(
  config: MemoryConfig,
  deps?: {
    sqlite?: SQLiteStore;     // 依赖注入，用于测试
    chroma?: ChromaStore;     // 依赖注入，用于测试
    embedding?: IEmbeddingModel; // 依赖注入，用于测试
    logger?: { warn, info, error };
  },
)
```

### 4.2 初始化

```typescript
async init(): Promise<void>
```

初始化 SQLite 和 Chroma 连接。如果 Chroma 不可用，会自动降级（仅打日志，不影响 SQLite 功能）。

### 4.3 存储方法

#### store

```typescript
async store(params: StoreParams, workspaceId?: string): Promise<StoreResult>
```

存储单条记忆。自动生成 UUID、构建向量、写入 Chroma。

| 参数 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `type` | `MemoryType` | 是 | 记忆类型 |
| `branch` | `MemoryBranch` | 否 | 记忆分支，默认 `'experience'` |
| `content` | `Record<string, unknown>` | 是 | 结构化内容 |
| `tags` | `string[]` | 否 | 标签列表 |
| `importance` | `number` | 否 | 重要度 1-10，默认 5 |
| `expiresAt` | `number \| null` | 否 | 过期时间戳，`null` 永不过期 |

返回 `{ id: string, createdAt: number }`

#### batchStore

```typescript
async batchStore(params: BatchStoreParams, workspaceId?: string): Promise<BatchStoreResult>
```

批量存储多条记忆，比逐条 store 更高效。

| 参数 | 类型 | 说明 |
|------|------|------|
| `items` | `StoreParams[]` | 记忆列表 |

返回 `{ ids: string[], count: number }`

### 4.4 检索方法

#### recall

```typescript
async recall(params: RecallParams): Promise<RecallResult>
```

三种检索模式自动路由：

| 模式 | 条件 | 行为 |
|------|------|------|
| 语义检索 | `params.similarTo` 有值 | 调用 `getSimilar`，返回按相似度排序 |
| ID 查询 | `params.id` 有值 | 精确查询单条 |
| 条件检索 | 其他 | 按 type/branch/tags/keywords/importance 过滤 |

返回 `{ memories: Memory[], total: number, limit: number, offset: number }`

#### getById

```typescript
async getById(id: string): Promise<Memory | null>
```

精确查询单条记忆。

#### getSimilar

```typescript
async getSimilar(params: SimilarParams): Promise<SimilarResult>
```

语义检索。将查询文本转为向量后在 Chroma 中搜索。

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `query` | `string` | — | 自然语言查询文本 |
| `type` | `MemoryType` | 可选 | 筛选类型 |
| `branch` | `MemoryBranch` | 可选 | 筛选分支 |
| `workspaceId` | `string` | 可选 | 筛选工作区 |
| `limit` | `number` | 10 | 返回数量 |
| `minScore` | `number` | 0.5 | 相似度阈值 |

**降级策略**：Chroma 不可用时自动降级为 SQLite 关键词搜索。

#### list

```typescript
async list(params: ListParams): Promise<ListResult>
```

分页列表查询，支持排序。

### 4.5 更新/删除

#### update

```typescript
async update(id: string, updates: Partial<Memory>): Promise<void>
```

更新记忆。如果 `content` 变更，自动删除旧向量并重新生成新向量。

#### forget

```typescript
async forget(id: string): Promise<void>
```

删除记忆（同时删除 SQLite 记录和 Chroma 向量）。

### 4.6 标签管理

```typescript
async addTag(id: string, tag: string): Promise<void>
async removeTag(id: string, tag: string): Promise<void>
```

添加/移除标签。标签变更不影响向量嵌入。

### 4.7 统计

```typescript
async stats(workspaceId?: string): Promise<MemoryStats>
```

返回统计信息：

| 字段 | 类型 | 说明 |
|------|------|------|
| `total` | `number` | 记忆总数 |
| `byType` | `Partial<Record<MemoryType, number>>` | 按类型分布 |
| `byBranch` | `Partial<Record<MemoryBranch, number>>` | 按分支分布 |
| `totalTags` | `number` | 标签总数 |
| `averageImportance` | `number` | 平均重要度 |
| `oldestMemory` | `number` | 最旧记忆时间戳 |
| `newestMemory` | `number` | 最新记忆时间戳 |
| `unembeddedCount` | `number` | 未嵌入向量数 |

### 4.8 清理

```typescript
async cleanup(options?: CleanupOptions): Promise<CleanupResult>
```

| 选项 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `mode` | `'expired' \| 'low_importance' \| 'all'` | `'all'` | 清理模式 |
| `importanceThreshold` | `number` | 2 | 低重要度阈值 |
| `keepRecent` | `number` | 100 | 保留最近 N 条 |

返回 `{ removed: number, kept: number, details: CleanupDetail[] }`

### 4.9 导出/导入

```typescript
async export(options?: ExportOptions): Promise<string>
async import(json: string): Promise<ImportResult>
```

支持 JSON 数组和 JSONL 两种格式。

```typescript
// 导出
const json = await manager.export({ format: 'json' });
const jsonl = await manager.export({ format: 'jsonl', type: 'task_experience' });

// 导入
const result = await manager.import(json);
console.log(`导入: ${result.imported} 条, 跳过: ${result.skipped} 条`);
```

### 4.10 生命周期

```typescript
async close(): Promise<void>
```

关闭 SQLite 和 Chroma 连接。

---

## 5. 记忆类型与分支

### 5.1 记忆类型（MemoryType）

| 类型 | 值 | 用途 |
|------|----|------|
| 玩家习惯 | `'player_habit'` | 记住玩家偏好和行为模式 |
| 地图关键点 | `'map_point'` | 记住坐标和位置信息 |
| 任务经验 | `'task_experience'` | 记住任务执行经验 |
| 社交关系 | `'social'` | 记住与其他玩家的关系 |
| 技能 | `'skill'` | 记住已学技能 |

### 5.2 记忆分支（MemoryBranch）

| 分支 | 值 | 用途 |
|------|----|------|
| 角色记忆 | `'character'` | 身份、人设、行为特征 |
| 情绪特征 | `'emotion'` | 情绪状态、变化 |
| 环境记忆 | `'environment'` | 场景、坐标、描述 |
| 经验库 | `'experience'` | 交互经验、教训 |
| 知识库 | `'knowledge'` | 领域知识、技能档案 |
| 用户偏好 | `'user_preference'` | 用户信息、偏好 |
| 情绪记录 | `'emotion_log'` | 时序数据 |
| 任务存档 | `'task_archive'` | 预设/自定义任务 |

### 5.3 内容结构建议

不同记忆类型推荐的内容结构：

```typescript
// player_habit — 玩家习惯
{ player: string, preference: string, description: string }

// map_point — 地图点
{ name: string, x: number, y: number, z: number, dimension: string, description: string }

// task_experience — 任务经验
{ task: string, description: string, lesson?: string, result?: string }

// social — 社交关系
{ player: string, relation: string, description: string }

// skill — 技能
{ name: string, description: string, level?: number }
```

---

## 6. 工具 API（ToolSchema）

注册到 `ToolRegistry` 的 8 个工具（11 个 Schema）：

| 工具名 | 说明 | 对应 MemoryManager 方法 |
|--------|------|------------------------|
| `memory_store` | 存储单条记忆 | `manager.store()` |
| `memory_batch_store` | 批量存储记忆 | `manager.batchStore()` |
| `memory_recall` | 检索记忆（ID/条件/语义） | `manager.recall()` / `manager.getSimilar()` |
| `memory_update` | 更新记忆 | `manager.update()` |
| `memory_forget` | 删除记忆 | `manager.forget()` |
| `memory_tag` | 添加标签 | `manager.addTag()` |
| `memory_untag` | 移除标签 | `manager.removeTag()` |
| `memory_stats` | 查看统计 | `manager.stats()` |
| `memory_cleanup` | 清理记忆 | `manager.cleanup()` |
| `memory_export` | 导出记忆 | `manager.export()` |
| `memory_import` | 导入记忆 | `manager.import()` |

注册方式：

```typescript
import { ToolRegistry } from '@mcagent/agent-core';
import { MEMORY_TOOL_SCHEMAS } from '@mcagent/agent-core';

ToolRegistry.register(workspaceId, MEMORY_TOOL_SCHEMAS);
```

---

## 7. CleanupEngine

### 7.1 构造函数

```typescript
constructor(
  manager: MemoryManager,
  config: AutoCleanupConfig,
  limits: MemoryLimits,
  logger?: { info, warn, error },
)
```

### 7.2 方法

| 方法 | 说明 |
|------|------|
| `start()` | 启动定时清理（默认 24h 间隔） |
| `stop()` | 停止定时清理 |
| `run()` | 立即执行一次完整清理 |

### 7.3 清理规则

1. **过期清理** — 删除 `expires_at < now` 的记忆
2. **低重要度清理** — 删除 `importance <= 2` + `access_count = 0` + 30 天前，保留最近 100 条
3. **数量上限控制** — 每类型超过 `maxPerType`（1000）时清理最旧记录；总记录超过 `maxTotal`（10000）时清理最低重要度记录
4. **Chroma 重试嵌入** — 每次清理扫描最多 50 条 `embedding_id = null` 的记录重试

### 7.4 使用示例

```typescript
const cleanup = new CleanupEngine(manager, {
  enabled: true,
  intervalMs: 86400000, // 24h
  mode: 'all',
  importanceThreshold: 2,
}, {
  maxPerType: 1000,
  maxTotal: 10000,
});

cleanup.start();  // 启动后台定时任务

// 在应用关闭时
cleanup.stop();
```

---

## 8. EmbeddingModel

### 8.1 接口

```typescript
interface IEmbeddingModel {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  getDimension(): number;
  healthCheck(): Promise<boolean>;
}
```

### 8.2 工厂函数

```typescript
import { createEmbeddingModel } from '@mcagent/agent-core';

// OpenAI
const model = createEmbeddingModel({
  provider: 'openai',
  model: 'text-embedding-3-small',
  dimension: 1536,
  apiKey: 'sk-xxx',
});

// Ollama
const localModel = createEmbeddingModel({
  provider: 'ollama',
  model: 'nomic-embed-text',
  dimension: 768,
  baseUrl: 'http://localhost:11434',
});
```

### 8.3 EmbeddingStrategy

按记忆类型自动构建嵌入文本：

```typescript
import { EmbeddingStrategy } from '@mcagent/agent-core';

const text = EmbeddingStrategy.buildEmbeddingText(memory);
// player_habit → "玩家 Steve 偏好夜间活动"
// map_point    → "基地 在 100, 64, -200 overworld，特征：主基地"
// task_experience → "任务 mine_diamond：在 y=11 发现钻石"
```

---

## 9. 完整示例

### 9.1 综合使用场景

```typescript
import { MemoryManager, CleanupEngine } from '@mcagent/agent-core';

async function main() {
  const manager = new MemoryManager({
    sqlitePath: './data/memory.db',
    chroma: { clientType: 'http', url: 'http://localhost:8000' },
    embedding: { provider: 'openai', model: 'text-embedding-3-small', dimension: 1536, apiKey: process.env.OPENAI_API_KEY },
    limits: { maxPerType: 500, maxTotal: 5000 },
  });

  await manager.init();

  // 1. 存储多条记忆
  const { id } = await manager.store({
    type: 'map_point',
    content: { name: '钻石矿', x: 100, y: 11, z: -200, dimension: 'overworld' },
    tags: ['mining', 'base'],
    importance: 9,
  });

  await manager.store({
    type: 'task_experience',
    content: { task: '挖矿', lesson: 'y=11 是钻石最佳层数' },
    importance: 7,
  });

  // 2. 语义检索（自动降级）
  const similar = await manager.recall({
    similarTo: '哪里钻石最多？',
    limit: 3,
  });

  // 3. 更新记忆
  await manager.update(id, {
    tags: ['mining', 'base', 'updated'],
    importance: 10,
  });

  // 4. 统计
  const stats = await manager.stats();
  console.log(`记忆总数: ${stats.total}`);

  // 5. 启动自动清理
  const cleanup = new CleanupEngine(manager, {
    enabled: true, intervalMs: 86400000, mode: 'all',
  }, { maxPerType: 1000, maxTotal: 10000 });
  cleanup.start();

  // 6. 关闭
  cleanup.stop();
  await manager.close();
}
```

### 9.2 错误处理

```typescript
try {
  await manager.init();
} catch (err) {
  // Chroma 不可用会自动降级，不会抛出异常
  console.warn('Chroma 初始化失败，语义检索不可用');
}

// 所有操作都包含内部 try-catch
const result = await manager.store({
  type: 'task_experience',
  content: { task: 'test' },
});
// 即使 Chroma 写入失败，SQLite 写入仍然成功
```

---

## 10. 架构说明

### 10.1 数据流

```
[LLM] → memory_store 工具 → MemoryManager.store()
                                 ├── SQLiteStore.saveMeta()    ← 写入元数据（必选）
                                 └── tryEmbed()
                                     ├── EmbeddingStrategy.buildEmbeddingText()
                                     ├── EmbeddingModel.embed()
                                     └── ChromaStore.upsert()   ← 写入向量（失败降级）
```

### 10.2 降级策略

| 场景 | 行为 |
|------|------|
| Chroma 初始化失败 | SQLite 正常可用，语义检索降级为 `LIKE` 搜索 |
| Chroma 写入失败 | SQLite 写入不受影响，日志记录失败，CleanupEngine 重试 |
| Embedding API 失败 | SQLite 写入不受影响，`embeddingId` 保持 `null` |
| 所有操作 | 外层 try-catch 包裹，确保不抛异常到调用方 |

### 10.3 工作区隔离

所有记忆通过 `workspaceId` 字段隔离。`MemoryManager` 方法接受可选的 `workspaceId` 参数，默认 `'default'`。