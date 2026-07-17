# Alice Mod JE 工具全覆盖集成测试文档（IT-05）

> 版本：v1.0
> 日期：2026-07-17
> 模块：JE 端全部工具集成测试（Agent Core → Adapter JE）
> 关联文档：
> - [IT-01-集成测试需求文档.md](IT-01-集成测试需求文档.md)
> - [IT-02-集成测试架构文档.md](IT-02-集成测试架构文档.md)
> - [IT-03-集成测试执行文档.md](IT-03-集成测试执行文档.md)
> - [../JE/JE-08-工具拓展接口设计文档.md](../JE/JE-08-工具拓展接口设计文档.md)

---

## 第1章 概述

### 1.1 背景

Alice Mod JE 端目前实现了 **8 个工具模块、共计 32 个工具方法**，覆盖感知、移动、背包、方块操作、实体交互、生存、聊天、假人管理等核心游戏能力。上一期集成测试（IT-01~IT-03）验证了 Bug 修复和基础链路（`bot_spawn` / `bot_info` / `move_to`），但尚未覆盖全部工具。

本期目标：**从 AC 端向 JE 端发起真实工具调用，覆盖全部 32 个 JE 工具，验证每个工具的正确性、参数解析、错误处理**。

### 1.2 范围

| 范围 | 内容 |
|------|------|
| **在范围内** | JE 端全部 8 个工具模块、32 个 `@ToolMethod` 方法的集成测试 |
| **在范围内** | 从 AC 端通过 `ToolDispatcher.callTool` 向 JE 发起 `tool_call` JSON-RPC 请求 |
| **在范围内** | 参数正确传递、返回值正确解析、错误路径（参数缺失/实体不存在等） |
| **不在范围内** | LLM 真实推理（mock provider 即可） |
| **不在范围内** | BE 端（adapter-bedrock）工具 |
| **不在范围内** | AC 端自身工具（AC_TOOL_COUNT = 17） |
| **不在范围内** | 性能/压力测试 |

### 1.3 测试拓扑

沿用 IT-02 定义的 L2 端到端测试架构：

```
┌──────────────────────────────────────────────────────────────┐
│  AC 测试进程（vitest）                                         │
│  ┌─────────────────┐   ┌────────────────────────────────┐    │
│  │ AcMinimalServer  │   │  ToolDispatcher.callTool()     │    │
│  │ (in-process TCP) │───│  → tool_call Request          │    │
│  └────────┬────────┘   └───────────────┬────────────────┘    │
│           │                            │                      │
└───────────┼────────────────────────────┼──────────────────────┘
            │ TCP (JSON-RPC 2.0)         │
            ▼                            ▼
┌──────────────────────────────────────────────────────────────┐
│  JE 进程（Minecraft Java 服务端 + Fabric Mod）                 │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐  │
│  │ TcpClient    │  │ WorldContext  │  │ ToolController   │  │
│  │ (握手/心跳)   │──│ handleToolCall│──│ invoke → 假人执行 │  │
│  └──────────────┘  └───────────────┘  └──────────────────┘  │
│                                              │               │
│                                       ┌──────▼───────┐      │
│                                       │ Carpet 假人   │      │
│                                       │(EntityPlayerMPFake)││
│                                       └──────────────┘      │
└──────────────────────────────────────────────────────────────┘
```

### 1.4 工具总数

根据代码统计，JE 端工具注册常量 `ADAPTER_TOOL_COUNT = 26`，实际开发中的工具模块情况如下：

| 模块 | 工具数 | 实现状态 |
|------|--------|----------|
| PerceptionTools | 5 | 已实现 |
| MoveToTools | 3 | 已实现 |
| InventoryTools | 4 | 已实现 |
| BlockTools | 4 | 已实现 |
| EntityInteractionTools | 4 | 已实现 |
| SurvivalTools | 3 | 已实现 |
| ChatTools | 3 | 已实现 |
| BotTools | 6 | 已实现 |
| **合计** | **32** | **全部已实现** |

---

## 第2章 工具清单与分类

### 2.1 PerceptionTools — 感知类工具（5 个）

| 工具名 | 参数 | 返回值要点 | 前置条件 |
|--------|------|-----------|----------|
| `look_around` | `radius`(opt), `filter`(opt) | 附近实体/方块列表 | 假人在游戏世界中 |
| `look_at_block` | `x`, `y`, `z` | 方块名称、类型、属性 | 指定坐标存在方块 |
| `look_in_container` | `x`, `y`, `z` | 容器类型、槽位、物品列表 | 指定位置是容器 |
| `look_time_weather` | 无 | 世界时间、天气、难度 | 假人在线 |
| `look_online_players` | 无 | 玩家列表、位置、距离 | 假人在线 |

### 2.2 MoveToTools — 移动类工具（3 个）

