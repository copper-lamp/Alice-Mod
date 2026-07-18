# AC-V29 智能体实例控制按钮 — 设计文档

## 1. 概述

### 1.1 目标
为智能体实例页面（AgentInstanceView）添加两个控制功能：
1. **启用/禁用开关** — 控制整个智能体是否响应触发事件
2. **上线/下线按钮** — 控制服务器中的假人（Bot）在线状态

### 1.2 版本历史
| 版本 | 日期 | 作者 | 变更说明 |
|------|------|------|----------|
| v1.0 | 2026-07-18 | - | 初稿 |

---

## 2. 需求

### 2.1 启用/禁用开关
- 在智能体详情页标题栏中，智能体名称右侧添加一个 toggle switch
- 开关状态持久化到 SQLite 数据库
- 禁用时智能体不响应任何触发事件（trigger / QQ 消息等）
- 开关状态在页面上实时反映，无需刷新

### 2.2 上线/下线按钮
- 在智能体详情页标题栏右侧、Tabs 左侧添加一个按钮
- 按钮根据当前假人状态显示"上线"或"下线"
- 点击后通过 TCP 通知 Adapter Core 执行 BotManager.online/offline
- 按钮状态实时反映假人实际在线状态
- 支持状态的定时轮询刷新

---

## 3. 架构设计

### 3.1 数据流

