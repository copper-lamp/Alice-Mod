# AC-V32 — 用户体验优化信息搜集模块

> 版本：v1.0
> 日期：2026-07-23
> 版本号：V32
> 类型：执行文档
> 关联文档：[需求文档](AC-V32-用户体验优化信息搜集模块-需求文档.md)、[架构文档](AC-V32-用户体验优化信息搜集模块-架构文档.md)

---

## 第1章 实施阶段

| 阶段 | 周期 | 目标 | 输出物 |
|------|------|------|--------|
| 阶段一：基础设施 | 2 天 | 类型定义、配置、数据库表、上下文采集器、脱敏器 | `types.ts`, `config.ts`, `feedback-repository.ts`, `context-collector.ts`, `sanitizer.ts` |
| 阶段二：自动错误报告 | 1 天 | 自动错误报告、Pipeline 集成 | `auto-error-reporter.ts` |
| 阶段三：使用统计 | 1 天 | 使用统计中间件、统计存储 | `usage-stats-collector.ts`, `stats-repository.ts` |
| 阶段四：QQ Bot 反馈 | 2 天 | QQ Bot 反馈命令处理、交互式引导流程 | `qq-bot-feedback.ts`, 修改 `message-handler.ts` |
| 阶段五：Dashboard 反馈 | 2 天 | Dashboard 反馈表单、反馈列表、IPC 集成 | `dashboard-feedback.ts`, 前端组件 |
| 阶段六：隐私设置与集成 | 1 天 | 隐私同意弹窗、设置页、模块入口集成 | `index.ts`, 隐私设置 UI |
| 阶段七：测试与验证 | 2 天 | 单元测试、集成测试、手动验证 | 测试用例 |

---

## 第2章 详细任务清单

### 阶段一：基础设施

| 编号 | 任务 | 文件 | 验收标准 |
|------|------|------|---------|
| FB-I-01 | 定义 `types.ts` 所有类型接口 | `telemetry/types.ts` | 类型定义编译通过 |
| FB-I-02 | 实现 `config.ts` 配置加载与合并 | `telemetry/config.ts` | 默认值/config.json 优先级正确 |
| FB-I-03 | 创建 SQLite 数据库迁移：`feedback` 表 | `telemetry/feedback-repository.ts` | 表结构符合需求文档第 4 章定义 |
| FB-I-04 | 实现 `FeedbackRepository` CRUD 方法 | `telemetry/feedback-repository.ts` | save/getById/list/updateStatus 可用 |
| FB-I-05 | 实现 `ContextCollector.collect()` 完整上下文采集 | `telemetry/context-collector.ts` | 正确采集游戏状态、工具调用链、日志 |
| FB-I-06 | 实现 `ContextCollector.collectForDashboard()` | `telemetry/context-collector.ts` | 正确采集环境信息、日志摘要、配置快照 |
| FB-I-07 | 实现 `ContextCollector.collectMinimal()` | `telemetry/context-collector.ts` | 正确采集内存、Uptime、工具调用、配置快照 |
| FB-I-08 | 实现 `Sanitizer` 脱敏处理器 | `telemetry/sanitizer.ts` | API Key、Token 等敏感字段被替换为 `[REDACTED]` |
| FB-I-09 | 实现 `Exporter` 反馈导出 | `telemetry/exporter.ts` | 导出为合法的 JSON 文件 |

### 阶段二：自动错误报告

| 编号 | 任务 | 文件 | 验收标准 |
|------|------|------|---------|
| FB-I-10 | 实现 `AutoErrorReporter` 类 | `telemetry/auto-error-reporter.ts` | 构造函数无异常 |
| FB-I-11 | 注册 `uncaughtException` 和 `unhandledRejection` 监听 | `telemetry/auto-error-reporter.ts` | 异常触发 capture 方法 |
| FB-I-12 | 实现 `capture()` 方法：采集上下文 + 脱敏 + 入库 | `telemetry/auto-error-reporter.ts` | 异常后 feedback 表新增一条记录 |
| FB-I-13 | 实现配置开关：`telemetry.errorReport` 为 false 时不注册监听 | `telemetry/auto-error-reporter.ts` | 配置关闭后不触发采集 |

### 阶段三：使用统计

