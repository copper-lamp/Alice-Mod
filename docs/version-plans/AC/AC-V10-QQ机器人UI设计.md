# Alice Mod Core V10 — QQ 机器人 UI 设计

> 版本：v2.0
> 日期：2026-07-10
> 版本号：V10（第 12 周）
> 对应需求：AC-QQ-UI-01 ~ AC-QQ-UI-05
> 关联文档：[AC-V10-QQ机器人模块.md](AC-V10-QQ机器人模块.md)、[AC-V8-主控制面板与游戏状态面板.md](AC-V8-主控制面板与游戏状态面板.md)、[AC-V7-UI界面.md](AC-V7-UI界面.md)

---

## 第一部分：需求文档

### 1.1 模块定位

QQ 机器人 UI 面板是 Agent Core 桌面应用中**机器人（Robot）标签页**的具体内容实现。它以**多账号管理**为核心设计理念，让用户像管理手机通讯录一样管理 QQ 机器人账号——扫码即用、一键开关、傻瓜式操作。

**核心职责**：

| 职责 | 说明 |
|------|------|
| **账号管理** | 多账号的添加/删除/启用/禁用，支持扫码登录和手动配置两种方式 |
| **状态监控** | 实时显示每个账号的连接状态、消息统计、运行时长 |
| **权限管理** | 每个账号独立配置四级权限体系 |
| **消息桥接配置** | 每个账号独立配置 QQ 群 ↔ 游戏内聊天的桥接规则 |
| **消息日志** | 查看每个账号的消息收发历史 |

### 1.2 设计哲学：三个"只要"

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  只要点一下 —— 添加账号只需点击"扫码登录"，手机一扫就完事                │
│                                                                     │
│  只要看一眼 —— 每个账号的状态用绿/黄/灰圆点表示，一眼就知道谁在线         │
│                                                                     │
│  只要拖一下 —— 账号顺序可以拖拽排列，常用账号放前面                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 与现有 UI 的关系

QQ 机器人 UI 面板位于 **V8 导航体系**中的"机器人"标签页下。

```
V8 导航体系                         V10 扩展
┌────────────────────────┐         ┌───────────────────────────────┐
│  LeftSidebar            │         │  RobotPage                    │
│  ├── 仪表盘             │         │                               │
│  ├── 模型               │         │  ┌── 账号列表（默认视图）────┐  │
│  ├── 知识与技能          │         │  │  ┌─ 账号卡片 ──────────┐  │  │
│  ├── 机器人 ← 点击       │────────►│  │  │ ● 1234567 在线      │  │  │
│  └── 智能体列表          │         │  │  │ [开关] [设置]        │  │  │
│                          │         │  │  └────────────────────┘  │  │
│  点击"机器人"时：         │         │  │  ┌─ 账号卡片 ──────────┐  │  │
│  · 右栏收起              │         │  │  │ ○ 7654321 离线      │  │  │
│  · 中央面板全宽          │         │  │  │ [开关] [设置]        │  │  │
│                          │         │  │  └────────────────────┘  │  │
│                          │         │  │  [+ 添加QQ账号]           │  │
│                          │         │  └─────────────────────────┘  │
│                          │         │                               │
│                          │         │  ┌── 账号详情（点击卡片）───┐  │
│                          │         │  │  ← 返回账号列表           │  │
│                          │         │  │  [权限管理] [桥接] [日志]  │  │
│                          │         │  └─────────────────────────┘  │
└────────────────────────┘         └───────────────────────────────┘
```

**布局规则**：
- 点击左栏"机器人"导航按钮 → 右侧面板收起 → 中央面板全宽渲染 RobotPage
- 默认显示**账号列表**视图
- 点击账号卡片进入**账号详情**视图（有返回按钮）
- 无右栏，全宽显示

### 1.4 功能需求列表

| 需求 ID | 需求名称 | 优先级 | 实现状态 |
|---------|---------|:------:|:--------:|
| AC-QQ-UI-01 | 多账号列表（卡片展示/状态指示/开关控制） | P0 | 待实现 |
| AC-QQ-UI-02 | 扫码登录添加账号（显示二维码/自动刷新/引导提示） | P0 | 待实现 |
| AC-QQ-UI-03 | 手动配置添加账号（WS 参数/测试连接） | P1 | 待实现 |
| AC-QQ-UI-04 | 账号详情页（权限管理/桥接配置/消息日志） | P1 | 待实现 |
| AC-QQ-UI-05 | 消息日志面板（消息列表/筛选/搜索） | P2 | 待实现 |

### 1.5 验收标准

| # | 验收条件 | 验证方法 |
|---|---------|----------|
| 1 | 首次打开页面显示"添加第一个QQ账号"引导大按钮 | 打开机器人页面，无账号时看到引导 |
| 2 | 点击"扫码登录"后显示二维码和引导文字 | 点击扫码登录，看到二维码图片 |
| 3 | 手机扫码后账号自动出现在列表中，状态为在线 | 用手机QQ扫码，观察账号列表 |
| 4 | 账号卡片显示绿/黄/灰状态圆点 | 观察在线/重连/离线三种状态的颜色 |
| 5 | 账号开关可一键启用/禁用 | 点击开关，账号连接/断开 |
| 6 | 点击账号卡片进入详情页，显示权限/桥接/日志 Tab | 点击卡片，看到详情页 |
| 7 | 详情页有返回按钮可回到账号列表 | 点击返回按钮，回到列表 |
| 8 | 可添加多个账号，列表显示所有账号 | 添加 2-3 个账号，列表均显示 |
| 9 | 账号可删除 | 删除账号后，列表不再显示 |
| 10 | 拖拽可调整账号顺序 | 拖拽账号卡片，顺序改变 |

---

## 第二部分：交互设计

