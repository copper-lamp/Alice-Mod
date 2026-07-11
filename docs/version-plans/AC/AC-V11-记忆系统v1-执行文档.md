# Alice Mod Core V11 — 记忆系统 v1 执行文档

> 版本：v1.0
> 日期：2026-07-11
> 版本号：V11（第 13-14 周）
> 对应需求：AC-MEM-01 ~ AC-MEM-08
> 关联文档：[AC-V11-记忆系统v1.md](AC-V11-记忆系统v1.md)、[AC-02-实施计划.md](AC-02-实施计划.md)、[03-记忆系统接口规范.md](../../api/03-记忆系统接口规范.md)

---

## 1. 目标与范围

### 1.1 本次实现目标

实现 Agent Core 记忆系统的基础版本，建立 SQLite + Chroma 双模存储架构，提供 8 个记忆工具供 LLM 调用。

具体目标：

1. 创建 SQLite 记忆表（memory_meta / memory_tags / memory_access_log）并实现 SQLiteStore CRUD。
2. 集成 Chroma 向量数据库，实现向量存储和语义检索。
3. 封装 EmbeddingModel，支持 OpenAI text-embedding-3-small 和 Ollama 本地模型。
4. 实现 MemoryManager 统一 API，封装 SQLite + Chroma 双写一致性。
5. 实现 8 个记忆工具并注册到工作区工具列表。
6. 实现 CleanupEngine 自动清理引擎。

### 1.2 非目标

- 不实现地图索引系统（V12 实现）。
- 不实现记忆浏览器 UI（V12 实现）。
- 不实现记忆与提示词系统的自动注入对接（V5 已独立，V11 只提供工具供 LLM 主动调用）。
- 不实现 Chroma 服务端自动部署（假设用户已部署 Chroma 服务或使用嵌入式模式）。

### 1.3 前置依赖

| 依赖 | 说明 |
|------|------|
| V3 工作区管理 | 需要 workspaceId 用于记忆隔离 |
| V3 工具注册 | 需要 ToolRegistry 将 8 个记忆工具注册到工作区 |
| better-sqlite3 | 已在 agent-core/package.json 中 |
| chromadb | 需要新增 npm 依赖 |

---

## 2. 关键设计决策

### 2.1 Chroma 集成方式

采用 **HTTP 模式 + 嵌入式模式双支持**：

- **HTTP 模式**：连接外部 Chroma 服务（`chromadb` HTTP API），适用于生产环境。
- **嵌入式模式**：使用 `chromadb-default-embed` 或本地持久化，适用于开发调试。

启动时自动检测：先尝试 HTTP 连接，失败则回退到嵌入式模式。

### 2.2 SQLite + Chroma 双写一致性

| 操作 | SQLite | Chroma | 一致性策略 |
|------|--------|--------|-----------|
| 存储 | 先写 | 后写 | Chroma 写入失败时，SQLite 记录标记 `embedding_id = null`，后续由 CleanupEngine 重试 |
| 检索 | 条件过滤 | 语义搜索 | 优先使用 SQLite 过滤，再按需调用 Chroma |
| 更新 | 更新元数据 | 内容变更时更新向量 | 先更新 SQLite，再更新 Chroma |
| 删除 | 删除元数据 | 同步删除向量 | 先删 SQLite（CASCADE），再删 Chroma |

### 2.3 降级策略

当 Chroma 服务不可用时，`getSimilar` 自动降级为 SQLite 的 `LIKE` 全文搜索：

```typescript
// 降级逻辑
async getSimilar(params: SimilarParams): Promise<SimilarResult> {
  try {
    // 尝试 Chroma 语义检索
    return await this.chromaQuery(params);
  } catch (err) {
    // Chroma 不可用，降级为 SQLite LIKE 搜索
    this.logger.warn('Chroma unavailable, falling back to SQLite LIKE search', err);
    return await this.sqliteFallback(params);
  }
}
```

---

## 3. 实施步骤

### 3.1 实施顺序

