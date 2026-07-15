# Adapter Core JE 进度跟踪

> 基于 [JE-02-实施计划.md](JE-02-实施计划.md)
> 最后更新：2026-07-14

---

## 整体进度概览

### 阶段进度

| 阶段 | 版本范围 | 状态 | 进度 |
|------|---------|------|------|
| 基础建设 | V1-V3 | 🟢 已完成 | 3/3 |
| 执行核心 | V4-V6 | 🟢 已完成 | 3/3 |
| 工具矩阵 | V7-V9 | 🟢 已完成 | 3/3 |
| 智能增强 | V10-V12 | 🟡 进行中 | 1.5/3 |
| 集成发布 | V13-V15 | 🔴 未开始 | 0/3 |

### 总体统计

- **总版本数**：15
- **已完成**：10
- **进行中**：2（V11 代码已完成但进度未更新、V12 设计文档完成）
- **未开始**：3
- **整体进度**：67%

---

## V1：Fabric 模组骨架

**周期**：第 1 周  
**状态**：🟢 已完成  
**进度**：7/7

| 任务 | 负责人 | 预计工时 | 状态 | 备注 |
|------|--------|---------|------|------|
| 1.1 使用 Fabric Loom 初始化 Gradle 项目 | A | 4h | 🟢 | Gradle 8.9 + Fabric Loom 1.7.4 |
| 1.2 配置 fabric.mod.json | A | 2h | 🟢 | 已配置 entrypoints, mixins |
| 1.3 创建主类 McAgentAdapter | A | 2h | 🟢 | 使用 `ModInitializer` 接口（非 `@Mod` 注解） |
| 1.4 配置 JDK 21、Lombok、Gson、SQLite JDBC 依赖 | B | 3h | 🟢 | 已配置 build.gradle |
| 1.5 创建包结构 | B | 2h | 🟢 | ai/bot/config/entry/persistence/registry/status/tcp/tool |
| 1.6 配置 Spotless + Checkstyle 代码格式插件 | B | 3h | 🔴 | 未实现，非关键依赖 |
| 1.7 验证空模组加载 | A+B | 2h | 🟢 | compileJava 通过 |

**预计总工时**：18h

---

## V2：TCP 客户端

**周期**：第 2 周  
**状态**：🟢 已完成  
**进度**：7/7

| 任务 | 负责人 | 预计工时 | 状态 | 备注 |
|------|--------|---------|------|------|
| 2.1 TcpClient 类实现 | A | 6h | 🟢 | 长连接管理、线程模型、消息路由 |
| 2.2 JSON-RPC 2.0 消息编解码 | A | 4h | 🟢 | Request/Response/Error/Notification/Batch + Codec |
| 2.3 粘包处理 | A | 3h | 🟢 | MessageFrameCodec：`\n` 分隔，内部缓冲区分片 |
| 2.4 握手协议 | A | 3h | 🟢 | HandshakeManager：instance_id + auth_token + version + mod |
| 2.5 心跳响应 | B | 3h | 🟢 | HeartbeatManager：ping → pong，含 timestamp + tick |
| 2.6 断线重连 | B | 4h | 🟢 | ReconnectManager：指数退避（1s→2s→4s→8s→16s），最多 5 次 |
| 2.7 连接状态管理 | B | 4h | 🟢 | ConnectionState 枚举 + 状态监听器 + tool_call_batch |

**预计总工时**：27h

### 实现详情

| 文件 | 说明 |
|------|------|
| `tcp/JsonRpcMessage.java` | JSON-RPC 2.0 消息模型（Request/Response/Error/Notification/Batch） |
| `tcp/JsonRpcId.java` | 消息 ID 类型（String/Number/Null） |
| `tcp/JsonRpcCodec.java` | 完整编解码器，自动识别消息类型 |
| `tcp/MessageFrameCodec.java` | 粘包处理，`\n` 帧分隔 |
| `tcp/ConnectionState.java` | DISCONNECTED/CONNECTING/CONNECTED/RECONNECTING |
| `tcp/HandshakeManager.java` | 握手认证，Future 异步完成 |
| `tcp/HeartbeatManager.java` | 心跳响应（ping → pong） |
| `tcp/ReconnectManager.java` | 断线重连，指数退避 |
| `tcp/TcpClient.java` | 主客户端：连接/发送/接收/分发/重连 |

