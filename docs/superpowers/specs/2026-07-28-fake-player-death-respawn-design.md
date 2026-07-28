# 假人死亡与原版重生设计

## 需求

### 目标

1. Carpet 假人死亡后不退出服务器、不重新登录，外部状态持续为在线。
2. 死亡后等待固定 40 个服务端 tick（正常 TPS 下约 2 秒），再按 Minecraft 1.21.4 原版玩家规则复活。
3. 原版逻辑负责床、重生锚、世界出生点、重生点失效、死亡掉落、经验、统计及游戏规则。
4. 死亡等待期间，依赖活体玩家的动作工具返回结构化 `BOT_DEAD`，状态查询和 Agent Core 本地工具仍可用。
5. Agent Core 自动填入并保护 `agent_id`、`bot_name`、`bot_uuid`，LLM 无法操控未授权假人。
6. 所属 Agent 能获取完整死亡及重生记录：空闲时自动唤醒，执行任务时注入当前任务，不并发启动第二个任务。

### 已确认行为

- 死亡等待期间 `online=true`，并返回 `alive=false`、`state=dead_waiting`。
- 动作类工具失败；`bot_info`、`bot_list`、记忆、知识、搜索、Wiki 和任务状态可用。
- Agent 执行中收到死亡事件时只注入事件；若当前流程即将结束，消费事件后追加一轮 LLM，保证记录不丢失。
- 重生事件采用相同的运行中注入或空闲唤醒机制。

### 验收标准

- 死亡后没有 `lost connection`、`left the game`、重新登录、`bot_despawn` 或 `bot_spawn`。
- 约 40 tick 后触发一次 `bot_respawn`，状态恢复为 `alive=true`、`state=alive`。
- 有效床或重生锚生效；无有效个人重生点时回世界出生点。
- `keepInventory`、掉落、经验和统计遵循服务器规则。
- 死亡等待期间动作工具稳定返回 `BOT_DEAD`，不返回超时、`NOT_FOUND` 或操作其他假人。
- 伪造业务参数中的 `agent_id`、`bot_name`、`bot_uuid` 不改变实际授权目标。
- 空闲 Agent 自动处理死亡；运行中 Agent 在当前上下文看到死亡及工具失败记录，且没有并发 `handle()`。

## 架构

### 1. Adapter 假人生命周期

在 `BotManager` 中为每个假人维护显式状态：

- `ALIVE`
- `DEAD_WAITING`
- `RESPAWNING`

死亡时保留 UUID、死亡实体引用、死亡 tick、死亡消息、位置和维度。状态始终属于已登录玩家，不通过是否存在于 `bots` Map 推断在线状态。

新增针对 `carpet.patches.EntityPlayerMPFake` 的 Mixin。Carpet 1.21.4 的 `die(DamageSource)` 已先调用 `super.die(...)`，随后调用 `kill(Component)`。Mixin 只阻止死亡路径末尾的 `kill`，保留原版死亡结算，不影响管理员显式 kill、下线或 duplicate-login 行为。

40 tick 到期后，在服务端主线程调用已通过本地映射 JAR 验证存在的 API：

```java
server.getPlayerList().respawn(deadPlayer, false, Entity.RemovalReason.KILLED)
```

Minecraft 1.21.4 的 `PlayerList.respawn(ServerPlayer, boolean, Entity.RemovalReason)` 会调用原版重生点逻辑。Carpet 自带 `PlayerList_fakePlayersMixin`，将该方法创建的新 `ServerPlayer` 重定向为 `EntityPlayerMPFake.respawnFake(...)`，无需手工复制或猜测重生算法。

重生成功后，BotManager 原子替换 `bots` 和名称索引中的实体引用，清理死亡状态，触发一次 `bot_respawn`。失败时保留 `DEAD_WAITING` 并记录错误，不回退为重新登录。

### 2. 可信 Agent 与假人身份

Agent Core 根据已加载 Agent 配置、workspace 和持久化 UUID 绑定生成不可由 LLM 控制的调用元数据：

