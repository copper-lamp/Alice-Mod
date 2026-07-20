# Adapter Core JE 主链路组装与缺失分析

> 版本：v1.0
> 日期：2026-07-21
> 模块：Adapter Core JE — Fabric 模组
> 关联文档：[JE-01-需求文档.md](JE-01-需求文档.md)、[JE-04-架构与开发路线.md](JE-04-架构与开发路线.md)、[JE-进度跟踪.md](JE-进度跟踪.md)

---

## 第1章 需求文档

### 1.1 文档目标

本文档旨在：
1. 梳理 JE 模组的主链路（从 Fabric 启动到 TCP 通信、工具注册、状态上报、事件通知的完整流程）
2. 分析当前代码实现中缺失的部分和需要完善的功能
3. 提供执行计划以补全缺失链路

### 1.2 主链路定义

JE 主链路指从 Fabric 模组加载到与 Agent Core 完成通信闭环的完整流程：

```
Fabric 加载 → 模组初始化 → 服务端启动 → 世界上下文激活
→ TCP 连接 → 握手认证 → 工具注册 → 状态上报
→ 接收 tool_call → 执行工具 → 返回结果
→ 推送事件通知 → 断线重连 → 世界关闭清理
```

### 1.3 当前实现状态

| 链路阶段 | 状态 | 说明 |
|---------|:----:|------|
| Fabric 模组初始化 | ✅ 已完成 | AliceModAdapter、AliceModServer 入口 |
| 服务端启动事件 | ✅ 已完成 | SERVER_STARTED/SERVER_STOPPING 注册 |
| 世界上下文激活 | ✅ 已完成 | WorldContextManager.activate() |
| TCP 连接建立 | ✅ 已完成 | TcpClient.connect() |
| 握手认证 | ✅ 已完成 | HandshakeManager |
| 工具注册 | ✅ 已完成 | 握手成功后自动注册 |
| 状态上报 | ⚠️ 占位实现 | collectStatus() 返回硬编码值 |
| 事件通知 | ❌ 未接入 | EventDispatcher 未绑定到游戏事件 |
| 技能执行 | ✅ 已完成 | 26 个工具 + 工具调度 |
| 断线重连 | ✅ 已完成 | ReconnectManager |
| 世界关闭清理 | ✅ 已完成 | shutdown() 流程 |
| 游戏事件监听 | ❌ 未实现 | 无 onChat/onDeath/onJoin 等监听 |

---

## 第2章 架构文档

### 2.1 主链路架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Fabric Loader                                    │
│  ┌──────────────────────┐  ┌──────────────────────────────────────┐    │
│  │  AliceModAdapter      │  │  AliceModServer                      │    │
│  │  (ModInitializer)     │  │  (DedicatedServerModInitializer)     │    │
│  │  ├─ 路径迁移          │  │  ├─ BotAccess.init()                 │    │
│  │  ├─ 指令注册          │  │  ├─ SERVER_STARTED → activate()      │    │
│  │  ├─ 工具扫描          │  │  ├─ SERVER_STOPPING → deactivate()   │    │
│  │  └─ 插件发现          │  │  └─ SERVER_STOPPED → deactivate()    │    │
│  └──────────────────────┘  └──────────────────────────────────────┘    │
│                                     │                                    │
│                                     ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                  WorldContextManager                              │   │
│  │  ├─ activate(server) → 创建 WorldContext                         │   │
│  │  └─ deactivate() → 关闭 WorldContext                             │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                     │                                    │
│                                     ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     WorldContext                                  │   │
│  │                                                                   │   │
│  │  initialize() 流程:                                               │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │   │
│  │  │ BotManager    │  │ Database      │  │ ConfigManager        │   │   │
│  │  │ .init()       │→ │ .initialize() │→ │ .init()              │   │   │
│  │  └──────────────┘  └──────────────┘  └──────────────────────┘   │   │
│  │       │                                                           │   │
│  │       ▼                                                           │   │
│  │  ┌──────────────────────────────────────────────────────────┐    │   │
│  │  │  loadAndSpawnAgents() → 从 Alice/agents/ 加载配置并创建假人 │    │   │
│  │  └──────────────────────────────────────────────────────────┘    │   │
│  │       │                                                           │   │
│  │       ▼                                                           │   │
│  │  ┌──────────────┐  ┌──────────────────────┐  ┌──────────────┐   │   │
│  │  │ 注册 Tick     │  │ TcpServiceImpl       │  │ 生成入口文件  │   │   │
│  │  │ .tick()       │→ │ .setClient()         │→ │ InstanceFile │   │   │
│  │  └──────────────┘  └──────────────────────┘  └──────────────┘   │   │
│  │       │                                                           │   │
│  │       ▼                                                           │   │
│  │  ┌──────────────────────────────────────────────────────────┐    │   │
│  │  │              TcpClient.connect() 启动连接                  │    │   │
│  │  └──────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                     │                                    │
│         ┌───────────────────────────┼───────────────────────────┐        │
│         │                           │                           │        │
│         ▼                           ▼                           ▼        │
│  ┌──────────────┐          ┌──────────────────┐       ┌──────────────┐  │
│  │ 握手成功回调  │          │ 工具调用回调      │       │ 断开连接回调  │  │
│  │ ├─ 生成在线   │          │ ├─ 查找工具       │       │ ├─ 停止状态   │  │
│  │ │  入口文件   │          │ ├─ 执行工具       │       │ │  上报       │  │
│  │ ├─ 注册工具   │          │ ├─ 记录日志       │       │ ├─ 生成离线   │  │
│  │ └─ 启动状态   │          │ └─ 返回结果       │       │ │  入口文件   │  │
│  │   上报        │          └──────────────────┘       │ └─ 触发重连   │  │
│  └──────────────┘                                      └──────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 模块依赖关系