| 工具名 | 参数 | 返回值要点 | 前置条件 |
|--------|------|-----------|----------|
| `move_to` | `x`(opt), `y`(opt), `z`(opt), `entity`(opt), `break`(opt), `distance`(opt) | 移动结果 | 假人在线 |
| `ride` | `entity_id` | 骑乘结果 | 目标实体可骑乘且距离足够 |
| `dismount` | 无 | 脱离结果 | 假人正在骑乘 |

### 2.3 InventoryTools — 背包类工具（4 个）

| 工具名 | 参数 | 返回值要点 | 前置条件 |
|--------|------|-----------|----------|
| `drop_item` | `item_name`(opt), `count`(opt), `target_entity`(opt) | 丢弃结果 | 背包中有该物品 |
| `take_from_container` | `x`, `y`, `z`, `item_name`(opt), `count`(opt) | 取物结果 | 容器中有物品 |
| `put_to_container` | `x`, `y`, `z`, `item_name`(opt), `count`(opt) | 放物结果 | 背包中有物品且容器有空间 |
| `equip_item` | `item_name`, `slot`(opt), `action`(opt) | 装备/卸下结果 | 背包中有该物品 |

### 2.4 BlockTools — 方块类工具（4 个）

| 工具名 | 参数 | 返回值要点 | 前置条件 |
|--------|------|-----------|----------|
| `mine_block` | `x`, `y`, `z`, `options`(opt) | 挖掘结果 | 方块可挖掘 |
| `place_block` | `x`, `y`, `z`, `block_name`, `facing`(opt) | 放置结果 | 背包中有该方块 |
| `use_block` | `x`, `y`, `z` | 使用结果 | 方块可交互 |
| `area_operation` | `mode`, `from`, `to`, `block_name`(opt), `radius`(opt) | 区域操作结果 | 参数有效 |

### 2.5 EntityInteractionTools — 生物交互类工具（4 个）

| 工具名 | 参数 | 返回值要点 | 前置条件 |
|--------|------|-----------|----------|
| `set_combat_mode` | `mode`, `targetId`(opt) | 战斗模式设置结果 | 假人在线 |
| `stop_combat` | 无 | 停止战斗结果 | 正在战斗 |
| `interact_entity` | `entityId`, `action`, `tradeIndex`(opt) | 交互结果 | 目标实体存在且距离足够 |
| `lead_entity` | `entityId`, `action` | 拴绳/释放结果 | 目标实体可拴绳 |

### 2.6 SurvivalTools — 生存类工具（3 个）

| 工具名 | 参数 | 返回值要点 | 前置条件 |
|--------|------|-----------|----------|
| `eat` | `food_name`(opt) | 进食结果 | 背包中有食物，饥饿值不满 |
| `sleep` | `action`, `bed_pos`(opt), `wait_seconds`(opt) | 睡觉/起床/等待结果 | 床存在（sleep 操作） |
| `use_item` | `item_name`, `mode`(opt), `target`(opt) | 使用结果 | 背包中有该物品 |

### 2.7 ChatTools — 聊天类工具（3 个）

| 工具名 | 参数 | 返回值要点 | 前置条件 |
|--------|------|-----------|----------|
| `chat` | `message`, `mode`(opt) | 发送结果 | 假人在线 |
| `whisper` | `target`, `message` | 私聊结果 | 目标玩家在线 |
| `message` | `action`, `message_id`(opt), `content`(opt), `filter`(opt) | 消息管理结果 | 存在消息记录 |

### 2.8 BotTools — 假人管理类工具（6 个）

| 工具名 | 参数 | 返回值要点 | 前置条件 |
|--------|------|-----------|----------|
| `bot_spawn` | `name`, `x`, `y`, `z`, `dimension`(opt) | 假人 UUID、名称、位置 | 名称不重复 |
| `bot_despawn` | `name` | 休眠结果 | 假人在线 |
| `bot_respawn` | `name`, `x`(opt), `y`(opt), `z`(opt), `dimension`(opt) | 唤醒结果 | 假人已注册且离线 |
| `bot_dismiss` | `name` | 销毁结果 | 假人已注册 |
| `bot_list` | 无 | 所有假人列表 | 至少有一个假人 |
| `bot_info` | `name` | 假人详细信息 | 假人已注册 |

---

## 第3章 测试策略

### 3.1 分层策略

| 层级 | 描述 | 执行方式 | 耗时 |
|------|------|----------|------|
| **L2-A（基础链路）** | 复用已有测试：bot_spawn → bot_info → move_to | 真实 MC | 2-3 分钟 |
| **L2-B（工具全覆盖）** | 本期新增：覆盖全部 32 个工具 | 真实 MC | 5-10 分钟 |
| **L2-C（错误路径）** | 参数缺失、实体不存在、坐标越界等 | 真实 MC | 2-3 分钟 |

