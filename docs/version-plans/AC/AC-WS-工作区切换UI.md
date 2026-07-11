# Alice Mod Core — 工作区切换 UI

> 版本：v2.0（实现版）
> 日期：2026-07-11
> 对应需求：AC-WS-05、AC-WS-06
> 关联文档：[AC-01-需求文档.md](AC-01-需求文档.md)

***

## 第一部分：需求文档

### 1.1 模块定位

工作区切换 UI 是 Agent Core 中**工作区管理**的可视化入口。它让用户能够直观地查看、切换、创建和管理与 Adapter Core 实例的连接。

每个工作区（Workspace）对应一个 Adapter Core 实例（BE/JE 模组）的会话抽象，包含独立的连接状态、工具列表、对话历史和记忆上下文。

**核心职责**：

| 职责 | 说明 |
|------|------|
| **工作区列表** | 展示所有已导入的实例，以列表形式呈现名称、头像、游戏版本等信息 |
| **工作区切换** | 点击切换当前激活的工作区，更新所有面板上下文（对话、状态、记忆等） |
| **新建工作区** | 通过系统文件选择器选择 JSON 文件 → 校验 → 确认弹窗（编辑名称/选择图标）三步完成 |
| **工作区管理** | 支持重命名、删除、自定义图标、打开文件目录等管理操作 |
| **状态监控** | 实时显示各工作区的在线/离线/连接中状态 |

### 1.2 与智能体（Agent）管理的关系

工作区切换 UI 是 Agent Core 的**顶层导航入口**，位于自定义标题栏（CustomTitleBar）左侧，以 HeroUI Dropdown 下拉菜单形式呈现。

| 概念 | 范围 | 说明 |
|------|------|------|
| **工作区（Workspace）** | 连接层 | TCP 连接 + 工具注册 + 会话隔离，每个 Adapter Core 实例一个工作区 |
| **智能体（Agent）** | 应用层 | 基于工作区之上的 LLM 角色配置，包含身份/提示词/工具/记忆等配置 |
| **工作区切换 UI** | 连接管理 | 位于标题栏左侧的 Dropdown 下拉菜单，负责工作区的导入（JSON 选择）、切换、状态监控 |

### 1.3 功能需求列表

| 需求 ID | 需求名称 | 优先级 | 状态 |
|---------|----------|:------:|:----:|
| AC-WS-05-01 | 工作区列表展示 | P0 | 已实现 |
| AC-WS-05-02 | 工作区切换 | P0 | 已实现 |
| AC-WS-05-03 | 新建工作区（JSON 文件导入） | P0 | 已实现 |
| AC-WS-05-04 | 工作区管理（删除/重命名/自定义图标/打开目录） | P1 | 已实现 |
| AC-WS-05-05 | 工作区状态实时同步 | P0 | 已实现 |
| AC-WS-06 | 工作区数据持久化（状态保存/恢复） | P1 | 已实现 |

#### AC-WS-05-01 工作区列表展示

| 子需求 | 说明 |
|--------|------|
| 列表区域 | 标题栏 Dropdown 下拉菜单中展示所有已导入的工作区 |
| 标题栏入口 | 左侧显示 "Alice" 文字 + 当前工作区名称 + 状态圆点 + ▾ 展开箭头 |
| 名称显示 | 显示工作区名称（来自实例 JSON 的 name 字段，可修改） |
| 头像 | 首字母自动生成彩色圆头像（8 种颜色轮换），或用户自定义图标 |
| 游戏版本 | 显示版本标识 + 版本号（如 "BE 1.26.10"、"JE 1.21"） |
| 状态圆点 | 绿色=在线、黄色=连接中、灰色=离线，标题栏和列表中一致 |
| 空状态 | 无工作区时仅显示 "未选择工作区" |
| 条目操作 | 每项右侧 hover 显示操作图标（打开目录/删除），带 tooltip |

#### AC-WS-05-02 工作区切换

| 子需求 | 说明 |
|--------|------|
| 下拉选择 | 展开 Dropdown，点击工作区列表项切换当前激活的工作区 |
| 标题栏同步 | 切换后标题栏左侧更新为当前工作区名称和状态 |
| 上下文更新 | 切换时触发 `workspace:changed` 事件，各面板监听后更新对话历史/游戏状态等 |

#### AC-WS-05-03 新建工作区（JSON 文件导入）

新建工作区采用**一步式流程**，无弹窗表单：

