/**
 * qq_info — 查询 QQ 信息工具
 *
 * 支持查询群信息、群成员列表、用户信息。
 * 注册到 QQ Sub-Agent 的工具列表，由 Sub-Agent LLM 调用。
 */

import type { QQInfoParams, SendResult } from './types';
import type { OneBotClient } from './onebot-client';

/** qq_info 工具 Schema（Function Calling 格式） */
export const QQ_INFO_TOOL_SCHEMA = {
  name: 'qq_info',
  description: '查询 QQ 群信息、群成员列表或用户信息',
  input_schema: {
    type: 'object' as const,
    properties: {
      type: {
        type: 'string' as const,
        enum: ['group', 'members', 'user'],
        description: '查询类型：group=群信息, members=群成员, user=用户信息',
      },
      target_id: {
        type: 'string' as const,
        description: '目标 ID（群号或 QQ 号）',
      },
    },
    required: ['type', 'target_id'],
  },
};

/** 执行 qq_info */
export async function qqInfo(
  client: OneBotClient,
  params: QQInfoParams,
): Promise<SendResult & { data?: any }> {
  try {
    switch (params.type) {
      case 'group': {
        const info = await client.getGroupInfo(params.target_id);
        return {
          success: true,
          data: {
            group_id: String(info.group_id),
            group_name: info.group_name,
            member_count: info.member_count,
            max_member_count: info.max_member_count,
            owner_id: String(info.owner_id),
          },
        };
      }

      case 'members': {
        const members = await client.getGroupMemberList(params.target_id);
        return {
          success: true,
          data: {
            count: members.length,
            members: members.map(m => ({
              user_id: String(m.user_id),
              user_name: m.nickname || m.card || '',
              role: m.role,
            })),
          },
        };
      }

      case 'user': {
        const info = await client.getStrangerInfo(params.target_id);
        return {
          success: true,
          data: {
            user_id: String(info.user_id),
            user_name: info.nickname || '',
          },
        };
      }

      default:
        return { success: false, error: `不支持的查询类型: ${params.type}` };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : '查询失败',
    };
  }
}