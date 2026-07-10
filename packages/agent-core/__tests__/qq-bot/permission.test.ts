/**
 * PermissionManager 测试
 *
 * 覆盖：四级权限判定、频率限制、管理员管理、配置更新
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PermissionManager } from '../../src/main/qq-bot/permission';
import { QQPermission } from '../../src/main/qq-bot/types';

describe('PermissionManager', () => {
  let pm: PermissionManager;

  beforeEach(() => {
    pm = new PermissionManager({
      ownerId: 'owner_001',
      admins: ['admin_001', 'admin_002'],
      whitelist: ['trusted_001'],
      defaultPermission: QQPermission.BASIC,
      cooldownSeconds: 1,
    });
  });

  afterEach(() => {
    pm.destroy();
  });

  // ── 权限等级判定 ──

  it('群主应拥有 ADMIN 权限', () => {
    expect(pm.getPermissionLevel('owner_001', null)).toBe(QQPermission.ADMIN);
    expect(pm.checkPermission('owner_001', null, QQPermission.ADMIN)).toBe(true);
  });

  it('管理员应拥有 ADMIN 权限', () => {
    expect(pm.getPermissionLevel('admin_001', null)).toBe(QQPermission.ADMIN);
    expect(pm.checkPermission('admin_002', 'any_group', QQPermission.ADMIN)).toBe(true);
  });

  it('白名单用户应拥有 COMMAND 权限', () => {
    expect(pm.getPermissionLevel('trusted_001', null)).toBe(QQPermission.COMMAND);
    expect(pm.checkPermission('trusted_001', null, QQPermission.COMMAND)).toBe(true);
    expect(pm.checkPermission('trusted_001', null, QQPermission.ADMIN)).toBe(false);
  });

  it('普通用户应拥有默认权限 (BASIC)', () => {
    expect(pm.getPermissionLevel('normal_user', 'group_001')).toBe(QQPermission.BASIC);
    expect(pm.checkPermission('normal_user', 'group_001', QQPermission.BASIC)).toBe(true);
    expect(pm.checkPermission('normal_user', 'group_001', QQPermission.COMMAND)).toBe(false);
  });

  it('NONE 权限用户应被拒绝所有操作', () => {
    const pm2 = new PermissionManager({ defaultPermission: QQPermission.NONE });
    expect(pm2.getPermissionLevel('stranger', null)).toBe(QQPermission.NONE);
    expect(pm2.checkPermission('stranger', null, QQPermission.BASIC)).toBe(false);
    pm2.destroy();
  });

  // ── 频率限制 ──

  it('管理员不应受频率限制', () => {
    expect(pm.isRateLimited('admin_001')).toBe(false);
    expect(pm.isRateLimited('admin_001')).toBe(false); // 多次调用也不受限
  });

  it('普通用户应受频率限制', () => {
    expect(pm.isRateLimited('normal_user')).toBe(false);
    expect(pm.isRateLimited('normal_user')).toBe(true); // 冷却中
  });

  it('冷却时间过后应解除频率限制', async () => {
    pm = new PermissionManager({ cooldownSeconds: 0 });
    expect(pm.isRateLimited('fast_user')).toBe(false);
    expect(pm.isRateLimited('fast_user')).toBe(false);
    pm.destroy();
  });

  // ── 管理员管理 ──

  it('应能添加管理员', () => {
    pm.addAdmin('new_admin');
    expect(pm.getPermissionLevel('new_admin', null)).toBe(QQPermission.ADMIN);
  });

  it('应能移除管理员', () => {
    pm.removeAdmin('admin_001');
    expect(pm.getPermissionLevel('admin_001', null)).toBe(QQPermission.BASIC);
  });

  it('添加重复管理员不应报错', () => {
    pm.addAdmin('admin_001');
    pm.addAdmin('admin_001');
    pm.removeAdmin('admin_001');
    expect(pm.getPermissionLevel('admin_001', null)).toBe(QQPermission.BASIC);
  });

  // ── 配置管理 ──

  it('应能更新配置', () => {
    pm.updateConfig({ defaultPermission: QQPermission.NONE });
    expect(pm.getPermissionLevel('normal_user', null)).toBe(QQPermission.NONE);
  });

  it('getConfig 应返回当前配置副本', () => {
    const config = pm.getConfig();
    expect(config.admins).toContain('admin_001');
    expect(config.ownerId).toBe('owner_001');
  });
});