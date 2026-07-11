/**
 * 心跳响应 — Ping → Pong
 *
 * 客户端收到服务端的 Ping 请求后，自动回复 Pong 响应。
 * 心跳间隔由服务端在握手时指定（heartbeat_interval_ms）。
 */

/**
 * 构建心跳 Pong 响应消息
 * @param pingId 收到 Ping 的请求 ID
 * @returns 完整 JSON-RPC 响应字符串（含 \n 结尾）
 */
export function buildPongResponse(pingId: number | string): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: pingId,
    result: {
      pong: true,
      timestamp: new Date().toISOString(),
    },
  }) + '\n';
}