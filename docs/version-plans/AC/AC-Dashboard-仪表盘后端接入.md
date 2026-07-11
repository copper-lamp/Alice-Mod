# Alice Mod Core — 仪表盘后端接入

> 版本：v1.0
> 日期：2026-07-11
> 对应需求：AC-UI-01（仪表盘）
> 关联文档：[AC-01-需求文档.md](AC-01-需求文档.md)、[AC-V8-主控制面板与游戏状态面板.md](AC-V8-主控制面板与游戏状态面板.md)、[AC-V7-UI界面.md](AC-V7-UI界面.md)

***

## 第一部分：需求文档

### 1.1 模块定位

仪表盘是 Agent Core 桌面应用的第一个可视化面板。用户启动应用后默认进入仪表盘界面，获得系统运行状态的全貌。

**核心职责**：

| 职责 | 说明 |
|------|------|
| **Token 用量概览** | 以数字卡片展示今日/本月/总计 Token 消耗 |
| **Provider 分布** | 饼图展示各 LLM Provider 的 Token 用量占比 |
| **模型调用排行** | 条状图展示各模型的 Token 消耗和调用次数 |
| **Token 日趋势** | 柱状图展示最近 7 天的每日 Token 消耗 |
| **连接概览** | 当前活跃 TCP 连接数、智能体总数/在线数 |
| **智能体活跃时段** | 热力图展示各工作区 24h 活跃度分布 |

### 1.2 技术决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| **数据聚合方式** | 主进程 IPC Handler 内聚合 | 避免渲染进程直接访问数据库，保持前后端分离 |
| **观测数据源** | `DefaultLLMObserver` + `SqliteObserverStore` | 已有模块，统一管理 LLM 调用记录 |
| **工作区数据源** | `WorkspaceManager` | 已有模块，提供实时在线/离线状态 |
| **历史数据回退** | `query()` 方法自动回退 SQLite | 进程重启后仍可读取持久化记录 |

### 1.3 数据流

```
渲染进程 (DashboardPanel)
  │  useEffect on mount
  │  ├─ fetchStats()           → IPC invoke('dashboard:stats')
  │  ├─ fetchUsageHistory(7)   → IPC invoke('dashboard:usage-history', { days: 7 })
  │  └─ fetchActivity()        → IPC invoke('dashboard:agent-activity')
  ▼
Zustand dashboardStore
  │  更新 stats / dailyUsage / activityData
  ▼
IPC Main Process
  │  dashboard-handler.ts
  │  ├─ getLLMObserver()       → LLM Call Records 聚合
  │  ├─ getWorkspaceManager()  → 工作区在线/总数
  │  └─ 计算: 今日/本月/总计 Token, Provider 分布, 模型排行, 日趋势
  ▼
数据源
  ├─ SqliteObserverStore       → llm_call_records 表 (SQLite 持久化)
  ├─ WorkspaceManager          → 内存中 runtime 状态
  └─ WorkspaceStore            → workspace_meta 表 (SQLite 持久化)
```

***

## 第二部分：架构文档

### 2.1 新增模块关系

```
src/main/llm/observer/
├── llm-observer.ts            ← 新增: getLLMObserver() / setLLMObserver() 全局单例
├── sqlite-observer-store.ts   ← 已有: 提供 SQLite 持久化 + 内存缓存双存储
└── observer-store.ts          ← 已有: IObserverStore 接口

src/main/ipc/
└── dashboard-handler.ts       ← 重写: 从 mock 改为真实数据聚合

src/main/index.ts              ← 修改: 初始化 LLM Observer (SqliteObserverStore)

src/renderer/src/
├── stores/dashboardStore.ts   ← 已有: Zustand store，对接 IPC
├── components/dashboard/
│   └── DashboardPanel.tsx     ← 修改: 添加 useEffect 数据加载
└── lib/types.ts               ← 已有: DashboardStats / DailyUsage / ActivityData
```

