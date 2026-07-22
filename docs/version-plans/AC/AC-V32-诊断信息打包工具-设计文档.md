# AC-V32 — 诊断信息打包工具

> 版本：v3.0
> 日期：2026-07-23
> 版本号：V32
> 类型：设计文档

---

## 1. 概述

后台自动生成诊断信息 ZIP 包，包含 17 个维度的全量数据，用于大规模数据分析找出优化点。用户只需要找到压缩包文件发给开发者。

### 关键约束

| 条目 | 值 |
|------|-----|
| **最大体积** | 200MB（默认 5MB 日志，严格模式 1MB 日志） |
| **生成方式** | 后台自动，无需用户操作 |
| **用户操作** | 0 — 用户只负责找到 `.zip` 文件并发送 |
| **输出位置** | `%APPDATA%/alice-mod/diagnose/diagnose_*.zip` |

---

## 2. 触发时机

| 时机 | 说明 |
|------|------|
| **应用启动时** | 每次启动自动生成一份 |
| **异常崩溃后** | 下次启动检测到崩溃标记，额外生成带 `_crash` 后缀的包 |
| **定时生成** | 每 24 小时自动生成一份 |
| **保留策略** | 保留最近 3 份，自动清理旧的 |

---

## 3. 打包内容 — 17 维数据

### 文件清单

```
diagnose_20260723_143022.zip
├── 01_info.json                 # 基础环境信息
├── 02_config_snapshot.json      # 配置快照（脱敏）
├── 03_system_detail.json        # 详细系统信息
├── 04_performance_metrics.json  # 性能指标
├── 05_recent_logs.txt           # 最近日志（最大 5MB）
├── 06_error_summary.json        # 错误汇总
├── 07_tool_call_history.json    # 工具调用历史（最近 500 条）
├── 08_llm_stats.json            # LLM 调用统计（聚合）
├── 09_llm_call_records.json     # LLM 调用明细（最近 500 条）
├── 10_agent_stats.json          # Agent 统计
├── 11_qq_bot_stats.json         # QQ Bot 统计
├── 12_workspace_list.json       # 工作区列表
├── 13_game_state.json           # 游戏状态
├── 14_memory_stats.json         # 记忆系统统计
├── 15_network_stats.json        # 网络连接统计
├── 16_database_schema.json      # 数据库表概览
└── 17_event_timeline.json       # 事件时间线
```

### 3.1 01_info.json — 基础环境

字段：`agentVersion`, `buildTime`, `os`, `osVersion`, `cpuModel`, `cpuCores`,
`totalMemory`, `freeMemory`, `nodeVersion`, `electronVersion`, `chromeVersion`,
`v8Version`, `memoryUsage` (heapUsed/Total/RSS/external/arrayBuffers),
`adapterTypes`, `uptimeSeconds`, `processStartTime`, `generationCount`

### 3.2 02_config_snapshot.json — 配置快照

读取 `config.json` + SQLite `config` 表，递归跳过敏感键名（`apiKey`, `token`,
`password`, `secret` 等），替换为 `[REDACTED]`。

### 3.3 03_system_detail.json — 详细系统

`hostname`, `platform`, `networkInterfaces` (所有网卡地址/MAC), `env`
(白名单环境变量), `cwd`, `pid`, `locale`, `timezone`, `paths`
(userData/appData/home/desktop/downloads/logs/exe)

### 3.4 04_performance_metrics.json — 性能

```
memory: { heapUsed, heapTotal, rss, external, arrayBuffers, heapUsedPercent }
cpu:    { user, system, percentUsage }
handles: { handleCount, activeHandles, activeRequests }
```

### 3.5 05_recent_logs.txt — 日志

从 SQLite `logs` 表读取最近 20000 条日志，最大 5MB，超长从末尾截断。
每行格式：`[YYYY-MM-DD HH:mm:ss] [LEVEL] [MODULE] message`

可用于分析的维度：
- 错误率趋势
- 各模块日志量分布
- 频次/模式分析

### 3.6 06_error_summary.json — 错误汇总

| 字段 | 说明 |
|------|------|
| `totalErrors` | 总错误数 |
| `totalWarnings` | 总警告数 |
| `byModule` | 按模块统计 error/warning 数 |
| `byLevel` | 按级别分布 |
| `hourlyDistribution` | 按小时分布 |
| `topErrorMessages` | TOP 20 常见错误消息 |
| `toolErrors` | 工具调用错误，按 toolName 聚合 |
| `llmErrors` | LLM 错误，按 provider+model 聚合，含 commonErrors 分布 |
| `errorRate` | 每 1000 条日志的错误率趋势（滑动窗口） |

### 3.7 07_tool_call_history.json — 工具调用

从 `tool_call_records` 获取，紧凑格式：
```json
[{"t":"move_to","s":"success","c":"movement","d":1500,"ts":1700000000000,"e":"timeout","ct":1700000001500}]
```
每条记录包含：toolName, status, category, durationMs, timestamp, error, completedAt。

### 3.8-09 — LLM 数据

