# AC-V32 — 用户体验优化信息搜集模块

> 版本：v1.0
> 日期：2026-07-23
> 版本号：V32
> 类型：需求文档
> 关联文档：[架构文档](AC-V32-用户体验优化信息搜集模块-架构文档.md)、[执行文档](AC-V32-用户体验优化信息搜集模块-执行文档.md)、[IT-04-集成测试总结与上线检查清单.md](../IT/IT-04-集成测试总结与上线检查清单.md)

---

## 第1章 概述

### 1.1 背景

Alice Mod 即将进入测试版本发布阶段，需要一套系统化的机制来收集用户反馈和使用数据。当前系统中缺乏统一的信息搜集通道，问题反馈依赖用户手动描述，诊断信息分散在日志、数据库、网络抓包等多个来源，获取成本高、信息不完整。

### 1.2 目标

设计并实现一套**用户体验优化信息搜集模块**，达成以下目标：

| 目标 | 说明 |
|------|------|
| **降低反馈门槛** | 用户只需简单操作即可提交反馈，无需手动收集环境信息 |
| **自动上下文采集** | 反馈时自动附带游戏状态、工具调用链、系统日志、配置文件等诊断信息 |
| **多渠道收集** | 支持 QQ Bot 和 Dashboard 两种反馈入口 |
| **结构化存储** | 反馈数据统一存储，支持分类、搜索、导出 |
| **隐私可控** | 用户知晓并同意采集内容，敏感信息可脱敏 |

### 1.3 范围

| 在范围内 | 不在范围内 |
|---------|-----------|
| QQ Bot 一键反馈（bug / 建议 / 评分） | 第三方监控平台集成（如 Sentry、Grafana） |
| Dashboard 反馈表单（含自动上下文） | 自动化告警系统 |
| 自动上下文采集（游戏状态、工具调用链、近期日志） | 用户行为追踪（不记录与问题无关的操作） |
| 反馈数据存储与管理 | 数据分析与可视化面板 |
| 使用统计（功能调用频率、错误率） | A/B 测试框架 |
| 用户同意机制与隐私设置 |  |

### 1.4 设计原则

1. **用户无负担**：反馈过程尽量简洁，一键提交为主，手动描述为辅。
2. **自动附加上下文**：反馈时自动打包当前环境信息，减少用户描述成本。
3. **隐私透明**：明确告知用户采集了什么信息，提供禁用选项。
4. **可追溯**：每条反馈关联时间、用户、Agent 实例、版本号，便于定位问题。
5. **低侵入**：信息采集不影响主业务流程，异步执行，不阻塞正常操作。

---

## 第2章 功能需求

### 2.1 QQ Bot 一键反馈

| 编号 | 需求 | 验收标准 |
|------|------|---------|
| FB-REQ-01 | 用户可通过 QQ Bot 发送 `反馈` 命令进入反馈流程 | 输入 `反馈` 后 Bot 回复引导菜单 |
| FB-REQ-02 | 支持三种反馈类型：`bug` / `建议` / `评分` | 用户选择后进入对应流程 |
| FB-REQ-03 | Bug 反馈时自动采集上下文信息：游戏状态、最近 5 条工具调用链、最近 20 条日志 | 提交反馈时附带完整上下文包 |
| FB-REQ-04 | Bug 反馈支持用户手动补充描述 | 用户可在 Bot 引导下输入文字描述 |
| FB-REQ-05 | 建议反馈提供简短输入框，用户填写建议内容 | 建议内容存储到反馈数据库 |
| FB-REQ-06 | 评分反馈提供 1-5 星评分 + 可选文字描述 | 评分数据可统计 |
| FB-REQ-07 | 反馈提交后 Bot 回复感谢消息并附带反馈编号 | 用户收到 `感谢反馈！编号：FB-20260723-001` |
| FB-REQ-08 | 支持反馈状态查询：用户输入 `反馈状态 <编号>` 查看处理进度 | 返回对应反馈的当前状态 |

### 2.2 Dashboard 反馈表单

