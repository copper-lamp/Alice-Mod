/**
 * FunctionCallingPipeline — 核心编排器
 *
 * V4 的管线主类，串联整个 Function Calling 流程：
 * 解析 → 依赖分析 → 调度 → 中间件前置 → 分发 → 收集 → 兜底 → 中间件后置 → 回注
 *
 * 设计原则：
 * - 所有子组件通过接口注入，可独立替换
 * - 中间件机制支持管线行为的无侵入扩展
 * - 兜底策略保证在异常场景下的系统健壮性
 * - 事件机制支持外部监控和 UI 实时显示
 */

import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';

import type {
  LLMResponse,
  Conversation,
  PipelineOptions,
  PipelineResult,
  PipelineStatus,
  ProcessOptions,
  PipelineError,
  ToolCallContent,
  ToolResultContent,
  MiddlewareContext,
  ExecutionLayer,
  CollectResult,
  ScheduleOptions,
  CollectOptions,
} from './types';

import {
  DEFAULT_PIPELINE_OPTIONS,
  DEFAULT_SCHEDULE_OPTIONS,
  DEFAULT_COLLECT_OPTIONS,
  PipelinePhase,
  PipelineEvent,
} from './types';

import type {
  IResponseParser,
  IDependencyAnalyzer,
  IBatchScheduler,
  IToolDispatcher,
  IResultCollector,
  IResultInjector,
  IFallbackManager,
  IPipelineMiddleware,
  FallbackContext,
} from './types';

import { DefaultResponseParser } from './response-parser';
import { DefaultDependencyAnalyzer } from './dependency-analyzer';
import { DefaultBatchScheduler } from './batch-scheduler';
import { DefaultResultInjector } from './result-injector';
import { DefaultFallbackManager } from './fallback/fallback-manager';

/**
 * Function Calling 管线
 *
 * 使用方式：
 * ```typescript
 * const pipeline = new FunctionCallingPipeline();
 * pipeline.setDispatcher(dispatcher);
 * pipeline.setCollector(collector);
 * pipeline.use(new LoggerMiddleware());
 *
 * const result = await pipeline.process(llmResponse, workspaceId, conversation);
 * ```
 */
export class FunctionCallingPipeline extends EventEmitter {
  // 子组件（默认实现）
  private parser: IResponseParser = new DefaultResponseParser();
  private analyzer: IDependencyAnalyzer = new DefaultDependencyAnalyzer();
  private scheduler: IBatchScheduler = new DefaultBatchScheduler();
  private dispatcher: IToolDispatcher | null = null;
  private collector: IResultCollector | null = null;
  private injector: IResultInjector = new DefaultResultInjector();
  private fallback: IFallbackManager = new DefaultFallbackManager();

  // 中间件列表
  private middlewares: IPipelineMiddleware[] = [];

  // 管线选项
  private readonly options: PipelineOptions;

  // 当前状态
  private status: PipelineStatus = {
    phase: PipelinePhase.Idle,
    startedAt: null,
    elapsedMs: 0,
    callCount: 0,
  };

  constructor(options: PipelineOptions = {}) {
    super();
    this.options = { ...DEFAULT_PIPELINE_OPTIONS, ...options };
  }

  // ════════════════════════════════════════════════════
  // 子组件注入
  // ════════════════════════════════════════════════════

  setParser(parser: IResponseParser): void {
    this.parser = parser;
  }

  setAnalyzer(analyzer: IDependencyAnalyzer): void {
    this.analyzer = analyzer;
  }

  setScheduler(scheduler: IBatchScheduler): void {
    this.scheduler = scheduler;
  }

  setDispatcher(dispatcher: IToolDispatcher): void {
    this.dispatcher = dispatcher;
  }

  setCollector(collector: IResultCollector): void {
    this.collector = collector;
  }

  setInjector(injector: IResultInjector): void {
    this.injector = injector;
  }

  setFallback(fallback: IFallbackManager): void {
    this.fallback = fallback;
  }

  /** 获取 IResultInjector 引用（用于注册格式化器） */
  getInjector(): IResultInjector {
    return this.injector;
  }

  /** 获取 IFallbackManager 引用（用于注册兜底策略） */
  getFallback(): IFallbackManager {
    return this.fallback;
  }

  // ════════════════════════════════════════════════════
  // 中间件管理
  // ════════════════════════════════════════════════════