---

## V3：工具注册模块 + 状态上报

**周期**：第 3 周  
**状态**：🟢 已完成  
**进度**：7/8

| 任务 | 负责人 | 预计工时 | 状态 | 备注 |
|------|--------|---------|------|------|
| 3.1 @ToolModule / @ToolMethod / @ToolParam 注解定义 | B | 3h | 🟢 | 全部 3 个注解已定义 |
| 3.2 IToolModule 接口定义 | B | 2h | 🟢 | AliceTool 接口替代 |
| 3.3 注解扫描器 ToolScanner | B | 6h | 🟢 | 扫描 `@ToolModule` 枚举类 |
| 3.4 JSON Schema 生成器 SchemaGenerator | B | 4h | 🟢 | 为 Agent Core 生成工具注册 payload |
| 3.5 工具注册流程 | A | 4h | 🟢 | 握手成功后自动注册，register_tools RPC |
| 3.6 状态采集 + 每 2s 上报 | A | 6h | 🟢 | StatusCollector + StatusData，JSON-RPC 通知 |
| 3.7 JSON 入口文件生成 | B | 3h | 🟢 | InstanceFileGenerator：mcagent_instance.json |
| 3.8 工具模块示例实现 | A+B | 4h | 🟢 | ChatTools 示例已实现 |

**预计总工时**：32h

---

## V4：移动工具

**周期**：第 4-5 周  
**状态**：🟢 已完成  
**进度**：5/5

| 任务 | 负责人 | 预计工时 | 状态 | 备注 |
|------|--------|---------|------|------|
| 4.1 move_to coordinate 实现 | A | 6h | 🟢 | MoveToTools + MovementController |
| 4.2 move_to entity 实现 | A | 4h | 🟢 | 跟随实体模式 |
| 4.3 move_to height 实现 | A | 3h | 🟢 | 升降高度模式 |
| 4.4 ride / dismount 实现 | B | 6h | 🟢 | 骑乘/脱离骑乘 |
| 4.5 移动控制器 | A | 4h | 🟢 | MovementController 整合 |

**预计总工时**：23h（主路径实现，不含独立 A* 寻路）

---

## V5：背包工具

**周期**：第 6 周  
**状态**：🟢 已完成  
**进度**：4/4

| 任务 | 负责人 | 预计工时 | 状态 | 备注 |
|------|--------|---------|------|------|
| 5.1 drop_item 实现 | A | 4h | 🟢 | InventoryTools + InventoryController |
| 5.2 take_from_container 实现 | A | 8h | 🟢 | 从（箱子/熔炉等）取物品 |
| 5.3 put_to_container 实现 | A | 6h | 🟢 | 向容器放物品 |
| 5.4 equip_item 实现 | A | 4h | 🟢 | 装备/卸下物品 |

**预计总工时**：22h

---

## V6：生存工具 + 方块工具

**周期**：第 7-8 周  
**状态**：🟢 已完成  
**进度**：7/7

| 任务 | 负责人 | 预计工时 | 状态 | 备注 |
|------|--------|---------|------|------|
| 6.1 eat 实现 | B | 4h | 🟢 | SurvivalTools.eat() |
| 6.2 sleep 实现 | B | 6h | 🟢 | sleep/wake/wait 三种模式 |
| 6.3 use_item 实现 | B | 6h | 🟢 | use/drink/throw 三种模式 |
| 6.4 mine_block 实现 | A | 6h | 🟢 | BlockTools + BlockController |
| 6.5 place_block 实现 | A | 4h | 🟢 | 支持朝向参数 |
| 6.6 use_block 实现 | A | 4h | 🟢 | 右键点击方块 |
| 6.7 area_operation 实现 | A | 10h | 🟢 | fill/clear/break/vein 四种模式 |

