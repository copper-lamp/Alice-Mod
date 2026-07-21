/**
 * DependencyAnalyzer 默认实现
 *
 * 分析工具调用间的依赖关系，构建执行层级图。
 * V4 提供基于参数引用 + 冲突矩阵的默认实现。
 * 后续版本可注册自定义冲突规则或语义级依赖分析。
 *
 * 核心原则：
 * - 参数引用（${A.result.xxx}）创建真正的有向依赖边
 * - 冲突矩阵和自定义规则仅在分层时作为约束，不创建有向边
 * - 冲突意味着两个工具不能在同一层并行执行，但不强制先后顺序
 */

import type { ToolCallContent, ExecutionLayer, ConflictRule, IDependencyAnalyzer } from './types';

/** 工具分类（用于冲突矩阵） */
const ToolClassMap: Record<string, string> = {
  move_to: 'movement',
  move_forward: 'movement',
  move_back: 'movement',
  turn: 'movement',
  jump: 'movement',
  look_at: 'movement',
  dig_block: 'block',
  place_block: 'block',
  attack_entity: 'entity',
  interact_entity: 'entity',
  use_item: 'survival',
  equip_item: 'inventory',
  open_container: 'inventory',
  pickup_item: 'inventory',
  drop_item: 'inventory',
  organize_inventory: 'inventory',
  sleep: 'survival',
  eat: 'survival',
  craft: 'survival',
  smelt: 'survival',
  chat: 'chat',
  qq_send: 'qq',
  qq_info: 'qq',
  memory_list: 'memory',
  memory_query: 'memory',
  memory_edit: 'memory',
  maps_query: 'memory',
  maps_edit: 'memory',
  aim_list: 'memory',
  aim_query: 'memory',
  aim_update: 'memory',
  knowledge_query: 'memory',
  task_create: 'task',
  task_query: 'task',
  task_update: 'task',
  task_control: 'task',
  task_decompose: 'task',
  task_config: 'task',
  task_manage: 'task',
};

/** 默认冲突矩阵 */
const DefaultConflictMatrix: Record<string, Record<string, boolean>> = {
  movement: { movement: false, block: true, entity: true, inventory: true, survival: true, chat: false, qq: false, memory: false, task: false },
  block: { movement: true, block: false, entity: true, inventory: true, survival: true, chat: false, qq: false, memory: false, task: false },
  entity: { movement: true, block: true, entity: false, inventory: true, survival: true, chat: false, qq: false, memory: false, task: false },
  inventory: { movement: true, block: true, entity: true, inventory: false, survival: true, chat: false, qq: false, memory: false, task: false },
  survival: { movement: true, block: true, entity: true, inventory: true, survival: false, chat: false, qq: false, memory: false, task: false },
  chat: { movement: false, block: false, entity: false, inventory: false, survival: false, chat: false, qq: false, memory: false, task: false },
  qq: { movement: false, block: false, entity: false, inventory: false, survival: false, chat: false, qq: false, memory: false, task: false },
  memory: { movement: false, block: false, entity: false, inventory: false, survival: false, chat: false, qq: false, memory: false, task: false },
  task: { movement: false, block: false, entity: false, inventory: false, survival: false, chat: false, qq: false, memory: false, task: false },
};

/**
 * 获取工具分类
 */
function getToolClass(toolName: string): string {
  return ToolClassMap[toolName] || 'other';
}

/**
 * 默认依赖分析器
 *
 * 分析策略：
 * 1. 参数引用依赖：B 的参数包含 ${A.result.xxx} → B 依赖 A
 * 2. 冲突矩阵约束：冲突的工具不能在同一层并行
 * 3. 自定义冲突规则：通过 registerConflictRule 注册
 */
export class DefaultDependencyAnalyzer implements IDependencyAnalyzer {
  private conflictRules: ConflictRule[] = [];

  /**
   * 注册自定义冲突规则
   */
  registerConflictRule(rule: ConflictRule): void {
    this.conflictRules.push(rule);
    // 按优先级降序排列
    this.conflictRules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 分析工具调用依赖，构建执行层级
   *
   * 策略：
   * 1. 参数引用（如 ${A.result.xxx}）创建真正的有向边
   * 2. 冲突矩阵和自定义规则仅在分层时作为约束，不创建有向边
   * 3. 同一层内的工具不可冲突，冲突者延至下一层
   *
   * @param calls - 工具调用列表
   * @returns 拓扑排序后的执行层级
   * @throws Error 当检测到循环依赖时
   */
  analyze(calls: ToolCallContent[]): ExecutionLayer[] {
    if (calls.length === 0) return [];

    const n = calls.length;

    // ── 1. 仅基于参数引用构建依赖图（有向边） ──
    // dependencies[i] = 工具 i 依赖的工具索引集合
    const dependencies: Set<number>[] = Array.from({ length: n }, () => new Set());

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        // call[i] 的参数引用了 call[j] 的结果 → i 依赖 j
        if (this.hasParamReference(calls[i], calls[j])) {
          dependencies[i].add(j);
        }
      }
    }

