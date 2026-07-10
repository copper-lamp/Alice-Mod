/**
 * MessageHandler — QQ 消息处理
 *
 * 消息路由中枢：权限检查 → 频率限制 → 路由分发
 * 路由目标：QQ Sub-Agent（AI 处理）/ 快速指令解析 / 桥接
 */

import type { QQMessage, QQPermission } from './types';
import { QQPermission as QQPerm } from './types';
import { PermissionManager } from './permission';
import { MessageBridge } from './message-bridge';
import { QQSubAgent } from './qq-sub-agent';

/** 消息路由类型 */
export type MessageRoute =
  | { type: 'sub_agent'; msg: QQMessage }
  | { type: 'bridge'; msg: QQMessage }
  | { type: 'command'; msg: QQMessage; command: string; args: string }
  | { type: 'ignored'; reason: string };

/** 快速指令处理器 */
export type CommandHandler = (command: string, args: string, msg: QQMessage) => Promise<string | null>;

export class MessageHandler {
  private permissionManager: PermissionManager;
  private bridge: MessageBridge;
  private subAgent: QQSubAgent;
  private commandHandlers: Map<string, CommandHandler> = new Map();
  private allowPrivate: boolean = true;

  constructor(
    permissionManager: PermissionManager,
    bridge: MessageBridge,
    subAgent: QQSubAgent,
  ) {
    this.permissionManager = permissionManager;
    this.bridge = bridge;
    this.subAgent = subAgent;
  }

  /** 设置是否允许私聊 */
  setAllowPrivate(allow: boolean): void {
    this.allowPrivate = allow;
  }

  /** 注册快速指令处理器 */
  registerCommand(command: string, handler: CommandHandler): void {
    this.commandHandlers.set(command.toLowerCase(), handler);
  }

  /** 路由消息 */
  async route(msg: QQMessage): Promise<MessageRoute> {
    // 1. 私聊检查
    if (msg.type === 'private' && !this.allowPrivate) {
      return { type: 'ignored', reason: '私聊未启用' };
    }

    // 2. 权限检查（至少 BASIC）
    if (!this.permissionManager.checkPermission(msg.userId, msg.groupId ?? null, QQPerm.BASIC)) {
      return { type: 'ignored', reason: '权限不足' };
    }

    // 3. 频率限制
    if (this.permissionManager.isRateLimited(msg.userId)) {
      return { type: 'ignored', reason: '频率受限' };
    }

    // 4. 快速指令检查（以 / 开头）
    if (msg.content.startsWith('/')) {
      const spaceIdx = msg.content.indexOf(' ');
      const command = spaceIdx > 0 ? msg.content.slice(1, spaceIdx) : msg.content.slice(1);
      const args = spaceIdx > 0 ? msg.content.slice(spaceIdx + 1).trim() : '';

      return { type: 'command', msg, command, args };
    }

    // 5. 路由到 Sub-Agent
    return { type: 'sub_agent', msg };
  }

  /** 执行快速指令 */
  async executeCommand(command: string, args: string, msg: QQMessage): Promise<string | null> {
    const handler = this.commandHandlers.get(command.toLowerCase());
    if (!handler) return null;

    // 至少需要 COMMAND 权限
    if (!this.permissionManager.checkPermission(msg.userId, msg.groupId ?? null, QQPerm.COMMAND)) {
      return '权限不足，无法执行此指令';
    }

    return handler(command, args, msg);
  }
}