  /**
   * 注册中间件
   */
  use(middleware: IPipelineMiddleware): void {
    this.middlewares.push(middleware);
  }

  // ════════════════════════════════════════════════════
  // 事件管理
  // ════════════════════════════════════════════════════

  /**
   * 监听管线事件
   */
  onEvent(event: PipelineEvent, listener: (...args: unknown[]) => void): void {
    this.on(event, listener);
  }

  /**
   * 移除事件监听
   */
  offEvent(event: PipelineEvent, listener: (...args: unknown[]) => void): void {
    this.off(event, listener);
  }

  // ════════════════════════════════════════════════════
  // 核心方法
  // ════════════════════════════════════════════════════

  /**
   * 处理 LLM 响应
   *
   * 完整流程：
   * 1. 解析 tool_calls
   * 2. 依赖分析 → 执行层级
   * 3. 调度 → Batch 序列
   * 4. 中间件前置处理
   * 5. 分发执行 + 结果收集
   * 6. 兜底处理（如有失败）
   * 7. 中间件后置处理
   * 8. 结果回注
   *
   * @param response - LLM 响应
   * @param workspaceId - 目标工作区 ID
   * @param conversation - 对话上下文（用于回注）
   * @param processOptions - 处理选项（可选，覆盖默认选项）
   * @param abortSignal - 中止信号（可选）
   * @returns 管线处理结果
   */
  async process(
    response: LLMResponse,
    workspaceId: string,
    conversation?: Conversation,
    processOptions?: ProcessOptions,
    abortSignal?: AbortSignal,
  ): Promise<PipelineResult> {
    const startTime = Date.now();
    const pipelineId = processOptions?.requestId || `pipe_${crypto.randomUUID().slice(0, 8)}`;

    this.updateStatus(PipelinePhase.Parsing, startTime);
    this.emit(PipelineEvent.Start, { pipelineId, workspaceId });

    const errors: PipelineError[] = [];
    let allResults: CollectResult | null = null;

    try {
      // ── 1. 解析 ──
      const parseStart = Date.now();
      const calls = this.parser.parse(response);
      const parseDuration = Date.now() - parseStart;

      if (calls.length === 0) {
        const emptyResult = this.buildEmptyResult(startTime, parseDuration);
        this.updateStatus(PipelinePhase.Completed, startTime);
        return emptyResult;
      }

      this.status.callCount = calls.length;
      this.emit(PipelineEvent.Parsed, { pipelineId, calls });

      // ── 2. 依赖分析 ──
      this.updateStatus(PipelinePhase.Analyzing, startTime);
      const analyzeStart = Date.now();
      const layers = this.analyzer.analyze(calls);
      const analyzeDuration = Date.now() - analyzeStart;
      this.emit(PipelineEvent.Analyzed, { pipelineId, layers });

      // ── 3. 调度 ──
      this.updateStatus(PipelinePhase.Scheduling, startTime);
      const scheduleStart = Date.now();
      const scheduleOptions: ScheduleOptions = {
        ...DEFAULT_SCHEDULE_OPTIONS,
        ...this.options.schedule,
        ...processOptions?.schedule,
      };
      const batches = this.scheduler.schedule(layers, scheduleOptions);
      const scheduleDuration = Date.now() - scheduleStart;

      // ── 4. 中间件前置处理 ──
      this.updateStatus(PipelinePhase.MiddlewareBefore, startTime);
      const middlewareBeforeStart = Date.now();
      let ctx: MiddlewareContext = {
        pipelineId,
        workspaceId,
        calls,
        layers,
        batches,
        results: [],
        errors: [],
        metadata: {},
      };

      for (const mw of this.middlewares) {
        if (mw.before) {
          ctx = await mw.before(ctx);
        }
      }
      const middlewareBeforeDuration = Date.now() - middlewareBeforeStart;

      // 前置中间件可能移除了调用，需要重新检查
      if (ctx.calls.length === 0) {
        const emptyResult = this.buildEmptyResult(
          startTime,
          parseDuration,
          analyzeDuration,
          scheduleDuration,
          middlewareBeforeDuration,
        );
        emptyResult.errors = ctx.errors || [];

        // V31 FIX: 合并中间件结果（即使调用被移除），确保 wiki/search 等工具结果被注入对话
        if (ctx.results && ctx.results.length > 0) {
          emptyResult.toolResults = ctx.results;
          emptyResult.stats.total = ctx.results.length;
          emptyResult.stats.success = ctx.results.filter(r => r.success && !r.cancelled).length;
          emptyResult.stats.failed = ctx.results.filter(r => !r.success && !r.cancelled).length;

          // 注入到对话上下文，防止 LLM 报 "tool_calls must be followed by tool messages" 错误
          if (conversation) {
            const collectResult: CollectResult = {
              results: ctx.results,
              successCount: emptyResult.stats.success,
              failCount: emptyResult.stats.failed,
              totalDurationMs: emptyResult.totalDurationMs,
              toolDurations: [],
              hasErrors: emptyResult.stats.failed > 0,
            };
            this.injector.inject(collectResult, conversation);
          }
        }

        this.updateStatus(PipelinePhase.Completed, startTime);
        this.emit(PipelineEvent.Complete, { pipelineId, result: emptyResult });
        return emptyResult;
      }

      // ── 5. 分发 + 收集 ──
      this.updateStatus(PipelinePhase.Dispatching, startTime);
      const dispatchStart = Date.now();

      if (!this.dispatcher) {
        throw new Error('ToolDispatcher 未设置，请调用 setDispatcher() 注入');
      }
      if (!this.collector) {
        throw new Error('ResultCollector 未设置，请调用 setCollector() 注入');
      }

      const collectOptions: CollectOptions = {
        ...DEFAULT_COLLECT_OPTIONS,
        ...this.options.collect,
        ...processOptions?.collect,
      };

      allResults = await this.collector.collect(
        batches,
        this.dispatcher,
        workspaceId,
        collectOptions,
        abortSignal,
      );

      // V31 FIX: 合并中间件结果（来自 middleware.before 处理的知识工具、QQ 工具等）
      // 这些结果被中间件推入 ctx.results，但 allResults 仅包含分发器分发的工具结果，
      // 若不合并则中间件结果不会被注入到 LLM 对话上下文中
      if (ctx.results && ctx.results.length > 0) {
        for (const mr of ctx.results) {
          const toolResult = mr as ToolResultContent;
          allResults.results.push(toolResult);
          if (toolResult.success && !toolResult.cancelled) {
            allResults.successCount++;
          } else if (!toolResult.success && !toolResult.cancelled) {
            allResults.failCount++;
          }
        }
        allResults.hasErrors = allResults.hasErrors || allResults.failCount > 0;
      }

      const collectDuration = Date.now() - dispatchStart;

      // ── 6. 兜底处理 ──
      this.updateStatus(PipelinePhase.Fallback, startTime);
      const fallbackStart = Date.now();
      let fallbackDuration = 0;

      if (this.options.enableFallback !== false && allResults.hasErrors) {
        for (const result of allResults.results) {
          if (!result.success && !result.cancelled && !result.skipped) {
            const failedCall = calls.find(
              (c) => c.toolCallId === result.toolCallId,
            );
            if (failedCall) {
              const fbContext: FallbackContext = {
                workspaceId,
                attemptCount: 1,
                previousErrors: [result.error || ''],
                allResults: allResults.results,
                metadata: {},
              };

              const fbResult = await this.fallback.handle(failedCall, fbContext);
              if (fbResult.resolved) {
                Object.assign(result, fbResult.result);
                allResults.successCount += result.success ? 1 : 0;
                allResults.failCount -= 1;
                result.resolvedByFallback = true;
              }

              this.emit(PipelineEvent.Fallback, {
                pipelineId,
                toolName: failedCall.toolName,
                strategy: fbResult.strategyUsed,
                resolved: fbResult.resolved,
              });
            }
          }
        }

        // 重新计算统计
        allResults.hasErrors = allResults.failCount > 0;
      }
      fallbackDuration = Date.now() - fallbackStart;

      // ── 7. 中间件后置处理 ──
      this.updateStatus(PipelinePhase.MiddlewareAfter, startTime);
      const middlewareAfterStart = Date.now();
      ctx.results = allResults.results;
      ctx.errors = allResults.hasErrors
        ? [...(ctx.errors || []), { code: 'PARTIAL_FAILURE', message: '部分工具调用失败' }]
        : ctx.errors;

      for (const mw of this.middlewares) {
        if (mw.after) {
          ctx = await mw.after(ctx);
        }
      }
      const middlewareAfterDuration = Date.now() - middlewareAfterStart;

      // ── 8. 结果回注 ──
      this.updateStatus(PipelinePhase.Injecting, startTime);
      const injectStart = Date.now();
      if (conversation) {
        this.injector.inject(allResults, conversation);
      }
      const injectDuration = Date.now() - injectStart;

      // ── 构建结果 ──
      const now = Date.now();
      this.updateStatus(PipelinePhase.Completed, startTime);

      // 收集中间件产生的错误
      const middlewareErrors: PipelineError[] = (ctx.errors || []).filter(
        (e): e is PipelineError => typeof e === 'object' && e !== null && 'code' in e,
      );

      const result: PipelineResult = {
        toolResults: allResults.results,
        totalDurationMs: now - startTime,
        phaseDurations: {
          parse: parseDuration,
          analyze: analyzeDuration,
          schedule: scheduleDuration,
          middlewareBefore: middlewareBeforeDuration,
          dispatch: 0,
          collect: collectDuration,
          fallback: fallbackDuration,
          middlewareAfter: middlewareAfterDuration,
          inject: injectDuration,
        },
        stats: {
          total: allResults.results.length,
          success: allResults.results.filter((r) => r.success && !r.cancelled).length,
          failed: allResults.results.filter((r) => !r.success && !r.cancelled && !r.skipped).length,
          skipped: allResults.results.filter((r) => r.skipped).length,
          cancelled: allResults.results.filter((r) => r.cancelled).length,
          fallbackResolved: allResults.results.filter((r) => r.resolvedByFallback).length,
        },
        hasErrors: allResults.hasErrors || middlewareErrors.length > 0,
        errors: middlewareErrors,
      };

      this.emit(PipelineEvent.Complete, { pipelineId, result });
      return result;

    } catch (err) {
      // 管线异常
      const error: PipelineError = {
        code: 'FCP_500',
        message: err instanceof Error ? err.message : '管线执行异常',
        stack: err instanceof Error ? err.stack : undefined,
      };

      this.emit(PipelineEvent.Error, { pipelineId, error });

      return {
        toolResults: allResults?.results || [],
        totalDurationMs: Date.now() - startTime,
        phaseDurations: {
          parse: 0,
          analyze: 0,
          schedule: 0,
          middlewareBefore: 0,
          dispatch: 0,
          collect: 0,
          fallback: 0,
          middlewareAfter: 0,
          inject: 0,
        },
        stats: {
          total: 0,
          success: 0,
          failed: 0,
          skipped: 0,
          cancelled: 0,
          fallbackResolved: 0,
        },
        hasErrors: true,
        errors: [error],
      };
    }
  }

