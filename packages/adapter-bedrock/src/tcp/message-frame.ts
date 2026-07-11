/**
 * 消息帧处理 — 粘包/拆包
 *
 * TCP 是流式协议，没有消息边界。当多条消息连续发送时，
 * 可能在一个 TCP 包中到达。本模块通过 \n 分隔符提取完整消息帧。
 */

/** 最大缓冲区大小（字节），防止内存泄漏 */
const MAX_BUFFER_SIZE = 65536;

/**
 * 帧累加器 — 处理粘包
 *
 * 接收字节流，按 \n 分割，提取完整消息；不完整部分暂存到下次。
 */
export class FrameAccumulator {
  private buffer: string = '';

  /**
   * 接收新数据，返回完整消息列表
   * @param data 新接收的字节流
   * @returns 完整消息字符串数组
   */
  feed(data: Buffer): string[] {
    this.buffer += data.toString('utf-8');

    // 防止缓冲区过大
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer = this.buffer.substring(this.buffer.length - MAX_BUFFER_SIZE);
    }

    const messages: string[] = [];
    const parts = this.buffer.split('\n');

    // 最后一段可能是不完整的消息，保留到下次
    this.buffer = parts.pop() || '';

    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.length > 0) {
        messages.push(trimmed);
      }
    }

    return messages;
  }

  /**
   * 重置缓冲区
   */
  reset(): void {
    this.buffer = '';
  }

  /**
   * 获取当前缓冲区大小
   */
  get bufferSize(): number {
    return this.buffer.length;
  }
}