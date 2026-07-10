# Alice Mod Core V9 — 后端调试模块（工具调用记录器 + 日志系统）

> 版本：v1.0
> 日期：2026-07-10
> 版本号：V9（第 11 周）
> 对应需求：AC-UI-06、AC-LOG-01、AC-LOG-02、AC-LOG-03、AC-LOG-04
> 关联文档：[AC-01-需求文档.md](AC-01-需求文档.md)、[AC-02-实施计划.md](AC-02-实施计划.md)、[AC-03-规范与验收标准.md](AC-03-规范与验收标准.md)

***

## 第一部分：需求文档

### 1.1 模块定位

V9 是 Agent Core **后端调试基础设施**的关键版本。本模块**不接入前端 UI**，纯后端运行，为开发者提供调试 Agent 执行过程的能力。它在 V4 Function Calling Pipeline 的事件系统基础上，引入**工具调用记录器**和**全功能日志系统**，所有数据通过文件、控制台、SQLite 三种渠道输出，供开发者离线或实时分析。

**核心职责**：

| 职责 | 说明 |
|------|------|
| **工具调用记录器** | 监听 Pipeline 事件，将每次工具调用的参数、结果、耗时、依赖关系持久化到 SQLite，并输出到日志文件和控制台 |
| **分级日志系统** | 基于级别的日志记录（debug/info/warning/error），支持多路输出（文件 + 控制台 + SQLite）和文件轮转 |
| **结构化日志存储** | 所有日志写入 SQLite logs 表，支持按级别/模块/时间范围检索 |
| **调试数据持久化** | 工具调用记录和日志均持久化到磁盘，支持事后回溯分析，不依赖前端渲染 |

### 1.2 功能需求列表

| 需求 ID | 需求名称 | 优先级 | 实现状态 |
|---------|----------|:------:|:--------:|
| AC-UI-06 | 工具调用记录器（后端调试模块，不接入前端） | P0 | 待实现 |
| AC-LOG-01 | 分级日志（debug / info / warning / error） | P0 | 待实现 |
| AC-LOG-02 | 多路输出（文件 + 控制台 + SQLite） | P0 | 待实现 |
| AC-LOG-03 | 日志轮转（按文件大小自动分割） | P0 | 待实现 |
| AC-LOG-04 | 结构化存储（日志写入 SQLite logs 表） | P1 | 待实现 |

#### AC-UI-06 工具调用记录器（后端调试模块）详细需求

> 注意：AC-UI-06 的命名源自早期版本规划，实际实现为纯后端调试模块，不包含前端 UI 面板。

| 子需求 | 说明 |
|--------|------|
| Pipeline 事件监听 | 监听 FunctionCallingPipeline 的 `pipeline:start`、`pipeline:tool-completed`、`pipeline:tool-error` 等事件，自动收集工具调用数据 |
| 调用记录持久化 | 每次工具调用的参数、执行结果、耗时、状态、依赖层级记录到 SQLite `tool_call_records` 表 |
| 调用链树形结构 | 基于依赖分析结果（ExecutionLayer），记录 parentId 字段，支持事后重建调用链树形结构 |
| 调用统计 | 统计每个工作区的工具调用总数、成功率、平均耗时、分类分布、最常调用工具、最近错误 |
| 时间线记录 | 记录每次调用的开始时间戳和完成时间戳，支持事后重建执行时间线 |
| 日志联动 | 工具调用记录中包含 toolCallId，日志系统中的对应日志可通过该 ID 关联查询 |
| 历史保留策略 | 默认保留最近 1000 条记录，超出自动清理最旧记录，保留数量可配置 |

#### AC-LOG-01 分级日志详细需求

| 子需求 | 说明 |
|--------|------|
| 日志级别 | debug / info / warning / error 四级，可通过配置动态调整最低输出级别 |
| 日志格式 | `[时间] [级别] [模块] 消息`，支持结构化元数据附加 |
| 模块标识 | 每个日志来源标明所属模块（TCP / LLM / FCP / WORKSPACE / MEMORY / TASK / QQ / INSTANCE / PROMPT / SYSTEM / GENERAL） |
| 上下文关联 | 支持关联 requestId / workspaceId / toolCallId 等上下文标识，便于调试时溯源 |

#### AC-LOG-02 多路输出详细需求

| 子需求 | 说明 |
|--------|------|
| 文件输出 | 日志写入 `{userData}/logs/` 目录下的 `{date}.log` 文件，文件路径可配置 |
| 控制台输出 | 输出到主进程控制台/stdout，带颜色分级（debug=灰、info=青、warning=黄、error=红） |
| SQLite 输出 | 日志写入 SQLite logs 表，异步批量写入，不阻塞主流程 |
| 级别过滤 | 各路输出可独立配置最低日志级别（如文件输出 info+，控制台 debug+，SQLite 写入 info+） |

#### AC-LOG-03 日志轮转详细需求

| 子需求 | 说明 |
|--------|------|
| 大小触发 | 默认 10MB 触发轮转，可通过配置调整 |
| 文件保留 | 保留最近 5 个轮转文件，自动删除最旧文件 |
| 命名规则 | `app-{YYYY-MM-DD}-{N}.log`，N 为轮转序号 |
| 启动时检查 | 启动时检查当前日志文件大小，超过阈值立即轮转 |

#### AC-LOG-04 结构化存储详细需求

| 子需求 | 说明 |
|--------|------|
| logs 表结构 | 包含 id / timestamp / level / module / message / metadata / request_id / workspace_id / tool_call_id |
| 自动写入 | 每一条日志自动写入 SQLite logs 表，异步写入不阻塞主流程 |
| 批量写入 | 支持批量写入（缓存 50 条或 1s 间隔 flush），减少磁盘 IO |
| 查询接口 | 支持按级别/模块/时间范围/关键词查询日志，分页返回 |

### 1.3 验收标准

