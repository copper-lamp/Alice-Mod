# Alice Mod Core V12 — 记忆系统 v2 执行文档

> 版本：v1.0
> 日期：2026-07-11
> 版本号：V12（第 15 周）
> 对应需求：AC-MEM-09 ~ AC-MEM-12、AC-UI-07
> 关联文档：[AC-V12-记忆系统v2-地图索引.md](AC-V12-记忆系统v2-地图索引.md)、[AC-02-实施计划.md](AC-02-实施计划.md)、[AC-03-规范与验收标准.md](AC-03-规范与验收标准.md)、[03-记忆系统接口规范.md](../../api/03-记忆系统接口规范.md)

---

## 1. 目标与范围

### 1.1 本次实现目标

实现 Agent Core 记忆系统的地图索引增强版本，在 V11 SQLite + Chroma 双模存储基础上，新增空间索引能力和记忆浏览器 UI。

具体目标：

1. 创建 3 张地图索引 SQLite 表（map_features / map_spatial_grid / map_regions），含空间索引。
2. 实现 MapIndex 引擎，基于 Chunk 对齐网格的全内存空间索引，支持邻近查询和区域查询。
3. 实现 2 个地图工具（map_query_nearby / map_get_overview）并注册到工作区工具列表。
4. 实现 MapSync 自动同步器，存入地图类型记忆时自动创建空间索引。
5. 实现地图索引全量内存加载，Agent Core 启动时加载所有地图数据到内存。
6. 实现记忆浏览器 UI，支持按类型/标签检索、查看详情、编辑、删除。

### 1.2 非目标

- 不实现地图区域命名工具（由 LLM 通过 memory_store 存入 map_region 类型记忆自动触发）。
- 不实现地图可视化（地图渲染需要 WebGL / Canvas，不在本版本范围内）。
- 不实现 Chroma 语义搜索地图特征（metadata 写入 Chroma 的功能可选，非必须）。
- 不实现记忆浏览器在移动端的适配（仅桌面端 Electron）。

### 1.3 前置依赖

| 依赖 | 说明 |
|------|------|
| V11 记忆系统 v1 | 需要已实现的 MemoryManager、SQLiteStore、记忆类型系统 |
| V3 工作区管理 | 需要 workspaceId 用于工具注册 |
| V3 工具注册 | 需要 ToolRegistry 将 2 个地图工具注册到工作区 |
| V8 主控制面板 | 记忆浏览器 UI 作为独立页面接入主控制面板导航 |
| React | 渲染进程已使用 React，记忆浏览器 UI 基于 React 构建 |

---

## 2. 关键设计决策

### 2.1 空间索引方案：Chunk 对齐网格

采用 Minecraft 原生 Chunk 结构 (16×16) 作为空间索引基础：

```
blockX >> 4 = chunkX
blockZ >> 4 = chunkZ
```

**为何选择 Chunk 网格而非 R-tree/QuadTree**：

| 方案 | 优点 | 缺点 | 选择 |
|------|------|------|:----:|
| **Chunk 网格** | 原生对齐 Minecraft 坐标系统，实现简单，无第三方依赖 | 密集区域查询效率略低 | **✓** |
| R-tree | 理论查询效率高 | 需要第三方库，实现复杂，过度设计 | |
| QuadTree | 动态密度自适应 | 实现复杂，维护成本高 | |

**适用性分析**：LLM 的邻近查询通常是"半径 32~128 方块"的范围，对应 4~16 个 Chunk 的查询范围。每个 Chunk 通常只有几个特征，整体查询量极小，Chunk 网格完全够用。

### 2.2 查询引擎位置：全内存 + SQLite 持久化

所有查询操作走内存，写入时同步写 SQLite：

```
查询流程:
  输入 → 内存索引（byDimension Map） → 过滤 → 排序 → 返回

写入流程:
  输入 → 更新内存索引 → 同步写 SQLite（同一事务）
```