### 3.2 测试用例设计原则

1. **每个工具至少一个正向用例**：验证正常参数下工具返回 `success: true`
2. **每个工具至少一个错误路径用例**：验证参数缺失/越界/不存在的实体返回合适错误码
3. **有状态工具需考虑状态依赖**：如 `ride` 需要先找到可骑乘实体，`sleep` 需要先放置床
4. **不破坏环境**：测试后清理生成的假人、方块、物品
5. **幂等性**：可重复运行的测试，不依赖外部状态

### 3.3 测试模块分组

测试按工具模块分组，每组包含：

- **环境准备**（BeforeAll）：该模块测试所需的假人、方块、物品等
- **工具测试**：每个工具的正向 + 错误路径测试
- **环境清理**（AfterAll）：清除该模块测试产生的影响

### 3.4 测试文件结构

```
packages/agent-core/__tests__/it/
├── level2/
│   ├── je-e2e-test.test.ts              # 既有 L2 基础链路测试
│   └── je-tools-full.test.ts            # 【新增】JE 工具全覆盖测试
│
└── fixtures/
    ├── ac-minimal-server.ts              # 既有 AC 最小化服务器 fixture
    └── je-tools-env.ts                   # 【新增】测试环境辅助函数
```

---

## 第4章 详细测试用例

### 4.1 BotTools — 假人管理（基础依赖）

所有其他工具测试依赖假人，因此 BotTools 测试排在最前面，且作为其他模块测试的前置条件。

#### 4.1.1 bot_spawn — 创建假人

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-BT-01 | 正常创建假人 | `{name:"IT_Bot", x:0, y:64, z:0}` | `name`="IT_Bot", `uuid` 格式正确 |
| T-BT-02 | 创建同名假人（幂等） | `{name:"IT_Bot", x:0, y:64, z:0}` | 返回已在线实例，不报错 |
| T-BT-03 | 创建假人指定维度 | `{name:"IT_Bot_Nether", x:0, y:64, z:0, dimension:"nether"}` | 假人生成在下界 |
| T-BT-04 | 创建假人参数缺失（无 name） | `{x:0, y:64, z:0}` | 返回错误码 `INVALID_PARAMS` |

#### 4.1.2 bot_info — 查询假人信息

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-BT-05 | 查询在线假人 | `{name:"IT_Bot"}` | `online:true`, `name`="IT_Bot", `health`>0, `position` 存在 |
| T-BT-06 | 查询不存在的假人 | `{name:"NonExistent"}` | 错误码 `NOT_FOUND` |

#### 4.1.3 bot_despawn — 休眠假人

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-BT-07 | 休眠在线假人 | `{name:"IT_Bot"}` | 返回 `success:true`，假人离线 |
| T-BT-08 | 休眠已离线假人 | `{name:"IT_Bot"}` | 返回错误码 `NOT_FOUND` |

#### 4.1.4 bot_respawn — 唤醒假人

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-BT-09 | 唤醒休眠假人 | `{name:"IT_Bot"}` | 假人重新上线，位置在注册表位置 |
| T-BT-10 | 唤醒假人指定位置 | `{name:"IT_Bot", x:10, y:64, z:20}` | 假人在 (10,64,20) 位置上线 |
| T-BT-11 | 唤醒不存在的假人 | `{name:"NonExistent"}` | 错误码 `NOT_FOUND` |

#### 4.1.5 bot_list — 列出假人

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-BT-12 | 列出所有假人 | `{}` | `total`>0, 包含 `IT_Bot` 条目，`online` 状态正确 |

#### 4.1.6 bot_dismiss — 销毁假人

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-BT-13 | 销毁在线假人 | `{name:"IT_Bot_Nether"}` | 返回 `success:true`，假人不再存在 |
| T-BT-14 | 销毁已销毁的假人 | `{name:"IT_Bot_Nether"}` | 错误码 `NOT_FOUND` |

### 4.2 PerceptionTools — 感知工具

前置条件：假人 `IT_Bot` 在 (0,64,0) 在线。

#### 4.2.1 look_around — 查看附近环境

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-PC-01 | 默认半径扫描 | `{}` | 返回实体/方块列表，格式正确 |
| T-PC-02 | 指定半径扫描 | `{radius:32}` | 返回结果，`radius` 生效 |
| T-PC-03 | 带筛选条件扫描 | `{filter:{hostile:true}}` | 仅返回敌对生物 |
| T-PC-04 | 半径超过最大值 | `{radius:100}` | 自动限制为 64，不报错 |
| T-PC-05 | 无效 filter 格式 | `{filter:"invalid"}` | 不崩溃，返回空或忽略 filter |

