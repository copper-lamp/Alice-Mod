/**
 * V20 主链路组装 — TCP 错误类型
 *
 * 统一 abort / timeout / not-connected 错误识别，供 MainAgent / Pipeline /
 * BatchToolDispatcher / TcpConnection.sendRequestAndAwait 共同使用。
 *
 * 通过 `err instanceof AbortError` / `err instanceof TimeoutError` /
 * `err instanceof NotConnectedError` 区分，避免依赖 magic 字符串。
 */

/** 用户主动中止 */
export class AbortError extends Error {
  constructor(message = 'Operation aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

/** 请求超时 */
export class TimeoutError extends Error {
  constructor(message = 'Operation timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

/** workspace 没有已连接的 Adapter Core */
export class NotConnectedError extends Error {
  public readonly workspaceId?: string;

  constructor(workspaceIdOrMessage: string) {
    super(workspaceIdOrMessage);
    this.name = 'NotConnectedError';
    // 简单启发：纯 workspaceId 字符串走 workspaceId 字段
    if (!workspaceIdOrMessage.includes(' ')) {
      this.workspaceId = workspaceIdOrMessage;
      this.message = `No connected Adapter Core for workspaceId=${workspaceIdOrMessage}`;
    }
  }
}

/** 判断是否为可重试错误（Pipeline / FallbackManager 使用） */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  if (err instanceof AbortError) return false;
  if (err instanceof NotConnectedError) return false;
  return false;
}
