# Alice Mod Core V12 — 记忆系统 v2（地图索引 + 记忆浏览器）

> 版本：v1.0
> 日期：2026-07-11
> 版本号：V12（第 15 周）
> 对应需求：AC-MEM-09 ~ AC-MEM-12、AC-UI-07
> 关联文档：[AC-01-需求文档.md](AC-01-需求文档.md)、[AC-02-实施计划.md](AC-02-实施计划.md)、[AC-03-规范与验收标准.md](AC-03-规范与验收标准.md)、[AC-V11-记忆系统v1.md](AC-V11-记忆系统v1.md)、[03-记忆系统接口规范.md](../../api/03-记忆系统接口规范.md)

---

## 第一部分：需求文档

### 1.1 模块定位

V12 是记忆系统的**地图索引增强版本**，在 V11 SQLite + Chroma 双模存储的基础上，新增空间索引能力，使 LLM 能够按坐标、区域和空间关系检索地图信息。同时引入**记忆浏览器 UI**，使开发者/用户可直接查看和管理记忆数据。

**核心职责**：

| 职责 | 说明 |
|------|------|
| **空间索引** | 基于 Chunk 对齐网格 (16×16) 的轻量级空间索引，支持快速邻近查询和区域查询 |
| **地图特征存储** | 3 张新表（map_features / map_spatial_grid / map_regions）存储地图特征和命名区域 |
| **空间查询工具** | 向 LLM 暴露 2 个地图查询工具（map_query_nearby / map_get_overview），按坐标空间检索 |
| **自动特征同步** | 存入 `map_point` / `map_region` / `map_biome` 类型记忆时，自动创建空间索引 |
| **全量内存加载** | Agent Core 启动时将地图索引全量加载到内存，查询性能 < 10ms |
| **记忆浏览器 UI** | 基于 Electron 渲染进程的图形界面，支持按类型/标签检索、查看详情、编辑、删除记忆（**已废弃**，改为后端调试模式） |

### 1.2 与已有模块的关系

| 模块 | 关系说明 |
|------|----------|
| **V11 记忆系统 v1** | V12 复用 V11 的 SQLite 连接、MemoryManager 架构、记忆类型系统。地图特征关联到 `memory_meta` 表 |
| **V3 工作区管理** | 地图索引按 `dimension`（维度）隔离，同时通过 `memory_id` 关联到工作区 |
| **V4 Function Calling Pipeline** | 2 个地图工具通过 Pipeline 注册到工作区，LLM 通过 Function Calling 调用 |
| **V5 提示词系统** | 提示词组装时可调用 `map_get_overview` 注入当前区域的地图概览信息 |
| **V9 日志系统** | 地图索引操作记录写入日志系统，支持调试回溯 |
| **V8 主控制面板** | ~~记忆浏览器 UI 作为独立页面接入主控制面板导航~~（已废弃，改为后端调试模块） |

### 1.3 功能需求列表

| 需求 ID | 需求名称 | 优先级 | 实现状态 |
|---------|----------|:------:|:--------:|
| AC-MEM-09 | 地图索引系统（map_features / map_spatial_grid / map_regions 三张表） | P0 | 待实现 |
| AC-MEM-10 | map_query_nearby 空间邻近查询引擎 | P0 | 待实现 |
| AC-MEM-11 | map_get_overview 区域概览引擎 | P0 | 待实现 |
| AC-MEM-12 | 地图索引全量内存加载（启动时加载，查询性能 < 10ms） | P0 | 待实现 |
| AC-UI-07 | ~~记忆浏览器 UI（按类型/标签检索 / 查看 / 编辑 / 删除）~~ | P0 | **已废弃** |

#### AC-MEM-09 地图索引系统详细需求

