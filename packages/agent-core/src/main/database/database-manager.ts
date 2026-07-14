/**
 * DatabaseManager — 统一数据库管理器
 *
 * 集中管理 alice-mod.db 的连接、Schema 初始化、版本迁移和生命周期。
 * 所有模块共享同一个 DatabaseManager 实例，避免重复创建连接。
 */

import Database from 'better-sqlite3'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

// ════════════════════════════════════════════════════════════════
// 接口
// ════════════════════════════════════════════════════════════════

export interface IDatabaseManager {
  /** 初始化数据库连接（WAL + foreign_keys + schema 迁移） */
  init(dbPath: string): Promise<void>

  /** 获取底层 better-sqlite3 Database 实例 */
  getDb(): Database.Database

  /** 获取当前 Schema 版本号 */
  getSchemaVersion(): number

  /** 备份数据库到指定路径 */
  backup(backupPath: string): void

  /** 关闭数据库连接 */
  close(): void
}

// ════════════════════════════════════════════════════════════════
// DatabaseManager 实现
// ════════════════════════════════════════════════════════════════

export class DatabaseManager implements IDatabaseManager {
  private db: Database.Database | null = null
  private dbPath: string = ''

  async init(dbPath: string): Promise<void> {
    this.dbPath = dbPath

    // 确保目录存在
    const dir = dirname(dbPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    // 打开数据库连接
    this.db = new Database(dbPath)

    // 启用 WAL 模式（并发读友好）
    this.db.pragma('journal_mode = WAL')
    // 启用外键约束
    this.db.pragma('foreign_keys = ON')
    // 启用 WAL 自动检查点
    this.db.pragma('wal_autocheckpoint = 1000')

    // 执行 Schema 初始化
    this.initSchema()

    // 记录初始化完成
    const version = this.getSchemaVersion()
    console.info(`[DatabaseManager] 数据库初始化完成，schema 版本: ${version}`)
  }

  getDb(): Database.Database {
    if (!this.db) {
      throw new Error('DatabaseManager 尚未初始化，请先调用 init()')
    }
    return this.db
  }

  getSchemaVersion(): number {
    const db = this.getDb()
    try {
      const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null } | undefined
      return row?.version ?? 0
    } catch {
      return 0
    }
  }

  backup(backupPath: string): void {
    const db = this.getDb()
    const backupDir = dirname(backupPath)
    if (!existsSync(backupDir)) {
      mkdirSync(backupDir, { recursive: true })
    }
    db.backup(backupPath)
    console.info(`[DatabaseManager] 数据库已备份到: ${backupPath}`)
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
      console.info('[DatabaseManager] 数据库连接已关闭')
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Schema 初始化
  // ════════════════════════════════════════════════════════════════

  private initSchema(): void {
    const db = this.getDb()

    // 先创建 schema_version 表（用于版本追踪）
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL,
        module TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        applied_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_schema_version_module ON schema_version(module);
    `)

    // 读取统一 schema.sql 文件
    const schemaPath = join(__dirname, 'schema.sql')
    let ddl: string
    try {
      ddl = readFileSync(schemaPath, 'utf-8')
    } catch {
      console.warn('[DatabaseManager] schema.sql 文件读取失败，使用内联 DDL')
      ddl = this.getInlineSchema()
    }

    // 执行 DDL（幂等：所有表使用 CREATE TABLE IF NOT EXISTS）
    db.exec(ddl)

    // 记录当前 schema 版本
    this.recordSchemaVersion()
  }

  private recordSchemaVersion(): void {
    const db = this.getDb()
    const modules = [
      { version: 1, module: 'core', description: '基础表：schema_version, config, logs, tool_call_records' },
      { version: 1, module: 'workspace', description: '工作区表：workspace_meta' },
      { version: 1, module: 'instance', description: '实例表：instances' },
      { version: 1, module: 'llm', description: 'LLM 表：llm_call_records, llm_provider_config' },
      { version: 1, module: 'memory', description: '记忆表：memory_meta, memory_tags, memory_access_log' },
      { version: 1, module: 'map', description: '地图表：map_features, map_spatial_grid, map_regions' },
      { version: 1, module: 'task', description: '任务表：task_meta, task_deps, task_schedule' },
      { version: 1, module: 'world', description: '世界上下文表：world_meta' },
      { version: 1, module: 'qq', description: 'QQ 表：qq_bot_config, qq_msg_history' },
      { version: 1, module: 'trigger', description: '事件触发器表：event_triggers, trigger_logs, trigger_schedule' },
      { version: 1, module: 'future', description: '预留表：knowledge_base, skill_registry' },
    ]

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO schema_version (version, module, description, applied_at)
      VALUES (@version, @module, @description, @applied_at)
    `)

    const now = Date.now()
    for (const mod of modules) {
      insertStmt.run({ ...mod, applied_at: now })
    }
  }

