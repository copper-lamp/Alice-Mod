/**
 * V11 记忆系统 v1 — 类型定义
 *
 * 所有记忆相关类型定义，涵盖 5 种记忆类型、8 个记忆分支、14 个 MemoryManager 方法的参数/返回值。
 */

// ════════════════════════════════════════════════════════════════
// 1. 记忆类型与分支
// ════════════════════════════════════════════════════════════════

/** 记忆类型 */
export type MemoryType =
  /** 玩家习惯 — 记住玩家偏好和行为模式 */
  | 'player_habit'
  /** 地图关键点 — 记住坐标和位置信息 */
  | 'map_point'
  /** 地图区域 — 命名区域 */
  | 'map_region'
  /** 地图生物群系 — 生物群系记录 */
  | 'map_biome'
  /** 任务经验 — 记住任务执行经验 */
  | 'task_experience'
  /** 社交关系 — 记住与其他玩家的关系 */
  | 'social'
  /** 技能 — 记住已学技能 */
  | 'skill';

/** 记忆分支 */
export type MemoryBranch =
  | 'character'       // 角色记忆 — 身份、人设、行为特征
  | 'emotion'         // 情绪特征 — 情绪状态、变化
  | 'environment'     // 环境记忆 — 场景、坐标、描述
  | 'experience'      // 经验库 — 交互经验、教训
  | 'knowledge'       // 知识库 — 领域知识、技能档案
  | 'user_preference' // 用户偏好 — 用户信息、偏好
  | 'emotion_log'     // 情绪记录 — 时序数据
  | 'task_archive';   // 任务存档 — 预设/自定义任务

/** 所有 MemoryType 的列表（用于校验） */
export const MEMORY_TYPES: readonly MemoryType[] = [
  'player_habit',
  'map_point',
  'map_region',
  'map_biome',
  'task_experience',
  'social',
  'skill',
];

/** 所有 MemoryBranch 的列表（用于校验） */
export const MEMORY_BRANCHES: readonly MemoryBranch[] = [
  'character',
  'emotion',
  'environment',
  'experience',
  'knowledge',
  'user_preference',
  'emotion_log',
  'task_archive',
];

// ════════════════════════════════════════════════════════════════
// 2. 核心实体
// ════════════════════════════════════════════════════════════════

/** 记忆实体 — 核心数据模型 */
export interface Memory {
  /** 唯一标识（UUID v4） */
  id: string;
  /** 工作区 ID（隔离用） */
  workspaceId: string;
  /** 记忆类型 */
  type: MemoryType;
  /** 记忆分支 */
  branch: MemoryBranch;
  /** 记忆内容（结构化 JSON） */
  content: Record<string, unknown>;
  /** 标签列表 */
  tags: string[];
  /** 重要度 1-10（10=最重要，永不过期） */
  importance: number;
  /** 访问次数 */
  accessCount: number;
  /** Chroma 向量 ID（关联用，null 表示未嵌入） */
  embeddingId: string | null;
  /** 创建时间（unix timestamp） */
  createdAt: number;
  /** 最后更新时间 */
  updatedAt: number;
  /** 过期时间（null=永不过期） */
  expiresAt: number | null;
}

// ════════════════════════════════════════════════════════════════
// 3. 存储参数/返回值
// ════════════════════════════════════════════════════════════════

/** 存储单条记忆的参数 */
export interface StoreParams {
  /** 记忆类型 */
  type: MemoryType;
  /** 记忆分支（可选） */
  branch?: MemoryBranch;
  /** 记忆内容（结构化 JSON） */
  content: Record<string, unknown>;
  /** 标签列表（可选） */
  tags?: string[];
  /** 重要度 1-10（可选，默认 5） */
  importance?: number;
  /** 过期时间（unix timestamp，null=永不过期，可选） */
  expiresAt?: number | null;
}

/** 存储单条记忆的结果 */
export interface StoreResult {
  /** 记忆 ID */
  id: string;
  /** 创建时间 */
  createdAt: number;
}

/** 批量存储的参数 */
export interface BatchStoreParams {
  /** 记忆列表 */
  items: StoreParams[];
}

/** 批量存储的结果 */
export interface BatchStoreResult {
  /** 所有记忆的 ID 列表 */
  ids: string[];
  /** 成功存储的数量 */
  count: number;
}

// ════════════════════════════════════════════════════════════════
// 4. 检索参数/返回值
// ════════════════════════════════════════════════════════════════

/** 条件检索参数 */
export interface RecallParams {
  /** 按 ID 精确查找（与其它条件互斥） */
  id?: string;
  /** 记忆类型（可选） */
  type?: MemoryType;
  /** 记忆分支（可选） */
  branch?: MemoryBranch;
  /** 标签（可选，包含任意一个即匹配） */
  tags?: string[];
  /** 最低重要度（可选，>= 此值） */
  minImportance?: number;
  /** 关键词匹配（可选，在 content_json 中模糊搜索） */
  keywords?: string[];
  /** 语义查询文本（可选，与其它条件组合使用） */
  similarTo?: string;
  /** 工作区 ID（可选，默认当前工作区） */
  workspaceId?: string;
  /** 分页 — 返回数量 */
  limit?: number;
  /** 分页 — 偏移量 */
  offset?: number;
  /** 排序字段 */
  orderBy?: 'created_at' | 'importance' | 'access_count' | 'updated_at';
  /** 排序方向 */
  orderDir?: 'asc' | 'desc';
}