| 步骤 | 说明 |
|------|------|
| 触发 | 点击 Dropdown 顶部 "连接 Alice Mod" 条目 |
| 文件选择 | Electron 原生文件对话框（`dialog.showOpenDialog`），过滤 `.json` |
| 文件校验 | 后端自动处理 3 种格式：标准 `instances[]` / BE 插件扁平格式 / 协议文档格式 |
| 格式校验失败 | `toast.danger` 显示具体错误原因 |
| 格式校验成功 | 弹出**确认弹窗**：显示待创建实例的图标（版型默认图标）、可编辑名称、配置文件路径（只读） |
| 图标选择 | 点击弹窗中的图标区域，弹出图片选择器，自动居中裁剪 128×128 |
| 重复导入检测 | 若 JSON 中的 `instance_id` 已存在，弹窗显示黄色警告 "实例 xxx 已存在，确认后将覆盖更新" |
| 确认创建 | 点击"确认创建"→ `workspace:create` IPC → 持久化 → 自动切换到新工作区 |
| 取消 | 关闭弹窗，无副作用 |

支持的文件格式：

| 格式 | 数据结构 | 来源 |
|------|----------|------|
| 协议标准格式 | `game_version.edition`, `tcp.host`, `auth.token` | `mcagent_instance.json`（BE 插件最新版） |
| BE 插件格式 | `game.edition`, `network.host` | `instance.json`（BE 插件旧版） |
| InstanceManager 标准格式 | `instances[]` 数组 | 后端校验器 |

#### AC-WS-05-04 工作区管理

| 子需求 | 说明 |
|--------|------|
| 删除 | 列表项 hover → 🗑 图标 → `confirm` 确认 → 删除工作区及实例配置 |
| 删除保护 | 工作区在线时无法删除，返回 `online: true`，前端弹出确认提示 |
| 自定义图标 | 列表项 hover → 📂 图标 → `shell.showItemInFolder` 打开所在目录 |
| 重命名 | 通过 `workspace:rename` IPC 修改工作区名称（未在 UI 直接暴露，Store 支持） |
| 更换图标 | 通过 `workspace:select-icon` + `workspace:update-icon` IPC 实现 |

#### AC-WS-05-05 工作区状态实时同步

| 子需求 | 说明 |
|--------|------|
| 状态推送 | 主进程通过 IPC 事件 `workspace:state-changed` 推送状态变化到渲染进程 |
| 列表更新 | 状态变化时列表中的状态圆点立即更新（Store `handleStateChange`） |
| 事件类型 | `WorkspaceEvent.StateChanged` / `Created` / `Removed` |

#### AC-WS-06 工作区数据持久化

| 子需求 | 说明 |
|--------|------|
| 实例配置持久化 | 导入的实例配置通过 `InstanceManager.save()` 持久化到 `instances.json` |
| 游戏版本持久化 | `game_version` 字段随创建流程持久化 |
| 图标持久化 | `icon_data`（base64）随创建/更新持久化 |
| 启动恢复 | Agent Core 启动时 `WorkspaceManager` 从磁盘加载已保存的工作区，列表显示离线状态 |
| 离线显示 | 即使 Adapter Core 未连接，工作区列表仍显示所有已导入的实例 |

### 1.4 界面布局设计

#### 1.4.1 标题栏布局

```
┌──────────────────────────────────────────────────────────────┐
│ Alice  [● 本地测试服 ▾]                          [─] [□] [×]│
│        ↑ WorkspaceDropdown (no-drag 区域)                    │
└──────────────────────────────────────────────────────────────┘
```

- 左侧："Alice" 文字（静态）
- 中间-左侧：`[● 工作区名称 ▾]` — Dropdown Trigger，区域设置 `no-drag` 避免与窗口拖拽冲突
- 右侧：窗口控制按钮

#### 1.4.2 Dropdown 下拉菜单

```
┌────────────────────────────────┐
│        连接 Alice Mod          │  ← 点击触发文件选择 + 校验流程
│  ────────────────────────────  │
│  已添加                         │  ← Section header
│  ┌──────────────────────────┐  │
│  │ [C] 本地测试服   BE 1.26.10│  │  ← hover 显示 📂 🗑
│  │     D:\...\instance.json  │  │  ← JSON 文件路径
│  ├──────────────────────────┤  │
│  │ [h] hads JE Server  JE 1.21│  │
│  │     D:\...\instance.json  │  │
│  └──────────────────────────┘  │
└────────────────────────────────┘
```

- 每个列表项：左(头像) + 中(名称+版本) + 右(hover 操作图标)
- 头像：自定义图标优先（base64 image）→ 首字母彩色圆形 fallback（8 色哈希）
- 版本：`WorkspaceItem.gameVersion` 显示，如 "BE 1.26.10"

#### 1.4.3 确认创建弹窗

```
┌─────────────────────────┐
│  确认创建                │
│  ┌───────────────────┐  │
│  │ [⛏️]  [实例名称____]│  │  ← 可点击换图标
│  │ 配置文件路径(只读)   │  │
│  │ ⚠ 已存在将覆盖更新  │  │  ← 重复时显示
│  └───────────────────┘  │
│  [取消]   [确认创建]     │
└─────────────────────────┘
```

