/**
 * aim_list — 目标任务列表工具
 *
 * 列出所有目标任务，支持按类型（main/side）和状态（active/completed/abandoned）过滤。
 * 任务数据存储在 SQLite 中。
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared';
import { ToolCategory } from '@mcagent/shared';
import type { MemoryManager } from '../memory-manager';

// ════════════════════════════════════════════════════════════════
// Schema
// ════════════════════════════════════════════════════════════════

export const AIM_LIST_TOOL: ToolSchema = {
  name: 'aim_list',
  description: '列出所有目标任务（主线/支线），支持按类型和状态过滤。AI 在无用户指令时，会自动查看并推进 aim 任务',
  category: ToolCategory.Aim,
  parameters: {
    type: {
      type: 'string',
      description: '过滤类型：main（主线任务）| side（支线任务），不传则列出全部',
      required: false,
      enum: ['main', 'side'],
    },
    status: {
      type: 'string',
      description: '过滤状态：active（进行中）| completed（已完成）| abandoned（已放弃），不传则列出全部',
      required: false,
      enum: ['active', 'completed', 'abandoned'],
    },
  },
};

// ════════════════════════════════════════════════════════════════
// 执行函数
// ════════════════════════════════════════════════════════════════

/**
 * 从 SQLite 获取 aim 任务的函数
 * 使用 manager 的 sqlite 存储直接查询
 */
function getAimTasksFromDb(
  manager: MemoryManager,
  params: { type?: string; status?: string },
): any[] {
  try {
    const db = (manager as any).sqlite?.db;
    if (!db) return [];

    let sql = 'SELECT * FROM aim_tasks WHERE 1=1';
    const bindings: any[] = [];

    if (params.type) {
      sql += ' AND type = ?';
      bindings.push(params.type);
    }
    if (params.status) {
      sql += ' AND status = ?';
      bindings.push(params.status);
    }
    sql += ' ORDER BY created_at DESC';

    const rows = db.prepare(sql).all(...bindings) as any[];
    return rows.map((row: any) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      description: row.description,
      progress: row.progress,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  } catch {
    return [];
  }
}

/**
 * 获取 aim 子任务列表
 */
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

export async function aimList(
  manager: MemoryManager,
  params: {
    type?: string;
    status?: string;
  },
): Promise<ToolResult<{ tasks: Array<{
  id: string;
  type: string;
  title: string;
  description: string;
  items: Array<{ id: string; content: string; done: boolean }>;
  progress: number;
  status: string;
  createdAt: number;
  updatedAt: number;
}> }>> {
  const start = Date.now();
  try {
    const tasks = getAimTasksFromDb(manager, params);

    // 为每个任务加载子任务列表
    const tasksWithItems = tasks.map((task: any) => ({
      ...task,
      items: getAimItemsFromDb(manager, task.id),
    }));

    return {
      success: true,
      data: { tasks: tasksWithItems },
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      error: `任务列表查询失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    };
  }
}