**优势**：
- 查询性能 < 10ms，无需 SQL 解析开销
- 写入时保证内存和磁盘一致性
- 启动时全量加载，后续增量更新

### 2.3 地图特征自动同步策略

| 操作 | 同步行为 | 说明 |
|------|----------|------|
| 存储 `map_point` 记忆 | 自动创建 MapFeature + 写入空间网格 | 从 memory.content 提取 x/y/z/dimension |
| 存储 `map_region` 记忆 | 自动创建 MapRegion | 从 memory.content 提取 name/bounds/dimension |
| 存储 `map_biome` 记忆 | 自动创建 MapFeature（type=biome） | 从 memory.content 提取坐标和描述 |
| 更新关联记忆内容 | 同步更新 MapFeature/MapRegion 坐标和属性 | 坐标变更时重新计算 Chunk 索引 |
| 删除关联记忆 | 同步删除 MapFeature/MapRegion | ON DELETE SET NULL 保留孤立的特征记录 |

### 2.4 记忆浏览器 UI 设计

**页面结构**：

```
MemoryBrowserPage
├── MemoryFilter (筛选面板)
│   ├── Type 下拉选择
│   ├── Tags 多选输入
│   ├── Keywords 搜索框
│   └── 语义搜索开关
├── MemoryList (记忆列表)
│   ├── 分页导航
│   ├── MemoryCard × N (记忆卡片)
│   │   ├── 类型标签
│   │   ├── 内容摘要
│   │   ├── 重要度指示
│   │   ├── 标签列表
│   │   └── 操作按钮 (查看/编辑/删除)
│   └── 空数据/加载中状态
└── MemoryDetail (详情面板 / 抽屉)
    ├── 元数据展示
    ├── 内容 JSON 查看器
    ├── 标签编辑
    ├── 重要度编辑
    └── 保存/取消按钮
```

**IPC 通信接口**：

| IPC Channel | 方向 | 参数 | 返回值 |
|-------------|------|------|--------|
| `memory:list` | renderer → main | `{ type?, tags?, keywords?, limit?, offset? }` | `{ memories[], total }` |
| `memory:getById` | renderer → main | `{ id: string }` | `Memory \| null` |
| `memory:update` | renderer → main | `{ id, updates }` | `{ success }` |
| `memory:forget` | renderer → main | `{ id }` | `{ success }` |
| `memory:similar` | renderer → main | `{ query, type?, limit? }` | `{ memories[] }` |

---

## 3. 实施步骤

### 3.1 实施顺序

```
Step 1: SQLite 地图表创建 + MapIndex 引擎
  ↓
Step 2: 全量内存加载实现
  ↓
Step 3: MapSync 自动同步器
  ↓
Step 4: map_query_nearby 工具
  ↓
Step 5: map_get_overview 工具 + OverviewBuilder
  ↓
Step 6: 记忆浏览器 UI
  ↓
Step 7: 集成测试
```

### 3.2 详细实施步骤

#### Step 1: SQLite 地图表 + MapIndex 引擎

**文件**：`src/main/memory/map-index.ts`（新增）

**任务**：
1. 在 `schema.sql` 中添加 map_features / map_spatial_grid / map_regions 三张表的 DDL
2. 创建 `MapIndex` 类，实现内存索引初始化
3. 实现 `queryNearby()` — 邻近查询（Chunk 范围计算 + 距离过滤 + 排序）
4. 实现 `queryArea()` — 矩形区域查询
5. 实现 `addFeature()` / `updateFeature()` / `removeFeature()` — 特征 CRUD
6. 实现 `addRegion()` / `updateRegion()` / `removeRegion()` — 区域 CRUD
7. 实现 `stats()` — 索引统计

**关键实现要点**：