| # | 验收条件 | 验证方法 | 测量指标 |
|---|----------|----------|----------|
| 9.1 | 工具调用记录自动收集 | LLM 发起多个工具调用，检查 SQLite 和日志文件 | 每条工具调用都有完整记录（参数/结果/耗时/状态） |
| 9.2 | 调用链层级关系正确 | 记录中检查 parentId 和 level 字段 | 无环依赖，层级关系正确 |
| 9.3 | 工具调用状态正确 | 检查记录中的 status 字段 | pending→running→success/error 状态转换正确 |
| 9.4 | 工具调用统计准确 | 调用统计接口 | 总数/成功/失败/平均耗时计算正确 |
| 9.5 | 日志分级输出 | 设置不同级别观察输出 | debug/info/warning/error 按级别过滤 |
| 9.6 | 多路输出一致性 | 同时检查文件和控制台 | 文件和控制台输出内容一致 |
| 9.7 | 日志文件轮转 | 写入超过 10MB 日志 | 自动分割，保留最近 5 个文件 |
| 9.8 | SQLite 日志存储 | 查询 logs 表 | 日志完整写入，可按条件查询 |
| 9.9 | 异步写入不阻塞 | 高并发写入时观察主流程 | 日志写入不影响 Function Calling 管线执行 |
| 9.10 | 调试数据持久化 | 重启应用后查询历史记录 | 工具调用记录和日志在重启后仍可查询 |

***

## 第二部分：架构文档

### 2.1 整体架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                         V9 后端调试基础设施                              │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    主进程 (Main)                               │  │
│  │                                                               │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │  Pipeline 事件系统                                       │  │  │
│  │  │  FunctionCallingPipeline (EventEmitter)                  │  │  │
│  │  │  emit: pipeline:start / tool-completed / tool-error      │  │  │
│  │  └───────────────────────┬─────────────────────────────────┘  │  │
│  │                           │                                    │  │
│  │                           ▼                                    │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │  PipelineEventCollector (工具调用记录器)                   │  │  │
│  │  │  - 监听 Pipeline 事件                                     │  │  │
│  │  │  - 收集工具调用元数据（参数/结果/耗时/层级）                  │  │  │
│  │  │  - 写入 SQLite tool_call_records 表                       │  │  │
│  │  │  - 输出到日志文件和控制台                                   │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  │                                                               │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │  Logger (单例) — 日志系统                                │  │  │
│  │  │  debug / info / warning / error                         │  │  │
│  │  │                                                         │  │  │
│  │  │  ┌────────────────┐ ┌────────────────┐ ┌─────────────┐  │  │  │
│  │  │  │ ConsoleTransport│ │ FileTransport  │ │ SQLite      │  │  │  │
│  │  │  │ ≤控制台输出      │ │ ≤文件写入+轮转  │ │  Transport  │  │  │  │
│  │  │  │  颜色分级       │ │  10MB分割      │ │ ≤批量写入    │  │  │  │
│  │  │  └────────────────┘ └────────────────┘ └─────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  │                                                               │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │  SQLite 存储层                                          │  │  │
│  │  │  ├── logs 表              → 日志结构化存储               │  │  │
│  │  │  └── tool_call_records 表 → 工具调用记录持久化            │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  **不接入渲染进程 UI**，调试数据通过文件 + 控制台 + SQLite 三种渠道输出    │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 工具调用记录器数据流

```
LLM 响应
  │
  ▼
FunctionCallingPipeline.process()
  │
  ├── emit('pipeline:start', { pipelineId, calls })
  ├── emit('pipeline:tool-completed', { toolCallId, result })
  ├── emit('pipeline:tool-error', { toolCallId, error })
  │
  ▼
PipelineEventCollector (主进程)
  │ 监听 Pipeline 事件
  │ 收集工具调用参数、结果、耗时、层级
  │ 按 workspaceId 缓存（最多 1000 条）
  │
  ├──→ 写入 SQLite tool_call_records 表
  ├──→ 输出到日志文件（console transport）
  └──→ 暴露后端查询 API（getHistory / getStats）
```

### 2.3 日志系统架构

```
┌──────────────────────────────────────────────────────────────────┐
│                        Logger 系统                                 │
│                                                                  │
│  日志来源:                                                       │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐        │
│  │ TCP    │ │ LLM    │ │ FCP    │ │ Workspace│ │ ...    │        │
│  │ Module │ │ Module │ │ Module │ │ Module  │ │ Module │        │
│  └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘        │
│      │          │          │          │          │              │
│      └──────────┴──────────┴──────────┴──────────┘              │
│                           │                                      │
│                           ▼                                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Logger (单例)                           │  │
│  │  - level: LogLevel (最低输出级别)                          │  │
│  │  - debug(msg, meta?) / info(msg, meta?)                   │  │
│  │  - warn(msg, meta?) / error(msg, meta?)                   │  │
│  └───────────────────────┬───────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                  Transport 管道                             │  │
│  │                                                           │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐   │  │
│  │  │ ConsoleTransport│  │ FileTransport  │  │ SQLiteTransport│   │  │
│  │  │ - 控制台输出     │  │ - 文件写入      │  │ - SQLite 写入  │   │  │
│  │  │ - 颜色分级      │  │ - 轮转管理      │  │ - 批量写入     │   │  │
│  │  └──────────────┘  └──────────────┘  └───────────────┘   │  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### 2.4 后端调试 API

V9 模块通过后端 API 暴露调试查询接口，供主进程内部模块或其他后端模块程序化调用，**不接入渲染进程 UI**。

#### 工具调用记录查询 API

| 接口 | 用途 | 请求参数 | 返回值 |
|------|------|----------|--------|
| `getToolCallHistory(workspaceId, limit?)` | 获取工具调用历史 | `workspaceId: string, limit?: number` | `ToolCallRecord[]` |
| `getToolCallStats(workspaceId)` | 获取工具调用统计 | `workspaceId: string` | `ToolCallStats` |
| `getToolCallById(toolCallId)` | 获取单条调用详情 | `toolCallId: string` | `ToolCallRecord \| null` |
| `clearToolCallHistory(workspaceId)` | 清空调用历史 | `workspaceId: string` | `void` |

#### 日志查询 API

| 接口 | 用途 | 请求参数 | 返回值 |
|------|------|----------|--------|
| `queryLogs(query: LogQuery)` | 查询历史日志 | `LogQuery` | `LogQueryResult` |
| `getLogConfig()` | 获取日志配置 | 无 | `LogConfig` |
| `setLogLevel(level: LogLevel)` | 设置日志级别 | `level: LogLevel` | `void` |
| `clearLogs()` | 清空日志 | 无 | `void` |

### 2.5 新增类型定义

```typescript
// ==========================================
// V9 新增类型：工具调用记录器
// ==========================================

