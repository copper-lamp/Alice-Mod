/**
 * ToolDispatcher 默认实现
 *
 * 通过 TcpServer 将 Batch 请求发送到对应工作区的 Adapter Core。
 * 利用已有 V2 的 TcpConnection.sendJson() 发送 JSON-RPC 消息，
 * 通过 ConnectionEvent.Message 监听响应。
 *
 * 支持：
 * - 按工作区路由（通过 WorkspaceManager 查找 connectionId）
 * - 超时管理
 * - 请求-响应匹配
 * - 自定义分发策略
 */

import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import type { JsonRpcResponse, JsonRpcRequest } from '@mcagent/shared';

import { TcpServer, ConnectionEvent, TcpConnection } from '../tcp';
import { WorkspaceManager } from '../workspace';
import type {
  IToolDispatcher,
  ScheduledBatch,
  BatchCall,
  BatchExecuteResult,
  ToolCallResult,
  DispatchStrategy,
  ToolCallContent,
} from './types';

/** 待处理请求 */
interface PendingRequest {
  resolve: (value: ToolCallResult) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  toolName: string;
}

/**
 * 请求-响应匹配管理器
 *
 * 为每个连接维护一个待处理请求表，通过监听 ConnectionEvent.Message
 * 匹配响应。支持单个响应和 JSON-RPC Batch 数组响应。
 */
class ResponseMatcher {
  /** connectionId → Map<requestId, PendingRequest> */
  private readonly pendingMap = new Map<string, Map<string, PendingRequest>>();

  /**
   * 注册一个待处理请求
   */
  register(
    connectionId: string,
    requestId: string,
    toolName: string,
    timeoutMs: number,
  ): Promise<ToolCallResult> {
    return new Promise<ToolCallResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.remove(connectionId, requestId);
        reject(new Error(`工具 ${toolName} 执行超时 (${timeoutMs}ms)`));
      }, timeoutMs);

      let pending = this.pendingMap.get(connectionId);
      if (!pending) {
        pending = new Map();
        this.pendingMap.set(connectionId, pending);
      }

      pending.set(requestId, { resolve, reject, timer, toolName });
    });
  }

  /**
   * 处理收到的消息
   */
  handleMessage(connectionId: string, json: string): void {
    const pending = this.pendingMap.get(connectionId);
    if (!pending || pending.size === 0) return;

    try {
      const data = JSON.parse(json);
      // 支持 Batch 响应（数组）和单个响应
      const responses = Array.isArray(data) ? data : [data];

      for (const resp of responses) {
        if (resp.id && pending.has(resp.id.toString())) {
          const entry = pending.get(resp.id.toString())!;
          clearTimeout(entry.timer);
          pending.delete(resp.id.toString());

          // 业务层 success 判断：JSON-RPC 无 error 且 result.success 不为 false
          const businessSuccess = !resp.result || resp.result.success !== false
          const result: ToolCallResult = {
            id: resp.id.toString(),
            toolName: entry.toolName,
            success: !resp.error && businessSuccess,
            data: resp.result?.data || resp.result,
            error: resp.error?.message || (resp.result?.success === false ? resp.result?.message : undefined),
            errorCode: resp.error?.code?.toString(),
            durationMs: resp.result?.duration_ms || 0,
          };
          entry.resolve(result);
        }
      }
    } catch {
      // JSON 解析失败，忽略
    }
  }

  /**
   * 清理连接的所有待处理请求
   */
  cleanup(connectionId: string): void {
    const pending = this.pendingMap.get(connectionId);
    if (!pending) return;

    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('连接已关闭'));
    }
    this.pendingMap.delete(connectionId);
  }

  private remove(connectionId: string, requestId: string): void {
    const pending = this.pendingMap.get(connectionId);
    if (pending) {
      pending.delete(requestId);
      if (pending.size === 0) {
        this.pendingMap.delete(connectionId);
      }
    }
  }
}

/**
 * 默认工具分发器
 *
 * 通过 TcpServer 向指定工作区发送工具调用请求。
 * 使用 WorkspaceManager 查找工作区的 connectionId。
 */
export class DefaultToolDispatcher implements IToolDispatcher {
  private readonly workspaceManager: WorkspaceManager;
  private readonly tcpServer: TcpServer;
  private readonly responseMatcher = new ResponseMatcher();
  /** 自定义分发策略 */
  private strategies: DispatchStrategy[] = [];

  /** 已注册监听的连接 ID 集合 */
  private readonly listeningConnections = new Set<string>();

  constructor(workspaceManager: WorkspaceManager, tcpServer: TcpServer) {
    this.workspaceManager = workspaceManager;
    this.tcpServer = tcpServer;
  }

