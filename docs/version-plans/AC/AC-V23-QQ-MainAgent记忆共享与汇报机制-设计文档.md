# AC-V23 — QQ 机器人链路完整整合（前端 + 群聊接入）

> 版本：v2.1 (完整版，新增前端群聊交互细节)
> 日期：2026-07-18
> 版本号：V23
> 关联文档：
>
> - [AC-V20-主链路组装-设计文档.md](AC-V20-主链路组装-设计文档.md)（MainAgent 主链路）
> - [AC-V14-事件触发器与QQ完善-架构文档.md](AC-V14-事件触发器与QQ完善-架构文档.md)（QQ 模块架构）
> - [AC-V11-记忆系统v1.md](AC-V11-记忆系统v1.md)（LTM 持久记忆）
> - [AC-V12-记忆系统v2-地图索引.md](AC-V12-记忆系统v2-地图索引.md)（地图索引记忆）
> - [AC-V13-任务系统.md](AC-V13-任务系统.md)（TaskManager 异步任务）
> - [AC-V25-NapCat-Docker化重构-设计文档.md](AC-V25-NapCat-Docker化重构-设计文档.md)（NapCat Docker 化重构）

---

## 第1章 概述

### 1.1 现状总结

V23 阶段已完成后端核心机制（QQ Agent 继承 MainAgent、共享 ChatHistory、共享 LTM、汇报机制），但**前端链路和群聊接入体验**尚未完整打通。具体表现为：

| 缺口 | 状态 | 影响 |
| --- | --- | --- |
| **前端缺少完整的群聊管理界面** | 仅有桥接配置（BridgeConfigPanel），无群列表、群成员展示 | 用户无法直观看到机器人已加入的群和群成员 |
| **Agent 创建时 QQ 绑定只能选桥接群** | 依赖 bridge 配置中已有的群，但 bridge 群与机器人实际加入的群可能不一致 | 用户手动配置群号，体验差 |
| **无群聊消息实时展示** | 消息日志只有原始文本流，无群聊/私聊区分展示 | 用户无法在 UI 中直观看到群聊对话 |
| **无机器人入群引导** | NapCat 安装后直接进入账号管理，无"如何拉机器人入群"指引 | 用户不知道如何让机器人加入群聊 |
| **无群聊/私聊切换视图** | 消息日志面板混排所有消息 | 用户无法按群筛选查看对话 |
| **无机器人状态面板** | 状态仅显示在线/离线，无群数量、消息量等概览 | 用户无法快速了解机器人活跃度 |
| **多 Agent 与多 QQ 账号绑定关系不清晰** | 前端绑定界面可从账号列表选择，但无绑定关系概览 | 用户不清楚哪个 Agent 对应哪个 QQ 账号 |

### 1.2 设计目标

让"**QQ 机器人进入群聊并聊天**"的完整链路在前端可配置、可监控、可操作：

1. **完整的安装向导**：NapCat 安装（Docker/桌面版）→ 扫码登录 → 账号创建完成
2. **Agent 创建时绑定 QQ 账号**：创建 Agent 时选择 QQ 账号和监听群组
3. **群聊消息路由**：QQ 群消息 → Agent 处理 → 回复到群聊
4. **群聊管理界面**：查看已加入的群、群成员、消息历史
5. **桥接配置**：QQ ↔ 游戏内聊天双向同步
6. **运行时监控**：账号状态、消息统计、日志查看

### 1.3 范围声明

| # | 项 | 目标 |
| - | --- | --- |
| 1 | 前端安装向导 | NapCat 安装（Docker/桌面版）→ QR 扫码登录 → 账号创建 → 自动启动 |
| 2 | Agent 创建绑定 | 创建 Agent 时选择 QQ 账号和监听群组 |
| 3 | 群聊消息路由 | QQ 群消息 → routeQQMessageToAgent → Agent 处理 → 回复 |
| 4 | 群聊管理 UI | 查看已加入群列表、群成员、消息历史 |
| 5 | 桥接配置 | 前端 UI 管理 QQ ↔ 游戏桥接规则 |
| 6 | 消息日志 | 按群/私聊筛选、搜索、查看回复 |
| 7 | 状态监控 | 账号在线状态、消息统计、连接状态 |
| 8 | 多账号管理 | 多 QQ 账号添加/删除/启用/停用 |

---

## 第2章 用户体验总览

### 2.1 完整用户旅程

```
┌─────────────────────────────────────────────────────────────────┐
│ 第一步：安装 NapCat                                              │
│                                                                 │
│  用户打开"机器人"面板                                            │
│    → 自动检测安装状态                                             │
│    → 未安装：显示安装向导                                        │
│    → 选择部署方式（Docker/桌面版）                                │
│    → 完成安装                                                    │
│    → 跳转到账号管理页面                                          │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ 第二步：添加 QQ 账号                                             │
│                                                                 │
│  用户点击"添加账号"                                              │
│    → 选择连接方式（扫码登录/手动配置）                            │
│    → 扫码登录：显示二维码 → 手机 QQ 扫码 → 自动创建账号           │
│    → 手动配置：输入 WebSocket 地址 + 端口 + Token                │
│    → 测试连接 → 保存账号                                        │
│    → 自动启用并连接 OneBot                                      │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ 第三步：将机器人拉入 QQ 群                                       │
│                                                                 │
│  用户拿到 QQ 账号后，在 QQ 中将该账号拉入目标群聊                 │
│    → 在群聊中 @机器人 或直接发送消息                              │
│    → 消息被 OneBot 接收 → 路由到绑定的 Agent                     │
│    → Agent 处理 → 回复到群聊                                    │
│    → 用户可在机器人面板的"消息日志"中查看对话记录                  │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ 第四步：创建 Agent 并绑定 QQ 账号                                │
│                                                                 │
│  用户进入"智能体"面板 → 创建新 Agent                             │
│    → 填写基本信息 → 选择人设 → 选择工具                          │
│    → 第三步：绑定 QQ 机器人（StepRobot）                          │
│    │   ├─ 启用 QQ 绑定                                           │
│    │   ├─ 选择已登录的 QQ 账号                                   │
│    │   └─ 选择监听群组（从已配置的桥接规则中选取）                │
│    ├─ 选择 LLM 模型                                               │
│    └─ 完成创建                                                   │
│                                                                 │
│  创建完成后：                                                    │
│    → Agent 实例自动启动                                           │
│    → QQ 消息通过 routeQQMessageToAgent 路由到该 Agent            │
│    → Agent 在群聊中自动回复                                      │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ 第五步：配置桥接（可选）                                         │
│                                                                 │
│  用户进入账号详情 → 桥接配置面板                                 │
│    → 添加桥接规则：群号 + 方向 + 前缀 + 关键词                   │
│    → QQ 群消息自动同步到游戏内聊天                               │
│    → 游戏内聊天自动同步到 QQ 群                                  │
│    → 支持双向/单向同步                                           │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ 第六步：日常使用与监控                                           │
│                                                                 │
│  用户可在机器人面板：                                             │
│    → 查看所有 QQ 账号列表及状态（在线/离线/错误）                 │
│    → 切换账号启用/停用                                           │
│    → 查看消息日志（按群/私聊/系统筛选，搜索）                     │
│    → 查看消息统计（收/发数量）                                    │
│    → 管理权限（默认权限等级、冷却时间、允许私聊）                 │
│    → 管理桥接规则                                                │
│    → 选择数据存储目录                                            │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 前端页面结构

```
QQ 机器人前端模块
├── RobotPage.tsx                      ← 入口页面（路由容器）
│   ├── NapCatSetupWizard.tsx          ← 安装向导（首次安装）
│   │   ├── Docker 方案流程
│   │   └── 桌面版方案流程
│   │       ├── 自动安装
│   │       └── 手动安装（验证目录）
│   ├── AccountListView.tsx            ← 账号列表（左侧面板）
│   │   ├── StatsBar.tsx               ← 统计概览栏
│   │   └── AccountCard.tsx            ← 单账号卡片
│   ├── AccountDetailView.tsx          ← 账号详情（右侧面板）
│   │   ├── DetailHeader.tsx           ← 账号头部信息
│   │   ├── Tabs
│   │   │   ├── PermissionPanel.tsx    ← 权限管理
│   │   │   ├── BridgeConfigPanel.tsx  ← 桥接配置
│   │   │   └── MessageLogPanel.tsx    ← 消息日志
│   └── AddAccountPanel.tsx            ← 添加账号面板
│       ├── QR 扫码登录
│       └── ManualConfig.tsx           ← 手动配置
│
├── 智能体创建绑定
│   └── StepRobot.tsx                  ← Agent 创建向导第三步
│
└── 智能体运行时
    └── AgentInstanceView.tsx          ← Agent 实例详情（含 QQ 状态）
