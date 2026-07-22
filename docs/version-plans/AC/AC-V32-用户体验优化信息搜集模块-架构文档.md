# AC-V32 — 用户体验优化信息搜集模块

> 版本：v1.0
> 日期：2026-07-23
> 版本号：V32
> 类型：架构文档
> 关联文档：[需求文档](AC-V32-用户体验优化信息搜集模块-需求文档.md)、[执行文档](AC-V32-用户体验优化信息搜集模块-执行文档.md)

---

## 第1章 总体架构

信息搜集模块采用**采集-处理-存储**三层架构，与项目现有 Pipeline 和中间件体系深度集成，以低侵入方式实现信息采集。

```
┌─────────────────────────────────────────────────────────────────────┐
│                        采集层 (Collectors)                           │
│                                                                     │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────┐  │
│  │ QQBotFeedback │  │ DashboardFeedback│  │ AutoErrorReporter   │  │
│  │  (交互式引导)  │  │  (表单提交 + 自动) │  │  (未捕获异常监听)    │  │
│  └──────┬───────┘  └────────┬─────────┘  └──────────┬───────────┘  │
│         │                   │                        │              │
│  ┌──────┴───────────────────┴────────────────────────┴───────────┐  │
│  │ UsageStatsCollector (工具调用/LLM 调用统计，中间件方式采集)       │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        处理层 (Processors)                           │
│                                                                     │
│  ┌────────────────────┐  ┌──────────────────────────────────────┐   │
│  │ ContextCollector   │  │ Sanitizer (隐私脱敏)                  │   │
│  │  (自动上下文打包)    │  │  - 敏感字段正则匹配 → [REDACTED]      │   │
│  │  - 游戏状态         │  │  - 配置快照脱敏                       │   │
│  │  - 工具调用链       │  │  - 日志过滤                           │   │
│  │  - 近期日志         │  └──────────────────────────────────────┘   │
│  │  - 环境信息         │                                            │
│  │  - 配置快照         │                                            │
│  └────────────────────┘                                             │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        存储层 (Storage)                              │
│                                                                     │
│  ┌────────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │ FeedbackRepository │  │ StatsRepository  │  │ Exporter       │  │
│  │  (SQLite feedback) │  │  (内存统计 + 滚动) │  │  (JSON 导出)   │  │
│  └────────────────────┘  └──────────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 第2章 模块职责

### 2.1 采集层

| 模块 | 文件 | 职责 |
|------|------|------|
| `QQBotFeedbackHandler` | `telemetry/qq-bot-feedback.ts` | 处理 QQ Bot 的 `反馈` 命令，引导用户进入反馈流程，采集上下文并提交 |
| `DashboardFeedbackHandler` | `telemetry/dashboard-feedback.ts` | 处理 Dashboard 表单提交，自动附加环境信息和日志摘要 |
| `AutoErrorReporter` | `telemetry/auto-error-reporter.ts` | 监听 `process.on('uncaughtException')` 和 `process.on('unhandledRejection')`，自动生成错误报告 |
| `UsageStatsCollector` | `telemetry/usage-stats-collector.ts` | 通过 Pipeline 中间件采集工具调用统计和 LLM 调用统计 |

### 2.2 处理层

| 模块 | 文件 | 职责 |
|------|------|------|
| `ContextCollector` | `telemetry/context-collector.ts` | 自动采集游戏状态、工具调用链、近期日志、环境信息、配置快照 |
| `Sanitizer` | `telemetry/sanitizer.ts` | 敏感字段正则匹配与脱敏，确保不泄露 API Key、Token 等敏感信息 |

### 2.3 存储层

| 模块 | 文件 | 职责 |
|------|------|------|
| `FeedbackRepository` | `telemetry/feedback-repository.ts` | 反馈数据 CRUD，SQLite 存储 |
| `StatsRepository` | `telemetry/stats-repository.ts` | 统计数据存储，30 天滚动窗口 |
| `Exporter` | `telemetry/exporter.ts` | 反馈数据导出为 JSON |

---

## 第3章 数据流

### 3.1 QQ Bot 反馈流程

```
用户: "反馈"
  │
  ▼