```typescript
class MapIndex {
  private byDimension: Map<string, Map<string, Set<string>>> = new Map();
  // byDimension: dimension → chunkKey(chunkX:chunkZ) → Set<featureId>
  private byId: Map<string, MapFeature> = new Map();
  private regions: Map<string, MapRegion> = new Map();
  private sqlite: SQLiteStore;

  queryNearby(params: NearbyQueryParams): NearbyQueryResult {
    const { x, z, radius, dimension, type, limit = 50 } = params;

    // 1. 计算 Chunk 范围
    const minChunkX = Math.floor((x - radius) / 16);
    const maxChunkX = Math.floor((x + radius) / 16);
    const minChunkZ = Math.floor((z - radius) / 16);
    const maxChunkZ = Math.floor((z + radius) / 16);

    // 2. 获取该维度的 Chunk 索引
    const dimensionIndex = this.byDimension.get(dimension);
    if (!dimensionIndex) return { features: [], count: 0, center: { x, z }, radius };

    // 3. 遍历 Chunk 范围收集候选特征
    const candidateIds = new Set<string>();
    for (let cx = minChunkX; cx <= maxChunkX; cx++) {
      for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
        const chunkKey = `${cx}:${cz}`;
        const features = dimensionIndex.get(chunkKey);
        if (features) {
          for (const id of features) {
            candidateIds.add(id);
          }
        }
      }
    }

    // 4. 精确距离过滤 + 类型筛选 + 排序
    const radiusSq = radius * radius;
    const results: Array<{ feature: MapFeature; distance: number }> = [];

    for (const id of candidateIds) {
      const feature = this.byId.get(id);
      if (!feature) continue;
      if (type && feature.featureType !== type) continue;

      const dx = feature.x - x;
      const dz = feature.z - z;
      const distSq = dx * dx + dz * dz;

      if (distSq <= radiusSq) {
        results.push({ feature, distance: Math.sqrt(distSq) });
      }
    }

    // 5. 按距离排序
    results.sort((a, b) => a.distance - b.distance);

    // 6. 取 limit 条
    const top = results.slice(0, limit);

    return {
      features: top.map(r => ({
        id: r.feature.id,
        name: r.feature.name,
        featureType: r.feature.featureType,
        x: r.feature.x,
        y: r.feature.y,
        z: r.feature.z,
        tags: r.feature.tags,
        distance: r.distance,
      })),
      count: top.length,
      center: { x, z },
      radius,
    };
  }
}
```

#### Step 2: 全量内存加载

**文件**：`src/main/memory/map-index.ts`（追加）

**任务**：
1. 实现 `load()` 方法：从 SQLite 读取所有 map_features 和 map_regions，构建内存索引
2. 实现 `refresh()` 方法：清空内存索引后重新加载
3. 在 Agent Core 启动流程中调用 `MapIndex.load()`

**关键实现要点**：

```typescript
async load(): Promise<void> {
  // 1. 加载所有 map_features
  const features = await this.sqlite.queryAll('SELECT * FROM map_features');
  for (const row of features) {
    const feature = this.rowToFeature(row);
    this.byId.set(feature.id, feature);

    // 构建 Chunk 索引
    const chunkX = feature.x >> 4;
    const chunkZ = feature.z >> 4;
    const chunkKey = `${chunkX}:${chunkZ}`;

    if (!this.byDimension.has(feature.dimension)) {
      this.byDimension.set(feature.dimension, new Map());
    }
    const dimIndex = this.byDimension.get(feature.dimension)!;
    if (!dimIndex.has(chunkKey)) {
      dimIndex.set(chunkKey, new Set());
    }
    dimIndex.get(chunkKey)!.add(feature.id);
  }

  // 2. 加载所有 map_regions
  const regions = await this.sqlite.queryAll('SELECT * FROM map_regions');
  for (const row of regions) {
    this.regions.set(row.id, this.rowToRegion(row));
  }

  this.logger.info(
    `MapIndex loaded: ${this.byId.size} features, ${this.regions.size} regions`
  );
}
```

#### Step 3: MapSync 自动同步器

**文件**：`src/main/memory/map-sync.ts`（新增）

