# Alice Mod Core V8 — 多面板导航与智能体管理体系

> 版本：v1.0
> 日期：2026-07-05
> 版本号：V8（第 12 周）
> 对应需求：AC-UI-01、AC-UI-04、AC-WS-05
> 关联文档：[AC-01-需求文档.md](AC-01-需求文档.md)、[AC-02-实施计划.md](AC-02-实施计划.md)、[AC-03-规范与验收标准.md](AC-03-规范与验收标准.md)、[AC-V7-UI界面.md](AC-V7-UI界面.md)

***

## 第一部分：需求文档

### 1.1 模块定位

V8 是 Agent Core UI 从**单一对话视图**走向**多面板导航体系**的关键版本。它在 V7（三栏布局 + 对话面板 + 配置面板）的基础上，引入完整的面板导航系统和智能体管理流程。

**核心职责**：

| 职责 | 说明 |
|------|------|
| **导航体系** | 左栏 4 个功能按钮（仪表盘/模型/知识与技能/机器人）切换中央面板内容，点击时收起右侧面板，中央填充至右侧 |
| **仪表盘** | Token 用量统计与智能体活跃时段图表化展示 |
| **模型配置面板** | 中央面板展示模型配置，添加/列表/设置/删除大模型 |
| **知识与技能面板** | 中央面板展示，顶部 Tabs 切换 [资料库/地图索引/专家/经验/智能体记忆] |
| **智能体创建流程** | 点击智能体列表加号 → 全页创建表单（名称/皮肤/身份/工具/记忆/规则/机器人/启用时间） |
| **智能体实例视图** | 三栏布局（即现有 V7 布局），左上角实例名称，右上角 Tabs 切换 [信息/配置]，配置页复用创建表单 |

### 1.2 布局架构总览

```
V7 (当前)                                    V8 (目标)
┌──────────────────────────┐               ┌──────────────────────────┐
│  AppLayout               │               │  AppLayout               │
│  ├── CustomTitleBar      │               │  ├── CustomTitleBar      │
│  ├── LeftSidebar         │               │  ├── LeftSidebar         │
│  │   └── 导航(硬编码active) │               │  │   └── 导航(动态active)  │
│  ├── <main> ChatPanel    │               │  ├── <main>              │ ← 动态面板
│  ├── RightSidebar        │               │  │   ├── 仪表盘           │ ← 无右栏
│  └── StatusBar           │               │  │   ├── 模型配置          │ ← 无右栏
│                          │               │  │   ├── 知识与技能        │ ← 无右栏
│  始终三栏布局              │               │  │   ├── 机器人           │ ← 无右栏
│                          │               │  │   ├── 智能体实例(三栏)   │ ← 有右栏
│                          │               │  │   └── 智能体创建(全页)   │ ← 无右栏
│                          │               │  ├── RightSidebar(条件)   │ ← 仅智能体实例时显示
│                          │               │  └── StatusBar           │
└──────────────────────────┘               └──────────────────────────┘
```

#### 布局切换规则

```
左栏导航点击
  │
  ├──→ 仪表盘 / 模型 / 知识与技能 / 机器人
  │      ├── 右侧面板收起（RightSidebar 隐藏）
  │      ├── 中央面板向右扩展填充至右侧空白区域
  │      └── 中央面板渲染对应内容
  │
  ├──→ 智能体列表中的实例点击
  │      ├── 右侧面板显示（RightSidebar 显示）
  │      ├── 中央面板恢复三栏布局
  │      └── 中央面板渲染对话/信息/配置
  │
  └──→ 智能体列表加号"+"点击
         ├── 右侧面板收起
         ├── 中央面板全宽渲染创建表单
         └── 创建完成后跳转到智能体实例视图
```

### 1.3 功能需求列表

| 需求 ID | 需求名称 | 优先级 | 实现状态 |
|---------|----------|:------:|:--------:|
| AC-UI-01 | 仪表盘（Token 用量统计 + 活跃时段图表） | P0 | 待实现 |
| AC-UI-04 | 智能体实例视图（信息/配置 Tabs） | P0 | 待实现 |
| AC-WS-05 | 智能体切换与创建流程 | P0 | 待实现 |

> 与原需求文档对照：AC-UI-01 需求变更为"仪表盘"而非原"主控制面板"；AC-UI-04 变更为智能体实例视图中的信息展示；AC-WS-05 扩展为完整的智能体创建流程。

#### AC-UI-01 仪表盘详细需求

| 子需求 | 说明 |
|--------|------|
| Token 用量总览 | 今日 Token 消耗、本月 Token 消耗、总 Token 消耗，以数字卡片展示 |
| Token 日趋势图 | 柱状图展示最近 7 天/30 天每日 Token 用量，支持切换时间范围 |
| Provider 用量分布 | 饼图/环形图展示各 Provider（OpenAI/Claude/Gemini/Ollama）的 Token 占比 |
| 模型调用排行 | 列表/条状图展示各模型的调用次数和 Token 消耗排行 |
| 智能体活跃时段 | 热力图/折线图展示各智能体（工作区）的 24h 活跃时段分布 |
| 连接概览 | 当前 TCP 连接数、各智能体在线状态摘要卡片 |

#### AC-UI-04 智能体实例视图详细需求

| 子需求 | 说明 |
|--------|------|
| 三栏布局 | 左栏(240px) + 中央对话 + 右栏(288px)，与 V7 一致 |
| 左上角实例名称 | 显示当前智能体实例名称 + 在线状态圆点 |
| 右上角 Tabs | [信息 / 配置] 两个标签页切换 |
| 信息 Tab | 显示对话面板（与 V7 ChatPanel 一致），含消息列表 + 输入框 |
| 配置 Tab | 复用智能体创建表单，加载当前实例配置，修改后自动保存 |
| 右栏内容 | 上下文窗口使用率、用量监控、待办事项（同 V7） |

#### AC-WS-05 智能体切换与创建流程详细需求

| 子需求 | 说明 |
|--------|------|
| 智能体列表 | 左栏展示已创建的智能体列表，显示名称 + 在线状态圆点 |
| 点击切换 | 点击智能体进入实例视图（三栏布局），切换时更新所有面板上下文 |
| 加号创建 | 点击加号进入智能体创建页面，全页表单 |
| 名称设置 | 输入 LLM Player（假人）名称 |
| 皮肤上传 | 点击可快捷上传皮肤文件（支持 .png），预览显示 |
| 身份/提示词 | 提供预设提示词片段自由组合（复用 V5 提示词片段注册机制） |
| 工具配置 | 选择该智能体可用的工具集（按分类勾选） |
| 记忆配置 | 选择记忆模式（SQLite / Chroma / 二者兼用） |
| 执行规则 | 规则配置项，序列化后发送给 Adapter Core 模组处理 |
| 机器人绑定 | 可绑定 QQ 机器人，选择 QQ 账号/群 |
| 启用时间 | 设置智能体的定时启用/禁用时间段 |

### 1.4 界面布局设计

#### 1.4.1 导航视图（仪表盘/模型/知识与技能/机器人）

```
┌──────────────────────────────────────────────────────────────────────┐
│  CustomTitleBar: Alice                     [⚙ 设置]                 │
├────────────┬───────────────────────────────────────────────────────┤
│            │                                                        │
│ ● 仪表盘   │          中央面板（填充至右侧）                           │
│   模型     │                                                        │
│   知识与技能│  ┌─── 仪表盘内容示例 ──────────────────────────────┐    │
│   机器人   │  │                                                   │    │
│            │  │  Token 用量总览                                    │    │
│ · 智能体列表 │  │  今日: 12,847   本月: 284,193   总计: 1,234,567  │    │
│   ● Chili  │  │                                                   │    │
│   ○ hads   │  │  日趋势图 [7天▾] [30天]                           │    │
│            │  │  ██▄█▇██▆▅▇▆▇████▆█▄▅▆▇█▆▅▄▃                    │    │
│ [➕ 新建]   │  │                                                   │    │
│            │  │  Provider 分布          活跃时段                    │    │
│ [⚙ 设置]   │  │  ┌─────┐               ┌─────┐                   │    │
│            │  │  │环状图│               │热力图│                   │    │
│            │  │  └─────┘               └─────┘                   │    │
│            │  └───────────────────────────────────────────────────┘    │
├────────────┴───────────────────────────────────────────────────────┤
│  TCP 已连接 · 工作区: 3 · v1.0.0 · Alice Mod Core                  │
└──────────────────────────────────────────────────────────────────────┘
```

#### 1.4.2 知识与技能视图

```
┌──────────────────────────────────────────────────────────────────────┐
│  CustomTitleBar: Alice                     [⚙ 设置]                 │
├────────────┬───────────────────────────────────────────────────────┤
│            │                                                        │
│   仪表盘   │  [资料库] [地图索引] [专家] [经验] [智能体记忆]           │
│   模型     │  ┌────────────────────────────────────────────────┐    │
│ ● 知识与技能│  │                                                │    │
│   机器人   │  │  (根据选中的 Tab 切换内容)                       │    │
│            │  │                                                │    │
│ · 智能体列表 │  │  资料库: 物品/方块/生物 知识库查询与管理           │    │
│   ● Chili  │  │  地图索引: 已探索区域概览 + 空间查询               │    │
│   ○ hads   │  │  专家: 各领域专家提示词配置                      │    │
│            │  │  经验: LLM 积累的经验片段管理                    │    │
│ [➕ 新建]   │  │  智能体记忆: 向量记忆检索与管理                   │    │
│            │  └────────────────────────────────────────────────┘    │
│ [⚙ 设置]   │                                                        │
├────────────┴───────────────────────────────────────────────────────┤
│  TCP 已连接 · 工作区: 3 · v1.0.0 · Alice Mod Core                  │
└──────────────────────────────────────────────────────────────────────┘
```