### 2.1 核心交互流程

```
┌─────────────────────────────────────────────────────────────────────┐
│  用户旅程                                                           │
│                                                                     │
│  [首次使用]                                                         │
│  打开机器人页面                                                     │
│      │                                                              │
│      ▼                                                              │
│  看到"添加第一个QQ账号"大按钮 ← 空状态引导，按钮占据页面中央           │
│      │                                                              │
│      ▼                                                              │
│  点击按钮 → 弹出添加账号对话框                                       │
│      │                                                              │
│      ▼                                                              │
│  选择"扫码登录"（默认推荐，视觉突出）                                 │
│      │                                                              │
│      ▼                                                              │
│  显示二维码 + 引导文字 "请使用手机QQ扫描二维码"                        │
│      │                                                              │
│      ▼                                                              │
│  手机扫描 → 登录成功 → 自动关闭对话框                                │
│      │                                                              │
│      ▼                                                              │
│  账号出现在列表中，状态为 ● 在线                                      │
│      │                                                              │
│      ▼                                                              │
│  点击卡片 → 进入详情页，配置权限/桥接/查看日志                         │
│                                                                     │
│  ─────────────────────────────────────────────────────────          │
│                                                                     │
│  [日常使用]                                                         │
│  打开机器人页面                                                     │
│      │                                                              │
│      ▼                                                              │
│  一眼扫过账号列表，绿点 = 正常，灰点 = 掉线了                         │
│      │                                                              │
│      ├── 灰点了 → 点击卡片 → 查看详情 → 检查原因                       │
│      │                                                                 │
│      ├── 想加新号 → 点击底部"添加QQ账号" → 扫码                          │
│      │                                                                 │
│      └── 不用了 → 开关关掉 → 账号离线（不删除，随时可以再开）              │
│                                                                     │
│  ─────────────────────────────────────────────────────────          │
│                                                                     │
│  [进阶操作]                                                         │
│  点击卡片进入详情 → 权限管理/Bridge/日志（Tab 切换）                   │
│  拖拽卡片排序 → 常用账号放前面                                       │
│  右键/长按卡片 → 删除、重命名、导出配置                                │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 页面布局架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  RobotPage (主容器，无右栏全宽)                                             │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  顶部统计栏 (仅在有账号时显示)                                         │  │
│  │  ┌────────────────┬────────────────┬─────────────────┐                │  │
│  │  │  共 3 个账号     │  2 个在线       │  今日消息 47 条    │                │  │
│  │  └────────────────┴────────────────┴─────────────────┘                │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  账号列表 (账号卡片流式布局)                                           │  │
│  │                                                                       │  │
│  │  ┌────────────────────────────────────────────────────────────────┐  │  │
│  │  │  账号卡片 (可拖拽)                                              │  │  │
│  │  │  ┌─────┬──────────────────────────────────────────┬────────┐  │  │  │
│  │  │  │ ●   │  1234567                                 │ 开关   │  │  │  │
│  │  │  │ 在线 │  我的小号 · 已连接 5 个群               │ ○━━●  │  │  │  │
│  │  │  │     │  运行 02:35:12 · 消息 15/8               │ [设置] │  │  │  │
│  │  │  └─────┴──────────────────────────────────────────┴────────┘  │  │  │
│  │  │                                                               │  │  │
│  │  │  ┌─────┬──────────────────────────────────────────┬────────┐  │  │  │
│  │  │  │ ○   │  7654321                                 │ 开关   │  │  │  │
│  │  │  │ 离线 │  工作号                                  │ ○──●  │  │  │  │
│  │  │  │     │  点击查看详情                             │ [设置] │  │  │  │
│  │  │  └─────┴──────────────────────────────────────────┴────────┘  │  │  │
│  │  └────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                       │  │
│  │  ┌────────────────────────────────────────────────────────────────┐  │  │
│  │  │  [+ 添加QQ账号]  (大按钮，固定在列表底部)                       │  │  │
│  │  └────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  [以上为默认视图。点击账号卡片后，切换到账号详情页]                          │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  账号详情页 (点击卡片后进入)                                          │  │
│  │                                                                       │  │
│  │  ┌────────────────────────────────────────────────────────────────┐  │  │
│  │  │  ← 返回账号列表  |  1234567 (我的小号)  |  ● 在线  |  [开关]   │  │  │
│  │  └────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                       │  │
│  │  ┌─ HeroUI Tabs ────────────────────────────────────────────────┐  │  │
│  │  │  [权限管理]  [桥接配置]  [消息日志]                            │  │  │
│  │  │                                                               │  │  │
│  │  │  权限管理 Tab: 管理员/白名单/冷却时间                          │  │  │
│  │  │  桥接配置 Tab: 桥接规则列表/添加表单                           │  │  │
│  │  │  消息日志 Tab: 消息列表/筛选/搜索                              │  │  │
│  │  └───────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 组件树

```
RobotPage
│
├── [无账号时] EmptyState
│   └── "添加第一个QQ账号" 大按钮（居中，带图标，视觉引导）
│
├── [有账号时] AccountListView (默认视图)
│   ├── StatsBar                     # 顶部统计栏
│   │   ├── TotalCount               # 总账号数
│   │   ├── OnlineCount              # 在线数
│   │   └── TodayMessageCount        # 今日消息数
│   │
│   ├── AccountList (可拖拽排序)
│   │   └── AccountCard[]            # 账号卡片列表
│   │       ├── StatusDot            # 状态圆点 (绿/黄/灰)
│   │       ├── AccountInfo          # 账号信息 (QQ号/昵称/群数/统计)
│   │       ├── ToggleSwitch         # 启用/禁用开关
│   │       └── SettingsButton       # 设置按钮 (进入详情)
│   │
│   └── AddAccountButton             # 底部添加按钮
│
├── [点击卡片] AccountDetailView (详情视图)
│   ├── DetailHeader                 # 详情头部 (返回/账号信息/开关)
│   │   ├── BackButton               # 返回账号列表
│   │   ├── AccountSummary           # 账号摘要 (QQ号/昵称/状态)
│   │   └── ToggleSwitch             # 启用/禁用开关
│   │
│   └── HeroUI Tabs
│       ├── Tab: 权限管理
│       │   └── PermissionPanel
│       │       ├── AdminList        # 管理员列表
│       │       ├── WhitelistList    # 白名单列表
│       │       ├── GroupWhitelistList # 群白名单列表
│       │       ├── DefaultPermissionSelect
│       │       ├── CooldownSlider
│       │       └── AllowPrivateSwitch
│       │
│       ├── Tab: 桥接配置
│       │   └── BridgeConfigPanel
│       │       ├── BridgeList       # 桥接规则列表
│       │       └── AddBridgeForm    # 添加桥接表单
│       │
│       └── Tab: 消息日志
│           └── MessageLogPanel
│               ├── LogFilterBar     # 筛选栏
│               └── MessageLogList   # 消息日志列表
│
└── [全局] AddAccountDialog (添加账号对话框)
    ├── QRCodeLoginOption            # 扫码登录选项（主推）
    │   ├── QRCodeImage              # 二维码图片
    │   ├── GuideText                # 引导文字
    │   ├── CountdownTimer           # 二维码倒计时
    │   └── RefreshButton            # 刷新二维码
    │
    └── ManualConfigOption           # 手动配置选项（折叠）
        ├── HostInput
        ├── PortInput
        ├── ProtocolSelect
        ├── TokenInput
        └── TestConnectionButton
