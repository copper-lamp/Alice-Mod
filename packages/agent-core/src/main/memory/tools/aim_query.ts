/**
 * aim_query — 目标任务详情查询工具
 *
 * 查询指定任务的详细内容和进度，包括子任务列表。
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared';
import { ToolCategory } from '@mcagent/shared';
import type { MemoryManager } from '../memory-manager';

// ════════════════════════════════════════════════════════════════
// Schema
// ════════════════════════════════════════════════════════════════

export const AIM_QUERY_TOOL: ToolSchema = {
  name: 'aim_query',
  description: '查询指定目标任务的详细内容和进度，包括所有子任务项及完成状态',
  category: ToolCategory.Aim,
  parameters: {
    id: {
      type: 'string',
      description: '任务 ID',
      required: true,
    },
  },
};

// ════════════════════════════════════════════════════════════════
// 执行函数
// ════════════════════════════════════════════════════════════════

function getAimTaskFromDb(manager: MemoryManager, id: string): any | null {
  try {
    const db = (manager as any).sqlite?.db;
    if (!db) return null;

    const row = db.prepare('SELECT * FROM aim_tasks WHERE id = ?').get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      type: row.type,
      title: row.title,
      description: row.description,
      progress: row.progress,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

function getAimItemsFromDb(manager: MemoryManager, taskId: string): any[] {
  try {
    const db = (manager as any).sqlite?.db;
    if (!db) return [];

    const rows = db.prepare(
      'SELECT * FROM aim_items WHERE task_id = ? ORDER BY sort_order ASC'
    ).all(taskId) as any[];

    return rows.map((row: any) => ({
      id: row.id,
      content: row.content,
      done: row.done === 1,
    }));
  } catch {
    return [];
  }
}

export async function aimQuery(
  manager: MemoryManager,
  params: { id: string },
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
    const task = getAimTaskFromDb(manager, params.id);
    if (!task) {
      return {
        success: false,
        error: `任务 ${params.id} 不存在`,
        duration: Date.now() - start,
      };
    }

    task.items = getAimItemsFromDb(manager, params.id);

    return {
      success: true,
      data: { task },
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      error: `任务查询失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    };
  }
}