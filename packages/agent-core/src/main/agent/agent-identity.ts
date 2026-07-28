import type { AgentConfig } from '../../renderer/src/lib/types';

export interface TrustedAgentIdentity {
  agentId: string;
  botName: string;
  botUuid?: string;
}

export function deriveBotName(config: Pick<AgentConfig, 'alias' | 'name'>): string {
  const raw = config.alias?.trim() || config.name;
  return raw.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 16);
}

export function buildTrustedAgentIdentity(
  agentId: string,
  config: Pick<AgentConfig, 'alias' | 'name' | 'botUuid'>,
): TrustedAgentIdentity {
  return {
    agentId,
    botName: deriveBotName(config),
    botUuid: config.botUuid?.trim() || undefined,
  };
}

export function identityProtocolFields(identity: TrustedAgentIdentity): {
  agent_id: string;
  bot_name: string;
  bot_uuid: string | null;
} {
  return {
    agent_id: identity.agentId,
    bot_name: identity.botName,
    bot_uuid: identity.botUuid ?? null,
  };
}
