/**
 * OneBotClient — OneBot v11 WebSocket 协议客户端
 *
 * 负责与 NapCat 建立 WebSocket 连接，实现消息收发、心跳维护、事件监听。
 * 支持断线自动重连（指数退避）。
 */

import WebSocket from 'ws';
import type { ConnectionStatus, SendResult, QQMessage, MessageSegment, GroupMessageEvent, PrivateMessageEvent, OneBotNoticeEvent } from './types';

/** OneBot 客户端配置 */
export interface OneBotClientConfig {
  wsUrl: string;
  accessToken?: string;
  reconnectInterval: number;
  maxReconnectAttempts: number;
  heartbeatInterval: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: OneBotClientConfig = {
  wsUrl: 'ws://127.0.0.1:3001',
  reconnectInterval: 5000,
  maxReconnectAttempts: 5,
  heartbeatInterval: 10000,
};

/** 消息处理器 */
export type MessageHandler = (msg: QQMessage) => void;
export type NoticeHandler = (event: OneBotNoticeEvent) => void;
export type StatusChangeHandler = (status: ConnectionStatus) => void;

/** OneBot API 响应 */
interface OneBotApiResponse {
  status: 'ok' | 'failed';
  retcode: number;
  data: any;
  echo?: string;
}

export class OneBotClient {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private config: OneBotClientConfig;
  private reconnectAttempts = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private noticeHandlers: Set<NoticeHandler> = new Set();
  private statusChangeHandlers: Set<StatusChangeHandler> = new Set();
  private pendingApiCalls: Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }> = new Map();
  private manualDisconnect = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(config?: Partial<OneBotClientConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onNotice(handler: NoticeHandler): () => void {
    this.noticeHandlers.add(handler);
    return () => this.noticeHandlers.delete(handler);
  }

  onStatusChange(handler: StatusChangeHandler): () => void {
    this.statusChangeHandlers.add(handler);
    return () => this.statusChangeHandlers.delete(handler);
  }

  async connect(): Promise<void> {
    if (this.ws && this.status === 'connected') return;

    this.manualDisconnect = false;
    this.setStatus('connecting');

    try {
      const url = this.config.accessToken
        ? `${this.config.wsUrl}?access_token=${this.config.accessToken}`
        : this.config.wsUrl;

      this.ws = new WebSocket(url);

      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket 连接超时'));
        }, 10000);

        this.ws!.on('open', () => {
          clearTimeout(timeout);
          this.setStatus('connected');
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          resolve();
        });

        this.ws!.on('message', (data: WebSocket.Data) => {
          this.handleRawMessage(data.toString());
        });

        this.ws!.on('close', () => {
          this.setStatus('disconnected');
          this.stopHeartbeat();
          // 手动断开时不重连（如 disconnect() 主动调用）
          if (!this.manualDisconnect) {
            this.scheduleReconnect();
          }
        });

        this.ws!.on('error', (err) => {
          clearTimeout(timeout);
          console.error('[OneBotClient] WebSocket 错误:', err.message);
          reject(err);
        });
      });
    } catch (err) {
      this.setStatus('disconnected');
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.manualDisconnect = true;
    this.stopHeartbeat();
    this.cancelReconnect();
    this.ws?.close();
    this.ws = null;
    this.setStatus('disconnected');
  }

  async sendGroupMsg(groupId: string, message: string): Promise<SendResult> {
    try {
      const result = await this.callApi('send_group_msg', { group_id: parseInt(groupId), message });
      return { success: true, messageId: String(result.data?.message_id ?? '') };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '发送失败' };
    }
  }

  async sendPrivateMsg(userId: string, message: string): Promise<SendResult> {
    try {
      const result = await this.callApi('send_private_msg', { user_id: parseInt(userId), message });
      return { success: true, messageId: String(result.data?.message_id ?? '') };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '发送失败' };
    }
  }

  async sendGroupImage(groupId: string, fileUrl: string): Promise<SendResult> {
    try {
      const result = await this.callApi('send_group_msg', {
        group_id: parseInt(groupId),
        message: [{ type: 'image', data: { file: fileUrl } }],
      });
      return { success: true, messageId: String(result.data?.message_id ?? '') };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '发送失败' };
    }
  }

  async sendGroupFile(groupId: string, fileUrl: string, name: string): Promise<SendResult> {
    try {
      const result = await this.callApi('upload_group_file', {
        group_id: parseInt(groupId),
        file: fileUrl,
        name,
      });
      return { success: true, messageId: String(result.data?.file_id ?? '') };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '发送失败' };
    }
  }

  // ════════════════════════════════════════════════════════════════
  // V31: 表情发送
  // ════════════════════════════════════════════════════════════════

  async sendGroupFace(groupId: string, faceId: number): Promise<SendResult> {
    try {
      const result = await this.callApi('send_group_msg', {
        group_id: parseInt(groupId),
        message: [{ type: 'face', data: { id: String(faceId) } }],
      });
      return { success: true, messageId: String(result.data?.message_id ?? '') };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '发送表情失败' };
    }
  }

  async sendPrivateFace(userId: string, faceId: number): Promise<SendResult> {
    try {
      const result = await this.callApi('send_private_msg', {
        user_id: parseInt(userId),
        message: [{ type: 'face', data: { id: String(faceId) } }],
      });
      return { success: true, messageId: String(result.data?.message_id ?? '') };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '发送表情失败' };
    }
  }

  async sendGroupSticker(groupId: string, stickerId: string): Promise<SendResult> {
    try {
      const result = await this.callApi('send_group_msg', {
        group_id: parseInt(groupId),
        message: [{ type: 'sticker', data: { id: stickerId } }],
      });
      return { success: true, messageId: String(result.data?.message_id ?? '') };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '发送贴图失败' };
    }
  }

  async getGroupInfo(groupId: string): Promise<any> {
    const result = await this.callApi('get_group_info', { group_id: parseInt(groupId) });
    return result.data;
  }

  async getGroupList(): Promise<any[]> {
    const result = await this.callApi('get_group_list', {});
    return result.data;
  }

  async getGroupMemberList(groupId: string): Promise<any[]> {
    const result = await this.callApi('get_group_member_list', { group_id: parseInt(groupId) });
    return result.data;
  }

  async getStrangerInfo(userId: string): Promise<any> {
    const result = await this.callApi('get_stranger_info', { user_id: parseInt(userId) });
    return result.data;
  }

  // ════════════════════════════════════════════════════════════════
  // 群管理 API（V14 新增）
  // ════════════════════════════════════════════════════════════════

  async setGroupKick(groupId: string, userId: string, rejectAddRequest = false): Promise<SendResult> {
    try {
      await this.callApi('set_group_kick', {
        group_id: parseInt(groupId),
        user_id: parseInt(userId),
        reject_add_request: rejectAddRequest,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '踢人失败' };
    }
  }

  async setGroupBan(groupId: string, userId: string, duration: number): Promise<SendResult> {
    try {
      await this.callApi('set_group_ban', {
        group_id: parseInt(groupId),
        user_id: parseInt(userId),
        duration,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '禁言失败' };
    }
  }

  async setGroupCard(groupId: string, userId: string, card: string): Promise<SendResult> {
    try {
      await this.callApi('set_group_card', {
        group_id: parseInt(groupId),
        user_id: parseInt(userId),
        card,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '设置群名片失败' };
    }
  }

  async setGroupAddRequest(flag: string, approve: boolean, reason?: string): Promise<SendResult> {
    try {
      await this.callApi('set_group_add_request', {
        flag,
        approve,
        reason: reason ?? '',
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '处理入群申请失败' };
    }
  }

  /**
   * 通用发送消息（V23：供 QQAgent 调用）
   * 根据 messageType 自动路由到 sendGroupMsg 或 sendPrivateMsg
   */
  async sendMessage(target: string, content: string, messageType: 'group' | 'private'): Promise<boolean> {
    try {
      const result = messageType === 'private'
        ? await this.sendPrivateMsg(target, content)
        : await this.sendGroupMsg(target, content);
      return result.success;
    } catch (err) {
      console.error('[OneBotClient] 发送消息失败:', err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  async deleteMsg(messageId: string): Promise<SendResult> {
    try {
      await this.callApi('delete_msg', { message_id: parseInt(messageId) });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '撤回消息失败' };
    }
  }

  private async callApi(action: string, params: any): Promise<any> {
    if (!this.ws || this.status !== 'connected') {
      throw new Error('OneBot 未连接');
    }

    const echo = `api_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingApiCalls.delete(echo);
        reject(new Error(`API 调用超时: ${action}`));
      }, 10000);

      this.pendingApiCalls.set(echo, { resolve, reject, timer });

      this.ws!.send(JSON.stringify({ action, params, echo }));
    });
  }

  private handleRawMessage(data: string): void {
    let parsed: any;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    // 心跳响应 / API 响应
    if (parsed.status && parsed.retcode !== undefined) {
      const pending = this.pendingApiCalls.get(parsed.echo);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingApiCalls.delete(parsed.echo);
        if (parsed.status === 'ok') {
          pending.resolve(parsed);
        } else {
          pending.reject(new Error(`API 错误: ${parsed.retcode} - ${parsed.msg || ''}`));
        }
      }
      return;
    }

    // 事件推送
    if (parsed.post_type === 'message') {
      const qqMsg = this.toQQMessage(parsed);
      this.messageHandlers.forEach(h => h(qqMsg));
    } else if (parsed.post_type === 'notice') {
      this.noticeHandlers.forEach(h => h(parsed as OneBotNoticeEvent));
    }
  }

  private toQQMessage(event: GroupMessageEvent | PrivateMessageEvent): QQMessage {
    const isGroup = event.message_type === 'group';
    const groupEvent = event as GroupMessageEvent;

    return {
      id: `${event.time}_${event.user_id}_${Math.random().toString(36).slice(2, 8)}`,
      type: isGroup ? 'group' : 'private',
      groupId: isGroup ? String(groupEvent.group_id) : undefined,
      userId: String(event.user_id),
      userName: event.sender.nickname,
      content: this.extractText(event.message),
      rawContent: event.raw_message,
      segments: event.message,
      timestamp: event.time,
      read: false,
    };
  }

  private extractText(segments: MessageSegment[]): string {
    return segments
      .filter(s => s.type === 'text')
      .map(s => s.data.text || '')
      .join('')
      .trim();
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.status === 'connected') {
        this.ws.send(JSON.stringify({ action: 'get_status', echo: 'heartbeat' }));
      }
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('[OneBotClient] 已达最大重连次数，停止重连');
      this.setStatus('disconnected');
      return;
    }

    this.cancelReconnect();

    this.reconnectAttempts++;
    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1),
      30000 // 最大 30s
    );

    this.setStatus('reconnecting');

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(err => {
        console.error('[OneBotClient] 重连失败:', err.message);
      });
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.statusChangeHandlers.forEach(h => h(status));
  }
}