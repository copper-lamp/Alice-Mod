# Alice Mod Core V11 — 记忆系统 v1（SQLite + Chroma）

> 版本：v1.0
> 日期：2026-07-11
> 版本号：V11（第 13-14 周）
> 对应需求：AC-MEM-01 ~ AC-MEM-08
> 关联文档：[AC-01-需求文档.md](AC-01-需求文档.md)、[AC-02-实施计划.md](AC-02-实施计划.md)、[AC-03-规范与验收标准.md](AC-03-规范与验收标准.md)、[03-记忆系统接口规范.md](../../api/03-记忆系统接口规范.md)、[13-学习与记忆工具设计.md](../../tools/13-学习与记忆工具设计.md)

---

## 第一部分：需求文档

### 1.1 模块定位

V11 是 Agent Core **记忆系统的基础版本**，为 LLM 提供跨会话的知识积累能力。本模块**纯后端运行**，不依赖前端 UI，引入 SQLite + Chroma 双模存储架构，实现记忆的结构化存储与向量语义检索。

**核心职责**：

| 职责 | 说明 |
|------|------|
| **结构化存储** | 基于 SQLite 存储记忆元数据、标签、访问日志，支持按类型/标签/时间/重要度等条件精确查询 |
| **向量语义检索** | 基于 Chroma 向量数据库存储记忆嵌入向量，支持语义相似度查询 |
| **统一管理 API** | MemoryManager 提供 14 个方法，封装 SQLite + Chroma 双写一致性 |
| **8 个记忆工具** | 向 LLM 暴露标准化的记忆操作接口，供 Agent 在运行时存储和检索记忆 |
| **自动清理** | 自动清理过期/低重要度记忆，控制记忆总量 |

### 1.2 与已有模块的关系

| 模块 | 关系说明 |
|------|----------|
| **V3 工作区管理** | 记忆按 `workspace_id` 隔离，每个工作区拥有独立的记忆上下文 |
| **V4 Function Calling Pipeline** | 8 个记忆工具通过 Pipeline 注册到工作区，LLM 通过 Function Calling 调用 |
| **V5 提示词系统** | 提示词组装时可通过 `memory_recall` 注入相关记忆作为参考 |
| **V9 日志系统** | 记忆操作记录写入日志系统，支持调试回溯 |
| **V12 地图索引** | V12 复用 V11 的 SQLite 和 MemoryManager 基础设施，新增地图空间索引 |

### 1.3 功能需求列表

| 需求 ID | 需求名称 | 优先级 | 实现状态 |
|---------|----------|:------:|:--------:|
| AC-MEM-01 | SQLite 记忆元数据表（memory_meta / memory_tags / memory_access_log） | P0 | 待实现 |
| AC-MEM-02 | Chroma 向量数据库集成（向量索引 / 语义检索） | P0 | 待实现 |
| AC-MEM-03 | MemoryManager API（store / recall / getSimilar / list / update / forget 等 14 方法） | P0 | 待实现 |
| AC-MEM-04 | memory_store 工具（单条 + 批量存储） | P0 | 待实现 |
| AC-MEM-05 | memory_recall 工具（条件检索 + 语义检索） | P0 | 待实现 |
| AC-MEM-06 | memory_update / memory_forget 工具 | P0 | 待实现 |
| AC-MEM-07 | memory_tag / memory_untag 工具（标签管理） | P0 | 待实现 |
| AC-MEM-08 | memory_stats / memory_cleanup / memory_export / memory_import（管理工具） | P0 | 待实现 |

#### AC-MEM-01 SQLite 记忆表详细需求

| 子需求 | 说明 |
|--------|------|
| memory_meta 表 | 存储记忆元数据：id（UUID）、type、branch、content_json、tags、importance、access_count、embedding_id、created_at、updated_at、expires_at、workspace_id |
| memory_tags 表 | 标签索引表：memory_id + tag 联合主键，加速按标签检索 |
| memory_access_log 表 | 访问日志表：memory_id + accessed_at + source，记录记忆访问历史 |
| 索引策略 | memory_meta：type/branch/importance/created_at/expires_at/workspace_id 各建索引；memory_tags：tag 索引；memory_access_log：memory_id 索引 |

#### AC-MEM-02 Chroma 集成详细需求