QQBotFeedbackHandler 接收消息
  │
  ├─ 1. 回复引导菜单: "请选择类型: 1=报Bug 2=提建议 3=评分"
  │
  ├─ 用户: "1"
  │     │
  │     ▼
  │   ContextCollector.collect()
  │     ├─ 获取游戏状态 (health, hunger, dimension, position)
  │     ├─ 获取最近 5 条工具调用链 (从 ToolCallHistory)
  │     ├─ 获取最近 20 条日志 (从 LogBuffer)
  │     ├─ 获取环境信息 (版本、OS、Node 版本)
  │     └─ 获取配置快照 (config.json 脱敏)
  │     │
  │     ▼
  │   Sanitizer.sanitize(context) → 脱敏处理
  │     │
  │     ▼
  │   Bot: "请简单描述你遇到的问题（可选，输入 0 跳过）"
  │     │
  │     ├─ 用户输入描述 → 追加
  │     └─ 用户跳过 → 空描述
  │     │
  │     ▼
  │   FeedbackRepository.save(feedback) → 返回编号
  │     │
  │     ▼
  │   Bot: "感谢反馈！编号：FB-20260723-001"
  │
  ├─ 用户: "2"
  │     │
  │     ▼
  │   Bot: "请描述你的建议"
  │     │
  │     ▼
  │   用户输入 → FeedbackRepository.save → 返回编号
  │
  └─ 用户: "3"
        │
        ▼
      Bot: "请为 Alice Mod 评分 (1-5 星)"
        │
        ▼
      用户输入评分 → 可选补充描述 → FeedbackRepository.save → 返回编号
```

### 3.2 Dashboard 反馈流程

```
用户打开 Dashboard → 设置 → 反馈与帮助
  │
  ▼
反馈表单渲染
  │
  ├─ 用户选择类型 (bug / suggestion / rating)
  ├─ 用户选择严重程度 (low / medium / high / critical)
  ├─ 用户输入描述
  ├─ 用户上传截图 (可选)
  │
  ▼
提交点击
  │
  ├─ 1. ContextCollector.collectForDashboard()
  │     ├─ 环境信息 (Agent 版本、OS、Node.js 版本、MC 版本、Adapter 类型)
  │     ├─ 近期日志摘要 (最近 50 行 error/warn 级别)
  │     └─ 配置快照 (脱敏)
  │
  ├─ 2. Sanitizer.sanitize(context)
  │
  ├─ 3. FeedbackRepository.save(feedback) → 返回编号
  │
  └─ 4. 前端显示 "反馈已提交！编号：FB-YYYYMMDD-NNN"
```

### 3.3 自动错误报告流程

```
未捕获异常 / 未处理的 Promise Rejection
  │
  ▼
AutoErrorReporter.capture(error)
  │
  ├─ 1. 采集错误堆栈
  ├─ 2. ContextCollector.collectMinimal()
  │     ├─ 内存使用 (process.memoryUsage())
  │     ├─ Uptime (process.uptime())
  │     ├─ 最近 10 次工具调用
  │     └─ 配置快照 (脱敏)
  │
  ├─ 3. Sanitizer.sanitize(context)
  │
  ├─ 4. FeedbackRepository.save({
  │       type: 'auto_report',
  │       source: 'auto',
  │       description: error.message,
  │       context: { ...context, errorStack: error.stack },
  │       severity: 'critical'
  │    })
  │
  └─ 5. console.error 记录错误报告已保存
```

### 3.4 使用统计采集流程

```
工具调用完成
  │
  ▼
UsageStatsCollector (Pipeline 中间件)
  │
  ├─ 调用开始 → 记录 startTime
  └─ 调用结束 → 更新统计
       ├─ totalCalls++
       ├─ success/fail 计数
       ├─ 更新 byTool 统计
       └─ 更新 avgDurationMs
  
LLM 调用完成
  │
  ▼
UsageStatsCollector (LLM 调用后回调)
  │
  ├─ totalCalls++
  ├─ totalTokens += 消耗 token
  └─ 更新 avgResponseTimeMs

StatsRepository 每小时持久化到内存 + 文件
  │
  ▼
Dashboard 查询时返回统计数据
  │
  ▼