#### 1.4.3 智能体实例视图

```
┌──────────────────────────────────────────────────────────────────────┐
│  CustomTitleBar: Alice                     [⚙ 设置]                 │
├────────────┬─────────────────────────────────────┬─────────────────┤
│            │                                     │                  │
│   仪表盘   │  Chili6668267 ●        [信息] [配置] │ · 上下文窗口     │
│   模型     │  ────────────────────────────────   │   45%            │
│   知识与技能│  用户消息                             │ · 用量监控       │
│   机器人   │  ┌──────────────────────────┐        │   今日/本月      │
│            │  │ 思考过程 ▸              │        │                  │
│ ● 智能体列表 │  ├──────────────────────────┤        │ · 待办事项       │
│   ● Chili  │  │ 工具:get_position ✓     │        │                  │
│   ○ hads   │  ├──────────────────────────┤        │                  │
│            │  │ AI 回复内容...            │        │                  │
│ [➕ 新建]   │  └──────────────────────────┘        │                  │
│            │  [输入消息...]                        │                  │
│ [⚙ 设置]   │                                     │                  │
├────────────┴─────────────────────────────────────┴─────────────────┤
│  TCP 已连接 · 工作区: 3 · v1.0.0 · Alice Mod Core                  │
└──────────────────────────────────────────────────────────────────────┘
```

#### 1.4.4 智能体创建页

```
┌──────────────────────────────────────────────────────────────────────┐
│  CustomTitleBar: Alice  < 返回                           [⚙ 设置]   │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  创建新智能体                                      [保存] [取消]     │
│  ─────────────────────────────────────────────                     │
│                                                                    │
│  基本信息                                                          │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │  名称: [________________________]                        │     │
│  │  皮肤: [📷 点击上传]  ████████████ 预览区域              │     │
│  └──────────────────────────────────────────────────────────┘     │
│                                                                    │
│  身份（提示词）                                                     │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │  已选片段: [✕ 采矿专家] [✕ 建筑师] [＋ 添加]             │     │
│  │  ──────────────────────────────────────────────────────  │     │
│  │  预设列表:                                                │     │
│  │  ☐ 采矿专家       专注于矿物采集与矿石处理                   │     │
│  │  ☐ 建筑师         擅长建筑规划与材料管理                     │     │
│  │  ☐ 战斗专家       精通战斗技巧与装备管理                     │     │
│  │  ☐ 红石工程师     熟悉红石电路与自动化装置                   │     │
│  │  ...                                                      │     │
│  └──────────────────────────────────────────────────────────┘     │
│                                                                    │
│  工具配置                                                          │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │  全选 ☐                                                  │     │
│  │  ☑ 感知类    移动 对话 背包         全部 N 个              │     │
│  │  ☑ 生存类    方块 生物 装备         全部 N 个              │     │
│  │  ☐ QQ 类     QQ 工具组合                                │     │
│  └──────────────────────────────────────────────────────────┘     │
│                                                                    │
│  记忆配置                                                          │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │  ○ SQLite 结构化存储   ○ Chroma 向量记忆   ● 二者兼用     │     │
│  └──────────────────────────────────────────────────────────┘     │
│                                                                    │
│  执行规则（发送给模组）                                              │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │  □ 自动进食          当饥饿值 < 6 时自动吃背包食物          │     │
│  │  □ 自动装备          当获得更好装备时自动更换                │     │
│  │  □ 安全优先          血量 < 30% 时停止战斗寻找安全位置      │     │
│  │  □ 物品收集          自动拾取周围掉落物                     │     │
│  │  □ 工具切换          根据方块类型自动切换工具                │     │
│  │  ...                                                      │     │
│  └──────────────────────────────────────────────────────────┘     │
│                                                                    │
│  QQ 绑定                                                          │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │  ☑ 绑定QQ     账号: [@Chili_robot  ▾]                    │     │
│  │  绑定群组: [群1 ▾] [+ 添加群]                            │     │
│  └──────────────────────────────────────────────────────────┘     │
│                                                                    │
│  启用时间                                                          │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │  ● 始终启用                                               │     │
│  │  ○ 定时启用    [08:00] ~ [22:00]  时区: UTC+8             │     │
│  └──────────────────────────────────────────────────────────┘     │
│                                                                    │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.5 验收标准

| # | 验收条件 | 验证方法 | 测量指标 |
|---|----------|----------|----------|
| 8.1 | 左栏导航切换正确 | 点击仪表盘/模型/知识与技能/机器人 | 右侧面板收起，中央面板显示对应内容 |
| 8.2 | 智能体实例视图 | 点击左栏智能体 | 三栏布局展开，右侧面板显示 |
| 8.3 | 仪表盘 Token 图表 | 仪表盘渲染图表 | 柱状图/饼图/热力图显示正常，数据真实 |
| 8.4 | 模型配置添加 | 模型面板添加 Provider/模型 | 列表中出现新条目 |
| 8.5 | 模型列表删除 | 模型列表点击删除 | 条目移除，配置生效 |
| 8.6 | 知识与技能 Tabs | 点击各 Tab | 切换显示对应内容 |
| 8.7 | 智能体创建 | 填写表单并保存 | 智能体创建成功，出现在左栏列表 |
| 8.8 | 智能体创建皮肤上传 | 点击上传按钮选择 .png | 预览区域显示上传的皮肤 |
| 8.9 | 提示词片段组合 | 在创建页勾选预设 | 已选片段列表实时更新 |
| 8.10 | 工具配置勾选 | 勾选/取消工具分类 | 配置保存后生效 |
| 8.11 | 实例视图信息/配置 Tab | 右上角点击切换 | 信息显示对话，配置显示表单 |
| 8.12 | 配置 Tab 修改保存 | 修改配置后保存 | 实例配置更新 |
| 8.13 | 执行规则配置 | 勾选规则项 | 规则序列化正确 |
| 8.14 | UI 响应速度 | 面板切换/数据刷新 | < 200ms |

***

## 第二部分：架构文档

### 2.1 整体架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                         V8 UI 界面模块                                 │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                    渲染进程 (Renderer)                         │    │
│  │                                                              │    │
│  │  ┌───────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │    │
│  │  │ 仪表盘     │  │ 模型配置  │  │ 知识与技能│  │ 智能体管理   │  │    │
│  │  │Dashboard  │  │ModelMgr  │  │KnowSkill │  │AgentMgr    │  │    │
│  │  │           │  │          │  │          │  │            │  │    │
│  │  │ · Token   │  │ · 列表   │  │ · Tabs   │  │ · 创建表单  │  │    │
│  │  │   统计图  │  │ · 添加   │  │ · 资料库  │  │ · 实例视图  │  │    │
│  │  │ · 活跃    │  │ · 设置   │  │ · 地图索引│  │ · 配置编辑  │  │    │
│  │  │   时段图  │  │ · 删除   │  │ · 专家    │  │ · 皮肤上传  │  │    │
│  │  │ · 连接    │  │          │  │ · 经验    │  │ · 规则配置  │  │    │
│  │  │   概览   │  │          │  │ · 智能体   │  │            │  │    │
│  │  │          │  │          │  │   记忆    │  │            │  │    │
│  │  └────┬─────┘  └────┬─────┘  └─────┬────┘  └──────┬─────┘  │    │
│  │       │             │              │              │         │    │
│  │       └─────────────┴──────┬───────┴──────────────┘         │    │
│  │                            ▼                                │    │
│  │  ┌──────────────────────────────────────────────────────┐  │    │
│  │  │                   Zustand Stores                      │  │    │
│  │  │  chatStore | configStore | workspaceStore | uiStore  │  │    │
│  │  └───────────────────────┬──────────────────────────────┘  │    │
│  │                          │                                  │    │
│  │  ┌───────────────────────▼──────────────────────────────┐  │    │
│  │  │                   IPC Bridge Layer                     │  │    │
│  │  │  invoke + on event                                    │  │    │
│  │  └───────────────────────┬──────────────────────────────┘  │    │
│  ───────────────────────────┼───────────────────────────────────┘  │
│                             │ IPC                                   │
│  ┌──────────────────────────┼────────────────────────────────────┐  │
│  │                   主进程 (Main)                                │  │
│  │                          ▼                                    │  │
│  │  ┌─────────────────────────────────────────────────────────┐ │  │
│  │  │                 V8 新增/扩展 IPC Handler                  │ │  │
│  │  │  workspace:handler.ts · tcp:handler.ts                   │ │  │
│  │  │  dashboard:handler.ts (stats/usage)                     │ │  │
│  │  │  agent:handler.ts (create/update/delete/list)           │ │  │
│  │  └───────────────────────┬─────────────────────────────────┘ │  │
│  │                          │                                    │  │
│  │  ┌───────────────────────▼─────────────────────────────────┐ │  │
│  │  │                  业务服务层                               │ │  │
│  │  │  WorkspaceManager · UsageTracker · AgentConfigManager   │ │  │
│  │  └─────────────────────────────────────────────────────────┘ │  │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 布局管理方案

#### 2.2.1 布局状态机

```
type LayoutMode = 'nav-view' | 'agent-view' | 'agent-create'