### 2.2 IPC 通信协议

| Channel | 方向 | 用途 | 请求参数 | 返回值 |
|---------|:----:|------|----------|--------|
| `dashboard:stats` | R→M | 获取仪表盘统计 | 无 | `DashboardStats` |
| `dashboard:usage-history` | R→M | 获取用量历史 | `{ days: 7 }` | `DailyUsage[]` |
| `dashboard:agent-activity` | R→M | 获取活跃时段 | 无 | `ActivityData[]` |

### 2.3 关键类型定义

```typescript
// 前端类型 (src/renderer/src/lib/types.ts)

interface DashboardStats {
  todayTokens: number          // 今日 Token 消耗
  monthTokens: number          // 本月 Token 消耗
  totalTokens: number          // 总计 Token 消耗
  activeConnections: number    // 当前活跃连接数
  totalAgents: number          // 智能体总数
  onlineAgents: number         // 在线智能体数
  providerDistribution: ProviderUsage[]  // Provider 用量分布
  topModels: ModelUsage[]      // 模型调用排行
}

interface ProviderUsage {
  providerId: string
  providerName: string
  tokenCount: number
  percentage: number
  callCount: number
}

interface ModelUsage {
  modelId: string
  modelName: string
  providerId: string
  tokenCount: number
  callCount: number
}

interface DailyUsage {
  date: string                 // YYYY-MM-DD
  tokens: number
  callCount: number
}

interface ActivityData {
  workspaceId: string
  workspaceName: string
  hourlyActivity: number[]     // 24h 活跃度 [0..23]
  dailyActivity: number[]      // 7 天活跃度 [0..6]
}
```

### 2.4 数据聚合算法

#### Token 统计

```
输入: 所有 LLM Call Records (最近 5000 条)
步骤:
  1. 按时间戳过滤出今日/本月/全部三条记录子集
  2. 分别累加各子集的 totalTokens
输出: todayTokens, monthTokens, totalTokens
```

#### Provider 分布

```
输入: 所有 LLM Call Records
步骤:
  1. 按 providerId 分组
  2. 每组统计: tokenCount(累加), callCount(计数), percentage(tokenCount/total)
  3. 按 tokenCount 降序排列
输出: ProviderUsage[]
```

#### 模型排行

```
输入: 所有 LLM Call Records
步骤:
  1. 按 model 分组
  2. 每组统计: tokenCount(累加), callCount(计数)
  3. 按 tokenCount 降序排列, 取前 10
输出: ModelUsage[]
```

#### 日趋势

```
输入: days 参数 (默认 7)
步骤:
  1. 生成过去 N 天的日期列表 (YYYY-MM-DD)
  2. 遍历所有记录，按 formatDate(timestamp) 分组
  3. 每组统计: tokens(累加), callCount(计数)
输出: DailyUsage[] (每天一条)
```

#### 活跃时段

```
输入: 所有工作区
步骤:
  1. 遍历每个工作区
  2. 根据当前小时的在线状态和 lastOnlineAt 计算 24h 活跃度
  3. 根据 lastOnlineAt 计算 7 天活跃度
输出: ActivityData[]
```

***

## 第三部分：执行文档

### 3.1 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/llm/observer/llm-observer.ts` | 修改 | 添加全局单例 `getLLMObserver`/`setLLMObserver` |
| `src/main/llm/index.ts` | 修改 | 导出 `getLLMObserver`/`setLLMObserver` |
| `src/main/index.ts` | 修改 | 初始化阶段创建 `DefaultLLMObserver(SqliteObserverStore)` |
| `src/main/ipc/dashboard-handler.ts` | 重写 | 从 mock 数据改为 LLM Observer + WorkspaceManager 真实聚合 |
| `src/renderer/src/components/dashboard/DashboardPanel.tsx` | 修改 | 添加 `useEffect` 触发数据加载 |

### 3.2 全局 LLM Observer 单例

