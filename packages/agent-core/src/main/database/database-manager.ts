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

    // V20 主链路组装 — 增量 schema 迁移（ALTER TABLE 不支持 IF NOT EXISTS，需检测列存在性）
    this.runMigrations(db)

    // 记录当前 schema 版本
    this.recordSchemaVersion()
  }

  /**
   * V20 主链路组装 — 增量 schema 迁移
   *
   * SQLite 不支持 ALTER TABLE ADD COLUMN IF NOT EXISTS，需先 PRAGMA table_info 检测。
   * 所有迁移必须幂等（重复执行不报错）。
   */
  private runMigrations(db: Database.Database): void {
    // ── V20-1: chat_history 表 ──
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        source TEXT NOT NULL,
        event_id TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls_json TEXT,
        tool_call_id TEXT,
        token_count INTEGER,
        finish_reason TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_history_lookup
        ON chat_history(workspace_id, agent_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_history_event
        ON chat_history(event_id);
    `);

    // ── V20-2: agents.is_main 列（标记 workspace 主 agent） ──
    this.addColumnIfNotExists(db, 'agents', 'is_main', 'INTEGER NOT NULL DEFAULT 0');

    // ── V20-3: event_triggers.target_agent_id 列（send_llm target='qq_sub_agent' 时指定） ──
    this.addColumnIfNotExists(db, 'event_triggers', 'target_agent_id', 'TEXT');

    // ── V23: agent_reports 表（汇报持久化） ──
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_reports (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        source_agent_id TEXT NOT NULL,
        target_agent_id TEXT NOT NULL,
        report_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        details TEXT,
        metadata_json TEXT,
        request_id TEXT,
        timestamp INTEGER NOT NULL,
        consumed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_reports_target
        ON agent_reports(target_agent_id, consumed_at, timestamp DESC);
    `);

    // ── V23: player_identities 表（QQ↔Game 玩家映射） ──
    db.exec(`
      CREATE TABLE IF NOT EXISTS player_identities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        player_uuid TEXT NOT NULL,
        player_name TEXT NOT NULL,
        qq_user_id TEXT,
        qq_group_ids TEXT NOT NULL DEFAULT '[]',
        main_agent_id TEXT NOT NULL,
        qq_agent_id TEXT NOT NULL,
        bound_at INTEGER NOT NULL,
        UNIQUE(workspace_id, player_uuid),
        UNIQUE(workspace_id, qq_user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_player_identities_qq
        ON player_identities(qq_user_id);
    `);

    // ── V23: chat_history 按 source 索引（loadWithPeer 查询加速） ──
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_chat_history_source
        ON chat_history(workspace_id, agent_id, source, created_at DESC);
    `);

    // ── V23: agents.workspace_id 列（V16 兼容，部分存量数据可能缺） ──
    this.addColumnIfNotExists(db, 'agents', 'workspace_id', 'TEXT NOT NULL DEFAULT \'\'');

    // ── V24: agents 表 QQ 绑定索引（加速 routeQQMessageToAgent 查找） ──
    // 添加独立列 qq_binding_account_id，避免 JSON 表达式索引的兼容性问题
    this.addColumnIfNotExists(db, 'agents', 'qq_binding_account_id', 'TEXT');
    // 索引列存在性依赖 addColumnIfNotExists，需在 addColumn 之后执行
    try {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_agents_qq_binding
          ON agents(qq_binding_account_id);
      `);
    } catch (err) {
      console.warn('[DatabaseManager] 创建 QQ 绑定索引失败:', (err as Error).message);
    }

    // ── V26: agents.compiled_prompt 列（预编译系统提示词） ──
    this.addColumnIfNotExists(db, 'agents', 'compiled_prompt', 'TEXT');

    // ── V28: agents.enabled 列（智能体是否启用） ──
    this.addColumnIfNotExists(db, 'agents', 'enabled', 'INTEGER NOT NULL DEFAULT 1');

    // ── V28: agents.qq_persona_json 列（QQ 智能体独立人设） ──
    this.addColumnIfNotExists(db, 'agents', 'qq_persona_json', 'TEXT');
    // ── V28: agents.qq_compiled_prompt 列（QQ 智能体预编译系统提示词） ──
    this.addColumnIfNotExists(db, 'agents', 'qq_compiled_prompt', 'TEXT');

    // ── V25: model_configs 表（模型配置持久化） ──
    db.exec(`
      CREATE TABLE IF NOT EXISTS model_configs (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        provider_name TEXT NOT NULL,
        model_name TEXT NOT NULL,
        api_key TEXT NOT NULL,
        base_url TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        context_window INTEGER NOT NULL DEFAULT 4096,
        supports_function_calling INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_model_configs_provider
        ON model_configs(provider_id);
    `);

    // ── V22: 元编排层 — 执行计划文档 + 任务记忆 ──
    // PlanStore / TaskMemoryStore 构造时也会 initSchema，这里统一在启动时创建
    // 避免运行时 DDL 与并发写入冲突。
    db.exec(`
      CREATE TABLE IF NOT EXISTS orch_plans (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        event_id TEXT,
        goal TEXT NOT NULL,
        constraints_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_orch_plans_lookup
        ON orch_plans(workspace_id, agent_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_orch_plans_event
        ON orch_plans(event_id);

      CREATE TABLE IF NOT EXISTS orch_plan_todos (
        plan_id TEXT NOT NULL,
        todo_id TEXT NOT NULL,
        status TEXT NOT NULL,
        description TEXT NOT NULL,
        expected_tools_json TEXT,
        depends_on_json TEXT,
        completed_at INTEGER,
        failure_reason TEXT,
        PRIMARY KEY (plan_id, todo_id),
        FOREIGN KEY (plan_id) REFERENCES orch_plans(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_orch_plan_todos_plan
        ON orch_plan_todos(plan_id);

      CREATE TABLE IF NOT EXISTS task_memories (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        goal TEXT NOT NULL,
        outcome TEXT NOT NULL,
        key_outcomes_json TEXT NOT NULL,
        failure_reasons_json TEXT,
        artifacts_json TEXT,
        duration_ms INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        committed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_task_memories_lookup
        ON task_memories(workspace_id, agent_id, committed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_task_memories_plan
        ON task_memories(plan_id);
    `);
  }

  /** 安全添加列（不存在才加），SQLite ALTER TABLE ADD COLUMN 不支持 IF NOT EXISTS */
  private addColumnIfNotExists(
    db: Database.Database,
    table: string,
    column: string,
    definition: string,
  ): void {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    const exists = cols.some(c => c.name === column);
    if (!exists) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
    }
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
      { version: 1, module: 'agent', description: '智能体表：agents, persona_presets' },
      { version: 1, module: 'tool', description: '工具注册表：tool_registry' },
      { version: 1, module: 'orchestration', description: 'V22 元编排层：orch_plans, orch_plan_todos, task_memories' },
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

      -- ════════════════════════════════════════════════════════════
      -- 12. 智能体实例 + 人设预设
      -- ════════════════════════════════════════════════════════════
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        alias TEXT,
        skin_data TEXT,
        persona_json TEXT NOT NULL,
        tools_json TEXT NOT NULL,
        qq_binding_json TEXT NOT NULL,
        llm_config_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);

      CREATE TABLE IF NOT EXISTS persona_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        identity TEXT NOT NULL,
        expertise_json TEXT NOT NULL,
        personality_json TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        behavior_rules_json TEXT,
        recommended_tool_categories_json TEXT,
        is_builtin INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_persona_presets_name ON persona_presets(name);
      CREATE INDEX IF NOT EXISTS idx_persona_presets_builtin ON persona_presets(is_builtin);

      -- ════════════════════════════════════════════════════════════
      -- 13. 工具注册持久化
      -- ════════════════════════════════════════════════════════════
      CREATE TABLE IF NOT EXISTS tool_registry (
        workspace_id TEXT PRIMARY KEY,
        tool_hash TEXT NOT NULL,
        tool_json TEXT NOT NULL,
        tool_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tool_registry_updated ON tool_registry(updated_at);
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