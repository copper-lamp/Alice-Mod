/**
 * ObserverStore — 观测记录存储
 *
 * 内存存储，支持可选的 SQLite 持久化。
 */

import type { LLMCallRecord, CallRecordFilter } from '../types';

export interface IObserverStore {
  push(record: LLMCallRecord): void;
  query(filter?: CallRecordFilter): LLMCallRecord[];
  getAll(): LLMCallRecord[];
  clear(): void;
  get length(): number;
}

export class MemoryObserverStore implements IObserverStore {
  private records: LLMCallRecord[] = [];
  private maxRecords: number;

  constructor(maxRecords: number = 10000) {
    this.maxRecords = maxRecords;
  }

  push(record: LLMCallRecord): void {
    this.records.push(record);

    // 限制最大记录数
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
  }

  query(filter?: CallRecordFilter): LLMCallRecord[] {
    let result = [...this.records];

    if (filter) {
      if (filter.providerId) {
        result = result.filter(r => r.providerId === filter.providerId);
      }
      if (filter.model) {
        result = result.filter(r => r.model === filter.model);
      }
      if (filter.success !== undefined) {
        result = result.filter(r => r.success === filter.success);
      }
      if (filter.startTime) {
        result = result.filter(r => r.timestamp >= filter.startTime!);
      }
      if (filter.endTime) {
        result = result.filter(r => r.timestamp <= filter.endTime!);
      }
      if (filter.limit) {
        const offset = filter.offset || 0;
        result = result.slice(offset, offset + filter.limit);
      }
    }

    return result;
  }

  getAll(): LLMCallRecord[] {
    return [...this.records];
  }

  clear(): void {
    this.records = [];
  }

  get length(): number {
    return this.records.length;
  }
}