- `agent_id`
- `bot_name`
- `bot_uuid`

元数据位于 `tool_call` 或 `tool_call_batch` 的顶层调用上下文，不位于 LLM 生成的 `parameters` 内。Adapter 忽略业务参数中任何同名字段。

Adapter 根据本地 Agent 配置和 BotRepository 校验三者一致性。校验失败返回 `BOT_ACCESS_DENIED`，禁止回退到 `BotAccess.getBot()` 的“第一个假人”行为。

单工具 Trigger 调用也必须具有明确 Agent 目标；无法解析身份时拒绝执行依赖假人的动作工具。

### 3. 死亡态工具门禁

在 Java 工具统一入口建立可信调用上下文，并在调用具体工具前检查目标 Bot 生命周期。

受门禁保护的 Adapter 动作工具包括：

- movement
- combat/entity
- block
- inventory
- survival
- chat
- 依赖玩家实体的 perception

目标状态为 `DEAD_WAITING` 或 `RESPAWNING` 时返回：

```json
{
  "success": false,
  "error": {
    "reason": "BOT_DEAD",
    "detail": "Bot 'hads' is dead and waiting to respawn",
    "details": {
      "bot_name": "hads",
      "state": "dead_waiting",
      "respawn_in_ticks": 27
    }
  }
}
```

`bot_info` 和 `bot_list` 不失败，返回 `online`、`alive`、`state` 和 `respawn_in_ticks`。Agent Core 本地工具不经过 Adapter，不受门禁影响。

单调用与批调用都复用同一个门禁，失败结果继续写入工具日志和 Agent 对话历史。

### 4. 死亡及重生事件路由

Adapter 的 `bot_death` 事件包含可信的：

- `agent_id`
- `bot_name`
- `bot_uuid`
- `death_message`
- `position`
- `dimension`
- `timestamp`

`bot_respawn` 包含同一身份以及实际重生位置和维度。Agent Core 使用 workspace 内可信 UUID 绑定路由到所属 Agent，不使用显示名称猜测。

事件先持久化，再交给 Agent：

- Agent 空闲：以 `source=plugin_event` 自动调用一次 `handle()`。
- Agent 执行中：加入该 Agent 的高优先级运行时事件队列；在下一次 LLM 调用前插入系统事件消息。
- 若当前执行在事件到达后即将结束：消费队列并追加一轮 LLM。
- 同一事件 ID 只消费一次；重启后已处理事件不重复唤醒。

MainAgent 增加明确的运行状态和串行入口，避免当前单一 `abortController` 被并发 `handle()` 覆盖。

### 5. 数据流

```text
致命伤害
  -> EntityPlayerMPFake.super.die（原版结算）
  -> Mixin 阻止 Carpet 死亡 kill/disconnect
  -> BotManager: DEAD_WAITING + bot_death
  -> Agent Core 持久化并路由事件
  -> 空闲则唤醒；运行中则注入
  -> 动作工具在 40 tick 内返回 BOT_DEAD
  -> PlayerList.respawn（原版重生点规则）
  -> Carpet 创建新的 EntityPlayerMPFake
  -> BotManager 替换实体引用并标记 ALIVE
  -> bot_respawn 持久化并路由
  -> 动作工具恢复
```

## 执行

### Adapter Java

1. 撤销死亡时 `unregisterBot(body)`、提前回满生命及重新登录式 `respawnFake + placeNewPlayer` 路径。
2. 为 BotManager 增加生命周期记录、查询 API、40 tick 调度和实体引用替换。
3. 新增 Carpet 死亡 Mixin，并注册到 `alice-mod.mixins.json`。
4. 使用 `PlayerList.respawn(...)` 完成原版复活，并在运行时验证返回实体为 `EntityPlayerMPFake`。
5. 扩展死亡和重生事件负载。
6. 为单调用和批调用协议解析可信身份上下文，实施授权与 `BOT_DEAD` 门禁。
7. 修改工具控制器的 Bot 解析，使其使用可信调用目标，不再隐式选择第一个假人。
8. 扩展 `bot_info`、`bot_list` 生命周期字段及工具日志中的 bot 身份。

