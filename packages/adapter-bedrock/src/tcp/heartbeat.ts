/**
 * 心跳响应 — Ping → Pong
 *
 * Agent Core 以 notification 格式发送 ping（无 id）：
 *   { "jsonrpc": "2.0", "method": "ping" }
 *
 * 客户端也以 notification 格式回复 pong：
 *   { "jsonrpc": "2.0", "method": "pong", "params": { "timestamp": "...", "tick": 123 } }
 */

/**
 * 构建心跳 Pong 通知消息
 * 协议规范要求以 notification 格式回复（无 id）
 * @returns 完整 JSON-RPC 通知字符串（含 \n 结尾）
 */
export function buildPongResponse(): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    method: 'pong',
    params: {
      timestamp: new Date().toISOString(),
      tick: getServerTick(),
    },
  }) + '\n';
}

/**
 * 获取服务器当前 tick（LLSE 环境下获取）
 * 若不可用则返回 0
 */
function getServerTick(): number {
  try {
    // @ts-ignore — LLSE mc 类型声明中无 getCurrentTick，但运行时可用
    const mcAny = mc as any;
    if (typeof mcAny !== 'undefined' && typeof mcAny.getCurrentTick === 'function') {
      return mcAny.getCurrentTick();
    }
  } catch {
    // ignore
  }
  return 0;
}

/**
 * 判断消息是否为 ping 通知（无 id 的 notification）
 */
export function isPingNotification(msg: any): boolean {
  return msg
    && msg.jsonrpc === '2.0'
    && msg.method === 'ping'
    && !('id' in msg);
}
