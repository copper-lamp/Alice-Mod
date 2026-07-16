/**
 * V20 agent 模块入口 — 主链路 MainAgent + Registry
 *
 * 仅导出 V20 新增的主链路相关类。AgentConfigManager / ConnectionResolver /
 * AgentProfileMapper 等已有模块按需从各自文件 import，避免聚合文件成为循环依赖热点。
 */

export { MainAgent } from './main-agent';
export type {
  MainAgentDeps,
  MainAgentEvent,
  MainAgentResult,
} from './main-agent';

export { MainAgentRegistry } from './main-agent-registry';
export type {
  MainAgentRegistryDeps,
  RegistryEntry,
} from './main-agent-registry';

// V23: 汇报机制
export { AgentReportBus } from './agent-report-bus';
export { ReportStore } from './report-store';
export type { AgentReport, ReportType } from './report-store';

// V23: 玩家身份映射
export { PlayerIdentityStore } from './player-identity';
export type { PlayerIdentity } from './player-identity';