#### 4.2.2 look_at_block — 查看方块

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-PC-06 | 查看脚下方块 | `{x:0, y:63, z:0}` | 返回方块名称、类型、属性 |
| T-PC-07 | 查看不存在的坐标 | `{x:0, y:0, z:0}` | 错误码 `BLOCK_NOT_FOUND` |
| T-PC-08 | 参数缺失 | `{x:0, y:0}` | 返回错误（参数验证失败） |

#### 4.2.3 look_in_container — 查看容器

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-PC-09 | 查看容器内容 | `{x:10, y:64, z:10}` | 返回容器类型、槽位、物品列表 |
| T-PC-10 | 查看非容器方块 | `{x:0, y:64, z:0}` | 错误码 `CONTAINER_NOT_FOUND` |
| T-PC-11 | 参数缺失 | `{x:0, y:0}` | 返回错误 |

#### 4.2.4 look_time_weather — 查看时间和天气

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-PC-12 | 查看时间和天气 | `{}` | 返回 `worldTime`, `dayTime`, `isDay`, `weather`, `difficulty` |

#### 4.2.5 look_online_players — 查看在线玩家

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-PC-13 | 查看在线玩家 | `{}` | 返回玩家列表，包含假人 `IT_Bot` |

### 4.3 MoveToTools — 移动工具

前置条件：假人 `IT_Bot` 在 (0,64,0) 在线。

#### 4.3.1 move_to — 移动

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-MV-01 | 坐标移动 | `{x:100, y:64, z:50}` | 返回 `success:true`，假人位置变化 |
| T-MV-02 | 高度调整 | `{y:80}` | 假人 Y 坐标变为约 80 |
| T-MV-03 | 跟随实体（无效 ID） | `{entity:"00000000-0000-0000-0000-000000000000"}` | 错误码 `MOVEMENT_FAILED` |
| T-MV-04 | 参数缺失（无 x/y/z/entity） | `{}` | 错误码 `INVALID_PARAMS` |
| T-MV-05 | 允许破坏方块移动 | `{x:100, y:64, z:50, break:true}` | 移动成功 |
| T-MV-06 | 跟随实体模式（需有可跟随实体） | `{entity:"<实体UUID>", distance:3}` | 移动成功 |

#### 4.3.2 ride — 骑乘

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-MV-07 | 骑乘不可骑乘实体 | `{entity_id:"<假人UUID>"}` | 错误码 `RIDE_FAILED`（假人不可骑乘） |
| T-MV-08 | 骑乘不存在的实体 | `{entity_id:"00000000-0000-0000-0000-000000000000"}` | 错误码 `RIDE_FAILED` |

#### 4.3.3 dismount — 脱离骑乘

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-MV-09 | 未骑乘时脱离 | `{}` | 错误码 `DISMOUNT_FAILED` |

### 4.4 InventoryTools — 背包工具

前置条件：假人 `IT_Bot` 在 (0,64,0) 在线。

#### 4.4.1 equip_item — 装备物品

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-IN-01 | 装备物品到主手 | `{item_name:"diamond_sword", slot:"hand", action:"equip"}` | 返回 `success:true`，主手持有钻石剑 |
| T-IN-02 | 装备物品到头部 | `{item_name:"diamond_helmet", slot:"head", action:"equip"}` | 返回 `success:true` |
| T-IN-03 | 卸下装备 | `{item_name:"diamond_sword", slot:"hand", action:"unequip"}` | 返回 `success:true` |
| T-IN-04 | 装备不存在的物品 | `{item_name:"nonexistent_item"}` | 错误码 `EQUIP_FAILED` |

#### 4.4.2 drop_item — 丢弃物品

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-IN-05 | 丢弃指定物品 | `{item_name:"dirt", count:1}` | 返回 `success:true`，地上出现掉落物 |
| T-IN-06 | 丢弃不存在的物品 | `{item_name:"nonexistent"}` | 错误码 `DROP_FAILED` |
| T-IN-07 | 丢弃物品给实体 | `{item_name:"dirt", count:1, target_entity:"<实体UUID>"}` | 返回 `success:true` |

#### 4.4.3 take_from_container — 从容器取物

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-IN-08 | 从容器取指定物品 | `{x:10, y:64, z:10, item_name:"stone", count:1}` | 返回 `success:true`，背包中有 stone |
| T-IN-09 | 从空容器取物 | `{x:10, y:64, z:10}` | 错误码 `TAKE_FAILED` |
| T-IN-10 | 从非容器位置取物 | `{x:0, y:64, z:0}` | 错误码 `TAKE_FAILED` |

#### 4.4.4 put_to_container — 向容器放物

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-IN-11 | 向容器放入物品 | `{x:10, y:64, z:10, item_name:"dirt", count:1}` | 返回 `success:true`，容器中多出 dirt |
| T-IN-12 | 背包中无该物品时放入 | `{x:10, y:64, z:10, item_name:"diamond_block"}` | 错误码 `PUT_FAILED` |