```

### 2.4 核心交互流程详解

#### 2.4.1 空状态 → 添加第一个账号

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  场景：用户第一次打开机器人页面，一个账号都没有                       │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                                                             │    │
│  │                   🤖 你还没有QQ机器人账号                      │    │
│  │                                                             │    │
│  │     ┌─────────────────────────────────────────────┐         │    │
│  │     │                                             │         │    │
│  │     │     📱 添加第一个QQ账号                       │         │    │
│  │     │     扫码登录，手机一扫即用                     │         │    │
│  │     │                                             │         │    │
│  │     └─────────────────────────────────────────────┘         │    │
│  │                                                             │    │
│  │  也可以 [手动配置]                                           │    │
│  │                                                             │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  交互规则：                                                         │
│  · "添加第一个QQ账号" 按钮占据页面中央，视觉突出                       │
│  · 按钮图标为手机+二维码组合，暗示扫码操作                            │
│  · "手动配置" 为文字链接，视觉弱化，仅高级用户使用                     │
│  · 点击按钮 → 弹出添加账号对话框                                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 2.4.2 添加账号对话框 — 扫码登录

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  ┌─ 添加QQ账号 ─────────────────────────────────────────────────┐  │
│  │                                                               │  │
│  │  ┌──────────────────────────────────────────────────────┐     │  │
│  │  │  推荐  ● 扫码登录                          ▼ 手动配置  │     │  │
│  │  └──────────────────────────────────────────────────────┘     │  │
│  │                                                               │  │
│  │  ┌──────────────────────────────────────────────────────┐     │  │
│  │  │                                                      │     │  │
│  │  │                     ┌──────────┐                     │     │  │
│  │  │                     │          │                     │     │  │
│  │  │                     │  二维码   │                     │     │  │
│  │  │                     │  图片     │                     │     │  │
│  │  │                     │          │                     │     │  │
│  │  │                     └──────────┘                     │     │  │
│  │  │                                                      │     │  │
│  │  │          请使用手机QQ扫描二维码登录                     │     │  │
│  │  │          二维码将在 2分30秒 后过期                     │     │  │
│  │  │                                                      │     │  │
│  │  │              [刷新二维码]                             │     │  │
│  │  │                                                      │     │  │
│  │  └──────────────────────────────────────────────────────┘     │  │
│  │                                                               │  │
│  │  [取消]                                                        │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  交互规则：                                                         │
│  · 默认选中"扫码登录"，"手动配置"为折叠选项，点击展开                  │
│  · 二维码图片居中显示，大小约 200×200px                             │
│  · 二维码下方有清晰的引导文字："请使用手机QQ扫描二维码登录"            │
│  · 显示二维码过期倒计时，到期自动刷新                               │
│  · "刷新二维码"按钮在到期前可用，点击后重新生成                        │
│  · 扫描成功后：显示 ✅ 登录成功 (动画) → 自动关闭对话框 → 回到列表     │
│  · 扫描失败：显示错误提示，可重试                                    │
│  · 整个过程用户只需：打开对话框 → 掏出手机扫 → 完事                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**后端交互**：
```
用户点击"扫码登录"
  → 主进程启动 NapCat 进程（托管模式，无账号参数）
  → NapCat 生成二维码图片文件（或输出 QR 数据）
  → 主进程读取二维码图片，通过 IPC 发送到渲染进程
  → 渲染进程显示二维码
  → 轮询 NapCat 登录状态（每 2s）
  → 用户扫码成功 → NapCat 返回账号信息
  → 主进程保存账号配置（QQ号、昵称、session token）
  → 渲染进程关闭对话框，添加到账号列表