**预计总工时**：40h

---

## V7：战斗工具 + 生物交互

**周期**：第 9 周  
**状态**：🟢 已完成  
**进度**：4/4

| 任务 | 负责人 | 预计工时 | 状态 | 备注 |
|------|--------|---------|------|------|
| 7.1 set_combat_mode 实现 | B | 4h | 🟢 | EntityInteractionTools + CombatController |
| 7.2 stop_combat 实现 | B | 2h | 🟢 | |
| 7.3 interact_entity 实现 | B | 13h | 🟢 | feed/breed/trade/tame/shear/milk 六种交互 |
| 7.4 lead_entity 实现 | B | 3h | 🟢 | 拴绳/释放实体 |

**预计总工时**：22h

---

## V8：感知工具

**周期**：第 10 周  
**状态**：🟢 已完成  
**进度**：5/5

| 任务 | 负责人 | 预计工时 | 状态 | 备注 |
|------|--------|---------|------|------|
| 8.1 look_around 实现 | A | 6h | 🟢 | PerceptionTools + PerceptionController |
| 8.2 look_at_block 实现 | A | 4h | 🟢 | 方块详情查询 |
| 8.3 look_in_container 实现 | A | 6h | 🟢 | 容器内容查看 |
| 8.4 look_time_weather 实现 | A | 2h | 🟢 | 世界时间/天气 |
| 8.5 look_online_players 实现 | A | 2h | 🟢 | 在线玩家列表 |

**预计总工时**：20h

---

## V9：对话工具

**周期**：第 11 周  
**状态**：🟢 已完成  
**进度**：3/3

| 任务 | 负责人 | 预计工时 | 状态 | 备注 |
|------|--------|---------|------|------|
| 9.1 chat 实现 | A | 4h | 🟢 | ChatTools + ChatController |
| 9.2 whisper 实现 | A | 2h | 🟢 | 私聊 |
| 9.3 message 实现 | A | 6h | 🟢 | list/unread/mark_read/reply |

**预计总工时**：12h

---

## V10：假人管理模块 v1

**周期**：第 12 周  
**状态**：🟢 已完成  
**进度**：5/5

| 任务 | 负责人 | 预计工时 | 状态 | 备注 |
|------|--------|---------|------|------|
| 10.1 假人创建 | B | 8h | 🟢 | BotTools.botSpawn()：基于 Carpet 的 EntityPlayerMPFake |
| 10.2 假人休眠/销毁 | B | 3h | 🟢 | bot_despawn / bot_dismiss |
| 10.3 假人唤醒 | B | 6h | 🟢 | bot_respawn：从注册表恢复 |
| 10.4 多假人生命周期管理 | B | 4h | 🟢 | BotManager：spawn/despawn/respawn/dismiss，列表查询 |
| 10.5 假人注册表 | B | 4h | 🟢 | BotRepository：持久化假人注册信息 |

**预计总工时**：25h

---

## V11：数据持久化模块

**周期**：第 13 周  
**状态**：🔴 未开始  
**进度**：0/5

| 任务 | 负责人 | 预计工时 | 状态 | 备注 |
|------|--------|---------|------|------|
| 11.1 SQLite JDBC 初始化和连接管理 | B | 4h | 🔴 | |
| 11.2 config 表创建 + CRUD 封装 | B | 4h | 🔴 | |
| 11.3 memory_meta 表创建 | B | 3h | 🔴 | |
| 11.4 logs 表创建 + 工具执行日志写入 | B | 4h | 🔴 | |
| 11.5 数据库单元测试 | B | 3h | 🔴 | |