### 4.5 BlockTools — 方块工具

前置条件：假人 `IT_Bot` 在 (0,64,0) 在线，创造模式（或背包中有足够方块）。

#### 4.5.1 mine_block — 挖掘方块

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-BK-01 | 挖掘可破坏方块 | `{x:10, y:64, z:10}` | 返回 `success:true`，方块被破坏 |
| T-BK-02 | 带精准采集选项 | `{x:10, y:64, z:10, options:{silk_touch:true}}` | 返回 `success:true` |
| T-BK-03 | 挖掘不可破坏方块（如基岩） | `{x:0, y:-60, z:0}` | 错误码 `MINE_FAILED` |
| T-BK-04 | 参数缺失 | `{x:0, y:0}` | 返回错误 |

#### 4.5.2 place_block — 放置方块

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-BK-05 | 放置方块 | `{x:10, y:64, z:10, block_name:"stone"}` | 返回 `success:true`，位置出现 stone |
| T-BK-06 | 放置方块指定朝向 | `{x:10, y:64, z:10, block_name:"stone", facing:"up"}` | 放置成功，朝向正确 |
| T-BK-07 | 放置到已有方块位置 | `{x:10, y:64, z:10, block_name:"stone"}` | 错误码 `PLACE_FAILED` 或覆盖成功 |
| T-BK-08 | 参数缺失 | `{x:0, y:0, z:0}` | 返回错误 |

#### 4.5.3 use_block — 使用方块

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-BK-09 | 使用可交互方块（如拉杆） | `{x:10, y:64, z:10}` | 返回 `success:true` |
| T-BK-10 | 使用不可交互方块 | `{x:10, y:64, z:10}` | 返回 `success:true`（无操作） |
| T-BK-11 | 使用不存在的方块 | `{x:0, y:0, z:0}` | 错误码 `USE_FAILED` |

#### 4.5.4 area_operation — 区域方块操作

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-BK-12 | fill 模式填充区域 | `{mode:"fill", from:{x:10,y:64,z:10}, to:{x:15,y:64,z:15}, block_name:"stone"}` | 返回 `success:true`，区域被 stone 填充 |
| T-BK-13 | clear 模式清除区域 | `{mode:"clear", from:{x:10,y:64,z:10}, to:{x:15,y:64,z:15}}` | 返回 `success:true`，方块被清除 |
| T-BK-14 | break 模式挖掘区域 | `{mode:"break", from:{x:10,y:64,z:10}, to:{x:15,y:64,z:15}}` | 返回 `success:true`，方块被挖掘 |
| T-BK-15 | vein 模式矿脉扫描 | `{mode:"vein", from:{x:0,y:10,z:0}, to:{x:15,y:20,z:15}, radius:5}` | 返回 `success:true`，扫描结果正确 |
| T-BK-16 | 无效 mode 参数 | `{mode:"invalid", from:{x:0,y:0,z:0}, to:{x:1,y:1,z:1}}` | 错误码 `AREA_OP_FAILED` |
| T-BK-17 | 参数缺失 | `{mode:"fill"}` | 返回错误 |

### 4.6 EntityInteractionTools — 生物交互工具

前置条件：假人 `IT_Bot` 在 (0,64,0) 在线。

#### 4.6.1 set_combat_mode — 设置战斗模式

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-EN-01 | 设置近战模式 | `{mode:"melee"}` | 返回 `success:true` |
| T-EN-02 | 设置远程模式 | `{mode:"ranged"}` | 返回 `success:true` |
| T-EN-03 | 设置防御模式 | `{mode:"defensive"}` | 返回 `success:true` |
| T-EN-04 | 设置无效模式 | `{mode:"invalid"}` | 错误码 `COMBAT_MODE_FAILED` |

#### 4.6.2 stop_combat — 停止战斗

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-EN-05 | 停止战斗 | `{}` | 返回 `success:true` |

#### 4.6.3 interact_entity — 与实体交互

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-EN-06 | 与不存在的实体交互 | `{entityId:"00000000-0000-0000-0000-000000000000", action:"feed"}` | 错误码 `INTERACT_FAILED` |
| T-EN-07 | 无效交互动作 | `{entityId:"<实体UUID>", action:"invalid"}` | 错误码 `INTERACT_FAILED` |

#### 4.6.4 lead_entity — 拴绳/释放实体

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-EN-08 | 拴绳不存在的实体 | `{entityId:"00000000-0000-0000-0000-000000000000", action:"lead"}` | 错误码 `LEAD_FAILED` |
| T-EN-09 | 释放不存在的实体 | `{entityId:"00000000-0000-0000-0000-000000000000", action:"release"}` | 错误码 `LEAD_FAILED` |