```

#### 2.4.3 添加账号对话框 — 手动配置

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  ┌─ 添加QQ账号 ─────────────────────────────────────────────────┐  │
│  │                                                               │  │
│  │  ┌──────────────────────────────────────────────────────┐     │  │
│  │  │  推荐  ○ 扫码登录                          ▲ 手动配置  │     │  │
│  │  └──────────────────────────────────────────────────────┘     │  │
│  │                                                               │  │
│  │  ┌─ 手动配置 ─────────────────────────────────────────────┐  │  │
│  │  │  昵称:    [  我的小号              ]  (可选，方便识别)   │  │  │
│  │  │  主机:    [  127.0.0.1             ]                    │  │  │
│  │  │  端口:    [  3001                   ]                    │  │  │
│  │  │  协议:    [▼ ws (ws://)            ]                    │  │  │
│  │  │  Token:   [  ••••••••••             ]  ◉ 显示/隐藏      │  │  │
│  │  │                                                         │  │  │
│  │  │  [测试连接]  [保存]                                     │  │  │
│  │  │                                                         │  │  │
│  │  │  测试结果: ✅ 连接成功 (延迟 23ms)                        │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  │                                                               │  │
│  │  [取消]                                                        │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  交互规则：                                                         │
│  · 点击"手动配置"展开表单，再次点击收起                              │
│  · 昵称字段可选，不填则自动用 QQ 号                                  │
│  · 主机/端口/协议有默认值，绝大多数用户不需要改                       │
│  · Token 不是必填 (NapCat 可配置为无 Token)                          │
│  · 测试连接按钮：验证 WS 可达性，显示延迟或错误原因                   │
│  · 保存后自动关闭对话框，添加到账号列表                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 2.4.4 账号卡片交互

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  账号卡片（默认状态）                                                │
│  ┌─────┬──────────────────────────────────────────┬────────┐       │
│  │ ●   │  1234567                                 │ ○━━●  │       │
│  │ 在线 │  我的小号 · 已连接 5 个群               │ [设置] │       │
│  │     │  运行 02:35:12 · 消息 15/8               │        │       │
│  └─────┴──────────────────────────────────────────┴────────┘       │
│                                                                     │
│  交互规则：                                                         │
│  · 点击卡片任意位置（除开关和设置按钮外）→ 进入账号详情页              │
│  · 点击开关 → 切换启用/禁用状态（即时生效，无需确认）                  │
│  · 点击设置按钮 → 进入账号详情页 (同点击卡片)                         │
│  · 拖拽卡片 → 调整排序 (长按后拖拽)                                  │
│  · 右键卡片 → 上下文菜单：[删除账号] [重命名] [复制QQ号]              │
│                                                                     │
│  ─────────────────────────────────────────────────────────          │
│                                                                     │
│  状态变化：                                                         │
│  ┌─────┬──────────────────────────────────────────────────────┐    │
│  │ 指示  │ 含义                          │ 用户操作              │    │
│  ├─────┼──────────────────────────────────────────────────────┤    │
│  │ ● 绿 │ 已连接，正常运行                │ 无需操作              │    │
│  │ ● 黄 │ 正在重连                       │ 等待或查看详情        │    │
│  │ ○ 灰 │ 离线（开关关闭 或 连接断开）     │ 打开开关 或 检查配置  │    │
│  │ ● 红 │ 连接错误                       │ 点击卡片查看详情      │    │
│  └─────┴──────────────────────────────────────────────────────┘    │
│                                                                     │
│  ─────────────────────────────────────────────────────────          │
│                                                                     │
│  开关状态：                                                         │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ 开关开 → 账号在线（自动连接）  |  开关关 → 账号离线（断开连接） │  │
│  │ 默认新添加的账号开关为开                                       │  │
│  │ 开关关掉时，账号卡片变为灰色，状态文字显示"已停用"               │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 2.4.5 账号详情页交互

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  ← 返回账号列表  |  1234567 (我的小号)  |  ● 在线  |  [○━━●]       │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  ┌── 权限管理 ──┬── 桥接配置 ──┬── 消息日志 ──────────────────────┐  │
│  │                                                                │  │
│  │  权限管理内容...                                                │  │
│  │                                                                │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  交互规则：                                                         │
│  · 顶部导航栏：← 返回按钮 + 账号标识 + 状态指示 + 开关               │
│  · 返回按钮 → 回到账号列表（保持列表滚动位置）                        │
│  · 三个 Tab 与旧版设计一致，但数据作用域限定在当前账号                │
│  · 在详情页修改配置后，返回列表时列表自动更新                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.5 状态管理

```typescript
interface QQAccount {
  id: string;                    // 唯一标识 (UUID)
  qqNumber: string;              // QQ 号
  nickname: string;              // 昵称（可自定义）
  status: 'online' | 'reconnecting' | 'offline' | 'error';
  enabled: boolean;              // 是否启用
  error?: string;                // 错误信息（状态为 error 时）
  stats: {
    groupsCount: number;         // 已连接群数量
    uptime: number;              // 运行时长（秒）
    messagesReceived: number;    // 收到的消息数
    messagesSent: number;        // 发送的消息数
  };
  config: QQAccountConfig;       // 账号配置（连接参数/权限/桥接）
  createdAt: number;             // 创建时间
}

interface QQAccountConfig {
  // 连接方式
  connectionType: 'qr' | 'manual';
  // 手动配置参数（connectionType 为 manual 时有效）
  manual?: {
    host: string;
    port: number;
    protocol: 'ws' | 'wss';
    token?: string;
  };
  // 扫码配置（connectionType 为 qr 时有效）
  qr?: {
    sessionToken: string;        // 登录会话 token
  };
  // 权限配置
  authorization: {
    defaultPermission: QQPermissionLevel;
    cooldownSeconds: number;
    allowPrivate: boolean;
  };
  // 桥接配置
  bridges: BridgeConfig[];
}

interface QQBotState {
  // 账号列表
  accounts: QQAccount[];
  accountOrder: string[];        // 账号排序（可拖拽）

  // 视图状态
  currentView: 'list' | 'detail';
  selectedAccountId: string | null;

