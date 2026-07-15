/**
 * V20 §4.7 BatchResultCollector — 基于 V4 DefaultResultCollector 改造（不重写）
 *
 * 设计文档明确要求"基于 V4 已有 result-collector.ts 改造，不重写"：
 * - 接收 ScheduledBatch[]，按 level 串行
 * - 对每层 batch 调 dispatcher.executeBatch(batch, workspaceId)
 * - 应用 CollectOptions.failFast / interLayerDelayMs
 * - 收集结果到 CollectResult
 *
 * DefaultResultCollector 已实现上述全部能力（按层级串行 + failFast + abortSignal
 * + interLayerDelayMs + 结果处理器注册），V20 阶段无需扩展行为。本类作为 thin
 * subclass 保留 V20 命名一致性，并为后续可能的 batch 级定制（如批量取消标记、
 * JE 协议级错误归一化）预留扩展点。
 *
 * 用法：
 *   pipeline.setCollector(new BatchResultCollector())
 */

import { DefaultResultCollector } from './result-collector';

export class BatchResultCollector extends DefaultResultCollector {
  /**
   * V20 阶段无额外初始化参数。
   *
   * 预留：若后续需要在 collector 中注入 ConnectionResolver / observer 等，
   * 可在此扩展 constructor 而不破坏 V4 DefaultResultCollector 的现有调用方。
   */
}