**任务**：
1. 创建 `MapSync` 类，持有 MapIndex 和 MemoryManager 引用
2. 实现 `onMemoryStored()` — 检测记忆类型，自动创建空间索引
3. 实现 `onMemoryUpdated()` — 检测坐标/属性变更，同步更新
4. 实现 `onMemoryForgotten()` — 同步删除空间索引
5. 在 MemoryManager 中注册 MapSync 回调

**自动同步判定逻辑**：

```typescript
const MAP_MEMORY_TYPES = new Set(['map_point', 'map_region', 'map_biome']);

async onMemoryStored(memory: Memory): Promise<void> {
  if (!MAP_MEMORY_TYPES.has(memory.type)) return;

  const content = memory.content as Record<string, unknown>;
  const x = content.x as number;
  const z = content.z as number;
  const dimension = (content.dimension as string) || 'overworld';

  if (memory.type === 'map_region') {
    // 创建命名区域
    const region: MapRegion = {
      id: randomUUID(),
      name: (content.name as string) || 'unnamed',
      regionType: (content.regionType as RegionType) || 'custom',
      x1: content.x1 as number,
      z1: content.z1 as number,
      x2: content.x2 as number,
      z2: content.z2 as number,
      dimension,
      description: content.description as string,
      memoryId: memory.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await this.mapIndex.addRegion(region);
  } else {
    // 创建地图特征
    const feature: MapFeature = {
      id: randomUUID(),
      memoryId: memory.id,
      featureType: memory.type === 'map_point' ? 'point' : 'biome',
      name: content.name as string,
      x: x ?? 0,
      y: (content.y as number) ?? 0,
      z: z ?? 0,
      dimension: dimension as Dimension,
      tags: memory.tags,
      updatedAt: Date.now(),
    };
    await this.mapIndex.addFeature(feature);
  }
}
```

#### Step 4: map_query_nearby 工具

**文件**：`src/main/tools/map/map_query_nearby.ts`（新增）

**任务**：
1. 创建工具实现，定义 ToolSchema
2. 实现 `execute()` 方法，调用 MapIndex.queryNearby()
3. 格式化和返回结果

**预估工时**：3h

#### Step 5: map_get_overview 工具 + OverviewBuilder

**文件**：
- `src/main/tools/map/map_get_overview.ts`（新增）
- `src/main/memory/overview-builder.ts`（新增）

**任务**：
1. 创建 `OverviewBuilder` 类，实现结构化摘要生成
2. 创建工具实现，定义 ToolSchema
3. 实现 `execute()` 方法，调用 MapIndex.getOverview()

**预估工时**：4h

#### Step 6: 记忆浏览器 UI

**文件**：
- `src/renderer/pages/MemoryBrowser.tsx`（新增）
- `src/renderer/pages/MemoryDetail.tsx`（新增）
- `src/renderer/pages/MemoryEdit.tsx`（新增）
- `src/renderer/components/MemoryFilter.tsx`（新增）
- `src/renderer/components/MemoryList.tsx`（新增）
- `src/renderer/components/MemoryCard.tsx`（新增）

**任务**：
1. 实现 IPC 桥接（preload.ts 新增 memory:* 通道）
2. 实现 MemoryFilter 筛选面板组件
3. 实现 MemoryList + MemoryCard 列表组件（含分页和状态展示）
4. 实现 MemoryDetail 详情面板（抽屉式）
5. 实现 MemoryEdit 编辑对话框
6. 集成到主控制面板导航

**预估工时**：8h

#### Step 7: 集成测试

**任务**：
1. 编写 MapIndex 单元测试
2. 编写 MapSync 单元测试
3. 编写 OverviewBuilder 单元测试
4. 编写地图工具单元测试
5. 集成测试：全链路验证

**预估工时**：4h

### 3.3 任务分配

#### 开发者 A 任务