| 子需求 | 说明 |
|--------|------|
| 集合管理 | 创建/初始化 `mcagent_memories` 集合，支持集合存在性检查 |
| 向量插入 | 将记忆内容转换为嵌入向量后写入 Chroma，同时存储 memory_id/type/branch/importance 等元数据 |
| 语义检索 | 输入查询文本，生成向量后在 Chroma 中搜索相似度最高的 N 条记录，返回排序结果 |
| 向量删除 | 删除记忆时同步删除对应 Chroma 向量 |
| 批量操作 | 支持批量插入和批量删除向量 |
| 降级策略 | Chroma 服务不可用时，自动降级为 SQLite LIKE 全文搜索 + 按时间排序 |

#### AC-MEM-03 MemoryManager API 详细需求

| 方法 | 功能 | 说明 |
|------|------|------|
| `store()` | 存储单条记忆 | 写入 SQLite 元数据 + 生成向量写入 Chroma，返回 memory_id |
| `batchStore()` | 批量存储 | 批量写入 SQLite + Chroma，返回 memory_ids |
| `recall()` | 条件检索 | 按 type/tags/keywords/importance 在 SQLite 中过滤，分页返回 |
| `getById()` | 按 ID 获取 | 精确查询单条记忆 |
| `getSimilar()` | 语义检索 | 输入查询文本，在 Chroma 中搜索相似记忆，回补 SQLite 元数据 |
| `list()` | 分页列表 | 按条件列出所有记忆，支持排序和分页 |
| `update()` | 更新记忆 | 更新 SQLite 元数据，内容变更时重新生成向量 |
| `forget()` | 删除单条 | 删除 SQLite 记录 + Chroma 向量 |
| `addTag()` | 添加标签 | 向 memory_tags 表插入一条记录 |
| `removeTag()` | 移除标签 | 从 memory_tags 表删除一条记录 |
| `stats()` | 统计信息 | 返回记忆总数、按类型/分支分布、平均重要度等 |
| `cleanup()` | 清理过期 | 按过期时间/低重要度/数量上限清理记忆 |
| `export()` | 导出记忆 | 导出为 JSON 格式 |
| `import()` | 导入记忆 | 从 JSON 导入记忆 |

#### AC-MEM-04 ~ AC-MEM-08 记忆工具详细需求

| 工具名 | 对应 MemoryManager 方法 | 暴露给 LLM 的参数 |
|--------|------------------------|-------------------|
| `memory_store` | `store()` / `batchStore()` | `type`, `content`, `tags?`, `importance?`, `items?`（批量） |
| `memory_recall` | `recall()` / `getById()` / `getSimilar()` | `filter.id?`, `filter.type?`, `filter.tags?`, `filter.query?`, `filter.similar_to?`, `limit?` |
| `memory_update` | `update()` | `memory_id`, `updates.content?`, `updates.tags?`, `updates.importance?` |
| `memory_forget` | `forget()` | `memory_id`, `reason?` |
| `memory_tag` | `addTag()` | `memory_id`, `tags[]`, `action: 'add'` |
| `memory_untag` | `removeTag()` | `memory_id`, `tags[]`, `action: 'remove'` |
| `memory_manage` | `stats()` / `cleanup()` / `export()` / `import()` | `action: 'stats'|'cleanup'|'export'|'import'`, `params?` |

### 1.4 记忆类型

| 类型 | 用途 | 示例 |
|------|------|------|
| `player_habit` | 记住玩家习惯和偏好 | "Steve 喜欢钻石工具" |
| `map_point` | 记住地图关键点 | "钻石矿脉在 (128, 20, -256)" |
| `task_experience` | 记住任务经验和教训 | "挖钻石要带火把和水桶" |
| `social` | 记住社交关系 | "Steve 是可信赖的朋友" |
| `skill` | 记住已学技能 | "建造木屋技能" |

### 1.5 验收标准

