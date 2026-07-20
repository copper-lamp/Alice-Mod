/**
 * MessageBatcher — QQ 消息合并器
 *
 * 功能：
 * - 无任务时：合并 5 秒内收到的消息，一次性发送给 AI
 * - 有任务时：不向 AI 输入，等待当前任务处理完 + 3 秒后统一发送所有未读消息
 *
 * 设计：每个 Agent 一个独立的 Batcher 实例，通过 agentId 索引。
 * 消息合并后以 `[群消息 1] ... [群消息 2] ...` 格式作为单条 prompt 发送给 AI。
 */

import type { QQMessage } from './types';
import type { OneBotClient } from './onebot-client';
import { pendingQqSends, type PendingQqSend } from '../agent/main-agent-registry';

/** 批量消息条目 */
interface BatchEntry {
  msg: QQMessage;
  resolve: (response: string) => void;
  reject: (error: Error) => void;
}

/** 合并后的消息格式 */
interface MergedMessage {
  prompt: string;
  /** 最新一条消息的时间戳，用于计算打字延迟 */
  latestTimestamp: number;
}

/** 全局 Batcher 实例 Map */
const batcherInstances = new Map<string, MessageBatcher>();

/**
 * 获取或创建 Agent 对应的 MessageBatcher 实例
 */
export function getMessageBatcher(agentId: string): MessageBatcher {
  let batcher = batcherInstances.get(agentId);
  if (!batcher) {
    batcher = new MessageBatcher(agentId);
    batcherInstances.set(agentId, batcher);
  }
  return batcher;
}

export class MessageBatcher {
  private agentId: string;
  private buffer: BatchEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** 当前是否正在向 AI 发送请求（任务中） */
  private isProcessing = false;
  /** 合并等待时间（ms） */
  private readonly batchDelay = 5000;
  /** 任务完成后等待时间（ms） */
  private readonly postTaskDelay = 3000;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  /**
   * 添加消息到批量队列
   * @param msg QQ 消息
   * @param handler 处理合并后 prompt 的异步函数，返回 AI 回复文本
   * @param client OneBot 客户端（用于发送 qq_send 消息）
   * @returns Promise 解析为 AI 的最终回复
   */
  async add(
    msg: QQMessage,
    handler: (prompt: string) => Promise<string>,
    client: OneBotClient,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.buffer.push({ msg, resolve, reject });
      this.scheduleFlush(handler, client);
    });
  }

  /**
   * 安排刷新时机
   * - 正在处理中：不启动定时器，消息会在处理完成后 +3 秒被刷新
   * - 空闲中：启动 5 秒定时器
   */
  private scheduleFlush(
    handler: (prompt: string) => Promise<string>,
    client: OneBotClient,
  ): void {
    if (this.isProcessing) {
      // 任务进行中，不启动定时器，等待处理完成后自动刷新
      return;
    }

    // 重置 5 秒定时器
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(handler, client), this.batchDelay);
  }

  /**
   * 刷新缓冲区：合并消息 → 发送给 AI → 处理 qq_send 队列 → 解析 Promise
   */
  private async flush(
    handler: (prompt: string) => Promise<string>,
    client: OneBotClient,
  ): Promise<void> {
    if (this.buffer.length === 0) return;

    this.isProcessing = true;
    this.timer = null;

    // 取出当前批次所有消息
    const batch = this.buffer.splice(0);

    try {
      // 合并消息为单条 prompt
      const merged = this.mergeMessages(batch);
      console.log(`[MessageBatcher] 合并 ${batch.length} 条消息发送给 AI`);

      // 发送给 AI 处理
      const finalResponse = await handler(merged.prompt);

      // 处理 qq_send 队列（发送实际消息）
      const pendingSends: PendingQqSend[] = pendingQqSends.get(this.agentId) ?? [];
      for (let i = 0; i < pendingSends.length; i++) {
        const pending = pendingSends[i];
        const target = pending.target || batch[0]?.msg?.groupId || batch[0]?.msg?.userId || '';

        // 第 1 条直接发，后续消息按字数延迟
        if (i > 0) {
          const delayMs = calculateTypingDelay(pending.content);
          await sleep(delayMs);
        }

        try {
          switch (pending.type) {
            case 'private_msg':
            case 'private':
              await client.sendPrivateMsg(target, pending.content);
              break;
            case 'face':
              await client.sendGroupFace(target, pending.faceId!);
              break;
            case 'sticker':
              await client.sendGroupSticker(target, pending.stickerId!);
              break;
            default: // group_msg, image, file
              await client.sendGroupMsg(target, pending.content);
              break;
          }
          console.log(`[MessageBatcher] qq_send 消息已发送到 ${target}, type=${pending.type}`);
        } catch (err) {
          console.error(`[MessageBatcher] 发送 qq_send 消息失败:`, err);
        }
      }

      // 清空 qq_send 队列
      if (pendingSends.length > 0) {
        pendingQqSends.delete(this.agentId);
      }

      // 如果 LLM 没有通过 qq_send 发送消息，记录警告
      if (pendingSends.length === 0 && finalResponse) {
        console.log(`[MessageBatcher] LLM 未通过 qq_send 工具发送消息，回复已丢弃: ${finalResponse.slice(0, 100)}`);
      }

      // 解析所有 Promise
      for (const entry of batch) {
        entry.resolve(finalResponse);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`[MessageBatcher] AI 处理批量消息失败:`, error);

      // 拒绝所有 Promise
      for (const entry of batch) {
        entry.reject(error);
      }
    } finally {
      this.isProcessing = false;

      // 检查是否有新消息在本次处理期间到达
      if (this.buffer.length > 0) {
        console.log(`[MessageBatcher] 还有 ${this.buffer.length} 条未处理消息，等待 ${this.postTaskDelay}ms 后刷新`);
        setTimeout(() => this.flush(handler, client), this.postTaskDelay);
      }
    }
  }

  /**
   * 合并多条消息为单条 prompt
   */
  private mergeMessages(batch: BatchEntry[]): MergedMessage {
    if (batch.length === 1) {
      const msg = batch[0].msg;
      const prompt = msg.groupId
        ? `[群消息] 来自群 ${msg.groupId}，用户 ${msg.userId}（${msg.userName}）：${msg.content}`
        : `[私聊] 来自用户 ${msg.userId}（${msg.userName}）：${msg.content}`;
      return { prompt, latestTimestamp: Date.now() };
    }

    // 多条消息合并
    const parts = batch.map((entry, i) => {
      const msg = entry.msg;
      if (msg.groupId) {
        return `[群消息 ${i + 1}] 来自群 ${msg.groupId}，用户 ${msg.userId}（${msg.userName}）：${msg.content}`;
      } else {
        return `[私聊 ${i + 1}] 来自用户 ${msg.userId}（${msg.userName}）：${msg.content}`;
      }
    });

    const prompt = `你收到 ${batch.length} 条合并消息：\n\n${parts.join('\n---\n')}`;
    return { prompt, latestTimestamp: Date.now() };
  }
}

/**
 * 计算打字延迟（模拟真人输入速度）
 * 1 秒可以打 3 个字，取整
 */
function calculateTypingDelay(content: string): number {
  const charsPerSecond = 3;
  const charCount = content.length;
  return Math.ceil((charCount / charsPerSecond) * 1000);
}

/** sleep 辅助函数 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}