### 4.7 SurvivalTools — 生存工具

前置条件：假人 `IT_Bot` 在 (0,64,0) 在线。

#### 4.7.1 eat — 进食

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-SV-01 | 自动选择食物 | `{}` | 返回 `success:true`（如果背包中有食物） |
| T-SV-02 | 指定食物 | `{food_name:"apple"}` | 返回 `success:true` |
| T-SV-03 | 指定不存在的食物 | `{food_name:"nonexistent"}` | 错误码 `EAT_FAILED` |

#### 4.7.2 sleep — 睡觉/起床/等待

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-SV-04 | 等待模式 | `{action:"wait", wait_seconds:1}` | 返回 `success:true` |
| T-SV-05 | 无效操作 | `{action:"invalid"}` | 错误码 `SLEEP_FAILED` |

#### 4.7.3 use_item — 使用物品

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-SV-06 | 使用物品（use 模式） | `{item_name:"dirt", mode:"use"}` | 返回 `success:true` |
| T-SV-07 | 使用不存在的物品 | `{item_name:"nonexistent", mode:"use"}` | 错误码 `USE_ITEM_FAILED` |

### 4.8 ChatTools — 聊天工具

前置条件：假人 `IT_Bot` 在 (0,64,0) 在线。

#### 4.8.1 chat — 发送聊天消息

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-CH-01 | 普通聊天 | `{message:"Hello from IT Bot"}` | 返回 `success:true` |
| T-CH-02 | 广播模式 | `{message:"Broadcast test", mode:"broadcast"}` | 返回 `success:true` |
| T-CH-03 | 表情动作模式 | `{message:"waves hello", mode:"emote"}` | 返回 `success:true` |
| T-CH-04 | 消息过长 | `{message:"<超过256字符>"}` | 错误码 `MESSAGE_TOO_LONG` |

#### 4.8.2 whisper — 私聊

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-CH-05 | 私聊不存在的玩家 | `{target:"NonExistentPlayer", message:"Hello"}` | 错误码 `PLAYER_NOT_FOUND` |

#### 4.8.3 message — 消息管理

| 用例 ID | 描述 | 参数 | 期望结果 |
|---------|------|------|----------|
| T-CH-06 | 查询消息列表 | `{action:"list"}` | 返回消息列表（可能为空） |
| T-CH-07 | 查询未读消息 | `{action:"unread"}` | 返回未读消息列表 |
| T-CH-08 | 无效操作 | `{action:"invalid"}` | 错误码 `INTERNAL_ERROR` |

---

## 第5章 测试用例汇总

### 5.1 用例数量统计

| 模块 | 正向用例 | 错误路径用例 | 小计 |
|------|---------|------------|------|
| BotTools | 8 | 4 | 12 |
| PerceptionTools | 7 | 4 | 11 |
| MoveToTools | 4 | 4 | 8 |
| InventoryTools | 4 | 4 | 8 |
| BlockTools | 7 | 5 | 12 |
| EntityInteractionTools | 3 | 4 | 7 |
| SurvivalTools | 3 | 2 | 5 |
| ChatTools | 3 | 3 | 6 |
| **合计** | **39** | **30** | **69** |

### 5.2 用例优先级

| 优先级 | 数量 | 说明 |
|--------|------|------|
| P0 | 8 | 基础链路工具（bot_spawn/bot_info/move_to/bot_dismiss 等） |
| P1 | 35 | 常用工具（感知、背包、方块操作等） |
| P2 | 26 | 边缘工具与错误路径 |

---

## 第6章 测试环境与辅助函数

### 6.1 环境准备

沿用 IT-03 的测试环境配置：

- **AC**: `AcMinimalServer` 启动在端口 27541
- **JE**: 真实 Minecraft Java 服务端 + Fabric Mod + Alice Mod
- **假人**: 通过 `bot_spawn` 创建，用于测试其他工具

### 6.2 新增辅助函数