  // ════════════════════════════════════════════════════
  // 状态管理
  // ════════════════════════════════════════════════════

  /** 获取当前管线状态 */
  getStatus(): PipelineStatus {
    return { ...this.status };
  }

  /** 重置管线状态 */
  reset(): void {
    this.status = {
      phase: PipelinePhase.Idle,
      startedAt: null,
      elapsedMs: 0,
      callCount: 0,
    };
  }

  // ════════════════════════════════════════════════════
  // 内部方法
  // ════════════════════════════════════════════════════

  private updateStatus(phase: PipelinePhase, startTime: number): void {
    this.status = {
      phase,
      startedAt: startTime,
      elapsedMs: Date.now() - startTime,
      callCount: this.status.callCount,
    };
  }

  private buildEmptyResult(
    startTime: number,
    parseDuration: number,
    analyzeDuration = 0,
    scheduleDuration = 0,
    middlewareBeforeDuration = 0,
  ): PipelineResult {
    const now = Date.now();
    return {
      toolResults: [],
      totalDurationMs: now - startTime,
      phaseDurations: {
        parse: parseDuration,
        analyze: analyzeDuration,
        schedule: scheduleDuration,
        middlewareBefore: middlewareBeforeDuration,
        dispatch: 0,
        collect: 0,
        fallback: 0,
        middlewareAfter: 0,
        inject: 0,
      },
      stats: {
        total: 0,
        success: 0,
        failed: 0,
        skipped: 0,
        cancelled: 0,
        fallbackResolved: 0,
      },
      hasErrors: false,
      errors: [],
    };
  }
}