```
WorldContext
├── BotManager          ─── 假人生命周期管理
├── TcpClient           ─── TCP 通信（依赖 Callbacks 回调）
│   ├── HandshakeManager  ─── 握手认证
│   ├── HeartbeatManager  ─── 心跳响应
│   └── ReconnectManager  ─── 断线重连
├── StatusCollector     ─── 周期性状态上报（依赖 StatusData）
├── EventDispatcher    ─── 事件通知分发
├── DatabaseManager    ─── SQLite 持久化
│   ├── ConfigRepository
│   ├── ToolLogRepository
│   ├── MemoryMetaRepository
│   └── EventLogRepository
└── ConfigManager      ─── 配置管理（依赖 ConfigFileWatcher）
```

### 2.3 数据流

```
Agent Core                              Alice Mod JE (Fabric)
    │                                         │
    │  ─── TCP 连接建立 ──────────────────────→  │  [TcpClient.connect()]
    │  ←── handshake (instance_id, auth_token) ─  │  [HandshakeManager]
    │  ─── handshake_result ──────────────────→  │
    │                                         │
    │  ←── register_tools (26 tools JSON) ────  │  [握手成功回调]
    │                                         │
    │  ←── status_report (每 2s) ─────────────  │  [StatusCollector]
    │                                         │
    │  ←── event (entity_attack/death/chat) ──  │  [EventDispatcher - ❌未接入]
    │                                         │
    │  ─── tool_call (执行工具) ──────────────→  │  [WorldContext.onToolCall]
    │  ←── tool_result (success/fail + data) ──  │
    │                                         │
    │  ─── ping ──────────────────────────────→  │  [HeartbeatManager]
    │  ←── pong ───────────────────────────────  │
    │                                         │
    │  ←── world_offline (下线通知) ────────────  │  [shutdown() - ❌缺少world_online]
```

---

## 第3章 执行文档

### 3.1 缺失部分清单

#### 3.1.1 P0 级缺失（必须修复）

| 编号 | 缺失项 | 影响 | 涉及文件 | 工作量 |
|:----:|--------|------|----------|:------:|
| GAP-01 | **StatusCollector 占位数据** | 状态上报发送硬编码值，LLM 无法获取真实游戏状态 | `WorldContext.java` L369-380 | 2h |
| GAP-02 | **EventDispatcher 未接入游戏事件** | 攻击、死亡、聊天等重要事件无法通知 Agent Core | 新建事件监听文件 | 6h |
| GAP-03 | **缺少 `world_online` 通知** | Agent Core 无法感知世界上线事件 | `WorldContext.java` 握手成功回调 | 1h |
| GAP-04 | **缺少 `bot_control` 请求处理** | 无法通过 Agent Core 控制假人上线/下线/状态查询 | `WorldContext.java` TCP 回调 | 2h |
| GAP-05 | **BotEventDispatcher 未连接 TCP** | 假人生命周期事件（spawn/death）未推送到 Agent Core | `BotEventDispatcher.java` + `WorldContext.java` | 2h |

#### 3.1.2 P1 级缺失（推荐修复）

