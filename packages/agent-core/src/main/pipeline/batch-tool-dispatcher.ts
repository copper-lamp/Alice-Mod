/**
 * V20 §4.7 BatchToolDispatcher — 把 FCP 的 dispatcher 真正接到 TCP batch
 *
 * 实现 pipeline/types.ts 中的 IToolDispatcher 接口，对齐 JE 协议：
 * - ScheduledBatch.calls[] → JE 侧 tool_call_batch.calls[] 形状
 * - 通过 ConnectionResolver 找到 TcpConnection
 * - 调 conn.sendRequestAndAwait('tool_call_batch', ...) 并 await Response
 * - 解析 JE 协议响应（**裸 JSON 数组**，非 BE 的 {success, data} 包装）
 *
 * 错误处理：
 * - resp.error → 全部 call 标记失败
 * - 响应非数组或长度不匹配 → 抛错
 * - 单个 call 的 success=false → 记录 error，不影响其他 call
 *
 * BE 状态：V20 不适配 BE。BE 端 tool_call_batch 响应是 {success, data:[...]} 包装，
 * 本解析按 JE 裸数组处理会失败。BE 对齐由 BE 侧工程师负责。
 */

import type {
  IToolDispatcher,
  ScheduledBatch,
  BatchExecuteResult,
  ToolCallResult,
  DispatchStrategy,
} from './types';
import type { ConnectionResolver } from '../agent/connection-resolver';
import type { JsonRpcResponse, JsonRpcSuccessResponse } from '@mcagent/shared';

/**
 * 类型守卫：判断 JsonRpcResponse 是否为错误响应。
 *
 * 直接用 `'error' in resp` 在 if-return 后无法收窄联合类型（TS narrowing 限制），
 * 用显式 type guard 函数 `resp is JsonRpcSuccessResponse` 让 else 分支正确收窄。
 */
function isSuccessResp(resp: JsonRpcResponse): resp is JsonRpcSuccessResponse {
  return !('error' in resp) || resp.error === undefined;
}

/** JE 侧 tool_call_batch 单个 call 的请求形状 */
interface JeBatchCall {
  tool_name: string;
  parameters: Record<string, unknown>;
  timeout_ms?: number;
}

/** JE 侧 tool_call_batch 单个 call 的响应形状（裸数组元素） */
interface JeBatchCallResponse {
  success?: boolean;
  message?: string;
  error?: string;
  data?: unknown;
  duration_ms?: number;
}

export class BatchToolDispatcher implements IToolDispatcher {
  constructor(private readonly resolver: ConnectionResolver) {}

  async executeBatch(batch: ScheduledBatch, workspaceId: string): Promise<BatchExecuteResult> {
    // 1. 解析连接（NotConnectedError 若离线）
    const conn = this.resolver.resolve(workspaceId);

    // 2. ScheduledBatch.calls[] → JE 侧 tool_call_batch.calls[] 形状
    const jeCalls: JeBatchCall[] = batch.calls.map((c) => ({
      tool_name: c.params.tool_name,
      parameters: c.params.parameters,
      timeout_ms: c.params.timeout_ms ?? batch.timeoutMs,
    }));

    // 3. 发 request，等响应（batch 层超时 + 5s 网络余量）
    const resp = await conn.sendRequestAndAwait('tool_call_batch', { calls: jeCalls }, {
      timeoutMs: batch.timeoutMs + 5_000,
    });

    // 4. 协议级错误 → 全部 call 标记失败；否则走 result 分支
    if (!isSuccessResp(resp)) {
      const errMsg = `[${resp.error.code}] ${resp.error.message}`;
      return {
        totalDurationMs: 0,
        results: batch.calls.map((c) => ({
          id: c.id,
          toolName: c.params.tool_name,
          success: false,
          error: errMsg,
          errorCode: 'BATCH_ERROR',
          durationMs: 0,
        })),
      };
    }

    // 5. 解析 result（**按 JE 协议：裸 JSON 数组**）
    //    isSuccessResp 已将 resp 收窄为 JsonRpcSuccessResponse，result 字段必存在
    const arr = resp.result as unknown[];
    if (!Array.isArray(arr) || arr.length !== batch.calls.length) {
      throw new Error(
        `tool_call_batch response mismatch: expected ${batch.calls.length}, got ${arr?.length ?? 0}`,
      );
    }

    // 6. 归一为 ToolCallResult
    const results: ToolCallResult[] = batch.calls.map((c, i) => {
      const r = (arr[i] ?? {}) as JeBatchCallResponse;
      const isErr = r.success === false;
      return {
        id: c.id,
        toolName: c.params.tool_name,
        success: !isErr,
        data: isErr ? undefined : (r.data as Record<string, unknown> | undefined) ?? {},
        error: isErr ? (r.message ?? r.error ?? 'unknown') : undefined,
        errorCode: isErr ? (r.error ?? 'UNKNOWN') : undefined,
        durationMs: typeof r.duration_ms === 'number' ? r.duration_ms : 0,
      };
    });

    return {
      totalDurationMs: results.reduce((s, r) => s + r.durationMs, 0),
      results,
    };
  }

  /** V20 不引入新分发策略，空实现满足接口契约 */
  registerStrategy(_name: string, _strategy: DispatchStrategy): void {
    // no-op
  }
}
