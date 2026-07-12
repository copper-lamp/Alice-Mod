# Alice Mod Core V14 — 事件触发器 + QQ 完善（执行文档）

> 版本：v1.0
> 日期：2026-07-12
> 版本号：V14（第 17 周）
> 对应需求：AC-EVT-01 ~ AC-EVT-04、AC-QQ-07
> 关联文档：[AC-V14-事件触发器与QQ完善.md](AC-V14-事件触发器与QQ完善.md)、[AC-V14-事件触发器与QQ完善-架构文档.md](AC-V14-事件触发器与QQ完善-架构文档.md)

---

## 1. 目标与范围

### 1.1 本次实现目标

完成 Agent Core V14 事件触发器模块与 QQ 机器人完善功能，达到生产可用标准，并覆盖全场景单元测试。

具体目标：

1. 实现统一事件总线 EventBus，支持异步发布/订阅与过滤。
2. 实现 TriggerEngine 规则引擎，支持 keyword / regex / event_type / payload_field / composite / at_bot / private_msg / always 规则。
3. 实现 TriggerStore，持久化 event_triggers / trigger_logs / trigger_schedule 到 SQLite。
4. 实现四种触发器适配器：Cron / GameChat / PluginEvent / QQ。
5. 实现 ActionExecutor，支持 create_task / call_tool / send_llm / send_qq / store_memory / none 动作。
6. 实现 QQ 群管理工具（qq_group_manage）、主动通知工具（qq_notify）、远程指令解析器（RemoteCommandParser）。
7. 编写覆盖所有场景的单元测试，确保类型检查与测试全部通过。

### 1.2 非目标

- 不实现触发器可视化配置 UI（由后续版本提供）。
- 不实现事件触发器的 WebSocket 实时推送。
- 不实现 QQ 主动通知的合并窗口（当前为单事件单通知）。
- 不实现 Cron 表达式的复杂扩展（如 L、W、# 等特殊字符）。

### 1.3 前置依赖

| 依赖 | 说明 |
|------|------|
| V10 QQ 机器人 | OneBotClient、MessageHandler、PermissionManager |
| V13 任务系统 | TaskManager、任务创建接口 |
| V3 工作区管理 | workspaceId 用于事件隔离 |
| V4 Pipeline | ToolDispatcher 用于 call_tool 动作 |
| better-sqlite3 | 已在 agent-core/package.json 中 |
| node-cron | 已在 agent-core/package.json 中 |

---

## 2. 关键设计决策

### 2.1 触发器模块不依赖前端

事件触发器模块纯后端运行，通过 `TriggerModule` 入口类管理生命周期，对外提供 TypeScript API。配置可通过后续管理工具写入 SQLite。

### 2.2 事件去重窗口

插件事件采用 **5 秒内存去重窗口**，以 `source:type:payload` 为 key。该策略足以覆盖 Adapter Core 可能重复推送的同一事件，同时避免长期缓存导致内存增长。

### 2.3 Cron missed 补偿

仅对 `at` 类型的过期触发器进行一次性补偿，补偿数量上限 10 个。`cron` / `interval` 类型不做补偿，避免重启后任务堆积。

### 2.4 QQ 权限控制

- 远程指令需要 `COMMAND` 权限。
- 群管理工具由调用方（Sub-Agent / 主 Agent）负责权限校验，工具本身只做参数校验。
- MessageHandler 在路由和指令执行阶段进行双重权限检查。

---

## 3. 实现细节

### 3.1 事件总线

`EventBus` 使用 `setImmediate` 异步分发事件，订阅处理器异常通过 `safeHandle` 捕获，不影响其他处理器。

```typescript
publish(event: AgentEvent): void {
  setImmediate(() => {
    for (const { filter, handler } of this.handlers) {
      if (this.matchesFilter(event, filter)) {
        this.safeHandle(handler, event);
      }
    }
    const typeHandlers = this.typeHandlers.get(event.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        this.safeHandle(handler, event);
      }
    }
  });
}
```

### 3.2 规则引擎

`TriggerEngine.evaluate(event)` 按以下步骤评估：

1. 加载所有 enabled=true 的触发器。
2. 过滤 workspaceId（触发器 workspaceId 为空表示全局，否则必须匹配）。
3. 过滤 source（触发器 source 必须与事件 source 一致）。
4. 调用 `matchRule` 递归匹配规则。
5. 按 priority 降序排序返回匹配结果。