  private getInlineSchema(): string {
    return `
      -- ████████████████████████████████████████████████████████████
      -- alice-mod.db 统一 Schema — 自动生成
      -- 所有表使用 CREATE TABLE IF NOT EXISTS，确保幂等初始化
      -- ████████████████████████████████████████████████████████████

      -- ════════════════════════════════════════════════════════════
      -- 1. 全局配置
      -- ════════════════════════════════════════════════════════════
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        value_type TEXT NOT NULL CHECK(value_type IN ('string', 'number', 'boolean', 'json')),
        description TEXT,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      -- ════════════════════════════════════════════════════════════
      -- 2. 日志系统
      -- ════════════════════════════════════════════════════════════
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        level TEXT NOT NULL CHECK(level IN ('debug', 'info', 'warning', 'error')),
        module TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata TEXT,
        request_id TEXT,
        workspace_id TEXT,
        tool_call_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
      CREATE INDEX IF NOT EXISTS idx_logs_module ON logs(module);
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_logs_workspace ON logs(workspace_id);

      CREATE TABLE IF NOT EXISTS tool_call_records (
        id TEXT PRIMARY KEY,
        pipeline_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        category TEXT,
        params TEXT,
        result TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'success', 'error')),
        level INTEGER NOT NULL DEFAULT 0,
        parent_id TEXT,
        timestamp INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_tcr_workspace ON tool_call_records(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_tcr_pipeline ON tool_call_records(pipeline_id);
      CREATE INDEX IF NOT EXISTS idx_tcr_timestamp ON tool_call_records(timestamp);
      CREATE INDEX IF NOT EXISTS idx_tcr_status ON tool_call_records(status);

      -- ════════════════════════════════════════════════════════════
      -- 3. 工作区与实例
      -- ════════════════════════════════════════════════════════════
      CREATE TABLE IF NOT EXISTS workspace_meta (
        id TEXT PRIMARY KEY,
        instance_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        edition TEXT,
        protocol_version TEXT,
        mod_version TEXT,
        source TEXT NOT NULL DEFAULT 'auto' CHECK(source IN ('auto', 'manual')),
        state TEXT NOT NULL DEFAULT 'offline' CHECK(state IN ('offline', 'connecting', 'online')),
        tool_count INTEGER NOT NULL DEFAULT 0,
        last_online_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_workspace_meta_instance ON workspace_meta(instance_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_meta_state ON workspace_meta(state);

      CREATE TABLE IF NOT EXISTS instances (
        instance_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        edition TEXT NOT NULL CHECK(edition IN ('bedrock', 'java')),
        host TEXT NOT NULL DEFAULT '127.0.0.1',
        tcp_port INTEGER NOT NULL DEFAULT 27541,
        auth_token TEXT,
        description TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_instances_edition ON instances(edition);

      -- ════════════════════════════════════════════════════════════
      -- 4. LLM 调度系统
      -- ════════════════════════════════════════════════════════════
      CREATE TABLE IF NOT EXISTS llm_call_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id TEXT NOT NULL,
        model TEXT NOT NULL,
        success INTEGER NOT NULL CHECK(success IN (0, 1)),
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        duration_ms INTEGER NOT NULL,
        error_message TEXT,
        request_id TEXT,
        workspace_id TEXT,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_llm_call_provider ON llm_call_records(provider_id);
      CREATE INDEX IF NOT EXISTS idx_llm_call_model ON llm_call_records(model);
      CREATE INDEX IF NOT EXISTS idx_llm_call_timestamp ON llm_call_records(timestamp);
      CREATE INDEX IF NOT EXISTS idx_llm_call_workspace ON llm_call_records(workspace_id);

      CREATE TABLE IF NOT EXISTS llm_provider_config (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider_type TEXT NOT NULL CHECK(provider_type IN ('openai', 'claude', 'gemini', 'ollama')),
        base_url TEXT NOT NULL,
        api_key_encrypted TEXT,
        default_model TEXT NOT NULL,
        models TEXT NOT NULL DEFAULT '[]',
        timeout INTEGER NOT NULL DEFAULT 60000,
        max_retries INTEGER NOT NULL DEFAULT 3,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_llm_provider_type ON llm_provider_config(provider_type);
      CREATE INDEX IF NOT EXISTS idx_llm_provider_enabled ON llm_provider_config(is_enabled);

      -- ════════════════════════════════════════════════════════════
      -- 5. 记忆系统
      -- ════════════════════════════════════════════════════════════
      CREATE TABLE IF NOT EXISTS memory_meta (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        type TEXT NOT NULL,
        branch TEXT NOT NULL DEFAULT 'experience',
        content_json TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        importance INTEGER NOT NULL DEFAULT 5 CHECK(importance >= 1 AND importance <= 10),
        access_count INTEGER NOT NULL DEFAULT 0,
        embedding_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_memory_meta_workspace ON memory_meta(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_memory_meta_type ON memory_meta(type);
      CREATE INDEX IF NOT EXISTS idx_memory_meta_branch ON memory_meta(branch);
      CREATE INDEX IF NOT EXISTS idx_memory_meta_importance ON memory_meta(importance);
      CREATE INDEX IF NOT EXISTS idx_memory_meta_created_at ON memory_meta(created_at);
      CREATE INDEX IF NOT EXISTS idx_memory_meta_updated_at ON memory_meta(updated_at);
      CREATE INDEX IF NOT EXISTS idx_memory_meta_expires_at ON memory_meta(expires_at);
      CREATE INDEX IF NOT EXISTS idx_memory_meta_embedding ON memory_meta(embedding_id);

      CREATE TABLE IF NOT EXISTS memory_tags (
        memory_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (memory_id, tag),
        FOREIGN KEY (memory_id) REFERENCES memory_meta(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag);

      CREATE TABLE IF NOT EXISTS memory_access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL,
        accessed_at INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT 'llm',
        FOREIGN KEY (memory_id) REFERENCES memory_meta(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_memory_access_log_memory_id ON memory_access_log(memory_id);
      CREATE INDEX IF NOT EXISTS idx_memory_access_log_accessed_at ON memory_access_log(accessed_at);

      -- ════════════════════════════════════════════════════════════
      -- 6. 地图索引
      -- ════════════════════════════════════════════════════════════
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
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        FOREIGN KEY (memory_id) REFERENCES memory_meta(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_map_features_dimension ON map_features(dimension);
      CREATE INDEX IF NOT EXISTS idx_map_features_type ON map_features(feature_type);
      CREATE INDEX IF NOT EXISTS idx_map_features_coords ON map_features(dimension, x, z);
      CREATE INDEX IF NOT EXISTS idx_map_features_workspace ON map_features(workspace_id);

      CREATE TABLE IF NOT EXISTS map_spatial_grid (
        chunk_x INTEGER NOT NULL,
        chunk_z INTEGER NOT NULL,
        dimension TEXT NOT NULL,
        feature_id TEXT NOT NULL,
        PRIMARY KEY (chunk_x, chunk_z, dimension, feature_id),
        FOREIGN KEY (feature_id) REFERENCES map_features(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_map_spatial_grid_dim ON map_spatial_grid(dimension, chunk_x, chunk_z);

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
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        FOREIGN KEY (memory_id) REFERENCES memory_meta(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_map_regions_dimension ON map_regions(dimension);
      CREATE INDEX IF NOT EXISTS idx_map_regions_name ON map_regions(name);
      CREATE INDEX IF NOT EXISTS idx_map_regions_workspace ON map_regions(workspace_id);

      -- ════════════════════════════════════════════════════════════
      -- 7. 世界上下文
      -- ════════════════════════════════════════════════════════════

      CREATE TABLE IF NOT EXISTS world_meta (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        world_name TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'offline' CHECK(state IN ('offline', 'connecting', 'online')),
        edition TEXT,
        game_version TEXT,
        connected_at INTEGER,
        last_online_at INTEGER,
        bot_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspace_meta(id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_world_meta_workspace_world
        ON world_meta(workspace_id, world_name);
      CREATE INDEX IF NOT EXISTS idx_world_meta_state ON world_meta(state);

      -- ════════════════════════════════════════════════════════════
      -- 8. 任务系统
      -- ════════════════════════════════════════════════════════════
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

      CREATE TABLE IF NOT EXISTS task_deps (
        task_id TEXT NOT NULL,
        depends_on_id TEXT NOT NULL,
        PRIMARY KEY (task_id, depends_on_id),
        FOREIGN KEY (task_id) REFERENCES task_meta(id) ON DELETE CASCADE,
        FOREIGN KEY (depends_on_id) REFERENCES task_meta(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_task_deps_task ON task_deps(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_deps_depends ON task_deps(depends_on_id);

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

      -- ════════════════════════════════════════════════════════════
      -- 9. QQ 机器人
      -- ════════════════════════════════════════════════════════════
      CREATE TABLE IF NOT EXISTS qq_bot_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        config_key TEXT NOT NULL UNIQUE,
        config_value TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_qq_bot_config_key ON qq_bot_config(config_key);

      CREATE TABLE IF NOT EXISTS qq_msg_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        msg_id TEXT,
        type TEXT NOT NULL CHECK(type IN ('group', 'private')),
        group_id TEXT,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        content TEXT NOT NULL,
        direction TEXT NOT NULL CHECK(direction IN ('incoming', 'outgoing')),
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_qq_msg_type ON qq_msg_history(type);
      CREATE INDEX IF NOT EXISTS idx_qq_msg_group ON qq_msg_history(group_id);
      CREATE INDEX IF NOT EXISTS idx_qq_msg_user ON qq_msg_history(user_id);
      CREATE INDEX IF NOT EXISTS idx_qq_msg_timestamp ON qq_msg_history(timestamp);

      -- ════════════════════════════════════════════════════════════
      -- 10. 事件触发器
      -- ════════════════════════════════════════════════════════════

      CREATE TABLE IF NOT EXISTS event_triggers (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL CHECK(source IN ('cron', 'game_chat', 'plugin_event', 'qq')),
        priority INTEGER NOT NULL DEFAULT 5,
        rule_json TEXT NOT NULL,
        action_json TEXT NOT NULL,
        cooldown_seconds INTEGER NOT NULL DEFAULT 0,
        max_trigger_count INTEGER,
        trigger_count INTEGER NOT NULL DEFAULT 0,
        last_triggered_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_event_triggers_workspace ON event_triggers(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_event_triggers_source ON event_triggers(source);
      CREATE INDEX IF NOT EXISTS idx_event_triggers_enabled ON event_triggers(enabled);

      CREATE TABLE IF NOT EXISTS trigger_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trigger_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_payload TEXT,
        action_json TEXT NOT NULL,
        success INTEGER NOT NULL DEFAULT 1,
        error TEXT,
        triggered_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        FOREIGN KEY (trigger_id) REFERENCES event_triggers(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_trigger_logs_trigger ON trigger_logs(trigger_id);
      CREATE INDEX IF NOT EXISTS idx_trigger_logs_event_type ON trigger_logs(event_type);
      CREATE INDEX IF NOT EXISTS idx_trigger_logs_triggered_at ON trigger_logs(triggered_at);

      CREATE TABLE IF NOT EXISTS trigger_schedule (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trigger_id TEXT NOT NULL UNIQUE,
        schedule_type TEXT NOT NULL CHECK(schedule_type IN ('cron', 'at', 'interval')),
        cron_expression TEXT,
        scheduled_at INTEGER,
        interval_seconds INTEGER,
        last_scheduled_at INTEGER,
        next_scheduled_at INTEGER,
        FOREIGN KEY (trigger_id) REFERENCES event_triggers(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_trigger_schedule_next ON trigger_schedule(next_scheduled_at);

      -- ════════════════════════════════════════════════════════════
      -- 11. 预留扩展表（V15+）
      -- ════════════════════════════════════════════════════════════
      CREATE TABLE IF NOT EXISTS knowledge_base (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        source TEXT,
        embedding_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_workspace ON knowledge_base(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_base(category);

      CREATE TABLE IF NOT EXISTS skill_registry (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT '1.0.0',
        schema_json TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_skill_category ON skill_registry(category);
      CREATE INDEX IF NOT EXISTS idx_skill_active ON skill_registry(is_active);
    `
  }
}

// ════════════════════════════════════════════════════════════════
// 全局单例
// ════════════════════════════════════════════════════════════════

let instance: DatabaseManager | null = null

export function getDatabaseManager(): DatabaseManager {
  if (!instance) {
    instance = new DatabaseManager()
  }
  return instance
}

export function resetDatabaseManager(): void {
  if (instance) {
    instance.close()
    instance = null
  }
}