/** 工具调用记录（持久化用） */
export interface ToolCallRecord {
  id: string
  pipelineId: string
  workspaceId: string
  toolName: string
  category: string
  params: Record<string, unknown>
  result?: {
    success: boolean
    data?: unknown
    error?: string
    duration_ms: number
  }
  status: 'pending' | 'running' | 'success' | 'error'
  level: number           // 依赖层级（0 = 根）
  parentId?: string       // 父调用 ID（依赖分析结果）
  timestamp: number
  completedAt?: number
}

/** 工具调用事件（IPC 推送） */
export interface ToolCallEvent {
  type: 'start' | 'complete' | 'error'
  record: ToolCallRecord
}

/** 工具调用统计 */
export interface ToolCallStats {
  totalCalls: number
  successCount: number
  failCount: number
  runningCount: number
  avgDurationMs: number
  categoryBreakdown: Record<string, number>
  topCalled: { toolName: string; count: number }[]
  recentErrors: { toolName: string; error: string; timestamp: number }[]
}

// ==========================================
// V9 新增类型：日志系统
// ==========================================

/** 日志级别 */
export type LogLevel = 'debug' | 'info' | 'warning' | 'error'

/** 日志模块 */
export type LogModule =
  | 'TCP' | 'LLM' | 'FCP' | 'WORKSPACE' | 'MEMORY'
  | 'TASK' | 'QQ' | 'INSTANCE' | 'PROMPT'
  | 'PIPELINE' | 'SYSTEM' | 'GENERAL'

/** 日志条目 */
export interface LogEntry {
  id: number
  timestamp: number
  level: LogLevel
  module: LogModule
  message: string
  metadata?: Record<string, unknown>
  requestId?: string
  workspaceId?: string
  toolCallId?: string
  stack?: string
}

/** 日志配置 */
export interface LogConfig {
  level: LogLevel
  fileLevel: LogLevel
  consoleLevel: LogLevel
  sqliteLevel: LogLevel
  fileMaxSize: number    // 字节，默认 10MB
  fileMaxCount: number   // 保留文件数，默认 5
  fileDir: string
  batchSize: number      // SQLite 批量写入条数，默认 50
  batchIntervalMs: number // 批量写入间隔，默认 1000ms
}

/** 日志查询参数 */
export interface LogQuery {
  level?: LogLevel
  module?: LogModule
  keyword?: string
  startTime?: number
  endTime?: number
  workspaceId?: string
  toolCallId?: string
  offset?: number
  limit?: number
}

/** 日志查询结果 */
export interface LogQueryResult {
  entries: LogEntry[]
  total: number
  hasMore: boolean
}
```

### 2.6 后端模块目录结构

#### 2.6.1 新增/修改文件

```
packages/agent-core/src/main/
├── log/                                ← 新增: 日志系统
│   ├── index.ts                        # 模块入口，初始化所有 Transport
│   ├── types.ts                        # V9 类型定义
│   ├── logger.ts                       # Logger 单例（核心类）
│   ├── console-transport.ts            # 控制台输出 Transport
│   ├── file-transport.ts               # 文件输出 Transport（含轮转）
│   └── sqlite-transport.ts             # SQLite 写入 Transport（批量）
│
├── tool-call/                          ← 新增: 工具调用记录器
│   ├── index.ts                        # 模块入口
│   ├── types.ts                        # 工具调用相关类型
│   ├── pipeline-event-collector.ts     # Pipeline 事件监听器
│   └── tool-call-repository.ts         # SQLite 读写层
│
├── ipc/
│   ├── index.ts                        ← 修改: 注册 V9 handler
│   ├── log-handler.ts                  ← 新增: 日志查询 IPC
│   └── tool-call-handler.ts            ← 新增: 工具调用查询 IPC
│
└── database/
    └── schema.ts                       ← 修改: 添加 logs + tool_call_records 表
```

### 2.7 与已有模块的集成

| 已有模块 | 集成方式 |
|----------|----------|
| V4 Function Calling Pipeline | `PipelineEventCollector` 监听 `PipelineEvent` 事件，收集工具调用数据 |
| V6 已有数据库层 | 复用 SQLite 连接，新增 logs 和 tool_call_records 表 |
| 主进程 IPC 注册 | 在 `registerAllIpcHandlers()` 中注册 log-handler 和 tool-call-handler |

***

## 第三部分：执行文档

### 3.1 主进程模块实现

#### 3.1.1 日志系统核心

```typescript
// src/main/log/logger.ts
import { EventEmitter } from 'node:events'
import type { LogLevel, LogModule, LogEntry, LogConfig } from './types'

export type Transport = (entry: LogEntry) => void | Promise<void>