NavView: RightSidebar 隐藏，中央面板填充
  ├── dashboard   — 仪表盘
  ├── model       — 模型配置
  ├── knowledge   — 知识与技能
  └── robot       — 机器人（预留）

AgentView: 三栏布局，RightSidebar 显示
  ├── info Tab    — 对话面板
  └── config Tab  — 配置表单

AgentCreate: 全页表单，RightSidebar 隐藏
```

#### 2.2.2 组件条件渲染

```typescript
// App.tsx 核心逻辑
const layoutMode = useUIStore(s => s.layoutMode)
const showRightSidebar = layoutMode === 'agent-view'

return (
  <AppLayout showRightSidebar={showRightSidebar}>
    {layoutMode === 'nav-view' && <NavContent />}
    {layoutMode === 'agent-view' && <AgentInstanceView />}
    {layoutMode === 'agent-create' && <AgentCreatePage />}
  </AppLayout>
)
```

### 2.3 新增/扩展 IPC 通信协议

#### 2.3.1 Channel 定义

| Channel | 方向 | 用途 | 请求参数 | 返回值 |
|---------|:----:|------|----------|--------|
| `dashboard:stats` | R→M | 获取仪表盘统计 | `{ period }` | `DashboardStats` |
| `dashboard:usage-history` | R→M | 获取用量历史 | `{ days }` | `DailyUsage[]` |
| `dashboard:agent-activity` | R→M | 获取活跃时段 | `{ workspaceIds }` | `ActivityData` |
| `agent:create` | R→M | 创建智能体 | `AgentConfig` | `{ id, success }` |
| `agent:update` | R→M | 更新智能体配置 | `{ id, config }` | `{ success }` |
| `agent:delete` | R→M | 删除智能体 | `{ id }` | `{ success }` |
| `agent:list` | R→M | 获取智能体列表 | `{}` | `AgentSummary[]` |
| `agent:get` | R→M | 获取智能体详情 | `{ id }` | `AgentConfig` |
| `model:add` | R→M | 添加模型配置 | `ModelConfig` | `{ success }` |
| `model:remove` | R→M | 删除模型配置 | `{ id }` | `{ success }` |
| `model:update` | R→M | 更新模型配置 | `{ id, config }` | `{ success }` |
| `model:list` | R→M | 获取模型列表 | `{}` | `ModelConfig[]` |

#### 2.3.2 事件推送

| Channel | 方向 | 用途 | 推送数据 |
|---------|:----:|------|----------|
| `dashboard:usage:update` | M→R | 用量实时更新 | `{ currentTokens, ... }` |
| `agent:state-changed` | M→R | 智能体状态变化 | `{ id, status }` |

### 2.4 新增类型定义

```typescript
// ==========================================
// V8 新增类型：仪表盘
// ==========================================

/** 仪表盘统计数据 */
export interface DashboardStats {
  todayTokens: number
  monthTokens: number
  totalTokens: number
  activeConnections: number
  totalAgents: number
  onlineAgents: number
  providerDistribution: ProviderUsage[]
  topModels: ModelUsage[]
}

/** Provider 用量分布 */
export interface ProviderUsage {
  providerId: string
  providerName: string
  tokenCount: number
  percentage: number
  callCount: number
}

/** 模型用量排行 */
export interface ModelUsage {
  modelId: string
  modelName: string
  providerId: string
  tokenCount: number
  callCount: number
}

/** 每日用量 */
export interface DailyUsage {
  date: string
  tokens: number
  callCount: number
}

/** 智能体活跃时段数据 */
export interface ActivityData {
  workspaceId: string
  workspaceName: string
  hourlyActivity: number[]  // 24h, 每个小时的活动次数
  dailyActivity: number[]   // 7天, 每天的活动次数
}

// ==========================================
// V8 新增类型：智能体配置
// ==========================================

/** 智能体概要（列表用） */
export interface AgentSummary {
  id: string
  name: string
  status: 'online' | 'offline' | 'connecting'
  toolCount: number
  lastActiveAt?: number
  workspaceId?: string
}

/** 智能体完整配置 */
export interface AgentConfig {
  id?: string
  name: string
  skinData?: string       // base64 编码的皮肤数据
  identity: AgentIdentity
  tools: AgentToolConfig
  memory: AgentMemoryConfig
  executionRules: ExecutionRule[]
  qqBinding: QQBinding
  schedule: AgentSchedule
  createdAt?: number
  updatedAt?: number
}

/** 身份/提示词配置 */
export interface AgentIdentity {
  selectedFragments: string[]    // 选中的提示词片段 ID 列表
  customPrompt?: string          // 自定义补充提示词
}

/** 工具配置 */
export interface AgentToolConfig {
  categorySelection: Record<string, boolean>  // 分类 ID → 是否启用
  customToolIds?: string[]
}

/** 记忆配置 */
export interface AgentMemoryConfig {
  mode: 'sqlite' | 'chroma' | 'both'
}

/** 执行规则 */
export interface ExecutionRule {
  id: string
  name: string
  description: string
  enabled: boolean
  params?: Record<string, unknown>
}

/** QQ 绑定 */
export interface QQBinding {
  enabled: boolean
  accountId?: string
  groupIds?: string[]
}

/** 智能体启用时间 */
export interface AgentSchedule {
  mode: 'always' | 'scheduled'
  startTime?: string    // HH:mm
  endTime?: string      // HH:mm
  timezone?: string
}

// ==========================================
// V8 新增类型：UI 布局
// ==========================================

/** 布局模式 */
export type LayoutMode = 'nav-view' | 'agent-view' | 'agent-create'

/** 导航面板类型 */
export type NavPanelType = 'dashboard' | 'model' | 'knowledge' | 'robot'

/** 智能体实例 Tab */
export type AgentViewTab = 'info' | 'config'

// ==========================================
// V8 扩展类型：模型配置
// ==========================================

/** 模型配置（UI 管理用） */
export interface ModelConfig {
  id: string
  providerId: string
  providerName: string
  modelName: string
  apiKey: string
  baseUrl: string
  enabled: boolean
  contextWindow: number
  supportsFunctionCalling: boolean
  createdAt: number
}
```

### 2.5 前端组件架构

#### 2.5.1 目录结构（新增/修改）

```
packages/agent-core/src/renderer/src/
├── App.tsx                          ← 修改: 布局模式路由
│
├── components/
│   ├── dashboard/                   ← 新增: 仪表盘
│   │   ├── DashboardPanel.tsx       # 仪表盘容器
│   │   ├── TokenSummaryCards.tsx     # Token 数字卡片
│   │   ├── TokenTrendChart.tsx      # Token 日趋势柱状图
│   │   ├── ProviderPieChart.tsx     # Provider 分布饼图
│   │   ├── ModelRanking.tsx         # 模型调用排行
│   │   └── ActivityHeatmap.tsx      # 活跃时段热力图
│   │
│   ├── model/                       ← 新增: 模型配置
│   │   ├── ModelPanel.tsx           # 模型配置容器
│   │   ├── ModelList.tsx            # 模型列表
│   │   ├── ModelCard.tsx            # 单模型卡片
│   │   └── ModelAddForm.tsx         # 添加模型表单
│   │
│   ├── knowledge/                   ← 新增: 知识与技能
│   │   ├── KnowledgePanel.tsx       # 知识与技能容器
│   │   ├── KnowledgeTabs.tsx        # 顶部 Tabs 切换
│   │   ├── DatabaseView.tsx         # 资料库视图
│   │   ├── MapIndexView.tsx         # 地图索引视图
│   │   ├── ExpertView.tsx           # 专家视图
│   │   ├── ExperienceView.tsx       # 经验视图
│   │   └── AgentMemoryView.tsx      # 智能体记忆视图
│   │
│   ├── agent/                       ← 新增/重构: 智能体管理
│   │   ├── AgentCreatePage.tsx      # 智能体创建页（全页）
│   │   ├── AgentConfigForm.tsx      # 智能体配置表单（复用）
│   │   ├── AgentInstanceView.tsx    # 智能体实例视图（三栏）
│   │   ├── sections/
│   │   │   ├── BasicInfoSection.tsx     # 基本信息（名称/皮肤）
│   │   │   ├── IdentitySection.tsx      # 身份/提示词
│   │   │   ├── ToolConfigSection.tsx    # 工具配置
│   │   │   ├── MemoryConfigSection.tsx  # 记忆配置
│   │   │   ├── ExecutionRulesSection.tsx # 执行规则
│   │   │   ├── QQBindSection.tsx        # QQ 绑定
│   │   │   └── ScheduleSection.tsx      # 启用时间
│   │   └── AgentList.tsx            # 左栏智能体列表数据源
│   │
│   ├── layout/
│   │   ├── AppLayout.tsx            ← 修改: 条件渲染 RightSidebar
│   │   ├── LeftSidebar.tsx          ← 修改: 导航 active 联动 + 智能体列表接入数据
│   │   ├── RightSidebar.tsx         ← 修改: 仅在 agent-view 时显示
│   │   └── StatusBar.tsx            ← 修改: 接入实时数据
│   │
│   └── shared/
│       ├── Tabs.tsx                 ← 新增: 通用 Tabs 组件
│       ├── CollapsibleSection.tsx   ← 新增: 可折叠区域
│       └── PresetSelector.tsx       ← 新增: 预设选择器（提示词/规则）
│
├── hooks/
│   ├── useDashboard.ts              ← 新增
│   ├── useModelConfig.ts            ← 新增
│   ├── useKnowledge.ts              ← 新增
│   └── useAgent.ts                  ← 新增
│
├── stores/
│   ├── uiStore.ts                   ← 新增: UI 布局状态
│   ├── dashboardStore.ts            ← 新增: 仪表盘数据
│   ├── modelStore.ts                ← 新增: 模型配置
│   ├── knowledgeStore.ts            ← 新增: 知识与技能
│   └── agentStore.ts                ← 新增: 智能体管理
│
└── lib/
    ├── ipc.ts                       ← 修改: 添加新 API
    └── types.ts                     ← 修改: 添加新类型