| # | 验收条件 | 验证方法 | 测量指标 |
|---|----------|----------|----------|
| 11.1 | SQLite 记忆表正确创建 | 启动后检查数据库 | 3 张表 + 所有索引存在 |
| 11.2 | Chroma 集合正常初始化 | 启动后检查 Chroma | `mcagent_memories` 集合存在 |
| 11.3 | 记忆存储流程完整 | 调用 `memory_store` | SQLite 写入 + Chroma 向量写入均成功 |
| 11.4 | 语义检索返回排序结果 | 调用 `memory_recall` 的 `similar_to` 参数 | 返回结果按相似度降序排列 |
| 11.5 | 记忆可按类型/标签过滤 | 调用 `memory_recall` 的 `type`/`tags` 参数 | 结果正确过滤 |
| 11.6 | 8 个记忆工具全部注册可调用 | 检查工作区工具列表 | 8 个工具全部存在 |
| 11.7 | 记忆更新/删除同步操作 Chroma | 更新/删除后检查 Chroma | 向量同步更新/删除 |
| 11.8 | 自动清理周期执行 | 等待清理周期或手动触发 | 过期/低重要度记忆被清理 |
| 11.9 | 记忆导出/导入功能正常 | 导出后再导入 | 内容完整，ID 可选自动重新生成 |
| 11.10 | Chroma 降级方案生效 | 停止 Chroma 服务后调用 `memory_recall` | 自动降级为 SQLite 搜索，不抛异常 |

---

## 第二部分：架构设计

### 2.1 总体架构

```
┌──────────────────────────────────────────────────────────────┐
│                      LLM 大脑                                │
│  通过 Function Calling 调用 8 个记忆工具                      │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────┐
│                    记忆工具层（8 个工具）                      │
│  memory_store / memory_recall / memory_update / memory_forget │
│  memory_tag / memory_untag / memory_manage                    │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────┐
│                    MemoryManager API                          │
│                                                              │
│  ┌──────────────────┐  ┌─────────────────┐  ┌─────────────┐ │
│  │   存储引擎        │  │   检索引擎       │  │  管理引擎   │ │
│  │  store()         │  │  recall()       │  │  cleanup()  │ │
│  │  batchStore()    │  │  getById()      │  │  stats()    │ │
│  │  update()        │  │  getSimilar()   │  │  export()   │ │
│  │  forget()        │  │  list()         │  │  import()   │ │
│  │  addTag()        │  │                 │  │             │ │
│  │  removeTag()     │  │                 │  │             │ │
│  └───────┬──────────┘  └───────┬─────────┘  └──────┬──────┘ │
│          │                     │                    │        │
│  ┌───────▼─────────────────────▼────────────────────▼──────┐ │
│  │                  存储适配层                              │ │
│  │  ┌────────────────────────┐  ┌──────────────────────┐   │ │
│  │  │      SQLiteStore       │  │     ChromaStore      │   │ │
│  │  │  · 记忆元数据           │  │  · 向量索引存储       │   │ │
│  │  │  · 标签索引             │  │  · 语义相似度检索     │   │ │
│  │  │  · 访问日志             │  │  · 元数据过滤         │   │ │
│  │  │  · 结构化查询           │  │  · 批量操作           │   │ │
│  │  └────────────────────────┘  └──────────────────────┘   │ │
│  └──────────────────────────────────────────────────────────┘ │
│                            │                                  │
│                    ┌───────┴───────┐                         │
│                    │  Embedding    │                         │
│                    │  Model        │                         │
│                    │  OpenAI       │                         │
│                    │  / Ollama     │                         │
│                    └───────────────┘                         │
└──────────────────────────────────────────────────────────────┘
                            │
                    ┌───────┴───────┐
                    │ CleanupEngine │
                    │ 自动清理引擎   │
                    │ 24h 周期触发   │
                    └───────────────┘
```

### 2.2 核心数据流

#### 存储流程

```
LLM 调用 memory_store(type, content, tags, importance)
  → MemoryManager.store()
    → 生成 memory_id (UUID v4)
    → SQLiteStore.saveMeta()           ← 写入 memory_meta + memory_tags
    → EmbeddingModel.embed(content)    ← 生成嵌入向量
    → ChromaStore.upsert()             ← 写入向量 + 元数据
    → 返回 { id, created_at }
```

#### 条件检索流程

```
LLM 调用 memory_recall(filter: { type, tags, query })
  → MemoryManager.recall()
    → SQLiteStore.query()              ← 按 type/tags/keywords 过滤
    → 返回 { memories[], total }
```

#### 语义检索流程

