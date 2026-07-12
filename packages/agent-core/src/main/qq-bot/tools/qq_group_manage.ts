/**
 * qq_group_manage — QQ 群管理工具
 *
 * 支持踢人、禁言、设置群名片、审批入群申请、撤回消息。
 * 仅 ADMIN / COMMAND 权限可用。
 */

import type { OneBotClient } from '../onebot-client';
import type { SendResult } from '../types';

export type GroupManageAction = 'kick' | 'mute' | 'set_card' | 'approve_join' | 'recall';

export interface QQGroupManageParams {
  action: GroupManageAction;
  group_id: string;
  user_id?: string;
  duration?: number;
  card?: string;
  flag?: string;
  message_id?: string;
  reason?: string;
  approve?: boolean;
}

export const QQ_GROUP_MANAGE_TOOL_SCHEMA = {
  name: 'qq_group_manage',
  description: 'QQ 群管理操作：踢人、禁言、设置群名片、审批入群申请、撤回消息（仅管理员权限）',
  input_schema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string' as const,
        enum: ['kick', 'mute', 'set_card', 'approve_join', 'recall'],
        description: '群管理动作',
      },
      group_id: {
        type: 'string' as const,
        description: '群号',
      },
      user_id: {
        type: 'string' as const,
        description: '目标用户 QQ 号（kick/mute/set_card 必填）',
      },
      duration: {
        type: 'number' as const,
        description: '禁言时长（秒，mute 必填）',
      },
      card: {
        type: 'string' as const,
        description: '群名片（set_card 必填）',
      },
      flag: {
        type: 'string' as const,
        description: '入群申请标识（approve_join 必填）',
      },
      message_id: {
        type: 'string' as const,
        description: '消息 ID（recall 必填）',
      },
      reason: {
        type: 'string' as const,
        description: '拒绝入群原因（approve_join 可选）',
      },
      approve: {
        type: 'boolean' as const,
        description: '是否同意入群（approve_join 可选，默认 true）',
      },
    },
    required: ['action', 'group_id'],
  },
};

export async function qqGroupManage(
  client: OneBotClient,
  params: QQGroupManageParams,
): Promise<SendResult> {
  const { action, group_id, user_id, duration, card, flag, message_id, reason, approve } = params;

  switch (action) {
    case 'kick': {
      if (!user_id) return { success: false, error: '踢人操作需要 user_id' };
      return client.setGroupKick(group_id, user_id);
    }

    case 'mute': {
      if (!user_id) return { success: false, error: '禁言操作需要 user_id' };
      if (duration === undefined || duration < 0) return { success: false, error: '禁言操作需要 duration（秒）' };
      return client.setGroupBan(group_id, user_id, duration);
    }

    case 'set_card': {
      if (!user_id) return { success: false, error: '设置群名片需要 user_id' };
      if (!card) return { success: false, error: '设置群名片需要 card' };
      return client.setGroupCard(group_id, user_id, card);
    }

    case 'approve_join': {
      if (!flag) return { success: false, error: '审批入群需要 flag' };
      return client.setGroupAddRequest(flag, approve !== false, reason);
    }

    case 'recall': {
      if (!message_id) return { success: false, error: '撤回消息需要 message_id' };
      return client.deleteMsg(message_id);
    }

    default:
      return { success: false, error: `未知的群管理动作: ${action}` };
  }
}