### 1.5 验收标准

| # | 验收条件 | 验证方法 |
|---|----------|----------|
| 5.1 | 标题栏工作区入口 | 启动 Agent Core，查看标题栏左侧是否显示 "Alice [● 名称 ▾]" |
| 5.2 | Dropdown 展开 | 点击标题栏工作区按钮，Dropdown 展开，显示 "连接 Alice Mod" + "已添加" 列表 |
| 5.3 | 工作区切换 | 点击 Dropdown 中的工作区，标题栏按钮更新为新工作区名称 |
| 5.4 | 文件选择流程 | 点击"连接 Alice Mod"，系统文件选择器弹出，过滤 `.json` |
| 5.5 | 校验失败 | 选择无效 JSON，`toast.danger` 显示错误，无弹窗 |
| 5.6 | 校验成功 + 确认弹窗 | 选择有效 JSON，弹出确认弹窗，名称可编辑，路径只读 |
| 5.7 | 图标选择 | 确认弹窗点击图标区域，图片选择器弹出，支持 png/jpg/gif/webp |
| 5.8 | 重复检测 | 选择已导入实例的 JSON，弹窗显示黄色重复警告 |
| 5.9 | 创建成功 | 确认创建后，Dropdown 刷新显示新工作区，标题栏自动切换到新工作区 |
| 5.10 | 删除工作区 | 列表项 hover → 🗑 点击 → confirm 确认 → 工作区从列表移除 |
| 5.11 | 打开文件目录 | 列表项 hover → 📂 点击 → 系统文件管理器打开 JSON 所在目录 |
| 5.12 | 状态实时同步 | Adapter Core 连接/断开，Dropdown 中状态圆点即时更新 |
| 5.13 | 启动恢复 | 重启应用后工作区列表恢复，显示离线状态 |
| 5.14 | 标题栏拖拽不冲突 | 点击 Dropdown 按钮不触发窗口拖拽 |

***

## 第二部分：架构文档

### 2.1 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                    工作区切换 UI 模块                               │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                    渲染进程 (Renderer)                      │    │
│  │                                                          │    │
│  │  CustomTitleBar                                           │    │
│  │  ┌─────────────────────────────────────────────┐         │    │
│  │  │ [Alice] [WorkspaceDropdown ▾]               │         │    │
│  │  │         ┌─────────────────────────────┐    │         │    │
│  │  │         │ 连接 Alice Mod              │    │         │    │
│  │  │         │─────────                    │    │         │    │
│  │  │         │已添加                        │    │         │    │
│  │  │         │[C] 本地测试服  BE 1.26 📂 🗑│    │         │    │
│  │  │         └─────────────────────────────┘    │         │    │
│  │  └─────────────────────────────────────────────┘         │    │
│  │                                                          │    │
│  │  WorkspaceConfirmDialog (独立弹窗)                         │    │
│  │  ┌─────────────────────────────┐                         │    │
│  │  │ 确认创建 [⛏️] [名称___]    │                         │    │
│  │  │ ⚠ 重复警告                   │                         │    │
│  │  │ [取消] [确认创建]            │                         │    │
│  │  └─────────────────────────────┘                         │    │
│  │                                                          │    │
│  │  workspaceStore (Zustand)                                │    │
│  │  ┌─────────────────────────────┐                         │    │
│  │  │ workspaces: WorkspaceItem[] │                         │    │
│  │  │ currentWorkspaceId          │                         │    │
│  │  │ pendingValidation           │                         │    │
│  │  └──────────────┬──────────────┘                         │    │
│  │                 │ invoke/on                               │    │
│  │  ┌──────────────▼──────────────┐                         │    │
│  │  │      IPC Bridge Layer       │                         │    │
│  │  │  workspaceApi               │                         │    │
│  │  └──────────────┬──────────────┘                         │    │
│  │                 │ IPC                                     │    │
│  │  ┌──────────────┼──────────────────────────────────┐     │    │
│  │  │         主进程 (Main)                            │     │    │
│  │  │               ▼                                 │     │    │
│  │  │  workspace-handler.ts                           │     │    │
│  │  │  ┌────────────────────────────────────────┐     │     │    │
│  │  │  │ list / select-file / validate-file      │     │     │    │
│  │  │  │ create / rename / remove                │     │     │    │
│  │  │  │ open-in-explorer / select-icon /        │     │     │    │
│  │  │  │ update-icon                             │     │     │    │
│  │  │  │ + 事件推送 (StateChanged/Created/       │     │     │    │
│  │  │  │   Removed)                              │     │     │    │
│  │  │  └────────────────┬───────────────────────┘     │     │    │
│  │  │                   │                             │     │    │
│  │  │  ┌────────────────▼───────────────────────┐     │     │    │
│  │  │  │ 业务服务层                               │     │     │    │
│  │  │  │ WorkspaceManager · InstanceManager      │     │     │    │
│  │  │  │ shell.showItemInFolder · nativeImage    │     │     │    │
│  │  │  └────────────────────────────────────────┘     │     │    │
│  │  └─────────────────────────────────────────────────┘     │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 IPC 通信协议