  // 对话框状态
  addDialogOpen: boolean;
  addDialogMode: 'qr' | 'manual';
  qrCodeData: string | null;     // 二维码图片数据 (base64)
  qrCodeExpiresAt: number | null;
  qrCodeStatus: 'loading' | 'ready' | 'expired' | 'success' | 'error';

  // 消息日志（当前选中的账号）
  messageLogs: LogEntry[];
  logFilter: {
    type: 'all' | 'group' | 'private' | 'system';
    search: string;
  };

  // Actions
  loadAccounts: () => Promise<void>;
  addAccount: (config: QQAccountConfig) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
  toggleAccount: (id: string, enabled: boolean) => Promise<void>;
  reorderAccounts: (fromIndex: number, toIndex: number) => void;
  selectAccount: (id: string) => void;
  backToList: () => void;

  // 扫码登录
  startQRLogin: () => Promise<void>;
  refreshQRCode: () => Promise<void>;
  cancelQRLogin: () => void;

  // 手动配置
  testConnection: (params: ManualConnectionParams) => Promise<TestResult>;
  saveManualConfig: (params: ManualConnectionParams) => Promise<void>;

  // 日志
  loadMessageLogs: (accountId: string) => Promise<void>;
  setLogFilter: (filter: Partial<LogFilter>) => void;
  clearLogs: () => void;
  loadMoreLogs: () => Promise<void>;
}
```

### 2.6 数据流

```
┌─────────────────────────────────────────────────────────────────────────┐
│  数据流概览（多账号版）                                                   │
│                                                                         │
│  渲染进程 (Renderer)                   主进程 (Main)                     │
│  ┌──────────────────────┐            ┌──────────────────────────────┐   │
│  │  RobotPage            │   IPC     │  QQBotService                │   │
│  │                       │           │                              │   │
│  │  ┌─ 账号列表 ◄────────┼───────────┼──► getAccounts()             │   │
│  │  ├─ 添加账号 ────────►┼───────────┼──► addAccount()              │   │
│  │  ├─ 删除账号 ────────►┼───────────┼──► removeAccount()           │   │
│  │  ├─ 切换开关 ────────►┼───────────┼──► toggleAccount()           │   │
│  │  ├─ 扫码登录 ────────►┼───────────┼──► startQRLogin()            │   │
│  │  │                    │           │    ├──→ 启动 NapCat 进程     │   │
│  │  │                    │           │    └──→ 返回二维码图片       │   │
│  │  ├─ 二维码数据 ◄──────┼───────────┼──► onQRCodeUpdate()          │   │
│  │  ├─ 登录结果 ◄───────┼───────────┼──► onQRLoginResult()          │   │
│  │  ├─ 测试连接 ────────►┼───────────┼──► testConnection()          │   │
│  │  ├─ 读取消息 ◄───────┼───────────┼──► getMessageLog(accountId)   │   │
│  │  └─ 状态推送 ◄───────┼───────────┼──► onAccountStatusChanged()   │   │
│  └──────────────────────┘            └──────────┬───────────────────┘   │
│                                                  │                       │
│                                               │ 内部管理                 │
│                                               ▼                         │
│                                      ┌────────────────────────────┐    │
│                                      │  AccountManager             │    │
│                                      │  ├── accounts[]            │    │
│                                      │  ├── addAccount()          │    │
│                                      │  ├── removeAccount()       │    │
│                                      │  └── toggleAccount()       │    │
│                                      │                              │    │
│                                      │  每个账号对应一个实例:         │    │
│                                      │  ├── OneBotClient           │    │
│                                      │  ├── PermissionManager      │    │
│                                      │  ├── MessageBridge          │    │
│                                      │  └── QQSubAgent             │    │
│                                      └────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

**IPC 通信频道**：

| 频道名 | 方向 | 用途 | 频率 |
|--------|------|------|------|
| `qq-bot:get-accounts` | 渲染→主 | 获取所有账号列表 | 页面加载时 |
| `qq-bot:add-account` | 渲染→主 | 添加账号（手动配置） | 用户点击保存时 |
| `qq-bot:remove-account` | 渲染→主 | 删除账号 | 用户确认删除时 |
| `qq-bot:toggle-account` | 渲染→主 | 启用/禁用账号 | 用户点击开关时 |
| `qq-bot:reorder-accounts` | 渲染→主 | 保存账号排序 | 拖拽结束时 |
| `qq-bot:start-qr-login` | 渲染→主 | 开始扫码登录流程 | 用户点击扫码登录时 |
| `qq-bot:cancel-qr-login` | 渲染→主 | 取消扫码登录 | 关闭对话框时 |
| `qq-bot:qr-code-update` | 主→渲染 | 推送二维码图片数据 | 二维码生成/刷新时 |
| `qq-bot:qr-login-result` | 主→渲染 | 推送扫码登录结果 | 登录成功/失败时 |
| `qq-bot:test-connection` | 渲染→主 | 测试手动连接 | 用户点击测试时 |
| `qq-bot:get-config` | 渲染→主 | 获取指定账号的配置 | 进入详情页时 |
| `qq-bot:save-config` | 渲染→主 | 保存指定账号的配置 | 用户点击保存时 |
| `qq-bot:get-message-log` | 渲染→主 | 获取指定账号的消息日志 | 滚动/加载时 |
| `qq-bot:account-status-changed` | 主→渲染 | 推送账号状态更新 | 状态变化时 |
| `qq-bot:new-message` | 主→渲染 | 推送新消息 | 收到/发送消息时 |
| `qq-bot:clear-logs` | 渲染→主 | 清空指定账号的日志 | 用户点击清空时 |

---

## 第三部分：执行文档

### 3.1 文件结构

