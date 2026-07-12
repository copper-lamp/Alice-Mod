/**
 * 方块交互执行器
 */

import type { PathContext, BlockActionPlan } from '../pathfinding/types.js';
import { ActionController } from './action-controller.js';

export class BlockInteractionExecutor {
  async executeActions(actions: BlockActionPlan[], ctx: PathContext): Promise<boolean> {
    if (!ctx.player) return false;

    const ac = new ActionController(ctx.player);
    const originalSlot = ac.getSelectedSlot();

    try {
      for (const action of actions) {
        if (action.type === 'break') {
          const ok = await ac.breakBlock(action.targetPos, action.toolName);
          if (!ok) return false;
        } else if (action.type === 'place') {
          if (!action.blockName) continue;
          const ok = await ac.placeBlock(action.targetPos, action.blockName, action.face);
          if (!ok) return false;
        }

        // 短暂等待服务器同步
        await this.sleep(100);
      }

      return true;
    } finally {
      ac.selectSlot(originalSlot);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const blockInteractionExecutor = new BlockInteractionExecutor();