#### 2.2.1 Channel 定义

| Channel | 方向 | 用途 | 请求参数 | 返回值 |
|---------|:----:|------|----------|--------|
| `workspace:list` | R→M | 获取工作区列表 | `{}` | `WorkspaceListItem[]` |
| `workspace:select-file` | R→M | 打开原生文件选择器 | — | `{ filePath: string \| null }` |
| `workspace:validate-file` | R→M | 校验 JSON 文件 | `{ filePath }` | `FileValidationResult` |
| `workspace:create` | R→M | 导入 JSON 并创建工作区 | `{ filePath, name?, iconData? }` | `{ success, id?, error? }` |
| `workspace:rename` | R→M | 重命名工作区 | `{ id, name }` | `{ success }` |
| `workspace:remove` | R→M | 删除工作区及实例 | `{ id, force? }` | `{ success, online?, message? }` |
| `workspace:open-in-explorer` | R→M | 在文件管理器中打开目录 | `{ filePath }` | `{ success }` |
| `workspace:select-icon` | R→M | 选择图片并裁剪 128×128 | — | `{ iconData: string \| null, error? }` |
| `workspace:update-icon` | R→M | 更新工作区图标 | `{ id, iconData? }` | `{ success }` |

#### 2.2.2 事件推送

| Channel | 方向 | 用途 | 推送数据 |
|---------|:----:|------|----------|
| `workspace:state-changed` | M→R | 工作区状态变化 | `{ id, state, oldState?, timestamp }` |
| `workspace:created` | M→R | 工作区创建 | `{ id, instanceId, timestamp }` |
| `workspace:removed` | M→R | 工作区删除 | `{ id, timestamp }` |

### 2.3 新增类型定义

```typescript
// ==========================================
// 工作区切换 UI 类型定义
// ==========================================

/** 工作区列表项（UI 展示用） */
export interface WorkspaceItem {
  id: string
  name: string
  alias?: string
  state: 'online' | 'offline' | 'connecting'
  edition: 'bedrock' | 'java'
  host: string
  port: number
  toolCount: number
  filePath?: string              // mcagent_instance.json 文件路径
  gameVersion?: string           // 游戏版本号，如 "1.26.10"
  iconData?: string              // 自定义图标 base64 data URL
  protocolVersion?: string
  modVersion?: string
  description?: string
  tags?: string[]
  lastActiveAt?: number
  createdAt: number
}

/** 新建工作区 — 文件校验结果 */
export interface WorkspaceFileValidation {
  valid: boolean
  errors: string[]
  instance?: {
    instanceId: string
    name: string
    edition: 'bedrock' | 'java'
    host: string
    port: number
    authToken: string
    filePath?: string
    gameVersion?: string
    description?: string
    tags?: string[]
  }
  isDuplicate?: boolean        // 该实例是否已存在
  duplicateName?: string       // 已存在的实例名称
}

/** 新建工作区 — 创建参数 */
export interface WorkspaceCreateParams {
  filePath: string
  name?: string
  iconData?: string
  alias?: string
  description?: string
  tags?: string[]
}

/** 后端 IPC 响应 — 文件校验结果 */
interface FileValidationResult {
  valid: boolean
  errors: string[]
  instance?: {
    instanceId: string
    name: string
    edition: 'bedrock' | 'java'
    host: string
    port: number
    authToken: string
    filePath?: string
    gameVersion?: string
    description?: string
    tags?: string[]
  }
  isDuplicate?: boolean
  duplicateName?: string
}

/** 后端 IPC 响应 — 工作区列表项 */
interface WorkspaceListItem {
  id: string
  name: string
  state: 'online' | 'offline' | 'connecting'
  edition: 'bedrock' | 'java'
  host: string
  port: number
  toolCount: number
  filePath?: string
  gameVersion?: string
  iconData?: string
  description?: string
  tags?: string[]
  lastActiveAt?: number
  createdAt: number
}

/** 待确认的校验结果（Zustand Store 状态） */
interface PendingValidation {
  instanceId: string
  name: string
  edition: 'bedrock' | 'java'
  host: string
  port: number
  authToken: string
  filePath: string
  gameVersion?: string
  isDuplicate: boolean
  duplicateName?: string
}
```

### 2.4 前端组件架构

#### 2.4.1 目录结构