```

#### 2.5.2 核心组件关系

```
App
├── AppLayout
│   ├── CustomTitleBar
│   ├── LeftSidebar
│   │   ├── NavMenu (4 items → setActiveNav)
│   │   └── AgentList (+ button → setLayoutMode)
│   │
│   ├── <main> (条件渲染)
│   │   ├── [nav-view] NavContent
│   │   │   ├── [dashboard] DashboardPanel
│   │   │   │   ├── TokenSummaryCards
│   │   │   │   ├── TokenTrendChart
│   │   │   │   ├── ProviderPieChart
│   │   │   │   ├── ModelRanking
│   │   │   │   └── ActivityHeatmap
│   │   │   ├── [model] ModelPanel
│   │   │   │   ├── ModelAddForm
│   │   │   │   └── ModelList → ModelCard (× N)
│   │   │   ├── [knowledge] KnowledgePanel
│   │   │   │   ├── KnowledgeTabs
│   │   │   │   ├── DatabaseView
│   │   │   │   ├── MapIndexView
│   │   │   │   ├── ExpertView
│   │   │   │   ├── ExperienceView
│   │   │   │   └── AgentMemoryView
│   │   │   └── [robot] RobotPanel (预留)
│   │   │
│   │   ├── [agent-view] AgentInstanceView
│   │   │   ├── Header (名称 + Tabs: 信息/配置)
│   │   │   ├── [info] ChatPanel (复用 V7)
│   │   │   └── [config] AgentConfigForm (复用创建表单)
│   │   │
│   │   └── [agent-create] AgentCreatePage
│   │       └── AgentConfigForm (全表单)
│   │
│   ├── RightSidebar (仅 agent-view 时显示)
│   │   ├── ContextMeter
│   │   ├── UsageChart
│   │   └── TodoList
│   │
│   └── StatusBar
```

### 2.6 状态管理方案

#### 新增 Store

| Store | 职责 | 关键状态 |
|-------|------|----------|
| `uiStore` | UI 布局管理 | `layoutMode`、`activeNav`、`agentViewTab`、`showRightSidebar` |
| `dashboardStore` | 仪表盘数据 | `stats`、`dailyUsage[]`、`activityData[]`、`loading` |
| `modelStore` | 模型配置 | `models[]`、`editing`、`loading` |
| `knowledgeStore` | 知识与技能 | `activeTab`、各类视图数据 |
| `agentStore` | 智能体管理 | `agents[]`、`currentAgentId`、`creating`、`editing` |

#### uiStore 数据结构

```typescript
interface UIState {
  layoutMode: 'nav-view' | 'agent-view' | 'agent-create'
  activeNav: 'dashboard' | 'model' | 'knowledge' | 'robot'
  agentViewTab: 'info' | 'config'
  showRightSidebar: boolean  // 由 layoutMode 派生

  setLayoutMode: (mode: LayoutMode) => void
  setActiveNav: (nav: NavPanelType) => void
  setAgentViewTab: (tab: AgentViewTab) => void
  navigateToAgent: (agentId: string) => void
  navigateToCreate: () => void
  navigateToNav: (nav: NavPanelType) => void
}
```

### 2.7 与已有模块的集成

| 已有模块 | 集成方式 |
|----------|----------|
| V7 ChatPanel | 作为 AgentInstanceView 的 info Tab 内容复用 |
| V7 RightSidebar | 仅在 agent-view 时显示，数据联动当前智能体 |
| V7 LeftSidebar | 导航 active 动态切换，智能体列表接入 agentStore |
| V5 提示词片段 | IdentitySection 中提示词预设选择器复用 V5 注册机制 |
| V6 LLM Provider | ModelPanel 中管理的模型配置同步到 V6 ProviderRegistry |
| V3 WorkspaceManager | 智能体与工作区绑定/解绑 |

***

## 第三部分：执行文档

### 3.1 主进程 IPC Handler 新增

#### 3.1.1 仪表盘 IPC Handler

```typescript
// src/main/ipc/dashboard-handler.ts
import { ipcMain } from 'electron'
import { UsageTracker } from '../llm/observer'
import { WorkspaceManager } from '../workspace'

export function registerDashboardHandlers(): void {
  // 获取仪表盘统计
  ipcMain.handle('dashboard:stats', async () => {
    const stats = UsageTracker.getStats()
    const workspaces = WorkspaceManager.list()

    return {
      todayTokens: stats.todayTokens,
      monthTokens: stats.monthTokens,
      totalTokens: stats.totalTokens,
      activeConnections: workspaces.filter(w => w.state === 'online').length,
      totalAgents: workspaces.length,
      onlineAgents: workspaces.filter(w => w.state === 'online').length,
      providerDistribution: stats.providerDistribution.map(p => ({
        providerId: p.providerId,
        providerName: p.providerName,
        tokenCount: p.tokenCount,
        percentage: (p.tokenCount / stats.totalTokens) * 100,
        callCount: p.callCount
      })),
      topModels: stats.topModels.slice(0, 10)
    }
  })

  // 获取用量历史
  ipcMain.handle('dashboard:usage-history', async (_event, { days = 7 }) => {
    return UsageTracker.getDailyHistory(days)
  })

  // 获取活跃时段
  ipcMain.handle('dashboard:agent-activity', async () => {
    const workspaces = WorkspaceManager.list()
    return workspaces.map(ws => ({
      workspaceId: ws.id,
      workspaceName: ws.name,
      hourlyActivity: ws.activityStats?.hourly ?? new Array(24).fill(0),
      dailyActivity: ws.activityStats?.daily ?? new Array(7).fill(0)
    }))
  })
}
```

#### 3.1.2 智能体 IPC Handler

```typescript
// src/main/ipc/agent-handler.ts
import { ipcMain } from 'electron'
import { AgentConfigManager } from './agent-config'

/** 智能体配置管理器 */
class AgentConfigManager {
  private configs: Map<string, AgentConfig> = new Map()

  constructor() {
    // 从 SQLite 加载已保存的配置
    this.loadFromDb()
  }

  async create(config: AgentConfig): Promise<string> {
    const id = crypto.randomUUID()
    config.id = id
    config.createdAt = Date.now()
    config.updatedAt = Date.now()
    this.configs.set(id, config)
    await this.saveToDb(id, config)
    return id
  }

  async update(id: string, config: Partial<AgentConfig>): Promise<boolean> {
    const existing = this.configs.get(id)
    if (!existing) return false
    Object.assign(existing, config, { updatedAt: Date.now() })
    await this.saveToDb(id, existing)
    return true
  }

  async delete(id: string): Promise<boolean> {
    const existed = this.configs.delete(id)
    if (existed) await this.removeFromDb(id)
    return existed
  }

  list(): AgentSummary[] {
    return Array.from(this.configs.values()).map(c => ({
      id: c.id!,
      name: c.name,
      status: 'offline',  // 由 WorkspaceManager 决定
      toolCount: Object.values(c.tools.categorySelection).filter(Boolean).length,
      lastActiveAt: c.updatedAt,
      workspaceId: undefined
    }))
  }

  get(id: string): AgentConfig | undefined {
    return this.configs.get(id)
  }

  private async loadFromDb(): Promise<void> { /* TODO */ }
  private async saveToDb(id: string, config: AgentConfig): Promise<void> { /* TODO */ }
  private async removeFromDb(id: string): Promise<void> { /* TODO */ }
}

const agentConfigManager = new AgentConfigManager()

export function registerAgentHandlers(): void {
  ipcMain.handle('agent:list', async () => {
    return agentConfigManager.list()
  })

  ipcMain.handle('agent:get', async (_event, { id }) => {
    return agentConfigManager.get(id) ?? null
  })

  ipcMain.handle('agent:create', async (_event, config: AgentConfig) => {
    const id = await agentConfigManager.create(config)
    return { id, success: true }
  })

  ipcMain.handle('agent:update', async (_event, { id, config }) => {
    const success = await agentConfigManager.update(id, config)
    return { success }
  })

  ipcMain.handle('agent:delete', async (_event, { id }) => {
    const success = await agentConfigManager.delete(id)
    return { success }
  })
}
```

#### 3.1.3 模型管理 IPC Handler

```typescript
// src/main/ipc/model-handler.ts
import { ipcMain } from 'electron'
import { ProviderRegistry } from '../llm/registry'

