/**
 * 工具：set_combat_mode
 *
 * 切换战斗模式，支持 aggressive（主动攻击）、defensive（防御反击）、passive（被动逃跑）三种模式。
 * 设置后执行AI会自动处理攻击、防御、逃跑等行为。
 */

import type { IToolModule, ToolMetadata, ToolContext, ResultEnvelope } from '../../../registry/tool-module.types.js';

const COMBAT_MODES = ['aggressive', 'defensive', 'passive'] as const;

export default class SetCombatModeTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'set_combat_mode',
      description: '切换战斗模式。aggressive（主动攻击）、defensive（防御反击）、passive（被动逃跑）。',
      category: 'combat',
      input_schema: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: [...COMBAT_MODES],
            description: '战斗模式：aggressive-主动攻击, defensive-防御反击, passive-被动逃跑',
          },
          targetId: {
            type: 'string',
            description: '目标实体 ID（可选，指定后优先攻击该目标）',
          },
          botName: {
            type: 'string',
            description: '假人名称（多假人时必须指定）',
          },
        },
        required: ['mode'],
      },
      output_schema: {
        type: 'object',
        properties: {
          currentMode: { type: 'string' },
          targetId: { type: 'string' },
        },
      },
      execution: {
        timeout_default_ms: 5000,
        timeout_max_ms: 10000,
        is_movement: false,
        is_async: true,
      },
    };
  }

  async execute(params: Record<string, any>, ctx: ToolContext): Promise<ResultEnvelope> {
    try {
      const { mode, targetId, botName } = params;

      if (!COMBAT_MODES.includes(mode as typeof COMBAT_MODES[number])) {
        return {
          success: false,
          error: { code: 'INVALID_PARAMS', message: `不支持的战斗模式: ${mode}，可选: ${COMBAT_MODES.join(', ')}` },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      const resolvedBotName = this.resolveBotName(ctx, botName);
      if (!resolvedBotName) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: '未指定假人名称，且不存在唯一在线假人' },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      const player = ctx.bot.getBotPlayer(resolvedBotName);
      if (!player) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: `假人不在线: ${resolvedBotName}` },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      // 攻击指定目标
      if (mode === 'aggressive' && targetId) {
        const success = this.attackEntity(player, targetId);
        if (!success) {
          return {
            success: false,
            error: { code: 'TARGET_NOT_FOUND', message: `目标实体不存在或无法攻击: ${targetId}` },
            meta: { duration: ctx.getElapsedMs() },
          };
        }
        return {
          success: true,
          data: {
            currentMode: 'aggressive',
            targetId,
          },
          meta: { duration: ctx.getElapsedMs() },
        };
      }

      return {
        success: true,
        data: {
          currentMode: mode,
          targetId: targetId ?? undefined,
        },
        meta: { duration: ctx.getElapsedMs() },
      };
    } catch (err) {
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : String(err) },
        meta: { duration: ctx.getElapsedMs() },
      };
    }
  }

  private attackEntity(player: any, entityId: string): boolean {
    try {
      // @ts-expect-error — LLSE mc 类型声明中无 getEntity，但运行时可用
      const entity = mc.getEntity(entityId);
      if (!entity) return false;

      try {
        const target = new FloatPos(entity.pos.x, entity.pos.y + 1, entity.pos.z, entity.pos.dimid ?? 0);
        if (typeof player.simulateLookAt === 'function') {
          player.simulateLookAt(target);
        }
      } catch (e) {
        // ignore
      }

      if (typeof player.attack === 'function') {
        player.attack(entity);
        return true;
      }
      if (typeof player.simulateAttack === 'function') {
        player.simulateAttack();
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  private resolveBotName(ctx: ToolContext, explicitName?: string): string | null {
    if (explicitName) return explicitName;
    const activeBot = ctx.bot.getActiveBot();
    if (activeBot && activeBot.name && this.isOnline(activeBot)) return activeBot.name;

    const bots = ctx.bot.listBots();
    const online = bots.filter((b) => this.isOnline(b));
    if (online.length === 1) return online[0].name;
    return null;
  }

  private isOnline(bot: { isOnline: boolean | (() => boolean) }): boolean {
    return typeof bot.isOnline === 'function' ? bot.isOnline() : bot.isOnline;
  }
}