```

---

## 第3章 前端详细设计

### 3.1 页面布局与路由

**位置**：[RobotPage.tsx](file:///d:/McAgent/packages/agent-core/src/renderer/src/components/qq-bot/RobotPage.tsx)

页面采用**左右分栏**布局：

```
┌─────────────────────────────────────────────────────┐
│ 左侧 (w-80)                    │ 右侧 (flex-1)       │
│                                │                     │
│ ┌────────────────────────────┐ │ ┌─────────────────┐ │
│ │ 标题: "QQ 机器人"           │ │ │ 账号详情 /      │ │
│ │ 统计: 3 个账号              │ │ │ 添加账号面板    │ │
│ │                            │ │ │                 │ │
│ │ ┌────────────────────────┐ │ │ │  - 权限管理      │ │
│ │ │ 账号卡片 1  (在线)      │ │ │ │  - 桥接配置      │ │
│ │ ├────────────────────────┤ │ │ │  - 消息日志      │ │
│ │ │ 账号卡片 2  (离线)      │ │ │ │                 │ │
│ │ ├────────────────────────┤ │ │ │ 或添加账号面板   │ │
│ │ │ 账号卡片 3  (错误)      │ │ │ │                 │ │
│ │ └────────────────────────┘ │ │ └─────────────────┘ │
│ │                            │ │                     │
│ │ [添加账号] 按钮             │ │                     │
│ └────────────────────────────┘ │                     │
└─────────────────────────────────────────────────────┘
```

**前端状态管理入口**：[qqBotStore.ts](file:///d:/McAgent/packages/agent-core/src/renderer/src/stores/qqBotStore.ts)

Zustand Store 是整个 QQ 机器人模块的**前端数据中枢**，所有组件的状态都通过它统一管理：

```
Component Tree                    Zustand Store                  Backend IPC
┌──────────────┐    read/write    ┌──────────────┐    invoke     ┌──────────────┐
│ RobotPage    │ ◄──────────────► │ accounts[]   │ ◄───────────► │ qq-bot-      │
│ AccountListView│               │ accountOrder │               │ handler.ts   │
│ AccountCard  │                │ selectedId   │               │              │
│ AccountDetail│                │ messageLogs  │               │ (JSON 文件)  │
│ Permission   │                │ qrCodeData   │               │ accounts.json│
│ BridgeConfig │                │ isAdding     │               │ logs/*.json  │
│ MessageLog   │                │ addMode      │               │              │
│ AddAccount   │                │ isConfiguring│               │ (Docker/     │
│ NapCatSetup  │                │ logFilter    │               │  NapCat)     │
└──────────────┘                └──────────────┘               └──────────────┘
                                        │
                                        │ IPC 事件推送
                                        │ qq-bot:status-update
                                        │ (后端主动推送状态变更)
                                        ▼
                                  UI 实时更新
```

**Store 核心数据流**：

```
1. 初始化：RobotPage 挂载时
   → loadAccounts()         → IPC qq-bot:get-accounts → JSON 文件 → 更新 accounts[]
   → checkInstallStatus()   → IPC qq-bot:get-install-status → 检测 Docker/NapCat

2. 添加账号：用户操作
   → 扫码登录：
     startAddAccount('qr')  → startQRLogin() → IPC qq-bot:start-qr-login → 获取二维码
     → 轮询 checkQRLogin()  → IPC qq-bot:check-qr-login → 登录成功 → loadAccounts()
   → 手动配置：
     testConnection(params) → IPC qq-bot:test-connection → WebSocket 测试
     addAccount(config)     → IPC qq-bot:add-account → JSON 保存 → loadAccounts()

3. 账号操作：
   → toggleAccount(id, bool) → IPC qq-bot:toggle-account → Docker/NapCat 启停
   → 后端 push qq-bot:status-update → handleStatusUpdate() → 更新 accounts[].status
   → removeAccount(id)      → IPC qq-bot:remove-account → 清理 JSON + 容器/进程

4. 消息日志：
   → selectAccount(id)      → loadMessageLogs(id) → IPC qq-bot:get-message-log
   → setLogFilter(filter)   → 重新加载消息日志
   → clearLogs(id)          → IPC qq-bot:clear-logs → 清空 JSON
   → 后端 onMessage 回调    → appendLog() → 新消息写入 JSON
   → 下单账号路由到 Agent   → routeQQMessageToAgent()

5. 配置管理：
   → saveConfig(id, config) → IPC qq-bot:save-config → JSON 文件更新 → 本地 state 更新
   → loadConfig(id)         → IPC qq-bot:get-config → JSON 读取
```

**页面状态机**：

```
[加载中] → 检测安装状态
    │
    ├── 未安装 → [NapCatSetupWizard] → 安装完成 → 重新检测
    │
    └── 已安装 → 加载账号列表
        │
        ├── 无账号 + 非添加中 → [EmptyState] → 点击添加
        │
        └── 有账号 → [左右分栏]
            ├── isAddingAccount=true → [AccountListView + AddAccountPanel]
            └── isAddingAccount=false → [AccountListView + AccountDetailView]
```

### 3.2 NapCat 安装向导

**位置**：[NapCatSetupWizard.tsx](file:///d:/McAgent/packages/agent-core/src/renderer/src/components/qq-bot/setup/NapCatSetupWizard.tsx)

**三步流程**：

```
Step 1: 选择部署方式
┌─────────────────────────────────────────────────────┐
│  [Docker 容器方案（推荐）]                            │
│  通过 Docker 运行 NapCat，跨平台、自动重启、多账号隔离  │
│                                                     │
│  [桌面版 NapCat]                                     │
│  直接在本机运行 NapCat 进程，无需 Docker               │
└─────────────────────────────────────────────────────┘
        │
        ├── 选择 Docker → Step 2a
        └── 选择 桌面版 → Step 2b

Step 2a: Docker 方案
┌─────────────────────────────────────────────────────┐
│  Docker 已就绪                                       │
│  ✓ Docker Engine: v27.0.0                           │
│                                                     │
│  [拉取 NapCat 镜像] 按钮                              │
│  ┌─────────────────────────────────────────────────┐ │
│  │ 进度条: ████████████░░░░░░ 60%                  │ │
│  │ 拉取镜像中                                       │ │
│  └─────────────────────────────────────────────────┘ │
│                                                     │
│  [返回选择其他部署方式]                                │
└─────────────────────────────────────────────────────┘

Step 2b: 桌面版方案
┌─────────────────────────────────────────────────────┐
│  [自动安装] [手动安装]                                │
│                                                     │
│  ┌─────────────────────────────────────────────────┐ │
│  │ 安装目录: /path/to/napcat-install  [选择目录]    │ │
│  └─────────────────────────────────────────────────┘ │
│                                                     │
│  [安装 NapCat 桌面版] 按钮                            │
│                                                     │
│  或手动安装说明：                                     │
│  1. 下载 NapCat 安装包                               │
│  2. 解压到任意目录                                   │
│  3. 选择目录 + 验证安装                               │
└─────────────────────────────────────────────────────┘
```

**后端 IPC 接口**：

| 接口 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `qq-bot:get-install-status` | 无 | `InstallStatus` | 检测 Docker 和 NapCat 安装状态 |
| `qq-bot:install-napcat` | `(mode: 'docker'\|'desktop', installDir?: string)` | `{success, error}` | 安装 NapCat |
| `qq-bot:choose-install-dir` | 无 | `string\|null` | 选择安装目录 |
| `qq-bot:verify-napcat-install` | `(dir: string)` | `{success, installDir?, error?}` | 验证安装目录 |

### 3.3 账号管理界面

#### 3.3.1 账号列表（左侧面板）

**位置**：[AccountListView.tsx](file:///d:/McAgent/packages/agent-core/src/renderer/src/components/qq-bot/list/AccountListView.tsx)

**组件结构**：

```
┌─────────────────────────────────┐
│ QQ 机器人              3 个账号  │  ← 标题 + 数量
│                                 │
│ ┌─────────────────────────────┐ │
│ │ 在线: 2  离线: 1  总消息: 128 │ │  ← StatsBar 统计
│ └─────────────────────────────┘ │
│                                 │
│ ┌─ 账号卡片 ──────────────────┐ │
│ │ 🟢 10001 (主账号)           │ │  ← AccountCard
│ │    3 个群 · 1:23:45         │ │  [开关]
│ ├─────────────────────────────┤ │
│ │ 🟢 10002 (子账号)           │ │
│ │    1 个群 · 0:30:12         │ │  [开关]
│ ├─────────────────────────────┤ │
│ │ 🔴 10003 (测试账号)         │ │
│ │    连接失败: 超时            │ │  [开关]
│ └─────────────────────────────┘ │
│                                 │
│ [添加账号] 按钮                  │
└─────────────────────────────────┘
```

**AccountCard 状态指示**：

| 状态 | 圆点颜色 | 文字 | 描述 |
| --- | --- | --- | --- |
| `online` | 🟢 绿色 | 在线 | 已连接 OneBot，正常运行 |
| `reconnecting` | 🟡 黄色 | 重连中 | WebSocket 断线自动重连 |
| `offline` | ⚪ 灰色 | 离线 | 已停用或未连接 |
| `error` | 🔴 红色 | 错误 | 连接失败，显示错误信息 |

#### 3.3.2 账号详情（右侧面板）

**位置**：[AccountDetailView.tsx](file:///d:/McAgent/packages/agent-core/src/renderer/src/components/qq-bot/detail/AccountDetailView.tsx)

**DetailHeader**：

```
┌─────────────────────────────────────────────────────────┐
│ [🟢] 10001 (主账号)                         [开关]     │
│       在线 · 3 个群 · 收 85 / 发 43                     │
└─────────────────────────────────────────────────────────┘
```

**权限管理面板**：[PermissionPanel.tsx](file:///d:/McAgent/packages/agent-core/src/renderer/src/components/qq-bot/detail/PermissionPanel.tsx)

```
┌─────────────────────────────────────────────────────────┐
│ 默认权限: [无权限 | 基础 | 命令 | 管理员]                │
│ 未在白名单中的用户的默认权限等级                           │
│                                                         │
│ 冷却时间: 3秒                           [═══●═══]       │
│ 同一用户两次命令调用的最小间隔                             │
│                                                         │
│ [ ] 允许私聊                                             │
│ 是否允许用户通过私聊方式与机器人交互                       │
│                                                         │
│ ── 部署方式 ──                                           │
│ 选择 NapCat 运行方式：Docker 容器（推荐）或桌面版进程      │
│ [Docker 容器] [桌面版进程]                               │
│                                                         │
│ ── 数据存储目录 ──                                       │
│ /path/to/napcat-data/              [选择目录]            │
│                                                         │
│ [保存权限配置] 按钮                                       │
└─────────────────────────────────────────────────────────┘
```

**桥接配置面板**：[BridgeConfigPanel.tsx](file:///d:/McAgent/packages/agent-core/src/renderer/src/components/qq-bot/detail/BridgeConfigPanel.tsx)

```
┌─────────────────────────────────────────────────────────┐
│ 已配置的桥接                                             │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 12345678              [双向]                  [🗑]  │ │
│ │ 前缀: [QQ]  关键词: 挖矿, 钻石                       │ │
│ ├─────────────────────────────────────────────────────┤ │
│ │ 87654321              [QQ->游戏]              [🗑]  │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ ┌─ 添加桥接规则 ──────────────────────────────────────┐ │
│ │ 群号: [________]    方向: [双向        ▼]           │ │
│ │ 前缀: [________]    关键词: [________]               │ │
│ │ [添加规则]                                           │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘

**BridgeConfigBridge 数据流**：
```
BridgeConfigPanel 组件
    │
    ├─ 读取 BridgeConfig 数据（从选中账号的 account.config.bridges）
    │   ├─ 显示已配置的桥接规则列表
    │   └─ 显示每个规则的群号、方向、前缀、关键词
    │
    ├─ 添加桥接规则
    │   ├─ 表单输入：群号、方向、前缀、关键词
    │   ├─ handleAddBridge()
    │   │   → 构造 BridgeConfig 对象
    │   │   → saveConfig(accountId, { ...account.config, bridges: [...bridges, newBridge] })
    │   │   → IPC qq-bot:save-config → JSON 持久化
    │   │   → 本地 state 更新（store 中 accounts[].config.bridges 更新）
    │   └─ 表单重置
    │
    └─ 删除桥接规则
        ├─ handleRemoveBridge(index)
        │   → 过滤掉指定索引的桥接规则
        │   → saveConfig(accountId, { ...account.config, bridges: updatedBridges })
        │   → IPC qq-bot:save-config → JSON 持久化
        └─ 本地 state 更新
```

**消息日志面板**：[MessageLogPanel.tsx](file:///d:/McAgent/packages/agent-core/src/renderer/src/components/qq-bot/detail/MessageLogPanel.tsx)

```
┌─────────────────────────────────────────────────────────┐
│ [全部 ▼]  [搜索消息内容...]                 [清空]     │
│                                                         │
│ ← 群聊 小明 #12345678                    14:30:22       │
│   帮我挖点钻石回来                                         │
│   → 好的，正在前往矿洞...                  320ms         │
│                                                         │
│ ← 私聊 小红                              14:29:15       │
│   在吗？                                                 │
│   → 在的，有什么需要帮助的吗？             210ms         │
│                                                         │
│ → 系统                                    14:28:00       │
│   账号已上线                                               │
│                                                         │
│ [加载更多]                                               │
└─────────────────────────────────────────────────────────┘
```

**消息日志完整数据流**：

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 消息日志数据流                                                                   │
│                                                                                 │
│ 1. 消息接收（后端）                                                              │
│    OneBotClient.onMessage 回调                                                   │
│    → qq-bot-handler.ts 中的 client.onMessage()                                   │
│      → appendLog(accountId, { type, direction: 'incoming', content, ... })       │
│      → 写入 logs/{accountId}.json                                                 │
│      → routeQQMessageToAgent() (并行，不阻塞日志写入)                              │
│                                                                                 │
│ 2. 消息回复（后端）                                                              │
│    message-router.ts 发送回复后                                                   │
│    → appendLog(accountId, { type, direction: 'outgoing', content, reply, ... })  │
│    → 写入 logs/{accountId}.json                                                   │
│                                                                                 │
│ 3. 前端加载                                                                      │
│    selectAccount(id) → loadMessageLogs(id)                                       │
│    → IPC qq-bot:get-message-log(accountId, { type, search })                     │
│    → 后端读取 logs/{accountId}.json → 过滤 → 返回                                │
│    → 更新 store.messageLogs                                                      │
│                                                                                 │
│ 4. 前端筛选                                                                      │
│    setLogFilter({ type: 'group' | 'private' | 'system' | 'all' })                │
│    → 重新调用 loadMessageLogs()                                                   │
│    → 后端根据 type 过滤日志                                                       │
│                                                                                 │
│ 5. 前端搜索                                                                      │
│    setLogFilter({ search: '关键词' })                                             │
│    → 重新调用 loadMessageLogs()                                                   │
│    → 后端根据 content/reply 模糊匹配                                              │
│                                                                                 │
│ 6. 加载更多                                                                      │
│    loadMoreLogs(accountId)                                                        │
│    → IPC qq-bot:get-message-log(accountId, { offset: 当前长度 })                   │
│    → 后端返回后续 50 条                                                           │
│    → append 到 store.messageLogs                                                  │
│                                                                                 │
│ 7. 清空日志                                                                      │
│    clearLogs(accountId)                                                          │
│    → IPC qq-bot:clear-logs(accountId)                                            │
│    → 后端清空 logs/{accountId}.json                                               │
│    → 前端清空 store.messageLogs                                                   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 3.4 添加账号面板

**位置**：[AddAccountPanel.tsx](file:///d:/McAgent/packages/agent-core/src/renderer/src/components/qq-bot/detail/AddAccountPanel.tsx)

**两种连接方式**：

```
┌─────────────────────────────────────────────────────────┐
│ 添加QQ账号                                    [取消]    │
│                                                         │
│ [扫码登录] [手动配置]                                     │
│                                                         │
│ ┌─ 扫码登录 ──────────────────────────────────────────┐ │
│ │                    ┌────────┐                        │ │
│ │                    │ 二维码  │                        │ │
│ │                    │  图片   │                        │ │
│ │                    └────────┘                        │ │
│ │                                                      │ │
│ │ 请使用手机QQ扫描二维码登录                              │ │
│ │ 二维码将在 2分30秒 后过期                              │ │
│ │                                                      │ │
│ │ [刷新二维码]                                          │ │
│ │                                                      │ │
│ │ 提示：                                                │ │
│ │ • 请确保手机QQ已登录                                   │ │
│ │ • 二维码有效期内只能扫描一次                            │ │
│ │ • 扫描后请在手机上确认登录                              │ │
│ └──────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**QR 登录流程图**：

```
用户点击"扫码登录"
    → startQRLogin() IPC 调用
    → 后端创建临时 Docker 容器或 NapCat 桌面版进程
    → 获取二维码 URL
    → 前端生成二维码图片显示
    → 启动轮询 (2s 间隔)
    → 用户手机 QQ 扫码
    → 后端检测到登录成功
    → 获取登录信息（QQ 号、昵称）
    → 自动创建账号（createManagedAccount）
    → 自动启用并连接 OneBot
    → 前端更新账号列表
    → 自动选中新账号
```

**手动配置面板**：[ManualConfig.tsx](file:///d:/McAgent/packages/agent-core/src/renderer/src/components/qq-bot/dialog/ManualConfig.tsx)

```
┌─────────────────────────────────────────────────────────┐
│ 主机: [127.0.0.1    ]    端口: [3001    ]              │
│ 协议: [ws ▼]                                           │
│ Token: [______________]（可选）                          │
│                                                         │
│ [测试连接]           [保存]                             │
│                                                         │
│ 测试结果: ✓ 连接成功 (延迟: 15ms)                        │
└─────────────────────────────────────────────────────────┘
```

### 3.5 Agent 创建时绑定 QQ

**关键文件对比**：

| 文件 | 位置 | 状态 | 说明 |
| --- | --- | --- | --- |
| **StepRobot.tsx** | `wizard/StepRobot.tsx` | ✅ 已实现，使用真实数据 | 从 qqBotStore.accounts 读取真实的 QQ 账号列表 |
| **QQBindSection.tsx** | `sections/QQBindSection.tsx` | ⚠️ 使用 Mock 数据 | 硬编码 `MOCK_QQ_ACCOUNTS` 和 `MOCK_QQ_GROUPS`，用于 AgentConfigForm 中 |

**两个组件的差异**：

```
StepRobot（Agent 创建向导使用）
├─ 读取 qqBotStore.accounts → 真实账号列表
├─ 账号列表显示在线/离线状态圆点
├─ 群组从选中账号的 bridges 配置中提取
├─ 绑定数据写入 WizardStore.formData.qqBinding
└─ 创建 Agent 时持久化到 AgentConfig

QQBindSection（AgentConfigForm 详情页使用）
├─ 使用硬编码 MOCK_QQ_ACCOUNTS
├─ 使用硬编码 MOCK_QQ_GROUPS
├─ 没有连接到真实数据源
└─ 需要重构为与 StepRobot 相同的数据源
```

**QQBindSection 重构方案**：从 qqBotStore 读取真实数据，去除 Mock 数据：

```typescript
// 改造前：Mock 数据
const MOCK_QQ_ACCOUNTS = [
  { id: '10001', name: '主账号 - 10001' },
  { id: '10002', name: '子账号 - 10002' },
  { id: '10003', name: '测试账号 - 10003' }
]

// 改造后：使用真实数据
const accounts = useQQBotStore(s => s.accounts)
const accounts = accounts.filter(a => a.enabled) // 只显示已启用的账号
```

**位置**：[StepRobot.tsx](file:///d:/McAgent/packages/agent-core/src/renderer/src/components/agent/wizard/StepRobot.tsx)

**Agent 创建向导**（共 5 步）：

```
Step 1: 基本信息
Step 2: 人设配置
Step 3: 机器人绑定 ← 当前步骤
Step 4: 工具选择
Step 5: LLM 模型配置
```

**StepRobot 界面**：

```
┌─────────────────────────────────────────────────────────┐
│ 机器人绑定                                              │
│ 可选：绑定 QQ 机器人账号                                  │
│                                                         │
│ [✓] 绑定 QQ 机器人                                      │
│                                                         │
│ ┃ QQ 账号                                               │
│ ┃ [🟢 主账号 (10001) 在线         ▼]                    │
│ ┃                                                       │
│ ┃ 监听群组             (已绑定 2 个群)                    │
│ ┃ [12345678 ×] [87654321 ×]                             │
│ ┃ [添加群组... ▼]                                       │
│ ┃   ├─ 12345678 (Minecraft 服务器群)                    │
│ ┃   └─ 87654321 (AI 开发交流群)                         │
└─────────────────────────────────────────────────────────┘
```

**数据流**：

```
StepRobot 组件
    │
    ├─ 读取 QQ 账号列表（useQQBotStore.accounts）
    │   ├─ 显示在线/离线状态
    │   └─ 用户选择绑定账号
    │
    ├─ 读取桥接群组（从选中账号的 config.bridges 中提取）
    │   ├─ 显示已配置的桥接群列表
    │   └─ 用户选择监听群组
    │
    └─ 写入 WizardStore.formData.qqBinding
        ├─ enabled: boolean
        ├─ accountId: string
        └─ groupIds: string[]

创建 Agent 时，qqBinding 存储到 AgentConfig
    → routeQQMessageToAgent 根据 accountId 找到绑定的 Agent
    → groupIds 用于过滤消息来源
```

### 3.6 组件交互全景图

以下展示了所有前端组件之间的依赖关系和交互路径：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                RobotPage                                     │
│  (路由入口，检测安装状态，决定显示安装向导 / 账号列表 / 详情)                  │
└──────────┬─────────────────────────────────────────────────────┬────────────┘
           │ 状态管理                                              │
           ▼                                                      ▼
┌──────────────────────┐                            ┌──────────────────────────┐
│   AccountListView     │                            │  AccountDetailView       │
│  (账号列表，w-80)     │                            │  (账号详情，flex-1)       │
│                       │                            │                          │
│ ┌───────────────────┐ │                            │ ┌──────────────────────┐ │
│ │ StatsBar          │ │  selectAccount(id)          │ │ DetailHeader         │ │
│ │ 在线/消息统计      │ │ ─────────────────────────► │ │ 账号信息 + 开关       │ │
│ └───────────────────┘ │                            │ └──────────────────────┘ │
│                       │                            │                          │
│ ┌───────────────────┐ │                            │ ┌──────────────────────┐ │
│ │ AccountCard[]     │ │                            │ │ Tabs:                 │ │
│ │ 账号卡片列表       │ │                            │ │  ├─ PermissionPanel  │ │
│ │ 显示状态/群数/在线 │ │                            │ │  ├─ BridgeConfigPanel│ │
│ │ 时长/错误信息      │ │                            │ │  └─ MessageLogPanel  │ │
│ └───────────────────┘ │                            │ └──────────────────────┘ │
│                       │                            │                          │
│ [添加账号] 按钮        │                            │ ┌──────────────────────┐ │
│ → startAddAccount()   │                            │ │ AddAccountPanel      │ │
└──────────────────────┘                            │ │  ├─ QR 扫码登录      │ │
                                                    │ │  └─ ManualConfig     │ │
           ┌─────────────────────────────────────────┘ └──────────────────────┘ │
           │                                                                    │
           ▼                                                                    │
┌───────────────────────────────────────────────────────────────────────────────┘
│
│ 跨页面组件：
│
│ ┌──────────────────────────────────────────────┐
│ │ Agent 创建向导 (StepRobot)                    │
│ │ 读取 qqBotStore.accounts → 显示可选账号列表   │
│ │ 写入 WizardStore.formData.qqBinding          │
│ └──────────────────────────────────────────────┘
│
│ ┌──────────────────────────────────────────────┐
│ │ AgentInstanceView                            │
│ │ 每 30s agent:get-status → 显示 QQ 在线状态    │
│ └──────────────────────────────────────────────┘
```

### 3.7 Agent 运行时 QQ 状态

**位置**：[AgentInstanceView.tsx](file:///d:/McAgent/packages/agent-core/src/renderer/src/components/agent/AgentInstanceView.tsx)

```
┌─────────────────────────────────────────────────────────┐
│ [头像] Alice (online)      最后活跃: 3分钟前            │
│        🟢 QQ: 在线                        [信息] [配置] │
└─────────────────────────────────────────────────────────┘
```

**QQ 状态显示逻辑**：

```
AgentInstanceView useEffect
    → 每 30s 调用 agent:get-status
    → 返回 { status, qqStatus }
    → 显示 🟢 QQ: 在线 / 🟡 QQ: 连接中 / ⚪ QQ: 离线
    → 仅当 AgentConfig.qqBinding.enabled=true 时显示
```

### 3.8 群聊管理界面（待实现）

当前文档中缺少**群聊管理界面**。在完成账号登录后，用户需要能够：

1. **查看已加入的群列表**：机器人通过 OneBot API 获取已加入的群
2. **查看群成员**：获取群成员列表
3. **查看群聊聊天记录**：按群筛选消息日志

**界面设计**：

```
┌─────────────────────────────────────────────────────────┐
│ 账号详情 → 新增 Tab: "群聊管理"                          │
│                                                         │
│ ┌─ 群聊管理 ──────────────────────────────────────────┐ │
│ │ ┌─ 群列表 ───────────────────────────────────────┐ │ │
│ │ │ 群号 12345678     成员: 200   今日消息: 15     │ │ │
│ │ │ 群号 87654321     成员: 150   今日消息: 8      │ │ │
│ │ │ ...                                           │ │ │
│ │ └───────────────────────────────────────────────┘ │ │
│ │                                                     │ │
│ │ ┌─ 选中群详情 ────────────────────────────────────┐ │ │
│ │ │ 群名称: Minecraft 服务器群                       │ │ │
│ │ │ 群号: 12345678                                  │ │ │
│ │ │ 群成员列表:                                      │ │ │
│ │ │   🟢 Alice (群主)                               │ │ │
│ │ │   🟢 Bob (管理员)                               │ │ │
│ │ │   🟢 Charlie (成员)                             │ │ │
│ │ │   ...                                          │ │ │
│ │ └───────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**后端 IPC 接口需求**（通过 OneBot API 获取，参数为账号 ID）：

| IPC 通道 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `qq-bot:get-group-list` | `(accountId)` | `GroupInfo[]` | 获取已加入的群列表 |
| `qq-bot:get-group-member-list` | `(accountId, groupId)` | `GroupMember[]` | 获取群成员列表 |
| `qq-bot:get-group-messages` | `(accountId, groupId, offset?)` | `LogEntry[]` | 按群筛选消息日志 |

**实现方式**：通过已连接的 OneBotClient 调用 `get_group_list` / `get_group_member_list` API。

---

## 第4章 消息路由与群聊接入

### 4.1 完整消息路由链路（从用户发出到收到回复的完整路径）

以下展示一条 QQ 群消息从用户发出到收到 AI 回复的完整端到端路径：

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  用户操作                           系统内部路径                             前端显示 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│  ① 用户在 QQ 群中发送消息                                                          │
│     "@Alice 帮我挖钻石"                                                             │
│          │                                                                        │
│          ▼                                                                        │
│  ② NapCat 接收消息，通过 WebSocket 推送到 OneBotClient                            │
│     (WebSocket 连接: ws://127.0.0.1:3001)                                         │
│          │                                                                        │
│          ▼                                                                        │
│  ③ OneBotClient.handleRawMessage()                                                │
│     → 解析 JSON 消息事件                                                           │
│     → 转换为 QQMessage 对象                                                        │
│     → 触发 messageHandlers 回调                                                    │
│          │                                                                        │
│     ┌────┴────────────────────────────────────────────────────────────────┐        │
│     │ ④ qq-bot-handler.ts 中的 client.onMessage 回调                      │        │
│     │    a) appendLog() → 写入 JSON 日志文件（logs/{accountId}.json）      │        │
│     │    b) 更新 stats.messagesReceived 计数                               │        │
│     │    c) routeQQMessageToAgent() ← 核心路由                             │        │
│     └────┬────────────────────────────────────────────────────────────────┘        │
│          │                                                                        │
│     ┌────┴────────────────────────────────────────────────────────────────┐        │
│     │ ⑤ message-router.ts 中的 routeQQMessageToAgent()                     │        │
│     │    a) findBoundAgent() → 遍历所有 Agent 配置，找到 qqBinding.accountId 匹配的 │
│     │    b) 群组过滤 → 检查 msg.groupId 是否在 groupIds 中                    │        │
│     │    c) registry.get() → 获取 MainAgent 实例（异步构造）                  │        │
│     │    d) 调用 agent.handle() 或 agent.handleQQMessage()                   │        │
│     └────┬────────────────────────────────────────────────────────────────┘        │
│          │                                                                        │
│     ┌────┴────────────────────────────────────────────────────────────────┐        │
│     │ ⑥ QQAgent.handleQQMessage() 或 MainAgent.handle()                    │        │
│     │    a) 解析玩家身份（QQ↔Game 映射）                                    │        │
│     │    b) 加载对端游戏历史 + 共享事实 + 待消费汇报                          │        │
│     │    c) 构建 prompt（含 peer_context）                                   │        │
│     │    d) 调用 LLM（通过 scheduler 限流）                                  │        │
│     │    e) 执行工具调用（如 move_to, mine_block 等）                         │        │
│     │    f) 生成回复文本                                                     │        │
│     └────┬────────────────────────────────────────────────────────────────┘        │
│          │                                                                        │
│     ┌────┴────────────────────────────────────────────────────────────────┐        │
│     │ ⑦ 回复回传                                                           │        │
│     │    a) message-router.ts 收到 response                                  │        │
│     │    b) 调用 client.sendGroupMsg(groupId, "好的，正在前往矿洞...")         │        │
│     │    c) OneBotClient 通过 WebSocket 发送 OneBot API 请求                  │        │
│     │    d) NapCat 接收 API 请求，在 QQ 群中发送消息                           │        │
│     └────┬────────────────────────────────────────────────────────────────┘        │
│          │                                                                        │
│     ┌────┴────────────────────────────────────────────────────────────────┐        │
│     │ ⑧ 日志记录（并行）                                                    │        │
│     │    a) appendLog() → 写入回复日志（direction: 'outgoing'）              │        │
│     │    b) 更新 stats.messagesSent 计数                                     │        │
│     │                                                                       │        │
│     │ ⑨ 前端更新（通过 IPC 事件推送）                                        │        │
│     │    a) qq-bot:status-update → 更新账号状态                              │        │
│     │    b) 前端下次 loadMessageLogs() 时显示新消息                           │        │
│     └────────────────────────────────────────────────────────────────────────┘        │
│                                                                                   │
│  ⑩ 用户在 QQ 群中看到机器人回复：                                                    │
│     "好的，正在前往矿洞..."                                                           │
│                                                                                   │
│  ⑪ 用户在前端 RobotPage 的消息日志中看到完整对话记录：                                 │
│     ← 群聊 小明 #12345678                    14:30:22                               │
│       帮我挖点钻石回来                                                                 │
│       → 好的，正在前往矿洞...                  320ms                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**关键时序图**：

```
用户                               NapCat/OneBot      OneBotClient      qq-bot-handler    message-router      QQAgent/MainAgent
 │                                    │                  │                  │                  │                     │
 │ ① 发送群消息                         │                  │                  │                  │                     │
 │ ──────────────────────────────────►  │                  │                  │                  │                     │
 │                                    │ ② WebSocket 推   │                  │                  │                     │
 │                                    │ ───────────────► │                  │                  │                     │
 │                                    │                  │ ③ onMessage     │                  │                     │
 │                                    │                  │ ──────────────► │                  │                     │
 │                                    │                  │                  │ ④ routeQQMsg    │                     │
 │                                    │                  │                  │ ──────────────►  │                     │
 │                                    │                  │                  │                  │ ⑤ findBoundAgent   │
 │                                    │                  │                  │                  │ ⑥ groupFilter      │
 │                                    │                  │                  │                  │ ⑦ get MainAgent    │
 │                                    │                  │                  │                  │ ────────────────►  │
 │                                    │                  │                  │                  │                     │
 │                                    │                  │                  │                  │                     │ ⑧ handle()
 │                                    │                  │                  │                  │                     │ ⑨ LLM call
 │                                    │                  │                  │                  │                     │ ⑩ tool exec
 │                                    │                  │                  │                  │                     │
 │                                    │                  │                  │                  │ ◄──────────────── │
 │                                    │                  │                  │ ◄────────────── │                     │
 │                                    │                  │ ⑪ sendGroupMsg  │                  │                     │
 │                                    │ ◄─────────────── │                  │                  │                     │
 │                                    │ ◄────────────────┘                  │                  │                     │
 │ ⑫ 收到机器人回复                     │                                      │                  │                     │
 │ ◄────────────────────────────────── │                                      │                  │                     │
 │                                    │                                      │                  │                     │
```

### 4.2 消息路由模块详解

```
                    ┌──────────────────────┐
                    │    手机 QQ 用户       │
                    │  在群聊中发送消息      │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │    NapCat / OneBot    │
                    │  WebSocket 协议转发    │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │    OneBotClient       │
                    │  onMessage 回调触发    │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  qq-bot-handler.ts    │
                    │  client.onMessage()   │
                    │  → appendLog()        │
                    │  → routeQQMessageToAgent() ←── V24 核心路由
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  message-router.ts    │
                    │  routeQQMessageToAgent │
                    │                      │
                    │  1. 查找绑定的 Agent  │
                    │  2. 群组过滤          │
                    │  3. 获取 MainAgent    │
                    │  4. 调用 handle()     │
                    │  5. 发送回复          │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  QQAgent / MainAgent  │
                    │  handle() 处理        │
                    │  → 写 ChatHistory     │
                    │  → 调用工具           │
                    │  → 生成回复           │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  OneBotClient         │
                    │  sendGroupMsg()       │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │    手机 QQ 用户       │
                    │  收到机器人回复        │
                    └──────────────────────┘
```

### 4.2 消息路由模块详解

**位置**：[message-router.ts](file:///d:/McAgent/packages/agent-core/src/main/qq-bot/message-router.ts)

**路由逻辑**：

```typescript
async function routeQQMessageToAgent(
  accountId: string,    // QQ 账号 ID（如 "abc-123"）
  msg: QQMessage,       // QQ 消息对象
  client: OneBotClient, // OneBot 客户端（用于回复）
): Promise<boolean> {
  // 1. 查找绑定了该 QQ 账号的 Agent
  const boundAgent = await findBoundAgent(agentConfigManager, accountId)

  // 2. 群组过滤：只处理绑定的群组
  if (msg.type === 'group' && msg.groupId) {
    const boundGroups = config.qqBinding.groupIds ?? []
    if (boundGroups.length > 0 && !boundGroups.includes(msg.groupId)) {
      return false  // 不在监听群组列表中，忽略
    }
  }

  // 3. 获取 MainAgent 实例
  const agent = await registry.get(workspaceId, boundAgent.id)

  // 4. 处理消息
  if (typeof (agent as any).handleQQMessage === 'function') {
    // QQAgent 子类 → 调用 handleQQMessage（含 peer_context 注入）
    const result = await (agent as any).handleQQMessage(msg)
    response = result.response ?? ''
  } else {
    // 普通 MainAgent → 使用 handle()
    const prompt = formatQQPrompt(msg)
    const result = await agent.handle({ source: 'qq', prompt })
    response = result.finalResponse
  }

  // 5. 发送回复
  if (response) {
    if (msg.type === 'group') {
      await client.sendGroupMsg(msg.groupId!, response)
    } else {
      await client.sendPrivateMsg(msg.userId, response)
    }
  }
}
```

**路由流程图**：

```
OneBot 收到消息
    │
    ├─ 消息类型: group
    │   ├─ 有绑定群组列表？
    │   │   ├─ 是 → 检查 msg.groupId ∈ groupIds
    │   │   │   ├─ 在列表中 → 继续处理
    │   │   │   └─ 不在列表中 → 忽略（return false）
    │   │   └─ 否 → 处理所有群消息
    │   └─ 无绑定群组列表 → 处理所有群消息
    │
    ├─ 消息类型: private
    │   └─ 直接处理
    │
    ├─ 查找绑定 Agent
    │   ├─ 找到 → 获取 Agent 实例
    │   └─ 未找到 → 记录日志，return false
    │
    ├─ 调用 Agent 处理
    │   ├─ QQAgent.handleQQMessage → 返回 {response}
    │   └─ MainAgent.handle → 返回 {finalResponse}
    │
    └─ 发送回复
        ├─ 群消息 → sendGroupMsg(groupId, response)
        └─ 私聊 → sendPrivateMsg(userId, response)
```

### 4.3 群组过滤机制

**配置来源**：AgentConfig.qqBinding.groupIds

**两种模式**：

| 模式 | 配置 | 行为 |
| --- | --- | --- |
| **监听所有群** | `groupIds: []` 或未设置 | 消息来自该 QQ 账号的任何群聊都处理 |
| **监听指定群** | `groupIds: ['12345678', '87654321']` | 只处理指定群的消息 |

**UI 配置入口**：

1. **Agent 创建时**：StepRobot 选择 QQ 账号后，从桥接配置中获取群列表
2. **Agent 详情页**：AgentConfigForm 中修改 QQ 绑定配置

### 4.4 桥接机制（QQ ↔ 游戏）

**位置**：[message-bridge.ts](file:///d:/McAgent/packages/agent-core/src/main/qq-bot/message-bridge.ts)

**桥接架构**：

```
QQ 群聊 ──→ MessageBridge ──→ 游戏内聊天
  ↑                                    │
  │                                    │
  └──────────── 游戏内聊天 ──────────────┘
```

**桥接规则配置**：

```typescript
interface BridgeConfig {
  groupId: string;          // QQ 群号
  direction: 'both'         // 双向同步
            | 'qq_to_game'  // 仅 QQ → 游戏
            | 'game_to_qq'; // 仅游戏 → QQ
  prefix?: string;          // 消息前缀，默认 "[QQ]"
  filter?: {
    keywords?: string[];    // 关键词过滤
    users?: string[];       // 用户过滤
  };
}
```

**桥接消息流**：

```
QQ 消息 → bridge.handleQQMessage(msg)
    ├─ 检查是否有该群的桥接规则
    ├─ 检查方向（qq_to_game 或 both）
    ├─ 检查关键词/用户过滤
    ├─ 添加前缀
    └─ 触发 onBridge 事件
        → forwardToGame() 调用 send_chat 工具

游戏消息 → bridge.handleGameMessage(content, sender)
    ├─ 遍历所有桥接规则
    ├─ 检查方向（game_to_qq 或 both）
    └─ 触发 onBridge 事件
        → integration.ts 中调用 client.sendGroupMsg()
```

### 4.5 主动通知机制

**位置**：[proactive-notifier.ts](file:///d:/McAgent/packages/agent-core/src/main/qq-bot/proactive-notifier.ts)

**职责**：订阅游戏内重要事件，主动推送到指定 QQ 群

**通知规则**：

```typescript
interface NotificationRule {
  eventType: string;        // 事件类型，如 player_died / task_completed
  groupIds: string[];       // 目标群号列表
  template: string;         // 消息模板，支持 {{event.payload.xxx}} 占位符
  enabled?: boolean;        // 是否启用
  mergeWindowMs?: number;   // 合并窗口（毫秒），默认 5000
}
```

**合并机制**：5s 内同类事件合并发送，避免刷屏

---

## 第5章 数据模型

### 5.1 前端状态管理

**位置**：[qqBotStore.ts](file:///d:/McAgent/packages/agent-core/src/renderer/src/stores/qqBotStore.ts)

**Zustand Store 结构**：

```typescript
interface QQBotState {
  // 账号列表
  accounts: QQAccount[]         // 所有 QQ 账号
  accountOrder: string[]        // 排序
  loading: boolean

  // 视图状态
  selectedAccountId: string | null

  // 添加账号面板
  isAddingAccount: boolean
  addMode: 'qr' | 'manual'
  qrCodeData: QRCodeData | null
  qrCodeExpiresAt: number | null
  qrCodeStatus: 'idle' | 'loading' | 'ready' | 'expired' | 'success' | 'error'
  qrCheckTimer: number | null

  // 消息日志
  messageLogs: LogEntry[]
  logFilter: LogFilter

  // 全局操作状态
  isConfiguring: boolean
}
```

### 5.2 核心数据类型

**QQAccount**（前端 Store）：

```typescript
interface QQAccount {
  id: string                    // 唯一 ID
  qqNumber: string              // QQ 号
  nickname: string              // 昵称
  status: 'online' | 'reconnecting' | 'offline' | 'error'
  enabled: boolean              // 是否启用
  error?: string                // 错误信息
  stats: {                      // 统计
    groupsCount: number         // 群数量
    uptime: number              // 在线时长（秒）
    messagesReceived: number    // 收到消息数
    messagesSent: number        // 发送消息数
  }
  config: QQAccountConfig       // 配置
  createdAt: number
}
```

**QQAccountConfig**（后端持久化）：

```typescript
interface QQAccountConfig {
  connectionType: 'qr' | 'manual'
  manual?: {                    // 手动连接配置
    host: string
    port: number
    protocol: 'ws' | 'wss'
    token?: string
  }
  qr?: { sessionToken: string }
  deploymentMode: 'docker' | 'desktop'
  authorization: {              // 权限配置
    defaultPermission: 0 | 1 | 2 | 3
    cooldownSeconds: number
    allowPrivate: boolean
  }
  bridges: BridgeConfig[]       // 桥接规则
  dataDir?: string              // 数据存储目录
  assignedPort?: number         // OneBot 端口
  assignedWebUiPort?: number    // WebUI 端口
}
```

**LogEntry**（消息日志）：

```typescript
interface LogEntry {
  id: string
  accountId: string
  type: 'group' | 'private' | 'system'
  direction: 'incoming' | 'outgoing'
  userName: string
  userId?: string
  groupId?: string
  content: string               // 消息内容
  reply?: string                // 回复内容
  duration?: number             // 处理耗时（ms）
  timestamp: string
}
```

**AgentConfig.qqBinding**（Agent 绑定配置）：

```typescript
interface QQBinding {
  enabled: boolean              // 是否启用 QQ 绑定
  accountId?: string            // 绑定的 QQ 账号 ID
  groupIds?: string[]           // 监听的群组列表（空=所有群）
}
```

### 5.3 后端持久化

**JSON 文件存储**（accounts.json）：

```json
{
  "accounts": [
    {
      "id": "uuid-xxx",
      "qqNumber": "10001",
      "nickname": "主账号",
      "status": "online",
      "enabled": true,
      "stats": { "groupsCount": 3, "uptime": 3600, "messagesReceived": 85, "messagesSent": 43 },
      "config": {
        "connectionType": "qr",
        "deploymentMode": "docker",
        "authorization": { "defaultPermission": 1, "cooldownSeconds": 3, "allowPrivate": true },
        "bridges": [
          { "groupId": "12345678", "direction": "both", "prefix": "[QQ]" }
        ],
        "assignedPort": 3001,
        "assignedWebUiPort": 6099
      },
      "createdAt": 1700000000000
    }
  ],
  "order": ["uuid-xxx"],
  "meta": { "deploymentMode": "docker" }
}
```

**日志文件存储**（logs/{accountId}.json）：

```json
[
  {
    "id": "log-001",
    "accountId": "uuid-xxx",
    "type": "group",
    "direction": "incoming",
    "userName": "小明",
    "userId": "20001",
    "groupId": "12345678",
    "content": "帮我挖点钻石",
    "reply": "好的，正在前往矿洞...",
    "duration": 320,
    "timestamp": "2026-07-18T14:30:22.000Z"
  }
]
```

---

## 第6章 后端核心实现

### 6.0 后端模块架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            qq-bot-handler.ts                                 │
│  (IPC 处理器：账号管理、安装、扫码登录、配置、日志)                           │
│  → JSON 文件持久化 (accounts.json, logs/{id}.json)                          │
│  → 管理 DockerContainerManager / NapCatManager 实例                          │
│  → 管理 OneBotClient 连接                                                    │
└──────────┬──────────────────────────────────────┬───────────────────────────┘
           │ 管理                                  │ 消息回调
           ▼                                      ▼
┌──────────────────────┐          ┌──────────────────────────────┐
│ DockerContainerManager│         │     OneBotClient             │
│ (Docker 容器管理)      │         │  (WebSocket 客户端)           │
│                      │         │  - 连接/断开/重连               │
│ NapCatManager        │         │  - 消息收发                    │
│ (桌面版进程管理)       │         │  - 心跳维护                    │
└──────────────────────┘         │  - API 调用 (sendGroupMsg 等)  │
                                 └──────────────┬───────────────┘
                                                │ onMessage 回调
                                                ▼
                                 ┌──────────────────────────────┐
                                 │      message-router.ts        │
                                 │  routeQQMessageToAgent()      │
                                 │  → findBoundAgent()           │
                                 │  → 群组过滤                    │
                                 │  → 获取 MainAgent 实例         │
                                 │  → 调用 handle()              │
                                 │  → 发送回复                    │
                                 └──────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 其他辅助模块：                                                                │
│                                                                              │
│ message-bridge.ts    → QQ ↔ 游戏双向桥接                                      │
│ proactive-notifier.ts → 主动通知（游戏事件 → QQ 群推送）                       │
│ message-handler.ts    → 消息路由中枢（权限检查 → 频率限制 → 路由分发）          │
│ qq-agent.ts          → QQAgent（继承 MainAgent 的 QQ 消息处理子类）            │
│ qq-store.ts          → QQ 机器人持久化存储（SQLite 表）                        │
│ permission.ts        → 权限管理                                                │
│ integration.ts       → QQ 机器人集成模块（旧版，已逐步被 qq-bot-handler.ts 替代）│
│ types.ts             → 类型定义                                                │
│ onebot-client.ts     → OneBot v11 WebSocket 协议客户端                         │
│ docker-container-manager.ts → Docker 容器管理                                  │
│ napcat-manager.ts    → NapCat 桌面版进程管理                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.1 账号生命周期管理

**位置**：[qq-bot-handler.ts](file:///d:/McAgent/packages/agent-core/src/main/ipc/qq-bot-handler.ts)

**账号状态机**：

```
                    ┌──────────┐
                    │  创建    │
                    └────┬─────┘
                         │
                         ▼
                    ┌──────────┐
         ┌─────────►│  离线    │◄──────────┐
         │          │ (禁用)   │           │
         │          └────┬─────┘           │
         │               │                 │
         │          [启用]                  │
         │               │                 │
         │               ▼                 │
         │          ┌──────────┐           │
         │          │ 重连中   │           │
         │          └────┬─────┘           │
         │               │                 │
         │          ┌────▼─────┐          │
         │    ┌─────┤ 连接成功 ├──────┐    │
         │    │     └────┬─────┘      │    │
         │    │          │            │    │
         │    ▼          ▼            ▼    │
         │  ┌──────┐ ┌──────┐  ┌────────┐ │
         │  │ 在线  │ │ 错误  │  │ 重连中  │ │
         │  └──┬───┘ └──┬───┘  └───┬────┘ │
         │     │        │          │      │
         │     └──[停用]─┴────[停用]┘      │
         │               │                 │
         └───────────────┘                 │
                    │                      │
                    └────────[停用]─────────┘
```

**关键操作**：

| 操作 | 触发 | 后端逻辑 |
| --- | --- | --- |
| 创建账号 | 扫码登录成功 / 手动配置保存 | `createManagedAccount()` → 持久化到 accounts.json |
| 启用账号 | 用户切换开关 | `ensureManagedConnection()` → 启动容器/进程 → 连接 OneBot |
| 停用账号 | 用户切换开关 | `disconnectOneBot()` → 销毁容器/进程 |
| 删除账号 | 用户点击删除 | `disconnectOneBot()` + `destroyManagedContainer()` + 删除日志文件 |
| 自动启动 | 应用启动 | `autoStartQQBotAccounts()` → 启动第一个已启用的账号 |

### 6.2 多账号端口分配

**端口分配策略**：

```
基础端口:
  OneBot: 3001
  WebUI:  6099

偏移量范围: 0 ~ 50（MAX_PORT_OFFSET）

分配逻辑:
  for offset in 0..50:
    oneBot = 3001 + offset
    webUi  = 6099 + offset
    if (oneBot, webUi) 均未被占用:
      return (oneBot, webUi)
  throw Error("无法分配可用端口")

端口持久化:
  account.config.assignedPort
  account.config.assignedWebUiPort
```

### 6.3 双模式部署管理

**Docker 模式**：

```typescript
// DockerContainerManager 管理
dockerContainers Map<accountId, ManagedDockerInstance>

// 启动流程
1. DockerContainerManager.getDockerInfo() → 检查 Docker 可用性
2. new DockerContainerManager({ containerName, account, ports })
3. manager.start() → 拉取镜像 → 创建容器 → 启动
4. connectOneBot(account) → 连接 WebSocket
5. 开始接收消息

// 停止流程
1. disconnectOneBot(accountId)
2. manager.remove() → 停止并删除容器
```

**桌面版模式**：

```typescript
// NapCatManager 管理
napcatInstances Map<accountId, ManagedNapcatInstance>

// 启动流程
1. new NapCatManager({ installDir, userDataPath, account, ports })
2. manager.start() → 启动 NapCat 进程
3. connectOneBot(account) → 连接 WebSocket
4. 开始接收消息

// 停止流程
1. disconnectOneBot(accountId)
2. manager.stop() → 停止 NapCat 进程
```

### 6.4 OneBot 连接管理

**位置**：[onebot-client.ts](file:///d:/McAgent/packages/agent-core/src/main/qq-bot/onebot-client.ts)

**连接状态机**：

```
disconnected → connecting → connected
                    ↓            ↓
               reconnecting ← disconnected (自动重连)
                    ↓
               disconnected (达到最大重连次数)
```

**关键特性**：

| 特性 | 实现 |
| --- | --- |
| WebSocket 连接 | `ws` 库，连接 NapCat 的 OneBot 服务 |
| 自动重连 | 指数退避（2^n × 5s，最大 30s） |
| 心跳检测 | 每 10s 发送 `get_status` |
| API 调用 | Promise 封装，10s 超时 |
| 消息分发 | `onMessage` / `onNotice` / `onStatusChange` 事件 |

---

## 第7章 群聊接入完整流程

### 7.1 用户拉机器人入群

```
Step 1: 用户获取 QQ 账号
    → 通过 NapCat 安装向导 + 扫码登录
    → 获得 QQ 账号（如 10001）

Step 2: 用户将 QQ 账号拉入群聊
    → 在 QQ 中搜索 10001
    → 邀请进群

Step 3: 配置 Agent 绑定
    → 创建 Agent 时，在 StepRobot 中选择 QQ 账号 10001
    → 选择监听群组（如群号 12345678）
    → 完成创建

Step 4: 用户发送消息
    → 用户在群聊中发送："@Alice 帮我挖矿"
    → 或直接发送："Alice 帮我挖矿"（如果设置了关键词）

Step 5: 消息路由
    → OneBot 收到消息 → routeQQMessageToAgent
    → 查找绑定 10001 的 Agent
    → 检查群组过滤（12345678 ∈ groupIds）
    → 调用 Agent.handle()
    → Agent 处理并回复

Step 6: 用户收到回复
    → 机器人在群聊中回复："好的，正在前往矿洞..."
```

### 7.2 群聊消息处理策略

| 场景 | 处理方式 |
| --- | --- |
| **@机器人** | 直接处理，回复到群聊 |
| **直接对话** | 如果群组在监听列表中，直接处理 |
| **关键词触发** | 通过桥接配置的关键词过滤 |
| **私聊** | 根据权限配置决定是否允许 |
| **命令** | 以 `/` 开头，路由到命令处理器 |

### 7.3 多 Agent 与多 QQ 账号绑定

**绑定关系**：

```
QQ 账号 A (10001) ──→ Agent X (Minecraft 助手)
QQ 账号 B (10002) ──→ Agent Y (QQ 群管理)

同一 Agent 只能绑定一个 QQ 账号
同一 QQ 账号只能绑定一个 Agent（当前限制）
```

**路由查找**：

```
OneBot 收到 QQ 账号 A 的消息
    → 查找 qqBinding.accountId === 'A的ID' 的 Agent
    → 找到 Agent X
    → 群组过滤（检查 groupIds）
    → 调用 Agent X 处理
    → 回复到群聊
```

---

## 第8章 前端 IPC 接口清单

### 8.1 账号管理

| IPC 通道 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `qq-bot:get-accounts` | 无 | `{accounts, order, meta?}` | 获取所有账号 |
| `qq-bot:add-account` | `(config: QQAccountConfig)` | `{success, accountId}` | 添加账号（手动） |
| `qq-bot:remove-account` | `(id: string)` | `{success}` | 删除账号 |
| `qq-bot:toggle-account` | `(id: string, enabled: boolean)` | `{success, error?}` | 启用/停用账号 |
| `qq-bot:reorder-accounts` | `(order: string[])` | `{success}` | 保存排序 |
| `qq-bot:save-config` | `(id: string, config: QQAccountConfig)` | `{success}` | 保存配置 |
| `qq-bot:get-config` | `(id: string)` | `QQAccountConfig \| null` | 获取配置 |

### 8.2 安装与部署

| IPC 通道 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `qq-bot:get-install-status` | 无 | `InstallStatus` | 检测安装状态 |
| `qq-bot:install-napcat` | `(mode, installDir?)` | `{success, message?, error?}` | 安装 NapCat |
| `qq-bot:choose-install-dir` | 无 | `string \| null` | 选择安装目录 |
| `qq-bot:verify-napcat-install` | `(dir: string)` | `{success, installDir?, error?}` | 验证安装目录 |

### 8.3 扫码登录

| IPC 通道 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `qq-bot:start-qr-login` | `(mode?: string)` | `{url, expiresAt}` | 开始扫码登录 |
| `qq-bot:check-qr-login` | 无 | `QRLoginResult` | 检查登录状态 |
| `qq-bot:cancel-qr-login` | 无 | `{success}` | 取消扫码登录 |

### 8.4 运行时管理

| IPC 通道 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `qq-bot:test-connection` | `(params: ManualConnectionParams)` | `TestResult` | 测试连接 |
| `qq-bot:stop-manager` | `(accountId?: string)` | `{success}` | 停止管理器 |
| `qq-bot:get-manager-status` | `(accountId?: string)` | `{exists, status, instances?}` | 获取管理器状态 |
| `qq-bot:choose-data-dir` | 无 | `string \| null` | 选择数据目录 |
| `qq-bot:get-message-log` | `(id, params)` | `LogEntry[]` | 获取消息日志 |
| `qq-bot:clear-logs` | `(id: string)` | `{success}` | 清空日志 |
| `qq-bot:status-update` | (推送事件) | `AccountStatusUpdate` | 状态推送 |

### 8.5 Agent 相关

| IPC 通道 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `agent:get-status` | `({id})` | `{status, qqStatus}` | 获取 Agent 状态（含 QQ 状态） |

---

## 第9章 实施分阶段

| 阶段 | 内容 | 涉及文件 | 验收 |
| --- | --- | --- | --- |
| **9.1** | 安装向导完善 | NapCatSetupWizard.tsx | Docker 和桌面版安装流程完整 |
| **9.2** | 账号管理前端 | AccountListView, AccountCard, DetailHeader, StatsBar | 账号列表展示、状态指示、统计 |
| **9.3** | 添加账号面板 | AddAccountPanel, ManualConfig, qqBotStore | QR 扫码登录和手动配置流程完整 |
| **9.4** | 权限管理前端 | PermissionPanel | 权限等级、冷却时间、私聊开关 |
| **9.5** | 桥接配置前端 | BridgeConfigPanel | 桥接规则增删改 |
| **9.6** | 消息日志前端 | MessageLogPanel | 日志展示、筛选、搜索 |
| **9.7** | Agent 创建绑定 | StepRobot, QQBindSection | Agent 创建时绑定 QQ 账号和群组 |
| **9.8** | Agent 运行时状态 | AgentInstanceView | 显示 QQ 连接状态 |
| **9.9** | 消息路由 | message-router.ts, qq-bot-handler.ts | 消息从 QQ 到 Agent 的完整路由 |
| **9.10** | 群组过滤 | message-router.ts | 按 groupIds 过滤群消息 |
| **9.11** | 自动启动 | qq-bot-handler.ts | 应用启动时自动启用已启用的账号 |
| **9.12** | 集成测试 | __tests__ | 覆盖完整链路 |

---

## 第10章 文件清单

### 10.1 前端文件状态

| 文件 | 职责 | 状态 |
| --- | --- | --- |
| `src/renderer/src/components/qq-bot/RobotPage.tsx` | 机器人页面入口 | ✅ 已完成 |
| `src/renderer/src/components/qq-bot/setup/NapCatSetupWizard.tsx` | 安装向导（Docker/桌面版） | ✅ 已完成 |
| `src/renderer/src/components/qq-bot/list/AccountListView.tsx` | 账号列表 | ✅ 已完成 |
| `src/renderer/src/components/qq-bot/list/AccountCard.tsx` | 账号卡片（状态指示、开关） | ✅ 已完成 |
| `src/renderer/src/components/qq-bot/list/StatsBar.tsx` | 统计栏 | ✅ 已完成 |
| `src/renderer/src/components/qq-bot/list/EmptyState.tsx` | 空状态 | ✅ 已完成 |
| `src/renderer/src/components/qq-bot/detail/AccountDetailView.tsx` | 账号详情 | ✅ 已完成 |
| `src/renderer/src/components/qq-bot/detail/DetailHeader.tsx` | 详情头部 | ✅ 已完成 |
| `src/renderer/src/components/qq-bot/detail/PermissionPanel.tsx` | 权限管理 | ✅ 已完成 |
| `src/renderer/src/components/qq-bot/detail/BridgeConfigPanel.tsx` | 桥接配置 | ✅ 已完成 |
| `src/renderer/src/components/qq-bot/detail/MessageLogPanel.tsx` | 消息日志 | ✅ 已完成 |
| `src/renderer/src/components/qq-bot/detail/AddAccountPanel.tsx` | 添加账号（QR + 手动） | ✅ 已完成 |
| `src/renderer/src/components/qq-bot/dialog/ManualConfig.tsx` | 手动配置 | ✅ 已完成 |
| `src/renderer/src/components/agent/wizard/StepRobot.tsx` | Agent 创建绑定 QQ | ✅ 已完成 |
| `src/renderer/src/components/agent/sections/QQBindSection.tsx` | QQ 绑定区块（AgentConfigForm） | ⚠️ 需重构（Mock 数据→真实数据） |
| `src/renderer/src/components/agent/AgentInstanceView.tsx` | Agent 实例视图（显示 QQ 状态） | ✅ 已完成 |
| `src/renderer/src/stores/qqBotStore.ts` | QQ 机器人状态管理（Zustand） | ✅ 已完成 |
| `src/renderer/src/lib/types.ts` | 类型定义（含 QQBinding） | ✅ 已完成 |
| `src/renderer/src/components/qq-bot/detail/GroupManagementPanel.tsx` | 群聊管理（新增） | 📌 P2 待实现 |
| `src/renderer/src/components/qq-bot/detail/GroupList.tsx` | 群列表（新增） | 📌 P2 待实现 |
| `src/renderer/src/components/qq-bot/detail/GroupMemberList.tsx` | 群成员列表（新增） | 📌 P2 待实现 |

### 10.2 后端文件状态

| 文件 | 职责 | 状态 |
| --- | --- | --- |
| `src/main/ipc/qq-bot-handler.ts` | QQ 机器人 IPC 处理器（账号管理、安装、扫码登录、配置、日志） | ✅ 已完成 |
| `src/main/qq-bot/onebot-client.ts` | OneBot WebSocket 客户端（连接/重连/心跳/消息收发） | ✅ 已完成 |
| `src/main/qq-bot/message-router.ts` | 消息路由（routeQQMessageToAgent） | ✅ 已完成 |
| `src/main/qq-bot/message-handler.ts` | 消息处理器（权限检查 → 频率限制 → 路由分发） | ✅ 已完成 |
| `src/main/qq-bot/message-bridge.ts` | 消息桥接（QQ ↔ 游戏） | ✅ 已完成 |
| `src/main/qq-bot/qq-agent.ts` | QQ Agent（继承 MainAgent 的 QQ 消息处理子类） | ✅ 已完成 |
| `src/main/qq-bot/qq-sub-agent.ts` | QQ Sub-Agent（已废弃） | ❌ 已废弃 |
| `src/main/qq-bot/integration.ts` | 集成模块（旧版，逐步被 qq-bot-handler.ts 替代） | ✅ 已完成 |
| `src/main/qq-bot/permission.ts` | 权限管理 | ✅ 已完成 |
| `src/main/qq-bot/proactive-notifier.ts` | 主动通知（游戏事件 → QQ 群推送） | ✅ 已完成 |
| `src/main/qq-bot/qq-store.ts` | QQ 数据存储（SQLite 表） | ✅ 已完成 |
| `src/main/qq-bot/docker-container-manager.ts` | Docker 容器管理 | ✅ 已完成 |
| `src/main/qq-bot/napcat-manager.ts` | NapCat 桌面版进程管理 | ✅ 已完成 |
| `src/main/qq-bot/types.ts` | 类型定义 | ✅ 已完成 |
| `src/main/agent/main-agent-registry.ts` | MainAgent 注册表 | ✅ 已完成 |

### 10.3 新增/修改文件

| 文件 | 变更类型 | 说明 | 优先级 |
| --- | --- | --- | --- |
| `src/renderer/src/components/agent/sections/QQBindSection.tsx` | 修改 | 去除 Mock 数据，改为从 qqBotStore 读取真实账号列表 | P1 |
| `src/renderer/src/components/qq-bot/detail/GroupManagementPanel.tsx` | 新增 | 群聊管理面板（群列表 + 群成员） | P2 |
| `src/renderer/src/components/qq-bot/detail/GroupList.tsx` | 新增 | 群列表组件 | P2 |
| `src/renderer/src/components/qq-bot/detail/GroupMemberList.tsx` | 新增 | 群成员列表组件 | P2 |
| `src/main/ipc/qq-bot-handler.ts` | 修改 | 新增 qq-bot:get-group-list / get-group-member-list 接口 | P2 |

---

## 第11章 验收清单

| # | 项 | 验证方法 | 优先级 |
| - | --- | --- | --- |
| 1 | NapCat 安装向导（Docker/桌面版） | 首次打开机器人页面显示安装向导，选择 Docker 或桌面版完成安装 | P0 |
| 2 | 扫码登录添加账号 | 二维码显示正常，手机扫码后自动创建账号并连接 | P0 |
| 3 | 手动配置添加账号 | 输入 WebSocket 地址和端口，测试连接成功，保存后账号出现在列表 | P0 |
| 4 | 账号列表显示 | 账号卡片显示 QQ 号、昵称、状态、群数量、在线时长 | P0 |
| 5 | 账号启用/停用 | 切换开关后账号状态正确变化，OneBot 连接/断开 | P0 |
| 6 | 删除账号 | 删除后账号从列表消失，容器/进程清理 | P0 |
| 7 | 权限配置 | 保存权限配置后，下次消息路由使用新权限 | P1 |
| 8 | 桥接配置 | 添加/删除桥接规则，消息能正确路由到桥接通道 | P1 |
| 9 | 消息日志 | 群聊/私聊消息正确显示，筛选和搜索正常 | P0 |
| 10 | Agent 创建绑定 QQ | 创建 Agent 时选择 QQ 账号和群组，保存后配置正确 | P0 |
| 11 | Agent 实例显示 QQ 状态 | Agent 详情页显示 QQ 在线/离线状态 | P1 |
| 12 | 群聊消息路由 | 在群聊中发送消息，Agent 正确回复 | P0 |
| 13 | 群组过滤 | 配置监听群组后，不在列表中的群消息被忽略 | P0 |
| 14 | 自动启动 | 应用重启后，已启用的账号自动连接 | P1 |
| 15 | 扫码登录 - 二维码过期 | 过期后显示刷新按钮，刷新后生成新二维码 | P1 |
| 16 | 扫码登录 - 多账号端口分配 | 多个账号的端口不冲突 | P1 |
| 17 | ⚠️ QQBindSection 去除 Mock 数据 | AgentConfigForm 中 QQ 绑定显示真实账号列表，而非硬编码数据 | P1 |
| 18 | 📌 群聊管理界面（新增） | 账号详情页显示已加入的群列表、群成员信息 | P2 |
| 19 | 📌 群聊消息按群筛选 | 消息日志中可按群号筛选查看特定群的聊天记录 | P2 |
| 20 | 📌 机器人入群引导 | 安装/登录完成后显示如何将机器人拉入群聊的指引 | P2 |

---

## 第12章 风险与未决

| 风险 | 影响 | 缓解措施 | 优先级 |
| --- | --- | --- | --- |
| 单账号限制 | 同时只能启用一个 QR 登录账号 | 临时限制，后续版本支持多账号 | P0 |
| WebSocket 重连风暴 | 多个账号同时掉线时大量重连 | 指数退避 + 最大重连次数限制 | P1 |
| 端口冲突 | 多账号端口分配可能冲突 | 动态分配 + 持久化 + 50 个偏移量 | P1 |
| 消息日志膨胀 | 日志文件无限增长 | 只保留最近 200 条 | P1 |
| Docker 不可用 | 用户未安装 Docker 时无法使用 Docker 方案 | 提供桌面版替代方案 | P0 |
| 桌面版 NapCat 进程管理 | 进程意外退出后不会自动恢复 | 用户手动重新启用，后续版本增加自动恢复 | P1 |
| 绑定关系一致性 | 删除 QQ 账号后 Agent 的绑定关系未清理 | 删除账号时通知 Agent 配置变更 | P1 |
| 群聊消息并发 | 多个群同时发消息可能导致 Agent 过载 | 通过 LlmRequestScheduler 限流 | P1 |
| 前端类型同步 | 前端类型与后端实际 JSON 结构不一致 | 统一使用 types.ts 中的类型定义，前后端保持同步 | P1 |
| 消息路由性能 | 大量消息时路由查找可能成为瓶颈 | AgentConfigManager 使用缓存，消息路由为 O(n) 查找 | P2 |
| **QQBindSection 使用 Mock 数据** | AgentConfigForm 中 QQ 绑定无法选择真实账号 | 重构为与 StepRobot 相同的数据源，从 qqBotStore 读取 | P1 |
| **缺少群聊管理界面** | 用户无法查看已加入的群和群成员 | 新增 GroupManagementPanel 组件，通过 OneBot API 获取群数据 | P2 |
| **缺少入群引导** | 用户不知道如何让机器人加入群聊 | 在安装向导/账号添加完成后显示引导提示 | P2 |
| **消息日志无法按群筛选** | 日志面板混排所有群的消息 | 在 MessageLogPanel 中增加群筛选 dropdown | P2 |

---

## 第13章 已确认决策

| # | 原问题 | 结论 |
| - | --- | --- |
| 1 | QQ 账号存储方式？ | **JSON 文件**（accounts.json）。简单可靠，无需数据库迁移 |
| 2 | 消息日志存储方式？ | **JSON 文件**（logs/{accountId}.json）。每个账号独立文件 |
| 3 | 账号状态同步方式？ | **IPC 推送**（qq-bot:status-update 事件）。后端主动推送到前端 |
| 4 | 多账号端口分配？ | **动态分配 + 持久化**。首次启用时分配，持久化后复用 |
| 5 | 群组过滤方式？ | **AgentConfig.qqBinding.groupIds**。空列表 = 监听所有群 |
| 6 | 消息路由时机？ | **OneBot onMessage 回调**。收到消息即路由，不缓冲 |
| 7 | 安装向导位置？ | **首次安装时全屏显示**，安装完成后跳转到账号管理页面 |
| 8 | 部署方式切换？ | **运行中不可切换**。需在账号详情页配置，下次启用时生效 |