```
src/renderer/src/components/qq-bot/
├── index.ts                          # 模块导出
├── RobotPage.tsx                     # 机器人页面主容器（路由切换 list/detail）
│
├── list/                             # 账号列表视图
│   ├── AccountListView.tsx           # 账号列表视图容器
│   ├── StatsBar.tsx                  # 顶部统计栏
│   ├── AccountCard.tsx               # 账号卡片
│   ├── AccountList.tsx               # 可拖拽排序的账号列表
│   └── EmptyState.tsx                # 空状态引导
│
├── detail/                           # 账号详情视图
│   ├── AccountDetailView.tsx         # 账号详情视图容器
│   ├── DetailHeader.tsx              # 详情头部导航
│   ├── PermissionPanel.tsx           # 权限管理面板
│   ├── BridgeConfigPanel.tsx         # 桥接配置面板
│   └── MessageLogPanel.tsx           # 消息日志面板
│       ├── LogFilterBar.tsx          # 筛选栏
│       └── MessageLogItem.tsx        # 消息日志条目
│
├── dialog/                           # 添加账号对话框
│   ├── AddAccountDialog.tsx          # 添加账号对话框容器
│   ├── QRCodeLogin.tsx               # 扫码登录视图
│   └── ManualConfig.tsx              # 手动配置视图
│
└── stores/
    └── qqBotStore.ts                 # Zustand 状态管理
```

### 3.2 关键组件规格

#### 3.2.1 RobotPage.tsx

```typescript
import React from 'react';
import { useQQBotStore } from './stores/qqBotStore';
import { AccountListView } from './list/AccountListView';
import { AccountDetailView } from './detail/AccountDetailView';
import { AddAccountDialog } from './dialog/AddAccountDialog';

export const RobotPage: React.FC = () => {
  const { currentView, accounts, addDialogOpen } = useQQBotStore();

  return (
    <div className="h-full flex flex-col">
      {currentView === 'list' ? (
        <AccountListView />
      ) : (
        <AccountDetailView />
      )}
      {addDialogOpen && <AddAccountDialog />}
    </div>
  );
};
```

#### 3.2.2 EmptyState.tsx

```typescript
import React from 'react';
import { Button } from '@heroui/react';
import { useQQBotStore } from '../stores/qqBotStore';

export const EmptyState: React.FC = () => {
  const { openAddDialog } = useQQBotStore();

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6">
      {/* 大号机器人图标 */}
      <div className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center">
        <span className="text-4xl">🤖</span>
      </div>

      <div className="text-center">
        <h2 className="text-lg font-medium text-gray-700">你还没有QQ机器人账号</h2>
        <p className="text-sm text-gray-400 mt-1">添加一个账号，开始使用机器人自动回复</p>
      </div>

      <Button
        size="lg"
        color="primary"
        className="px-8 py-6 text-lg"
        startContent={<span className="text-xl">📱</span>}
        onPress={openAddDialog}
      >
        添加第一个QQ账号
      </Button>

      <button
        className="text-sm text-gray-400 hover:text-gray-600 underline"
        onClick={() => {/* 手动配置 */}}
      >
        也可以手动配置
      </button>
    </div>
  );
};
```

#### 3.2.3 AccountCard.tsx

```typescript
import React from 'react';
import { Card, Switch, Button } from '@heroui/react';
import type { QQAccount } from '../stores/qqBotStore';

const STATUS_CONFIG = {
  online: { dot: 'bg-green-400', text: '在线' },
  reconnecting: { dot: 'bg-yellow-400', text: '重连中' },
  offline: { dot: 'bg-gray-300', text: '离线' },
  error: { dot: 'bg-red-400', text: '错误' },
} as const;

interface Props {
  account: QQAccount;
  onToggle: (id: string, enabled: boolean) => void;
  onClick: (id: string) => void;
  onDragStart: () => void;
}

export const AccountCard: React.FC<Props> = ({ account, onToggle, onClick, onDragStart }) => {
  const config = STATUS_CONFIG[account.status];
  const isDisabled = !account.enabled;

  return (
    <Card
      className={`p-4 cursor-pointer ${isDisabled ? 'opacity-50' : ''}`}
      isPressable
      onPress={() => onClick(account.id)}
      onDragStart={onDragStart}
      draggable
    >
      <div className="flex items-center gap-4">
        {/* 状态指示 */}
        <div className="flex flex-col items-center gap-1 min-w-[48px]">
          <span className={`w-4 h-4 rounded-full ${config.dot}`} />
          <span className="text-xs text-gray-500">{isDisabled ? '已停用' : config.text}</span>
        </div>

        {/* 账号信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium">{account.qqNumber}</span>
            {account.nickname && (
              <span className="text-sm text-gray-500">({account.nickname})</span>
            )}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {account.status === 'online' ? (
              <>已连接 {account.stats.groupsCount} 个群 · 运行 {formatUptime(account.stats.uptime)} · 消息 {account.stats.messagesReceived}/{account.stats.messagesSent}</>
            ) : account.error ? (
              <span className="text-red-400">{account.error}</span>
            ) : (
              <>点击查看详情</>
            )}
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-2">
          <Switch
            isSelected={account.enabled}
            onValueChange={(v) => onToggle(account.id, v)}
            onClick={(e) => e.stopPropagation()}
            size="sm"
          />
          <Button
            size="sm"
            variant="flat"
            onPress={() => onClick(account.id)}
          >
            设置
          </Button>
        </div>
      </div>
    </Card>
  );
};
```

#### 3.2.4 QRCodeLogin.tsx