| # | 任务 | 产出物 | 预计工时 |
|---|------|--------|:--------:|
| A12.1 | 记忆浏览器 UI（筛选/列表/详情/编辑/删除） | `src/renderer/pages/MemoryBrowser.tsx` + 组件 | 8h |

#### 开发者 B 任务

| # | 任务 | 产出物 | 预计工时 |
|---|------|--------|:--------:|
| B12.1 | 地图索引 SQLite 表（DDL + 空间索引） | `src/main/memory/schema.sql`（追加） | 3h |
| B12.2 | MapIndex 引擎（全量内存加载 + 邻近查询 + 区域查询） | `src/main/memory/map-index.ts` | 8h |
| B12.3 | map_query_nearby 工具 | `src/main/tools/map/map_query_nearby.ts` | 3h |
| B12.4 | map_get_overview 工具 + OverviewBuilder | `src/main/tools/map/map_get_overview.ts` + `src/main/memory/overview-builder.ts` | 4h |
| B12.5 | MapSync 自动同步器 | `src/main/memory/map-sync.ts` | 3h |
| B12.6 | 全量内存加载（Agent Core 启动流程集成） | `src/main/memory/map-index.ts` - load/refresh | 2h |

**实施顺序**：B12.1 → B12.2 → B12.6 → B12.5 → B12.3 → B12.4 → A12.1

---

## 4. 文件变更清单

### 新增文件

```
packages/agent-core/src/main/memory/
├── map-index.ts                # MapIndex 地图索引引擎
├── map-sync.ts                 # MapSync 自动同步器
├── overview-builder.ts         # 概览摘要生成器

packages/agent-core/src/main/tools/map/
├── map_query_nearby.ts         # 邻近查询工具
├── map_get_overview.ts         # 区域概览工具

packages/agent-core/src/renderer/pages/
├── MemoryBrowser.tsx            # 记忆浏览器首页
├── MemoryDetail.tsx             # 记忆详情页
├── MemoryEdit.tsx               # 记忆编辑对话框

packages/agent-core/src/renderer/components/
├── MemoryFilter.tsx             # 筛选面板组件
├── MemoryList.tsx               # 记忆列表组件
├── MemoryCard.tsx               # 记忆卡片组件

packages/agent-core/__tests__/memory/
├── map-index.test.ts            # 地图索引测试
├── map-sync.test.ts             # 自动同步测试
├── overview-builder.test.ts     # 概览生成器测试

packages/agent-core/__tests__/tools/map/
├── map_query_nearby.test.ts     # 邻近查询工具测试
├── map_get_overview.test.ts     # 区域概览工具测试
```

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `packages/agent-core/src/main/memory/schema.sql` | 追加 map_features / map_spatial_grid / map_regions 三张表 DDL |
| `packages/agent-core/src/main/memory/types.ts` | 追加地图索引相关类型定义（MapFeature / MapRegion / NearbyQueryParams 等） |
| `packages/agent-core/src/main/memory/index.ts` | 导出 MapIndex / MapSync / OverviewBuilder |
| `packages/agent-core/src/main/memory/memory-manager.ts` | 集成 MapSync 回调（store/update/forget 时触发同步） |
| `packages/agent-core/src/main/tools/index.ts` | 注册 2 个地图工具 |
| `packages/agent-core/src/renderer/App.tsx` | 添加记忆浏览器路由 |
| `packages/agent-core/src/renderer/preload.ts` | 新增 memory:* IPC 桥接 |

---

## 5. 数据结构验收

### 5.1 SQLite 表结构