```
LLM 调用 memory_recall(filter: { similar_to: "query text" })
  → MemoryManager.recall()
    → 检测到 similar_to 参数
    → EmbeddingModel.embed(query)      ← 生成查询向量
    → ChromaStore.querySimilar()       ← 向量相似度搜索
    → 获取匹配的 memory_id 列表
    → SQLiteStore.getByIds()           ← 回补元数据
    → 返回 { memories[], total }
```

#### 更新流程

```
LLM 调用 memory_update(memory_id, updates)
  → MemoryManager.update()
    → SQLiteStore.updateMeta()         ← 更新 SQLite 记录
    → 如果 content 变更：
      → EmbeddingModel.embed(new_content)
      → ChromaStore.upsert()           ← 更新向量
    → 返回 { success }
```

### 2.3 数据库设计

#### SQLite 表结构

```sql
-- 记忆元数据表
CREATE TABLE IF NOT EXISTS memory_meta (
  id TEXT PRIMARY KEY,                              -- UUID v4
  workspace_id TEXT NOT NULL,                        -- 工作区隔离
  type TEXT NOT NULL,                               -- 记忆类型
  branch TEXT NOT NULL DEFAULT 'experience',         -- 记忆分支
  content_json TEXT NOT NULL,                        -- 记忆内容 JSON
  tags TEXT NOT NULL DEFAULT '[]',                   -- JSON array
  importance INTEGER NOT NULL DEFAULT 5 CHECK(importance >= 1 AND importance <= 10),
  access_count INTEGER NOT NULL DEFAULT 0,
  embedding_id TEXT,                                 -- Chroma 向量 ID
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER                                -- NULL = 永不过期
);

CREATE INDEX IF NOT EXISTS idx_memory_meta_workspace ON memory_meta(workspace_id);
CREATE INDEX IF NOT EXISTS idx_memory_meta_type ON memory_meta(type);
CREATE INDEX IF NOT EXISTS idx_memory_meta_branch ON memory_meta(branch);
CREATE INDEX IF NOT EXISTS idx_memory_meta_importance ON memory_meta(importance);
CREATE INDEX IF NOT EXISTS idx_memory_meta_created_at ON memory_meta(created_at);
CREATE INDEX IF NOT EXISTS idx_memory_meta_expires_at ON memory_meta(expires_at);

-- 标签索引表
CREATE TABLE IF NOT EXISTS memory_tags (
  memory_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (memory_id, tag),
  FOREIGN KEY (memory_id) REFERENCES memory_meta(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag);

-- 访问日志表
CREATE TABLE IF NOT EXISTS memory_access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  accessed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  source TEXT NOT NULL DEFAULT 'llm',                -- llm | tool | manual
  FOREIGN KEY (memory_id) REFERENCES memory_meta(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_access_log_memory_id ON memory_access_log(memory_id);
```

#### Chroma 集合结构

```typescript
// 集合名称: "mcagent_memories"
// 每条记录:
{
  id: string,              // embedding_id (UUID v4)
  embedding: number[],     // 1536 维向量 (text-embedding-3-small)
  metadata: {
    memory_id: string,     // 关联 SQLite 的 id
    workspace_id: string,  // 工作区隔离
    type: string,          // 记忆类型
    branch: string,        // 记忆分支
    importance: number,    // 重要度
    created_at: number,    // 创建时间
  },
  document: string,        // 由 EmbeddingStrategy 生成的嵌入文本
}
```

### 2.4 模块接口设计

#### MemoryManager 类

```typescript
class MemoryManager {
  constructor(config: MemoryConfig);

  // ─── 存储 ───
  async store(params: StoreParams): Promise<StoreResult>;
  async batchStore(params: BatchStoreParams): Promise<BatchStoreResult>;

  // ─── 检索 ───
  async recall(params: RecallParams): Promise<RecallResult>;
  async getById(id: string): Promise<Memory | null>;
  async getSimilar(params: SimilarParams): Promise<SimilarResult>;
  async list(params: ListParams): Promise<ListResult>;

  // ─── 更新 / 删除 ───
  async update(id: string, updates: Partial<Memory>): Promise<void>;
  async forget(id: string): Promise<void>;

  // ─── 标签管理 ───
  async addTag(id: string, tag: string): Promise<void>;
  async removeTag(id: string, tag: string): Promise<void>;

  // ─── 统计 & 管理 ───
  async stats(): Promise<MemoryStats>;
  async cleanup(options?: CleanupOptions): Promise<CleanupResult>;
  async export(options?: ExportOptions): Promise<string>;
  async import(json: string): Promise<ImportResult>;
}
```