```
Step 1: 安装依赖 + 类型定义
  ↓
Step 2: SQLite 表创建 + SQLiteStore 实现
  ↓
Step 3: ChromaStore 实现
  ↓
Step 4: EmbeddingModel 封装
  ↓
Step 5: MemoryManager 统一 API
  ↓
Step 6: CleanupEngine 自动清理引擎
  ↓
Step 7: 8 个记忆工具实现
  ↓
Step 8: 工具注册到工作区
  ↓
Step 9: 单元测试
  ↓
Step 10: 集成验证
```

### 3.2 详细任务

#### Step 1：安装依赖 + 类型定义

| # | 任务 | 产出物 | 预计工时 |
|---|------|--------|:--------:|
| 1.1 | 安装 chromadb npm 包 | `pnpm add chromadb` | 0.5h |
| 1.2 | 创建 Memory 相关类型定义（Memory, MemoryType, MemoryBranch, StoreParams, RecallParams 等） | `src/main/memory/types.ts` | 1h |
| 1.3 | 创建 MemoryConfig 配置接口 | `src/main/memory/types.ts` | 0.5h |

**类型定义核心内容**：

```typescript
// 记忆类型
type MemoryType = 'player_habit' | 'map_point' | 'task_experience' | 'social' | 'skill';

// 记忆实体
interface Memory {
  id: string;
  workspaceId: string;
  type: MemoryType;
  branch: string;
  content: Record<string, any>;
  tags: string[];
  importance: number;        // 1-10
  accessCount: number;
  embeddingId: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
}
```

#### Step 2：SQLite 表创建 + SQLiteStore 实现

| # | 任务 | 产出物 | 预计工时 |
|---|------|--------|:--------:|
| 2.1 | 编写 DDL（memory_meta / memory_tags / memory_access_log） | `src/main/memory/schema.sql` | 0.5h |
| 2.2 | 实现 SQLiteStore 初始化（建表 + 建索引） | `src/main/memory/sqlite-store.ts` | 1h |
| 2.3 | 实现 CRUD 方法（saveMeta / getById / updateMeta / deleteMeta） | `src/main/memory/sqlite-store.ts` | 2h |
| 2.4 | 实现查询方法（query / getByIds / getAllIds / getUnembedded） | `src/main/memory/sqlite-store.ts` | 2h |
| 2.5 | 实现标签管理（addTag / removeTag / getByTag） | `src/main/memory/sqlite-store.ts` | 1h |
| 2.6 | 实现统计方法（stats） | `src/main/memory/sqlite-store.ts` | 0.5h |
| 2.7 | 实现批量操作（saveMetaBatch / deleteBy） | `src/main/memory/sqlite-store.ts` | 1h |

**SQLiteStore 接口**：

```typescript
interface ISQLiteStore {
  init(): Promise<void>;
  saveMeta(memory: Memory): Promise<void>;
  saveMetaBatch(memories: Memory[]): Promise<void>;
  query(params: RecallParams): Promise<{ memories: Memory[]; total: number }>;
  getById(id: string): Promise<Memory | null>;
  getByIds(ids: string[]): Promise<Memory[]>;
  updateMeta(id: string, updates: Partial<Memory>): Promise<void>;
  deleteMeta(id: string): Promise<void>;
  deleteBy(params: ForgetByParams): Promise<string[]>;
  addTag(memoryId: string, tag: string): Promise<void>;
  removeTag(memoryId: string, tag: string): Promise<void>;
  getByTag(tag: string, limit?: number): Promise<Memory[]>;
  stats(): Promise<MemoryStats>;
  getAllIds(): Promise<string[]>;
  getUnembedded(limit?: number): Promise<Memory[]>;
  markEmbedded(id: string, embeddingId: string): Promise<void>;
  close(): Promise<void>;
}
```

#### Step 3：ChromaStore 实现

