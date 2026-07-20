/**
 * qq_send — 发送 QQ 消息工具
 *
 * 支持群消息、私聊、图片、文件、内置表情、表情组六种方式。
 * 注册到 QQ Sub-Agent 的工具列表，由 Sub-Agent LLM 调用。
 *
 * V31: 新增 face/sticker 类型支持。
 */

import type { QQSendParams, SendResult } from './types';
import type { OneBotClient } from './onebot-client';

/** qq_send 工具 Schema（Function Calling 格式） */
export const QQ_SEND_TOOL_SCHEMA = {
  name: 'qq_send',
  description: '发送 QQ 消息，支持群消息、私聊、图片、文件、内置表情、表情组六种方式',
  input_schema: {
    type: 'object' as const,
    properties: {
      type: {
        type: 'string' as const,
        enum: ['group_msg', 'private_msg', 'image', 'file', 'face', 'sticker'],
        description: '发送类型：group_msg=群消息, private_msg=私聊, image=图片, file=文件, face=内置表情, sticker=表情组',
      },
      target: {
        type: 'string' as const,
        description: '目标 ID（群号或 QQ 号）',
      },
      content: {
        type: 'string' as const,
        description: '消息内容（文本消息时必填）',
      },
      file_url: {
        type: 'string' as const,
        description: '文件/图片 URL（图片或文件时必填）',
      },
      file_name: {
        type: 'string' as const,
        description: '文件名（文件类型时必填）',
      },
      face_id: {
        type: 'number' as const,
        description: '内置表情 ID（type=face 时必填，范围 0-350）',
      },
      sticker_group: {
        type: 'string' as const,
        description: '表情组名（type=sticker 时必填，如 "蚌"/"赞"/"哭"），系统从组内随机选一个表情发送',
      },
    },
    required: ['type', 'target'],
  },
};

/** 执行 qq_send */
export async function qqSend(
  client: OneBotClient,
  params: QQSendParams,
): Promise<SendResult> {
  switch (params.type) {
    case 'group_msg':
      if (!params.content) return { success: false, error: '群消息内容不能为空' };
      return client.sendGroupMsg(params.target, params.content);

    case 'private_msg':
      if (!params.content) return { success: false, error: '私聊消息内容不能为空' };
      return client.sendPrivateMsg(params.target, params.content);

    case 'image':
      if (!params.file_url) return { success: false, error: '图片 URL 不能为空' };
      return client.sendGroupImage(params.target, params.file_url);

    case 'file':
      if (!params.file_url || !params.file_name) return { success: false, error: '文件和文件名不能为空' };
      return client.sendGroupFile(params.target, params.file_url, params.file_name);

    case 'face':
      if (params.face_id === undefined) return { success: false, error: '内置表情 ID 不能为空' };
      return client.sendGroupFace(params.target, params.face_id);

    case 'sticker':
      // 直调场景（非中间件），sticker 类型需由中间件解析 StickerGroupRegistry
      return { success: false, error: 'sticker 类型需通过中间件解析，请使用 face 或直接调用对应 API' };

    default:
      return { success: false, error: `不支持的发送类型: ${params.type}` };
  }
}