#### 关键配置接口

```typescript
interface MemoryConfig {
  sqlitePath: string;                    // SQLite 数据库路径
  chromaConfig: {
    collectionName: string;              // default: 'mcagent_memories'
    clientType: 'http' | 'embedded';    // Chroma 连接方式
    url?: string;                        // HTTP 模式下的 URL
    persistPath?: string;                // 嵌入式模式下的持久化路径
  };
  embedding: {
    provider: 'openai' | 'ollama';
    model: string;                       // default: 'text-embedding-3-small'
    apiKey?: string;
    baseUrl?: string;
    dimension: number;                   // default: 1536
  };
  autoCleanup: {
    enabled: boolean;                    // default: true
    intervalMs: number;                  // default: 86400000 (24h)
    mode: 'expired' | 'low_importance' | 'all';
    importanceThreshold?: number;        // default: 2
  };
  limits: {
    maxPerType: number;                  // default: 1000
    maxTotal: number;                    // default: 10000
  };
}
```

### 2.5 关键设计决策

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| **存储架构** | 纯 SQLite / SQLite + Chroma / 纯 Chroma | **SQLite + Chroma 双写** | SQLite 处理结构化查询（类型/标签/时间过滤），Chroma 处理向量语义检索，各司其职 |
| **嵌入模型** | OpenAI / Ollama / 本地模型 | **OpenAI text-embedding-3-small** | 1536 维，质量高，成本低；支持通过配置切换到 Ollama 本地模型 |
| **Chroma 连接方式** | HTTP 服务 / 嵌入式 | **HTTP 模式优先，可配置嵌入式** | HTTP 模式独立部署更稳定，嵌入式模式适合开发调试 |
| **降级策略** | 抛异常 / 自动降级 | **自动降级为 SQLite LIKE 搜索** | Chroma 不可用时系统仍可用，只是语义检索退化为关键词匹配 |
| **工作区隔离** | 表级隔离 / 字段隔离 | **workspace_id 字段隔离** | 单表多工作区，减少表数量，查询时加 workspace_id 条件 |
| **工具粒度** | 14 个单独工具 / 合并为 8 个 | **合并为 8 个** | 减少 LLM 选择负担，getById/getSimilar 合并到 recall，batchStore 合并到 store，addTag/removeTag 合并为 tag/untag |

### 2.6 文件结构

```
src/main/memory/
├── index.ts                  # 模块导出
├── types.ts                  # 记忆相关类型定义
├── schema.sql               # SQLite DDL
├── sqlite-store.ts           # SQLite 结构化存储实现
├── chroma-store.ts           # Chroma 向量存储实现
├── embedding.ts              # Embedding 模型封装
├── memory-manager.ts         # MemoryManager 统一 API
├── cleanup-engine.ts         # 自动清理引擎

src/main/tools/memory/
├── memory_store.ts           # 存储工具（单条 + 批量）
├── memory_recall.ts          # 检索工具（条件检索 + 语义检索 + ID 查询）
├── memory_update.ts          # 更新/删除工具
├── memory_tag.ts             # 标签管理工具
└── memory_manage.ts          # 统计/清理/导入导出工具
```

### 2.7 非功能需求

| 指标 | 目标 | 测量方式 |
|------|------|----------|
| 单条记忆存储 | < 50ms（含嵌入生成） | 计时日志 |
| 批量存储（10 条） | < 200ms | 计时日志 |
| SQLite 条件检索 | < 10ms（1000 条记录） | 基准测试 |
| 语义检索 | < 500ms（含嵌入生成） | 基准测试 |
| 自动清理 | < 100ms（10000 条记录） | 计时日志 |
| 导出/导入 | < 1s（1000 条记录） | 计时日志 |
| Chroma 降级切换 | < 10ms | 计时日志 |
| 内存占用 | < 50MB（含 Chroma 客户端） | 运行时监控 |