| 编号 | 缺失项 | 影响 | 涉及文件 | 工作量 |
|:----:|--------|------|----------|:------:|
| GAP-06 | **工具执行超时处理** | 长时间运行的工具会阻塞后续调用 | `WorldContext.java` handleToolCall | 3h |
| GAP-07 | **工具错误信息非结构化** | 错误信息缺少 reason/detail/suggestion | `WorldContext.java`, 各工具实现 | 4h |
| GAP-08 | **`tool_call_batch` 在 WorldContext 无回调** | 批量工具调用结果无法正确路由 | `WorldContext.java` createTcpClient | 1h |
| GAP-09 | **缺少 Mixin 配置** | 无法通过 Mixin 注入游戏事件监听 | `alice-mod.mixins.json` | 2h |
| GAP-10 | **无单元测试** | 代码质量无法保障 | 各模块测试文件 | 16h |

### 3.2 修复方案

#### GAP-01: StatusCollector 真实数据采集

**问题**：`WorldContext.java` 的 `collectStatus()` 返回硬编码值，需要改为从 BotManager 采集真实游戏状态。

**方案**：实现 `collectStatus()` 方法，遍历所有在线假人，采集以下数据：

```java
private StatusData collectStatus() {
    List<EntityPlayerMPFake> bots = botManager.findAll();
    if (bots.isEmpty()) {
        return null; // 无假人时跳过上报
    }
    
    // 取第一个假人上报（多假人时后续可扩展）
    EntityPlayerMPFake bot = bots.get(0);
    ServerLevel level = (ServerLevel) bot.level();
    
    // 采集设备数据
    ItemStack mainhand = bot.getMainHandItem();
    ItemStack offhand = bot.getOffhandItem();
    ItemStack helmet = bot.getInventory().armor.get(3);
    ItemStack chestplate = bot.getInventory().armor.get(2);
    ItemStack leggings = bot.getInventory().armor.get(1);
    ItemStack boots = bot.getInventory().armor.get(0);
    
    // 采集背包摘要
    List<StatusData.ItemEntry> items = new ArrayList<>();
    int usedSlots = 0;
    for (int i = 0; i < bot.getInventory().items.size(); i++) {
        ItemStack stack = bot.getInventory().items.get(i);
        if (!stack.isEmpty()) {
            usedSlots++;
            // 只上报前 10 个物品（避免消息过大）
            if (items.size() < 10) {
                items.add(new StatusData.ItemEntry(
                    stack.getItem().getDescriptionId(), stack.getCount()));
            }
        }
    }
    
    return new StatusData(
        bot.getHealth(), bot.getMaxHealth(),
        bot.getFoodData().getFoodLevel(), 20, bot.getFoodData().getSaturationLevel(),
        bot.getAirSupply(), bot.getMaxAirSupply(),
        bot.getX(), bot.getY(), bot.getZ(),
        level.dimension().location().toString(),
        bot.getYRot(), bot.getXRot(),
        (int)bot.getArmorValue(), 0,
        mainhand.getHoverName().getString(), offhand.getHoverName().getString(),
        helmet.getHoverName().getString(), chestplate.getHoverName().getString(),
        leggings.getHoverName().getString(), boots.getHoverName().getString(),
        usedSlots, bot.getInventory().items.size(),
        items, List.of(), // 状态效果暂不采集
        level.getDayTime(), getWeather(level), level.getDifficulty().getKey().location().toString(),
        bot.gameMode.getGameModeForPlayer().getName()
    );
}
```

**工作量**：2h

---

#### GAP-02: EventDispatcher 接入游戏事件

**问题**：EventDispatcher 已实现但从未被调用，需要注册 Fabric 事件监听器将游戏事件推送到 Agent Core。

**方案**：在 `WorldContext.initialize()` 中注册 Fabric 事件监听器：

```java
// 在 WorldContext.initialize() 中添加：

// 注册聊天事件监听
ServerLifecycleEvents.SERVER_STARTED.register(server -> {
    // 通过 Mixin 或 Fabric 事件监听聊天
});

// 注册玩家事件监听
ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> {
    // 玩家加入事件
});

ServerPlayConnectionEvents.DISCONNECT.register((handler, server) -> {
    // 玩家离开事件
});

// 注册 Tick 事件用于健康度阈值检测
ServerTickEvents.END_SERVER_TICK.register(s -> {
    // 每 tick 检查假人血量/饥饿度
    // 低于阈值时推送 health_low / hunger_low 事件
});
```

**需要的具体事件监听**：

