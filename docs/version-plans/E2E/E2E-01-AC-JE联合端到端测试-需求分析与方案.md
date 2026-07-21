# AC 与 JE 联合端到端测试 — 需求分析与测试方案

> 版本：v1.1
> 日期：2026-07-22
> 模块：AC (Agent Core) ↔ JE (Java Edition Adapter) 联合端到端测试
> 关联文档：
> - [IT-01-集成测试需求文档.md](../IT/IT-01-集成测试需求文档.md)
> - [IT-02-集成测试架构文档.md](../IT/IT-02-集成测试架构文档.md)
> - [IT-03-集成测试执行文档.md](../IT/IT-03-集成测试执行文档.md)
> - [IT-04-集成测试总结与上线检查清单.md](../IT/IT-04-集成测试总结与上线检查清单.md)
> - [IT-05-JE工具全覆盖集成测试文档.md](../IT/IT-05-JE工具全覆盖集成测试文档.md)
> - [JE-主链路组装与缺失分析.md](../JE/JE-主链路组装与缺失分析.md)
> - [AC-V24-链路整合-完整端到端链路打通-设计文档.md](../AC/AC-V24-链路整合-完整端到端链路打通-设计文档.md)

---

## 第1章 当前状态分析

### 1.1 AC (Agent Core) 端就绪状态