### Agent Core

1. 建立 Agent 配置到 bot name/UUID 的可信绑定；UUID 由 Adapter 生命周期事件或控制响应确认并持久化。
2. Pipeline 和 Trigger 工具调用自动携带不可由 LLM 覆盖的身份元数据。
3. 修复单调用错误解析，保留 Adapter 的 `reason/detail/details`；批调用保留 `BOT_DEAD` 错误码。
4. 为 `bot_death`、`bot_respawn` 增加所属 Agent 的直达路由，不依赖用户配置 `event_triggers`。
5. MainAgent 增加串行运行状态、高优先级事件队列、轮次前注入和结束前补充轮次。
6. 将死亡、重生和工具失败写入对应 Agent 的 `chat_history`，并记录事件消费状态以去重。

### Agent Core TypeScript 模块文档

#### 需求

- 所有 Adapter 工具调用使用 Agent Core 从 workspace 与 Agent 配置生成的可信身份，LLM 业务参数仅原样作为 `parameters`，不能改变顶层授权身份。
- 生命周期事件必须先进入 `chat_history`，再按 UUID 优先、名称兜底路由；普通 `plugin_event` 仍进入 TriggerModule。
- 运行中事件串行注入，不并发启动第二个 `handle()`；结构化工具错误完整进入 LLM 上下文和历史。

#### 架构

- `agent-identity.ts` 统一实现 Java 同规则的 bot name 与工具协议字段；持久化 `agents.bot_uuid` 保存 Adapter 确认绑定。
- Pipeline 的 `BatchToolDispatcher` 持有固定 Agent 身份；Trigger `call_tool` 必须从 `targetAgentId` 明确解析配置后调用单工具分发器。
- `MainAgentRegistry` 负责生命周期事件映射，`MainAgent` 负责持久化去重、运行状态、队列与 LLM 前注入。

#### 执行

1. 创建 Agent 专属 Pipeline 时注入固定身份；单/批请求都把身份放在协议顶层。
2. 解析并传递 `reason/detail/details`，历史与结果注入使用相同结构化错误信封。
3. TCP `event` 通知先直达生命周期路由，再保持原有 TriggerModule 转发。
4. 事件消费状态采用 `chat_history.event_id` 最小可靠持久化：已记录事件重启后不会再次唤醒；当前实现不单独记录“已注入但 LLM 未完成”的消费时间点。

### 测试与验证

1. Java 单元测试：生命周期状态转换、40 tick 边界、工具分类、身份授权、错误信封。
2. TypeScript 单元测试：身份元数据不可覆盖、事件路由、空闲唤醒、运行中注入、事件去重。
3. 集成测试：`tool_call` 与 `tool_call_batch` 在死亡态均返回 `BOT_DEAD`。
4. 专服验证：床、重生锚、世界出生点、无效重生点、`keepInventory` 开关。
5. 日志断言：死亡到复活期间无断线/上线日志，仅有一次死亡和一次重生事件。
6. 多假人授权测试：一个假人死亡不影响另一个假人的工具；任何伪造身份参数均返回授权目标自身结果或 `BOT_ACCESS_DENIED`。

### 已核实 API 证据

- 本地 Minecraft 1.21.4 映射 JAR 的 `PlayerList` 声明：`respawn(ServerPlayer, boolean, Entity.RemovalReason)`。
- 本地 `ServerPlayer` 声明：`findRespawnPositionAndUseSpawnBlock(...)`。
- 本地 Carpet 1.21.4 源码 `PlayerList_fakePlayersMixin` 在 `PlayerList.respawn` 中将新玩家构造重定向到 `EntityPlayerMPFake.respawnFake(...)`。
- 本地 Carpet `EntityPlayerMPFake.die(...)` 在 `super.die(...)` 后调用 `kill(...)`，是当前死亡即断线的直接来源。