### 3.3 Cron 适配器

支持三种调度类型：

| 类型 | 说明 | 存储字段 |
|------|------|----------|
| cron | 标准 Cron 表达式 | `cron_expression` |
| at | 绝对时间戳，一次性 | `scheduled_at` |
| interval | 固定间隔秒数 | `interval_seconds` |

`start()` 时从数据库加载所有 cron 触发器并调度；`stop()` 清理所有定时器。

### 3.4 QQ 适配器

- 群聊消息根据 segments 检测 `@机器人` 或 `@全体成员`。
- 私聊消息事件类型为 `qq_private_msg`。
- 群聊 @机器人事件类型为 `qq_at_bot`。
- 普通群聊事件类型为 `qq_group_msg`。

### 3.5 ActionExecutor 模板渲染

支持 `{{event.payload.xxx}}` 占位符，可渲染嵌套路径。非字符串输入会安全转换为字符串。

```typescript
renderTemplate('玩家 {{event.payload.playerId}} 说: {{event.payload.message}}', event)
// => '玩家 p1 说: hello world'
```

### 3.6 QQ 远程指令

| 指令 | 权限 | 功能 |
|------|------|------|
| /status | COMMAND | 返回 Agent Core 运行状态 |
| /task list | COMMAND | 返回任务列表摘要 |
| /restart | COMMAND | 返回重启提示 |
| /help | COMMAND | 返回指令列表 |

### 3.7 QQ 群管理工具

| 动作 | 必填参数 | OneBot API |
|------|----------|------------|
| kick | group_id, user_id | set_group_kick |
| mute | group_id, user_id, duration | set_group_ban |
| set_card | group_id, user_id, card | set_group_card |
| approve_join | group_id, flag, approve?, reason? | set_group_add_request |
| recall | group_id, message_id | delete_msg |

---

## 4. 文件变更清单

### 4.1 新增文件

```
packages/agent-core/src/main/trigger/
├── index.ts                            # TriggerModule 入口
├── types.ts                            # 事件触发器类型定义
├── event-bus.ts                        # 事件总线
├── trigger-engine.ts                   # 规则引擎
├── trigger-store.ts                    # 触发器存储
├── action-executor.ts                  # 动作执行器
└── adapters/
    ├── index.ts                        # 适配器统一导出
    ├── cron-adapter.ts                 # Cron 定时适配器
    ├── game-chat-adapter.ts            # 游戏聊天适配器
    ├── plugin-event-adapter.ts         # 插件事件适配器
    └── qq-trigger-adapter.ts           # QQ 渠道适配器

packages/agent-core/src/main/qq-bot/
├── tools/
│   ├── qq_group_manage.ts              # 群管理工具
│   └── qq_notify.ts                    # 主动通知工具
├── remote-command-parser.ts            # 远程指令解析器
└── proactive-notifier.ts               # 主动通知器（已存在/增强）

packages/agent-core/__tests__/trigger/
├── trigger-engine.test.ts              # TriggerEngine / EventBus / TriggerStore 测试
├── trigger-adapters.test.ts            # 四种适配器测试
├── action-executor.test.ts             # 动作执行器测试
└── trigger-module.test.ts              # TriggerModule 集成测试

packages/agent-core/__tests__/qq-bot/
├── remote-command-parser.test.ts       # 远程指令解析器测试
└── tools-group-manage.test.ts          # 群管理工具与主动通知工具测试
```

### 4.2 修改文件

| 文件 | 修改内容 |
|------|----------|
| `packages/agent-core/src/main/qq-bot/message-handler.ts` | 增加快速指令路由与权限检查 |
| `packages/agent-core/src/main/qq-bot/onebot-client.ts` | 新增群管理 API |
| `packages/agent-core/src/main/tcp/tcp-server.ts` | TCP 消息路由（已有） |
| `packages/agent-core/src/main/pipeline/tool-dispatcher.ts` | 跨工作区工具调用（已有） |
| `packages/agent-core/__tests__/workspace/workspace-manager.test.ts` | 修复 WorkspaceManager 初始化 |
| `packages/agent-core/__tests__/workspace/workspace-handler.test.ts` | 修复实例名称断言 |