| 事件类型 | Fabric 事件 | 需要条件 |
|----------|------------|----------|
| `player_chat` | 需 Mixin 注入 `ServerGamePacketListenerImpl.chat()` | Fabric API 无直接聊天事件 |
| `death` | `ServerLifecycleEvents.SERVER_STARTED` + 假人 tick 检测 | 已通过 BotManager.tick() 检测 |
| `entity_attack` | 需 Mixin 注入 `ServerGamePacketListenerImpl.attack()` | Fabric API 无直接攻击事件 |
| `player_join` | `ServerPlayConnectionEvents.JOIN` | Fabric API 提供 |
| `player_leave` | `ServerPlayConnectionEvents.DISCONNECT` | Fabric API 提供 |
| `health_low` | `ServerTickEvents.END_SERVER_TICK` | 周期性检测 |
| `hunger_low` | `ServerTickEvents.END_SERVER_TICK` | 周期性检测 |

**与 BE 的对比**：

| 事件 | BE 实现方式 | JE 实现方式 |
|------|-------------|-------------|
| player_chat | `mc.listen('onChat')` | Mixin 注入 |
| death | `mc.listen('onPlayerDie')` | BotManager.tick() 检测 |
| entity_attack | `mc.listen('onMobHurt')` | Mixin 注入 |
| player_join | `mc.listen('onJoin')` | `ServerPlayConnectionEvents.JOIN` |
| player_leave | `mc.listen('onLeft')` | `ServerPlayConnectionEvents.DISCONNECT` |
| health_low | `setInterval` 2s 检测 | `ServerTickEvents.END_SERVER_TICK` |
| hunger_low | `setInterval` 2s 检测 | `ServerTickEvents.END_SERVER_TICK` |

**工作量**：6h

---

#### GAP-03: 缺少 world_online 通知

**问题**：BE 在握手成功后会发送 `world_online` 通知，但 JE 缺少此逻辑。

**方案**：在 `WorldContext` 的 `onHandshakeSuccess` 回调中添加：

```java
// 在 onHandshakeSuccess 中，注册工具之前
private void onWorldOnline() {
    JsonObject params = new JsonObject();
    params.addProperty("instance_id", identity.instanceId());
    params.addProperty("world_name", identity.worldName());
    params.addProperty("bot_count", botManager.onlineCount());
    tcpClient.sendNotification("world_online", params);
}
```

**工作量**：1h

---

#### GAP-04: 缺少 bot_control 请求处理

**问题**：BE 的 TCP 客户端实现了 `bot_control` 请求处理（online/offline/status），但 JE 的 TcpClient 和 WorldContext 均未实现。

**方案**：在 `WorldContext.createTcpClient()` 的 Callbacks 中，或通过 TcpClient 的消息路由，增加 `bot_control` 方法的处理：

```java
// 在 TcpClient.handleIncomingRequest() 中增加
case "bot_control" -> handleBotControl(request);

// 处理逻辑
private void handleBotControl(JsonRpcMessage.Request request) {
    String action = request.params().getAsJsonObject().get("action").getAsString();
    String botName = request.params().getAsJsonObject().get("bot_name").getAsString();
    
    switch (action) {
        case "online" -> {
            ServerLevel level = server.overworld();
            Vec3 pos = new Vec3(
                level.getSharedSpawnPos().getX() + 0.5,
                level.getSharedSpawnPos().getY(),
                level.getSharedSpawnPos().getZ() + 0.5
            );
            botManager.spawn(botName, level, pos);
        }
        case "offline" -> {
            EntityPlayerMPFake bot = botManager.findByName(botName);
            if (bot != null) BotManager.despawn(bot);
        }
        case "status" -> {
            boolean online = botManager.findByName(botName) != null;
            // 返回状态
        }
    }
}
```

**工作量**：2h

---

#### GAP-05: BotEventDispatcher 未连接 TCP

**问题**：`BotEventDispatcher` 目前是独立的事件总线，但事件未推送到 `EventDispatcher`（即未通过 TCP 发送）。

**方案**：在 `WorldContext` 中将 `BotEventDispatcher` 连接到 `EventDispatcher`：

```java
// 在 WorldContext.initialize() 中
// 注册 BotEventDispatcher 的监听器，将事件转发到 EventDispatcher
BotEventDispatcher.addListener(event -> {
    switch (event.getType()) {
        case "spawn" -> eventDispatcher.dispatch("bot_created", "info", ...);
        case "death" -> eventDispatcher.dispatch("death", "danger", ...);
        case "despawn" -> eventDispatcher.dispatch("bot_removed", "info", ...);
    }
});
```

