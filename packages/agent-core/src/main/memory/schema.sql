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