export function registerModelHandlers(): void {
  // 获取模型列表
  ipcMain.handle('model:list', async () => {
    const providers = ProviderRegistry.getAll()
    const models: ModelConfig[] = []

    for (const [providerId, provider] of providers) {
      for (const model of provider.getModels()) {
        models.push({
          id: `${providerId}:${model.id}`,
          providerId,
          providerName: provider.getName(),
          modelName: model.name,
          apiKey: provider.getApiKey(),
          baseUrl: provider.getBaseUrl(),
          enabled: model.enabled,
          contextWindow: model.contextWindow,
          supportsFunctionCalling: model.supportsFunctionCalling,
          createdAt: model.createdAt
        })
      }
    }

    return models
  })

  // 添加模型
  ipcMain.handle('model:add', async (_event, config: ModelConfig) => {
    await ProviderRegistry.addModel(config.providerId, {
      id: config.modelName,
      name: config.modelName,
      enabled: config.enabled,
      contextWindow: config.contextWindow,
      supportsFunctionCalling: config.supportsFunctionCalling
    })
    return { success: true }
  })

  // 删除模型
  ipcMain.handle('model:remove', async (_event, { id }) => {
    const [providerId, modelId] = id.split(':')
    await ProviderRegistry.removeModel(providerId, modelId)
    return { success: true }
  })

  // 更新模型
  ipcMain.handle('model:update', async (_event, { id, config }) => {
    const [providerId, modelId] = id.split(':')
    await ProviderRegistry.updateModel(providerId, modelId, config)
    return { success: true }
  })
}
```

#### 3.1.4 IPC 入口整合

```typescript
// src/main/ipc/index.ts (更新版)
import { BrowserWindow } from 'electron'
import { registerChatHandlers } from './chat-handler'
import { registerConfigHandlers } from './config-handler'
import { registerWindowHandlers } from './window-handler'
import { registerDashboardHandlers } from './dashboard-handler'
import { registerAgentHandlers } from './agent-handler'
import { registerModelHandlers } from './model-handler'

export function registerAllIpcHandlers(mainWindow: BrowserWindow): void {
  registerChatHandlers()
  registerConfigHandlers()
  registerWindowHandlers(mainWindow)
  registerDashboardHandlers()
  registerAgentHandlers()
  registerModelHandlers()
}

export { setTcpServer }
```

### 3.2 前端核心组件实现

#### 3.2.1 App.tsx（布局模式路由）

```tsx
// src/renderer/src/App.tsx (更新版)
import React from 'react'
import AppLayout from './components/layout/AppLayout'
import DashboardPanel from './components/dashboard/DashboardPanel'
import ModelPanel from './components/model/ModelPanel'
import KnowledgePanel from './components/knowledge/KnowledgePanel'
import AgentInstanceView from './components/agent/AgentInstanceView'
import AgentCreatePage from './components/agent/AgentCreatePage'
import ConfigPanel from './components/settings/ConfigPanel'
import { useUIStore } from './stores/uiStore'

const App: React.FC = () => {
  const { layoutMode, activeNav } = useUIStore()

  const renderContent = () => {
    switch (layoutMode) {
      case 'nav-view':
        return renderNavContent()
      case 'agent-view':
        return <AgentInstanceView />
      case 'agent-create':
        return <AgentCreatePage />
      default:
        return null
    }
  }

  const renderNavContent = () => {
    switch (activeNav) {
      case 'dashboard':
        return <DashboardPanel />
      case 'model':
        return <ModelPanel />
      case 'knowledge':
        return <KnowledgePanel />
      case 'robot':
        return <div className="flex-1 flex items-center justify-center text-gray-400">机器人模块（V10 实现）</div>
      default:
        return null
    }
  }

  return (
    <>
      <AppLayout>
        {renderContent()}
      </AppLayout>
      <ConfigPanel />
    </>
  )
}

export default App
```

#### 3.2.2 AppLayout（条件右侧栏）

```tsx
// src/renderer/src/components/layout/AppLayout.tsx (更新版)
import React from 'react'
import CustomTitleBar from './CustomTitleBar'
import LeftSidebar from './LeftSidebar'
import RightSidebar from './RightSidebar'
import StatusBar from './StatusBar'
import { useUIStore } from '../../stores/uiStore'

const AppLayout: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const showRightSidebar = useUIStore(s => s.showRightSidebar)

  return (
    <div className="flex flex-col h-screen w-screen bg-gray-100 text-gray-700 overflow-hidden">
      <CustomTitleBar />
      <div className="flex flex-1 overflow-hidden">
        <LeftSidebar />
        <main className="flex-1 flex flex-col overflow-hidden p-4">
          {children}
        </main>
        {showRightSidebar && <RightSidebar />}
      </div>
      <StatusBar />
    </div>
  )
}

export default AppLayout
```

#### 3.2.3 LeftSidebar（导航联动 + 智能体列表）

```tsx
// src/renderer/src/components/layout/LeftSidebar.tsx (更新版)
import React, { useEffect } from 'react'
import { useUIStore } from '../../stores/uiStore'
import { useAgentStore } from '../../stores/agentStore'
import { useConfigStore } from '../../stores/configStore'
import type { NavPanelType } from '../../lib/types'

const LeftSidebar: React.FC = () => {
  const { activeNav, setActiveNav, setLayoutMode, navigateToAgent } = useUIStore()
  const { agents, refreshAgents, currentAgentId } = useAgentStore()
  const openConfigPanel = useConfigStore(s => s.openConfigPanel)

  useEffect(() => {
    refreshAgents()
  }, [])

  return (
    <aside className="w-60 flex flex-col bg-gray-100">
      {/* 导航菜单 */}
      <nav className="p-2 pt-4 space-y-0.5">
        {navItems.map(item => (
          <button
            key={item.label}
            onClick={() => {
              setActiveNav(item.nav)
              setLayoutMode('nav-view')
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
              activeNav === item.nav
                ? 'bg-gray-200/70 text-gray-700 font-medium'
                : 'text-gray-500 hover:text-gray-600 hover:bg-gray-200/40'
            }`}
          >
            <item.icon />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* 智能体列表 */}
      <div className="flex-1 p-2">
        <div className="flex items-center justify-between px-3 py-1.5">
          <span className="text-xs text-gray-400 font-medium">智能体</span>
          <button
            onClick={() => setLayoutMode('agent-create')}
            className="text-gray-400 hover:text-gray-500 transition-colors"
            title="创建智能体"
          >
            <PlusIcon />
          </button>
        </div>
        <div className="space-y-0.5">
          {agents.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">暂无智能体，点击 + 创建</div>
          ) : (
            agents.map(agent => (
              <button
                key={agent.id}
                onClick={() => navigateToAgent(agent.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                  agent.id === currentAgentId
                    ? 'bg-gray-200/50 text-gray-700'
                    : 'text-gray-500 hover:text-gray-600 hover:bg-gray-200/40'
                }`}
              >
                <StatusDot status={agent.status} />
                <span className="flex-1 text-left truncate">{agent.name}</span>
                <span className="text-[10px] text-gray-400">{agent.toolCount}</span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* 设置 */}
      <div className="p-2">
        <button
          onClick={openConfigPanel}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm text-gray-500 hover:text-gray-600 hover:bg-gray-200/40 transition-colors"
        >
          <SettingsIcon />
          <span>设置</span>
        </button>
      </div>
    </aside>
  )
}

const StatusDot: React.FC<{ status: string }> = ({ status }) => {
  const colors: Record<string, string> = {
    online: 'bg-green-400',
    connecting: 'bg-yellow-400',
    offline: 'bg-gray-300'
  }
  return <span className={`w-2 h-2 rounded-full ${colors[status] ?? 'bg-gray-300'}`} />
}

const PlusIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

// ... (图标组件同 V7)

interface NavItem {
  label: string
  icon: React.FC
  nav: NavPanelType
}

const navItems: NavItem[] = [
  { label: '仪表盘', icon: DashboardIcon, nav: 'dashboard' },
  { label: '模型', icon: ModelIcon, nav: 'model' },
  { label: '知识与技能', icon: KnowledgeIcon, nav: 'knowledge' },
  { label: '机器人', icon: RobotIcon, nav: 'robot' }
]

const DashboardIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
  </svg>
)

const ModelIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
)

const KnowledgeIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
)

const RobotIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="3" y="11" width="18" height="10" rx="2" />
    <circle cx="12" cy="5" r="2" />
    <path d="M12 7v4" />
    <line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" />
  </svg>
)

const SettingsIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

export default LeftSidebar
```

#### 3.2.4 AgentInstanceView（智能体实例视图）

```tsx
// src/renderer/src/components/agent/AgentInstanceView.tsx
import React, { useEffect } from 'react'
import { useUIStore } from '../../stores/uiStore'
import { useAgentStore } from '../../stores/agentStore'
import ChatPanel from '../chat/ChatPanel'
import AgentConfigForm from './AgentConfigForm'

const AgentInstanceView: React.FC = () => {
  const { agentViewTab, setAgentViewTab } = useUIStore()
  const { currentAgent, fetchAgent, agents, currentAgentId } = useAgentStore()
  const agent = currentAgent ?? agents.find(a => a.id === currentAgentId)

  useEffect(() => {
    if (currentAgentId) {
      fetchAgent(currentAgentId)
    }
  }, [currentAgentId])

  if (!agent) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white rounded-lg shadow-sm border border-gray-200">
        <p className="text-sm text-gray-400">未选择智能体</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 头部：名称 + Tabs */}
      <div className="flex items-center justify-between px-4 py-2 bg-white rounded-t-lg shadow-sm border border-gray-200 border-b-0">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${agent.status === 'online' ? 'bg-green-400' : 'bg-gray-300'}`} />
          <span className="text-sm font-semibold text-gray-700">{agent.name}</span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setAgentViewTab('info')}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              agentViewTab === 'info'
                ? 'bg-gray-200/70 text-gray-700 font-medium'
                : 'text-gray-500 hover:text-gray-600 hover:bg-gray-200/40'
            }`}
          >
            信息
          </button>
          <button
            onClick={() => setAgentViewTab('config')}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              agentViewTab === 'config'
                ? 'bg-gray-200/70 text-gray-700 font-medium'
                : 'text-gray-500 hover:text-gray-600 hover:bg-gray-200/40'
            }`}
          >
            配置
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 flex flex-col bg-white rounded-b-lg shadow-sm border border-gray-200 overflow-hidden">
        {agentViewTab === 'info' ? (
          <ChatPanel />
        ) : (
          <div className="flex-1 overflow-y-auto p-4">
            <AgentConfigForm agentId={agent.id} />
          </div>
        )}
      </div>
    </div>
  )
}

export default AgentInstanceView
```