export class Logger extends EventEmitter {
  private static instance: Logger
  private transports: Transport[] = []
  private config: LogConfig

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger()
    }
    return Logger.instance
  }

  configure(config: Partial<LogConfig>): void {
    this.config = { ...this.config, ...config }
  }

  addTransport(transport: Transport): void {
    this.transports.push(transport)
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warning', 'error']
    return levels.indexOf(level) >= levels.indexOf(this.config.level)
  }

  private createEntry(level: LogLevel, module: LogModule, message: string, meta?: Record<string, unknown>): LogEntry {
    return {
      id: Date.now() + Math.random(),
      timestamp: Date.now(),
      level,
      module,
      message,
      metadata: meta,
      requestId: meta?.requestId as string | undefined,
      workspaceId: meta?.workspaceId as string | undefined,
      toolCallId: meta?.toolCallId as string | undefined,
    }
  }

  private async log(level: LogLevel, module: LogModule, message: string, meta?: Record<string, unknown>): Promise<void> {
    if (!this.shouldLog(level)) return
    const entry = this.createEntry(level, module, message, meta)
    this.emit('log', entry)
    await Promise.all(this.transports.map(t => t(entry)))
  }

  debug(module: LogModule, message: string, meta?: Record<string, unknown>): void {
    this.log('debug', module, message, meta)
  }

  info(module: LogModule, message: string, meta?: Record<string, unknown>): void {
    this.log('info', module, message, meta)
  }

  warn(module: LogModule, message: string, meta?: Record<string, unknown>): void {
    this.log('warning', module, message, meta)
  }

  error(module: LogModule, message: string, meta?: Record<string, unknown>): void {
    this.log('error', module, message, meta)
  }
}
```

```typescript
// src/main/log/transports.ts
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { LogEntry, LogConfig, LogLevel } from './types'

/** 控制台输出 Transport */
export function createConsoleTransport(config: LogConfig): (entry: LogEntry) => void {
  const levelColors: Record<string, string> = {
    debug: '\x1b[90m',     // 灰色
    info: '\x1b[36m',      // 青色
    warning: '\x1b[33m',   // 黄色
    error: '\x1b[31m',     // 红色
  }
  const reset = '\x1b[0m'

  return (entry: LogEntry) => {
    const levels: LogLevel[] = ['debug', 'info', 'warning', 'error']
    if (levels.indexOf(entry.level) < levels.indexOf(config.consoleLevel)) return

    const color = levelColors[entry.level] || ''
    const time = new Date(entry.timestamp).toISOString().slice(11, 19)
    const module = entry.module.padEnd(10)
    console.log(`${color}[${time}] [${entry.level.toUpperCase()}] [${module}] ${entry.message}${reset}`)
  }
}

/** 文件输出 Transport */
export function createFileTransport(config: LogConfig): (entry: LogEntry) => void {
  const logDir = config.fileDir || path.join(app.getPath('userData'), 'logs')
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }

  let currentDate = new Date().toISOString().slice(0, 10)
  let writeStream: fs.WriteStream | null = null
  let fileSize = 0
  let rotationCount = 0

  function getLogFilePath(): string {
    return path.join(logDir, `app-${currentDate}-${rotationCount}.log`)
  }

  function ensureStream(): fs.WriteStream {
    const filePath = getLogFilePath()
    if (writeStream && !writeStream.destroyed) {
      return writeStream
    }
    writeStream = fs.createWriteStream(filePath, { flags: 'a' })
    fileSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0
    return writeStream
  }

  function rotateIfNeeded(): void {
    if (fileSize >= config.fileMaxSize) {
      if (writeStream) {
        writeStream.end()
        writeStream = null
      }
      rotationCount++
      // 删除超出保留数量的文件
      const maxCount = config.fileMaxCount || 5
      if (rotationCount >= maxCount) {
        const oldestPath = path.join(logDir, `app-${currentDate}-0.log`)
        if (fs.existsSync(oldestPath)) {
          fs.unlinkSync(oldestPath)
        }
        // 重命名文件
        for (let i = 1; i <= rotationCount; i++) {
          const oldPath = path.join(logDir, `app-${currentDate}-${i}.log`)
          const newPath = path.join(logDir, `app-${currentDate}-${i - 1}.log`)
          if (fs.existsSync(oldPath)) {
            fs.renameSync(oldPath, newPath)
          }
        }
        rotationCount = maxCount - 1
      }
      fileSize = 0
    }
  }

  return (entry: LogEntry) => {
    const levels: LogLevel[] = ['debug', 'info', 'warning', 'error']
    if (levels.indexOf(entry.level) < levels.indexOf(config.fileLevel)) return

    // 检查日期变更
    const today = new Date().toISOString().slice(0, 10)
    if (today !== currentDate) {
      currentDate = today
      rotationCount = 0
      if (writeStream) {
        writeStream.end()
        writeStream = null
      }
    }

    rotateIfNeeded()
    const stream = ensureStream()
    const line = `[${new Date(entry.timestamp).toISOString()}] [${entry.level.toUpperCase()}] [${entry.module}] ${entry.message}${entry.metadata ? ' ' + JSON.stringify(entry.metadata) : ''}\n`
    stream.write(line)
    fileSize += Buffer.byteLength(line)
  }
}
```

```typescript
// src/main/log/sqlite-transport.ts
import Database from 'better-sqlite3'
import type { LogEntry, LogConfig, LogLevel } from './types'

interface LogRow {
  timestamp: number
  level: string
  module: string
  message: string
  metadata: string | null
  request_id: string | null
  workspace_id: string | null
  tool_call_id: string | null
}