| 子需求 | 说明 |
|--------|------|
| map_features 表 | 存储地图特征元数据：id（UUID）、memory_id（关联记忆）、feature_type（point/resource/structure/biome/base/waypoint）、name、x/y/z、dimension（overworld/nether/the_end）、tags、metadata、updated_at |
| map_spatial_grid 表 | Chunk 对齐网格索引：chunk_x（blockX >> 4）、chunk_z（blockZ >> 4）、dimension、feature_id，联合主键，加速邻近查询 |
| map_regions 表 | 命名区域表：id（UUID）、name、region_type（base/mine/farm/village/exploration/custom）、矩形对角坐标（x1/z1/x2/z2）、dimension、description、memory_id、created_at、updated_at |
| 索引策略 | map_features：dimension/feature_type/(dimension, x, z) 各建索引；map_spatial_grid：(dimension, chunk_x, chunk_z) 复合索引；map_regions：dimension/name 各建索引 |
| 自动同步 | 存入 `map_point` / `map_region` / `map_biome` 类型记忆时，自动创建 MapFeature 并写入空间网格 |
| 同步删除 | 删除关联记忆时，空间索引记录同步删除（ON DELETE CASCADE/SET NULL） |

#### AC-MEM-10 map_query_nearby 详细需求

| 子需求 | 说明 |
|--------|------|
| 邻近查询 | 以指定坐标 (x, z) 为中心，搜索半径 R 方块内的地图特征 |
| 维度隔离 | 查询结果限制在指定维度（overworld / nether / the_end） |
| 类型筛选 | 可选按 feature_type 过滤（point / resource / structure / biome / base / waypoint） |
| 数量限制 | 返回结果上限可配置，默认 50 |
| 排序规则 | 按欧几里得距离升序排列 |
| 结果格式 | 返回特征列表（id / name / type / x / y / z / tags）、总数、中心点、半径 |

查询流程：
```
输入: center=(x=200, z=300), radius=32, dimension=overworld

1. 计算 Chunk 范围:
   chunk_x 范围: (200-32)>>4 ~ (200+32)>>4  = 10 ~ 14
   chunk_z 范围: (300-32)>>4 ~ (300+32)>>4  = 16 ~ 20

2. 内存中按 Chunk 范围过滤 → 获取候选特征 ID

3. 精确距离过滤（欧几里得距离 <= radius）

4. 按距离升序排序 → 取 limit 条返回
```

#### AC-MEM-11 map_get_overview 详细需求

| 子需求 | 说明 |
|--------|------|
| 区域概览 | 获取指定坐标区域的结构化摘要，包含特征统计、命名区域、关键点等信息 |
| 摘要生成 | 自动生成文本摘要，包含：区域范围、命名区域列表、特征统计分布、关键高亮点 |
| 特征统计 | 按 feature_type 统计各类型特征数量 |
| 命名区域 | 列出与查询区域重叠的所有命名区域（名称、类型、边界） |
| 关键点 | 提取高重要度/高频访问的热点特征（最多 5 个） |
| 区域边界 | 返回查询区域的实际边界范围 |

#### AC-MEM-12 全量内存加载详细需求

| 子需求 | 说明 |
|--------|------|
| 启动加载 | Agent Core 启动时，将 map_features 和 map_regions 全量加载到内存 |
| 内存结构 | 使用 JavaScript Map/Set 构建内存索引，按 dimension 分块存储 |
| 查询性能 | 所有查询走内存，写入时同步写 SQLite<br>邻近查询 < 10ms（10 万条特征） |
| 内存上限 | < 5MB（即使 10 万个特征也在 5MB 以内） |
| 刷新机制 | 支持手动刷新（refresh）和增量更新（增删改后自动同步） |
| 写入策略 | 写入时同步写 SQLite + 更新内存索引，保证一致性 |

#### ~~AC-UI-07 记忆浏览器 UI 详细需求~~（已废弃）

> **废弃说明**：记忆浏览器 UI 已改为后端调试模块，不再连接前端。
> 相关功能通过 `memory-handler.ts` 提供 IPC 接口，仅供后端调试使用。

### 1.4 地图特征类型

