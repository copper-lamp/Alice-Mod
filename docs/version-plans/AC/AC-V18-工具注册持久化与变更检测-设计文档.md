# Alice Mod Core V18 — 工具注册持久化与变更检测

> 版本：v1.0
> 日期：2026-07-15
> 版本号：V18
> 关联文档：[AC-V16-智能体创建向导-需求文档.md](AC-V16-智能体创建向导-需求文档.md)、[AC-V3-工具系统.md](AC-V3-工具系统.md)

---

## 第1章 概述

### 1.1 问题分析

当前工具注册流程存在两个问题：

**问题1：工具列表无持久化，AC 重启后丢失**

```
当前流程：
  模组上线 → register_tools 通知 → ToolRegistry（内存） → 可用
  模组离线 → ToolRegistry（内存保留）→ 当前会话可用
  AC 重启 → ToolRegistry 清空 → 工具不可用
  （即使模组仍在线，也需要等模组重新发送 register_tools）
```

**问题2：每次 register_tools 都全量覆写，无变更检测**

```
当前行为：
  每次收到 register_tools → 不比较差异 → 直接覆写
  即使工具定义完全一样 → 仍然全量替换
  频繁触发事件通知和序列化
```

### 1.2 目标

| 目标 | 说明 |
|------|------|
| 工具持久化 | 工具列表存入 SQLite，AC 重启后仍可读取 |
| 离线可读 | 模组离线时 AC 能读取上次注册的工具列表 |
| 变更检测 | 通过内容 hash 判断工具是否变更，避免无效覆写 |
| 分级查询 | `tool:list-all` 优先返回内存中的最新数据，fallback 到 SQLite |

### 1.3 核心设计

```
模组上线 → register_tools
              │
              ▼
    计算 tools hash  ←─────────┐
              │                 │
        hash 变更？──否──→ 跳过覆写
              │
              是
              │
              ▼
    更新 ToolRegistry（内存）
    写入 tool_registry 表（SQLite）
    触发 ToolsUpdated 事件
```

---

## 第2章 架构设计

### 2.1 数据流

