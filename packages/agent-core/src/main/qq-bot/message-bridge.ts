/**
 * MessageBridge — QQ ↔ 游戏内聊天双向桥接
 *
 * 支持桥接配置管理、过滤规则引擎、方向控制。
 * QQ 群聊消息 → 游戏内聊天
 * 游戏内聊天 → QQ 群聊
 */

import type { QQMessage, BridgeConfig } from './types';

/** 桥接消息格式 */
export interface BridgeMessage {
  source: 'qq' | 'game';
  content: string;
  sender: string;
  groupId?: string;
  timestamp: number;
}

/** 桥接事件处理器 */
export type BridgeEventHandler = (msg: BridgeMessage) => void;

export class MessageBridge {
  private bridges: Map<string, BridgeConfig> = new Map();
  private eventHandlers: Set<BridgeEventHandler> = new Set();

  /** 配置桥接规则 */
  configure(bridges: BridgeConfig[]): void {
    this.bridges.clear();
    bridges.forEach(b => this.bridges.set(b.groupId, b));
  }

  /** 添加单条桥接规则 */
  addBridge(config: BridgeConfig): void {
    this.bridges.set(config.groupId, config);
  }

  /** 移除桥接规则 */
  removeBridge(groupId: string): void {
    this.bridges.delete(groupId);
  }

  /** 获取所有桥接配置 */
  getBridges(): BridgeConfig[] {
    return Array.from(this.bridges.values());
  }

  /** 注册桥接事件 */
  onBridge(handler: BridgeEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /** 处理 QQ 消息 → 桥接到游戏 */
  handleQQMessage(msg: QQMessage): void {
    if (!msg.groupId) return;

    const bridge = this.bridges.get(msg.groupId);
    if (!bridge) return;
    if (bridge.direction === 'game_to_qq') return;

    // 过滤规则
    if (bridge.filter) {
      if (bridge.filter.keywords && bridge.filter.keywords.length > 0) {
        const match = bridge.filter.keywords.some(k => msg.content.includes(k));
        if (!match) return;
      }
      if (bridge.filter.users && bridge.filter.users.length > 0) {
        if (!bridge.filter.users.includes(msg.userId)) return;
      }
    }

    const prefix = bridge.prefix || '[QQ]';
    const bridgeMsg: BridgeMessage = {
      source: 'qq',
      content: msg.content,
      sender: msg.userName,
      groupId: msg.groupId,
      timestamp: Date.now(),
    };

    this.emit(bridgeMsg);
  }

  /** 处理游戏消息 → 桥接到 QQ */
  handleGameMessage(content: string, sender: string): BridgeMessage[] {
    const results: BridgeMessage[] = [];

    for (const bridge of this.bridges.values()) {
      if (bridge.direction === 'qq_to_game') continue;

      const bridgeMsg: BridgeMessage = {
        source: 'game',
        content,
        sender,
        groupId: bridge.groupId,
        timestamp: Date.now(),
      };

      results.push(bridgeMsg);
    }

    // 发出事件
    results.forEach(msg => this.emit(msg));
    return results;
  }

  private emit(msg: BridgeMessage): void {
    this.eventHandlers.forEach(h => h(msg));
  }
}