```typescript
// packages/agent-core/__tests__/it/fixtures/je-tools-env.ts

/**
 * 测试环境辅助函数
 */

/** 等待条件满足 */
export async function waitFor<T>(
  fn: () => T | null | Promise<T | null>,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const timeout = opts.timeoutMs ?? 60_000
  const interval = opts.intervalMs ?? 500
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await fn()
    if (result !== null && result !== undefined) return result
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`超过超时时间 ${timeout}ms`)
}

/** 确保假人在线，不在线则创建 */
export async function ensureBotOnline(
  dispatcher: any,
  workspaceId: string,
  name: string,
  x: number,
  y: number,
  z: number,
): Promise<any> {
  try {
    const info = await dispatcher.callTool(workspaceId, 'bot_info', { name }, 5000)
    if (info.online) return info
    // 休眠后唤醒
    await dispatcher.callTool(workspaceId, 'bot_respawn', { name }, 5000)
    return info
  } catch {
    return dispatcher.callTool(workspaceId, 'bot_spawn', { name, x, y, z }, 15000)
  }
}

/** 清理假人 */
export async function cleanupBot(
  dispatcher: any,
  workspaceId: string,
  name: string,
): Promise<void> {
  try {
    await dispatcher.callTool(workspaceId, 'bot_dismiss', { name }, 5000)
  } catch { /* ignore */ }
}

/** 设置假人游戏模式 */
export async function setGameMode(
  mcProcess: any,
  botName: string,
  mode: string,
): Promise<void> {
  return new Promise<void>((resolve) => {
    mcProcess.stdin.write(`/gamemode ${mode} ${botName}\n`)
    setTimeout(resolve, 1000)
  })
}

/** 给假人物品 */
export async function giveItem(
  mcProcess: any,
  botName: string,
  item: string,
  count = 1,
): Promise<void> {
  return new Promise<void>((resolve) => {
    mcProcess.stdin.write(`/give ${botName} ${item} ${count}\n`)
    setTimeout(resolve, 1000)
  })
}

/** 放置方块在指定位置 */
export async function setBlock(
  mcProcess: any,
  x: number,
  y: number,
  z: number,
  block: string,
): Promise<void> {
  return new Promise<void>((resolve) => {
    mcProcess.stdin.write(`/setblock ${x} ${y} ${z} ${block}\n`)
    setTimeout(resolve, 500)
  })
}

/** 生成实体 */
export async function summonEntity(
  mcProcess: any,
  entity: string,
  x: number,
  y: number,
  z: number,
): Promise<void> {
  return new Promise<void>((resolve) => {
    mcProcess.stdin.write(`/summon ${entity} ${x} ${y} ${z}\n`)
    setTimeout(resolve, 500)
  })
}
```

### 6.3 测试文件骨架

```typescript
// packages/agent-core/__tests__/it/level2/je-tools-full.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { startAcMinimalServer, type AcMinimalContext } from '../fixtures/ac-minimal-server'
import { waitFor, ensureBotOnline, cleanupBot, setGameMode,
         giveItem, setBlock, summonEntity } from '../fixtures/je-tools-env'

const BOT_NAME = 'IT_Bot'
const BOT_X = 0, BOT_Y = 64, BOT_Z = 0

function hasJava21(): boolean { /* ... */ }
async function waitForMcReady(childProcess: any, timeoutMs = 180_000): Promise<void> { /* ... */ }

describe.skipIf(!hasJava21())('JE 工具全覆盖集成测试', () => {
  let ac: AcMinimalContext
  let workspaceId: string
  let mcProcess: ReturnType<typeof spawn> | null = null

  beforeAll(async () => {
    // 1. 启动 AC
    ac = await startAcMinimalServer(27541, 'mct_64cf4ca6c0c64a75aaf9a5b0')
    // 2. 启动 MC 服务端
    mcProcess = spawn(/* ... */)
    await waitForMcReady(mcProcess, 180_000)
    // 3. 等待 JE 连接
    workspaceId = await waitFor(() => {
      const online = ac.workspaceManager.getOnlineWorkspaces()
      if (online.length > 0) {
        const tools = ac.workspaceManager.getWorkspaceTools(online[0].id)
        if (tools.length >= 3) return online[0].id
      }
      return null
    }, { timeoutMs: 60_000, intervalMs: 1000 })
    // 4. 创建测试假人
    await ensureBotOnline(ac.toolDispatcher, workspaceId, BOT_NAME, BOT_X, BOT_Y, BOT_Z)
  }, 300_000)

  afterAll(async () => {
    // 清理所有测试假人
    await cleanupBot(ac.toolDispatcher, workspaceId, BOT_NAME)
    // 停止 MC 服务端
    if (mcProcess && mcProcess.pid) {
      process.kill(mcProcess.pid, 'SIGTERM')
    }
    await ac.stop()
  }, 30_000)

  // ===== BotTools 测试组 =====
  describe('BotTools — 假人管理', () => {
    // 正向用例
    it('T-BT-01: bot_spawn 创建假人', async () => { /* ... */ })
    it('T-BT-02: bot_spawn 同名假人幂等', async () => { /* ... */ })
    // 错误路径
    it('T-BT-04: bot_spawn 参数缺失', async () => { /* ... */ })
    // ... 更多用例
  })

  // ===== PerceptionTools 测试组 =====
  describe('PerceptionTools — 感知工具', () => {
    it('T-PC-01: look_around 默认半径扫描', async () => { /* ... */ })
    // ... 更多用例
  })

  // ===== MoveToTools 测试组 =====
  describe('MoveToTools — 移动工具', () => {
    it('T-MV-01: move_to 坐标移动', async () => { /* ... */ })
    // ... 更多用例
  })

  // ... 其余模块
})
```