超过 30 天的数据自动清理
```

---

## 第4章 关键接口定义

### 4.1 通用类型

```typescript
interface Feedback {
  id: string;                    // FB-YYYYMMDD-NNN
  type: 'bug' | 'suggestion' | 'rating' | 'auto_report';
  source: 'qq_bot' | 'dashboard' | 'auto';
  status: 'pending' | 'processing' | 'resolved' | 'closed';
  severity?: 'low' | 'medium' | 'high' | 'critical';
  rating?: number;               // 1-5
  description?: string;
  context: FeedbackContext;      // 自动采集的上下文包
  metadata: FeedbackMetadata;    // 版本/环境信息
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  internalNote?: string;

  // 新建时使用
  /** 用户是否已允许采集 */
  consentGiven: boolean;
}

interface FeedbackContext {
  gameState?: {
    health: number;
    hunger: number;
    dimension: string;
    position: { x: number; y: number; z: number };
  };
  recentToolCalls?: ToolCallRecord[];
  recentLogs?: LogRecord[];
  configSnapshot?: Record<string, unknown>;
  errorStack?: string;
  memoryUsage?: { heapUsed: number; heapTotal: number; rss: number };
  uptimeSeconds?: number;
}

interface FeedbackMetadata {
  agentVersion: string;
  os: string;
  nodeVersion: string;
  mcVersion?: string;
  adapterType: 'JE' | 'BE' | 'none';
}
```

### 4.2 采集器接口

```typescript
interface IContextCollector {
  /** 完整上下文采集（用于 QQ Bot Bug 反馈） */
  collect(): Promise<FeedbackContext>;
  /** Dashboard 环境信息采集 */
  collectForDashboard(): Promise<FeedbackContext>;
  /** 最小上下文采集（用于自动错误报告） */
  collectMinimal(): Promise<FeedbackContext>;
}

interface ISanitizer {
  /** 对上下文包进行脱敏处理 */
  sanitize(context: FeedbackContext): FeedbackContext;
  /** 对配置快照进行脱敏 */
  sanitizeConfig(config: Record<string, unknown>): Record<string, unknown>;
}
```

### 4.3 存储接口

```typescript
interface IFeedbackRepository {
  save(feedback: Feedback): Promise<string>;  // 返回 ID
  getById(id: string): Promise<Feedback | null>;
  list(filter?: FeedbackFilter): Promise<Feedback[]>;
  updateStatus(id: string, status: string, note?: string): Promise<void>;
  export(filter?: FeedbackFilter): Promise<Feedback[]>;
  getStats(): Promise<FeedbackStats>;
}

interface FeedbackFilter {
  type?: string;
  source?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  agentVersion?: string;
}

interface FeedbackStats {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  avgRating: number;
}

interface IStatsRepository {
  recordToolCall(toolName: string, success: boolean, durationMs: number): void;
  recordLlmCall(tokenCount: number, responseTimeMs: number): void;
  getStats(): UsageStats;
  cleanup(): void;  // 清理超过 30 天的数据
}
```

### 4.4 自动错误报告接口

```typescript
interface IAutoErrorReporter {
  /** 初始化：注册 process 异常监听 */
  init(): void;
  /** 手动触发错误报告 */
  capture(error: Error, context?: Partial<FeedbackContext>): Promise<string>;
}
```

### 4.5 配置模型

```typescript
interface TelemetryConfig {
  /** 用户是否同意采集 */
  consentGiven: boolean;
  /** 是否启用自动错误报告 */
  errorReport: boolean;
  /** 是否启用使用统计 */
  usageStats: boolean;
  /** 上下文采集包最大字节数 */
  maxContextSizeBytes: number;
  /** 采集的日志行数 */
  logLinesToCapture: number;
  /** 采集的工具调用记录数 */
  toolCallsToCapture: number;
  /** 统计窗口天数 */
  statsWindowDays: number;
}
```

---

## 第5章 与现有系统的集成

### 5.1 Pipeline 中间件集成

`UsageStatsCollector` 作为 Pipeline 中间件注入，在工具调用完成后异步记录统计信息：

```
Pipeline 执行流程:
  preProcess → executeTool → postProcess
                               │
                     UsageStatsCollector 中间件
                     (记录工具调用统计，不修改结果)