| 编号 | 任务 | 文件 | 验收标准 |
|------|------|------|---------|
| FB-I-14 | 实现 `StatsRepository` 类 | `telemetry/stats-repository.ts` | 内存统计 + 定时持久化 |
| FB-I-15 | 实现 `recordToolCall()` 方法 | `telemetry/stats-repository.ts` | 工具调用统计正确更新 |
| FB-I-16 | 实现 `recordLlmCall()` 方法 | `telemetry/stats-repository.ts` | LLM 调用统计正确更新 |
| FB-I-17 | 实现 `cleanup()` 30 天滚动清理 | `telemetry/stats-repository.ts` | 超过 30 天的数据自动清除 |
| FB-I-18 | 实现 `UsageStatsCollector` 中间件 | `telemetry/usage-stats-collector.ts` | 作为 Pipeline 中间件注入 |
| FB-I-19 | 集成到 `tool-dispatcher.ts` | `pipeline/tool-dispatcher.ts` | 工具调用时自动记录统计 |

### 阶段四：QQ Bot 反馈

| 编号 | 任务 | 文件 | 验收标准 |
|------|------|------|---------|
| FB-I-20 | 实现 `QQBotFeedbackHandler` 主类 | `telemetry/qq-bot-feedback.ts` | 构造时初始化 |
| FB-I-21 | 实现 `反馈` 命令路由（引导菜单） | `telemetry/qq-bot-feedback.ts` | 输入 `反馈` 后回复引导菜单 |
| FB-I-22 | 实现 Bug 反馈流程（上下文采集 + 描述输入 + 入库） | `telemetry/qq-bot-feedback.ts` | 完整流程走通，返回反馈编号 |
| FB-I-23 | 实现建议反馈流程 | `telemetry/qq-bot-feedback.ts` | 建议内容入库 |
| FB-I-24 | 实现评分反馈流程 | `telemetry/qq-bot-feedback.ts` | 评分数据入库 |
| FB-I-25 | 实现 `反馈状态 <编号>` 查询命令 | `telemetry/qq-bot-feedback.ts` | 返回对应反馈的当前状态 |
| FB-I-26 | 在 `message-handler.ts` 注册 `反馈` 命令路由 | `message-handler.ts` | 命令路由到 QQBotFeedbackHandler |

### 阶段五：Dashboard 反馈

| 编号 | 任务 | 文件 | 验收标准 |
|------|------|------|---------|
| FB-I-27 | 实现 `DashboardFeedbackHandler` 主类 | `telemetry/dashboard-feedback.ts` | 处理表单提交请求 |
| FB-I-28 | 实现 IPC 频道 `feedback:submit` | `telemetry/dashboard-feedback.ts` | 接收表单数据，自动附加上下文，入库 |
| FB-I-29 | 实现 IPC 频道 `feedback:list` / `feedback:get` | `telemetry/feedback-repository.ts` | 返回反馈列表和详情 |
| FB-I-30 | 实现 IPC 频道 `feedback:export` | `telemetry/exporter.ts` | 导出 JSON 文件 |
| FB-I-31 | 实现 IPC 频道 `telemetry:stats` | `telemetry/stats-repository.ts` | 返回使用统计 |
| FB-I-32 | 前端：创建「反馈与帮助」Tab 页面 | 前端组件 | 侧边栏可见，页面可打开 |
| FB-I-33 | 前端：反馈表单组件（类型、严重程度、描述、截图上传） | 前端组件 | 表单字段齐全，可提交 |
| FB-I-34 | 前端：反馈列表组件（筛选、分页、状态展示） | 前端组件 | 历史反馈可查看 |
| FB-I-35 | 前端：使用统计概览组件（图表展示） | 前端组件 | 统计数据可视化 |

### 阶段六：隐私设置与集成

| 编号 | 任务 | 文件 | 验收标准 |
|------|------|------|---------|
| FB-I-36 | 实现首次启动隐私同意弹窗 | 前端组件 | 首次启动显示弹窗 |
| FB-I-37 | 实现 Dashboard 隐私设置页 | 前端组件 | 可修改 consentGiven/errorReport/usageStats |
| FB-I-38 | 实现 IPC 频道 `telemetry:config` / `telemetry:update-config` | `telemetry/config.ts` | 配置可读可写 |
| FB-I-39 | 实现 `telemetry/index.ts` 模块入口，初始化所有组件 | `telemetry/index.ts` | 启动时初始化全部组件 |
| FB-I-40 | 在 `index.ts` 主入口中调用 `telemetry/index.ts` 初始化 | 项目入口 | 启动时自动初始化 |