| # | 任务 | 产出物 | 预计工时 |
|---|------|--------|:--------:|
| 3.1 | 实现 ChromaStore 初始化（HTTP 连接 / 嵌入式连接检测 + 集合创建） | `src/main/memory/chroma-store.ts` | 1.5h |
| 3.2 | 实现向量操作（upsert / upsertBatch / querySimilar / delete / deleteBatch） | `src/main/memory/chroma-store.ts` | 2h |
| 3.3 | 实现管理方法（count / reset / close） | `src/main/memory/chroma-store.ts` | 0.5h |
| 3.4 | 实现连接健康检查（healthCheck） | `src/main/memory/chroma-store.ts` | 0.5h |

**ChromaStore 接口**：

```typescript
interface IChromaStore {
  init(collectionName: string): Promise<void>;
  upsert(embeddingId: string, vector: number[], metadata: Record<string, any>): Promise<void>;
  upsertBatch(items: Array<{ embeddingId: string; vector: number[]; metadata: Record<string, any> }>): Promise<void>;
  querySimilar(params: { vector: number[]; filter?: Record<string, any>; limit?: number }): Promise<Array<{ embeddingId: string; score: number; metadata: Record<string, any> }>>;
  delete(embeddingId: string): Promise<void>;
  deleteBatch(embeddingIds: string[]): Promise<void>;
  count(): Promise<number>;
  reset(): Promise<void>;
  healthCheck(): Promise<boolean>;
  close(): Promise<void>;
}
```

#### Step 4：EmbeddingModel 封装

| # | 任务 | 产出物 | 预计工时 |
|---|------|--------|:--------:|
| 4.1 | 实现 EmbeddingModel 接口定义 | `src/main/memory/embedding.ts` | 0.5h |
| 4.2 | 实现 OpenAI Embedding Provider（text-embedding-3-small） | `src/main/memory/embedding.ts` | 1h |
| 4.3 | 实现 Ollama Embedding Provider（本地模型） | `src/main/memory/embedding.ts` | 1h |
| 4.4 | 实现 EmbeddingStrategy（按记忆类型生成嵌入文本） | `src/main/memory/embedding.ts` | 0.5h |

**EmbeddingStrategy 规则**：

```typescript
class EmbeddingStrategy {
  static buildEmbeddingText(memory: Memory): string {
    switch (memory.type) {
      case 'player_habit':
        return `玩家 ${memory.content.player} 偏好 ${memory.content.preference}`;
      case 'map_point':
        return `${memory.content.name} 在 ${memory.content.x}, ${memory.content.y}, ${memory.content.z} ${memory.content.dimension}`;
      case 'task_experience':
        return `任务 ${memory.content.task}: ${memory.content.lesson}`;
      case 'social':
        return `与 ${memory.content.player} 的关系: ${memory.content.relation}`;
      case 'skill':
        return `技能 ${memory.content.name}: ${memory.content.description}`;
      default:
        return JSON.stringify(memory.content);
    }
  }
}
```

#### Step 5：MemoryManager 统一 API

| # | 任务 | 产出物 | 预计工时 |
|---|------|--------|:--------:|
| 5.1 | 实现 MemoryManager 构造函数（接收 MemoryConfig，初始化 SQLiteStore + ChromaStore + EmbeddingModel） | `src/main/memory/memory-manager.ts` | 1h |
| 5.2 | 实现存储方法（store / batchStore） | `src/main/memory/memory-manager.ts` | 2h |
| 5.3 | 实现检索方法（recall / getById / getSimilar / list） | `src/main/memory/memory-manager.ts` | 2h |
| 5.4 | 实现更新/删除方法（update / forget） | `src/main/memory/memory-manager.ts` | 1h |
| 5.5 | 实现标签管理方法（addTag / removeTag） | `src/main/memory/memory-manager.ts` | 0.5h |
| 5.6 | 实现统计/管理方法（stats / cleanup / export / import） | `src/main/memory/memory-manager.ts` | 2h |
| 5.7 | 实现模块导出（index.ts） | `src/main/memory/index.ts` | 0.5h |

**MemoryManager 关键实现要点**：