/** 条件检索结果 */
export interface RecallResult {
  /** 匹配的记忆列表 */
  memories: Memory[];
  /** 总匹配数（不分页） */
  total: number;
  /** 实际返回的 limit */
  limit: number;
  /** 实际使用的 offset */
  offset: number;
}

/** 语义检索参数 */
export interface SimilarParams {
  /** 查询文本（会生成向量） */
  query: string;
  /** 记忆类型筛选（可选） */
  type?: MemoryType;
  /** 记忆分支筛选（可选） */
  branch?: MemoryBranch;
  /** 工作区 ID（可选） */
  workspaceId?: string;
  /** 返回数量（默认 10） */
  limit?: number;
  /** 相似度阈值 0-1（低于此值不返回，默认 0.5） */
  minScore?: number;
}

/** 带相似度分数的记忆 */
export interface ScoredMemory extends Memory {
  /** 相似度分数（0-1） */
  similarityScore: number;
}

/** 语义检索结果 */
export interface SimilarResult {
  /** 按相似度降序排列的记忆列表 */
  memories: ScoredMemory[];
}

/** 分页列表参数 */
export interface ListParams {
  /** 记忆类型（可选） */
  type?: MemoryType;
  /** 记忆分支（可选） */
  branch?: MemoryBranch;
  /** 标签（可选） */
  tags?: string[];
  /** 关键词匹配（可选，在 content_json 中模糊搜索） */
  keywords?: string[];
  /** 工作区 ID（可选） */
  workspaceId?: string;
  /** 返回数量 */
  limit?: number;
  /** 偏移量 */
  offset?: number;
  /** 排序字段 */
  orderBy?: 'created_at' | 'importance' | 'access_count';
  /** 排序方向 */
  orderDir?: 'asc' | 'desc';
}

/** 分页列表结果 */
export interface ListResult {
  memories: Memory[];
  total: number;
  limit: number;
  offset: number;
}

// ════════════════════════════════════════════════════════════════
// 5. 删除参数
// ════════════════════════════════════════════════════════════════

/** 按条件批量删除的参数 */
export interface ForgetByParams {
  /** 记忆类型（可选） */
  type?: MemoryType;
  /** 记忆分支（可选） */
  branch?: MemoryBranch;
  /** 标签（可选） */
  tags?: string[];
  /** 仅删除重要度 <= 此值的（可选） */
  minImportance?: number;
  /** 仅删除早于此时间戳的（可选） */
  olderThan?: number;
  /** 工作区 ID（可选） */
  workspaceId?: string;
}

// ════════════════════════════════════════════════════════════════
// 6. 统计
// ════════════════════════════════════════════════════════════════

/** 记忆统计 */
export interface MemoryStats {
  /** 记忆总数 */
  total: number;
  /** 按类型分布 */
  byType: Partial<Record<MemoryType, number>>;
  /** 按分支分布 */
  byBranch: Partial<Record<MemoryBranch, number>>;
  /** 标签总数 */
  totalTags: number;
  /** 平均重要度 */
  averageImportance: number;
  /** 最旧记忆的时间戳 */
  oldestMemory: number;
  /** 最新记忆的时间戳 */
  newestMemory: number;
  /** 未嵌入向量数 */
  unembeddedCount: number;
}

// ════════════════════════════════════════════════════════════════
// 7. 清理
// ════════════════════════════════════════════════════════════════

/** 清理选项 */
export interface CleanupOptions {
  /** 清理模式 */
  mode: 'expired' | 'low_importance' | 'all';
  /** 低重要度阈值（仅 mode=low_importance 时有效，默认 2） */
  importanceThreshold?: number;
  /** 保留最近 N 条（防止全删光，默认 100） */
  keepRecent?: number;
}

/** 单条清理详情 */
export interface CleanupDetail {
  /** 被清理的记忆 ID */
  id: string;
  /** 清理原因 */
  reason: string;
}

/** 清理结果 */
export interface CleanupResult {
  /** 删除的记录数 */
  removed: number;
  /** 保留的记录数 */
  kept: number;
  /** 清理详情 */
  details: CleanupDetail[];
}

// ════════════════════════════════════════════════════════════════
// 8. 导出/导入
// ════════════════════════════════════════════════════════════════

/** 导出选项 */
export interface ExportOptions {
  /** 记忆类型筛选（可选） */
  type?: MemoryType;
  /** 记忆分支筛选（可选） */
  branch?: MemoryBranch;
  /** 指定记忆 ID 列表（可选） */
  ids?: string[];
  /** 导出格式（默认 json） */
  format?: 'json' | 'jsonl';
}