### 阶段七：测试与验证

| 编号 | 任务 | 验收标准 |
|------|------|---------|
| FB-I-41 | 编写 `context-collector.test.ts` 单元测试 | 覆盖 3 种采集模式的边界情况 |
| FB-I-42 | 编写 `sanitizer.test.ts` 单元测试 | 覆盖所有敏感字段匹配规则 |
| FB-I-43 | 编写 `feedback-repository.test.ts` 单元测试 | 覆盖 CRUD 和筛选功能 |
| FB-I-44 | 编写 `stats-repository.test.ts` 单元测试 | 覆盖记录和清理逻辑 |
| FB-I-45 | 编写 `auto-error-reporter.test.ts` 单元测试 | 模拟异常触发 |
| FB-I-46 | 手动测试 QQ Bot 完整反馈流程 | 3 种反馈类型全部走通 |
| FB-I-47 | 手动测试 Dashboard 反馈表单 | 提交后查看数据库记录 |
| FB-I-48 | 隐私脱敏验证 | 提交包含敏感字段的配置，验证存储为 `[REDACTED]` |

---

## 第3章 关键代码实现

### 3.1 ContextCollector

```typescript
// telemetry/context-collector.ts
import { injectable, inject } from 'inversify';
import type { FeedbackContext, TelemetryConfig } from './types';
import type { ToolCallHistory } from '../pipeline/tool-call-history';
import type { LogBuffer } from '../log/log-buffer';
import type { WorkspaceManager } from '../workspace/workspace-manager';

@injectable()
export class ContextCollector implements IContextCollector {
  constructor(
    @inject('ToolCallHistory') private toolCallHistory: ToolCallHistory,
    @inject('LogBuffer') private logBuffer: LogBuffer,
    @inject('WorkspaceManager') private workspaceManager: WorkspaceManager,
    @inject('TelemetryConfig') private config: TelemetryConfig,
  ) {}

  /** 完整上下文采集（用于 QQ Bot Bug 反馈） */
  async collect(): Promise<FeedbackContext> {
    const workspace = this.workspaceManager.getActiveWorkspace();
    const gameState = workspace?.getAgentContext()?.gameState;

    return {
      gameState: gameState ? {
        health: gameState.health,
        hunger: gameState.hunger,
        dimension: gameState.dimension,
        position: gameState.position,
      } : undefined,
      recentToolCalls: this.toolCallHistory.getRecent(this.config.toolCallsToCapture),
      recentLogs: this.logBuffer.getRecent(this.config.logLinesToCapture),
      configSnapshot: this.getConfigSnapshot(),
    };
  }

  /** Dashboard 环境信息采集 */
  async collectForDashboard(): Promise<FeedbackContext> {
    return {
      recentLogs: this.logBuffer.getRecentByLevel(this.config.logLinesToCapture, ['error', 'warn']),
      configSnapshot: this.getConfigSnapshot(),
    };
  }

  /** 最小上下文采集（用于自动错误报告） */
  async collectMinimal(): Promise<FeedbackContext> {
    return {
      memoryUsage: process.memoryUsage(),
      uptimeSeconds: Math.floor(process.uptime()),
      recentToolCalls: this.toolCallHistory.getRecent(this.config.toolCallsToCapture),
      configSnapshot: this.getConfigSnapshot(),
    };
  }

  private getConfigSnapshot(): Record<string, unknown> {
    // 从 config.json 读取关键字段，跳过敏感字段
    // 具体实现由 Sanitizer 在后续步骤处理
    return {};
  }
}
```

### 3.2 Sanitizer

