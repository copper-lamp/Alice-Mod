/**
 * QQ 机器人模块入口
 *
 * 导出所有组件，方便外部引用。
 */

export { QQSubAgent } from './qq-sub-agent';
export { MainAgentTaskQueue, mainAgentTaskQueue } from './main-agent-queue';
export { NapCatManager, createNapCatManager } from './napcat-manager';
export type { NapCatManagerOptions, NapCatStatus, QRCodeResult, LoginStatusResult, QQLoginInfo } from './napcat-manager';
export { OneBotClient } from './onebot-client';
export { PermissionManager } from './permission';
export { MessageBridge } from './message-bridge';
export { MessageHandler } from './message-handler';
export { qqSend, QQ_SEND_TOOL_SCHEMA } from './qq_send';
export { qqInfo, QQ_INFO_TOOL_SCHEMA } from './qq_info';
export { DEFAULT_QQ_BOT_CONFIG, buildWsUrl, buildOneBotConfig, validateConfig } from './config';

export * from './types';