/** 导入结果 */
export interface ImportResult {
  /** 成功导入的数量 */
  imported: number;
  /** 跳过的数量 */
  skipped: number;
  /** 错误详情 */
  errors: Array<{ index: number; reason: string }>;
}

// ════════════════════════════════════════════════════════════════
// 9. 配置
// ════════════════════════════════════════════════════════════════

/** 嵌入模型配置 */
export interface EmbeddingConfig {
  /** 嵌入模型提供商 */
  provider: 'openai' | 'ollama';
  /** 模型名称 */
  model: string;
  /** API Key（OpenAI 时需要） */
  apiKey?: string;
  /** API 基础地址（可选） */
  baseUrl?: string;
  /** 向量维度 */
  dimension: number;
}

/** Chroma 配置 */
export interface ChromaConfig {
  /** 集合名称（默认 mcagent_memories） */
  collectionName?: string;
  /** 连接方式 */
  clientType: 'http' | 'embedded';
  /** HTTP 模式下的 URL（例如 http://localhost:8000） */
  url?: string;
  /** 嵌入式模式下的持久化路径 */
  persistPath?: string;
}

/** 自动清理配置 */
export interface AutoCleanupConfig {
  /** 是否启用（默认 true） */
  enabled: boolean;
  /** 清理间隔（ms，默认 86400000 = 24h） */
  intervalMs: number;
  /** 清理模式 */
  mode: 'expired' | 'low_importance' | 'all';
  /** 低重要度阈值（默认 2） */
  importanceThreshold?: number;
}

/** 容量限制 */
export interface MemoryLimits {
  /** 每类型记忆上限（默认 1000） */
  maxPerType: number;
  /** 总记忆上限（默认 10000） */
  maxTotal: number;
}

/** 记忆系统完整配置 */
export interface MemoryConfig {
  /** SQLite 数据库文件路径 */
  sqlitePath: string;
  /** Chroma 配置 */
  chroma: ChromaConfig;
  /** 嵌入模型配置 */
  embedding: EmbeddingConfig;
  /** 自动清理配置（可选） */
  autoCleanup?: AutoCleanupConfig;
  /** 容量限制（可选） */
  limits?: MemoryLimits;
}

// ════════════════════════════════════════════════════════════════
// 10. 默认配置常量
// ════════════════════════════════════════════════════════════════

/** 默认嵌入模型配置 */
export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  provider: 'openai',
  model: 'text-embedding-3-small',
  dimension: 1536,
};

/** 默认 Chroma 配置 */
export const DEFAULT_CHROMA_CONFIG: ChromaConfig = {
  collectionName: 'mcagent_memories',
  clientType: 'http',
  url: 'http://localhost:8000',
};

/** 默认自动清理配置 */
export const DEFAULT_AUTO_CLEANUP_CONFIG: AutoCleanupConfig = {
  enabled: true,
  intervalMs: 86400000, // 24h
  mode: 'all',
  importanceThreshold: 2,
};

/** 默认容量限制 */
export const DEFAULT_MEMORY_LIMITS: MemoryLimits = {
  maxPerType: 1000,
  maxTotal: 10000,
};

/** 默认记忆系统配置 */
export const DEFAULT_MEMORY_CONFIG: Partial<MemoryConfig> = {
  chroma: DEFAULT_CHROMA_CONFIG,
  embedding: DEFAULT_EMBEDDING_CONFIG,
  autoCleanup: DEFAULT_AUTO_CLEANUP_CONFIG,
  limits: DEFAULT_MEMORY_LIMITS,
};

// ════════════════════════════════════════════════════════════════
// V12 新增类型：地图索引
// ════════════════════════════════════════════════════════════════

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
  limit?: number;
}

/** 邻近查询结果条目 */
export interface NearbyQueryFeature {
  id: string;
  name?: string;
  featureType: FeatureType;
  x: number;
  y: number;
  z: number;
  tags: string[];
  distance: number;
}

/** 邻近查询结果 */
export interface NearbyQueryResult {
  features: NearbyQueryFeature[];
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

/** 区域概览结果中的区域信息 */
export interface OverviewRegion {
  id: string;
  name: string;
  regionType: RegionType;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/** 区域概览结果中的关键点 */
export interface OverviewHighlight {
  name?: string;
  featureType: FeatureType;
  x: number;
  z: number;
}

/** 区域概览结果 */
export interface OverviewResult {
  summary: string;
  featureStats: Record<string, number>;
  regions: OverviewRegion[];
  highlights: OverviewHighlight[];
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

/** 所有 FeatureType 的列表 */
export const FEATURE_TYPES: readonly FeatureType[] = [
  'point', 'resource', 'structure', 'biome', 'base', 'waypoint',
];

/** 所有 Dimension 的列表 */
export const DIMENSIONS: readonly Dimension[] = [
  'overworld', 'nether', 'the_end',
];

/** 所有 RegionType 的列表 */
export const REGION_TYPES: readonly RegionType[] = [
  'base', 'mine', 'farm', 'village', 'exploration', 'custom',
];

/** 地图类型记忆列表（自动同步空间索引） */
export const MAP_MEMORY_TYPES = new Set(['map_point', 'map_region', 'map_biome']);