```typescript
// telemetry/sanitizer.ts
export class Sanitizer implements ISanitizer {
  /** 敏感字段正则列表 */
  private static readonly SENSITIVE_PATTERNS: RegExp[] = [
    /api[kK]ey|api_key|apikey/i,
    /token/i,
    /password|passwd/i,
    /secret/i,
    /authorization/i,
  ];

  /** 需要跳过的配置键名 */
  private static readonly SENSITIVE_KEYS = new Set([
    'apiKey', 'api_key', 'apikey',
    'token', 'password', 'passwd', 'secret', 'authorization',
    'api_key', 'api-key',
  ]);

  sanitize(context: FeedbackContext): FeedbackContext {
    if (context.configSnapshot) {
      context.configSnapshot = this.sanitizeConfig(context.configSnapshot);
    }
    return context;
  }

  sanitizeConfig(config: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (Sanitizer.SENSITIVE_KEYS.has(key)) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.sanitizeConfig(value as Record<string, unknown>);
      } else if (typeof value === 'string') {
        result[key] = this.redactString(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private redactString(value: string): string {
    let result = value;
    for (const pattern of Sanitizer.SENSITIVE_PATTERNS) {
      // 替换形如 "apiKey": "sk-xxx" 或 token=mct_xxx 的内容
      result = result.replace(
        new RegExp(`(${pattern.source})\\s*[:=]\\s*['"]?[^'",\\s}]+`, 'gi'),
        `$1: [REDACTED]`
      );
    }
    return result;
  }
}
```

### 3.3 AutoErrorReporter

```typescript
// telemetry/auto-error-reporter.ts
export class AutoErrorReporter implements IAutoErrorReporter {
  private initialized = false;

  constructor(
    private contextCollector: ContextCollector,
    private sanitizer: Sanitizer,
    private feedbackRepo: FeedbackRepository,
    private config: TelemetryConfig,
  ) {}

  init(): void {
    if (this.initialized || !this.config.errorReport) return;
    this.initialized = true;

    process.on('uncaughtException', (error: Error) => {
      this.capture(error).catch(err => {
        console.error('[AutoErrorReporter] 保存错误报告失败:', err);
      });
    });

    process.on('unhandledRejection', (reason: unknown) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      this.capture(error).catch(err => {
        console.error('[AutoErrorReporter] 保存错误报告失败:', err);
      });
    });
  }

  async capture(error: Error, extraContext?: Partial<FeedbackContext>): Promise<string> {
    try {
      if (!this.config.errorReport) return '';

      const context = await this.contextCollector.collectMinimal();
      context.errorStack = error.stack ?? error.message;

      const sanitized = this.sanitizer.sanitize(context);

      const id = await this.feedbackRepo.save({
        id: this.generateId(),
        type: 'auto_report',
        source: 'auto',
        status: 'pending',
        severity: 'critical',
        description: error.message,
        context: sanitized,
        metadata: this.getMetadata(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        consentGiven: true,
      });

      console.error(`[AutoErrorReporter] 错误报告已保存: ${id}`);
      return id;
    } catch (err) {
      console.error('[AutoErrorReporter] 采集异常:', err);
      return '';
    }
  }

  private generateId(): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const seq = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    return `FB-${date}-${seq}`;
  }

  private getMetadata(): FeedbackMetadata {
    return {
      agentVersion: process.env.APP_VERSION ?? 'unknown',
      os: `${process.platform} ${process.arch}`,
      nodeVersion: process.version,
      adapterType: 'none',
    };
  }
}
```

### 3.4 UsageStatsCollector (Pipeline 中间件)

```typescript
// telemetry/usage-stats-collector.ts
import type { PipelineMiddleware } from '../pipeline/types';

@injectable()
export class UsageStatsCollector implements PipelineMiddleware {
  constructor(
    private statsRepo: StatsRepository,
    private config: TelemetryConfig,
  ) {}

  /** Pipeline 中间件：在工具调用后记录统计 */
  async postProcess(ctx: PipelineContext): Promise<void> {
    if (!this.config.usageStats) return;

    const { toolName, result, startTime } = ctx;
    const durationMs = Date.now() - (startTime ?? Date.now());

    this.statsRepo.recordToolCall(toolName, result?.success ?? false, durationMs);
  }

  /** LLM 调用后回调 */
  recordLlmCall(tokenCount: number, responseTimeMs: number): void {
    if (!this.config.usageStats) return;
    this.statsRepo.recordLlmCall(tokenCount, responseTimeMs);
  }
}
```

### 3.5 QQ Bot 反馈处理器

```typescript
// telemetry/qq-bot-feedback.ts
export class QQBotFeedbackHandler {
  /** 会话状态：跟踪用户当前所处的反馈步骤 */
  private sessions = new Map<string, FeedbackSessionState>();

  constructor(
    private contextCollector: ContextCollector,
    private sanitizer: Sanitizer,
    private feedbackRepo: FeedbackRepository,
    private qqClient: QQBotClient,
  ) {}