    // ── 2. 检测循环依赖（仅在参数引用图中） ──
    this.detectCycle(dependencies, calls);

    // ── 3. 拓扑排序 + 冲突感知分层 ──
    const layers: ExecutionLayer[] = [];
    const visited = new Set<number>();
    let remaining = new Set(Array.from({ length: n }, (_, i) => i));

    while (remaining.size > 0) {
      const currentLayerCalls: number[] = [];

      for (const idx of remaining) {
        // 检查所有参数引用依赖是否都已被访问
        const deps = dependencies[idx];
        let allDepsVisited = true;
        for (const depIdx of deps) {
          if (!visited.has(depIdx)) {
            allDepsVisited = false;
            break;
          }
        }

        if (!allDepsVisited) continue;

        // 检查是否与当前层已有的工具冲突
        if (this.hasConflictsWithLayer(calls[idx], currentLayerCalls.map((i) => calls[i]))) {
          continue;
        }

        currentLayerCalls.push(idx);
      }

      if (currentLayerCalls.length === 0) {
        // 剩余节点因冲突无法放入当前层，强制将第一个节点单独成层
        const forcedIdx = remaining.values().next().value as number;
        currentLayerCalls.push(forcedIdx);
      }

      layers.push({
        level: layers.length,
        calls: currentLayerCalls.map((idx) => calls[idx]),
      });

      for (const idx of currentLayerCalls) {
        visited.add(idx);
        remaining.delete(idx);
      }
    }

    return layers;
  }

  /**
   * 检查 call 是否与 layerCalls 中的任意工具冲突
   */
  private hasConflictsWithLayer(call: ToolCallContent, layerCalls: ToolCallContent[]): boolean {
    for (const layerCall of layerCalls) {
      if (this.hasConflict(call, layerCall)) return true;
      // 自定义冲突规则
      for (const rule of this.conflictRules) {
        if (rule.check(call, layerCall) || rule.check(layerCall, call)) return true;
      }
    }
    return false;
  }

  /**
   * 检查参数引用依赖
   * B 的参数中包含 ${A.toolName.result.xxx} 表示 B 依赖 A 的返回值
   */
  private hasParamReference(callB: ToolCallContent, callA: ToolCallContent): boolean {
    const argsStr = JSON.stringify(callB.arguments);
    const refPattern = `\\$\\{${callA.toolName}\\.result\\.`;
    return new RegExp(refPattern).test(argsStr);
  }

  /**
   * 检查冲突矩阵
   * 相同分类且冲突矩阵标记为冲突的，不能并行执行
   */
  private hasConflict(callB: ToolCallContent, callA: ToolCallContent): boolean {
    const classA = getToolClass(callA.toolName);
    const classB = getToolClass(callB.toolName);

    // 检查冲突矩阵
    if (DefaultConflictMatrix[classA]?.[classB] === true) {
      return true;
    }

    // 相同工具名操作同一目标视为冲突
    if (callA.toolName === callB.toolName) {
      const targetA = this.getTargetKey(callA);
      const targetB = this.getTargetKey(callB);
      if (targetA !== null && targetB !== null && targetA === targetB) {
        return true;
      }
    }

    return false;
  }

  /**
   * 提取工具调用的目标标识（如坐标、物品名等）
   */
  private getTargetKey(call: ToolCallContent): string | null {
    const args = call.arguments;
    // 根据工具名判断目标字段
    if (args.x !== undefined && args.z !== undefined) {
      return `pos:${args.x},${args.y ?? 0},${args.z}`;
    }
    if (args.item_name || args.item) {
      return `item:${args.item_name ?? args.item}`;
    }
    if (args.entity_name || args.entity) {
      return `entity:${args.entity_name ?? args.entity}`;
    }
    if (args.block_name || args.block) {
      return `block:${args.block_name ?? args.block}`;
    }
    if (args.slot !== undefined) {
      return `slot:${args.slot}`;
    }
    return null;
  }

  /**
   * 检测循环依赖
   * @throws Error 当检测到循环依赖时
   */
  private detectCycle(dependencies: Set<number>[], calls: ToolCallContent[]): void {
    const n = dependencies.length;
    const visited = new Array(n).fill(false);
    const inStack = new Array(n).fill(false);

    const dfs = (node: number, path: number[]): boolean => {
      visited[node] = true;
      inStack[node] = true;
      path.push(node);

      for (const dep of dependencies[node]) {
        if (!visited[dep]) {
          if (dfs(dep, path)) return true;
        } else if (inStack[dep]) {
          // 找到循环依赖
          const cycleStart = path.indexOf(dep);
          const cycle = path.slice(cycleStart).map((idx) => calls[idx].toolName);
          throw new Error(`循环依赖检测: ${cycle.join(' → ')}`);
        }
      }

      path.pop();
      inStack[node] = false;
      return false;
    };

    for (let i = 0; i < n; i++) {
      if (!visited[i]) {
        try {
          dfs(i, []);
        } catch (e) {
          throw e; // 重新抛出循环依赖错误
        }
      }
    }
  }
}