```typescript
class MemoryManager {
  private sqlite: SQLiteStore;
  private chroma: ChromaStore;
  private embedding: EmbeddingModel;
  private logger: Logger;

  async store(params: StoreParams): Promise<StoreResult> {
    // 1. 构建 Memory 对象
    const memory = this.buildMemory(params);
    
    // 2. 写入 SQLite
    await this.sqlite.saveMeta(memory);
    
    // 3. 生成向量并写入 Chroma
    try {
      const text = EmbeddingStrategy.buildEmbeddingText(memory);
      const vector = await this.embedding.embed(text);
      const embeddingId = memory.id;
      await this.chroma.upsert(embeddingId, vector, {
        memory_id: memory.id,
        workspace_id: memory.workspaceId,
        type: memory.type,
        branch: memory.branch,
        importance: memory.importance,
        created_at: memory.createdAt,
      });
      // 4. 回写 embedding_id
      await this.sqlite.markEmbedded(memory.id, embeddingId);
    } catch (err) {
      // Chroma 写入失败，标记未嵌入，后续由 CleanupEngine 重试
      this.logger.warn(`Failed to embed memory ${memory.id}`, err);
    }
    
    return { id: memory.id, createdAt: memory.createdAt };
  }

  async recall(params: RecallParams): Promise<RecallResult> {
    // 检测是否语义检索
    if (params.similarTo) {
      return this.getSimilar({ query: params.similarTo, type: params.type, limit: params.limit });
    }
    // 检测是否 ID 查询
    if (params.id) {
      const memory = await this.getById(params.id);
      return { memories: memory ? [memory] : [], total: memory ? 1 : 0, limit: 1, offset: 0 };
    }
    // 条件检索
    return this.sqlite.query(params);
  }

  async getSimilar(params: SimilarParams): Promise<SimilarResult> {
    try {
      // 1. 生成查询向量
      const vector = await this.embedding.embed(params.query);
      
      // 2. Chroma 语义搜索
      const results = await this.chroma.querySimilar({
        vector,
        filter: params.type ? { type: params.type } : undefined,
        limit: params.limit || 10,
      });
      
      // 3. 过滤相似度阈值
      const filtered = results.filter(r => r.score >= (params.minScore || 0.5));
      
      // 4. 回补 SQLite 元数据
      const memoryIds = filtered.map(r => r.metadata.memory_id);
      const memories = await this.sqlite.getByIds(memoryIds);
      
      // 5. 合并相似度分数
      const scoreMap = new Map(filtered.map(r => [r.metadata.memory_id, r.score]));
      const scored = memories.map(m => ({
        ...m,
        similarityScore: scoreMap.get(m.id) || 0,
      }));
      
      return { memories: scored };
    } catch (err) {
      // Chroma 降级：SQLite LIKE 搜索
      this.logger.warn('Chroma query failed, falling back to SQLite LIKE', err);
      const result = await this.sqlite.query({
        keywords: [params.query],
        type: params.type,
        limit: params.limit || 10,
      });
      return {
        memories: result.memories.map(m => ({ ...m, similarityScore: 0 })),
      };
    }
  }
}
```

#### Step 6：CleanupEngine 自动清理引擎

| # | 任务 | 产出物 | 预计工时 |
|---|------|--------|:--------:|
| 6.1 | 实现 CleanupEngine 构造函数（接收 MemoryManager 引用 + 配置） | `src/main/memory/cleanup-engine.ts` | 0.5h |
| 6.2 | 实现过期清理逻辑（expires_at < now） | `src/main/memory/cleanup-engine.ts` | 1h |
| 6.3 | 实现低重要度清理逻辑（importance <= 2 且 access_count = 0 且 30 天前） | `src/main/memory/cleanup-engine.ts` | 1h |
| 6.4 | 实现数量上限控制（每类型超过 maxPerType 时清理最旧记录） | `src/main/memory/cleanup-engine.ts` | 1h |
| 6.5 | 实现定时调度（setInterval 24h 周期） | `src/main/memory/cleanup-engine.ts` | 0.5h |
| 6.6 | 实现 Chroma 重试嵌入（定期扫描 embedding_id = null 的记录，重试生成向量） | `src/main/memory/cleanup-engine.ts` | 1h |

