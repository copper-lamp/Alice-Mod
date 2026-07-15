/**
 * TriggerStore — 触发器持久化存储
 *
 * 基于 better-sqlite3 实现 event_triggers、trigger_logs、trigger_schedule 的 CRUD。
 * 所有方法均同步执行。
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  EventTrigger,
  CreateTriggerParams,
  UpdateTriggerParams,
  ListTriggerOptions,
  TriggerLog,
  TriggerSchedule,
} from './types';

// 数据库行类型
interface TriggerRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  enabled: number;
  source: string;
  priority: number;
  rule_json: string;
  action_json: string;
  cooldown_seconds: number;
  max_trigger_count: number | null;
  trigger_count: number;
  last_triggered_at: number | null;
  created_at: number;
  updated_at: number;
  target_agent_id: string | null;
}

interface ScheduleRow {
  trigger_id: string;
  schedule_type: string;
  cron_expression: string | null;
  scheduled_at: number | null;
  interval_seconds: number | null;
  last_scheduled_at: number | null;
  next_scheduled_at: number | null;
}

function rowToTrigger(row: TriggerRow): EventTrigger {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    enabled: Boolean(row.enabled),
    source: row.source as EventTrigger['source'],
    priority: row.priority,
    rule: JSON.parse(row.rule_json),
    action: JSON.parse(row.action_json),
    cooldownSeconds: row.cooldown_seconds,
    maxTriggerCount: row.max_trigger_count ?? undefined,
    triggerCount: row.trigger_count,
    lastTriggeredAt: row.last_triggered_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    targetAgentId: row.target_agent_id ?? undefined,
  };
}

function scheduleRowToSchedule(row: ScheduleRow): TriggerSchedule {
  return {
    triggerId: row.trigger_id,
    scheduleType: row.schedule_type as TriggerSchedule['scheduleType'],
    cronExpression: row.cron_expression ?? undefined,
    scheduledAt: row.scheduled_at ?? undefined,
    intervalSeconds: row.interval_seconds ?? undefined,
    lastScheduledAt: row.last_scheduled_at ?? undefined,
    nextScheduledAt: row.next_scheduled_at ?? undefined,
  };
}

export class TriggerStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  setDb(db: Database.Database): void {
    this.db = db;
  }

  create(params: CreateTriggerParams, schedule?: TriggerSchedule): EventTrigger {
    const now = Date.now();
    const trigger: EventTrigger = {
      id: randomUUID(),
      workspaceId: params.workspaceId ?? '',
      name: params.name,
      description: params.description ?? '',
      enabled: params.enabled ?? true,
      source: params.source,
      priority: params.priority ?? 5,
      rule: params.rule,
      action: params.action,
      cooldownSeconds: params.cooldownSeconds ?? 0,
      maxTriggerCount: params.maxTriggerCount,
      triggerCount: 0,
      createdAt: now,
      updatedAt: now,
      targetAgentId: params.targetAgentId,
    };

    this.db.prepare(
      `INSERT INTO event_triggers
        (id, workspace_id, name, description, enabled, source, priority, rule_json, action_json,
         cooldown_seconds, max_trigger_count, trigger_count, last_triggered_at, created_at, updated_at,
         target_agent_id)
       VALUES
        (@id, @workspace_id, @name, @description, @enabled, @source, @priority, @rule_json, @action_json,
         @cooldown_seconds, @max_trigger_count, @trigger_count, @last_triggered_at, @created_at, @updated_at,
         @target_agent_id)`,
    ).run({
      id: trigger.id,
      workspace_id: trigger.workspaceId,
      name: trigger.name,
      description: trigger.description,
      enabled: trigger.enabled ? 1 : 0,
      source: trigger.source,
      priority: trigger.priority,
      rule_json: JSON.stringify(trigger.rule),
      action_json: JSON.stringify(trigger.action),
      cooldown_seconds: trigger.cooldownSeconds,
      max_trigger_count: trigger.maxTriggerCount ?? null,
      trigger_count: trigger.triggerCount,
      last_triggered_at: trigger.lastTriggeredAt ?? null,
      created_at: trigger.createdAt,
      updated_at: trigger.updatedAt,
      target_agent_id: trigger.targetAgentId ?? null,
    });

    if (schedule) {
      this.saveSchedule({ ...schedule, triggerId: trigger.id });
    }

    return trigger;
  }

  update(id: string, params: UpdateTriggerParams): EventTrigger | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const sets: string[] = ['updated_at = @updated_at'];
    const bindings: Record<string, unknown> = { id, updated_at: Date.now() };

    if (params.name !== undefined) { sets.push('name = @name'); bindings.name = params.name; }
    if (params.description !== undefined) { sets.push('description = @description'); bindings.description = params.description; }
    if (params.enabled !== undefined) { sets.push('enabled = @enabled'); bindings.enabled = params.enabled ? 1 : 0; }
    if (params.priority !== undefined) { sets.push('priority = @priority'); bindings.priority = params.priority; }
    if (params.rule !== undefined) { sets.push('rule_json = @rule_json'); bindings.rule_json = JSON.stringify(params.rule); }
    if (params.action !== undefined) { sets.push('action_json = @action_json'); bindings.action_json = JSON.stringify(params.action); }
    if (params.cooldownSeconds !== undefined) { sets.push('cooldown_seconds = @cooldown_seconds'); bindings.cooldown_seconds = params.cooldownSeconds; }
    if (params.maxTriggerCount !== undefined) { sets.push('max_trigger_count = @max_trigger_count'); bindings.max_trigger_count = params.maxTriggerCount; }
    if (params.targetAgentId !== undefined) { sets.push('target_agent_id = @target_agent_id'); bindings.target_agent_id = params.targetAgentId ?? null; }

    this.db.prepare(`UPDATE event_triggers SET ${sets.join(', ')} WHERE id = @id`).run(bindings);

    return this.getById(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM event_triggers WHERE id = @id').run({ id });
    return result.changes > 0;
  }

  getById(id: string): EventTrigger | null {
    const row = this.db.prepare<Record<string, unknown>, TriggerRow>('SELECT * FROM event_triggers WHERE id = @id').get({ id });
    return row ? rowToTrigger(row) : null;
  }

  list(options: ListTriggerOptions = {}): EventTrigger[] {
    const conditions: string[] = [];
    const bindings: Record<string, unknown> = {};

    if (options.workspaceId !== undefined) {
      conditions.push('workspace_id = @workspace_id');
      bindings.workspace_id = options.workspaceId;
    }
    if (options.source) {
      conditions.push('source = @source');
      bindings.source = options.source;
    }
    if (options.enabled !== undefined) {
      conditions.push('enabled = @enabled');
      bindings.enabled = options.enabled ? 1 : 0;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitClause = options.limit !== undefined ? 'LIMIT @limit OFFSET @offset' : '';
    if (options.limit !== undefined) {
      bindings.limit = options.limit;
      bindings.offset = options.offset ?? 0;
    }

    const rows = this.db.prepare<Record<string, unknown>, TriggerRow>(
      `SELECT * FROM event_triggers ${whereClause} ORDER BY priority DESC, created_at ASC ${limitClause}`,
    ).all(bindings);

    return rows.map(rowToTrigger);
  }

  incrementTriggerCount(id: string): void {
    this.db.prepare(
      'UPDATE event_triggers SET trigger_count = trigger_count + 1, last_triggered_at = @now, updated_at = @now WHERE id = @id',
    ).run({ id, now: Date.now() });
  }

  logExecution(log: Omit<TriggerLog, 'id'>): void {
    this.db.prepare(
      `INSERT INTO trigger_logs
        (trigger_id, event_type, event_payload, action_json, success, error, triggered_at)
       VALUES
        (@trigger_id, @event_type, @event_payload, @action_json, @success, @error, @triggered_at)`,
    ).run({
      trigger_id: log.triggerId,
      event_type: log.eventType,
      event_payload: log.eventPayload ? JSON.stringify(log.eventPayload) : null,
      action_json: JSON.stringify(log.action),
      success: log.success ? 1 : 0,
      error: log.error ?? null,
      triggered_at: log.triggeredAt,
    });
  }

  getLogs(triggerId: string, limit = 100): TriggerLog[] {
    const rows = this.db
      .prepare<Record<string, unknown>, { id: number; trigger_id: string; event_type: string; event_payload: string | null; action_json: string; success: number; error: string | null; triggered_at: number }>(
        'SELECT * FROM trigger_logs WHERE trigger_id = @trigger_id ORDER BY triggered_at DESC LIMIT @limit',
      )
      .all({ trigger_id: triggerId, limit });

    return rows.map(row => ({
      id: row.id,
      triggerId: row.trigger_id,
      eventType: row.event_type,
      eventPayload: row.event_payload ? JSON.parse(row.event_payload) : undefined,
      action: JSON.parse(row.action_json),
      success: Boolean(row.success),
      error: row.error ?? undefined,
      triggeredAt: row.triggered_at,
    }));
  }

  cleanupLogs(maxAgeDays = 30, maxPerTrigger = 1000): void {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    this.db.prepare('DELETE FROM trigger_logs WHERE triggered_at < @cutoff').run({ cutoff });

    // 保留每个触发器最近 N 条日志
    const triggers = this.db.prepare<[], { id: string }>('SELECT id FROM event_triggers').all();
    for (const t of triggers) {
      const rows = this.db
        .prepare<Record<string, unknown>, { id: number }>(
          'SELECT id FROM trigger_logs WHERE trigger_id = @trigger_id ORDER BY triggered_at DESC LIMIT -1 OFFSET @offset',
        )
        .all({ trigger_id: t.id, offset: maxPerTrigger });
      for (const row of rows) {
        this.db.prepare('DELETE FROM trigger_logs WHERE id = @id').run({ id: row.id });
      }
    }
  }

  getSchedule(triggerId: string): TriggerSchedule | null {
    const row = this.db.prepare<Record<string, unknown>, ScheduleRow>(
      'SELECT * FROM trigger_schedule WHERE trigger_id = @trigger_id',
    ).get({ trigger_id: triggerId });
    return row ? scheduleRowToSchedule(row) : null;
  }

  saveSchedule(schedule: TriggerSchedule): void {
    this.db.prepare(
      `INSERT INTO trigger_schedule
        (trigger_id, schedule_type, cron_expression, scheduled_at, interval_seconds, last_scheduled_at, next_scheduled_at)
       VALUES
        (@trigger_id, @schedule_type, @cron_expression, @scheduled_at, @interval_seconds, @last_scheduled_at, @next_scheduled_at)
       ON CONFLICT(trigger_id) DO UPDATE SET
        schedule_type = excluded.schedule_type,
        cron_expression = excluded.cron_expression,
        scheduled_at = excluded.scheduled_at,
        interval_seconds = excluded.interval_seconds,
        last_scheduled_at = excluded.last_scheduled_at,
        next_scheduled_at = excluded.next_scheduled_at`,
    ).run({
      trigger_id: schedule.triggerId,
      schedule_type: schedule.scheduleType,
      cron_expression: schedule.cronExpression ?? null,
      scheduled_at: schedule.scheduledAt ?? null,
      interval_seconds: schedule.intervalSeconds ?? null,
      last_scheduled_at: schedule.lastScheduledAt ?? null,
      next_scheduled_at: schedule.nextScheduledAt ?? null,
    });
  }

  deleteSchedule(triggerId: string): void {
    this.db.prepare('DELETE FROM trigger_schedule WHERE trigger_id = @trigger_id').run({ trigger_id: triggerId });
  }
}