**预计总工时**：18h

---

## V12：配置接入模块与路径迁移

**周期**：第 14 周  
**状态**：🟡 进行中  
**进度**：1/7

| 任务 | 负责人 | 预计工时 | 状态 | 备注 |
|------|--------|:--------:|:----:|------|
| 12.0 设计文档 + 路径规范 | B | 4h | 🟢 | [JE-V12-配置接入模块与路径迁移.md](JE-V12-配置接入模块与路径迁移.md) |
| 12.1 路径迁移：AlicePaths 工具类 + PathMigration | B | 5h | 🔴 | 路径一致化：`config/mcagent/` → `Alice/` |
| 12.2 路径迁移：修改 InstanceFileGenerator / WorldIdentity / WorldContext | B | 3h | 🔴 | 3 个文件的路径硬编码修改 |
| 12.3 ConfigManager + ConfigFileWatcher 实现 | B | 9h | 🔴 | 配置缓存、文件热加载、JSON↔SQLite 同步 |
| 12.4 Fabric 指令 /alice 注册 + config/status/reload 子命令 | B | 4h | 🔴 | 指令注册与执行逻辑 |
| 12.5 配置变更 TCP 通知集成 | B | 2h | 🔴 | 通过 `config_update` 通知 Agent Core |
| 12.6 单元测试 + AC 连接联调验证 | A+B | 6h | 🔴 | |

**预计总工时**：33h（含路径迁移 12h + 配置接入 21h）

---

## V13：任务工具对接

**周期**：第 15 周  
**状态**：🔴 未开始  
**进度**：0/4

| 任务 | 负责人 | 预计工时 | 状态 | 备注 |
|------|--------|---------|------|------|
| 13.1 检查全部 26 个工具的执行结果格式 | A | 4h | 🔴 | |
| 13.2 工具错误信息结构化 | A | 4h | 🔴 | |
| 13.3 工具超时处理增强 | B | 4h | 🔴 | |
| 13.4 全部工具与 Agent Core 任务系统联调 | A+B | 8h | 🔴 | |

**预计总工时**：20h

---

## V14：事件通知完善 + 性能优化 + 72h 稳定性测试

**周期**：第 16-17 周  
**状态**：🔴 未开始  
**进度**：0/7

| 任务 | 负责人 | 预计工时 | 状态 | 备注 |
|------|--------|---------|------|------|
| 14.1 事件通知完善 | B | 8h | 🔴 | |
| 14.2 寻路算法性能优化 | A | 6h | 🔴 | |
| 14.3 状态上报优化 | A | 4h | 🔴 | |
| 14.4 Gson 序列化性能 | A | 3h | 🔴 | |
| 14.5 JVM GC 参数调优 | B | 4h | 🔴 | |
| 14.6 72h 稳定性测试 | A+B | 持续 | 🔴 | |
| 14.7 Bug 修复 | A+B | 按需 | 🔴 | |

**预计总工时**：25h + 持续测试

---

## V15：E2E 集成测试 + 打包 + 文档

**周期**：第 18-20 周  
**状态**：🔴 未开始  
**进度**：0/6

| 任务 | 负责人 | 预计工时 | 状态 | 备注 |
|------|--------|---------|------|------|
| 15.1 JUnit 5 单元测试覆盖全部 26 个工具 | A+B | 16h | 🔴 | |
| 15.2 Fabric GameTest 集成测试 | B | 12h | 🔴 | |
| 15.3 E2E 集成测试 | A | 8h | 🔴 | |
| 15.4 Fabric 模组 jar 打包 | A | 4h | 🔴 | |
| 15.5 部署文档 + 使用文档 | B | 8h | 🔴 | |
| 15.6 版本 Tag + Release Notes | A+B | 2h | 🔴 | |

**预计总工时**：50h

---

## 工时统计