  /**
   * 调用单个工具（供触发器等模块使用）
   */
  async callTool(workspaceId: string, toolName: string, parameters: Record<string, unknown>, timeoutMs = 30000): Promise<unknown> {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`工作区 ${workspaceId} 不存在`);
    }
    if (!workspace.isOnline || !workspace.connectionId) {
      throw new Error(`工作区 ${workspaceId} 不在线`);
    }

    const connectionId = workspace.connectionId;
    const connection = this.tcpServer.getConnection(connectionId);
    if (!connection) {
      throw new Error(`连接 ${connectionId} 不存在`);
    }

    this.ensureListening(connection, connectionId);

    const requestId = crypto.randomUUID();
    // 协议契约：与 JE 端 METHOD_TOOL_CALL = "tool_call" 对齐
    // 历史上误写为 "call_tool"（与 action 类型同名），会导致 JE 端返回 Method Not Found
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'tool_call',
      params: {
        tool_name: toolName,
        parameters,
        timeout_ms: timeoutMs,
      },
    };

    const resultPromise = this.responseMatcher.register(connectionId, requestId, toolName, timeoutMs);
    connection.sendJson(request);
    const result = await resultPromise;

    if (!result.success) {
      throw new Error(result.error || `工具 ${toolName} 执行失败`);
    }
    return result.data;
  }

  /**
   * 注册自定义分发策略
   */
  registerStrategy(name: string, strategy: DispatchStrategy): void {
    this.strategies.push(strategy);
  }

  /**
   * 执行单个 Batch 请求
   *
   * Batch 中的每个工具调用被拆分为独立的 JSON-RPC 请求，
   * 并发发送到对应连接，然后等待所有结果返回。
   */
  async executeBatch(
    batch: ScheduledBatch,
    workspaceId: string,
  ): Promise<BatchExecuteResult> {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace) {
      return {
        results: batch.calls.map((call) => ({
          id: call.id,
          toolName: call.params.tool_name,
          success: false,
          error: `工作区 ${workspaceId} 不存在`,
          durationMs: 0,
        })),
        totalDurationMs: 0,
      };
    }

    // 检查是否在线
    if (!workspace.isOnline || !workspace.connectionId) {
      return {
        results: batch.calls.map((call) => ({
          id: call.id,
          toolName: call.params.tool_name,
          success: false,
          error: `工作区 ${workspaceId} 当前状态: ${workspace.state}，无法执行`,
          durationMs: 0,
        })),
        totalDurationMs: 0,
      };
    }

    const connectionId = workspace.connectionId;
    const connection = this.tcpServer.getConnection(connectionId);
    if (!connection) {
      return {
        results: batch.calls.map((call) => ({
          id: call.id,
          toolName: call.params.tool_name,
          success: false,
          error: `连接 ${connectionId} 不存在`,
          durationMs: 0,
        })),
        totalDurationMs: 0,
      };
    }

    // 确保监听了此连接的响应事件
    this.ensureListening(connection, connectionId);

    const startTime = Date.now();
    const results: ToolCallResult[] = [];

    // 并发发送所有调用
    const promises = batch.calls.map(async (call) => {
      // 检查自定义分发策略
      const callContent: ToolCallContent = {
        type: 'tool_call',
        toolCallId: call.id,
        toolName: call.params.tool_name,
        arguments: call.params.parameters as Record<string, unknown>,
      };

      for (const strategy of this.strategies) {
        if (strategy.match(callContent, workspaceId)) {
          return strategy.execute(callContent);
        }
      }

      // 默认通过 TCP 发送
      const requestId = call.id;
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: requestId,
        method: call.method,
        params: call.params,
      };

      const resultPromise = this.responseMatcher.register(
        connectionId,
        requestId,
        call.params.tool_name,
        call.params.timeout_ms || batch.timeoutMs,
      );

      connection.sendJson(request);
      return resultPromise;
    });

    // 等待所有结果
    const settledResults = await Promise.allSettled(promises);
    for (const settled of settledResults) {
      if (settled.status === 'fulfilled') {
        results.push(settled.value);
      } else {
        // 超时或异常
        results.push({
          id: 'unknown',
          success: false,
          error: settled.reason?.message || '未知错误',
          durationMs: Date.now() - startTime,
        });
      }
    }

    return {
      results,
      totalDurationMs: Date.now() - startTime,
    };
  }

  /**
   * 确保已监听指定连接的响应事件
   */
  private ensureListening(connection: TcpConnection, connectionId: string): void {
    if (this.listeningConnections.has(connectionId)) return;

    connection.on(ConnectionEvent.Message, (json: string) => {
      this.responseMatcher.handleMessage(connectionId, json);
    });

    connection.on(ConnectionEvent.Closed, () => {
      this.responseMatcher.cleanup(connectionId);
      this.listeningConnections.delete(connectionId);
    });

    this.listeningConnections.add(connectionId);
  }
}

// ════════════════════════════════════════════════════════════════
// 全局单例
// ════════════════════════════════════════════════════════════════

let toolDispatcherInstance: DefaultToolDispatcher | null = null;

export function setToolDispatcher(dispatcher: DefaultToolDispatcher): void {
  toolDispatcherInstance = dispatcher;
}

export function getToolDispatcher(): DefaultToolDispatcher | null {
  return toolDispatcherInstance;
}