| 类型 | 用途 | 示例 |
|------|------|------|
| `point` | 通用标记点 | "钻石矿脉在 (128, 20, -256)" |
| `resource` | 资源点 | "铁矿脉在 (200, 40, 300)" |
| `structure` | 建筑/结构 | "村民交易所在 (0, 64, 0)" |
| `biome` | 生物群系边界 | "丛林边界在 (500, 64, -200)" |
| `base` | 基地/据点 | "主基地在 (100, 64, 200)" |
| `waypoint` | 路径点/地标 | "下界传送门在 (50, 64, 80)" |

### 1.5 命名区域类型

| 类型 | 用途 | 示例 |
|------|------|------|
| `base` | 基地/据点 | "主基地", "哨站" |
| `mine` | 矿区 | "钻石矿区", "下界合金矿区" |
| `farm` | 农场/养殖场 | "小麦农场", "铁傀儡农场" |
| `village` | 村庄 | "沙漠村庄" |
| `exploration` | 探索区域 | "未探索的丛林区域" |
| `custom` | 自定义区域 | "建筑工地", "规划新区" |

### 1.6 验收标准

| # | 验收条件 | 验证方法 | 测量指标 |
|---|---------|----------|----------|
| 12.1 | map_query_nearby 邻近查询 | 在坐标 (100,200) 附近 64 半径内查询 | 返回半径内的所有特征 |
| 12.2 | map_query_nearby 跨维度隔离 | 在主世界查询 | 不返回下界的特征 |
| 12.3 | map_get_overview 区域概览 | 查询坐标 (100,200) 半径 128 | 返回 summary 文本 |
| 12.4 | 概览摘要包含特征统计 | 区域内有 3 个资源点 2 个建筑 | summary 包含 "资源×3，建筑×2" |
| 12.5 | 自动同步地图特征 | 存入 map_point 记忆 | 自动创建 MapFeature 并写入空间网格 |
| 12.6 | 全量内存加载性能 | 10 万条特征 | 启动加载 < 500ms |
| 12.7 | 邻近查询性能 | 10 万条特征，半径 64 | 查询时间 < 10ms |
| ~~12.8~~ | ~~记忆浏览器 UI~~ | ~~按 type 过滤记忆~~ | ~~显示过滤后的列表~~ | **已废弃** |
| ~~12.9~~ | ~~记忆浏览器编辑~~ | ~~修改记忆内容~~ | ~~保存后内容更新~~ | **已废弃** |
| ~~12.10~~ | ~~记忆浏览器删除~~ | ~~删除记忆~~ | ~~同步清理 Chroma 向量和空间索引~~ | **已废弃** |
| 12.11 | 命名区域重叠检测 | 创建与已有区域重叠的区域 | 正确返回重叠区域列表 |

---

## 第二部分：架构设计

### 2.1 总体架构

```
┌──────────────────────────────────────────────────────────────┐
│                      LLM 大脑                                │
│  通过 Function Calling 调用地图工具                           │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────┐
│                    地图工具层（2 个工具）                      │
│  map_query_nearby / map_get_overview                         │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────┐
│                    MapIndex 引擎                              │
│                                                              │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐   │
│  │  邻近查询器     │  │  范围查询器     │  │ 概览生成器   │   │
│  │  queryNearby() │  │  queryArea()   │  │ getOverview │   │
│  └───────┬────────┘  └───────┬────────┘  └──────┬───────┘   │
│          │                   │                   │           │
│  ┌───────▼───────────────────▼───────────────────▼───────┐   │
│  │              内存索引层（全量加载）                      │   │
│  │  · byDimension: Map<dimension, Map<chunkKey, Set<id>>>│   │
│  │  · byId: Map<string, MapFeature>                       │   │
│  │  · regions: Map<string, MapRegion>                     │   │
│  └───────────────────────┬───────────────────────────────┘   │
│                          │                                    │
│  ┌───────────────────────▼───────────────────────────────┐   │
│  │              SQLite 持久化层                            │   │
│  │  map_features / map_spatial_grid / map_regions        │   │
│  └────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────────┐
│                   记忆同步器 (MapSync)                         │
│  监听 memory_store 操作，自动创建/更新/删除空间索引           │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                   记忆浏览器 UI (已废弃)                        │
│                                                              │
│  注意：记忆浏览器 UI 已改为后端调试模块，不再连接前端。         │
│  相关功能通过 memory-handler.ts 提供 IPC 接口，仅供后端调试。  │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 核心数据流

#### 邻近查询流程

```
LLM 调用 map_query_nearby(x=200, z=300, radius=32, dimension='overworld')
  → MapIndex.queryNearby()
    → 计算 Chunk 范围: chunk_x 10~14, chunk_z 16~20
    → 内存中查 byDimension['overworld'] 获取候选特征
    → 欧几里得距离过滤 (dx² + dz² <= radius²)
    → 按距离升序排序
    → 取 limit 条返回
  → 返回 { features[], count, center, radius }
