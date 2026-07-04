/**
 * Alice Mod 常量与枚举
 */

/** TCP 通信默认配置 */
export const DEFAULT_TCP_CONFIG = {
  host: '127.0.0.1',
  port: 21010,
  reconnectInterval: 3000,
  maxReconnectAttempts: 10,
  heartbeatInterval: 15000,
} as const;

/** 版本信息 */
export const VERSION = {
  major: 1,
  minor: 0,
  patch: 0,
  toString: () => '1.0.0',
} as const;

/** 项目名称 */
export const PROJECT_NAME = 'Alice Mod';

/** 工具相关常量 */
export const TOOL = {
  MAX_EXECUTION_TIME: 30000,
  MAX_RETRIES: 3,
} as const;

/** 通信协议版本 */
export const PROTOCOL_VERSION = '2.0';

/** Agent Core 工具总数 */
export const AC_TOOL_COUNT = 17;

/** Adapter Core 工具总数 */
export const ADAPTER_TOOL_COUNT = 26;

/** 全部工具总数 */
export const TOTAL_TOOL_COUNT = AC_TOOL_COUNT + ADAPTER_TOOL_COUNT;
