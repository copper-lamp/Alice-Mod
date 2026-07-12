/**
 * qq_notify — QQ 主动通知工具
 *
 * 向指定 QQ 群发送通知消息，支持模板渲染。
 */

import type { OneBotClient } from '../onebot-client';
import type { SendResult } from '../types';

export interface QQNotifyParams {
  group_id: string;
  content: string;
  template?: string;
}

export const QQ_NOTIFY_TOOL_SCHEMA = {
  name: 'qq_notify',
  description: '向指定 QQ 群发送主动通知消息',
  input_schema: {
    type: 'object' as const,
    properties: {
      group_id: {
        type: 'string' as const,
        description: '目标群号',
      },
      content: {
        type: 'string' as const,
        description: '通知内容',
      },
      template: {
        type: 'string' as const,
        description: '模板名称（可选）',
      },
    },
    required: ['group_id', 'content'],
  },
};

export async function qqNotify(
  client: OneBotClient,
  params: QQNotifyParams,
  variables?: Record<string, string>,
): Promise<SendResult> {
  const { group_id, content } = params;

  const rendered = variables
    ? content.replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables[key] ?? '')
    : content;

  if (!rendered.trim()) {
    return { success: false, error: '通知内容不能为空' };
  }

  return client.sendGroupMsg(group_id, rendered);
}