  /** 处理 `反馈` 命令入口 */
  async handleCommand(senderId: string, args: string[]): Promise<void> {
    const session = this.sessions.get(senderId);

    // 无活跃会话 → 显示引导菜单
    if (!session || session.step === 'done') {
      await this.startNewSession(senderId);
      return;
    }

    // 有活跃会话 → 继续当前步骤
    await this.handleSessionStep(senderId, args[0] ?? '');
  }

  private async startNewSession(senderId: string): Promise<void> {
    this.sessions.set(senderId, {
      step: 'select_type',
      data: {},
    });

    await this.qqClient.sendPrivateMsg(senderId,
      '📋 请选择反馈类型：\n' +
      '1️⃣ 报 Bug — 提交问题报告（自动采集诊断信息）\n' +
      '2️⃣ 提建议 — 告诉我们如何改进\n' +
      '3️⃣ 评分 — 为 Alice Mod 打分\n\n' +
      '回复数字 1/2/3 选择，或回复 0 取消'
    );
  }

  private async handleSessionStep(senderId: string, input: string): Promise<void> {
    const session = this.sessions.get(senderId)!;

    switch (session.step) {
      case 'select_type':
        await this.handleTypeSelection(senderId, session, input);
        break;
      case 'bug_description':
        await this.handleBugDescription(senderId, session, input);
        break;
      case 'suggestion_content':
        await this.handleSuggestionContent(senderId, session, input);
        break;
      case 'rating_value':
        await this.handleRatingValue(senderId, session, input);
        break;
      case 'rating_comment':
        await this.handleRatingComment(senderId, session, input);
        break;
    }
  }

  private async handleTypeSelection(senderId: string, session: FeedbackSessionState, input: string): Promise<void> {
    switch (input) {
      case '1': { // Bug
        session.step = 'bug_description';
        session.data.type = 'bug';

        // 异步采集上下文
        const context = await this.contextCollector.collect();
        session.data.context = this.sanitizer.sanitize(context);

        await this.qqClient.sendPrivateMsg(senderId,
          '🔍 正在采集诊断信息...\n' +
          '✅ 已采集：游戏状态、工具调用记录、系统日志\n\n' +
          '请简单描述你遇到的问题（输入 0 跳过）'
        );
        break;
      }
      case '2': { // 建议
        session.step = 'suggestion_content';
        session.data.type = 'suggestion';
        await this.qqClient.sendPrivateMsg(senderId,
          '💡 请描述你的建议或想法'
        );
        break;
      }
      case '3': { // 评分
        session.step = 'rating_value';
        session.data.type = 'rating';
        await this.qqClient.sendPrivateMsg(senderId,
          '⭐ 请为 Alice Mod 评分 (1-5 星，回复数字 1-5)'
        );
        break;
      }
      case '0': {
        this.sessions.delete(senderId);
        await this.qqClient.sendPrivateMsg(senderId, '已取消反馈');
        break;
      }
      default:
        await this.qqClient.sendPrivateMsg(senderId, '请输入 1、2 或 3，输入 0 取消');
    }
  }