**工作量**：2h

---

### 3.3 执行计划

#### 阶段一：修复 P0 缺失（1 天）

| 任务 | 工时 | 产出 |
|------|:----:|------|
| GAP-01: StatusCollector 真实数据采集 | 2h | 修正 collectStatus()，采集真实游戏状态 |
| GAP-03: 添加 world_online 通知 | 1h | 握手成功后发送 world_online |
| GAP-05: BotEventDispatcher 连接 TCP | 2h | 假人事件推送到 Agent Core |
| GAP-04: 添加 bot_control 处理 | 2h | 实现假人控制请求处理 |
| 联调验证 | 2h | 验证完整链路 |

#### 阶段二：修复 P1 缺失（1-2 天）

| 任务 | 工时 | 产出 |
|------|:----:|------|
| GAP-02: EventDispatcher 接入游戏事件 | 6h | 注册 Fabric 事件监听器，接入聊天/攻击/加入/离开事件 |
| GAP-06: 工具执行超时处理 | 3h | 添加异步超时机制 |
| GAP-07: 工具错误信息结构化 | 4h | 统一错误格式 |
| GAP-08: tool_call_batch 回调完善 | 1h | 确保批量工具调用结果正确返回 |

#### 阶段三：增强完善（1 天）

| 任务 | 工时 | 产出 |
|------|:----:|------|
| GAP-09: Mixin 配置 | 2h | 添加 Mixin 监听聊天和攻击事件 |
| 低血量/饥饿阈值检测 | 2h | 周期性检测并推送通知 |
| 单元测试 | 4h | 核心模块测试 |

### 3.4 文件变更清单

| 文件 | 变更类型 | 变更内容 |
|------|----------|----------|
| `WorldContext.java` | 修改 | collectStatus() 真实数据采集、world_online 通知、bot_control 处理、tool_call_batch 回调 |
| `WorldContext.java` | 修改 | 连接 BotEventDispatcher 到 EventDispatcher |
| 新建 `WorldContext.java` 事件监听 | 修改 | 注册 Fabric 事件（chat/attack/join/leave/health） |
| `BotEventDispatcher.java` | 修改 | 添加事件监听器接口 |
| `TcpClient.java` | 修改 | 添加 bot_control 方法路由 |
| `WorldContext.java` handleToolCall | 修改 | 添加超时处理、错误结构化 |
| `alice-mod.mixins.json` | 修改 | 添加 Mixin 引用 |
| 新建 Mixin 类 | 新建 | 聊天事件 Mixin |
| 新建 Mixin 类 | 新建 | 攻击事件 Mixin |

### 3.5 验证标准

| 验证项 | 标准 | 验证方式 |
|--------|------|----------|
| StatusCollector 上报真实数据 | 上报数据与游戏内实际生命/位置/背包一致 | 抓包查看 status_report 消息 |
| world_online 通知 | 握手成功后立即发送 | 查看 Agent Core 日志 |
| bot_control 请求 | 可远程创建/销毁/查询假人状态 | 发送 bot_control 请求验证 |
| EventDispatcher 事件推送 | 聊天/攻击/死亡/加入/离开事件及时推送 | 在游戏中触发事件查看通知 |
| 假人生命周期事件 | 假人创建/死亡/销毁推送事件 | 操作假人后查看事件通知 |
| 工具执行超时 | 超过 30s 的工具返回超时错误 | 执行长时间工具验证 |
| 低血量/饥饿检测 | 血量<30% 或饥饿<6 时推送通知 | 让假人受伤/饥饿验证 |

---

## 附录A：BE 与 JE 主链路对比