**清理规则**：

| 规则 | 条件 | 行为 |
|------|------|------|
| 过期清理 | `expires_at < now()` | 删除该记忆（SQLite + Chroma） |
| 低重要度清理 | `importance <= 2` 且 `access_count == 0` 且 `created_at > 30 天` | 删除 |
| 数量上限 | 某类型记忆超过 `maxPerType`（默认 1000） | 删除最旧/最低重要度的 |
| 重试嵌入 | `embedding_id = null` 且 `updated_at > 1h` | 重新生成向量并写入 Chroma |

#### Step 7：8 个记忆工具实现

| # | 任务 | 产出物 | 预计工时 |
|---|------|--------|:--------:|
| 7.1 | 实现 memory_store 工具（单条 + 批量存储） | `src/main/tools/memory/memory_store.ts` | 2h |
| 7.2 | 实现 memory_recall 工具（条件检索 + 语义检索 + ID 查询） | `src/main/tools/memory/memory_recall.ts` | 2h |
| 7.3 | 实现 memory_update 工具 | `src/main/tools/memory/memory_update.ts` | 1h |
| 7.4 | 实现 memory_forget 工具 | `src/main/tools/memory/memory_update.ts` | 0.5h |
| 7.5 | 实现 memory_tag 工具 | `src/main/tools/memory/memory_tag.ts` | 0.5h |
| 7.6 | 实现 memory_untag 工具 | `src/main/tools/memory/memory_tag.ts` | 0.5h |
| 7.7 | 实现 memory_manage 工具（stats / cleanup / export / import） | `src/main/tools/memory/memory_manage.ts` | 2h |

**工具 Schema 定义**（以 memory_store 为例）：

```typescript
// memory_store 工具的 JSON Schema
{
  name: 'memory_store',
  description: '存储一条或批量存储记忆，包含类型、内容、标签和重要度',
  category: 'memory',
  input_schema: {
    type: 'object',
    properties: {
      memory: {
        type: 'object',
        description: '单条记忆（与 items 二选一）',
        properties: {
          type: { type: 'string', enum: ['player_habit', 'map_point', 'task_experience', 'social', 'skill'] },
          content: { type: 'object', description: '记忆内容（结构化 JSON）' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签列表（可选）' },
          importance: { type: 'integer', minimum: 1, maximum: 10, description: '重要度 1-10（可选，默认 5）' },
        },
        required: ['type', 'content'],
      },
      items: {
        type: 'array',
        description: '批量记忆（与 memory 二选一）',
        items: { /* 同上 memory 结构 */ },
      },
    },
  },
}
```

#### Step 8：工具注册到工作区

| # | 任务 | 产出物 | 预计工时 |
|---|------|--------|:--------:|
| 8.1 | 在 Agent Core 启动时初始化 MemoryManager | `src/main/index.ts` 修改 | 0.5h |
| 8.2 | 将 8 个记忆工具注册到工作区 ToolRegistry | `src/main/tools/index.ts` 修改 | 0.5h |
| 8.3 | 将 MemoryManager 实例注入到工具执行上下文 | `src/main/workspace/tool-dispatcher.ts` 修改 | 0.5h |

#### Step 9：单元测试

| # | 任务 | 产出物 | 预计工时 |
|---|------|--------|:--------:|
| 9.1 | SQLiteStore 单元测试（CRUD / 查询 / 标签 / 统计） | `__tests__/memory/sqlite-store.test.ts` | 2h |
| 9.2 | ChromaStore 单元测试（初始化 / 向量操作 / 语义检索 / 降级） | `__tests__/memory/chroma-store.test.ts` | 2h |
| 9.3 | EmbeddingModel 单元测试（文本生成 / 向量生成） | `__tests__/memory/embedding.test.ts` | 1h |
| 9.4 | MemoryManager 集成测试（store → recall → update → forget 完整流程） | `__tests__/memory/memory-manager.test.ts` | 2h |
| 9.5 | 8 个记忆工具单元测试 | `__tests__/tools/memory/` | 2h |
| 9.6 | CleanupEngine 单元测试（清理规则 / 定时调度） | `__tests__/memory/cleanup-engine.test.ts` | 1h |

