# AC 与 JE 联合端到端测试 — 需求分析与测试方案

> 版本：v1.0
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
| PromptBuilder | ✅ 已完成 | 提示词组装，含工具说明区 | [prompt-builder.ts](file:///D:/McAgent/packages/agent-core/src/main/prompt/prompt-builder.ts) |
| Main Agent | ✅ 已完成 | LLM 推理编排，工具调用调度 | [main-agent.ts](file:///D:/McAgent/packages/agent-core/src/main/agent/main-agent.ts) |
| LLM Providers | ✅ 已完成 | OpenAI、Claude、Gemini、Ollama 等多 Provider | [providers/](file:///D:/McAgent/packages/agent-core/src/main/llm/providers/) |
| AC 自身工具 | ✅ 已完成 | 17 个 AC 工具（task、memory、map 等） | [tools/](file:///D:/McAgent/packages/agent-core/src/main/tools/) |
| Pipeline | ✅ 已完成 | LLM 请求 → 工具调用 → 结果返回完整流程 | [pipeline.ts](file:///D:/McAgent/packages/agent-core/src/main/pipeline/pipeline.ts) |
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

1. **验证完整业务闭环**：AC 完整启动 → LLM 加载 → 用户输入 → LLM 推理生成工具调用 → AC 发送 tool_call → JE 执行 → 结果返回 AC → 响应输出的全链路
2. **验证 AC→JE→AC 工具链可用**：AC 端的 ToolDispatcher 正确调用 JE 端所有 32 个工具，结果正确返回 AC
3. **验证全部工具就绪**：AC 端注册的工具数量 = JE 端工具总数，所有工具 Schema 完整
4. **验证真实服务端环境稳定**：MC 服务端长时间运行无崩溃，TCP 连接稳定
5. **验证 LLM 真实推理路径**：使用真实 LLM Provider（而非 mock），测试 LLM 生成工具调用的实际效果

### 2.2 测试范围

| 范围 | 内容 |
|------|------|
| **在范围内** | AC 完整（含真实 LLM Provider）+ JE 真实服务端 + 全量工具调用 |
| **在范围内** | AC 工具（17 个）+ JE 工具（32 个）= 共 49 个工具 |
| **在范围内** | 正向路径 + 错误路径 + 边界条件 |
| **在范围内** | 状态上报数据验证 |
| **在范围内** | 事件通知验证（假人生命周期事件） |
| **在范围内** | 多轮连续工具调用 |
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
│  │  AcFullServer (完整 AC 服务器，含真实 LLM Provider)           │  │
│  │  ├─ TcpServer (端口 27541)                                     │  │
│  │  ├─ WorkspaceManager                                          │  │
│  │  ├─ ToolDispatcher                                            │  │
│  │  ├─ MainAgent (LLM 推理)                                       │  │
│  │  ├─ Pipeline (完整工作流)                                      │  │
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
| `AcFullServer` | 完整 AC 服务器（含真实 LLM Provider），基于 `ac-minimal-server.ts` 扩展 | 新增 fixture |
| `TcpServer` | TCP 服务端，监听 JE 连接 | 复用现有 |
| `WorkspaceManager` | 工作区管理 | 复用现有 |
| `ToolDispatcher` | 工具调度，发送 tool_call | 复用现有 |
| `MainAgent` | 主 Agent，LLM 推理编排 | 复用现有 |
| `Pipeline` | 完整工作流 | 复用现有 |
| LLM Provider 配置 | 真实 LLM 连接（OpenAI/Claude/Gemini/DeepSeek 等） | 配置化 |

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
| `callToolSafe` | 安全调用工具 | 复用 |
| `waitFor` | 轮询等待条件满足 | 复用 |

### 3.2 测试时序

```
时间线
│
├─ 0s   开始测试
│
├─ 0s   beforeAll: 启动 AC（含完整 LLM Provider）
│       ├─ AcFullServer.start()
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
├─ 140s 阶段二：AC 工具测试（17 个）
│       ├─ task 工具
│       ├─ memory 工具
│       ├─ map 工具
│       └─ 其他 AC 工具
│
├─ 160s 阶段三：JE 工具测试（32 个）
│       ├─ BotTools (6 个)
│       ├─ PerceptionTools (5 个)
│       ├─ MoveToTools (3 个)
│       ├─ InventoryTools (4 个)
│       ├─ BlockTools (4 个)
│       ├─ EntityInteractionTools (4 个)
│       ├─ SurvivalTools (3 个)
│       └─ ChatTools (3 个)
│
├─ 300s 阶段四：LLM 真实推理链路
│       ├─ 发送用户输入
│       ├─ LLM 推理生成工具调用
│       ├─ AC 发送 tool_call 到 JE
│       ├─ JE 执行并返回结果
│       ├─ AC 处理结果
│       └─ 验证 LLM 响应包含正确信息
│
├─ 330s 阶段五：状态上报与事件通知
│       ├─ 验证状态上报数据正确
│       ├─ 验证假人生命周期事件通知
│       └─ 验证玩家加入/离开事件
│
├─ 360s 阶段六：错误路径验证
│       ├─ 参数缺失
│       ├─ 实体不存在
│       ├─ 坐标越界
│       └─ 工具超时
│
├─ 390s 阶段七：多轮连续调用
│       ├─ 连续 5 次工具调用
│       ├─ 混合 AC 工具 + JE 工具
│       └─ 验证状态一致性
│
├─ 420s afterAll: 清理
│       ├─ bot_dismiss 清理假人
│       ├─ 停止 MC 服务端
│       └─ 停止 AC 服务器
│
└─ 450s 测试完成
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
│       ├── je-tools-env.ts                   # 既有 JE 测试环境辅助函数
│       └── ac-full-server.ts                 # 【新增】完整 AC 服务器（含 LLM）
```

---

## 第4章 详细测试用例

### 4.1 用例总览

| 阶段 | 模块 | 用例数 | 覆盖范围 |
|:----:|------|:------:|---------|
| 阶段一 | 工具注册验证 | 3 | 注册数量、Schema 完整性、关键工具存在性 |
| 阶段二 | AC 工具测试 | 17 | 全部 AC 工具正向调用 |
| 阶段三 | JE 工具测试 | 32 | 全部 JE 工具正向调用 |
| 阶段四 | LLM 真实推理链路 | 7 | 用户输入→LLM→工具调用→结果返回→响应 |
| 阶段五 | 状态上报与事件通知 | 5 | 状态数据正确性、事件通知到达 |
| 阶段六 | 错误路径验证 | 10 | 参数缺失、实体不存在、坐标越界、超时 |
| 阶段七 | 多轮连续调用 | 3 | 连续工具调用、混合工具、状态一致性 |
| **合计** | | **77** | **全链路