| 链路阶段 | BE 实现 | JE 实现 | 状态 |
|---------|---------|---------|:----:|
| 插件/模组加载 | LLSE 插件加载 | Fabric ModInitializer | ✅ 等效 |
| 服务器就绪 | `onServerStarted` 事件 | `SERVER_STARTED` 事件 | ✅ 等效 |
| TCP 连接 | `TcpClient.connect()` | `TcpClient.connect()` | ✅ 等效 |
| 握手认证 | handshake 协议 | handshake 协议 | ✅ 等效 |
| 工具注册 | `register_tools` notification | `register_tools` notification | ✅ 等效 |
| 状态上报 | `StatusReporter` 每 2s | `StatusCollector` 每 2s | ⚠️ 占位数据 |
| 事件通知 | `pushEvent()` 完整事件 | `EventDispatcher` 未接入 | ❌ 缺失 |
| 聊天事件 | `mc.listen('onChat')` | 未实现 | ❌ 缺失 |
| 死亡事件 | `mc.listen('onPlayerDie')` | BotManager.tick() 内部 | ⚠️ 未连接 TCP |
| 攻击事件 | `mc.listen('onMobHurt')` | 未实现 | ❌ 缺失 |
| 加入/离开事件 | `mc.listen('onJoin/onLeft')` | 未实现 | ❌ 缺失 |
| 低血量检测 | `setInterval` 2s | 未实现 | ❌ 缺失 |
| 假人控制 | `bot_control` 请求 | 未实现 | ❌ 缺失 |
| world_online 通知 | Agent Core 端处理 | 未实现 | ❌ 缺失 |
| world_offline 通知 | `sendWorldOffline` | `sendWorldOffline` | ✅ 已实现 |
| 工具调用 | `tool_call` / `tool_call_batch` | `tool_call` / `tool_call_batch` | ✅ 等效 |
| 断线重连 | 指数退避重连 | 指数退避重连 | ✅ 等效 |
| 配置文件 | `config.json` 热加载 | `ConfigManager` + `ConfigFileWatcher` | ✅ 已实现 |
| 数据持久化 | SQLite (better-sqlite3) | SQLite JDBC | ✅ 已实现 |
| 入口文件 | `mcagent_instance.json` | `mcagent_instance.json` | ✅ 等效 |

## 附录B：关键文件索引

| 文件路径 | 作用 | 主链路阶段 |
|----------|------|-----------|
| `AliceModAdapter.java` | 模组主入口（工具扫描、指令注册） | 初始化 |
| `AliceModServer.java` | 服务端入口（世界上下文激活） | 初始化 |
| `WorldContextManager.java` | 世界上下文管理器 | 激活/关闭 |
| `WorldContext.java` | 核心组件——组装所有模块 | 全链路 |
| `WorldIdentity.java` | 世界身份标识 | 认证 |
| `TcpClient.java` | TCP 客户端 | 通信 |
| `HandshakeManager.java` | 握手认证 | 认证 |
| `HeartbeatManager.java` | 心跳响应 | 保活 |
| `ReconnectManager.java` | 断线重连 | 容错 |
| `ToolRegistry.java` | 工具注册表 | 工具注册 |
| `SchemaGenerator.java` | Schema 生成 | 工具注册 |
| `BotManager.java` | 假人生命周期管理 | 假人管理 |
| `BotRepository.java` | 假人注册表持久化 | 假人管理 |
| `BotEventDispatcher.java` | 假人事件分发 | 事件通知 |
| `StatusCollector.java` | 状态采集器 | 状态上报 |
| `StatusData.java` | 状态数据模型 | 状态上报 |
| `EventDispatcher.java` | 事件通知分发器 | 事件通知 |
| `DatabaseManager.java` | 数据库管理器 | 持久化 |
| `ConfigManager.java` | 配置管理器 | 配置 |
| `ConfigFileWatcher.java` | 配置文件热加载 | 配置 |
| `AliceCommand.java` | Fabric 指令 | 配置 |
| `AlicePaths.java` | 路径工具类 | 配置 |
| `InstanceFileGenerator.java` | 入口文件生成 | 发现 |
| `AliceBotPlayer.java` | 假人玩家实体 | 假人 |
| `FakeConnection.java` | 假人网络连接 | 假人 |
| `MoveToTools.java` | 移动工具实现 | 工具执行 |
| `InventoryTools.java` | 背包工具实现 | 工具执行 |
| `BlockTools.java` | 方块工具实现 | 工具执行 |
| `SurvivalTools.java` | 生存工具实现 | 工具执行 |
| `EntityInteractionTools.java` | 生物交互工具实现 | 工具执行 |
| `PerceptionTools.java` | 感知工具实现 | 工具执行 |
| `ChatTools.java` | 对话工具实现 | 工具执行 |
| `BotTools.java` | 假人管理工具实现 | 工具执行 |
| `MovementController.java` | 移动控制器 | AI 执行 |
| `InventoryController.java` | 背包控制器 | AI 执行 |
| `BlockController.java` | 方块控制器 | AI 执行 |
| `SurvivalController.java` | 生存控制器 | AI 执行 |
| `CombatController.java` | 战斗控制器 | AI 执行 |
| `EntityInteractionController.java` | 生物交互控制器 | AI 执行 |
| `PerceptionController.java` | 感知控制器 | AI 执行 |
| `ChatController.java` | 对话控制器 | AI 执行 |