```sql
-- 地图特征表
CREATE TABLE IF NOT EXISTS map_features (
  id TEXT PRIMARY KEY,
  memory_id TEXT,
  feature_type TEXT NOT NULL CHECK(feature_type IN ('point','resource','structure','biome','base','waypoint')),
  name TEXT,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL DEFAULT 0,
  z INTEGER NOT NULL,
  dimension TEXT NOT NULL CHECK(dimension IN ('overworld','nether','the_end')),
  tags TEXT NOT NULL DEFAULT '[]',
  metadata TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (memory_id) REFERENCES memory_meta(id) ON DELETE SET NULL
);

CREATE INDEX idx_map_features_dimension ON map_features(dimension);
CREATE INDEX idx_map_features_type ON map_features(feature_type);
CREATE INDEX idx_map_features_coords ON map_features(dimension, x, z);

-- 空间网格索引
CREATE TABLE IF NOT EXISTS map_spatial_grid (
  chunk_x INTEGER NOT NULL,
  chunk_z INTEGER NOT NULL,
  dimension TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  PRIMARY KEY (chunk_x, chunk_z, dimension, feature_id),
  FOREIGN KEY (feature_id) REFERENCES map_features(id) ON DELETE CASCADE
);

CREATE INDEX idx_map_spatial_grid_dim ON map_spatial_grid(dimension, chunk_x, chunk_z);

-- 命名区域表
CREATE TABLE IF NOT EXISTS map_regions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region_type TEXT NOT NULL CHECK(region_type IN ('base','mine','farm','village','exploration','custom')),
  x1 INTEGER NOT NULL,
  z1 INTEGER NOT NULL,
  x2 INTEGER NOT NULL,
  z2 INTEGER NOT NULL,
  dimension TEXT NOT NULL,
  description TEXT,
  memory_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (memory_id) REFERENCES memory_meta(id) ON DELETE SET NULL
);

CREATE INDEX idx_map_regions_dimension ON map_regions(dimension);
CREATE INDEX idx_map_regions_name ON map_regions(name);
```

### 5.2 工具 Schema 验收

```typescript
// map_query_nearby 工具
{
  name: 'map_query_nearby',
  description: '以某坐标为中心，搜索半径范围内的地图特征',
  input_schema: {
    type: 'object',
    properties: {
      x: { type: 'integer' },
      z: { type: 'integer' },
      radius: { type: 'integer', default: 64 },
      dimension: { type: 'string', enum: ['overworld', 'nether', 'the_end'] },
      type: { type: 'string', enum: ['point','resource','structure','biome','base','waypoint'] },
      limit: { type: 'integer', default: 50 },
    },
    required: ['x', 'z', 'dimension'],
  },
}

// map_get_overview 工具
{
  name: 'map_get_overview',
  description: '获取指定坐标区域的综合地图摘要',
  input_schema: {
    type: 'object',
    properties: {
      x: { type: 'integer' },
      z: { type: 'integer' },
      radius: { type: 'integer', default: 128 },
      dimension: { type: 'string', enum: ['overworld', 'nether', 'the_end'] },
    },
    required: ['x', 'z', 'dimension'],
  },
}
```

---

## 6. 测试计划

### 6.1 MapIndex 单元测试

| # | 测试用例 | 输入 | 预期结果 |
|---|---------|------|----------|
| 1.1 | 空索引查询 | 任意坐标，半径 64 | 返回空列表 |
| 1.2 | 单特征邻近查询 | 特征在 (100,64,200)，查询 (100,200) 半径 64 | 返回该特征，距离正确 |
| 1.3 | 多特征排序 | 3 个距离不同的特征 | 按距离升序排列 |
| 1.4 | 跨维度隔离 | 主世界和下界各有特征 | 查询主世界不返回下界特征 |
| 1.5 | 类型筛选 | 只有 resource 类型特征 | 仅返回 resource 类型 |
| 1.6 | 数量限制 | 10 个特征，limit=3 | 返回 3 条 |
| 1.7 | 矩形区域查询 | 查询矩形范围 | 返回范围内的所有特征 |
| 1.8 | 区域重叠检测 | 查询区域与已有区域重叠 | 返回重叠区域 |

### 6.2 MapSync 单元测试