#### 3.2.5 DashboardPanel（仪表盘）

```tsx
// src/renderer/src/components/dashboard/DashboardPanel.tsx
import React, { useEffect } from 'react'
import { useDashboardStore } from '../../stores/dashboardStore'
import TokenSummaryCards from './TokenSummaryCards'
import TokenTrendChart from './TokenTrendChart'
import ProviderPieChart from './ProviderPieChart'
import ModelRanking from './ModelRanking'
import ActivityHeatmap from './ActivityHeatmap'

const DashboardPanel: React.FC = () => {
  const { stats, dailyUsage, activityData, loading, fetchStats, fetchUsageHistory, fetchActivity } = useDashboardStore()

  useEffect(() => {
    fetchStats()
    fetchUsageHistory(7)
    fetchActivity()
  }, [])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-sm text-gray-400">加载中...</div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-4">
        {/* Token 用量总览卡片 */}
        <TokenSummaryCards stats={stats} />

        {/* 图表区域 */}
        <div className="grid grid-cols-2 gap-4">
          {/* Token 日趋势 */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Token 日趋势</h3>
            <TokenTrendChart data={dailyUsage} />
          </div>

          {/* Provider 分布 */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Provider 分布</h3>
            <ProviderPieChart data={stats?.providerDistribution ?? []} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* 模型调用排行 */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">模型调用排行</h3>
            <ModelRanking data={stats?.topModels ?? []} />
          </div>

          {/* 智能体活跃时段 */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">智能体活跃时段</h3>
            <ActivityHeatmap data={activityData} />
          </div>
        </div>

        {/* 连接概览摘要 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">连接概览</h3>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-500">当前连接: <strong className="text-gray-700">{stats?.activeConnections ?? 0}</strong></span>
            <span className="text-gray-300">|</span>
            <span className="text-gray-500">在线智能体: <strong className="text-green-600">{stats?.onlineAgents ?? 0}</strong></span>
            <span className="text-gray-300">|</span>
            <span className="text-gray-500">总智能体: <strong className="text-gray-700">{stats?.totalAgents ?? 0}</strong></span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default DashboardPanel
```

#### 3.2.6 ModelPanel（模型配置面板）

```tsx
// src/renderer/src/components/model/ModelPanel.tsx
import React, { useState, useEffect } from 'react'
import { useModelStore } from '../../stores/modelStore'
import ModelList from './ModelList'
import ModelAddForm from './ModelAddForm'

const ModelPanel: React.FC = () => {
  const { models, loading, fetchModels } = useModelStore()
  const [showAddForm, setShowAddForm] = useState(false)

  useEffect(() => {
    fetchModels()
  }, [])

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-700">模型管理</h2>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"
          >
            {showAddForm ? '取消' : '+ 添加模型'}
          </button>
        </div>

        {/* 添加表单 */}
        {showAddForm && (
          <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <ModelAddForm onSuccess={() => { setShowAddForm(false); fetchModels() }} />
          </div>
        )}

        {/* 模型列表 */}
        {loading ? (
          <div className="text-sm text-gray-400 text-center py-8">加载中...</div>
        ) : (
          <ModelList models={models} />
        )}
      </div>
    </div>
  )
}

export default ModelPanel
```

```tsx
// src/renderer/src/components/model/ModelList.tsx
import React from 'react'
import type { ModelConfig } from '../../lib/types'
import ModelCard from './ModelCard'

interface Props {
  models: ModelConfig[]
}

const ModelList: React.FC<Props> = ({ models }) => {
  // 按 Provider 分组
  const grouped = models.reduce<Record<string, ModelConfig[]>>((acc, model) => {
    if (!acc[model.providerName]) acc[model.providerName] = []
    acc[model.providerName].push(model)
    return acc
  }, {})

  if (models.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-gray-400">
        暂无模型配置，点击"添加模型"开始配置
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([providerName, providerModels]) => (
        <div key={providerName}>
          <h3 className="text-xs font-medium text-gray-400 mb-2 uppercase">{providerName}</h3>
          <div className="space-y-2">
            {providerModels.map(model => (
              <ModelCard key={model.id} model={model} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default ModelList
```

```tsx
// src/renderer/src/components/model/ModelCard.tsx
import React, { useState } from 'react'
import type { ModelConfig } from '../../lib/types'
import { useModelStore } from '../../stores/modelStore'

interface Props {
  model: ModelConfig
}

const ModelCard: React.FC<Props> = ({ model }) => {
  const { removeModel, updateModel } = useModelStore()
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({
    apiKey: model.apiKey,
    baseUrl: model.baseUrl,
    enabled: model.enabled
  })

  const handleSave = async () => {
    await updateModel(model.id, editForm)
    setEditing(false)
  }

  const handleDelete = async () => {
    if (confirm(`确认删除模型 ${model.modelName}？`)) {
      await removeModel(model.id)
    }
  }

  if (editing) {
    return (
      <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">{model.modelName}</span>
          <span className="text-xs text-gray-400">{model.providerName}</span>
        </div>
        <div className="space-y-2">
          <input
            className="w-full px-2 py-1 text-xs border border-gray-200 rounded"
            placeholder="API Key"
            value={editForm.apiKey}
            onChange={e => setEditForm(f => ({ ...f, apiKey: e.target.value }))}
          />
          <input
            className="w-full px-2 py-1 text-xs border border-gray-200 rounded"
            placeholder="Base URL"
            value={editForm.baseUrl}
            onChange={e => setEditForm(f => ({ ...f, baseUrl: e.target.value }))}
          />
          <label className="flex items-center gap-2 text-xs text-gray-500">
            <input type="checkbox" checked={editForm.enabled} onChange={e => setEditForm(f => ({ ...f, enabled: e.target.checked }))} />
            启用
          </label>
        </div>
        <div className="flex gap-2 mt-2">
          <button onClick={handleSave} className="px-2 py-1 text-xs text-blue-600 bg-blue-50 rounded">保存</button>
          <button onClick={() => setEditing(false)} className="px-2 py-1 text-xs text-gray-500 bg-gray-100 rounded">取消</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-100 hover:border-gray-200 transition-colors">
      <div className="flex items-center gap-3">
        <span className={`w-2 h-2 rounded-full ${model.enabled ? 'bg-green-400' : 'bg-gray-300'}`} />
        <div>
          <div className="text-sm font-medium text-gray-700">{model.modelName}</div>
          <div className="text-xs text-gray-400">
            {model.providerName} · {model.contextWindow.toLocaleString()} ctx
            {model.supportsFunctionCalling && ' · FC'}
          </div>
        </div>
      </div>
      <div className="flex gap-1">
        <button onClick={() => setEditing(true)} className="px-2 py-1 text-xs text-gray-500 hover:text-blue-600 rounded">设置</button>
        <button onClick={handleDelete} className="px-2 py-1 text-xs text-gray-500 hover:text-red-600 rounded">删除</button>
      </div>
    </div>
  )
}

export default ModelCard
```

#### 3.2.7 KnowledgePanel（知识与技能面板）

```tsx
// src/renderer/src/components/knowledge/KnowledgePanel.tsx
import React from 'react'
import { useKnowledgeStore } from '../../stores/knowledgeStore'
import DatabaseView from './DatabaseView'
import MapIndexView from './MapIndexView'
import ExpertView from './ExpertView'
import ExperienceView from './ExperienceView'
import AgentMemoryView from './AgentMemoryView'

const tabs = [
  { id: 'database', label: '资料库' },
  { id: 'map-index', label: '地图索引' },
  { id: 'expert', label: '专家' },
  { id: 'experience', label: '经验' },
  { id: 'agent-memory', label: '智能体记忆' }
] as const

const KnowledgePanel: React.FC = () => {
  const { activeTab, setActiveTab } = useKnowledgeStore()

  const renderTabContent = () => {
    switch (activeTab) {
      case 'database':
        return <DatabaseView />
      case 'map-index':
        return <MapIndexView />
      case 'expert':
        return <ExpertView />
      case 'experience':
        return <ExperienceView />
      case 'agent-memory':
        return <AgentMemoryView />
      default:
        return null
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white rounded-lg shadow-sm border border-gray-200">
      {/* Tabs */}
      <div className="flex border-b border-gray-200 px-4">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'text-blue-600 border-blue-500'
                : 'text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-4">
        {renderTabContent()}
      </div>
    </div>
  )
}

export default KnowledgePanel
```

#### 3.2.8 AgentCreatePage / AgentConfigForm（智能体创建/配置表单）