```

#### 区域概览流程

```
LLM 调用 map_get_overview(x=200, z=300, radius=128, dimension='overworld')
  → MapIndex.getOverview()
    → 计算查询区域边界: (x1=72, z1=172, x2=328, z2=428)
    → 查询区域内所有特征 → 按 type 统计数量
    → 查询与区域重叠的命名区域
    → 提取高重要度/高频访问关键点
    → OverviewBuilder 构建摘要文本
  → 返回 { summary, featureStats, regions[], highlights[], bounds }
```

#### 自动同步流程

```
LLM 调用 memory_store(type='map_point', content={x:100, y:64, z:200, ...})
  → MemoryManager.store()
    → V11 原有逻辑: 写入 SQLite + Chroma
    → 检测到 type 为 map_point / map_region / map_biome
    → 调用 MapSync.onMemoryStored()
      → 创建 MapFeature 写入 map_features
      → 计算 Chunk 坐标 → 写入 map_spatial_grid
      → 更新内存索引
  → 返回 { id, created_at }
```

#### ~~记忆浏览器数据流~~（已废弃）

> 记忆浏览器 UI 已改为后端调试模块，不再连接前端。
> 相关功能通过 `memory-handler.ts` 提供 IPC 接口，仅供后端调试使用。

### 2.3 数据库设计

#### 新增 SQLite 表结构

```sql
-- 地图特征表（存储地图上的标记点）
CREATE TABLE IF NOT EXISTS map_features (
  id TEXT PRIMARY KEY,                              -- UUID v4
  memory_id TEXT,                                   -- 关联记忆 ID（可选）
  feature_type TEXT NOT NULL,                       -- point | resource | structure | biome | base | waypoint
  name TEXT,                                        -- 特征名称
  x INTEGER NOT NULL,
  y INTEGER NOT NULL DEFAULT 0,
  z INTEGER NOT NULL,
  dimension TEXT NOT NULL,                          -- overworld | nether | the_end
  tags TEXT NOT NULL DEFAULT '[]',                  -- JSON array
  metadata TEXT,                                    -- 额外属性 JSON
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (memory_id) REFERENCES memory_meta(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_map_features_dimension ON map_features(dimension);
CREATE INDEX IF NOT EXISTS idx_map_features_type ON map_features(feature_type);
CREATE INDEX IF NOT EXISTS idx_map_features_coords ON map_features(dimension, x, z);

-- 空间网格索引（Chunk 对齐，加速邻近查询）
CREATE TABLE IF NOT EXISTS map_spatial_grid (
  chunk_x INTEGER NOT NULL,                         -- Chunk X (block_x >> 4)
  chunk_z INTEGER NOT NULL,                         -- Chunk Z (block_z >> 4)
  dimension TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  PRIMARY KEY (chunk_x, chunk_z, dimension, feature_id),
  FOREIGN KEY (feature_id) REFERENCES map_features(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_map_spatial_grid_dim ON map_spatial_grid(dimension, chunk_x, chunk_z);

-- 命名区域表（矩形区域定义）
CREATE TABLE IF NOT EXISTS map_regions (
  id TEXT PRIMARY KEY,                              -- UUID v4
  name TEXT NOT NULL,
  region_type TEXT NOT NULL,                        -- base | mine | farm | village | exploration | custom
  x1 INTEGER NOT NULL,
  z1 INTEGER NOT NULL,
  x2 INTEGER NOT NULL,
  z2 INTEGER NOT NULL,
  dimension TEXT NOT NULL,
  description TEXT,
  memory_id TEXT,                                   -- 关联记忆 ID
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (memory_id) REFERENCES memory_meta(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_map_regions_dimension ON map_regions(dimension);
CREATE INDEX IF NOT EXISTS idx_map_regions_name ON map_regions(name);
```

### 2.4 模块接口设计

#### MapIndex 类

```typescript
class MapIndex {
  constructor(sqlite: SQLiteStore);

  // ─── 初始化 ───
  /** 全量加载地图数据到内存 */
  async load(): Promise<void>;
  /** 刷新内存索引（重新加载） */
  async refresh(): Promise<void>;

  // ─── 查询 ───
  /** 邻近查询：以某点为中心搜索半径内特征 */
  queryNearby(params: NearbyQueryParams): NearbyQueryResult;
  /** 矩形区域查询 */
  queryArea(params: AreaQueryParams): AreaQueryResult;
  /** 区域概览 */
  getOverview(params: OverviewParams): OverviewResult;

  // ─── 写入（由 MapSync 调用） ───
  /** 添加特征 */
  async addFeature(feature: MapFeature): Promise<void>;
  /** 更新特征 */
  async updateFeature(id: string, updates: Partial<MapFeature>): Promise<void>;
  /** 删除特征 */
  async removeFeature(id: string): Promise<void>;
  /** 添加命名区域 */
  async addRegion(region: MapRegion): Promise<void>;
  /** 更新命名区域 */
  async updateRegion(id: string, updates: Partial<MapRegion>): Promise<void>;
  /** 删除命名区域 */
  async removeRegion(id: string): Promise<void>;

  // ─── 统计 ───
  /** 获取地图索引统计 */
  stats(): MapIndexStats;
}
```

#### MapSync 类

```typescript
class MapSync {
  constructor(mapIndex: MapIndex, memoryManager: MemoryManager);

  /** 监听记忆存储事件，自动同步地图特征 */
  async onMemoryStored(memory: Memory): Promise<void>;
  /** 监听记忆更新事件，同步更新地图特征 */
  async onMemoryUpdated(memory: Memory): Promise<void>;
  /** 监听记忆删除事件，同步删除地图特征 */
  async onMemoryForgotten(memoryId: string): Promise<void>;
}
```

#### 关键类型定义

```typescript
// ==========================================
// V12 新增类型：地图索引
// ==========================================

/** 地图特征类型 */
export type FeatureType = 'point' | 'resource' | 'structure' | 'biome' | 'base' | 'waypoint';

/** 地图维度 */
export type Dimension = 'overworld' | 'nether' | 'the_end';

/** 地图特征 */
export interface MapFeature {
  id: string;
  memoryId?: string;
  featureType: FeatureType;
  name?: string;
  x: number;
  y: number;
  z: number;
  dimension: Dimension;
  tags: string[];
  metadata?: Record<string, unknown>;
  updatedAt: number;
}

/** 命名区域类型 */
export type RegionType = 'base' | 'mine' | 'farm' | 'village' | 'exploration' | 'custom';

/** 命名区域 */
export interface MapRegion {
  id: string;
  name: string;
  regionType: RegionType;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  dimension: string;
  description?: string;
  memoryId?: string;
  createdAt: number;
  updatedAt: number;
}

/** 邻近查询参数 */
export interface NearbyQueryParams {
  x: number;
  z: number;
  radius: number;
  dimension: Dimension;
  type?: FeatureType;
  limit?: number;        // default: 50
}

/** 邻近查询结果 */
export interface NearbyQueryResult {
  features: Array<{
    id: string;
    name?: string;
    featureType: FeatureType;
    x: number;
    y: number;
    z: number;
    tags: string[];
    distance: number;     // 欧几里得距离
  }>;
  count: number;
  center: { x: number; z: number };
  radius: number;
}

/** 矩形区域查询参数 */
export interface AreaQueryParams {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  dimension: Dimension;
  type?: FeatureType;
  limit?: number;
  offset?: number;
}

/** 矩形区域查询结果 */
export interface AreaQueryResult {
  features: MapFeature[];
  count: number;
  total: number;
  bounds: { x1: number; z1: number; x2: number; z2: number };
}

/** 区域概览参数 */
export interface OverviewParams {
  x: number;
  z: number;
  radius: number;
  dimension: Dimension;
}

/** 区域概览结果 */
export interface OverviewResult {
  summary: string;
  featureStats: Record<string, number>;
  regions: Array<{
    id: string;
    name: string;
    regionType: RegionType;
    x1: number;
    z1: number;
    x2: number;
    z2: number;
  }>;
  highlights: Array<{
    name?: string;
    featureType: FeatureType;
    x: number;
    z: number;
  }>;
  bounds: { x1: number; z1: number; x2: number; z2: number };
}

/** 地图索引统计 */
export interface MapIndexStats {
  totalFeatures: number;
  byDimension: Partial<Record<Dimension, number>>;
  byType: Partial<Record<FeatureType, number>>;
  totalRegions: number;
  totalChunks: number;
  memorySizeBytes: number;
}
```

#### 地图工具 Schema

```typescript
// map_query_nearby 工具 Schema
{
  name: 'map_query_nearby',
  description: '以某坐标为中心，搜索半径范围内的地图特征（资源点、建筑、生物群系等）',
  category: 'map',
  input_schema: {
    type: 'object',
    properties: {
      x: { type: 'integer', description: '中心点 X 坐标' },
      z: { type: 'integer', description: '中心点 Z 坐标' },
      radius: { type: 'integer', description: '搜索半径（方块，默认 64）', default: 64 },
      dimension: {
        type: 'string',
        enum: ['overworld', 'nether', 'the_end'],
        description: '维度',
      },
      type: {
        type: 'string',
        enum: ['point', 'resource', 'structure', 'biome', 'base', 'waypoint'],
        description: '特征类型筛选（可选）',
      },
      limit: { type: 'integer', description: '返回数量上限（默认 50）', default: 50 },
    },
    required: ['x', 'z', 'dimension'],
  },
  config: { timeout_default_ms: 3000, requires_bot: false },
}

// map_get_overview 工具 Schema
{
  name: 'map_get_overview',
  description: '获取指定坐标区域的综合地图摘要，包含特征统计、命名区域、关键点等信息',
  category: 'map',
  input_schema: {
    type: 'object',
    properties: {
      x: { type: 'integer', description: '区域中心 X 坐标' },
      z: { type: 'integer', description: '区域中心 Z 坐标' },
      radius: { type: 'integer', description: '概览范围半径（方块，默认 128）', default: 128 },
      dimension: {
        type: 'string',
        enum: ['overworld', 'nether', 'the_end'],
        description: '维度',
      },
    },
    required: ['x', 'z', 'dimension'],
  },
  config: { timeout_default_ms: 5000, requires_bot: false },
}
```

### 2.5 内存索引结构

MapIndex 在 Agent Core 启动时，将 `map_features` 和 `map_regions` 全量加载到内存，使用以下数据结构：

```typescript
interface InMemoryIndex {
  // 按维度 + Chunk 坐标索引（主查询结构）
  byDimension: Map<Dimension, Map<string /* chunkKey */, Set<string /* featureId */>>>;
  // chunkKey = `${chunkX}:${chunkZ}`

  // 按 ID 索引（快速单条访问）
  byId: Map<string, MapFeature>;

  // 命名区域列表
  regions: Map<string, MapRegion>;
}
```

**内存占用估算**：

| 数据量 | 特征数 | 每条大小 | 总内存 |
|--------|--------|----------|--------|
| 小型 | 1,000 | ~200 bytes | ~200 KB |
| 中型 | 10,000 | ~200 bytes | ~2 MB |
| 大型 | 100,000 | ~200 bytes | ~20 MB |

实际场景中，10 万特征已远超正常使用量，通常几千到几万特征即可满足需求。

### 2.6 概览摘要生成策略

`getOverview()` 的 `summary` 字段由以下规则生成：

```typescript
class OverviewBuilder {
  static buildSummary(
    features: MapFeature[],
    regions: MapRegion[],
    bounds: { x1: number; z1: number; x2: number; z2: number },
    dimension: string,
  ): string {
    const parts: string[] = [];

    // 1. 区域范围
    parts.push(`位置: ${dimension} (${bounds.x1},${bounds.z1}) ~ (${bounds.x2},${bounds.z2})`);

    // 2. 命名区域
    if (regions.length > 0) {
      const regionDesc = regions.map(r => `${r.name}[${r.regionType}]`).join(', ');
      parts.push(`命名区域: ${regionDesc}`);
    }

    // 3. 特征统计
    const stats = this.countByType(features);
    if (Object.keys(stats).length > 0) {
      parts.push(`特征: ${Object.entries(stats).map(([k, v]) => `${k}×${v}`).join(', ')}`);
    }

    // 4. 关键点（高重要度/高频访问）
    const hotspots = features
      .filter(f => f.tags.includes('important') || f.tags.includes('hot'))
      .slice(0, 3);
    if (hotspots.length > 0) {
      parts.push(`关键点: ${hotspots.map(h => h.name || '匿名').join(', ')}`);
    }

    return parts.join('。');
  }

  private static countByType(features: MapFeature[]): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const f of features) {
      stats[f.featureType] = (stats[f.featureType] || 0) + 1;
    }
    return stats;
  }
}
```

### 2.7 关键设计决策

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| **空间索引方案** | R-tree / QuadTree / Chunk 网格 | **Chunk 对齐网格** | Minecraft 原生 Chunk 结构 (16×16)，无需额外库，SQL 查询简单，足够满足邻近查询需求 |
| **查询引擎位置** | 全 SQL / 全内存 / 混合 | **全内存查询 + SQLite 持久化** | 全内存查询性能 < 10ms，写入时同步写 SQLite 保证持久化 |
| **内存索引结构** | 数组遍历 / Map + Set / 第三方库 | **Map + Set 嵌套结构** | 按 dimension → chunkKey → featureId 三级索引，查询 O(1) 定位 Chunk |
| **自动同步方式** | 事件监听 / 装饰器 / 钩子函数 | **MemoryManager 事件监听** | V11 MemoryManager 已有清晰的 store/update/forget 方法，在方法内触发同步事件 |
| **概览生成方式** | LLM 生成 / 模板拼接 / 混合 | **模板拼接** | 结构化数据的摘要生成不需要 LLM 参与，规则模板足够且快（< 1ms） |
| **UI 通信方式** | IPC invoke / WebSocket / HTTP | **Electron IPC invoke** | 与主进程内存共享，invoke 最直接，延迟 < 5ms |
| **UI 框架** | React / Vue / Svelte | **React（与现有项目一致）** | Agent Core 已使用 React，复用现有组件和工具链 |
| **地图特征写入 Chroma** | 是 / 否 | **metadata 写入 Chroma** | map_features 的 metadata 字段写入 Chroma，支持"找钻石""村庄附近"等语义搜索 |

### 2.8 文件结构

```
src/main/memory/
├── index.ts                  # 模块导出
├── types.ts                  # 记忆相关类型定义（V11 + V12 地图类型）
├── schema.sql               # SQLite DDL（V11 + V12 新增表）
├── sqlite-store.ts           # SQLite 存储实现（V11）
├── chroma-store.ts           # Chroma 向量存储实现（V11）
├── embedding.ts              # Embedding 模型封装（V11）
├── memory-manager.ts         # MemoryManager 统一 API（V11）
├── cleanup-engine.ts         # 自动清理引擎（V11）
├── map-index.ts              # MapIndex 地图索引引擎（V12 新增）
├── map-sync.ts               # MapSync 自动同步器（V12 新增）
├── overview-builder.ts       # 概览摘要生成器（V12 新增）

src/main/tools/map/
├── map_query_nearby.ts       # 邻近查询工具（V12 新增）
├── map_get_overview.ts       # 区域概览工具（V12 新增）

src/renderer/pages/
├── ~~MemoryBrowser.tsx~~      # ~~记忆浏览器首页（V12 新增）~~ **已废弃**
├── ~~MemoryDetail.tsx~~       # ~~记忆详情页（V12 新增）~~ **已废弃**
├── ~~MemoryEdit.tsx~~         # ~~记忆编辑对话框（V12 新增）~~ **已废弃**

src/renderer/components/
├── ~~MemoryFilter.tsx~~       # ~~筛选面板组件（V12 新增）~~ **已废弃**
├── ~~MemoryList.tsx~~         # ~~记忆列表组件（V12 新增）~~ **已废弃**
├── ~~MemoryCard.tsx~~         # ~~记忆卡片组件（V12 新增）~~ **已废弃**

__tests__/memory/
├── ...
├── map-index.test.ts          # 地图索引测试（V12 新增）
├── map-sync.test.ts           # 自动同步测试（V12 新增）
├── overview-builder.test.ts   # 概览生成器测试（V12 新增）

__tests__/tools/map/
├── map_query_nearby.test.ts   # 邻近查询工具测试（V12 新增）
├── map_get_overview.test.ts   # 区域概览工具测试（V12 新增）
```

### 2.9 非功能需求

| 指标 | 目标 | 测量方式 |
|------|------|----------|
| 邻近查询 | < 10ms（10 万条特征，半径 64） | 基准测试 |
| 区域概览 | < 20ms（10 万条特征，半径 128） | 基准测试 |
| 启动加载 | < 500ms（10 万条特征） | 启动计时 |
| 内存占用 | < 5MB（10 万条特征） | 运行时监控 |
| 特征同步延迟 | < 5ms（内存写入 + SQLite 写入） | 计时日志 |
| 概览摘要生成 | < 1ms（1000 条特征） | 计时日志 |
| ~~UI 列表查询~~ | ~~< 500ms（1000 条记忆，分页）~~ | ~~React DevTools Profiler~~ | **已废弃** |
| ~~UI 页面切换~~ | ~~< 200ms~~ | ~~React DevTools Profiler~~ | **已废弃** |
| ~~UI 编辑保存~~ | ~~< 200ms（含 IPC + 数据库写入）~~ | ~~计时日志~~ | **已废弃** |

### 2.10 查询优化

| 场景 | 索引策略 | 说明 |
|------|----------|------|
| 邻近查询（半径 R） | Chunk 网格 + 精确距离 | 先查 Chunk 范围，再欧几里得过滤 |
| 区域查询（矩形） | 内存遍历 + 坐标比较 | 遍历 Chunk 范围内特征，按边界过滤 |
| 区域重叠检测 | 区域列表遍历 | `x1 <= query_x2 AND x2 >= query_x1 AND z1 <= query_z2 AND z2 >= query_z1` |
| 维度隔离 | byDimension Map | 所有查询先按 dimension 定位到子 Map |
| 单条 ID 查询 | byId Map | O(1) Map 直接查找 |