| # | 测试用例 | 输入 | 预期结果 |
|---|---------|------|----------|
| 2.1 | 存储 map_point 记忆 | `memory_store(type='map_point', content={x:100, y:64, z:200})` | 自动创建 MapFeature |
| 2.2 | 存储 map_region 记忆 | `memory_store(type='map_region', content={name:'base', x1:0, z1:0, x2:100, z2:100})` | 自动创建 MapRegion |
| 2.3 | 存储非地图记忆 | `memory_store(type='player_habit', ...)` | 不创建空间索引 |
| 2.4 | 更新地图记忆坐标 | 更新坐标后 | 空间索引同步更新 |
| 2.5 | 删除地图记忆 | 删除后 | 空间索引同步删除 |

### 6.3 OverviewBuilder 单元测试

| # | 测试用例 | 输入 | 预期结果 |
|---|---------|------|----------|
| 3.1 | 空区域概览 | 无特征、无区域 | 仅包含位置信息 |
| 3.2 | 多特征统计 | 3 个 resource + 2 个 structure | summary 包含 "resource×3, structure×2" |
| 3.3 | 命名区域 | 1 个 base 区域 | summary 包含命名区域描述 |
| 3.4 | 关键点提取 | 有 important 标签的特征 | 关键点列表包含该特征 |

### 6.4 地图工具测试

| # | 测试用例 | 调用工具 | 预期结果 |
|---|---------|----------|----------|
| 4.1 | 邻近查询 | `map_query_nearby(x=100, z=200, radius=64, dimension='overworld')` | 返回半径内特征 |
| 4.2 | 区域概览 | `map_get_overview(x=100, z=200, radius=128, dimension='overworld')` | 返回完整概览结果 |

### 6.5 集成测试

| # | 测试场景 | 步骤 | 预期结果 |
|---|---------|------|----------|
| 5.1 | 全链路：存储 → 查询 | 1. 存入 map_point 记忆<br>2. 调用 map_query_nearby | 查询返回该特征 |
| 5.2 | 全链路：自动同步 → 概览 | 1. 存入多个地图特征<br>2. 调用 map_get_overview | 概览包含这些特征统计 |
| 5.3 | 全链路：删除 → 查询 | 1. 存入 map_point 记忆<br>2. 删除该记忆<br>3. 调用 map_query_nearby | 不再返回该特征 |
| 5.4 | 启动加载 | 1. 重启 Agent Core<br>2. 调用 map_query_nearby | 重启前存储的特征仍可查询 |
| 5.5 | 记忆浏览器 UI | 1. 打开记忆浏览器<br>2. 按 type 过滤<br>3. 编辑记忆<br>4. 删除记忆 | 列表正确筛选，编辑/删除生效 |

---

## 7. 集成检查点

- [x] map_query_nearby 可返回附近标记点（半径 64 方块内）
- [x] map_get_overview 可描述区域地形/生物群系
- [x] 地图查询 < 10ms（10 万条特征，含内存加载）
- [x] 存入地图类型记忆时自动创建空间索引
- [x] 删除地图记忆时自动清理空间索引
- [x] 记忆浏览器可查看/编辑/删除记忆
- [x] 记忆浏览器支持按 type/tags/keywords 过滤
- [x] 启动时全量加载地图索引到内存
- [x] 重启后地图索引数据不丢失

---

## 8. 风险与应对

| 风险 | 影响 | 概率 | 应对措施 |
|------|------|:----:|----------|
| 内存索引占用过大 | 超过 5MB 内存上限 | 低 | 10 万特征约 20MB，实际场景通常几千条，可接受 |
| Chroma 语义搜索地图特征不可用 | 语义搜索降级 | 中 | 地图特征同步到 Chroma 为可选功能，不阻塞核心查询 |
| 浏览器 UI 与主进程 IPC 延迟 | UI 响应慢 | 低 | IPC invoke 延迟 < 5ms，主要耗时在数据库写入 |
| 并发写入导致内存和 SQLite 不一致 | 查询结果异常 | 低 | 写入操作使用 async/await 串行化，MapIndex 方法加锁保护 |