```typescript
import React, { useEffect, useState } from 'react';
import { Button, Card, Spinner } from '@heroui/react';
import { useQQBotStore } from '../stores/qqBotStore';

export const QRCodeLogin: React.FC = () => {
  const {
    qrCodeData, qrCodeExpiresAt, qrCodeStatus,
    startQRLogin, refreshQRCode, cancelQRLogin,
  } = useQQBotStore();

  const [countdown, setCountdown] = useState<number>(0);

  useEffect(() => {
    startQRLogin();
    return () => cancelQRLogin();
  }, []);

  useEffect(() => {
    if (!qrCodeExpiresAt) return;
    const update = () => {
      const remaining = Math.max(0, Math.floor((qrCodeExpiresAt - Date.now()) / 1000));
      setCountdown(remaining);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [qrCodeExpiresAt]);

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      {/* 二维码区域 */}
      <div className="w-52 h-52 bg-white border-2 border-gray-200 rounded-xl flex items-center justify-center">
        {qrCodeStatus === 'loading' ? (
          <Spinner />
        ) : qrCodeData ? (
          <img src={qrCodeData} alt="登录二维码" className="w-48 h-48" />
        ) : (
          <span className="text-gray-400">加载中...</span>
        )}
      </div>

      {/* 引导文字 */}
      <div className="text-center">
        <p className="text-sm font-medium">请使用手机QQ扫描二维码登录</p>
        <p className="text-xs text-gray-400 mt-1">
          {countdown > 0
            ? `二维码将在 ${formatCountdown(countdown)} 后过期`
            : '二维码已过期，请点击刷新'}
        </p>
      </div>

      {/* 刷新按钮 */}
      {countdown === 0 && (
        <Button
          color="primary"
          variant="flat"
          onPress={refreshQRCode}
          startContent={<span>🔄</span>}
        >
          刷新二维码
        </Button>
      )}

      {/* 状态提示 */}
      {qrCodeStatus === 'success' && (
        <div className="flex items-center gap-2 text-green-500">
          <span>✅</span>
          <span>登录成功！</span>
        </div>
      )}
      {qrCodeStatus === 'error' && (
        <div className="flex items-center gap-2 text-red-500">
          <span>❌</span>
          <span>登录失败，请重试</span>
        </div>
      )}
    </div>
  );
};
```

#### 3.2.5 AddAccountDialog.tsx

```typescript
import React, { useState } from 'react';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Chip } from '@heroui/react';
import { QRCodeLogin } from './QRCodeLogin';
import { ManualConfig } from './ManualConfig';
import { useQQBotStore } from '../stores/qqBotStore';

export const AddAccountDialog: React.FC = () => {
  const { addDialogOpen, addDialogMode, setAddDialogMode, closeAddDialog } = useQQBotStore();
  const [showManual, setShowManual] = useState(false);

  return (
    <Modal isOpen={addDialogOpen} onClose={closeAddDialog} size="lg" placement="center">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <span>添加QQ账号</span>
          <Chip
            color="primary"
            variant="flat"
            size="sm"
            className="ml-2"
          >
            推荐
          </Chip>
        </ModalHeader>

        <ModalBody>
          {/* 扫码登录（默认展开） */}
          {!showManual && <QRCodeLogin />}

          {/* 切换手动配置 */}
          <div className="text-center">
            <button
              className="text-sm text-gray-400 hover:text-gray-600 underline"
              onClick={() => setShowManual(!showManual)}
            >
              {showManual ? '← 返回扫码登录' : '▼ 手动配置'}
            </button>
          </div>

          {/* 手动配置（折叠） */}
          {showManual && <ManualConfig />}
        </ModalBody>

        <ModalFooter>
          <Button variant="flat" onPress={closeAddDialog}>
            取消
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
```

### 3.3 IPC 接口定义

```typescript
// preload.ts 中暴露的 QQ 机器人相关 API
contextBridge.exposeInMainWorld('qqBotAPI', {
  // 账号管理
  getAccounts: () => ipcRenderer.invoke('qq-bot:get-accounts'),
  addAccount: (config: QQAccountConfig) => ipcRenderer.invoke('qq-bot:add-account', config),
  removeAccount: (id: string) => ipcRenderer.invoke('qq-bot:remove-account', id),
  toggleAccount: (id: string, enabled: boolean) => ipcRenderer.invoke('qq-bot:toggle-account', id, enabled),
  reorderAccounts: (order: string[]) => ipcRenderer.invoke('qq-bot:reorder-accounts', order),

  // 扫码登录
  startQRLogin: () => ipcRenderer.invoke('qq-bot:start-qr-login'),
  cancelQRLogin: () => ipcRenderer.invoke('qq-bot:cancel-qr-login'),
  onQRCodeUpdate: (callback: (data: QRCodeData) => void) => {
    ipcRenderer.on('qq-bot:qr-code-update', (_, data) => callback(data));
  },
  onQRLoginResult: (callback: (result: QRLoginResult) => void) => {
    ipcRenderer.on('qq-bot:qr-login-result', (_, result) => callback(result));
  },

  // 手动配置
  testConnection: (params: ManualConnectionParams) => ipcRenderer.invoke('qq-bot:test-connection', params),

  // 配置管理
  getConfig: (accountId: string) => ipcRenderer.invoke('qq-bot:get-config', accountId),
  saveConfig: (accountId: string, config: QQAccountConfig) => ipcRenderer.invoke('qq-bot:save-config', accountId, config),

  // 日志
  getMessageLog: (accountId: string, params: LogQueryParams) => ipcRenderer.invoke('qq-bot:get-message-log', accountId, params),
  onNewMessage: (callback: (entry: LogEntry) => void) => {
    ipcRenderer.on('qq-bot:new-message', (_, entry) => callback(entry));
  },
  clearLogs: (accountId: string) => ipcRenderer.invoke('qq-bot:clear-logs', accountId),

  // 状态推送
  onAccountStatusChanged: (callback: (status: AccountStatusUpdate) => void) => {
    ipcRenderer.on('qq-bot:account-status-changed', (_, status) => callback(status));
  },

  // 清理
  removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel),
});
```