#### Step 10：集成验证

| # | 任务 | 预期结果 |
|---|------|----------|
| 10.1 | Agent Core 启动后检查 SQLite 表 | 3 张表 + 所有索引存在 |
| 10.2 | Agent Core 启动后检查 Chroma 集合 | `mcagent_memories` 集合初始化成功 |
| 10.3 | 调用 memory_store 存储 5 条不同类记忆 | SQLite 5 条记录 + Chroma 5 条向量 |
| 10.4 | 调用 memory_recall 按类型过滤 | 返回正确类型的结果 |
| 10.5 | 调用 memory_recall 语义检索 | 返回相似度排序结果 |
| 10.6 | 调用 memory_update 更新记忆 | 内容更新，向量同步更新 |
| 10.7 | 调用 memory_forget 删除记忆 | SQLite + Chroma 同步删除 |
| 10.8 | 调用 memory_manage cleanup | 过期/低重要度记忆被清理 |
| 10.9 | 调用 memory_manage export/import | 导出 → 导入，内容完整 |
| 10.10 | 停止 Chroma 服务后调用语义检索 | 自动降级为 SQLite 搜索，不抛异常 |

---

## 4. 文件变更清单

### 新增文件

```
packages/agent-core/src/main/memory/
├── index.ts                    # 模块导出
├── types.ts                    # 记忆类型定义
├── schema.sql                 # SQLite DDL
├── sqlite-store.ts             # SQLite 存储实现
├── chroma-store.ts             # Chroma 存储实现
├── embedding.ts                # Embedding 模型封装
├── memory-manager.ts           # MemoryManager 统一 API
└── cleanup-engine.ts           # 自动清理引擎

packages/agent-core/src/main/tools/memory/
├── memory_store.ts             # 存储工具
├── memory_recall.ts            # 检索工具
├── memory_update.ts            # 更新/删除工具
├── memory_tag.ts               # 标签管理工具
└── memory_manage.ts            # 管理工具

packages/agent-core/__tests__/memory/
├── sqlite-store.test.ts
├── chroma-store.test.ts
├── embedding.test.ts
├── memory-manager.test.ts
└── cleanup-engine.test.ts

packages/agent-core/__tests__/tools/memory/
├── memory_store.test.ts
├── memory_recall.test.ts
├── memory_update.test.ts
├── memory_tag.test.ts
└── memory_manage.test.ts
```

### 修改文件

```
packages/agent-core/package.json          # 新增 chromadb 依赖
packages/agent-core/src/main/index.ts     # 初始化 MemoryManager
packages/agent-core/src/main/tools/index.ts # 注册 8 个记忆工具
```

---

## 5. 风险评估

| 风险 | 概率 | 影响 | 应对措施 |
|------|:----:|:----:|----------|
| Chroma npm 包兼容性问题 | 中 | 高 | 备选方案：使用 chromadb HTTP API 直接调用（fetch），不依赖 npm 包 |
| Chroma 嵌入式模式性能问题 | 低 | 中 | 默认使用 HTTP 模式，嵌入式仅用于开发调试 |
| Embedding API 调用延迟 | 中 | 中 | 异步写入，不阻塞工具调用返回；批量存储时使用批量嵌入 |
| SQLite + Chroma 数据不一致 | 低 | 高 | 通过 CleanupEngine 定期扫描和修复不一致记录 |
| 记忆数量增长导致性能下降 | 低 | 中 | 通过自动清理和数量上限控制，默认每类型 1000 条上限 |