-- V11 记忆系统 v1 — SQLite DDL
-- 记忆元数据表、标签索引表、访问日志表

-- 启用 WAL 模式（并发读友好）
PRAGMA journal_mode = WAL;

-- ════════════════════════════════════════════════════════════════
-- 1. 记忆元数据表
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS memory_meta (
  id TEXT PRIMARY KEY,                              -- UUID v4
  workspace_id TEXT NOT NULL,                        -- 工作区隔离
  type TEXT NOT NULL,                               -- 记忆类型
  branch TEXT NOT NULL DEFAULT 'experience',        -- 记忆分支
  content_json TEXT NOT NULL,                        -- 记忆内容 JSON
  tags TEXT NOT NULL DEFAULT '[]',                   -- JSON array 标签
  importance INTEGER NOT NULL DEFAULT 5 CHECK(importance >= 1 AND importance <= 10),
  access_count INTEGER NOT NULL DEFAULT 0,
  embedding_id TEXT,                                 -- Chroma 向量 ID
  created_at INTEGER NOT NULL,                       -- unix timestamp
  updated_at INTEGER NOT NULL,                       -- unix timestamp
  expires_at INTEGER                                 -- NULL = 永不过期
);

CREATE INDEX IF NOT EXISTS idx_memory_meta_workspace ON memory_meta(workspace_id);
CREATE INDEX IF NOT EXISTS idx_memory_meta_type ON memory_meta(type);
CREATE INDEX IF NOT EXISTS idx_memory_meta_branch ON memory_meta(branch);
CREATE INDEX IF NOT EXISTS idx_memory_meta_importance ON memory_meta(importance);
CREATE INDEX IF NOT EXISTS idx_memory_meta_created_at ON memory_meta(created_at);
CREATE INDEX IF NOT EXISTS idx_memory_meta_updated_at ON memory_meta(updated_at);
CREATE INDEX IF NOT EXISTS idx_memory_meta_expires_at ON memory_meta(expires_at);
CREATE INDEX IF NOT EXISTS idx_memory_meta_embedding ON memory_meta(embedding_id);

-- ════════════════════════════════════════════════════════════════
-- 2. 标签索引表
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS memory_tags (
  memory_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (memory_id, tag),
  FOREIGN KEY (memory_id) REFERENCES memory_meta(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag);

-- ════════════════════════════════════════════════════════════════
-- 3. 访问日志表
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS memory_access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  accessed_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'llm',                -- llm | tool | manual
  FOREIGN KEY (memory_id) REFERENCES memory_meta(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_access_log_memory_id ON memory_access_log(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_access_log_accessed_at ON memory_access_log(accessed_at);

-- ════════════════════════════════════════════════════════════════
-- V12 新增：地图索引表
-- ════════════════════════════════════════════════════════════════

-- 4. 地图特征表
CREATE TABLE IF NOT EXISTS map_features (
  id TEXT PRIMARY KEY,
  memory_id TEXT,
  workspace_id TEXT NOT NULL DEFAULT '',
  feature_type TEXT NOT NULL,
  name TEXT,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL DEFAULT 0,
  z INTEGER NOT NULL,
  dimension TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  metadata TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (memory_id) REFERENCES memory_meta(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_map_features_dimension ON map_features(dimension);
CREATE INDEX IF NOT EXISTS idx_map_features_type ON map_features(feature_type);
CREATE INDEX IF NOT EXISTS idx_map_features_coords ON map_features(dimension, x, z);
CREATE INDEX IF NOT EXISTS idx_map_features_workspace ON map_features(workspace_id);

-- 5. 空间网格索引表
CREATE TABLE IF NOT EXISTS map_spatial_grid (
  chunk_x INTEGER NOT NULL,
  chunk_z INTEGER NOT NULL,
  dimension TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  PRIMARY KEY (chunk_x, chunk_z, dimension, feature_id),
  FOREIGN KEY (feature_id) REFERENCES map_features(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_map_spatial_grid_dim ON map_spatial_grid(dimension, chunk_x, chunk_z);

-- 6. 命名区域表
CREATE TABLE IF NOT EXISTS map_regions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region_type TEXT NOT NULL,
  x1 INTEGER NOT NULL,
  z1 INTEGER NOT NULL,
  x2 INTEGER NOT NULL,
  z2 INTEGER NOT NULL,
  dimension TEXT NOT NULL,
  description TEXT,
  memory_id TEXT,
  workspace_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (memory_id) REFERENCES memory_meta(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_map_regions_dimension ON map_regions(dimension);
CREATE INDEX IF NOT EXISTS idx_map_regions_name ON map_regions(name);
CREATE INDEX IF NOT EXISTS idx_map_regions_workspace ON map_regions(workspace_id);

-- ════════════════════════════════════════════════════════════════
-- V13 新增：任务系统表
-- ════════════════════════════════════════════════════════════════

-- 7. 任务元数据表
CREATE TABLE IF NOT EXISTS task_meta (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK(type IN ('simple', 'composite', 'loop', 'conditional')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK(priority IN ('critical', 'high', 'normal', 'low')),
  timeout INTEGER,
  tags TEXT NOT NULL DEFAULT '[]',
  metadata TEXT,
  action_json TEXT,
  subtask_ids TEXT,
  loop_config_json TEXT,
  condition_json TEXT,
  retry_config_json TEXT,
  schedule_config_json TEXT,
  result_json TEXT,
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_meta_workspace ON task_meta(workspace_id);
CREATE INDEX IF NOT EXISTS idx_task_meta_status ON task_meta(status);
CREATE INDEX IF NOT EXISTS idx_task_meta_priority ON task_meta(priority);
CREATE INDEX IF NOT EXISTS idx_task_meta_type ON task_meta(type);
CREATE INDEX IF NOT EXISTS idx_task_meta_created ON task_meta(created_at);

-- 8. 任务依赖表
CREATE TABLE IF NOT EXISTS task_deps (
  task_id TEXT NOT NULL,
  depends_on_id TEXT NOT NULL,
  PRIMARY KEY (task_id, depends_on_id),
  FOREIGN KEY (task_id) REFERENCES task_meta(id) ON DELETE CASCADE,
  FOREIGN KEY (depends_on_id) REFERENCES task_meta(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_deps_task ON task_deps(task_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_depends ON task_deps(depends_on_id);

-- 9. 任务调度表
CREATE TABLE IF NOT EXISTS task_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL UNIQUE,
  schedule_mode TEXT NOT NULL CHECK(schedule_mode IN ('immediate', 'delayed', 'cron', 'event')),
  scheduled_at INTEGER,
  cron_expression TEXT,
  trigger_event TEXT,
  last_triggered_at INTEGER,
  FOREIGN KEY (task_id) REFERENCES task_meta(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_schedule_scheduled ON task_schedule(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_task_schedule_event ON task_schedule(trigger_event);