export function createSqliteTransport(db: Database.Database, config: LogConfig): (entry: LogEntry) => void {
  // 启用 WAL 模式
  db.pragma('journal_mode = WAL')

  // 创建 logs 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      level TEXT NOT NULL CHECK(level IN ('debug', 'info', 'warning', 'error')),
      module TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata TEXT,
      request_id TEXT,
      workspace_id TEXT,
      tool_call_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
    CREATE INDEX IF NOT EXISTS idx_logs_module ON logs(module);
    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_logs_workspace ON logs(workspace_id);
  `)

  const insertStmt = db.prepare(`
    INSERT INTO logs (timestamp, level, module, message, metadata, request_id, workspace_id, tool_call_id)
    VALUES (@timestamp, @level, @module, @message, @metadata, @request_id, @workspace_id, @tool_call_id)
  `)

  const batchInsert = db.transaction((rows: LogRow[]) => {
    for (const row of rows) {
      insertStmt.run(row)
    }
  })

  let buffer: LogRow[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  function flush(): void {
    if (buffer.length > 0) {
      const batch = buffer.splice(0)
      batchInsert(batch)
    }
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
  }

  return (entry: LogEntry) => {
    const levels: LogLevel[] = ['debug', 'info', 'warning', 'error']
    if (levels.indexOf(entry.level) < levels.indexOf(config.fileLevel)) return

    buffer.push({
      timestamp: entry.timestamp,
      level: entry.level,
      module: entry.module,
      message: entry.message,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      request_id: entry.requestId || null,
      workspace_id: entry.workspaceId || null,
      tool_call_id: entry.toolCallId || null,
    })

    // 批量写入触发条件：达到批量大小
    if (buffer.length >= (config.batchSize || 50)) {
      flush()
    } else if (!flushTimer) {
      // 或间隔时间到达
      flushTimer = setTimeout(flush, config.batchIntervalMs || 1000)
    }
  }
}
```

```typescript
// src/main/log/index.ts
import { app } from 'electron'
import Database from 'better-sqlite3'
import { Logger } from './logger'
import { createConsoleTransport, createFileTransport } from './transports'
import { createSqliteTransport } from './sqlite-transport'
import type { LogConfig, LogLevel, LogModule, LogEntry } from './types'

export type { LogConfig, LogLevel, LogModule, LogEntry }
export { Logger }

let db: Database.Database | null = null

export function initLogger(config?: Partial<LogConfig>): Logger {
  const logger = Logger.getInstance()

  const defaultConfig: LogConfig = {
    level: 'debug',
    fileLevel: 'info',
    consoleLevel: 'debug',
    sqliteLevel: 'info',
    fileMaxSize: 10 * 1024 * 1024,  // 10MB
    fileMaxCount: 5,
    fileDir: '',
    batchSize: 50,
    batchIntervalMs: 1000,
  }

  const mergedConfig = { ...defaultConfig, ...config }
  logger.configure(mergedConfig)

  // 添加控制台 Transport
  logger.addTransport(createConsoleTransport(mergedConfig))

  // 添加文件 Transport
  logger.addTransport(createFileTransport(mergedConfig))

  // 添加 SQLite Transport
  try {
    const dbPath = app.getPath('userData')
    db = new Database(path.join(dbPath, 'mcagent.db'))
    logger.addTransport(createSqliteTransport(db, mergedConfig))
  } catch (err) {
    console.error('日志 SQLite 初始化失败:', err)
  }

  return logger
}

export function getLogger(): Logger {
  return Logger.getInstance()
}

export function closeLogger(): void {
  if (db) {
    db.close()
    db = null
  }
}
```

```typescript
// src/main/log/types.ts
export type LogLevel = 'debug' | 'info' | 'warning' | 'error'

export type LogModule =
  | 'TCP' | 'LLM' | 'FCP' | 'WORKSPACE' | 'MEMORY'
  | 'TASK' | 'QQ' | 'INSTANCE' | 'PROMPT'
  | 'PIPELINE' | 'SYSTEM' | 'GENERAL'

export interface LogEntry {
  id: number
  timestamp: number
  level: LogLevel
  module: LogModule
  message: string
  metadata?: Record<string, unknown>
  requestId?: string
  workspaceId?: string
  toolCallId?: string
  stack?: string
}

export interface LogConfig {
  level: LogLevel
  fileLevel: LogLevel
  consoleLevel: LogLevel
  sqliteLevel: LogLevel
  fileMaxSize: number
  fileMaxCount: number
  fileDir: string
  batchSize: number
  batchIntervalMs: number
}

export interface LogQuery {
  level?: LogLevel
  module?: LogModule
  keyword?: string
  startTime?: number
  endTime?: number
  workspaceId?: string
  toolCallId?: string
  offset?: number
  limit?: number
}

export interface LogQueryResult {
  entries: LogEntry[]
  total: number
  hasMore: boolean
}
```

#### 3.1.2 工具调用事件收集器

```typescript
// src/main/pipeline/event-collector.ts
import { EventEmitter } from 'node:events'
import Database from 'better-sqlite3'
import { PipelineEvent } from './types'
import type { ToolCallContent, ToolResultContent } from './types'

/**
 * ToolCallRecord — 工具调用记录（持久化）
 */
export interface ToolCallRecord {
  id: string
  pipelineId: string
  workspaceId: string
  toolName: string
  category: string
  params: Record<string, unknown>
  result?: {
    success: boolean
    data?: unknown
    error?: string
    duration_ms: number
  }
  status: 'pending' | 'running' | 'success' | 'error'
  level: number
  parentId?: string
  timestamp: number
  completedAt?: number
}

/**
 * PipelineEventCollector — 收集管线事件并持久化
 *
 * 监听 FunctionCallingPipeline 的事件，将工具调用数据
 * 转换为 ToolCallRecord 格式，写入 SQLite 并输出到日志。
 * 纯后端运行，不依赖 Electron 渲染进程。
 */
export class PipelineEventCollector {
  private records: Map<string, ToolCallRecord[]> = new Map()
  private db: Database.Database | null = null
  private readonly maxRecords: number

  constructor(maxRecords = 1000) {
    this.maxRecords = maxRecords
  }

  setDatabase(database: Database.Database): void {
    this.db = database
    this.initTable()
  }

  private initTable(): void {
    if (!this.db) return
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tool_call_records (
        id TEXT PRIMARY KEY,
        pipeline_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        category TEXT,
        params TEXT,
        result TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'success', 'error')),
        level INTEGER NOT NULL DEFAULT 0,
        parent_id TEXT,
        timestamp INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_tcr_workspace ON tool_call_records(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_tcr_pipeline ON tool_call_records(pipeline_id);
      CREATE INDEX IF NOT EXISTS idx_tcr_timestamp ON tool_call_records(timestamp);
      CREATE INDEX IF NOT EXISTS idx_tcr_status ON tool_call_records(status);
    `)
  }

  /**
   * 绑定到 Pipeline 实例
   */
  bindToPipeline(pipeline: EventEmitter): void {
    pipeline.on(PipelineEvent.Start, this.onPipelineStart.bind(this))
    pipeline.on(PipelineEvent.Parsed, this.onParsed.bind(this))
    pipeline.on(PipelineEvent.ToolCompleted, this.onToolCompleted.bind(this))
    pipeline.on(PipelineEvent.Fallback, this.onFallback.bind(this))
    pipeline.on(PipelineEvent.Error, this.onError.bind(this))
  }

  private onPipelineStart({ pipelineId, workspaceId }: { pipelineId: string; workspaceId: string }): void {
    if (!this.records.has(pipelineId)) {
      this.records.set(pipelineId, [])
    }
  }

  private onParsed({ pipelineId, calls }: { pipelineId: string; calls: ToolCallContent[] }): void {
    const records = this.records.get(pipelineId) || []
    for (const call of calls) {
      const record: ToolCallRecord = {
        id: call.toolCallId,
        pipelineId,
        workspaceId: '',
        toolName: call.toolName,
        category: '',
        params: call.arguments,
        status: 'pending',
        level: 0,
        timestamp: Date.now(),
      }
      records.push(record)
    }
    this.records.set(pipelineId, records)
  }

  private onToolCompleted({ pipelineId, toolCallId, result }: {
    pipelineId: string
    toolCallId: string
    result: ToolResultContent
  }): void {
    const records = this.records.get(pipelineId) || []
    const index = records.findIndex(r => r.id === toolCallId)
    if (index >= 0) {
      records[index].status = result.success ? 'success' : 'error'
      records[index].result = {
        success: result.success,
        data: result.data,
        error: result.error,
        duration_ms: result.durationMs,
      }
      records[index].completedAt = Date.now()
      this.persistRecord(records[index])
    }
  }

  private onFallback({ pipelineId, toolName, resolved }: {
    pipelineId: string
    toolName: string
    resolved: boolean
  }): void {
    // 兜底事件记录到日志，但不需要额外持久化
  }

  private onError({ pipelineId, error }: { pipelineId: string; error: unknown }): void {
    // 错误事件由 Logger 自动记录
  }

  private persistRecord(record: ToolCallRecord): void {
    if (!this.db) return
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO tool_call_records
        (id, pipeline_id, workspace_id, tool_name, category, params, result, status, level, parent_id, timestamp, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      stmt.run(
        record.id,
        record.pipelineId,
        record.workspaceId,
        record.toolName,
        record.category || null,
        JSON.stringify(record.params),
        record.result ? JSON.stringify(record.result) : null,
        record.status,
        record.level,
        record.parentId || null,
        record.timestamp,
        record.completedAt || null,
      )
      this.enforceRetention()
    } catch (err) {
      console.error('工具调用记录持久化失败:', err)
    }
  }

  private enforceRetention(): void {
    if (!this.db) return
    this.db.exec(`
      DELETE FROM tool_call_records WHERE id IN (
        SELECT id FROM tool_call_records ORDER BY timestamp DESC LIMIT -1 OFFSET ${this.maxRecords}
      )
    `)
  }

  /**
   * 获取工作区的工具调用历史
   */
  getHistory(workspaceId: string, limit = 100): ToolCallRecord[] {
    const allRecords: ToolCallRecord[] = []
    for (const records of this.records.values()) {
      allRecords.push(...records)
    }
    return allRecords
      .filter(r => r.workspaceId === workspaceId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
  }

  /**
   * 获取工作区的工具调用统计
   */
  getStats(workspaceId: string): ToolCallStats {
    const records = this.getHistory(workspaceId, 1000)
    const success = records.filter(r => r.status === 'success')
    const failed = records.filter(r => r.status === 'error')
    const running = records.filter(r => r.status === 'running')

    const categoryBreakdown: Record<string, number> = {}
    for (const r of records) {
      categoryBreakdown[r.category] = (categoryBreakdown[r.category] || 0) + 1
    }

    const recentErrors = failed.slice(0, 10).map(r => ({
      toolName: r.toolName,
      error: r.result?.error || '未知错误',
      timestamp: r.timestamp,
    }))

    const toolCounts = new Map<string, number>()
    for (const r of records) {
      toolCounts.set(r.toolName, (toolCounts.get(r.toolName) || 0) + 1)
    }
    const topCalled = Array.from(toolCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([toolName, count]) => ({ toolName, count }))

    const totalDuration = records.filter(r => r.result?.duration_ms).reduce((sum, r) => sum + (r.result?.duration_ms || 0), 0)
    const completedCount = success.length + failed.length

    return {
      totalCalls: records.length,
      successCount: success.length,
      failCount: failed.length,
      runningCount: running.length,
      avgDurationMs: completedCount > 0 ? Math.round(totalDuration / completedCount) : 0,
      categoryBreakdown,
      topCalled,
      recentErrors,
    }
  }

  /**
   * 清空指定工作区的记录
   */
  clear(workspaceId: string): void {
    for (const [pipelineId, records] of this.records.entries()) {
      this.records.set(pipelineId, records.filter(r => r.workspaceId !== workspaceId))
    }
    if (this.db) {
      this.db.prepare('DELETE FROM tool_call_records WHERE workspace_id = ?').run(workspaceId)
    }
  }
}

