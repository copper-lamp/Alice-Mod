-- V13 任务系统 — SQLite DDL
-- 任务元数据表、依赖表、调度表

-- ════════════════════════════════════════════════════════════════
-- 1. 任务元数据表
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS task_meta (
  id TEXT PRIMARY KEY,                              -- UUID v4
  workspace_id TEXT NOT NULL,                        -- 所属工作区
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK(type IN ('simple', 'composite', 'loop', 'conditional')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK(priority IN ('critical', 'high', 'normal', 'low')),
  timeout INTEGER,                                  -- 超时（秒）
  tags TEXT NOT NULL DEFAULT '[]',                   -- JSON array
  metadata TEXT,                                    -- 扩展属性 JSON

  -- JSON 字段（按任务类型不同）
  action_json TEXT,                                 -- ToolCall JSON
  subtask_ids TEXT,                                 -- JSON array of string
  loop_config_json TEXT,                            -- LoopConfig JSON
  condition_json TEXT,                              -- Condition JSON
  retry_config_json TEXT,                           -- RetryConfig JSON
  schedule_config_json TEXT,                        -- ScheduleConfig JSON

  -- 执行结果
  result_json TEXT,                                 -- 执行结果 JSON
  error TEXT,                                       -- 错误信息
  retry_count INTEGER NOT NULL DEFAULT 0,

  -- 时间戳
  created_at INTEGER NOT NULL,                       -- unix timestamp (秒)
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_meta_workspace ON task_meta(workspace_id);
CREATE INDEX IF NOT EXISTS idx_task_meta_status ON task_meta(status);
CREATE INDEX IF NOT EXISTS idx_task_meta_priority ON task_meta(priority);
CREATE INDEX IF NOT EXISTS idx_task_meta_type ON task_meta(type);
CREATE INDEX IF NOT EXISTS idx_task_meta_created ON task_meta(created_at);

-- ════════════════════════════════════════════════════════════════
-- 2. 任务依赖表
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS task_deps (
  task_id TEXT NOT NULL,
  depends_on_id TEXT NOT NULL,                       -- 依赖的任务 ID
  PRIMARY KEY (task_id, depends_on_id),
  FOREIGN KEY (task_id) REFERENCES task_meta(id) ON DELETE CASCADE,
  FOREIGN KEY (depends_on_id) REFERENCES task_meta(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_deps_task ON task_deps(task_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_depends ON task_deps(depends_on_id);

-- ════════════════════════════════════════════════════════════════
-- 3. 任务调度表（定时/延迟任务）
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS task_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL UNIQUE,
  schedule_mode TEXT NOT NULL CHECK(schedule_mode IN ('immediate', 'delayed', 'cron', 'event')),
  scheduled_at INTEGER,                              -- 计划执行时间（unix timestamp）
  cron_expression TEXT,                              -- cron 表达式
  trigger_event TEXT,                                -- 触发事件名
  last_triggered_at INTEGER,                         -- 上次触发时间
  FOREIGN KEY (task_id) REFERENCES task_meta(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_schedule_scheduled ON task_schedule(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_task_schedule_event ON task_schedule(trigger_event);