---

## 5. 测试验证

### 5.1 测试覆盖

| 模块 | 测试文件 | 覆盖场景 |
|------|----------|----------|
| EventBus | trigger-engine.test.ts | 异步分发、过滤订阅、类型订阅、异常隔离、清除 |
| TriggerEngine | trigger-engine.test.ts | keyword/regex/event_type/payload_field/composite/at_bot/private_msg/always 规则、冷却、最大触发次数、优先级、插件事件去重 |
| TriggerStore | trigger-engine.test.ts | CRUD、日志、调度配置、清理 |
| CronTriggerAdapter | trigger-adapters.test.ts | cron/at/interval 调度、取消调度、启动加载、missed 补偿、禁用触发器 |
| GameChatTriggerAdapter | trigger-adapters.test.ts | 事件转换、字段缺失校验 |
| PluginEventTriggerAdapter | trigger-adapters.test.ts | 事件转换、字段缺失校验 |
| QQTriggerAdapter | trigger-adapters.test.ts | 群消息/私聊/@机器人/@全体成员/字段缺失 |
| ActionExecutor | action-executor.test.ts | 所有动作类型、依赖缺失、模板渲染、异常捕获 |
| TriggerModule | trigger-module.test.ts | 生命周期、CRUD、handleRawEvent、cron 自动调度、日志记录、内存触发器 |
| RemoteCommandParser | remote-command-parser.test.ts | /status /task /restart /help / 未知指令 |
| qq_group_manage | tools-group-manage.test.ts | kick/mute/set_card/approve_join/recall 与参数校验 |
| qq_notify | tools-group-manage.test.ts | 发送通知、模板渲染、空内容校验 |

### 5.2 验证命令

```bash
# 类型检查
pnpm typecheck

# 单元测试
pnpm test
```

### 5.3 测试结果

- 类型检查：通过（`tsc --noEmit` 无错误）
- 单元测试：63 个测试文件，844 个测试用例，全部通过

---

## 6. 集成检查点

- [x] `event_triggers` / `trigger_logs` / `trigger_schedule` 表 DDL 就绪
- [x] EventBus 支持发布/订阅，异步分发不阻塞
- [x] TriggerEngine 支持所有规则类型
- [x] CronTriggerAdapter 支持三种调度方式
- [x] GameChatTriggerAdapter 正确转换事件
- [x] PluginEventTriggerAdapter 正确转换事件
- [x] QQTriggerAdapter 正确检测 @机器人 / 私聊
- [x] ActionExecutor 支持所有动作类型
- [x] 触发器配置和日志持久化到 SQLite
- [x] 重启后 cron 触发器自动恢复
- [x] qq_group_manage 工具可执行所有群管理动作
- [x] 远程指令解析器支持 /status、/task list、/restart、/help
- [x] 主动通知工具支持模板渲染
- [x] 所有事件触发流程写入日志
- [x] 类型检查与单元测试全部通过

---

## 7. 已知限制与后续优化

| 限制 | 说明 | 后续计划 |
|------|------|----------|
| 无 UI 配置 | 触发器目前需通过代码/API 创建 | V15 提供触发器管理面板 |
| 主动通知无合并 | 同类事件连续触发会连续发送通知 | 后续增加 5s 合并窗口 |
| Cron 仅支持标准 5 字段 | 不支持秒级和特殊字符 | 根据需求评估是否扩展 |
| 插件事件订阅未显式注册 | 当前依赖 Adapter Core 主动推送 | 后续增加事件订阅协商机制 |

---

## 8. 风险与应对

| 风险 | 影响 | 概率 | 应对措施 |
|------|------|:----:|----------|
| Cron 任务 missed 补偿导致重启后任务堆积 | 系统负载突增 | 中 | 补偿数量上限 10 个，超出丢弃并记录 |
| 事件规则配置错误导致高频触发 | 任务队列爆满 / QQ 刷屏 | 中 | 默认冷却、最大触发次数限制 |
| QQ 群管理 API 权限不足 | 操作失败 | 中 | 调用前检查角色，失败返回明确错误 |
| 插件事件格式不兼容 | 触发器解析失败 | 中 | 解析失败记录日志并丢弃 |
| 远程指令被恶意利用 | 安全风险 | 低 | 严格权限控制，操作日志完整记录 |