export interface ToolCallStats {
  totalCalls: number
  successCount: number
  failCount: number
  runningCount: number
  avgDurationMs: number
  categoryBreakdown: Record<string, number>
  topCalled: { toolName: string; count: number }[]
  recentErrors: { toolName: string; error: string; timestamp: number }[]
}
```

#### 3.1.3 日志 IPC Handler

```typescript
// src/main/ipc/log-handler.ts
import { ipcMain } from 'electron'
import Database from 'better-sqlite3'
import { getLogger } from '../log'
import type { LogQuery, LogQueryResult } from '../log/types'

let db: Database.Database | null = null

export function setLogDb(database: Database.Database): void {
  db = database
}

export function registerLogHandlers(): void {
  const logger = getLogger()

  // 查询历史日志
  ipcMain.handle('log:history', async (_event, query: LogQuery) => {
    if (!db) return { entries: [], total: 0, hasMore: false }

    const conditions: string[] = []
    const params: unknown[] = []

    if (query.level && query.level !== 'all') {
      conditions.push('level = ?')
      params.push(query.level)
    }
    if (query.module && query.module !== 'all') {
      conditions.push('module = ?')
      params.push(query.module)
    }
    if (query.keyword) {
      conditions.push('message LIKE ?')
      params.push(`%${query.keyword}%`)
    }
    if (query.startTime) {
      conditions.push('timestamp >= ?')
      params.push(query.startTime)
    }
    if (query.endTime) {
      conditions.push('timestamp <= ?')
      params.push(query.endTime)
    }
    if (query.workspaceId) {
      conditions.push('workspace_id = ?')
      params.push(query.workspaceId)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = query.limit || 50
    const offset = query.offset || 0

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM logs ${where}`).get(...params) as { total: number }
    const rows = db.prepare(`SELECT * FROM logs ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`).all(...params, limit, offset)

    const entries = (rows as any[]).map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      level: row.level,
      module: row.module,
      message: row.message,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      requestId: row.request_id,
      workspaceId: row.workspace_id,
      toolCallId: row.tool_call_id,
    }))

    return {
      entries,
      total: countRow.total,
      hasMore: offset + limit < countRow.total,
    } as LogQueryResult
  })

  // 获取日志配置
  ipcMain.handle('log:config', async () => {
    return logger['config']
  })

  // 设置日志级别
  ipcMain.handle('log:set-level', async (_event, { level }) => {
    logger.configure({ level })
    return { success: true }
  })

  // 清空日志
  ipcMain.handle('log:clear', async () => {
    if (db) {
      db.exec('DELETE FROM logs')
    }
    return { success: true }
  })
}
```

#### 3.1.4 工具调用 IPC Handler

```typescript
// src/main/ipc/tool-call-handler.ts
import { ipcMain } from 'electron'
import { PipelineEventCollector } from '../pipeline/event-collector'

const collector = new PipelineEventCollector()

export function getToolCallCollector(): PipelineEventCollector {
  return collector
}

export function registerToolCallHandlers(): void {
  // 获取工具调用历史
  ipcMain.handle('tool-call:history', async (_event, { workspaceId, limit = 100 }) => {
    return collector.getHistory(workspaceId, limit)
  })

  // 获取工具调用统计
  ipcMain.handle('tool-call:stats', async (_event, { workspaceId }) => {
    const records = collector.getHistory(workspaceId, 1000)
    const success = records.filter(r => r.status === 'success')
    const failed = records.filter(r => r.status === 'error')
    const running = records.filter(r => r.status === 'running')

    // 分类统计
    const categoryBreakdown: Record<string, number> = {}
    for (const r of records) {
      categoryBreakdown[r.category] = (categoryBreakdown[r.category] || 0) + 1
    }

    // 最近错误
    const recentErrors = failed.slice(0, 10).map(r => ({
      toolName: r.toolName,
      error: r.result?.error || '未知错误',
      timestamp: r.timestamp,
    }))

    // 最常调用工具
    const toolCounts = new Map<string, number>()
    for (const r of records) {
      toolCounts.set(r.toolName, (toolCounts.get(r.toolName) || 0) + 1)
    }
    const topCalled = Array.from(toolCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([toolName, count]) => ({ toolName, count }))

    const totalDuration = records.filter(r => r.result?.duration_ms).reduce((sum, r) => sum + (r.result?.duration_ms || 0), 0)
    const completedCount = success.length + failed.length

    return {
      totalCalls: records.length,
      successCount: success.length,
      failCount: failed.length,
      runningCount: running.length,
      avgDurationMs: completedCount > 0 ? Math.round(totalDuration / completedCount) : 0,
      categoryBreakdown,
      topCalled,
      recentErrors,
    }
  })

  // 清空工具调用历史
  ipcMain.handle('tool-call:clear', async (_event, { workspaceId }) => {
    collector.clear(workspaceId)
    return { success: true }
  })
}
```

#### 3.1.5 IPC 入口整合

```typescript
// src/main/ipc/index.ts (V9 更新版)
import { BrowserWindow } from 'electron'
import { registerChatHandlers } from './chat-handler'
import { registerConfigHandlers } from './config-handler'
import { registerWindowHandlers } from './window-handler'
import { registerDashboardHandlers } from './dashboard-handler'
import { registerAgentHandlers } from './agent-handler'
import { registerModelHandlers } from './model-handler'
import { registerLogHandlers } from './log-handler'
import { registerToolCallHandlers } from './tool-call-handler'

export function registerAllIpcHandlers(mainWindow: BrowserWindow): void {
  registerChatHandlers()
  registerConfigHandlers()
  registerWindowHandlers(mainWindow)
  registerDashboardHandlers()
  registerAgentHandlers()
  registerModelHandlers()
  registerLogHandlers()
  registerToolCallHandlers()
}
```

### 3.2 主进程初始化流程

```typescript
// src/main/index.ts (V9 更新版)
import { app, BrowserWindow, shell } from 'electron'
import path from 'path'
import { TcpServer } from './tcp'
import { WorkspaceManager } from './workspace'
import { ConfigManager } from './llm/config'
import { ModelRouter } from './llm'
import { initLogger, getLogger } from './log'
import { registerAllIpcHandlers } from './ipc'
import { getToolCallCollector } from './ipc/tool-call-handler'
import { FunctionCallingPipeline } from './pipeline'

let mainWindow: BrowserWindow | null = null

async function initializeServices(): Promise<void> {
  // 初始化日志系统（优先，其他模块初始化时即可记录日志）
  const logger = initLogger()

  // 初始化配置
  await ConfigManager.init()

  // 初始化 TCP 服务端
  const tcpPort = await ConfigManager.get('tcp_port') || 27541
  const tcpServer = new TcpServer(Number(tcpPort))
  await tcpServer.start()

  // TCP 连接时自动创建工作区
  tcpServer.on('connection', (conn) => {
    WorkspaceManager.createWorkspace(conn)
  })

  logger.info('SYSTEM', 'Agent Core 服务初始化完成', { tcpPort })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1a1a2e',
      symbolColor: '#e0e0e0',
      height: 36,
    },
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.resolve(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.resolve(__dirname, '../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // 注册所有 IPC Handler
  registerAllIpcHandlers(mainWindow)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  await initializeServices()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
```

### 3.6 集成 Pipeline 事件

```typescript
// 在 Pipeline 初始化时绑定事件收集器
// 示例：在工作区初始化时

import { FunctionCallingPipeline } from './pipeline'
import { getToolCallCollector } from './ipc/tool-call-handler'

// 创建 Pipeline 实例
const pipeline = new FunctionCallingPipeline()

// 绑定事件收集器
const collector = getToolCallCollector()
collector.bindToPipeline(pipeline)

// 设置 dispatcher 和 collector
pipeline.setDispatcher(toolDispatcher)
pipeline.setCollector(resultCollector)

// 在 LLM 调用时使用 pipeline.process()
// const result = await pipeline.process(llmResponse, workspaceId, conversation)
```

### 3.7 前置条件与依赖

| 依赖项 | 说明 | 状态 |
|--------|------|:----:|
| V4 Function Calling Pipeline | Pipeline 事件系统，用于收集工具调用数据 | ✅ 已有 |
| better-sqlite3 | SQLite 数据库，日志系统依赖 | ✅ 已有 |
| V6 数据库层 | 复用 SQLite 连接，新增 logs 和 tool_call_records 表 | ✅ 已有 |

### 3.8 边界情况处理

| 场景 | 处理方式 |
|------|----------|
| 工具调用记录为空 | 返回空数组，不输出错误日志 |
| 大量工具调用（>1000） | 默认保留最近 1000 条记录，自动清理旧数据，保留数量可配置 |
| 工具调用结果数据过大 | 写入时截断超过 10000 字符的 JSON 结果，日志中标记"数据过长" |
| 日志文件写入失败 | 控制台输出错误，不阻塞主流程，降级为仅控制台输出 |
| SQLite 日志写入失败 | 降级为仅文件和控制台输出，不影响 Logger 主流程 |
| 日志轮转时文件被占用 | 捕获异常跳过轮转，下次写入时再尝试 |
| 并行 Pipeline 多个实例 | 每个 Pipeline 实例独立绑定 collector，按 pipelineId 区分记录 |
| 日志批量写入缓冲区满 | 立即 flush，不等待定时器，防止内存泄漏 |
| 应用异常退出 | SQLite 使用 WAL 模式，重启后日志不丢失 |

***

## 第四部分：性能目标

| 指标 | 目标 | 测量方式 |
|------|------|----------|
| 工具调用记录写入 | < 1ms/条（单条记录写入 SQLite） | 计时日志 |
| 日志写入吞吐 | > 1000 msg/s（批量写入） | 压力测试 |
| 日志文件轮转 | < 10ms（10MB 文件检查 + 轮转） | 计时日志 |
| SQLite 日志查询 | < 100ms（10000 条日志中按条件查询） | 计时日志 |
| SQLite 日志查询 | < 500ms（50000 条日志范围查询） | 计时日志 |
| 工具调用记录查询 | < 50ms（1000 条记录中按条件查询） | 计时日志 |
| 日志写入主流程影响 | < 0.1ms（单条日志写入对主流程的额外延迟） | 高精度计时 |

***

## 第五部分：附录

### 5.1 新增/修改文件清单

#### 新增文件

| 文件路径 | 用途 |
|----------|------|
| `src/main/log/index.ts` | 日志系统入口，初始化所有 Transport |
| `src/main/log/logger.ts` | 日志核心 Logger（单例，分级日志） |
| `src/main/log/types.ts` | 日志系统类型定义 |
| `src/main/log/transports.ts` | 控制台 + 文件 Transport（含轮转） |
| `src/main/log/sqlite-transport.ts` | SQLite 日志写入 Transport（批量写入） |
| `src/main/ipc/log-handler.ts` | 日志 IPC Handler（查询/配置/清理） |
| `src/main/ipc/tool-call-handler.ts` | 工具调用 IPC Handler（历史/统计/清理） |
| `src/main/pipeline/event-collector.ts` | Pipeline 事件收集器（绑定到管线实例） |

#### 修改文件

| 文件路径 | 修改内容 |
|----------|----------|
| `src/main/index.ts` | 初始化日志系统，绑定 Pipeline 事件收集器 |
| `src/main/ipc/index.ts` | 注册 log-handler 和 tool-call-handler |

### 5.2 开发顺序建议

| 阶段 | 内容 | 产出 |
|------|------|------|
| **阶段 1** | 类型定义 + 日志系统核心 | 实现 types.ts、Logger 单例和分级日志 |
| **阶段 2** | 日志 Transport 三件套 | ConsoleTransport + FileTransport（含轮转）+ SQLiteTransport |
| **阶段 3** | 日志 IPC 查询通道 | log-handler.ts（日志查询/配置/清理 IPC） |
| **阶段 4** | Pipeline 事件收集器 | event-collector.ts + tool-call-handler.ts |
| **阶段 5** | 主进程集成 | 在 index.ts 中初始化日志系统，绑定事件收集器 |
| **阶段 6** | 集成测试 + 边界处理 | 全链路联调、高并发写入测试、性能验证 |

### 5.3 风险与应对

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| Pipeline 事件频率高 | 事件收集器处理压力大 | 异步处理 + 批量写入，不阻塞管线主流程 |
| 工具调用记录数据量大 | 内存占用增加 | 限制内存缓存 1000 条，超出写入 SQLite 后释放 |
| 日志文件 IO 竞争 | 高并发写入性能瓶颈 | 批量写入 + WAL 模式 + 异步非阻塞 |
| 日志文件占用磁盘 | 日志文件无限增长 | 轮转机制 + 保留数量限制 + 可配置清理策略 |
| SQLite 写入阻塞 | 日志写入影响主流程 | 批量写入 + 异步 flush，WAL 模式避免读写锁 |