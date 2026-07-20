/**
 * 状态注入格式化器
 *
 * 将 PlayerState 结构化为 LLM 可理解的文本格式。
 * 每轮对话前调用，注入到 user message 前缀。
 */

import type { PlayerState, IStateInjector } from '../types';

export class DefaultStateInjector implements IStateInjector {
  /** 维度名称映射 */
  private readonly dimensionNames: Record<string, string> = {
    overworld: '主世界',
    nether: '下界',
    the_end: '末地',
    end: '末地',
  };

  format(state: PlayerState): string {
    // V30: skip 标记时返回空字符串（QQ 来源不注入游戏状态）
    if (state.skip) return '';

    const lines: string[] = [];

    lines.push('## 当前状态');
    lines.push(`生命: ${state.health}/20`);
    lines.push(`饥饿: ${state.hunger}/20`);
    lines.push(`饱和度: ${state.saturation}`);
    const dimensionName = this.dimensionNames[state.position.dimension] || state.position.dimension;
    lines.push(
      `位置: (${state.position.x}, ${state.position.y}, ${state.position.z}) ${dimensionName}`,
    );

    if (state.position.biome) {
      lines.push(`生物群系: ${state.position.biome}`);
    }

    // 装备
    if (state.equipment) {
      const eq = state.equipment;
      lines.push(
        `装备: 主手=${eq.mainhand || '无'}, 头盔=${eq.helmet || '无'}, 胸甲=${eq.chestplate || '无'}, 护腿=${eq.leggings || '无'}, 靴子=${eq.boots || '无'}`,
      );
    }

    // 背包
    if (state.inventory) {
      const inv = state.inventory;
      const items = inv.items.length > 0 ? inv.items.join(', ') : '空';
      lines.push(`背包: ${inv.usedSlots}/${inv.totalSlots} - ${items}`);
    }

    // 状态效果
    const effects = state.statusEffects.length > 0
      ? state.statusEffects.join(', ')
      : '无';
    lines.push(`状态效果: ${effects}`);

    if (state.specialStatus) {
      lines.push(state.specialStatus);
    }

    return lines.join('\n');
  }
}