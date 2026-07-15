/**
 * Function Calling Pipeline 模块入口
 *
 * V4 模块导出：
 * - FunctionCallingPipeline — 主管线编排器
 * - 所有默认实现
 * - 所有类型定义
 * - 内置中间件
 */

// 主管线
export { FunctionCallingPipeline } from './pipeline';

// 默认实现
export { DefaultResponseParser } from './response-parser';
export { DefaultDependencyAnalyzer } from './dependency-analyzer';
export { DefaultBatchScheduler } from './batch-scheduler';
export { DefaultToolDispatcher } from './tool-dispatcher';
export { DefaultResultCollector } from './result-collector';
export { DefaultResultInjector } from './result-injector';
export { DefaultFallbackManager } from './fallback/fallback-manager';
export { RetryStrategy } from './fallback/retry-strategy';
export { DegradeStrategy } from './fallback/degrade-strategy';

// V20 §4.7 Batch 实现（对接 JE tool_call_batch）
export { BatchToolDispatcher } from './batch-tool-dispatcher';
export { BatchResultCollector } from './batch-result-collector';

// 内置中间件
export { LoggerMiddleware } from './middleware/builtin/logger-middleware';
export { ValidatorMiddleware } from './middleware/builtin/validator-middleware';
export { MetricsMiddleware, type PipelineMetrics } from './middleware/builtin/metrics-middleware';

// 所有类型
export * from './types';

// V9 工具调用记录器
export { PipelineEventCollector } from './event-collector';
export type { ToolCallRecord, ToolCallStats } from './event-collector';