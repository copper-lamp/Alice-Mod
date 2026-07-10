/**
 * PermissionManager — QQ 权限控制
 *
 * 四级权限体系：NONE / BASIC / COMMAND / ADMIN
 * 支持频率限制、冷却时间控制。
 */

import type { QQPermission, PermissionConfig } from './types';
import { QQPermission as QQPerm } from './types';

/** 默认权限配置 */
const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
  ownerId: '',
  admins: [],
  whitelist: [],
  defaultPermission: QQPerm.BASIC,
  cooldownSeconds: 3,
};

export class PermissionManager {
  private config: PermissionConfig;
  private rateLimitMap: Map<string, number> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config?: Partial<PermissionConfig>) {
    this.config = { ...DEFAULT_PERMISSION_CONFIG, ...config };
    this.startCleanup();
  }

  /** 检查用户是否有指定权限 */
  checkPermission(userId: string, groupId: string | null, required: QQPermission): boolean {
    const level = this.getPermissionLevel(userId, groupId);
    return level >= required;
  }

  /** 获取用户权限等级 */
  getPermissionLevel(userId: string, groupId: string | null): QQPermission {
    // 群主自动 ADMIN
    if (this.config.ownerId === userId) return QQPerm.ADMIN;

    // 管理员 ADMIN
    if (this.config.admins.includes(userId)) return QQPerm.ADMIN;

    // 白名单 COMMAND
    if (this.config.whitelist.includes(userId)) return QQPerm.COMMAND;

    // 默认权限
    return this.config.defaultPermission;
  }

  /** 检查是否频率受限 */
  isRateLimited(userId: string): boolean {
    const now = Date.now();
    const last = this.rateLimitMap.get(userId);

    // 管理员不受频率限制
    if (this.getPermissionLevel(userId, null) >= QQPerm.ADMIN) {
      return false;
    }

    if (last && now - last < this.config.cooldownSeconds * 1000) {
      return true;
    }

    this.rateLimitMap.set(userId, now);
    return false;
  }

  /** 更新配置 */
  updateConfig(config: Partial<PermissionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** 获取配置 */
  getConfig(): PermissionConfig {
    return { ...this.config };
  }

  /** 添加管理员 */
  addAdmin(userId: string): void {
    if (!this.config.admins.includes(userId)) {
      this.config.admins.push(userId);
    }
  }

  /** 移除管理员 */
  removeAdmin(userId: string): void {
    this.config.admins = this.config.admins.filter(id => id !== userId);
  }

  /** 清理过期频率记录 */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      const threshold = this.config.cooldownSeconds * 1000 * 2;
      for (const [userId, last] of this.rateLimitMap) {
        if (now - last > threshold) {
          this.rateLimitMap.delete(userId);
        }
      }
    }, 60000);
  }

  /** 销毁清理定时器 */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}