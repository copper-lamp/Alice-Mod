/**
 * QQ 机器人模块 — 类型定义
 *
 * 涵盖 OneBot 协议、QQ 消息、权限控制、Sub-Agent 通信等核心类型。
 */

import type { ConversationMessage, AgentProfile } from '../prompt/types';

// ════════════════════════════════════════════════════════════════
// 1. 连接状态
// ════════════════════════════════════════════════════════════════

/** 连接状态 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/** Sub-Agent 状态 */
export type SubAgentStatus = 'idle' | 'processing' | 'thinking' | 'waiting_main_agent' | 'error';

// ════════════════════════════════════════════════════════════════
// 2. QQ 消息类型 (OneBot 协议)
// ════════════════════════════════════════════════════════════════

/** 消息段 */
export interface MessageSegment {
  type: 'text' | 'image' | 'face' | 'at' | 'reply' | 'file';
  data: Record<string, string>;
}

/** 群消息事件（OneBot 格式） */
export interface GroupMessageEvent {
  post_type: 'message';
  message_type: 'group';
  sub_type: 'normal' | 'anonymous' | 'notice';
  group_id: number;
  user_id: number;
  message: MessageSegment[];
  raw_message: string;
  font: number;
  sender: {
    user_id: number;
    nickname: string;
    card: string;
    role: 'owner' | 'admin' | 'member';
  };
  time: number;
  self_id: number;
}

/** 私聊消息事件（OneBot 格式） */
export interface PrivateMessageEvent {
  post_type: 'message';
  message_type: 'private';
  sub_type: 'friend' | 'group' | 'other';
  user_id: number;
  message: MessageSegment[];
  raw_message: string;
  font: number;
  sender: {
    user_id: number;
    nickname: string;
  };
  time: number;
  self_id: number;
}

/** OneBot 消息事件联合类型 */
export type OneBotMessageEvent = GroupMessageEvent | PrivateMessageEvent;

/** OneBot 通知事件 */
export interface OneBotNoticeEvent {
  post_type: 'notice';
  notice_type: string;
  [key: string]: unknown;
}

// ════════════════════════════════════════════════════════════════
// 3. QQ 消息（内部统一格式）
// ════════════════════════════════════════════════════════════════

/** QQ 消息（内部统一格式） */
export interface QQMessage {
  id: string;
  type: 'group' | 'private';
  groupId?: string;
  userId: string;
  userName: string;
  content: string;
  rawContent: string;
  segments: MessageSegment[];
  timestamp: number;
  read: boolean;
}

/** 发送结果 */
export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/** 回复消息 */
export interface QQReply {
  type: 'group' | 'private';
  targetId: string;
  content: string;
  replyTo?: string; // 回复的消息 ID（可选，用于 @/引用）
}

// ════════════════════════════════════════════════════════════════
// 4. 权限控制
// ════════════════════════════════════════════════════════════════

/** QQ 权限等级 */
export enum QQPermission {
  NONE = 0,
  BASIC = 1,
  COMMAND = 2,
  ADMIN = 3,
}

/** 权限配置 */
export interface PermissionConfig {
  ownerId: string;
  admins: string[];
  whitelist: string[];
  defaultPermission: QQPermission;
  cooldownSeconds: number;
}

// ════════════════════════════════════════════════════════════════
// 5. Sub-Agent 通信
// ════════════════════════════════════════════════════════════════

/** 游戏操作请求（QQ Sub-Agent → 主 Agent） */
export interface GameActionRequest {
  id: string;
  sourceUserId: string;
  sourceGroupId?: string;
  description: string;
  priority: 'normal' | 'high';
  timestamp: number;
}

/** 游戏操作响应（主 Agent → QQ Sub-Agent） */
export interface GameActionResult {
  requestId: string;
  success: boolean;
  summary: string;
  details?: string;
  error?: string;
  durationMs: number;
}

/** 队列状态 */
export interface QueueStatus {
  pending: number;
  processing: number;
  completed: number;
  total: number;
}

// ════════════════════════════════════════════════════════════════
// 6. Sub-Agent 配置
// ════════════════════════════════════════════════════════════════

/** Sub-Agent 配置 */
export interface QQSubAgentConfig {
  /** 对话历史保留的最大轮数 */
  maxHistoryRounds: number;
  /** 系统提示词（可选，覆盖默认 Profile 生成的提示词） */
  systemPrompt?: string;
  /** 使用的模型路由任务类型 */
  taskType: 'complex' | 'simple' | 'chat';
  /** 请求游戏操作超时时间（ms） */
  gameActionTimeout: number;
  /** 是否启用 Sub-Agent */
  enabled: boolean;
}