```tsx
// src/renderer/src/components/agent/AgentConfigForm.tsx
import React, { useState, useEffect } from 'react'
import { useAgentStore } from '../../stores/agentStore'
import { useUIStore } from '../../stores/uiStore'
import BasicInfoSection from './sections/BasicInfoSection'
import IdentitySection from './sections/IdentitySection'
import ToolConfigSection from './sections/ToolConfigSection'
import MemoryConfigSection from './sections/MemoryConfigSection'
import ExecutionRulesSection from './sections/ExecutionRulesSection'
import QQBindSection from './sections/QQBindSection'
import ScheduleSection from './sections/ScheduleSection'
import type { AgentConfig } from '../../lib/types'

interface Props {
  agentId?: string  // 如果提供则为编辑模式
}

const AgentConfigForm: React.FC<Props> = ({ agentId }) => {
  const { createAgent, updateAgent, fetchAgent, currentAgent } = useAgentStore()
  const { setLayoutMode } = useUIStore()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<AgentConfig>({
    name: '',
    identity: { selectedFragments: [] },
    tools: { categorySelection: {} },
    memory: { mode: 'both' },
    executionRules: [],
    qqBinding: { enabled: false },
    schedule: { mode: 'always' }
  })

  const isEditing = !!agentId

  // 编辑模式加载数据
  useEffect(() => {
    if (agentId) {
      fetchAgent(agentId)
    }
  }, [agentId])

  useEffect(() => {
    if (isEditing && currentAgent) {
      setForm(currentAgent)
    }
  }, [currentAgent, isEditing])

  const handleSave = async () => {
    setSaving(true)
    try {
      if (isEditing && agentId) {
        await updateAgent(agentId, form)
      } else {
        await createAgent(form)
      }
      // 创建成功后跳转到智能体实例视图
      if (!isEditing) {
        setLayoutMode('agent-view')
      }
    } finally {
      setSaving(false)
    }
  }

  const updateField = <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) => {
    setForm(f => ({ ...f, [key]: value }))
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-700">
          {isEditing ? '编辑智能体' : '创建新智能体'}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => setLayoutMode(isEditing ? 'agent-view' : 'nav-view')}
            className="px-4 py-1.5 text-xs font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.name.trim()}
            className="px-4 py-1.5 text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-md transition-colors disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      <BasicInfoSection name={form.name} skinData={form.skinData} onChange={(name, skinData) => {
        setForm(f => ({ ...f, name, skinData }))
      }} />

      <IdentitySection
        selectedFragments={form.identity.selectedFragments}
        customPrompt={form.identity.customPrompt}
        onChange={identity => updateField('identity', identity)}
      />

      <ToolConfigSection
        selection={form.tools.categorySelection}
        onChange={selection => updateField('tools', { ...form.tools, categorySelection: selection })}
      />

      <MemoryConfigSection
        mode={form.memory.mode}
        onChange={mode => updateField('memory', { ...form.memory, mode })}
      />

      <ExecutionRulesSection
        rules={form.executionRules}
        onChange={rules => updateField('executionRules', rules)}
      />

      <QQBindSection
        binding={form.qqBinding}
        onChange={binding => updateField('qqBinding', binding)}
      />

      <ScheduleSection
        schedule={form.schedule}
        onChange={schedule => updateField('schedule', schedule)}
      />
    </div>
  )
}

export default AgentConfigForm
```

```tsx
// src/renderer/src/components/agent/AgentCreatePage.tsx
import React from 'react'
import AgentConfigForm from './AgentConfigForm'

const AgentCreatePage: React.FC = () => {
  return (
    <div className="flex-1 overflow-y-auto bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <AgentConfigForm />
    </div>
  )
}

export default AgentCreatePage
```

### 3.3 Zustand Store 实现

#### 3.3.1 uiStore

```typescript
// src/renderer/src/stores/uiStore.ts
import { create } from 'zustand'
import type { LayoutMode, NavPanelType, AgentViewTab } from '../lib/types'

interface UIState {
  layoutMode: LayoutMode
  activeNav: NavPanelType
  agentViewTab: AgentViewTab

  // 派生属性
  showRightSidebar: boolean

  // Actions
  setLayoutMode: (mode: LayoutMode) => void
  setActiveNav: (nav: NavPanelType) => void
  setAgentViewTab: (tab: AgentViewTab) => void
  navigateToAgent: (agentId: string) => void
  navigateToCreate: () => void
}

export const useUIStore = create<UIState>((set, get) => ({
  layoutMode: 'nav-view',
  activeNav: 'dashboard',
  agentViewTab: 'info',

  get showRightSidebar() {
    return get().layoutMode === 'agent-view'
  },

  setLayoutMode: (mode) => set({ layoutMode: mode }),

  setActiveNav: (nav) => set({ activeNav: nav }),

  setAgentViewTab: (tab) => set({ agentViewTab: tab }),

  navigateToAgent: (agentId) => {
    set({
      layoutMode: 'agent-view',
      agentViewTab: 'info'
    })
    // 同时设置 agentStore 的 currentAgentId
    const { useAgentStore } = require('./agentStore')
    useAgentStore.getState().setCurrentAgentId(agentId)
  },

  navigateToCreate: () => set({ layoutMode: 'agent-create' })
}))
```

#### 3.3.2 agentStore

```typescript
// src/renderer/src/stores/agentStore.ts
import { create } from 'zustand'
import type { AgentSummary, AgentConfig } from '../lib/types'

interface AgentState {
  agents: AgentSummary[]
  currentAgentId: string | null
  currentAgent: AgentConfig | null
  loading: boolean

  setCurrentAgentId: (id: string | null) => void
  refreshAgents: () => Promise<void>
  fetchAgent: (id: string) => Promise<void>
  createAgent: (config: AgentConfig) => Promise<string>
  updateAgent: (id: string, config: Partial<AgentConfig>) => Promise<void>
  deleteAgent: (id: string) => Promise<void>
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  currentAgentId: null,
  currentAgent: null,
  loading: false,

  setCurrentAgentId: (id) => set({ currentAgentId: id }),

  refreshAgents: async () => {
    const list = await window.electronAPI.invoke('agent:list') as AgentSummary[]
    set({ agents: list })
  },

  fetchAgent: async (id) => {
    set({ loading: true })
    const config = await window.electronAPI.invoke('agent:get', { id }) as AgentConfig
    set({ currentAgent: config, loading: false })
  },

  createAgent: async (config) => {
    const result = await window.electronAPI.invoke('agent:create', config) as { id: string; success: boolean }
    if (result.success) {
      await get().refreshAgents()
      set({ currentAgentId: result.id })
    }
    return result.id
  },

  updateAgent: async (id, config) => {
    await window.electronAPI.invoke('agent:update', { id, config })
    await get().fetchAgent(id)
  },

  deleteAgent: async (id) => {
    await window.electronAPI.invoke('agent:delete', { id })
    const { currentAgentId } = get()
    set({
      currentAgentId: currentAgentId === id ? null : currentAgentId
    })
    await get().refreshAgents()
  }
}))
```

#### 3.3.3 dashboardStore

```typescript
// src/renderer/src/stores/dashboardStore.ts
import { create } from 'zustand'
import type { DashboardStats, DailyUsage, ActivityData } from '../lib/types'

interface DashboardState {
  stats: DashboardStats | null
  dailyUsage: DailyUsage[]
  activityData: ActivityData[]
  loading: boolean

  fetchStats: () => Promise<void>
  fetchUsageHistory: (days: number) => Promise<void>
  fetchActivity: () => Promise<void>
}

const defaultStats: DashboardStats = {
  todayTokens: 0,
  monthTokens: 0,
  totalTokens: 0,
  activeConnections: 0,
  totalAgents: 0,
  onlineAgents: 0,
  providerDistribution: [],
  topModels: []
}

export const useDashboardStore = create<DashboardState>((set) => ({
  stats: defaultStats,
  dailyUsage: [],
  activityData: [],
  loading: false,

  fetchStats: async () => {
    set({ loading: true })
    const stats = await window.electronAPI.invoke('dashboard:stats') as DashboardStats
    set({ stats, loading: false })
  },

  fetchUsageHistory: async (days) => {
    const data = await window.electronAPI.invoke('dashboard:usage-history', { days }) as DailyUsage[]
    set({ dailyUsage: data })
  },

  fetchActivity: async () => {
    const data = await window.electronAPI.invoke('dashboard:agent-activity') as ActivityData[]
    set({ activityData: data })
  }
}))
```

### 3.4 IPC 封装扩展

```typescript
// src/renderer/src/lib/ipc.ts (新增 API)

/** IPC 调用封装 - 仪表盘 */
export const dashboardApi = {
  stats: () =>
    window.electronAPI.invoke('dashboard:stats') as Promise<DashboardStats>,

  usageHistory: (days: number) =>
    window.electronAPI.invoke('dashboard:usage-history', { days }) as Promise<DailyUsage[]>,

  agentActivity: () =>
    window.electronAPI.invoke('dashboard:agent-activity') as Promise<ActivityData[]>
}

/** IPC 调用封装 - 智能体 */
export const agentApi = {
  list: () =>
    window.electronAPI.invoke('agent:list') as Promise<AgentSummary[]>,

  get: (id: string) =>
    window.electronAPI.invoke('agent:get', { id }) as Promise<AgentConfig | null>,

  create: (config: AgentConfig) =>
    window.electronAPI.invoke('agent:create', config) as Promise<{ id: string; success: boolean }>,

  update: (id: string, config: Partial<AgentConfig>) =>
    window.electronAPI.invoke('agent:update', { id, config }) as Promise<{ success: boolean }>,

  delete: (id: string) =>
    window.electronAPI.invoke('agent:delete', { id }) as Promise<{ success: boolean }>
}

/** IPC 调用封装 - 模型管理 */
export const modelApi = {
  list: () =>
    window.electronAPI.invoke('model:list') as Promise<ModelConfig[]>,

  add: (config: ModelConfig) =>
    window.electronAPI.invoke('model:add', config) as Promise<{ success: boolean }>,

  remove: (id: string) =>
    window.electronAPI.invoke('model:remove', { id }) as Promise<{ success: boolean }>,

  update: (id: string, config: Partial<ModelConfig>) =>
    window.electronAPI.invoke('model:update', { id, config }) as Promise<{ success: boolean }>
}
```