```
packages/agent-core/src/renderer/src/
├── components/
│   ├── workspace/                         ← 新增: 工作区切换
│   │   ├── WorkspaceDropdown.tsx          # 标题栏 Dropdown 切换器（核心组件）
│   │   └── WorkspaceConfirmDialog.tsx     # 创建确认弹窗
│   │
│   └── layout/
│       └── CustomTitleBar.tsx             ← 修改: 嵌入 WorkspaceDropdown
│
├── stores/
│   └── workspaceStore.ts                  ← 新增: 工作区状态管理
│
└── lib/
    ├── ipc.ts                             ← 修改: 添加 workspace API
    └── types.ts                           ← 修改: 添加 WorkspaceItem 等类型
```

#### 2.4.2 核心组件关系

```
CustomTitleBar
├── 左侧: "Alice" 文字（静态）
├── 左侧-中部: WorkspaceDropdown (no-drag)
│   └── HeroUI Dropdown
│       ├── Dropdown.Trigger
│       │   └── [状态圆点] [名称 ▾]
│       └── Dropdown.Popover → Dropdown.Menu
│           ├── "连接 Alice Mod" (onAction → selectAndValidate)
│           │   弹出系统文件选择器 → 校验 → 成功则显示确认弹窗
│           ├── Separator
│           └── Section "已添加"
│               └── Dropdown.Item × N
│                   ├── 头像 (iconData img / 首字母彩色圆)
│                   ├── 名称 + 游戏版本 (BE 1.26.10)
│                   └── hover: [FolderOpen] [Trash2] (操作图标)
│
└── 右侧: 窗口控制按钮

WorkspaceConfirmDialog (独立 Modal，不依赖 Dropdown)
├── 图标区域（可点击 → selectIcon IPC 选择图片）
├── 名称输入（可编辑）
├── 文件路径（只读）
├── 重复警告（条件渲染）
└── 底部按钮 [取消] [确认创建]
```

### 2.5 状态管理方案

#### workspaceStore 数据结构

```typescript
interface PendingValidation {
  instanceId: string
  name: string
  edition: 'bedrock' | 'java'
  host: string
  port: number
  authToken: string
  filePath: string
  gameVersion?: string
  isDuplicate: boolean
  duplicateName?: string
}

interface WorkspaceState {
  // 数据
  workspaces: WorkspaceItem[]
  currentWorkspaceId: string | null
  loading: boolean

  // 确认弹窗
  pendingValidation: PendingValidation | null
  createStep: string  // @deprecated 兼容旧版

  // Actions: 列表
  refreshWorkspaces: () => Promise<void>
  setCurrentWorkspace: (id: string) => void

  // Actions: 创建流程
  selectAndValidate: () => Promise<void>    // 选择文件 → 校验 → 存入 pendingValidation
  confirmCreate: (name: string, iconData?: string) => Promise<void>  // 确认创建
  cancelCreate: () => void                  // 取消

  // Actions: 管理
  renameWorkspace: (id: string, name: string) => Promise<void>
  removeWorkspace: (id: string, force?: boolean) => Promise<void>
  openInExplorer: (filePath: string) => Promise<void>
  selectAndSetIcon: (id: string) => Promise<void>

  // Actions: 事件
  handleStateChange: (event: { id: string; state: string }) => void
}
```

#### IPC 封装 (workspaceApi)

```typescript
export const workspaceApi = {
  list: () => window.electronAPI.invoke('workspace:list') as Promise<WorkspaceItem[]>,
  selectFile: () => window.electronAPI.invoke('workspace:select-file') as Promise<{ filePath: string | null }>,
  validateFile: (filePath: string) => window.electronAPI.invoke('workspace:validate-file', { filePath }) as Promise<WorkspaceFileValidation>,
  create: (params: WorkspaceCreateParams) => window.electronAPI.invoke('workspace:create', params) as Promise<{ success: boolean; id?: string; error?: string }>,
  rename: (id: string, name: string) => window.electronAPI.invoke('workspace:rename', { id, name }) as Promise<{ success: boolean }>,
  remove: (id: string, force?: boolean) => window.electronAPI.invoke('workspace:remove', { id, force }) as Promise<{ success: boolean; online?: boolean; message?: string }>,
  openInExplorer: (filePath: string) => window.electronAPI.invoke('workspace:open-in-explorer', { filePath }) as Promise<{ success: boolean }>,
  selectIcon: () => window.electronAPI.invoke('workspace:select-icon') as Promise<{ iconData: string | null; error?: string }>,
  updateIcon: (id: string, iconData?: string) => window.electronAPI.invoke('workspace:update-icon', { id, iconData }) as Promise<{ success: boolean }>,
}
```

### 2.6 新建工作区详细流程

