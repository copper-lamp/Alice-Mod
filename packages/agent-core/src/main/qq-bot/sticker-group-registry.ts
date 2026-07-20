/**
 * StickerGroupRegistry — 表情组注册表
 *
 * 管理用户定义的表情组，LLM 按语义名调用时，
 * 系统从此注册表中随机选一个具体表情发送。
 *
 * V31: 新增，支持 QQAgent 表情包发送功能。
 */

import type { StickerItem } from './types';

/** 默认表情组配置 */
const DEFAULT_GROUPS: Record<string, StickerItem[]> = {
  '蚌':   [{ type: 'face', id: '123' }, { type: 'face', id: '146' }, { type: 'face', id: '307' }],
  '赞':   [{ type: 'face', id: '76' },  { type: 'face', id: '320' }],
  '哭':   [{ type: 'face', id: '107' }, { type: 'face', id: '109' }],
  '嗨':   [{ type: 'face', id: '18' },  { type: 'face', id: '21' }],
  '疑问': [{ type: 'face', id: '281' }, { type: 'face', id: '32' }],
  '微笑': [{ type: 'face', id: '4' },   { type: 'face', id: '9' }],
  '尴尬': [{ type: 'face', id: '14' },  { type: 'face', id: '171' }],
  '可怜': [{ type: 'face', id: '98' },  { type: 'face', id: '74' }],
  '牛':   [{ type: 'face', id: '320' }, { type: 'face', id: '76' }],
  '裂开': [{ type: 'face', id: '307' }],
};

export class StickerGroupRegistry {
  private groups = new Map<string, StickerItem[]>();

  /**
   * 加载配置（合并默认组 + 用户自定义覆盖）
   * 用户配置同名的组会覆盖默认组，空数组=删除该组
   */
  loadFromConfig(userGroups?: Record<string, StickerItem[]>): void {
    this.groups.clear();

    // 先加载默认组
    for (const [name, items] of Object.entries(DEFAULT_GROUPS)) {
      this.groups.set(name, [...items]);
    }

    // 用户自定义覆盖
    if (userGroups) {
      for (const [name, items] of Object.entries(userGroups)) {
        if (items.length === 0) {
          this.groups.delete(name); // 空数组 = 删除该组
        } else {
          this.groups.set(name, [...items]);
        }
      }
    }
  }

  /** 注册/更新一个表情组 */
  register(groupName: string, items: StickerItem[]): void {
    if (items.length === 0) {
      this.groups.delete(groupName);
    } else {
      this.groups.set(groupName, [...items]);
    }
  }

  /** 删除一个表情组 */
  unregister(groupName: string): void {
    this.groups.delete(groupName);
  }

  /**
   * 从组内随机选一个表情
   * @returns 随机选中的表情项，组不存在返回 null
   */
  pickRandom(groupName: string): StickerItem | null {
    const items = this.groups.get(groupName);
    if (!items || items.length === 0) return null;
    const index = Math.floor(Math.random() * items.length);
    return items[index];
  }

  /** 列出所有可用组名 */
  listGroups(): string[] {
    return Array.from(this.groups.keys());
  }

  /** 获取指定组的内容 */
  getGroup(groupName: string): StickerItem[] | undefined {
    return this.groups.get(groupName);
  }
}