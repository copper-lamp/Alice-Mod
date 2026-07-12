/**
 * 移动状态机
 *
 * 管理 walk/sprint/swim/climb/elytra 等状态切换。
 */

import type { MoveMode, PathContext } from '../pathfinding/types.js';
import type { IMovementStateMachine } from './types.js';

export class MovementStateMachine implements IMovementStateMachine {
  private state: MoveMode = 'walk';

  getState(): MoveMode {
    return this.state;
  }

  transition(to: MoveMode, _ctx: PathContext): boolean {
    // 允许的状态转换（简化版）
    const allowed: Record<MoveMode, MoveMode[]> = {
      walk: ['sprint', 'sprint_jump', 'swim', 'climb', 'elytra', 'ride', 'boat', 'break_block', 'place_block'],
      sprint: ['walk', 'sprint_jump', 'swim', 'climb', 'elytra', 'ride', 'boat', 'break_block', 'place_block'],
      sprint_jump: ['walk', 'sprint', 'swim', 'climb', 'elytra', 'ride', 'boat', 'break_block', 'place_block'],
      swim: ['walk', 'sprint', 'sprint_jump', 'climb', 'elytra', 'ride', 'boat', 'break_block', 'place_block'],
      climb: ['walk', 'sprint', 'sprint_jump', 'swim', 'elytra', 'ride', 'boat', 'break_block', 'place_block'],
      elytra: ['walk', 'sprint', 'sprint_jump', 'swim', 'climb', 'ride', 'boat', 'break_block', 'place_block'],
      ride: ['walk', 'sprint', 'swim', 'climb', 'elytra', 'boat', 'break_block', 'place_block'],
      boat: ['walk', 'sprint', 'swim', 'climb', 'elytra', 'ride', 'break_block', 'place_block'],
      break_block: ['walk', 'sprint', 'sprint_jump', 'swim', 'climb', 'elytra', 'ride', 'boat', 'place_block'],
      place_block: ['walk', 'sprint', 'sprint_jump', 'swim', 'climb', 'elytra', 'ride', 'boat', 'break_block'],
    };

    if (to === this.state || allowed[this.state].includes(to)) {
      this.state = to;
      return true;
    }

    return false;
  }

  reset(): void {
    this.state = 'walk';
  }
}