```typescript
// src/main/llm/observer/llm-observer.ts 末尾追加

let observerInstance: DefaultLLMObserver | null = null

export function getLLMObserver(): DefaultLLMObserver {
  if (!observerInstance) {
    observerInstance = new DefaultLLMObserver()
  }
  return observerInstance
}

export function setLLMObserver(observer: DefaultLLMObserver): void {
  observerInstance = observer
}

export function resetLLMObserver(): void {
  observerInstance = null
}
```

### 3.3 主进程初始化

```typescript
// src/main/index.ts — 在 initializeServices() 中

// 1.5 初始化 LLM 调用观测器（持久化到 SQLite）
const observer = new DefaultLLMObserver(new SqliteObserverStore())
setLLMObserver(observer)
```

### 3.4 前端 DashboardPanel 数据加载

```typescript
// src/renderer/src/components/dashboard/DashboardPanel.tsx

const DashboardPanel: React.FC = () => {
  const { stats, dailyUsage, activityData, loading, fetchStats, fetchUsageHistory, fetchActivity } = useDashboardStore()

  useEffect(() => {
    fetchStats()           // 面板激活时立即加载统计
    fetchUsageHistory(7)   // 加载最近 7 天趋势
    fetchActivity()        // 加载活跃时段数据
  }, [fetchStats, fetchUsageHistory, fetchActivity])
  // ...
}
```

### 3.5 开发顺序

| 步骤 | 内容 | 验证方式 |
|:----:|------|----------|
| 1 | 添加 LLM Observer 单例 getter/setter | 编译通过 |
| 2 | 主进程初始化时创建并注入 observer | 启动日志可见 `LLM 调用观测器初始化完成` |
| 3 | 重写 dashboard-handler 聚合逻辑 | `npx tsc --noEmit` 无 dashboard-handler 错误 |
| 4 | DashboardPanel 添加 useEffect | 打开仪表盘可看到真实数据/空状态占位 |
| 5 | 端到端验证 | 启动 LLM 调用后，仪表盘 Token 数据实时更新 |

### 3.6 空状态处理

各数据区域在有数据时正常显示，无数据时显示 `暂无数据` 占位：

| 区域 | 空状态显示 | 有数据后 |
|------|-----------|----------|
| Token 用量总览 | `0` 数值 | 实际 Token 数 + 进度条 |
| Token 日趋势 | "暂无数据" | 柱状图 |
| Provider 分布 | "暂无数据" | 环形饼图 + 图例 |
| 模型调用排行 | "暂无数据" | 排行条状图 |
| 连接概览 | `0/0` | 实际数据 |
| 智能体活跃时段 | "暂无数据" | 热力图 |

### 3.7 注意事项

1. **时区处理**：所有时间计算基于 UTC+8（北京时间），与系统时间一致
2. **数据量限制**：`query({ limit: 5000 })` 限制最大查询 5000 条记录，避免大数据量时性能问题
3. **进程重启**：`SqliteObserverStore.query()` 在内存缓存不足时自动回退到 SQLite 查询，确保重启后仍有历史数据
4. **Provider 名称**：从 providerId 自动派生显示名称（首字母大写），配置页设置后可通过 providerId 查询详细名称
5. **活跃度估算**：基于 `lastOnlineAt` 和当前在线状态估算，精确的活跃度需后续通过 `llm_call_records` 的时间分布计算

### 3.8 风险与应对

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| SQLite 中 llm_call_records 表不存在 | 聚合结果全为 0 | `SqliteObserverStore` 的 DDL 在 database-manager 初始化时自动创建 |
| observer 未初始化时调用 | getLLMObserver() 自动创建 MemoryObserverStore 兜底 | DashboardPanel 的 useEffect 在 mount 时触发，此时 observer 已初始化 |
| 大量 LLM 调用记录（>10万） | query 耗时过长 | limit 5000 限制，后续可添加分页/增量加载 |