  private async handleBugDescription(senderId: string, session: FeedbackSessionState, input: string): Promise<void> {
    if (input !== '0') {
      session.data.description = input;
    }

    const id = await this.feedbackRepo.save({
      id: this.generateId(),
      type: 'bug',
      source: 'qq_bot',
      status: 'pending',
      severity: 'medium',
      description: session.data.description ?? '',
      context: session.data.context,
      metadata: this.getMetadata(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      consentGiven: true,
    });

    session.step = 'done';
    await this.qqClient.sendPrivateMsg(senderId,
      `✅ 感谢你的反馈！\n编号：${id}\n我们会尽快处理`
    );
  }

  private async handleSuggestionContent(senderId: string, session: FeedbackSessionState, input: string): Promise<void> {
    const id = await this.feedbackRepo.save({
      id: this.generateId(),
      type: 'suggestion',
      source: 'qq_bot',
      status: 'pending',
      description: input,
      context: {},
      metadata: this.getMetadata(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      consentGiven: true,
    });

    session.step = 'done';
    await this.qqClient.sendPrivateMsg(senderId,
      `✅ 感谢你的建议！\n编号：${id}`
    );
  }

  private async handleRatingValue(senderId: string, session: FeedbackSessionState, input: string): Promise<void> {
    const rating = parseInt(input);
    if (isNaN(rating) || rating < 1 || rating > 5) {
      await this.qqClient.sendPrivateMsg(senderId, '请输入 1-5 之间的数字');
      return;
    }

    session.data.rating = rating;
    session.step = 'rating_comment';
    await this.qqClient.sendPrivateMsg(senderId, '可以补充一句评价吗？（输入 0 跳过）');
  }

  private async handleRatingComment(senderId: string, session: FeedbackSessionState, input: string): Promise<void> {
    const id = await this.feedbackRepo.save({
      id: this.generateId(),
      type: 'rating',
      source: 'qq_bot',
      status: 'pending',
      rating: session.data.rating,
      description: input !== '0' ? input : undefined,
      context: {},
      metadata: this.getMetadata(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      consentGiven: true,
    });

    session.step = 'done';
    await this.qqClient.sendPrivateMsg(senderId,
      `✅ 感谢你的评分！\n编号：${id}`
    );
  }

  /** 查询反馈状态 */
  async handleStatusQuery(senderId: string, feedbackId: string): Promise<void> {
    const feedback = await this.feedbackRepo.getById(feedbackId);
    if (!feedback) {
      await this.qqClient.sendPrivateMsg(senderId, '未找到该反馈编号');
      return;
    }

    const statusMap: Record<string, string> = {
      'pending': '⏳ 待处理',
      'processing': '🔄 处理中',
      'resolved': '✅ 已解决',
      'closed': '🔒 已关闭',
    };

    await this.qqClient.sendPrivateMsg(senderId,
      `📋 反馈 ${feedbackId}\n` +
      `类型: ${feedback.type}\n` +
      `状态: ${statusMap[feedback.status] ?? feedback.status}\n` +
      `提交时间: ${feedback.createdAt}\n` +
      (feedback.resolvedAt ? `解决时间: ${feedback.resolvedAt}\n` : '') +
      (feedback.description ? `描述: ${feedback.description}` : '')
    );
  }

  private generateId(): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const seq = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    return `FB-${date}-${seq}`;
  }
}

interface FeedbackSessionState {
  step: 'select_type' | 'bug_description' | 'suggestion_content' | 'rating_value' | 'rating_comment' | 'done';
  data: {
    type?: string;
    description?: string;
    rating?: number;
    context?: FeedbackContext;
  };
}
```

### 3.6 FeedbackRepository

```typescript
// telemetry/feedback-repository.ts
@injectable()
export class FeedbackRepository implements IFeedbackRepository {
  private db: Database;

  constructor(@inject('Database') db: Database) {
    this.db = db;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS feedback (
        id            TEXT PRIMARY KEY,
        type          TEXT NOT NULL,
        source        TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending',
        severity      TEXT,
        rating        INTEGER,
        description   TEXT,
        context       TEXT,
        metadata      TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        resolved_at   TEXT,
        internal_note TEXT
      )
    `);
  }

  async save(feedback: Feedback): Promise<string> {
    const stmt = this.db.prepare(`
      INSERT INTO feedback (id, type, source, status, severity, rating, description, context, metadata, created_at, updated_at, resolved_at, internal_note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      feedback.id,
      feedback.type,
      feedback.source,
      feedback.status,
      feedback.severity ?? null,
      feedback.rating ?? null,
      feedback.description ?? null,
      JSON.stringify(feedback.context),
      JSON.stringify(feedback.metadata),
      feedback.createdAt,
      feedback.updatedAt,
      feedback.resolvedAt ?? null,
      feedback.internalNote ?? null,
    );
    return feedback.id;
  }

  async getById(id: string): Promise<Feedback | null> {
    const row = this.db.prepare('SELECT * FROM feedback WHERE id = ?').get(id) as any;
    return row ? this.rowToFeedback(row) : null;
  }

  async list(filter?: FeedbackFilter): Promise<Feedback[]> {
    let sql = 'SELECT * FROM feedback WHERE 1=1';
    const params: any[] = [];

    if (filter?.type) { sql += ' AND type = ?'; params.push(filter.type); }
    if (filter?.source) { sql += ' AND source = ?'; params.push(filter.source); }
    if (filter?.status) { sql += ' AND status = ?'; params.push(filter.status); }
    if (filter?.startDate) { sql += ' AND created_at >= ?'; params.push(filter.startDate); }
    if (filter?.endDate) { sql += ' AND created_at <= ?'; params.push(filter.endDate); }
    if (filter?.agentVersion) { sql += ' AND json_extract(metadata, \'$.agentVersion\') = ?'; params.push(filter.agentVersion); }

    sql += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => this.rowToFeedback(r));
  }

  async updateStatus(id: string, status: string, note?: string): Promise<void> {
    const now = new Date().toISOString();
    const resolvedAt = status === 'resolved' || status === 'closed' ? now : null;

    if (note) {
      this.db.prepare('UPDATE feedback SET status = ?, updated_at = ?, resolved_at = ?, internal_note = ? WHERE id = ?')
        .run(status, now, resolvedAt, note, id);
    } else {
      this.db.prepare('UPDATE feedback SET status = ?, updated_at = ?, resolved_at = ? WHERE id = ?')
        .run(status, now, resolvedAt, id);
    }
  }

  async export(filter?: FeedbackFilter): Promise<Feedback[]> {
    return this.list(filter);
  }

  async getStats(): Promise<FeedbackStats> {
    const byType = this.db.prepare('SELECT type, COUNT(*) as count FROM feedback GROUP BY type').all() as any[];
    const byStatus = this.db.prepare('SELECT status, COUNT(*) as count FROM feedback GROUP BY status').all() as any[];
    const avgRating = this.db.prepare('SELECT AVG(rating) as avg FROM feedback WHERE type = \'rating\'').get() as any;

    return {
      total: byType.reduce((sum: number, r: any) => sum + r.count, 0),
      byType: Object.fromEntries(byType.map((r: any) => [r.type, r.count])),
      byStatus: Object.fromEntries(byStatus.map((r: any) => [r.status, r.count])),
      avgRating: avgRating?.avg ?? 0,
    };
  }

  private rowToFeedback(row: any): Feedback {
    return {
      id: row.id,
      type: row.type,
      source: row.source,
      status: row.status,
      severity: row.severity ?? undefined,
      rating: row.rating ?? undefined,
      description: row.description ?? undefined,
      context: JSON.parse(row.context ?? '{}'),
      metadata: JSON.parse(row.metadata ?? '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resolvedAt: row.resolved_at ?? undefined,
      internalNote: row.internal_note ?? undefined,
      consentGiven: true,
    };
  }
}
```

---

## 第4章 文件变更清单

| 文件 | 变更类型 | 变更说明 |
|------|---------|---------|
| `packages/agent-core/src/main/telemetry/types.ts` | **新增** | 所有类型定义（Feedback, FeedbackContext, TelemetryConfig 等） |
| `packages/agent-core/src/main/telemetry/config.ts` | **新增** | 配置加载与合并（默认值 + config.json） |
| `packages/agent-core/src/main/telemetry/context-collector.ts` | **新增** | 上下文采集器（3 种采集模式） |
| `packages/agent-core/src/main/telemetry/sanitizer.ts` | **新增** | 隐私脱敏处理器 |
| `packages/agent-core/src/main/telemetry/feedback-repository.ts` | **新增** | 反馈数据 CRUD（SQLite） |
| `packages/agent-core/src/main/telemetry/stats-repository.ts` | **新增** | 使用统计存储（内存 + 滚动清理） |
| `packages/agent-core/src/main/telemetry/exporter.ts` | **新增** | 反馈导出（JSON） |
| `packages/agent-core/src/main/telemetry/auto-error-reporter.ts` | **新增** | 自动错误报告（异常监听 + 采集 + 入库） |
| `packages/agent-core/src/main/telemetry/usage-stats-collector.ts` | **新增** | 使用统计 Pipeline 中间件 |
| `packages/agent-core/src/main/telemetry/qq-bot-feedback.ts` | **新增** | QQ Bot 反馈处理器（交互式引导） |
| `packages/agent-core/src/main/telemetry/dashboard-feedback.ts` | **新增** | Dashboard 反馈处理器 |
| `packages/agent-core/src/main/telemetry/index.ts` | **新增** | 模块入口，初始化所有组件 |
| `packages/agent-core/src/main/qq-bot/message-handler.ts` | 修改 | 增加 `反馈` 和 `反馈状态` 命令路由 |
| `packages/agent-core/src/main/pipeline/tool-dispatcher.ts` | 修改 | 集成 UsageStatsCollector 中间件 |
| `packages/agent-core/src/main/index.ts` | 修改 | 调用 `telemetry/index.ts` 初始化 |
| 前端：`src/renderer/pages/FeedbackPage.tsx` | **新增** | 反馈与帮助页面 |
| 前端：`src/renderer/components/FeedbackForm.tsx` | **新增** | 反馈表单组件 |
| 前端：`src/renderer/components/FeedbackList.tsx` | **新增** | 反馈列表组件 |
| 前端：`src/renderer/components/StatsOverview.tsx` | **新增** | 使用统计概览组件 |
| 前端：`src/renderer/components/PrivacyConsentDialog.tsx` | **新增** | 隐私同意弹窗 |
| 前端：`src/renderer/components/PrivacySettings.tsx` | **新增** | 隐私设置面板 |

---

## 第5章 测试计划

### 5.1 单元测试

| 测试文件 | 覆盖内容 | 用例数 |
|---------|---------|--------|
| `telemetry/context-collector.test.ts` | 3 种采集模式，边界情况，空数据 | 12 |
| `telemetry/sanitizer.test.ts` | 5 种敏感字段匹配，嵌套对象，字符串值 | 10 |
| `telemetry/feedback-repository.test.ts` | CRUD，筛选，状态变更，统计 | 12 |
| `telemetry/stats-repository.test.ts` | 工具调用记录，LLM 记录，清理，获取 | 8 |
| `telemetry/auto-error-reporter.test.ts` | 异常捕获，配置开关，采集失败兜底 | 6 |
| `telemetry/qq-bot-feedback.test.ts` | 3 种反馈流程，取消，状态查询，无效输入 | 14 |

### 5.2 集成测试

| 测试项 | 说明 |
|--------|------|
| QQ Bot 反馈全流程 | 模拟用户输入 → 引导 → 采集 → 入库 → 状态查询 |
| Dashboard 反馈提交 | 表单填写 → 提交 → 自动附加上下文 → 查看列表 |
| 自动错误报告 | 模拟未捕获异常 → 自动生成报告 → 数据库记录 |
| 使用统计 | 多次工具调用 → 统计面板数据正确 |
| 隐私脱敏 | 配置中包含敏感字段 → 存储为 `[REDACTED]` |

### 5.3 性能测试

| 指标 | 目标值 |
|------|--------|
| 上下文采集耗时 | < 200ms |
| 脱敏处理耗时 | < 50ms |
| 反馈入库耗时 | < 100ms |
| 自动错误报告总耗时 | < 500ms |
| 使用统计中间件额外开销 | < 1ms |

---

## 第6章 实施顺序

1. **阶段一**：`types.ts` → `config.ts` → `feedback-repository.ts` → `context-collector.ts` → `sanitizer.ts` → `exporter.ts`
2. **阶段二**：`auto-error-reporter.ts` → 修改 `index.ts` 入口
3. **阶段三**：`stats-repository.ts` → `usage-stats-collector.ts` → 修改 `tool-dispatcher.ts`
4. **阶段四**：`qq-bot-feedback.ts` → 修改 `message-handler.ts`
5. **阶段五**：`dashboard-feedback.ts` → 前端组件（`FeedbackPage.tsx`, `FeedbackForm.tsx`, `FeedbackList.tsx`, `StatsOverview.tsx`）
6. **阶段六**：`PrivacyConsentDialog.tsx` → `PrivacySettings.tsx` → `telemetry/index.ts` 模块入口
7. **阶段七**：单元测试 → 集成测试 → 手动验证

---

## 第7章 风险与应对

| 风险 | 影响 | 应对措施 |
|------|------|---------|
| 上下文采集耗时过长 | 用户等待反馈提交 | 异步入库，采集后立即回复用户，入库不阻塞 |
| 脱敏正则误匹配 | 正常字段被脱敏 | 白名单模式：只脱敏已知敏感键名，不对值做模式匹配 |
| 自动错误报告循环触发 | 异常处理中再抛异常 | capture 方法内用 try-catch 包裹，失败仅 console.error |
| 统计数据膨胀 | 数据库占用过大 | 30 天滚动窗口 + 定时清理 |
| 用户拒绝采集 | 无法获取诊断信息 | 尊重用户选择，所有功能降级为无上下文模式 |
| QQ Bot 反馈流程中断 | 用户中途离开 | 30 分钟会话超时自动清理，重新开始流程 |