**08_llm_stats.json**（聚合统计）：

| 字段 | 说明 |
|------|------|
| `summary.totalCalls` | 总调用次数 |
| `summary.totalTokens` | 总 Token 消耗 |
| `summary.totalCost` | 粗略估算费用（$） |
| `summary.avgDurationMs` | 平均耗时 |
| `summary.successRate` | 成功率 |
| `byProvider` | 按 Provider 聚合 |
| `byModel` | 按 Model 聚合 |
| `hourlyDistribution` | 按小时调用量 |
| `tokenTrend` | Token 趋势（每 N 条抽样） |
| `failures` | 失败详情列表 |

**09_llm_call_records.json**（明细）：
从 SQLite 导出最近 500 条，每条包含 provider, model, tokens, duration, error。

### 3.10 10_agent_stats.json — Agent

从 `agents` 表读取，字段：
`totalAgents`, `enabledAgents`, `mainAgents`, `qqBoundAgents`, `agents[]`
每条 agent 含：id, name, enabled, isMain, qqBound, toolCount, modelProvider, modelName

### 3.11 11_qq_bot_stats.json — QQ Bot

| 字段 | 数据来源 |
|------|---------|
| `messages.totalIncoming` | qq_msg_history 表 |
| `messages.totalOutgoing` | qq_msg_history 表 |
| `messages.byType` | 按 group/private 分布 |
| `messages.byUser` | 按 user_id 分布（TOP 50） |
| `messages.hourlyDistribution` | 按小时分布 |

### 3.12 12_workspace_list.json — 工作区

从 `workspace_meta` 表读取，每条含：id, name, instanceId, edition, connected,
connectionId, toolsRegistered, uptimeSeconds, createdAt, state, modVersion。

### 3.13 13_game_state.json — 游戏状态

当前活跃工作区的连接状态：connected, adapterType, protocolVersion。

### 3.14 14_memory_stats.json — 记忆系统

| 字段 | 数据来源 |
|------|---------|
| `totalMemories` | memory_meta COUNT |
| `byType` | 按 type 分布 |
| `byBranch` | 按 branch 分布 |
| `totalTags` | memory_tags COUNT |
| `totalMapFeatures` | map_features COUNT |
| `totalRegions` | map_regions COUNT |

### 3.15 15_network_stats.json — 网络

TCP 服务器状态（port, isListening, totalConnections, currentConnections）+ 活跃连接列表。

### 3.16 16_database_schema.json — 数据库

所有表的 `name`, `rowCount`, `columns`, `dbSizeBytes`, `dbPath`。

### 3.17 17_event_timeline.json — 事件时间线

关键事件按时间排序：启动、工作区创建、工作区上线、连接状态变更。

---

## 4. 体积控制

| 策略 | 说明 |
|------|------|
| **日志截断 5MB** | 默认保留 20000 条/5MB，超长从末尾截断 |
| **JSON 紧凑格式** | 所有 JSON 无缩进，短字段名（`t`/`s`/`d`） |
| **ZIP level 9** | 最高压缩比 |
| **严格模式** | 超 200MB 自动重试：日志缩至 1MB + 工具调用缩至 100 条 |
| **估算大小** | 典型值 2-5MB，最多 ~50MB（日志密集场景） |

---

## 5. 可分析维度

收集的数据覆盖以下分析方向：

| 分析方向 | 对应文件 | 可回答的问题 |
|---------|---------|------------|
| **LLM 成本** | 08, 09 | 哪个 Provider/Model 最贵？Token 趋势？缓存命中率？ |
| **性能瓶颈** | 01, 04 | 内存泄漏？CPU 瓶颈？事件循环阻塞？ |
| **错误模式** | 05, 06, 07, 09 | 哪些模块错误最多？工具调用失败率趋势？LLM 常见错误？ |
| **使用频率** | 07, 08, 11, 16 | 最常用的工具？每日 LLM 调用量？QQ 消息量？数据库增长？ |
| **用户行为** | 11 | 活跃用户 TOP？消息时段分布？ |
| **配置分布** | 02 | 用户最常改哪些配置？默认值覆盖率？ |
| **稳定性** | 01, 06, 17 | 崩溃频率？工作区重连次数？错误率趋势？ |
| **系统环境** | 03 | 用户 OS 分布？Node/Electron 版本分布？ |

---

## 6. 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `packages/agent-core/src/main/diagnose/types.ts` | **新增/重写** | 17 维数据类型定义 |
| `packages/agent-core/src/main/diagnose/collector.ts` | **新增/重写** | 全量采集（SQLite + 系统 + 运行时） |
| `packages/agent-core/src/main/diagnose/packer.ts` | **更新** | 17 文件打包 + 体积校验 |
| `packages/agent-core/src/main/diagnose/scheduler.ts` | 无变化 | 自动调度逻辑不变 |
| `packages/agent-core/src/main/diagnose/index.ts` | 更新 | 导出新增类型 |
| `packages/agent-core/src/main/index.ts` | 无变化 | 启动调用已存在 |