| 编号 | 需求 | 验收标准 |
|------|------|---------|
| FB-REQ-09 | Dashboard 设置页面新增「反馈与帮助」Tab | 侧边栏可见，点击进入反馈页面 |
| FB-REQ-10 | 反馈表单包含：类型选择、严重程度、描述输入、截图上传 | 表单字段齐全，可提交 |
| FB-REQ-11 | 提交时自动附带：Agent 版本、OS 信息、Node.js 版本、MC 版本、Adapter 版本 | 反馈详情中可查看完整环境信息 |
| FB-REQ-12 | 提交时自动附带：近期日志摘要（最近 50 行 error/warn 级别日志） | 日志自动附加在反馈中 |
| FB-REQ-13 | 提交时自动附带：当前配置快照（config.json 的关键字段，脱敏处理） | 配置快照脱敏后附加 |
| FB-REQ-14 | 用户可查看已提交反馈列表及状态 | 列表页展示历史反馈 |

### 2.3 自动错误报告

| 编号 | 需求 | 验收标准 |
|------|------|---------|
| FB-REQ-15 | Agent 核心发生未捕获异常时，自动生成错误报告 | 异常触发自动报告生成 |
| FB-REQ-16 | 自动报告包含：错误堆栈、内存使用、Uptime、最近 10 次工具调用 | 报告内容完整 |
| FB-REQ-17 | 自动报告异步写入反馈数据库，不阻塞主进程 | 应用正常运行不受影响 |
| FB-REQ-18 | 用户可配置是否启用自动错误报告（默认启用） | config.json 中新增 `telemetry.errorReport` 开关 |

### 2.4 使用统计

| 编号 | 需求 | 验收标准 |
|------|------|---------|
| FB-REQ-19 | 记录工具调用频率、成功/失败次数、平均耗时 | 统计数据可查询 |
| FB-REQ-20 | 记录 LLM 调用次数、token 消耗、平均响应时间 | 统计数据可查询 |
| FB-REQ-21 | 记录 Agent 实例运行时长、连接状态变化 | 统计数据可查询 |
| FB-REQ-22 | 用户可查看自己的使用统计概览（Dashboard） | Dashboard 展示统计图表 |
| FB-REQ-23 | 用户可配置是否开启使用统计（默认关闭） | config.json 中新增 `telemetry.usageStats` 开关 |

### 2.5 反馈数据管理

| 编号 | 需求 | 验收标准 |
|------|------|---------|
| FB-REQ-24 | 反馈数据存储到 SQLite 数据库，独立表 `feedback` | 数据库表结构定义完成 |
| FB-REQ-25 | 支持按类型、时间、状态、版本筛选反馈 | 筛选功能可用 |
| FB-REQ-26 | 支持反馈状态流转：`待处理` → `处理中` → `已解决` / `已关闭` | 状态变更可记录 |
| FB-REQ-27 | 支持反馈导出为 JSON 格式 | 导出功能可用 |
| FB-REQ-28 | 支持为反馈添加内部备注（不影响用户可见内容） | 备注字段存储 |

### 2.6 隐私与同意

| 编号 | 需求 | 验收标准 |
|------|------|---------|
| FB-REQ-29 | 首次启动时提示用户是否同意采集信息 | 弹窗显示 `同意` / `拒绝` / `自定义` |
| FB-REQ-30 | 用户可在 Dashboard 设置中随时修改隐私偏好 | 设置生效后立即遵循 |
| FB-REQ-31 | 采集的信息中自动过滤敏感字段（API Key、Token、密码等） | 正则匹配替换为 `[REDACTED]` |
| FB-REQ-32 | 用户可查看已采集的信息内容摘要 | Dashboard 展示采集摘要页 |

---

## 第3章 非功能需求

| 编号 | 需求 | 说明 |
|------|------|------|
| FB-NFR-01 | 反馈提交响应时间 < 1s（自动上下文采集后异步入库） | 不阻塞用户操作 |
| FB-NFR-02 | 自动错误报告采集时间 < 500ms | 异常时快速生成报告 |
| FB-NFR-03 | 上下文采集包大小 < 1MB | 避免存储膨胀 |
| FB-NFR-04 | 使用统计数据存储不超过 30 天滚动窗口 | 自动清理旧数据 |
| FB-NFR-05 | 隐私脱敏正则匹配覆盖率 > 95% 已知敏感字段 | 覆盖 API Key、Token、密码、密钥等 |
| FB-NFR-06 | 所有信息采集操作通过中间件异步执行，不阻塞主流程 | 无侵入式设计 |

---

## 第4章 数据模型