| 组件 | 状态 | 说明 | 关键文件 |
|------|:----:|------|----------|
| TCP Server | ✅ 已完成 | 端口 27541，JSON-RPC 2.0 协议 | [tcp-server.ts](file:///D:/McAgent/packages/agent-core/src/main/tcp/tcp-server.ts) |
| WorkspaceManager | ✅ 已完成 | 工作区管理，workspace 在线/离线 | [workspace-manager.ts](file:///D:/McAgent/packages/agent-core/src/main/workspace/workspace-manager.ts) |
| ToolDispatcher | ✅ 已完成 | method 为 `tool_call`（B1 已修复） | [tool-dispatcher.ts](file:///D:/McAgent/packages/agent-core/src/main/pipeline/tool-dispatcher.ts) |
| normalizeToolSchema | ✅ 已完成 | 兼容 JE input_schema / BE parameters（B4 已修复） | [tool-schema.ts](file:///D:/McAgent/packages/agent-core/src/main/tool-schema.ts) |
| AC 自身工具 | ✅ 已完成 | 17 个 AC 工具（task、memory、map 等） | [tools/](file:///D:/McAgent/packages/agent-core/src/main/tools/) |
| QQ Bot | ✅ 已完成 | NapCat QQ 集成，消息收发 | [qq-bot/](file:///D:/McAgent/packages/agent-core/src/main/qq-bot/) |
| Trigger Engine | ✅ 已完成 | 事件触发机制 | [trigger/](file:///D:/McAgent/packages/agent-core/src/main/trigger/) |
| Memory System | ✅ 已完成 | 记忆管理，地图索引 | [memory/](file:///D:/McAgent/packages/agent-core/src/main/memory/) |
| Task System | ✅ 已完成 | 任务调度与执行 | [task/](file:///D:/McAgent/packages/agent-core/src/main/task/) |

**AC 端测试覆盖**：65+ 个测试文件，涵盖单元测试、集成测试、回归测试。

### 1.2 JE (Java Edition Adapter) 端就绪状态

| 组件 | 状态 | 说明 | 关键文件 |
|------|:----:|------|----------|
| Fabric Mod 初始化 | ✅ 已完成 | AliceModAdapter、AliceModServer 入口 | [AliceModAdapter.java](file:///D:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/AliceModAdapter.java) |
| TCP Client | ✅ 已完成 | 握手、心跳、断线重连 | [TcpClient.java](file:///D:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/tcp/TcpClient.java) |
| WorldContext | ✅ 已完成 | 世界上下文完整生命周期 | [WorldContext.java](file:///D:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/world/WorldContext.java) |
| BotManager | ✅ 已完成 | 假人生命周期管理（Carpet Mod EntityPlayerMPFake） | [BotManager.java](file:///D:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/bot/BotManager.java) |
| ToolRegistry | ✅ 已完成 | 工具注册表，扫描所有 @ToolMethod 注解 | [ToolRegistry.java](file:///D:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/tool/ToolRegistry.java) |
| 工具注册 | ✅ 已完成 | register_tools 走 Notification（B2 已修复） | [WorldContext.java:273](file:///D:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/world/WorldContext.java#L273-L289) |
| 工具参数解析 | ✅ 已完成 | parseJsonArgs 正确解析参数（B3 已修复） | [WorldContext.java:707](file:///D:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/world/WorldContext.java#L707-L718) |
| 工具执行超时 | ✅ 已完成 | 30s 超时，CompletableFuture 异步执行 | [WorldContext.java:331](file:///D:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/world/WorldContext.java#L331-L347) |
| 工具错误结构化 | ✅ 已完成 | reason/detail/suggestion 统一错误格式 | [WorldContext.java:393](file:///D:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/world/WorldContext.java#L393-L433) |
| StatusCollector | ✅ 已完成 | 真实数据采集（GAP-01 已修复） | [WorldContext.java:722](file:///D:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/world/WorldContext.java#L722-L781) |
| EventDispatcher | ✅ 已完成 | 事件通知分发器，绑定到游戏事件（GAP-02 已修复） | [EventDispatcher.java](file:///D:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/status/EventDispatcher.java) |
| world_online 通知 | ✅ 已完成 | 握手成功后发送（GAP-03 已修复） | [WorldContext.java:438](file:///D:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/world/WorldContext.java#L438-L446) |
| bot_control 处理 | ✅ 已完成 | online/offline/status 三种操作（GAP-04 已修复） | [WorldContext.java:460](file:///D:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/world/WorldContext.java#L460-L554) |
| BotEventDispatcher 桥接 | ✅ 已完成 | 假人生命周期事件推送至 TCP（GAP-05 已修复） | [WorldContext.java:581](file:///D:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/world/WorldContext.java#L581-L624) |
| Mixin 事件监听 | ✅ 已完成 | ChatEventMixin 聊天事件 | [ChatEventMixin.java](file:///D:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/mixin/ChatEventMixin.java) |
| 玩家加入/离开监听 | ✅ 已完成 | Fabric API 事件 | [WorldContext.java:634](file:///D:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/world/WorldContext.java#L634-L656) |
| 健康度检测 | ✅ 已完成 | 低血量/低饥饿度 tick 检测 | [WorldContext.java:668](file:///D:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/world/WorldContext.java#L668-L695) |
| 数据库持久化 | ✅ 已完成 | SQLite JDBC，工具日志/事件日志/配置 | [DatabaseManager.java](file:///D:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/persistence/DatabaseManager.java) |
| 配置管理 | ✅ 已完成 | ConfigManager + ConfigFileWatcher | [ConfigManager.java](file:///D:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/config/ConfigManager.java) |
| 入口文件生成 | ✅ 已完成 | mcagent_instance.json | [InstanceFileGenerator.java](file:///D:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/entry/InstanceFileGenerator.java) |

**JE 端工具清单（32 个工具，8 个模块）**：

| 模块 | 工具列表 | 数量 |
|------|---------|:----:|
| BotTools | bot_spawn, bot_despawn, bot_respawn, bot_dismiss, bot_list, bot_info | 6 |
| PerceptionTools | look_around, look_at_block, look_in_container, look_time_weather, look_online_players | 5 |
| MoveToTools | move_to, ride, dismount | 3 |
| InventoryTools | drop_item, take_from_container, put_to_container, equip_item | 4 |
| BlockTools | mine_block, place_block, use_block, area_operation | 4 |
| EntityInteractionTools | set_combat_mode, stop_combat, interact_entity, lead_entity | 4 |
| SurvivalTools | eat, sleep, use_item | 3 |
| ChatTools | chat, whisper, message | 3 |
| **合计** | | **32** |

**JE 端测试覆盖**：14 个 Java 单元测试文件 + 75 个 AC 端集成测试用例（全部通过）。

### 1.3 主链路完整度评估

对照 [JE-主链路组装与缺失分析.md](../JE/JE-主链路组装与缺失分析.md) 中定义的 11 个链路阶段：

| 链路阶段 | 状态 | 修复情况 |
|---------|:----:|----------|
| Fabric 模组初始化 | ✅ 已完成 | — |
| 服务端启动事件 | ✅ 已完成 | — |
| 世界上下文激活 | ✅ 已完成 | — |
| TCP 连接建立 | ✅ 已完成 | — |
| 握手认证 | ✅ 已完成 | — |
| 工具注册 | ✅ 已完成 | B2 修复：sendRequest → sendNotification |
| 状态上报 | ✅ 已完成 | GAP-01 修复：硬编码 → 真实数据采集 |
| 事件通知 | ✅ 已完成 | GAP-02 修复：EventDispatcher 绑定到游戏事件 |
| 技能执行 | ✅ 已完成 | B3 修复：参数解析 + GAP-06 超时处理 + GAP-07 错误结构化 |
| 断线重连 | ✅ 已完成 | — |
| 世界关闭清理 | ✅ 已完成 | — |

**所有 5 个 P0 GAP 和 5 个 P1 GAP 已全部修复。**

### 1.4 现有测试覆盖度

| 测试层级 | 测试文件 | 用例数 | 覆盖范围 | 耗时 |
|---------|---------|:------:|---------|:----:|
| 回归层 | tool-dispatcher-method-name.test.ts | 2 | B1：AC method 名 | < 1s |
| 回归层 | register-tools-normalize.test.ts | 4 | B4：Schema 归一化 | < 1s |
| L2 端到端 | je-e2e-test.test.ts | 5 | 基础链路（握手→注册→spawn→info→move→错误） | 2-3 分钟 |
| L2 工具全覆盖 | je-tools-full.test.ts | 75 | 全部 32 个 JE 工具 | 5-10 分钟 |
| AC 单元测试 | 65+ 文件 | 300+ | AC 各模块 | < 1 分钟 |
| JE 单元测试 | 14 文件 | 50+ | JE 各模块 | < 30s |
| **合计** | **80+ 文件** | **400+** | **全链路+全工具** | **~10 分钟** |

### 1.5 完整测试条件评估结论

**结论：当前工程已满足进行完整 AC↔JE 联合 E2E 测试的全部条件。**

具体依据：

| 维度 | 评估 | 说明 |
|------|:----:|------|
| 协议链路完整性 | 满足 | 握手→注册→tool_call→结果返回→事件通知→状态上报→断线重连，全部闭环 |
| 工具完整性 | 满足 | JE 32 个工具 + AC 17 个工具，全部已实现并注册 |
| 参数传递正确性 | 满足 | B1/B2/B3/B4 修复已验证，参数正确透传 |
| 真实服务端环境 | 满足 | Fabric + Carpet Mod + Alice Mod，真实 MC 服务端 |
| 假人管理 | 满足 | BotManager 完整生命周期（spawn/despawn/respawn/dismiss） |
| 事件推送 | 满足 | 聊天/攻击/死亡/加入/离开/健康度事件已接入 |
| 状态上报 | 满足 | 每 2s 真实数据采集上报 |
| 断线重连 | 满足 | 指数退避重连机制 |
| 自动化测试框架 | 满足 | Vitest + AcMinimalServer fixture + 工具函数 |
| 测试环境 | 满足 | Node 20.x + JDK 21 + Fabric 1.21.4 + Carpet Mod |

**唯一未完成项**：CI 自动运行（IT-04 P0-1），但不影响本地手动执行 E2E 测试。

---

## 第2章 测试目标与范围

### 2.1 测试目标

1. **验证 AC→JE→AC 工具链可用**：AC 端的 ToolDispatcher 通过 TCP 协议，正确调用 JE 端全部 32 个工具，结果正确返回 AC
2. **验证全部工具就绪**：AC 端注册的工具数量 = JE 端工具总数（32 个），所有工具 Schema 完整
3. **验证 AC 端 17 个工具可用**：AC 自身工具在测试上下文中可正常调用
4. **验证真实服务端环境稳定**：MC 服务端运行稳定，TCP 连接保持，状态上报正常
5. **验证事件通知机制**：假人生命周期事件可通过 TCP 推送到 AC

### 2.2 测试范围

| 范围 | 内容 |
|------|------|
| **在范围内** | AC 最小化服务器 + JE 真实服务端 + 全量工具调用 |
| **在范围内** | AC 工具（17 个）+ JE 工具（32 个）= 共 49 个工具 |
| **在范围内** | 正向调用 + 错误路径 + 边界条件 |
| **在范围内** | 状态上报数据验证 |
| **在范围内** | 事件通知验证（假人生命周期事件） |
| **在范围内** | 多轮连续工具调用（混合 AC + JE 工具） |
| **不在范围内** | LLM 真实推理链路（仅测试工具调用的正确性） |
| **不在范围内** | BE (Bedrock Edition) 适配器 |
| **不在范围内** | QQ Bot 集成 |
| **不在范围内** | 性能/压力测试 |
| **不在范围内** | 多 workspace 并发 |
| **不在范围内** | 断线重连场景（已有独立测试） |

### 2.3 测试拓扑

```
┌─────────────────────────────────────────────────────────────────────┐
│                         测试进程（Vitest）                           │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  AcMinimalServer (AC 最小化服务器，不含 LLM)                  │  │
│  │  ├─ TcpServer (端口 27541)                                     │  │
│  │  ├─ WorkspaceManager                                          │  │
│  │  ├─ ToolDispatcher                                            │  │
│  │  └─ AC 工具 (17 个)                                            │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │ TCP (JSON-RPC 2.0)                    │
│                              ▼                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  JE 真实服务端 (Fabric + Carpet + Alice Mod)                   │  │
│  │  ├─ TcpClient (握手/心跳/重连)                                  │  │
│  │  ├─ WorldContext (世界上下文)                                    │  │
│  │  ├─ BotManager (Carpet 假人)                                    │  │
│  │  ├─ 32 个 JE 工具 (8 个模块)                                    │  │
│  │  ├─ StatusCollector (状态上报)                                  │  │
│  │  └─ EventDispatcher (事件通知)                                  │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 第3章 测试架构

### 3.1 组件清单

#### 3.1.1 AC 端组件

| 组件 | 作用 | 变更方式 |
|------|------|----------|
| `AcMinimalServer` | AC 最小化服务器，不含 LLM，提供 TCP 服务 + 工具调度 | 复用现有 [ac-minimal-server.ts](file:///D:/McAgent/packages/agent-core/__tests__/it/fixtures/ac-minimal-server.ts) |
| `TcpServer` | TCP 服务端，监听 JE 连接 | 复用现有 |
| `WorkspaceManager` | 工作区管理，接收 JE 工具注册 | 复用现有 |
| `ToolDispatcher` | 工具调度，发送 tool_call 到 JE | 复用现有 |

#### 3.1.2 JE 端组件

| 组件 | 作用 | 变更方式 |
|------|------|----------|
| Minecraft Server | Fabric 1.21.4 + Carpet Mod | 复用现有 |
| Alice Mod | Fabric Mod，含全部 32 个工具 | 复用现有 |
| `mcagent_instance.json` | 入口文件，AC 发现实例 | 复用现有 |

#### 3.1.3 测试辅助组件

| 组件 | 作用 | 变更方式 |
|------|------|----------|
| `waitForMcReady` | 等待 MC 服务端就绪 | 复用 [je-tools-env.ts](file:///D:/McAgent/packages/agent-core/__tests__/it/fixtures/je-tools-env.ts) |
| `ensureBotOnline` | 确保假人在线 | 复用 |
| `callToolSafe` | 安全调用工具，自动处理重试 | 复用 |
| `waitFor` | 轮询等待条件满足 | 复用 |

### 3.2 测试时序

```
时间线
│
├─ 0s   开始测试
│
├─ 0s   beforeAll: 启动 AC（最小化服务器，不含 LLM）
│       ├─ AcMinimalServer.start()
│       └─ 等待 AC 就绪
│
├─ 5s   beforeAll: 启动 JE MC 服务端
│       ├─ spawn(java -jar fabric-server-launch.jar)
│       └─ waitForMcReady("Done" 关键词)
│
├─ 120s JE 就绪
│       ├─ JE 自动连接 AC TCP 27541
│       ├─ 握手认证
│       ├─ register_tools Notification
│       └─ AC 注册 32 个 JE 工具
│
├─ 130s 阶段一：工具注册验证
│       ├─ 验证注册工具数量 = 32
│       ├─ 验证每个工具 Schema 完整
│       └─ 验证关键工具存在性
│
├─ 140s 阶段二：JE 工具测试（32 个）
│       ├─ BotTools (6 个)
│       ├─ PerceptionTools (5 个)
│       ├─ MoveToTools (3 个)
│       ├─ InventoryTools (4 个)
│       ├─ BlockTools (4 个)
│       ├─ EntityInteractionTools (4 个)
│       ├─ SurvivalTools (3 个)
│       └─ ChatTools (3 个)
│
├─ 260s 阶段三：AC 工具测试（17 个）
│       ├─ task 工具
│       ├─ memory 工具
│       ├─ map 工具
│       └─ 其他 AC 工具
│
├─ 300s 阶段四：状态上报与事件通知
│       ├─ 验证状态上报数据正确
│       ├─ 验证假人生命周期事件通知
│       └─ 验证玩家加入/离开事件
│
├─ 330s 阶段五：错误路径验证
│       ├─ 参数缺失
│       ├─ 实体不存在
│       ├─ 坐标越界
│       └─ 工具超时
│
├─ 360s 阶段六：多轮连续调用
│       ├─ 连续 5 次工具调用
│       ├─ 混合 AC 工具 + JE 工具
│       └─ 验证状态一致性
│
├─ 390s afterAll: 清理
│       ├─ bot_dismiss 清理假人
│       ├─ 停止 MC 服务端
│       └─ 停止 AC 服务器
│
└─ 400s 测试完成
```

### 3.3 测试文件结构

```
packages/agent-core/__tests__/
├── it/
│   ├── level2/
│   │   ├── je-e2e-test.test.ts              # 既有 L2 基础链路测试
│   │   ├── je-tools-full.test.ts            # 既有 JE 工具全覆盖测试
│   │   └── je-ac-joint-e2e.test.ts          # 【新增】AC+JE 联合 E2E 测试
│   │
│   └── fixtures/
│       ├── ac-minimal-server.ts              # 既有 AC 最小化服务器
│       └── je-tools-env.ts                   # 既有 JE 测试环境辅助函数
```

---

## 第4章 详细测试用例

### 4.1 用例总览

| 阶段 | 模块 | 用例数 | 覆盖范围 |
|:----:|------|:------:|---------|
| 阶段一 | 工具注册验证 | 3 | 注册数量、Schema 完整性、关键工具存在性 |
| 阶段二 | JE 工具测试 | 32 | 全部 32 个 JE 工具正向调用 |
| 阶段三 | AC 工具测试 | 17 | 全部 17 个 AC 工具正向调用 |
| 阶段四 | 状态上报与事件通知 | 5 | 状态数据正确性、事件通知到达 |
| 阶段五 | 错误路径验证 | 10 | 参数缺失、实体不存在、坐标越界、超时 |
| 阶段六 | 多轮连续调用 | 3 | 连续工具调用、混合工具、状态一致性 |
| **合计** | | **70** | **全链路全工具覆盖** |

### 4.2 阶段一：工具注册验证

| 用例 ID | 描述 | 验证点 | 优先级 |
|---------|------|--------|:------:|
| E2E-REG-01 | 验证 JE 工具注册数量 | `workspaceManager.getWorkspaceTools(wsId).length === 32` | P0 |
| E2E-REG-02 | 验证每个工具 Schema 完整 | 每个工具都有 `name`/`description`/`parameters` | P0 |
| E2E-REG-03 | 验证关键工具存在性 | `bot_spawn`/`move_to`/`look_around`/`mine_block`/`chat`/`eat` 等 | P0 |

### 4.3 阶段二：JE 工具测试

#### 4.3.1 BotTools（6 个工具）

| 用例 ID | 工具 | 描述 | 输入参数 | 预期结果 |
|---------|------|------|---------|----------|
| E2E-JE-BT-01 | bot_spawn | 创建假人 | `{name: "E2E_Bot", x: 0, y: 64, z: 0}` | `success: true`，假人创建成功 |
| E2E-JE-BT-02 | bot_info | 查询假人信息 | `{name: "E2E_Bot"}` | `success: true`，返回假人状态 |
| E2E-JE-BT-03 | bot_list | 列出所有假人 | `{}` | `success: true`，列表包含 E2E_Bot |
| E2E-JE-BT-04 | bot_respawn | 重生假人 | `{name: "E2E_Bot"}` | `success: true` |
| E2E-JE-BT-05 | bot_despawn | 移除假人 | `{name: "E2E_Bot"}` | `success: true`，假人离开游戏 |
| E2E-JE-BT-06 | bot_dismiss | 销毁假人 | `{name: "E2E_Bot"}` | `success: true` |

#### 4.3.2 PerceptionTools（5 个工具）

| 用例 ID | 工具 | 描述 | 输入参数 | 预期结果 |
|---------|------|------|---------|----------|
| E2E-JE-PC-01 | look_around | 查看周围环境 | `{name: "E2E_Bot"}` | `success: true`，返回环境描述 |
| E2E-JE-PC-02 | look_at_block | 查看指定方块 | `{name: "E2E_Bot", x: 0, y: 63, z: 0}` | `success: true`，返回方块信息 |
| E2E-JE-PC-03 | look_in_container | 查看容器内容 | `{name: "E2E_Bot", x: 0, y: 64, z: 0}` | `success: true` 或容器不存在提示 |
| E2E-JE-PC-04 | look_time_weather | 查看时间天气 | `{name: "E2E_Bot"}` | `success: true`，返回时间/天气 |
| E2E-JE-PC-05 | look_online_players | 查看在线玩家 | `{}` | `success: true`，返回玩家列表 |

#### 4.3.3 MoveToTools（3 个工具）

| 用例 ID | 工具 | 描述 | 输入参数 | 预期结果 |
|---------|------|------|---------|----------|
| E2E-JE-MV-01 | move_to | 移动到指定坐标 | `{name: "E2E_Bot", x: 10, y: 64, z: 10}` | `success: true` |
| E2E-JE-MV-02 | ride | 骑乘实体 | `{name: "E2E_Bot", entity: ""}` | `success: false`（无坐骑）或 `true` |
| E2E-JE-MV-03 | dismount | 解除骑乘 | `{name: "E2E_Bot"}` | `success: true` |

#### 4.3.4 InventoryTools（4 个工具）

| 用例 ID | 工具 | 描述 | 输入参数 | 预期结果 |
|---------|------|------|---------|----------|
| E2E-JE-IN-01 | drop_item | 丢弃物品 | `{name: "E2E_Bot", item_name: "dirt", count: 1}` | `success: true` |
| E2E-JE-IN-02 | equip_item | 装备物品 | `{name: "E2E_Bot", item_name: "stone"}` | `success: true` 或物品不存在提示 |
| E2E-JE-IN-03 | take_from_container | 从容器取物品 | `{name: "E2E_Bot", x: 0, y: 64, z: 0, item_name: "stone", count: 1}` | `success: true` 或容器不存在提示 |
| E2E-JE-IN-04 | put_to_container | 放入容器 | `{name: "E2E_Bot", x: 0, y: 64, z: 0, item_name: "dirt", count: 1}` | `success: true` 或容器不存在提示 |

#### 4.3.5 BlockTools（4 个工具）

| 用例 ID | 工具 | 描述 | 输入参数 | 预期结果 |
|---------|------|------|---------|----------|
| E2E-JE-BK-01 | mine_block | 挖掘方块 | `{name: "E2E_Bot", x: 0, y: 63, z: 0}` | `success: true` |
| E2E-JE-BK-02 | place_block | 放置方块 | `{name: "E2E_Bot", block_name: "stone", x: 1, y: 64, z: 0}` | `success: true` |
| E2E-JE-BK-03 | use_block | 使用方块（门/开关等） | `{name: "E2E_Bot", x: 0, y: 64, z: 0}` | `success: true` 或不可交互提示 |
| E2E-JE-BK-04 | area_operation | 区域操作（挖矿） | `{name: "E2E_Bot", block_name: "stone", x1: 0, y1: 63, z1: 0, x2: 5, y2: 63, z2: 5}` | `success: true` |

#### 4.3.6 EntityInteractionTools（4 个工具）

| 用例 ID | 工具 | 描述 | 输入参数 | 预期结果 |
|---------|------|------|---------|----------|
| E2E-JE-EN-01 | set_combat_mode | 设置战斗模式 | `{name: "E2E_Bot", mode: "melee"}` | `success: true` |
| E2E-JE-EN-02 | stop_combat | 停止战斗 | `{name: "E2E_Bot"}` | `success: true` |
| E2E-JE-EN-03 | interact_entity | 交互实体 | `{name: "E2E_Bot", entity: ""}` | `success: false`（无目标实体）或 `true` |
| E2E-JE-EN-04 | lead_entity | 牵引实体 | `{name: "E2E_Bot", entity: ""}` | `success: false`（无目标实体）或 `true` |

#### 4.3.7 SurvivalTools（3 个工具）

| 用例 ID | 工具 | 描述 | 输入参数 | 预期结果 |
|---------|------|------|---------|----------|
| E2E-JE-SV-01 | eat | 吃东西 | `{name: "E2E_Bot", food_name: "apple"}` | `success: true` 或物品不存在提示 |
| E2E-JE-SV-02 | sleep | 睡觉 | `{name: "E2E_Bot"}` | `success: true` 或非夜晚提示 |
| E2E-JE-SV-03 | use_item | 使用物品（如钓鱼竿） | `{name: "E2E_Bot", item_name: "fishing_rod"}` | `success: true` 或物品不存在提示 |

#### 4.3.8 ChatTools（3 个工具）

| 用例 ID | 工具 | 描述 | 输入参数 | 预期结果 |
|---------|------|------|---------|----------|
| E2E-JE-CH-01 | chat | 发送全局消息 | `{name: "E2E_Bot", message: "Hello from E2E test!"}` | `success: true` |
| E2E-JE-CH-02 | whisper | 私聊消息 | `{name: "E2E_Bot", target: "Player", message: "Private message"}` | `success: true` 或目标不在线提示 |
| E2E-JE-CH-03 | message | 发送消息（通用） | `{name: "E2E_Bot", target: "Player", message: "A message"}` | `success: true` 或目标不在线提示 |

### 4.4 阶段三：AC 工具测试

**AC 工具清单（17 个）**：

| 工具名 | 用途 | 用例 ID |
|--------|------|---------|
| task_create | 创建任务 | E2E-AC-01 |
| task_list | 列出任务 | E2E-AC-02 |
| task_update | 更新任务 | E2E-AC-03 |
| task_delete | 删除任务 | E2E-AC-04 |
| memory_recall | 回忆记忆 | E2E-AC-05 |
| memory_save | 保存记忆 | E2E-AC-06 |
| memory_forget | 遗忘记忆 | E2E-AC-07 |
| map_query | 查询地图 | E2E-AC-08 |
| map_mark | 标记位置 | E2E-AC-09 |
| plan_create | 创建计划 | E2E-AC-10 |
| plan_update | 更新计划 | E2E-AC-11 |
| plan_execute | 执行计划 | E2E-AC-12 |
| plan_status | 查询计划状态 | E2E-AC-13 |
| search_internet | 联网搜索 | E2E-AC-14 |
| schedule_agent | 调度主 Agent | E2E-AC-15 |
| qq_send | 发送 QQ 消息 | E2E-AC-16 |
| qq_recall | 撤回 QQ 消息 | E2E-AC-17 |

### 4.5 阶段四：状态上报与事件通知

| 用例 ID | 描述 | 验证点 | 前置条件 |
|---------|------|--------|----------|
| E2E-ST-01 | 验证状态上报数据正确 | 血量/位置/装备/背包等字段非空且合理 | 假人在线 |
| E2E-ST-02 | 验证假人创建事件通知 | AC 收到 `event` Notification，event_type = `bot_spawn` | 创建假人 |
| E2E-ST-03 | 验证假人死亡事件通知 | AC 收到 `event` Notification，event_type = `bot_death` | 假人死亡 |
| E2E-ST-04 | 验证假人销毁事件通知 | AC 收到 `event` Notification，event_type = `bot_dismiss` | 销毁假人 |
| E2E-ST-05 | 验证玩家加入事件通知 | AC 收到 `event` Notification，event_type = `player_join` | 有玩家加入 |

### 4.6 阶段五：错误路径验证

| 用例 ID | 场景 | 输入 | 预期结果 |
|---------|------|------|----------|
| E2E-ERR-01 | bot_info 参数缺失 | `{}` | 返回错误 `INVALID_PARAMS` |
| E2E-ERR-02 | bot_info 查询不存在的假人 | `{name: "NonExistent"}` | 返回错误 `NOT_FOUND` |
| E2E-ERR-03 | move_to 无目标 | `{}` | 返回错误 `INVALID_PARAMS` |
| E2E-ERR-04 | move_to 无效坐标 | `{x: "abc", y: 64, z: 0}` | 参数解析错误 |
| E2E-ERR-05 | mine_block 不存在的坐标 | `{x: 0, y: -100, z: 0}` | 返回错误 `MINE_FAILED` |
| E2E-ERR-06 | equip_item 不存在的物品 | `{item_name: "nonexistent"}` | 返回错误 `EQUIP_FAILED` |
| E2E-ERR-07 | set_combat_mode 无效模式 | `{mode: "invalid"}` | 返回错误 `COMBAT_MODE_FAILED` |
| E2E-ERR-08 | eat 不存在的食物 | `{food_name: "nonexistent"}` | 返回错误 `EAT_FAILED` |
| E2E-ERR-09 | chat 消息过长 | `{message: "<超过256字符>"}` | 返回错误 `MESSAGE_TOO_LONG` |
| E2E-ERR-10 | 工具超时 | 模拟长时间执行 | 30s 后返回超时错误 |

### 4.7 阶段六：多轮连续调用

| 用例 ID | 场景 | 调用序列 | 验证点 |
|---------|------|---------|--------|
| E2E-MUL-01 | 连续 5 次工具调用 | 假人 spawn → move_to → look_around → mine_block → chat | 全部成功，状态一致 |
| E2E-MUL-02 | 混合 AC 工具 + JE 工具 | task_create → bot_spawn → move_to → memory_save → task_list | 跨模块调用正确 |
| E2E-MUL-03 | 工具调用后状态验证 | bot_spawn → bot_info → move_to → bot_info | 确认位置已变化 |

---

## 第5章 执行计划

### 5.1 前置条件

#### 5.1.1 环境要求

| 项 | 要求 | 验证方式 |
|----|------|----------|
| Node.js | 20.x | `node --version` |
| JDK | 21 | `java --version` |
| pnpm | 9.x | `pnpm --version` |
| MC 服务端 | `serverjava/fabric-server-launch.jar` 存在 | 检查文件 |
| Alice Mod | `serverjava/mods/alice-mod-*.jar` 存在 | 检查文件 |
| Carpet Mod | `serverjava/mods/carpet-fabric-*.jar` 存在 | 检查文件 |
| 内存 | 8GB+ | 系统信息 |
| 磁盘 | 10GB+ | 磁盘信息 |

#### 5.1.2 编译要求

```bash
# 1. 编译 AC
cd packages/agent-core
pnpm build

# 2. 编译 JE
cd ../adapter-java
./gradlew build
cp build/libs/alice-mod-*.jar ../../serverjava/mods/
```

### 5.2 执行步骤

#### 5.2.1 快速执行

```bash
cd packages/agent-core

# 运行全部联合 E2E 测试
pnpm vitest run __tests__/it/level2/je-ac-joint-e2e.test.ts --reporter=verbose

# 运行指定阶段
pnpm vitest run __tests__/it/level2/je-ac-joint-e2e.test.ts -t "阶段一"
pnpm vitest run __tests__/it/level2/je-ac-joint-e2e.test.ts -t "阶段二"
```

#### 5.2.2 分步执行（调试用）

```bash
# 1. 先启动 AC（独立终端）
cd packages/agent-core
pnpm tsx __tests__/it/fixtures/ac-minimal-server.ts

# 2. 再启动 JE MC 服务端（独立终端）
cd serverjava
java -Xmx2G -jar fabric-server-launch.jar nogui

# 3. 最后运行测试（第三个终端）
pnpm vitest run __tests__/it/level2/je-ac-joint-e2e.test.ts -t "E2E-JE-BT-01"
```

### 5.3 时间预算

| 阶段 | 预计耗时 | 说明 |
|:----:|:--------:|------|
| beforeAll（启动 AC + JE） | 120-180s | MC 服务端启动占主要耗时 |
| 阶段一：工具注册验证 | < 5s | 纯内存操作 |
| 阶段二：JE 工具测试 | 90-150s | 32 个工具，每个 3-5s |
| 阶段三：AC 工具测试 | 30-60s | 17 个工具，每个 2-3s |
| 阶段四：状态上报与事件 | 10-20s | 等待状态上报周期 |
| 阶段五：错误路径验证 | 20-30s | 10 个错误路径 |
| 阶段六：多轮连续调用 | 20-30s | 3 个多轮场景 |
| afterAll（清理） | 5-10s | 销毁假人，停止服务端 |
| **总计** | **~5-8 分钟** | |

### 5.4 验收标准

| 编号 | 验收条件 | 验证方式 |
|:----:|---------|----------|
| AC-01 | 全部 70 个测试用例通过 | `pnpm vitest run` 输出全部 ✅ |
| AC-02 | JE 32 个工具全部注册到 AC | `getWorkspaceTools(wsId).length === 32` |
| AC-03 | JE 32 个工具均可正常调用 | 每个工具至少一个正向用例通过 |
| AC-04 | AC 17 个工具可用 | 每个工具至少一个正向用例通过 |
| AC-05 | 状态上报数据正确 | 血量/位置/装备等字段非空且合理 |
| AC-06 | 事件通知正确推送 | 假人创建/销毁事件到达 AC |
| AC-07 | 错误路径返回正确错误码 | 10 个错误路径全部返回预期错误 |
| AC-08 | 多轮连续调用状态一致 | 调用前后状态一致 |
| AC-09 | 测试后清理所有假人 | 无残留假人 |
| AC-10 | 测试可重复运行 | 幂等，不依赖外部状态 |

---

## 第6章 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| MC 服务端启动慢 | 测试总时长增加 | 使用 WorldPreset + JVM 优化参数 |
| 假人在方块操作中卡住 | 工具超时 | 使用 30s 超时 + `waitFor` 轮询 |
| 测试环境资源不足 | 服务端崩溃 | 确保 8GB+ 内存 |
| 连续测试导致世界污染 | 后续测试失败 | 在独立测试区域操作，`afterAll` 清理 |

---

## 第7章 测试文件骨架

```typescript
// packages/agent-core/__tests__/it/level2/je-ac-joint-e2e.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { startAcMinimalServer, type AcMinimalContext } from '../fixtures/ac-minimal-server'
import { waitFor, ensureBotOnline, cleanupBot, callToolSafe } from '../fixtures/je-tools-env'

const BOT_NAME = 'E2E_Bot'
const BOT_X = 0, BOT_Y = 64, BOT_Z = 0

describe('AC 与 JE 联合端到端测试', () => {
  let ac: AcMinimalContext
  let workspaceId: string
  let mcProcess: ReturnType<typeof spawn> | null = null

  beforeAll(async () => {
    // 1. 启动 AC 最小化服务器（不含 LLM）
    ac = await startAcMinimalServer(27541, 'mct_64cf4ca6c0c64a75aaf9a5b0')

    // 2. 启动 MC 服务端
    // ...（同 je-e2e-test.test.ts 中的实现）

    // 3. 等待 JE 连接并注册工具
    workspaceId = await waitFor(() => {
      const online = ac.workspaceManager.getOnlineWorkspaces()
      if (online.length > 0) {
        const tools = ac.workspaceManager.getWorkspaceTools(online[0].id)
        if (tools.length >= 30) return online[0].id
      }
      return null
    }, { timeoutMs: 60_000, intervalMs: 1000 })
  }, 300_000)

  afterAll(async () => {
    // 清理
    await cleanupBot(ac.toolDispatcher, workspaceId, BOT_NAME)
    if (mcProcess?.pid) process.kill(mcProcess.pid, 'SIGTERM')
    await ac.stop()
  }, 30_000)

  // ===== 阶段一：工具注册验证 =====
  describe('阶段一：工具注册验证', () => {
    it('E2E-REG-01: 验证 JE 工具注册数量 = 32', () => {
      const tools = ac.workspaceManager.getWorkspaceTools(workspaceId)
      expect(tools.length).toBe(32)
    })

    it('E2E-REG-02: 验证每个工具 Schema 完整', () => {
      const tools = ac.workspaceManager.getWorkspaceTools(workspaceId)
      for (const tool of tools) {
        expect(tool.name).toBeTruthy()
        expect(tool.description).toBeTruthy()
        expect(tool.parameters).toBeDefined()
      }
    })

    it('E2E-REG-03: 验证关键工具存在', () => {
      const toolNames = ac.workspaceManager.getWorkspaceTools(workspaceId).map(t => t.name)
      const required = ['bot_spawn', 'bot_info', 'move_to', 'look_around',
                        'mine_block', 'place_block', 'chat', 'eat', 'set_combat_mode',
                        'drop_item', 'equip_item', 'look_in_container']
      for (const name of required) {
        expect(toolNames).toContain(name)
      }
    })
  })

  // ===== 阶段二：JE 工具测试 =====
  describe('阶段二：JE 工具测试', () => {
    describe('BotTools', () => {
      it('E2E-JE-BT-01: bot_spawn 创建假人', async () => {
        const result = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_spawn', {
          name: BOT_NAME, x: BOT_X, y: BOT_Y, z: BOT_Z
        })
        expect(result.success).toBe(true)
      })

      it('E2E-JE-BT-02: bot_info 查询假人信息', async () => {
        const result = await callToolSafe(ac.toolDispatcher, workspaceId, 'bot_info', {
          name: BOT_NAME
        })
        expect(result.success).toBe(true)
        expect(result.data).toBeDefined()
        expect(result.data.position).toBeDefined()
      })
      // ... 其余 BotTools 用例
    })

    describe('PerceptionTools', () => { /* ... */ })
    describe('MoveToTools', () => { /* ... */ })
    describe('InventoryTools', () => { /* ... */ })
    describe('BlockTools', () => { /* ... */ })
    describe('EntityInteractionTools', () => { /* ... */ })
    describe('SurvivalTools', () => { /* ... */ })
    describe('ChatTools', () => { /* ... */ })
  })

  // ===== 阶段三：AC 工具测试 =====
  describe('阶段三：AC 工具测试', () => {
    it('E2E-AC-01: task_create 创建任务', async () => { /* ... */ })
    it('E2E-AC-02: task_list 列出任务', async () => { /* ... */ })
    // ... 17 个 AC 工具
  })

  // ===== 阶段四：状态上报与事件通知 =====
  describe('阶段四：状态上报与事件通知', () => {
    it('E2E-ST-01: 验证状态上报数据正确', async () => { /* ... */ })
    // ... 5 个用例
  })

  // ===== 阶段五：错误路径验证 =====
  describe('阶段五：错误路径验证', () => {
    it('E2E-ERR-01: bot_info 参数缺失', async () => { /* ... */ })
    // ... 10 个用例
  })

  // ===== 阶段六：多轮连续调用 =====
  describe('阶段六：多轮连续调用', () => {
    it('E2E-MUL-01: 连续 5 次工具调用', async () => { /* ... */ })
    // ... 3 个用例
  })
})
```

---

## 第8章 附录

### 8.1 相关命令速查

```bash
# 编译 AC
cd packages/agent-core && pnpm build

# 编译 JE
cd packages/adapter-java && ./gradlew build

# 运行既有测试
pnpm test -- __tests__/it/level2/je-tools-full.test.ts
pnpm test -- __tests__/it/level2/je-e2e-test.test.ts

# 运行新联合 E2E 测试（待实现后）
pnpm test -- __tests__/it/level2/je-ac-joint-e2e.test.ts
```

### 8.2 既有测试文件清单

| 文件 | 作用 | 用例数 | 状态 |
|------|------|:------:|:----:|
| [je-e2e-test.test.ts](file:///D:/McAgent/packages/agent-core/__tests__/it/level2/je-e2e-test.test.ts) | L2 基础链路 | 5 | ✅ 已通过 |
| [je-tools-full.test.ts](file:///D:/McAgent/packages/agent-core/__tests__/it/level2/je-tools-full.test.ts) | JE 工具全覆盖 | 75 | ✅ 已通过 |
| [tool-dispatcher-method-name.test.ts](file:///D:/McAgent/packages/agent-core/__tests__/pipeline/tool-dispatcher-method-name.test.ts) | B1 回归 | 2 | ✅ 已通过 |
| [register-tools-normalize.test.ts](file:///D:/McAgent/packages/agent-core/__tests__/tcp/register-tools-normalize.test.ts) | B4 回归 | 4 | ✅ 已通过 |

### 8.3 关键文件索引

| 文件 | 作用 |
|------|------|
| [WorldContext.java](file:///D:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/world/WorldContext.java) | JE 主链路核心组件 |
| [TcpClient.java](file:///D:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/tcp/TcpClient.java) | JE TCP 通信 |
| [tool-dispatcher.ts](file:///D:/McAgent/packages/agent-core/src/main/pipeline/tool-dispatcher.ts) | AC 工具调度 |
| [tcp-server.ts](file:///D:/McAgent/packages/agent-core/src/main/tcp/tcp-server.ts) | AC TCP 服务端 |
| [workspace-manager.ts](file:///D:/McAgent/packages/agent-core/src/main/workspace/workspace-manager.ts) | AC 工作区管理 |
| [ac-minimal-server.ts](file:///D:/McAgent/packages/agent-core/__tests__/it/fixtures/ac-minimal-server.ts) | 测试用 AC 最小服务器 |
| [je-tools-env.ts](file:///D:/McAgent/packages/agent-core/__tests__/it/fixtures/je-tools-env.ts) | 测试辅助函数 |