```

### 5.2 ToolCallHistory 集成

`ContextCollector` 从 `ToolCallHistory` 获取最近 N 条工具调用记录。`ToolCallHistory` 是一个环形缓冲区，在内存中维护最近 100 条工具调用记录。

### 5.3 LogBuffer 集成

`ContextCollector` 从 `LogBuffer` 获取最近 N 条日志。`LogBuffer` 是一个环形缓冲区，在内存中维护最近 200 条日志（按级别过滤后可获取 error/warn 级别日志）。

### 5.4 QQ Bot 消息系统集成

`QQBotFeedbackHandler` 利用现有的 `QQBotClient` 消息接收能力，通过 `message-handler.ts` 中的命令路由，将 `反馈` 命令路由到反馈处理器。

### 5.5 Dashboard IPC 集成

新增 IPC 频道：

| 频道 | 方向 | 参数 | 返回值 | 说明 |
|------|------|------|--------|------|
| `feedback:submit` | 渲染器 → 主进程 | `Feedback` | `{ id, success }` | 提交反馈 |
| `feedback:list` | 渲染器 → 主进程 | `FeedbackFilter` | `Feedback[]` | 获取反馈列表 |
| `feedback:get` | 渲染器 → 主进程 | `{ id }` | `Feedback` | 获取单条反馈详情 |
| `feedback:export` | 渲染器 → 主进程 | `FeedbackFilter` | `Feedback[]` | 导出反馈数据 |
| `telemetry:stats` | 渲染器 → 主进程 | 无 | `UsageStats` | 获取使用统计 |
| `telemetry:config` | 渲染器 → 主进程 | 无 | `TelemetryConfig` | 获取隐私配置 |
| `telemetry:update-config` | 渲染器 → 主进程 | `TelemetryConfig` | `{ success }` | 更新隐私配置 |

---

## 第6章 文件结构

```
packages/agent-core/src/main/
├── telemetry/
│   ├── index.ts                          # 模块入口，初始化所有组件
│   ├── types.ts                          # 类型定义
│   ├── config.ts                         # 配置加载与合并
│   ├── context-collector.ts              # 上下文采集器
│   ├── sanitizer.ts                      # 隐私脱敏处理器
│   ├── feedback-repository.ts            # 反馈数据存储
│   ├── stats-repository.ts               # 统计数据存储
│   ├── exporter.ts                       # 反馈导出
│   ├── auto-error-reporter.ts            # 自动错误报告
│   ├── usage-stats-collector.ts          # 使用统计中间件
│   ├── qq-bot-feedback.ts               # QQ Bot 反馈处理器
│   └── dashboard-feedback.ts            # Dashboard 反馈处理器
├── qq-bot/
│   ├── message-handler.ts                # (修改) 增加 `反馈` 命令路由
│   └── ...
├── pipeline/
│   └── tool-dispatcher.ts                # (修改) 集成 UsageStatsCollector
└── ...
```

---

## 第7章 隐私设计

### 7.1 用户同意流程

```
首次启动
  │
  ▼
Dashboard 弹窗: "Alice Mod 希望收集信息以改进产品"
  ├─ 同意: 启用自动错误报告（默认）+ 可选择启用使用统计
  ├─ 拒绝: 全部关闭，不采集任何信息
  └─ 自定义: 进入设置页，逐项选择
  │
  ▼
用户选择持久化到 config.json → 后续启动遵循
```

### 7.2 脱敏策略

| 阶段 | 处理 |
|------|------|
| 采集时 | 配置快照提取时跳过 `apiKey`、`token`、`password`、`secret`、`authorization` 字段 |
| 存储前 | `Sanitizer` 正则匹配所有字段，替换匹配到的敏感内容为 `[REDACTED]` |
| 展示时 | Dashboard 反馈详情页不展示原始上下文包，用户可查看脱敏后的摘要 |

### 7.3 数据保留

- 反馈数据：永久保留（用于问题追溯）
- 使用统计数据：30 天滚动窗口，超期自动清理
- 用户可手动删除所有已存储数据（Dashboard 设置页提供「清除所有数据」按钮）

---

## 第8章 安全设计

1. **脱敏必须发生在存储层之前**：`Sanitizer` 在 `FeedbackRepository.save()` 之前调用，确保数据库不存储原始敏感信息。
2. **异步非阻塞**：所有采集操作通过 `setImmediate` / 异步队列执行，不阻塞主流程。
3. **大小限制**：上下文包超过 `maxContextSizeBytes` 时截断，防止存储膨胀。
4. **错误隔离**：采集过程中的任何错误不抛出到主流程，仅 `console.warn` 记录。
5. **配置覆盖**：用户修改隐私配置后立即生效，无需重启。