/** 默认 Sub-Agent 配置 */
export const DEFAULT_SUB_AGENT_CONFIG: QQSubAgentConfig = {
  maxHistoryRounds: 10,
  taskType: 'chat',
  gameActionTimeout: 30_000,
  enabled: true,
};

// ════════════════════════════════════════════════════════════════
// 7. Sub-Agent 事件
// ════════════════════════════════════════════════════════════════

/** Sub-Agent 事件类型 */
export type QQSubAgentEvent =
  | { type: 'status_change'; status: SubAgentStatus }
  | { type: 'reply'; reply: QQReply }
  | { type: 'request_game_action'; request: GameActionRequest }
  | { type: 'bridge_message'; message: QQMessage }
  | { type: 'error'; error: string };

/** Sub-Agent 事件处理器 */
export type QQSubAgentEventHandler = (event: QQSubAgentEvent) => void;

// ════════════════════════════════════════════════════════════════
// 8. 表情组配置
// ════════════════════════════════════════════════════════════════

/** 表情组中的单个表情项 */
export interface StickerItem {
  type: 'face' | 'sticker';
  id: string;  // face 填数字 ID 的字符串，sticker 填贴图 ID
}

// ════════════════════════════════════════════════════════════════
// 9. 工具 Schema（用于 Function Calling）
// ════════════════════════════════════════════════════════════════

/** qq_send 工具参数 */
export interface QQSendParams {
  type: 'group_msg' | 'private_msg' | 'image' | 'file' | 'face' | 'sticker';
  target: string;
  content?: string;
  file_url?: string;
  file_name?: string;
  face_id?: number;         // type=face 时必填
  sticker_group?: string;   // type=sticker 时必填，表情组名
}

/** qq_info 工具参数 */
export interface QQInfoParams {
  type: 'group' | 'members' | 'user';
  target_id: string;
}

/** request_game_action 工具参数 */
export interface RequestGameActionParams {
  description: string;
  priority?: 'normal' | 'high';
}

// ════════════════════════════════════════════════════════════════
// 10. 桥接配置
// ════════════════════════════════════════════════════════════════

/** 桥接配置 */
export interface BridgeConfig {
  groupId: string;
  direction: 'both' | 'qq_to_game' | 'game_to_qq';
  prefix?: string;
  filter?: {
    keywords?: string[];
    users?: string[];
  };
}

// ════════════════════════════════════════════════════════════════
// 11. 全局配置
// ════════════════════════════════════════════════════════════════

/** Docker 模式配置（替代 managed 托管模式） */
export interface DockerConfig {
  /** QQ 号 */
  account: string;
  /** Docker 镜像，默认 ghcr.io/napneko/napcat:latest */
  image?: string;
  /** 镜像版本标签（可选） */
  version?: string;
  /** 宿主机 OneBot 端口（默认自动分配） */
  oneBotPort?: number;
  /** 宿主机 WebUI 端口（默认自动分配） */
  webUiPort?: number;
  /** WebUI Token */
  webUiToken?: string;
  /** OneBot 鉴权 Token */
  accessToken?: string;
  /** CPU 限制，如 "1.5" */
  cpuLimit?: string;
  /** 内存限制，如 "512M" */
  memoryLimit?: string;
  /** 持久化数据目录（默认 Alice/qq-bot/napcat-data/） */
  dataDir?: string;
  /** 自动启动 */
  autoStart: boolean;
  /** 自动更新镜像 */
  autoUpdate: boolean;
}

/** QQ 机器人全局配置 */
export interface QQBotConfig {
  enabled: boolean;
  /** 部署模式：docker（Docker 容器方案）| desktop（桌面版 NapCat 进程管理）| external（外部 NapCat）| managed（已废弃） */
  mode: 'docker' | 'desktop' | 'external' | 'managed';

  /** @deprecated 使用 docker 配置替代 */
  managed?: {
    account: string;
    autoStart: boolean;
    autoUpdate: boolean;
  };

  /** Docker 容器模式配置（替代 managed 托管模式） */
  docker?: DockerConfig;

  external?: {
    wsHost: string;
    wsPort: number;
    wsProtocol: 'ws' | 'wss';
    accessToken: string;
  };

  authorization: PermissionConfig;
  bridges: BridgeConfig[];
  subAgent: QQSubAgentConfig;

  behavior: {
    replyPrefix: string;
    maxHistory: number;
  };

  /** 表情组配置：组名 → 表情列表，系统随机发送 */
  stickerGroups?: Record<string, StickerItem[]>;
}