```
┌─────────────────────────────────────────────────────────────┐
│  AgentInstanceView (React)                                   │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  enabled toggle  ──→ agent:set-enabled (IPC)            │ │
│  │  online/offline btn ──→ agent:bot-control (IPC)         │ │
│  │  status polling  ──→ agent:get-status (IPC)             │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC (electron ipcMain)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Agent Core (Main Process)                                   │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  agent-handler.ts                                        │ │
│  │  ├─ agent:set-enabled → AgentConfigManager.update()      │ │
│  │  ├─ agent:bot-control → ConnectionResolver → TCP conn    │ │
│  │  └─ agent:get-status  → (extended with botOnline)        │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │ TCP (JSON-RPC 2.0)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Adapter Core (Bedrock/Java)                                 │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  index.ts                                                │ │
│  │  ├─ bot_control.online  → BotManager.online()            │ │
│  │  ├─ bot_control.offline → BotManager.offline()           │ │
│  │  └─ bot_control.status  → BotManager.get().isOnline()    │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 模块职责

| 层 | 模块 | 职责 |
|----|------|------|
| 前端 | AgentInstanceView.tsx | 渲染启用/禁用开关和上线/下线按钮，处理用户交互 |
| 前端 | agentStore.ts | 管理智能体列表和当前智能体状态 |
| 主进程 | agent-handler.ts | 注册 IPC handler，处理启用/禁用和假人控制请求 |
| 主进程 | connection-resolver.ts | 根据 workspaceId 解析 TCP 连接 |
| 主进程 | agent-config-manager.ts | 持久化智能体配置（含 enabled 字段） |
| 适配器 | index.ts | 处理 bot_control JSON-RPC 请求，调用 BotManager |

---

## 4. 详细设计

### 4.1 数据模型变更

#### 4.1.1 AgentConfig（types.ts）
```typescript
export interface AgentConfig {
  // ... 已有字段
  /** V28：智能体是否启用（默认 true），禁用时不响应任何触发事件 */
  enabled?: boolean
}
```

#### 4.1.2 AgentSummary（types.ts）
```typescript
export interface AgentSummary {
  // ... 已有字段
  enabled: boolean        // V28: 智能体是否启用
  botOnline: boolean      // V28: 假人是否在线
}
```

#### 4.1.3 数据库迁移（database-manager.ts）
```sql
ALTER TABLE agents ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
```
使用 `addColumnIfNotExists` 确保幂等性。

### 4.2 IPC 接口

#### 4.2.1 `agent:set-enabled`
| 项目 | 说明 |
|------|------|
| 方向 | 渲染进程 → 主进程 |
| 参数 | `{ id: string, enabled: boolean }` |
| 返回 | `{ success: boolean }` |
| 行为 | 更新 AgentConfig.enabled，失效 MainAgent 缓存 |

#### 4.2.2 `agent:bot-control`
| 项目 | 说明 |
|------|------|
| 方向 | 渲染进程 → 主进程 → 适配器 |
| 参数 | `{ id: string, action: 'online' \| 'offline' }` |
| 返回 | `{ success: boolean, data?: any, error?: string }` |
| 行为 | 通过 ConnectionResolver 获取 TCP 连接，发送 bot_control 请求 |

#### 4.2.3 `agent:get-status`（扩展）
| 项目 | 说明 |
|------|------|
| 新增字段 | `botOnline: boolean` |
| 行为 | 额外通过 TCP 查询假人上线状态 |

### 4.3 适配器 JSON-RPC 方法

#### `bot_control`
| 项目 | 说明 |
|------|------|
| 方法名 | `bot_control` |
| 参数 | `{ action: 'online' \| 'offline' \| 'status', bot_name: string }` |
| 响应 | `online/offline: { success, message, action, bot_name }` |
|  | `status: { success, online, bot_name }` |
| 行为 | 调用 BotManager.online/offline/get.isOnline |

### 4.4 前端 UI 设计

#### 4.4.1 启用/禁用开关
- 位置：智能体名称右侧
- 样式：使用 `<button role="switch">` 自定义 switch 组件，绿色=启用，灰色=禁用
- 文本：名称下方显示"已启用"/"已禁用"状态文本
- 交互：点击立即切换，调用 `agent:set-enabled` IPC

#### 4.4.2 上线/下线按钮
- 位置：标题栏右侧、Tabs 左侧的操作按钮区域
- 样式：
  - 假人离线时：绿色边框按钮，显示"上线" + Wifi 图标
  - 假人在线时：橙色边框按钮，显示"下线" + WifiOff 图标
- 交互：点击后按钮变为 loading 状态，调用 `agent:bot-control` IPC
- 实时状态：在名称下方显示"假人: 在线/离线"状态指示器

#### 4.4.3 状态轮询
- 每 30 秒通过 `agent:get-status` IPC 刷新状态
- 刷新内容包括：QQ 连接状态、假人上线状态

---

## 5. 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `packages/agent-core/src/renderer/src/lib/types.ts` | 修改 | AgentConfig 添加 enabled 字段；AgentSummary 添加 enabled、botOnline 字段 |
| `packages/agent-core/src/main/database/database-manager.ts` | 修改 | 添加 V28 迁移：agents.enabled 列 |
| `packages/agent-core/src/main/agent/agent-config-manager.ts` | 修改 | list() 返回 enabled/botOnline；saveToDb() 读写 enabled 列；ensureLoaded() 解析 enabled 列 |
| `packages/agent-core/src/main/agent/agent-file-exporter.ts` | 修改 | ExportedAgentConfig 和 toExportedConfig 添加 enabled 字段 |
| `packages/agent-core/src/main/ipc/agent-handler.ts` | 修改 | 添加 agent:set-enabled、agent:bot-control 处理器；扩展 agent:get-status 返回 botOnline |
| `packages/agent-core/src/main/ipc/index.ts` | 修改 | 导出 getConnectionResolver() |
| `packages/agent-core/src/renderer/src/components/agent/AgentInstanceView.tsx` | 修改 | 添加启用/禁用开关和上线/下线按钮 UI 及交互逻辑 |
| `packages/adapter-bedrock/src/index.ts` | 修改 | _BotManager 提升为模块级变量；添加 bot_control JSON-RPC 方法处理器 |

---

## 6. 验收清单

### 6.1 启用/禁用开关
- [x] 开关在智能体名称右侧显示
- [x] 点击切换启用/禁用状态
- [x] 状态持久化到 SQLite
- [x] 页面刷新后状态正确恢复
- [x] 禁用状态在 UI 上清晰可见（灰色文字提示）

### 6.2 上线/下线按钮
- [x] 按钮根据假人状态显示对应文案和颜色
- [x] 点击上线按钮后假人进入服务器
- [x] 点击下线按钮后假人离开服务器
- [x] 按钮在操作过程中显示 loading 状态
- [x] 状态指示器显示假人当前在线状态
- [x] 状态轮询每 30 秒刷新

### 6.3 兼容性
- [x] 存量数据（无 enabled 列）自动视为启用
- [x] 适配器不支持 bot_control 时优雅降级
- [x] 连接未就绪时 botOnline 默认为 false
- [x] TypeScript 编译零错误