```
用户点击 "连接 Alice Mod"
    │
    ▼
workspaceApi.selectFile()
    │
    ├── 用户取消 → 结束（返回 idle）
    │
    └── 用户选择 JSON 文件
        │
        ▼
    workspaceApi.validateFile(filePath)
        │
        ├── 后端: importFromFileWithFallback(filePath)
        │   │
        │   ├── 尝试 instanceManager.importFromFile()   → 标准格式
        │   ├── 失败 → 尝试 parseBEPluginFile()          → BE 插件格式
        │   ├── 失败 → 返回合并错误                       → 协议文档格式
        │   │
        │   └── 成功 → 检查 instance_id 是否已存在 (isDuplicate)
        │
        ├── 校验失败 → toast.danger() 显示错误 → 结束
        │
        └── 校验成功 → set({ pendingValidation })
            │
            ▼
        弹出 WorkspaceConfirmDialog
            │
            ├── 显示: 默认图标 / 可编辑名称 / 文件路径(只读)
            ├── 若 isDuplicate: 显示黄色重复警告
            │
            ├── 用户点击图标区域 → selectIcon IPC + nativeImage 裁剪 128×128
            │
            ├── 用户点击 "取消" → set({ pendingValidation: null })
            │
            └── 用户点击 "确认创建"
                │
                ▼
            workspaceApi.create({ filePath, name, iconData })
                │
                ├── 后端: instanceManager.update()    → 持久化
                ├── 后端: workspaceManager.createWorkspace() → 创建工作区
                │
                ├── 失败 → 弹窗内显示错误
                │
                └── 成功 → refreshWorkspaces() + 自动切换到新工作区
                    └── set({ pendingValidation: null })
```

### 2.7 多格式兼容

```typescript
// BE 插件旧格式 (instance.json)
{
  "_schema_version": "1.0.0",
  "instance_id": "uuid",
  "game": { "edition": "bedrock", "version": "v1.26.10" },
  "network": { "host": "127.0.0.1", "port": 27541 }
}
// → isBEPluginFormat 检测: 有 instance_id 且无 instances[]

// 协议文档格式 (mcagent_instance.json)
{
  "schema_version": "1.0.0",
  "instance_id": "uuid",
  "instance_name": "McAgent",
  "game_version": { "edition": "bedrock", "version": "v1.26.10" },
  "tcp": { "host": "127.0.0.1", "port": 27541 },
  "auth": { "token": "mct_xxx" }
}
// → 标准格式解析失败后 fallback: isBEPluginFormat 匹配

// InstanceManager 标准格式
{ "instances": [{ "instance_id": "uuid", "name": "...", ... }] }
// → instanceManager.importFromFile() 直接处理
```

### 2.8 与已有模块的集成

| 已有模块 | 集成方式 |
|----------|----------|
| WorkspaceManager | 工作区创建/状态管理/事件推送（getWorkspaceManager 单例） |
| InstanceManager | 实例 JSON 导入/校验/持久化 + 新版统一单例管理 |
| InstanceValidator | 实例配置字段校验（validateInstance） |
| CustomTitleBar | 标题栏左侧嵌入 WorkspaceDropdown |
| ChatPanel | 工作区切换时 `workspace:changed` 事件触发对话历史切换 |
| 各面板 | 监听 `workspace:changed` 事件更新上下文 |

***

## 第三部分：执行文档

### 3.1 主进程 IPC Handler

#### 3.1.1 workspace-handler.ts