### 4.1 反馈数据库表

```sql
CREATE TABLE feedback (
  id          TEXT PRIMARY KEY,         -- 反馈编号 FB-YYYYMMDD-NNN
  type        TEXT NOT NULL,            -- bug / suggestion / rating / auto_report
  source      TEXT NOT NULL,            -- qq_bot / dashboard / auto
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending / processing / resolved / closed
  severity    TEXT,                     -- low / medium / high / critical (仅 bug)
  rating      INTEGER,                  -- 1-5 评分 (仅评分类型)
  description TEXT,                     -- 用户描述
  context     TEXT,                     -- JSON: 自动采集的上下文包
  metadata    TEXT,                     -- JSON: 版本/环境信息
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  resolved_at TEXT,
  internal_note TEXT                    -- 内部备注
);
```

### 4.2 上下文包结构

```json
{
  "agentVersion": "1.0.0",
  "os": "Windows 10",
  "nodeVersion": "20.11.0",
  "mcVersion": "1.21.4",
  "adapterType": "JE",
  "gameState": {
    "health": 18,
    "hunger": 16,
    "dimension": "minecraft:overworld",
    "position": { "x": 100, "y": 64, "z": -200 }
  },
  "recentToolCalls": [
    { "tool": "move_to", "params": { "target": "..." }, "success": true, "durationMs": 1500 }
  ],
  "recentLogs": [
    { "level": "error", "message": "...", "timestamp": "2026-07-23T10:00:00Z" }
  ],
  "configSnapshot": {
    "llm": { "provider": "deepseek", "model": "deepseek/deepseek-v4-flash" },
    "telemetry": { "errorReport": true, "usageStats": false }
  },
  "errorStack": "..."  // 仅自动报告类型
}
```

### 4.3 使用统计结构

```json
{
  "toolCallStats": {
    "totalCalls": 256,
    "successCount": 240,
    "failCount": 16,
    "avgDurationMs": 320,
    "byTool": {
      "move_to": { "calls": 80, "success": 75, "fail": 5, "avgDurationMs": 1500 },
      "bot_info": { "calls": 120, "success": 120, "fail": 0, "avgDurationMs": 50 }
    }
  },
  "llmStats": {
    "totalCalls": 128,
    "totalTokens": 256000,
    "avgResponseTimeMs": 2800
  },
  "sessionStats": {
    "uptimeSeconds": 86400,
    "connections": 2
  }
}
```

---

## 第5章 验收标准

| 验收项 | 预期结果 | 验证方式 |
|--------|---------|---------|
| QQ Bot 一键反馈 | 用户输入 `反馈` 后进入引导流程，可提交 bug/建议/评分 | 手动测试 |
| 自动上下文采集 | Bug 反馈时自动附带游戏状态、工具调用链、日志 | 查看反馈详情 |
| Dashboard 反馈表单 | 表单可提交，自动附带环境信息和日志 | 手动测试 |
| 自动错误报告 | 未捕获异常自动生成报告并入库 | 模拟异常 |
| 使用统计 | 工具调用、LLM 调用数据可查询 | Dashboard 查看 |
| 隐私脱敏 | API Key 等敏感字段被替换为 `[REDACTED]` | 查看上下文包 |
| 反馈状态管理 | 状态流转正常，用户可查询 | 全流程测试 |
| 反馈导出 | 导出为 JSON 文件 | 导出功能测试 |

---

## 第6章 附录

### 附录 A：敏感字段脱敏规则

| 字段模式 | 匹配示例 | 处理方式 |
|---------|---------|---------|
| `apiKey` / `api_key` / `apikey` | `"apiKey": "sk-xxx"` | `[REDACTED]` |
| `token` | `"token": "mct_xxx"` | `[REDACTED]` |
| `password` / `passwd` | `"password": "123456"` | `[REDACTED]` |
| `secret` | `"secret": "xxx"` | `[REDACTED]` |
| `authorization` | `"authorization": "Bearer xxx"` | `[REDACTED]` |

### 附录 B：配置项

```json
{
  "telemetry": {
    "consentGiven": false,
    "errorReport": true,
    "usageStats": false,
    "maxContextSizeBytes": 1048576,
    "logLinesToCapture": 50,
    "toolCallsToCapture": 10,
    "statsWindowDays": 30
  }
}
```