| 版本 | 预计工时 | 已完成 | 剩余 |
|------|---------|--------|------|
| V1 | 18h | 18h | 0h |
| V2 | 27h | 27h | 0h |
| V3 | 32h | 32h | 0h |
| V4 | 23h | 23h | 0h |
| V5 | 22h | 22h | 0h |
| V6 | 40h | 40h | 0h |
| V7 | 22h | 22h | 0h |
| V8 | 20h | 20h | 0h |
| V9 | 12h | 12h | 0h |
| V10 | 25h | 25h | 0h |
| V11 | 18h | 0h | 18h |
| V12 | 33h | 4h | 29h |
| V13 | 20h | 0h | 20h |
| V14 | 25h | 0h | 25h |
| V15 | 50h | 0h | 50h |
| **总计** | **367h** | **245h** | **122h** |

---

## 状态说明

- 🔴 未开始
- 🟡 进行中
- 🟢 已完成
- 🔵 阻塞中
- ⚪ 已取消

---

## 文件清单

### TCP 客户端（V2）

| 文件 | 说明 |
|------|------|
| `tcp/TcpClient.java` | 主 TCP 客户端，连接/发送/接收/重连 |
| `tcp/JsonRpcMessage.java` | JSON-RPC 2.0 消息模型 |
| `tcp/JsonRpcId.java` | 消息 ID 类型 |
| `tcp/JsonRpcCodec.java` | 消息编解码器 |
| `tcp/MessageFrameCodec.java` | 粘包处理 |
| `tcp/ConnectionState.java` | 连接状态枚举 |
| `tcp/HandshakeManager.java` | 握手认证 |
| `tcp/HeartbeatManager.java` | 心跳响应 |
| `tcp/ReconnectManager.java` | 断线重连 |

### 工具模块（V3-V9）

| 文件 | 工具数 |
|------|--------|
| `tool/perception/PerceptionTools.java` | 5 |
| `tool/movement/MoveToTools.java` | 3 |
| `tool/inventory/InventoryTools.java` | 4 |
| `tool/entity/EntityInteractionTools.java` | 4 |
| `tool/survival/SurvivalTools.java` | 3 |
| `tool/block/BlockTools.java` | 4 |
| `tool/chat/ChatTools.java` | 3 |
| `tool/module/BotTools.java` | 6 |
| **合计** | **32** |

### 控制器（AI 执行层）

| 文件 | 关联工具 |
|------|---------|
| `ai/perception/PerceptionController.java` | 感知 |
| `ai/movement/MovementController.java` | 移动 |
| `ai/inventory/InventoryController.java` | 背包 |
| `ai/interaction/EntityInteractionController.java` | 生物交互 |
| `ai/combat/CombatController.java` | 战斗 |
| `ai/survival/SurvivalController.java` | 生存 |
| `ai/inventory/BlockController.java` | 方块 |
| `ai/chat/ChatController.java` | 对话 |

### 状态与入口

| 文件 | 说明 |
|------|------|
| `status/StatusData.java` | 状态上报数据模型 |
| `status/StatusCollector.java` | 周期性状态采集（每 2s） |
| `status/EventDispatcher.java` | 事件通知分发 |
| `entry/InstanceFileGenerator.java` | JSON 入口文件生成 |
| `bot/BotManager.java` | 假人生命周期管理 |
| `bot/BotRepository.java` | 假人注册表持久化 |
| `bot/AliceBotPlayer.java` | 假人玩家实体 |
| `bot/FakeConnection.java` | 假人网络连接 |

---

## 更新日志

| 日期 | 更新内容 |
|------|---------|
| 2026-07-14 | 创建进度跟踪文档 |
| 2026-07-14 | V1-V10 状态更新为已完成；V2 TCP 客户端增强（handshake Future 修复、tool_call_batch 支持） |
| 2026-07-15 | V12 设计文档完成：路径迁移 `config/mcagent/` → `Alice/` + 配置接入模块设计 |