文件：[`src/main/ipc/workspace-handler.ts`](file:///d:/McAgent/packages/agent-core/src/main/ipc/workspace-handler.ts)

**IPC Channel 注册清单：**

| Handler | 核心逻辑 |
|---------|----------|
| `workspace:list` | `getWorkspaceManager().getAllWorkspaces()` + `instanceManager.getAll()` 合并 |
| `workspace:select-file` | `dialog.showOpenDialog(mainWindow, { filters: ['*.json'] })` |
| `workspace:validate-file` | `importFromFileWithFallback(filePath)` → 3 种格式尝试 → 重复检测 |
| `workspace:create` | `instanceManager.update()` + `manager.createWorkspace()` 持久化 |
| `workspace:rename` | manager.getWorkspace + 修改 name |
| `workspace:remove` | 在线保护 + manager.removeWorkspace + instanceManager.remove |
| `workspace:open-in-explorer` | `shell.showItemInFolder(filePath)` |
| `workspace:select-icon` | `nativeImage.createFromPath` → 居中裁剪 128×128 → `toDataURL()` |
| `workspace:update-icon` | instanceManager.update 写入 icon_data |

**事件推送：**

```typescript
manager.on(WorkspaceEvent.StateChanged, (event) => {
  mainWindow.webContents.send('workspace:state-changed', {
    id: event.workspaceId,
    state: event.metadata?.newState,
    oldState: event.metadata?.oldState,
    timestamp: event.timestamp,
  })
})

manager.on(WorkspaceEvent.Created, (event) => {
  mainWindow.webContents.send('workspace:created', {
    id: event.workspaceId,
    instanceId: event.instanceId,
    timestamp: event.timestamp,
  })
})

manager.on(WorkspaceEvent.Removed, (event) => {
  mainWindow.webContents.send('workspace:removed', {
    id: event.workspaceId,
    timestamp: event.timestamp,
  })
})
```

**多格式解析：**

```typescript
// 优先标准格式，失败后尝试 BE 插件格式
function importFromFileWithFallback(filePath: string): ImportResult {
  const result = instanceManager.importFromFile(filePath)
  if (result.success) return result

  const beResult = parseBEPluginFile(filePath)
  if (beResult.success) return beResult

  return { success: false, instances: [], errors: [...result.errors, ...beResult.errors] }
}
```

### 3.2 前端组件实现

#### 3.2.1 WorkspaceDropdown

**HeroUI v3 Dropdown 组件，位于 CustomTitleBar 左侧。**

主要特性：
- Trigger：状态圆点 + 当前工作区名称 + ▾
- "连接 Alice Mod" 条目 → 触发 `selectAndValidate()`
- "已添加" Section → 工作区列表
- 每项：头像 + 名称 + 版本 + hover 操作图标（FolderOpen / Trash2）
- 全局 `Toast.Provider` 提供操作反馈（toast.success / toast.danger）
- 图标库：lucide-react（FolderOpen, Trash2, Pickaxe, Leaf）

头像生成逻辑：

```typescript
const avatarColors = [
  'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500',
  'bg-pink-500', 'bg-teal-500', 'bg-indigo-500', 'bg-rose-500',
]

const getAvatarColor = (name: string) => {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return avatarColors[Math.abs(hash) % avatarColors.length]
}

const getAvatarLetter = (name: string) => name.charAt(0).toUpperCase()
```

版本标签显示：

```typescript
const editionLabel: Record<string, string> = { bedrock: 'BE', java: 'JE' }

const versionLabel = (ws) => {
  if (ws.gameVersion) return `${editionLabel[ws.edition]} ${ws.gameVersion}`
  return editionLabel[ws.edition] ?? ws.edition
}
```

#### 3.2.2 WorkspaceConfirmDialog

**确认创建弹窗，使用 system-ui Modal 实现（非 HeroUI Modal）。**

状态来源：`workspaceStore.pendingValidation`

交互：
- 图标区域：点击 → `workspaceApi.selectIcon()` → nativeImage 裁剪 → 预览
- 名称输入：可编辑文本，validate 非空
- 文件路径：只读显示
- 重复警告：`isDuplicate && duplicateName` → 黄色警告块

样式：固定 `z-50`，居中 `fixed inset-0`，半透明黑色遮罩。

### 3.3 Zustand Store

**workspaceStore 是整个工作区切换的核心状态管理。**

创建流程的关键状态字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `workspaces` | `WorkspaceItem[]` | 所有工作区列表 |
| `currentWorkspaceId` | `string \| null` | 当前激活的工作区 ID |
| `pendingValidation` | `PendingValidation \| null` | 待用户确认的校验结果 |
| `loading` | `boolean` | 加载状态 |

关键 Action 实现：

**selectAndValidate** — 选择文件 → 校验 → 存入 pending：
1. 调用 `workspaceApi.selectFile()` → 用户取消则 return
2. 调用 `workspaceApi.validateFile(filePath)` → 失败则 throw
3. 检查 `isDuplicate` → 构造 PendingValidation → `set({ pendingValidation })`

**confirmCreate** — 用户确认创建：
1. 从 `pendingValidation` 读取待创建数据
2. 调用 `workspaceApi.create({ filePath, name, iconData })`
3. 失败 → throw（弹窗内显示错误）
4. 成功 → `set({ pendingValidation: null })` → `refreshWorkspaces()` → `setCurrentWorkspace(id)`

### 3.4 CustomTitleBar 修改

标题栏布局：

```
[Alice] [WorkspaceDropdown ▾]                [─] [□] [×]
├── no-drag ─┤ ├───────── 拖拽区域 ─────────├── no-drag ─┤
```

- WorkspaceDropdown 区域设置 `style={{ WebkitAppRegion: 'no-drag' }}` 避免与窗口拖拽冲突
- 中间留空区域为窗口拖拽区

### 3.5 事件监听初始化

在渲染进程入口（`main.tsx` 或 `App.tsx`）注册：

```typescript
// 启动时加载
refreshWorkspaces()

// 状态变化
window.electronAPI.on('workspace:state-changed', (event) => {
  handleStateChange(event)
})

// 创建/删除后刷新
window.electronAPI.on('workspace:created', () => refreshWorkspaces())
window.electronAPI.on('workspace:removed', () => refreshWorkspaces())
```

### 3.6 边界情况处理

| 场景 | 处理方式 |
|------|----------|
| 工作区列表为空 | 标题栏显示 "未选择工作区"，Dropdown 仅显示 "连接 Alice Mod" |
| JSON 文件校验失败 | `toast.danger` 显示错误，不弹窗 |
| 文件选择取消 | 无副作用，静默结束 |
| 重复导入同一实例 | 确认弹窗显示黄色警告 "实例 xxx 已存在，确认后将覆盖更新" |
| 删除在线工作区 | 后端返回 `{ online: true }`，前端 `confirm` 确认后 `force: true` |
| 当前工作区被删除 | `currentWorkspaceId` 置 null，下次刷新自动选第一个 |
| 保存失败（磁盘/权限） | `toast.danger` 显示后端错误消息 |
| 创建后端报错 | 弹窗内保持打开状态，底部显示红色错误文字 |
| 标题栏与 Dropdown 冲突 | Dropdown 区域 `no-drag` 分离 |

### 3.7 前置条件与依赖

| 依赖项 | 说明 | 状态 |
|--------|------|:----:|
| HeroUI v3 Dropdown | 下拉菜单组件 | ✅ |
| lucide-react | SVG 图标库（FolderOpen, Trash2, Pickaxe, Leaf） | ✅ 已安装 |
| Zustand | 状态管理 | ✅ |
| Electron IPC + dialog | 进程通信 + 原生对话框 | ✅ |
| nativeImage | 图标裁剪 128×128 | ✅ 内置 |
| shell.showItemInFolder | 打开文件目录 | ✅ 内置 |

### 3.8 测试覆盖

测试文件：[`__tests__/workspace/workspace-handler.test.ts`](file:///d:/McAgent/packages/agent-core/__tests__/workspace/workspace-handler.test.ts)

| 测试分组 | 用例数 | 覆盖内容 |
|----------|:------:|----------|
| `isBEPluginFormat` | 4 | 格式检测（BE/标准/null/非对象） |
| `extractGameVersion` | 3 | 协议格式 / BE 旧格式 / 无版本 |
| `parseNonStandardFile` | 8 | BE 格式 / 标准格式 / 协议格式 / 无 auth / JE / 无 mod_version / 非法 / 空 JSON |
| `workspace workflow` | 4 | 3 种格式完整工作流 + 真实文件集成 + 非法文件 |

### 3.9 开发顺序

| 阶段 | 内容 | 产出 |
|------|------|------|
| 1 | 类型定义 + IPC channel | types.ts, workspace-handler.ts, ipc.ts |
| 2 | workspaceStore | 列表/切换/创建流程状态管理 |
| 3 | WorkspaceDropdown | HeroUI Dropdown 组件 |
| 4 | WorkspaceConfirmDialog | 确认创建弹窗 |
| 5 | CustomTitleBar 集成 | 左侧嵌入 WorkspaceDropdown |
| 6 | 事件监听 | workspace:state-changed 实时更新 |
| 7 | 测试 | 20 用例覆盖 3 种格式 + 工作流 |

***

## 第四部分：附录

### 4.1 新增/修改文件清单

#### 新增文件

| 文件路径 | 用途 |
|----------|------|
| `src/main/ipc/workspace-handler.ts` | 工作区 IPC Handler（9 个 channel + 3 个事件推送） |
| `src/renderer/src/components/workspace/WorkspaceDropdown.tsx` | 标题栏 Dropdown 工作区切换（核心组件） |
| `src/renderer/src/components/workspace/WorkspaceConfirmDialog.tsx` | 创建确认弹窗（名称编辑 + 图标选择 + 重复警告） |
| `src/renderer/src/stores/workspaceStore.ts` | 工作区状态管理 |
| `__tests__/workspace/workspace-handler.test.ts` | 20 测试用例 |

#### 修改文件

| 文件路径 | 修改内容 |
|----------|----------|
| `src/renderer/src/components/layout/CustomTitleBar.tsx` | 左侧嵌入 WorkspaceDropdown |
| `src/renderer/src/lib/ipc.ts` | 添加 workspaceApi（9 个方法） |
| `src/renderer/src/lib/types.ts` | 添加 WorkspaceItem / WorkspaceFileValidation / WorkspaceCreateParams |
| `src/renderer/src/App.tsx` | 添加 `Toast.Provider` |

### 4.2 第三方依赖

| 包 | 用途 |
|----|------|
| `lucide-react` | 图标库（FolderOpen, Trash2, Pickaxe, Leaf） |

### 4.3 与 V8 文档的关系

本文档覆盖 AC-WS-05 和 AC-WS-06 需求的完整实现。V8 主文档中的 AC-WS-05 描述的"智能体创建流程"（名称/皮肤/身份/工具/记忆/规则/机器人）属于**应用层**的智能体配置，而本文档的工作区切换属于**连接层**的实例导入。

在实际使用中，用户先通过本文档的工作区切换（连接层）导入 Adapter Core 实例，然后在 V8 智能体实例视图中配置智能体角色（应用层）。
