// 执行AI引擎占位
// 协调各个 AI 子系统执行任务

import { PathfindingSystem } from './pathfinding/index.js';
import { MovementSystem } from './movement/index.js';
import { InventoryEngine } from './inventory/index.js';
import { CombatSystem } from './combat/index.js';
import { InteractionEngine } from './interaction/index.js';
import { SurvivalEngine } from './survival/index.js';

export class AIEngine {
  pathfinding = new PathfindingSystem();
  movement = new MovementSystem();
  inventory = new InventoryEngine();
  combat = new CombatSystem();
  interaction = new InteractionEngine();
  survival = new SurvivalEngine();

  async execute(task: string): Promise<void> {
    // TODO: Parse and dispatch task
    logger.debug('[AI] Executing:', task);
  }
}
