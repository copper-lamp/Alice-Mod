/**
 * V23 玩家身份映射 — PlayerIdentity
 *
 * QQ 账号 ↔ Minecraft 游戏玩家 UUID 的映射管理。
 * 用于：
 * - QQ Agent 收到消息时解析对应游戏玩家身份
 * - Main Agent 处理游戏事件时反查 QQ 通知目标
 *
 * 存储：SQLite player_identities 表
 */

import type Database from 'better-sqlite3';

export interface PlayerIdentity {
  workspaceId: string;
  playerUuid: string;
  playerName: string;
  /** 绑定的 QQ 账号（可空，未绑定时只处理直接消息） */
  qqUserId?: string;
  /** 绑定的 QQ 群列表 */
  qqGroupIds: string[];
  /** 该玩家对应的主 Agent id */
  mainAgentId: string;
  /** 该玩家对应的 QQ Agent id */
  qqAgentId: string;
  boundAt: number;
}

export class PlayerIdentityStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** 通过 QQ 账号解析玩家身份 */
  resolveByQQ(qqUserId: string): PlayerIdentity | null {
    const row = this.db.prepare(
      `SELECT * FROM player_identities WHERE qq_user_id = ?`,
    ).get(qqUserId) as PlayerIdentityRow | undefined;
    return row ? rowToIdentity(row) : null;
  }

  /** 通过游戏 UUID 解析 */
  resolveByPlayer(playerUuid: string): PlayerIdentity | null {
    const row = this.db.prepare(
      `SELECT * FROM player_identities WHERE player_uuid = ?`,
    ).get(playerUuid) as PlayerIdentityRow | undefined;
    return row ? rowToIdentity(row) : null;
  }

  /** 通过 Agent id 反查 */
  resolveByAgent(agentId: string): PlayerIdentity | null {
    const row = this.db.prepare(
      `SELECT * FROM player_identities WHERE main_agent_id = ? OR qq_agent_id = ?`,
    ).get(agentId, agentId) as PlayerIdentityRow | undefined;
    return row ? rowToIdentity(row) : null;
  }

  /** 建立绑定 */
  bind(identity: PlayerIdentity): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO player_identities
        (workspace_id, player_uuid, player_name, qq_user_id, qq_group_ids,
         main_agent_id, qq_agent_id, bound_at)
       VALUES
        (@workspace_id, @player_uuid, @player_name, @qq_user_id, @qq_group_ids,
         @main_agent_id, @qq_agent_id, @bound_at)`,
    ).run({
      workspace_id: identity.workspaceId,
      player_uuid: identity.playerUuid,
      player_name: identity.playerName,
      qq_user_id: identity.qqUserId ?? null,
      qq_group_ids: JSON.stringify(identity.qqGroupIds),
      main_agent_id: identity.mainAgentId,
      qq_agent_id: identity.qqAgentId,
      bound_at: identity.boundAt,
    });
  }

  /** 解绑（按 QQ 账号） */
  unbind(qqUserId: string): void {
    this.db.prepare(
      `DELETE FROM player_identities WHERE qq_user_id = ?`,
    ).run(qqUserId);
  }

  /** 解绑（按游戏 UUID） */
  unbindByPlayer(playerUuid: string): void {
    this.db.prepare(
      `DELETE FROM player_identities WHERE player_uuid = ?`,
    ).run(playerUuid);
  }

  /** 工作区所有绑定列表 */
  listByWorkspace(workspaceId: string): PlayerIdentity[] {
    const rows = this.db.prepare(
      `SELECT * FROM player_identities WHERE workspace_id = ?`,
    ).all(workspaceId) as PlayerIdentityRow[];
    return rows.map(rowToIdentity);
  }
}

// ── 内部类型与转换 ──

interface PlayerIdentityRow {
  id: number;
  workspace_id: string;
  player_uuid: string;
  player_name: string;
  qq_user_id: string | null;
  qq_group_ids: string;
  main_agent_id: string;
  qq_agent_id: string;
  bound_at: number;
}

function rowToIdentity(row: PlayerIdentityRow): PlayerIdentity {
  return {
    workspaceId: row.workspace_id,
    playerUuid: row.player_uuid,
    playerName: row.player_name,
    qqUserId: row.qq_user_id ?? undefined,
    qqGroupIds: JSON.parse(row.qq_group_ids),
    mainAgentId: row.main_agent_id,
    qqAgentId: row.qq_agent_id,
    boundAt: row.bound_at,
  };
}