```
┌─────────────────────────────────────────────────────────────────────┐
│                          register_tools 通知                         │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    WorkspaceManager.registerTools()                   │
│                                                                     │
│  1. 计算工具列表的 SHA-256 hash                                      │
│  2. 与上次存储的 hash 比较                                           │
│  3. 无变更 → 跳过（仍返回 success）                                 │
│  4. 有变更 → 更新内存 + 写入 SQLite                                  │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
          ┌─────────────────┴─────────────────┐
          ▼                                   ▼
┌──────────────────┐              ┌──────────────────────┐
│  ToolRegistry    │              │  tool_registry 表    │
│  (内存 Map)      │              │  (SQLite 持久化)     │
│                  │              │                      │
│  工作区 ID → 工具 │              │  workspace_id TEXT   │
│  工具名称 → 工具  │              │  tool_json TEXT      │
│                  │              │  tool_hash TEXT      │
│  最快查询         │              │  updated_at INTEGER  │
└──────────────────┘              └──────────────────────┘
        │                                  │
        │                                  │
        ▼                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          IPC: tool:list-all                          │
│                                                                     │
│  1. 查询 ToolRegistry（内存）→ 有数据直接返回                        │
│  2. 内存无数据 → 查询 tool_registry 表 → 返回持久化数据             │
│  3. 两者都无 → 返回空列表                                            │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 SQLite 表结构

```sql
CREATE TABLE IF NOT EXISTS tool_registry (
  workspace_id TEXT PRIMARY KEY,
  tool_hash TEXT NOT NULL,
  tool_json TEXT NOT NULL,
  tool_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
```

### 2.3 文件变更

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/main/workspace/tool-registry.ts` | 修改 | 新增 hash 变更检测、持久化方法 |
| `src/main/workspace/workspace-manager.ts` | 修改 | `registerTools()` 调用 hash 检测 |
| `src/main/ipc/tool-handler.ts` | 修改 | 实现 `tool:list-all` 查询逻辑 |
| `src/main/database/database-manager.ts` | 修改 | 新增 `tool_registry` 表 |

### 2.4 新增/修改类型

```typescript
// 在 ToolRegistry 中新增
interface ToolRegistryEntry {
  workspaceId: string
  tools: ToolSchema[]
  hash: string
  updatedAt: number
}
```

---

## 第3章 核心实现

### 3.1 变更检测：hash 计算

```typescript
import { createHash } from 'node:crypto'

function computeToolsHash(tools: ToolSchema[]): string {
  // 按工具名排序确保顺序稳定
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name))
  const json = JSON.stringify(sorted)
  return createHash('sha256').update(json).digest('hex').slice(0, 16)
}
```

### 3.2 ToolRegistry 扩展

```typescript
export class ToolRegistry {
  private readonly registry: Map<string, ToolSchema[]> = new Map()
  private readonly hashes: Map<string, string> = new Map()  // workspaceId → hash

  register(workspaceId: string, tools: ToolSchema[]): boolean {
    const newHash = computeToolsHash(tools)
    const oldHash = this.hashes.get(workspaceId)
    
    // 无变更则跳过
    if (oldHash === newHash) return false
    
    this.registry.set(workspaceId, [...tools])
    this.hashes.set(workspaceId, newHash)
    return true  // 表示有变更
  }

  getTools(workspaceId: string): ToolSchema[] { ... }
  
  getHash(workspaceId: string): string | undefined {
    return this.hashes.get(workspaceId)
  }
}
```

### 3.3 WorkspaceManager.registerTools 修改

```typescript
registerTools(workspaceId: string, tools: ToolSchema[]): boolean {
  const workspace = this.workspaces.get(workspaceId)
  if (!workspace) return false

  const allTools = [...tools, ...WIKI_TOOL_SCHEMAS, ...SEARCH_TOOL_SCHEMAS]
  
  // hash 检测：无变更则不更新
  const changed = this.toolRegistry.register(workspaceId, allTools)
  if (!changed) return true  // 无变更，跳过后续操作
  
  workspace.updateTools(allTools)
  
  // 持久化到 SQLite
  this.persistTools(workspaceId, allTools)
  
  this.emitEvent(WorkspaceEvent.ToolsUpdated, workspaceId, workspace.instanceId, {
    toolCount: allTools.length,
  })
  
  return true
}

private persistTools(workspaceId: string, tools: ToolSchema[]): void {
  try {
    const db = getDatabaseManager().getDb()
    const hash = this.toolRegistry.getHash(workspaceId) ?? ''
    db.prepare(`
      INSERT OR REPLACE INTO tool_registry (workspace_id, tool_hash, tool_json, tool_count, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(workspaceId, hash, JSON.stringify(tools), tools.length, Date.now())
  } catch (err) {
    console.error('[WorkspaceManager] 持久化工具列表失败:', err)
  }
}
```

### 3.4 tool:list-all IPC 实现

```typescript
export function registerToolHandlers(): void {
  ipcMain.handle('tool:list-all', async () => {
    const wm = getWorkspaceManager()
    const toolRegistry = wm.getToolRegistry()
    const allTools = toolRegistry.getAll()
    
    // 如果内存中有数据，直接从内存返回
    if (allTools.size > 0) {
      return flattenTools(allTools)
    }
    
    // 内存无数据，从 SQLite 恢复
    try {
      const db = getDatabaseManager().getDb()
      const rows = db.prepare('SELECT * FROM tool_registry ORDER BY updated_at DESC').all() as Array<{
        tool_json: string
      }>
      if (rows.length > 0) {
        // 恢复所有工作区的工具到内存
        for (const row of rows) {
          const tools = JSON.parse(row.tool_json) as ToolSchema[]
          // 重新注册到内存
        }
        return rows.flatMap(row => JSON.parse(row.tool_json))
      }
    } catch { /* 忽略 */ }
    
    return []
  })
}
```

### 3.5 启动恢复流程

应用启动时：

```
AC 启动
  ├─ DatabaseManager.init() → 建 tool_registry 表
  ├─ 加载工作区（从 workspace_meta）
  └─ tool:list-all 首次调用
       ├─ 尝试 ToolRegistry（内存）→ 空
       └─ 尝试 tool_registry（SQLite）→ 恢复数据到内存
```

---

## 第4章 边界与风险

| 场景 | 处理方式 |
|------|----------|
| 模组离线，SQLite 有旧工具 | 返回 SQLite 中的工具列表，可正常配置 |
| 模组上线，工具无变更 | hash 相同，跳过覆写，效率提升 |
| 模组上线，工具有变更 | hash 不同，更新内存 + SQLite |
| 多个工作区各自注册工具 | 按 workspace_id 隔离存储 |
| SQLite 写入失败 | 内存仍然更新，仅持久化失败（保功能） |
| 首次安装无数据 | 返回空列表，引导用户连接模组 |

---

## 第5章 验证清单

| # | 验证项 | 预期 |
|---|--------|------|
| 1 | 模组上线注册工具，SQLite 出现对应记录 | ✅ / ❌ |
| 2 | 同批工具重复注册，hash 不变，不重复写入 | ✅ / ❌ |
| 3 | 模组离线后重启 AC，`tool:list-all` 仍可获取工具 | ✅ / ❌ |
| 4 | 模组修改工具定义后重新注册，hash 变更，数据更新 | ✅ / ❌ |
| 5 | 多工作区工具隔离，互不干扰 | ✅ / ❌ |
| 6 | 无数据时返回空列表，不报错 | ✅ / ❌ |