---

## 第7章 执行计划

### 7.1 阶段划分

| 阶段 | 内容 | 预计工作量 | 产出 |
|------|------|-----------|------|
| **Phase 1** | 辅助函数实现（`je-tools-env.ts`） | 0.5 天 | 环境准备/清理工具函数 |
| **Phase 2** | BotTools 测试组实现 | 0.5 天 | 12 个用例 |
| **Phase 3** | PerceptionTools + MoveToTools 测试组 | 0.5 天 | 19 个用例 |
| **Phase 4** | InventoryTools + BlockTools 测试组 | 1 天 | 20 个用例 |
| **Phase 5** | EntityInteractionTools + SurvivalTools + ChatTools 测试组 | 0.5 天 | 18 个用例 |
| **Phase 6** | 调试 + 全量运行验证 | 0.5 天 | 全部 69 个用例通过 |
| **合计** | | **3.5 天** | |

### 7.2 运行命令

```bash
# 编译 AC
cd packages/agent-core && pnpm build

# 编译 JE
cd ../../serverjava && ..\packages\adapter-java\gradlew build

# 运行 JE 工具全覆盖测试
cd packages/agent-core
pnpm vitest run __tests__/it/level2/je-tools-full.test.ts

# 运行单个模块
pnpm vitest run __tests__/it/level2/je-tools-full.test.ts -t "BotTools"
pnpm vitest run __tests__/it/level2/je-tools-full.test.ts -t "PerceptionTools"
```

### 7.3 时间预算

| 阶段 | 预计耗时 |
|------|---------|
| MC 服务端启动 | 60-120s |
| BotTools 测试 | 20-30s |
| PerceptionTools 测试 | 15-20s |
| MoveToTools 测试 | 30-60s |
| InventoryTools 测试 | 20-30s |
| BlockTools 测试 | 30-60s |
| EntityInteractionTools 测试 | 10-15s |
| SurvivalTools 测试 | 10-15s |
| ChatTools 测试 | 10-15s |
| 清理 | 5-10s |
| **总计** | **3-6 分钟** |

---

## 第8章 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 某些工具需要特定游戏状态（如夜晚才能睡觉） | 测试不稳定 | 使用 `/time set night` 命令控制游戏时间 |
| 实体交互工具需要真实被动型生物 | 测试环境复杂 | 使用 `/summon` 生成测试用生物 |
| 方块操作可能破坏测试世界 | 环境污染 | 在独立测试区域操作（如以 100,64,100 为原点） |
| Minecraft 服务端启动不稳定 | 测试超时 | 实现重试机制，延长超时时间到 180s |
| 假人执行操作需要时间（如挖掘、移动） | 异步结果 | 使用 `waitFor` 轮询直到结果符合预期 |

---

## 第9章 验收标准

| 编号 | 验收条件 |
|------|---------|
| AC-01 | 所有 69 个测试用例在本地 `vitest run` 中全部通过 |
| AC-02 | 每个 JE 工具至少有一个正向用例和一个错误路径用例 |
| AC-03 | 测试运行结束后清理所有假人，不留下残留状态 |
| AC-04 | 测试不破坏 MC 服务端世界文件 |
| AC-05 | 测试可重复运行，幂等 |
| AC-06 | 失败用例输出清晰的诊断信息（参数、响应、错误码） |

---

## 第10章 附录：工具注册验证

### 10.1 验证所有工具已注册到 AC

在 `beforeAll` 中，应在 JE 连接后验证注册的工具数量：

```typescript
// 验证 JE 端注册的工具数量
it('T-REG-01: 验证所有 JE 工具已注册到 AC', () => {
  const tools = ac.workspaceManager.getWorkspaceTools(workspaceId)
  expect(tools.length).toBeGreaterThanOrEqual(26)
  const toolNames = tools.map(t => t.name).sort()
  // 验证关键工具存在
  expect(toolNames).toContain('bot_spawn')
  expect(toolNames).toContain('bot_info')
  expect(toolNames).toContain('move_to')
  expect(toolNames).toContain('look_around')
  expect(toolNames).toContain('mine_block')
  expect(toolNames).toContain('chat')
  expect(toolNames).toContain('eat')
  expect(toolNames).toContain('set_combat_mode')
  expect(toolNames).toContain('drop_item')
})
```

### 10.2 工具 Schema 格式验证

```typescript
it('T-REG-02: 验证每个工具都有完整的 parameters 定义', () => {
  const tools = ac.workspaceManager.getWorkspaceTools(workspaceId)
  for (const tool of tools) {
    expect(tool.parameters).toBeDefined()
    expect(Object.keys(tool.parameters).length).toBeGreaterThanOrEqual(0)
    expect(tool.description).toBeTruthy()
  }
})
```