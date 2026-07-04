/**
 * 粘包处理模块
 *
 * 使用 `\n`（换行符）作为消息帧分隔符：
 * - 发送端：每条 JSON 消息末尾附加 `\n`
 * - 接收端：累积缓冲区数据，按 `\n` 分割提取完整消息
 * - 不完整消息暂存缓冲区，等待后续数据到达
 */

import type { DecodeResult } from './types';

/** 消息帧分隔符 */
export const FRAME_DELIMITER = '\n';

/** 默认编码（UTF-8） */
export const FRAME_ENCODING: BufferEncoding = 'utf-8';

/**
 * 将 JSON 消息编码为帧（末尾附加分隔符）
 *
 * @param message - JSON 字符串
 * @returns 编码后的 Buffer
 */
export function encodeFrame(message: string): Buffer {
  return Buffer.from(message + FRAME_DELIMITER, FRAME_ENCODING);
}

/**
 * 解码帧：从缓冲区中提取完整的消息帧
 *
 * @param buffer - 接收到的数据缓冲区
 * @returns 解码结果（完整消息列表 + 剩余不完整数据）
 */
export function decodeFrames(buffer: Buffer): DecodeResult {
  const messages: string[] = [];
  let remaining = buffer;

  // 将 Buffer 转为字符串并按分隔符分割
  // 使用 split + 遍历而非 split + filter 以正确处理空字符串
  const text = remaining.toString(FRAME_ENCODING);
  const parts = text.split(FRAME_DELIMITER);

  // parts.length - 1：最后一段可能是不完整消息
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (part === '') continue; // 跳过多余空行
    messages.push(part);
  }

  // 剩余未完成的部分（最后一段，没有以分隔符结尾）
  const lastPart = parts[parts.length - 1];
  if (lastPart === '' && text.endsWith(FRAME_DELIMITER)) {
    // 以分隔符完美结尾 → 没有剩余
    remaining = Buffer.alloc(0);
  } else {
    remaining = Buffer.from(lastPart, FRAME_ENCODING);
  }

  return { messages, remaining };
}

/**
 * 帧累加器：用于累积多个数据块，逐步提取完整消息
 */
export class FrameAccumulator {
  private buffer: Buffer = Buffer.alloc(0);

  /**
   * 添加新数据并提取完整消息
   *
   * @param chunk - 新到达的数据块
   * @returns 提取出的完整消息列表
   */
  feed(chunk: Buffer): string[] {
    // 将新数据追加到缓冲区
    if (this.buffer.length === 0) {
      this.buffer = chunk;
    } else {
      this.buffer = Buffer.concat([this.buffer, chunk]);
    }

    // 解码提取完整消息
    const { messages, remaining } = decodeFrames(this.buffer);
    this.buffer = remaining;

    return messages;
  }

  /**
   * 获取当前剩余缓冲区大小（字节）
   */
  get remainingBytes(): number {
    return this.buffer.length;
  }

  /**
   * 清空缓冲区
   */
  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}

/**
 * 将多条消息批量编码为帧
 *
 * @param messages - JSON 消息数组
 * @returns 编码后的完整 Buffer
 */
export function encodeFrames(messages: string[]): Buffer {
  return Buffer.concat(messages.map(encodeFrame));
}
