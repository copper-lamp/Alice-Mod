/**
 * aim_update — 目标任务进度更新工具
 *
 * 更新指定子任务的完成状态。勾选后自动重新计算进度百分比，
 * 当所有子任务完成时自动将任务状态设为 completed。
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared';
import { ToolCategory } from '@mcagent/shared';
import type { MemoryManager } from '../memory-manager';

// ════════════════════════════════════════════════════════════════
// Schema
// ════════════════════════════════════════════════════════════════

export const AIM_UPDATE_TOOL: ToolSchema = {
  name: 'aim_update',
  description: '更新目标任务进度。勾选/取消勾选子任务完成状态，系统自动重新计算进度百分比',
  category: ToolCategory.Aim,
  parameters: {
    id: {
      type: 'string',
      description: '任务 ID',
      required: true,
    },
    item_id: {
      type: 'string',
      description: '子任务项 ID',
      required: true,
    },
    done: {
      type: 'boolean',
      description: '是否已完成：true=已完成, false=未完成',
      required: true,
    },
  },
};

// ════════════════════════════════════════════════════════════════
// 执行函数
// ════════════════════════════════════════════════════════════════

export async function aimUpdate(
  manager: MemoryManager,
  params: { id: string; item_id: string; done: boolean },
): Promise<ToolResult<{ task: {
  id: string;
  type: string;
  title: string;
  description: string;
  items: Array<{ id: string; content: string; done: boolean }>;
  progress: number;
  status: string;
  createdAt: number;
  updatedAt: number;
} | null }>> {
  const start = Date.now();
  try {
    const db = (manager as any).sqlite?.db;
    if (!db) {
      return {
        success: false,
        error: '数据库未初始化',
        duration: Date.now() - start,
      };
    }

    // 1. 更新子任务完成状态
    const updateResult = db.prepare(
      'UPDATE aim_items SET done = ? WHERE id = ? AND task_id = ?'
    ).run(params.done ? 1 : 0, params.item_id, params.id);

    if (updateResult.changes === 0) {
      return {
        success: false,
        error: `子任务 ${params.item_id} 不存在或不属于任务 ${params.id}`,
        duration: Date.now() - start,
      };
    }

    // 2. 重新计算进度
    const stats = db.prepare(
      'SELECT COUNT(*) as total, SUM(done) as completed FROM aim_items WHERE task_id = ?'
    ).get(params.id) as any;

    const total = stats.total as number;
    const completed = (stats.completed as number) ?? 0;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 100;

    // 3. 判断是否全部完成
    const status = completed === total ? 'completed' : 'active';

    // 4. 更新任务表
    const now = Date.now();
    db.prepare(
      'UPDATE aim_tasks SET progress = ?, status = ?, updated_at = ? WHERE id = ?'
    ).run(progress, status, now, params.id);

    // 5. 返回更新后的任务
    const task = db.prepare('SELECT * FROM aim_tasks WHERE id = ?').get(params.id) as any;
    if (!task) {
      return {
        success: false,
        error: `任务 ${params.id} 不存在`,
        duration: Date.now() - start,
      };
    }

    const items = db.prepare(
      'SELECT * FROM aim_items WHERE task_id = ? ORDER BY sort_order ASC'
    ).all(params.id) as any[];

    return {
      success: true,
      data: {
        task: {
          id: task.id,
          type: task.type,
          title: task.title,
          description: task.description,
          items: items.map((i: any) => ({ id: i.id, content: i.content, done: i.done === 1 })),
          progress: task.progress,
          status: task.status,
          createdAt: task.created_at,
          updatedAt: task.updated_at,
        },
      },
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      error: `任务进度更新失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    };
  }
}