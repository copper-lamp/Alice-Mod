/**
 * V23 汇报机制 — AgentReportBus（EventBus + 持久化）
 *
 * 主 Agent 在长任务中通过此总线向 QQ Agent 发送实时汇报。
 * - EventBus 走实时推送
 * - ReportStore 持久化兜底（QQ Agent 重启后能拉取未消费的汇报）
 */

import { EventEmitter } from 'events';
import type { AgentReport, ReportStore } from './report-store';

/** 汇报订阅过滤器 */
export interface ReportFilter {
  (report: AgentReport): boolean;
}

/** 汇报订阅者 */
export interface ReportSubscriber {
  targetAgentId?: string;
  filter?: ReportFilter;
  handler: (report: AgentReport) => void;
}

/**
 * AgentReportBus — 主 Agent → QQ Agent 汇报通道
 *
 * 用法：
 *   const bus = new AgentReportBus(reportStore);
 *   bus.emit(report);                          // 主 Agent 发汇报
 *   const unsub = bus.subscribe(handler, opts); // QQ Agent 订阅
 *   unsub();                                    // 取消订阅
 */
export class AgentReportBus extends EventEmitter {
  private store: ReportStore;

  constructor(store: ReportStore) {
    super();
    this.store = store;
  }

  /** 主 Agent 发汇报（EventBus 实时 + SQLite 持久化） */
  emitReport(report: AgentReport): void {
    // 持久化（兜底重启）
    this.store.append(report);

    // EventBus 实时推送
    this.emit('report', report);
  }

  /**
   * QQ Agent 订阅汇报（按 targetAgentId 过滤）
   * 返回 unsubscribe 函数
   */
  subscribe(
    targetAgentId: string,
    handler: (report: AgentReport) => void,
  ): () => void {
    const listener = (report: AgentReport) => {
      if (report.targetAgentId === targetAgentId) {
        handler(report);
      }
    };
    this.on('report', listener);
    return () => {
      this.off('report', listener);
    };
  }

  /**
   * 自定义过滤器订阅
   */
  subscribeWithFilter(
    filter: ReportFilter,
    handler: (report: AgentReport) => void,
  ): () => void {
    const listener = (report: AgentReport) => {
      if (filter(report)) {
        handler(report);
      }
    };
    this.on('report', listener);
    return () => {
      this.off('report', listener);
    };
  }

  /** 获取未消费的汇报（用于 QQ Agent 重启时拉取） */
  consumePending(targetAgentId: string, opts?: { limit?: number; sinceTs?: number }): AgentReport[] {
    return this.store.consumePending(targetAgentId, opts);
  }

  /** 标记已消费 */
  markConsumed(reportIds: string[]): void {
    this.store.markConsumed(reportIds);
  }
}