### 3.4 实施顺序

```
Phase 1 (V10 核心):
  ① 空状态引导 (EmptyState)              ← 无依赖，可独立开发
  ② 账号卡片 (AccountCard)                ← 无依赖，纯 UI
  ③ 账号列表 (AccountListView)            ← 依赖 AccountCard + StatsBar
  ④ 添加账号对话框 (AddAccountDialog)      ← 含 QRCodeLogin + ManualConfig
  ⑤ 账号详情页 (AccountDetailView)        ← 含权限/桥接/日志 Tab

Phase 2 (V10.1+):
  ⑥ 拖拽排序                              ← 依赖 drag-and-drop 库
  ⑦ 右键菜单 (删除/重命名/复制)            ← 依赖上下文菜单组件
  ⑧ 扫码登录状态实时推送优化               ← 依赖 WebSocket 事件系统
  ⑨ 消息日志持久化                        ← 依赖 SQLite 日志存储
```

### 3.5 状态推送机制

```
实时推送 (主→渲染):
  某个账号连接状态变化 → 自动推送该账号的新状态
  收到新消息 → 自动推送消息条目（带上 accountId）
  队列状态变化 → 自动推送 (节流 1s)

定期轮询:
  页面可见时 → 每 5s 轮询一次所有账号状态 (兜底)
  页面不可见时 → 暂停轮询 (性能优化)

账号状态更新格式:
{
  accountId: string;
  status: 'online' | 'reconnecting' | 'offline' | 'error';
  stats: {
    groupsCount: number;
    uptime: number;
    messagesReceived: number;
    messagesSent: number;
  };
  error?: string;
}
```

---

## 第四部分：视觉规范

### 4.1 颜色方案

| 用途 | 颜色 | 说明 |
|------|------|------|
| 状态 - 在线 | `bg-green-400` | 绿色圆点 |
| 状态 - 重连中 | `bg-yellow-400` | 黄色圆点 |
| 状态 - 离线 | `bg-gray-300` | 灰色圆点 |
| 状态 - 错误 | `bg-red-400` | 红色圆点 |
| 二维码区域 | `bg-white` + `border-2 border-gray-200` | 白色背景，浅灰边框 |
| 引导文字 | `text-gray-400` | 浅灰色辅助文字 |
| 推荐标签 | `color="primary" variant="flat"` | HeroUI 主题色 |

### 4.2 间距

| 层级 | 间距 | 说明 |
|------|------|------|
| 页面边距 | `p-4` | RobotPage 内边距 |
| 卡片间距 | `gap-3` | 账号卡片之间 |
| 卡片内边距 | `p-4` | 账号卡片内容边距 |
| 对话框内边距 | `gap-4` | 对话框元素间距 |
| 列表项间距 | `py-2` | 列表项上下间距 |

### 4.3 响应式

| 断点 | 行为 |
|------|------|
| 默认 (≥1024px) | 账号卡片全宽，状态并排显示 |
| <640px | 卡片内信息调整为纵向排列 |

---

## 第五部分：验收测试

### 5.1 单元测试

| 测试用例 | 覆盖组件 | 通过条件 |
|---------|---------|----------|
| 无账号时显示空状态引导 | EmptyState | 空状态按钮和文字正确渲染 |
| 有账号时显示账号列表 | AccountListView | 列表渲染所有账号卡片 |
| 账号卡片状态圆点颜色正确 | AccountCard | 四种状态对应正确颜色 |
| 开关切换账号启用/禁用 | AccountCard | 开关状态变化后卡片样式联动 |
| 点击卡片进入详情页 | AccountListView | 切换到 detail 视图，selectedAccountId 正确 |
| 扫码登录显示二维码 | QRCodeLogin | 二维码图片渲染，引导文字显示 |
| 二维码过期倒计时 | QRCodeLogin | 倒计时正确递减，过期后显示刷新按钮 |
| 手动配置表单验证 | ManualConfig | 必填字段验证，测试连接反馈 |
| 详情页 Tab 切换 | AccountDetailView | 三个 Tab 正确切换内容 |
| 返回按钮回到列表 | AccountDetailView | 切换到 list 视图，保持列表状态 |

### 5.2 集成测试

| 测试用例 | 场景 | 通过条件 |
|---------|------|----------|
| 完整流程：空状态 → 添加账号 → 扫码成功 → 列表显示 | 首次使用流程 | 每一步正确过渡 |
| 多账号添加和切换 | 添加 2 个账号，分别查看详情 | 列表显示两个，详情页数据隔离 |
| 账号开关实时生效 | 关闭一个在线账号 | 账号离线，状态变为灰色 |
| 拖拽排序持久化 | 拖拽账号卡片改变顺序 | 刷新后顺序保持 |
| 每个账号独立配置权限 | 两个账号设置不同权限 | 权限检查时各自生效 |

---

## 附录：与现有组件映射

| 现有组件 | QQ 机器人 UI 组件 | 复用方式 |
|---------|-----------------|---------|
| HeroUI Card | AccountCard | 直接复用 |
| HeroUI Tabs | 详情页 Tab 导航 | 直接复用 |
| HeroUI Input | 手动配置表单 | 直接复用 |
| HeroUI Select | 权限/协议选择 | 直接复用 |
| HeroUI Slider | 冷却时间滑动条 | 直接复用 |
| HeroUI Switch | 账号开关 | 直接复用 |
| HeroUI Button | 各种操作按钮 | 直接复用 |
| HeroUI Modal | 添加账号对话框 | 直接复用 |
| HeroUI Chip | "推荐"标签 | 直接复用 |
| LeftSidebar 导航 | "机器人"导航项 | 已有，无需修改 |
| Layout 布局系统 | RobotPage 的布局位置 | 已有，无需修改 |