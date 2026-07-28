# AC 智能体详情页运行模块实施文档

## 一、需求

本模块仅实现智能体详情页的运行前端与数据层，不修改设置表单、全局布局、UI Store 或现有详情页骨架。运行模块提供紧凑身份与运行控制、全部/游戏/QQ 来源筛选、全部/消息/工具/系统类型筛选、主与 QQ 历史合并、流式事件、5 秒轮询、手动刷新、向前分页、QQ 清空确认和自动跟随。运行摘要迁移上下文窗口、Token 用量、最近七日用量及待办事项，并明确部分数据属于工作区或全局维度。

## 二、架构

`AgentHeader` 独立封装启停、假人上下线与运行状态轮询。`AgentRuntimeView` 持有来源、类型、渠道栏、摘要和自动跟随等局部 UI 状态；`ChannelRail`、`RuntimeToolbar`、`RuntimeSummary` 分别负责渠道、工具栏和摘要。`useAgentLogs` 统一调用 `lib/ipc.ts`，并行读取主历史与 QQ 历史，完成去重排序、筛选、流式订阅、轮询、分页及清空。日志展示复用 `MessageList`、`MessageBubble`、`ThinkingBlock` 和 `ToolCallBlock`。

## 三、执行

1. 在 `lib/types.ts` 增加运行日志来源、类型、运行状态和 IPC mutation 类型。
2. 在 `lib/ipc.ts` 增加运行状态、启停、假人控制和 QQ 清空包装，并扩展历史查询 options。
3. 新增 `useAgentLogs`，统一主/QQ 历史和实时数据流。
4. 新增运行页组件，并保持灰白语义配色、弱边框与 HeroUI v3 compound API。
5. 扩展 `MessageList` 的自动跟随、用户上滚暂停、顶部分页入口和可配置空状态。
6. 执行 `pnpm --filter @mcagent/agent-core typecheck`，修复本模块范围内类型错误。