### 3.5 前置条件与依赖

| 依赖项 | 说明 | 状态 |
|--------|------|:----:|
| V7 UI 骨架 | AppLayout、LeftSidebar、RightSidebar、StatusBar、ChatPanel | ✅ 已有 |
| V7 IPC 通信 | window.electronAPI.invoke/on 机制 | ✅ 已有 |
| V5 提示词片段 | 预设提示词注册机制（用于 IdentitySection） | ✅ 已有 |
| V6 ProviderRegistry | Provider/Model 注册管理（用于 ModelPanel） | ✅ 已有 |
| V6 UsageTracker | Token 用量追踪（用于 Dashboard） | ✅ 已有 |
| V3 WorkspaceManager | 工作区管理（智能体与工作区绑定） | ✅ 已有 |

### 3.6 边界情况处理

| 场景 | 处理方式 |
|------|----------|
| 仪表盘数据为空 | 显示 0 值卡片 + "暂无数据"图表占位 |
| 模型列表为空 | 显示"暂无模型配置，点击添加模型开始配置"引导 |
| 智能体列表为空 | 显示"暂无智能体，点击 + 创建"引导 |
| 智能体创建中切换导航 | 提示"当前有未保存的配置，确认离开？" |
| 快速切换导航面板 | 立即隐藏右侧栏，不产生闪烁 |
| 智能体实例配置 Tab 修改 | 点击保存后跳转到信息 Tab 查看效果 |
| 皮肤上传格式错误 | 仅允许 .png，错误时提示"请上传 PNG 格式图片" |
| 执行规则同步到模组失败 | 保存时显示"规则已保存，但同步失败，将稍后重试" |
| 删除已绑定工作区的智能体 | 警告"该智能体有活跃连接，断开后删除？" |

***

## 第四部分：性能目标

| 指标 | 目标 | 测量方式 |
|------|------|----------|
| 面板切换 | < 100ms（导航/实例/创建 切换） | React DevTools Profiler |
| 右侧栏显隐 | 无闪烁，过渡平滑 | 视觉检查 |
| 仪表盘图表渲染 | < 300ms（4 图表同时渲染） | React DevTools Profiler |
| 模型列表渲染 | < 50ms（50 个模型卡片） | React DevTools Profiler |
| 智能体创建表单 | < 200ms（表单渲染） | React DevTools Profiler |
| 仪表盘数据加载 | < 500ms（含 IPC 请求） | 计时日志 |

***

## 第五部分：附录

### 5.1 新增/修改文件清单

#### 新增文件

| 文件路径 | 用途 |
|----------|------|
| `src/main/ipc/dashboard-handler.ts` | 仪表盘 IPC Handler |
| `src/main/ipc/agent-handler.ts` | 智能体 IPC Handler + AgentConfigManager |
| `src/main/ipc/model-handler.ts` | 模型管理 IPC Handler |
| `src/renderer/src/components/dashboard/DashboardPanel.tsx` | 仪表盘容器 |
| `src/renderer/src/components/dashboard/TokenSummaryCards.tsx` | Token 数字卡片 |
| `src/renderer/src/components/dashboard/TokenTrendChart.tsx` | Token 日趋势图 |
| `src/renderer/src/components/dashboard/ProviderPieChart.tsx` | Provider 分布饼图 |
| `src/renderer/src/components/dashboard/ModelRanking.tsx` | 模型调用排行 |
| `src/renderer/src/components/dashboard/ActivityHeatmap.tsx` | 活跃时段热力图 |
| `src/renderer/src/components/model/ModelPanel.tsx` | 模型配置容器 |
| `src/renderer/src/components/model/ModelList.tsx` | 模型列表 |
| `src/renderer/src/components/model/ModelCard.tsx` | 模型卡片（设置/删除） |
| `src/renderer/src/components/model/ModelAddForm.tsx` | 添加模型表单 |
| `src/renderer/src/components/knowledge/KnowledgePanel.tsx` | 知识与技能容器 |
| `src/renderer/src/components/knowledge/KnowledgeTabs.tsx` | Tabs 切换 |
| `src/renderer/src/components/knowledge/DatabaseView.tsx` | 资料库视图 |
| `src/renderer/src/components/knowledge/MapIndexView.tsx` | 地图索引视图 |
| `src/renderer/src/components/knowledge/ExpertView.tsx` | 专家视图 |
| `src/renderer/src/components/knowledge/ExperienceView.tsx` | 经验视图 |
| `src/renderer/src/components/knowledge/AgentMemoryView.tsx` | 智能体记忆视图 |
| `src/renderer/src/components/agent/AgentInstanceView.tsx` | 智能体实例视图（三栏） |
| `src/renderer/src/components/agent/AgentCreatePage.tsx` | 智能体创建全页 |
| `src/renderer/src/components/agent/AgentConfigForm.tsx` | 智能体配置表单（复用） |
| `src/renderer/src/components/agent/sections/BasicInfoSection.tsx` | 基本信息 |
| `src/renderer/src/components/agent/sections/IdentitySection.tsx` | 身份/提示词 |
| `src/renderer/src/components/agent/sections/ToolConfigSection.tsx` | 工具配置 |
| `src/renderer/src/components/agent/sections/MemoryConfigSection.tsx` | 记忆配置 |
| `src/renderer/src/components/agent/sections/ExecutionRulesSection.tsx` | 执行规则 |
| `src/renderer/src/components/agent/sections/QQBindSection.tsx` | QQ 绑定 |
| `src/renderer/src/components/agent/sections/ScheduleSection.tsx` | 启用时间 |
| `src/renderer/src/stores/uiStore.ts` | UI 布局状态 |
| `src/renderer/src/stores/dashboardStore.ts` | 仪表盘数据 |
| `src/renderer/src/stores/modelStore.ts` | 模型配置 |
| `src/renderer/src/stores/knowledgeStore.ts` | 知识与技能 |
| `src/renderer/src/stores/agentStore.ts` | 智能体管理 |
| `src/renderer/src/hooks/useDashboard.ts` | 仪表盘 Hook |
| `src/renderer/src/hooks/useModelConfig.ts` | 模型配置 Hook |
| `src/renderer/src/hooks/useKnowledge.ts` | 知识与技能 Hook |
| `src/renderer/src/hooks/useAgent.ts` | 智能体管理 Hook |

#### 修改文件

| 文件路径 | 修改内容 |
|----------|----------|
| `src/main/ipc/index.ts` | 注册 dashboard/agent/model Handler |
| `src/renderer/src/App.tsx` | 布局模式路由 + 导航内容路由 |
| `src/renderer/src/components/layout/AppLayout.tsx` | 条件渲染 RightSidebar |
| `src/renderer/src/components/layout/LeftSidebar.tsx` | 导航 active 动态 + 智能体列表真实数据 |
| `src/renderer/src/components/layout/RightSidebar.tsx` | 仅在 agent-view 显示 |
| `src/renderer/src/components/layout/CustomTitleBar.tsx` | 简化标题栏 |
| `src/renderer/src/lib/ipc.ts` | 添加 dashboard/agent/model API |
| `src/renderer/src/lib/types.ts` | 添加 30+ 新类型定义 |

### 5.2 开发顺序建议

| 阶段 | 内容 | 产出 |
|------|------|------|
| **阶段 1** | 类型定义 + IPC 通道 | 更新 types.ts，新建 3 个 IPC Handler，更新 ipc.ts |
| **阶段 2** | uiStore + 布局切换 | AppLayout 条件右侧栏，App 路由，LeftSidebar 导航联动 |
| **阶段 3** | 仪表盘图表 | TokenSummaryCards、TokenTrendChart、ProviderPieChart、ModelRanking、ActivityHeatmap |
| **阶段 4** | 模型配置面板 | ModelPanel、ModelList、ModelCard、ModelAddForm |
| **阶段 5** | 知识与技能面板 | KnowledgePanel + 5 个 Tab 视图（骨架 + 占位内容） |
| **阶段 6** | 智能体创建表单 | AgentConfigForm + 7 个 Section 组件 |
| **阶段 7** | 智能体实例视图 | AgentInstanceView（信息/配置 Tab + ChatPanel 复用） |
| **阶段 8** | 集成测试 + 边界处理 | 全链路联调、面板切换测试、空状态处理 |

### 5.3 风险与应对

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| 仪表盘 IPC 数据量大 | 首屏加载慢 | 分步加载，先渲染图表骨架，数据到达后填充 |
| 图表组件性能 | 多图表同时渲染卡顿 | 使用轻量级 SVG 图表（避免重量级库），虚拟化数据点 |
| 智能体创建表单复杂 | 7 个 Section 一次性渲染慢 | 分步渲染，折叠不活跃的 Section |
| 右侧栏显隐抖动 | 布局重排导致视觉跳动 | 使用 CSS visibility 而非 display:none，预留宽度空间 |
| 配置 Tab 与创建表单同步 | 编辑模式和创建模式的数据同步不一致 | 统一使用 AgentConfigForm 组件，通过 agentId 参数区分模式 |
