# Alice Mod Core V7 — UI 界面（HeroUI v3 + 自定义标题栏）

> 版本：v1.0
> 日期：2026-07-05
> 版本号：V7（第 9 周）
> 对应需求：AC-UI-03、AC-UI-05
> 关联文档：[AC-01-需求文档.md](AC-01-需求文档.md)、[AC-02-实施计划.md](AC-02-实施计划.md)、[AC-03-规范与验收标准.md](AC-03-规范与验收标准.md)、[AC-V5-PromptEngineering.md](AC-V5-PromptEngineering.md)、[AC-V6-LLMProvider.md](AC-V6-LLMProvider.md)

***

## 第一部分：需求文档

### 1.1 模块定位

V7 是 Agent Core 从**纯后端服务**走向**完整桌面应用**的关键版本。它首次引入渲染进程 UI，将 V4（Function Calling 管线）、V5（提示词系统）、V6（LLM Provider）的能力以可视化界面呈现给用户。

**核心职责**：

| 职责               | 说明                                            |
| ---------------- | --------------------------------------------- |
| **LLM 对话面板 v2**  | 完整的对话交互界面，支持流式输出、思考过程可视化、工具调用高亮               |
| **配置面板**         | Provider 选择、模型参数调节、TCP 端口配置等运行时配置管理           |
| **前后端分离架构**      | 主进程（后端 Node.js）与渲染进程（前端 React）通过 IPC 通信       |
| **自定义标题栏**       | Frameless 窗口 + 自定义拖拽/最小化/最大化/关闭按钮             |
| **Windows 桌面打包** | 基于 electron-builder 的 Windows 安装包，后端逻辑在主进程中运行 |

### 1.2 技术决策

#### 1.2.1 为什么选择 HeroUI v3

| 考量                  | 决策                                        |
| ------------------- | ----------------------------------------- |
| **组件丰富度**           | 75+ 组件，覆盖对话、配置、监控等全部 UI 需求                |
| **Compound 模式**     | 每个组件内部结构可定制，适合复杂对话气泡、工具调用卡片等场景            |
| **Tailwind CSS v4** | 与 Vite 构建链无缝集成，CSS 变量主题系统便于暗色模式           |
| **React Aria**      | 内置无障碍支持，键盘导航、焦点管理开箱即用                     |
| **性能**              | v3 全部动画改用 CSS，无 JS 动画运行时，适合 Electron 渲染进程 |
| **中文文档**            | v3.1.0 起支持中文文档，降低开发门槛                     |

#### 1.2.2 前后端分离架构

```
─────────────────────────────────────────────────────────────────┐
│                        Electron 应用                              │
│                                                                 │
│  ┌──────────────────────┐          ┌─────────────────────────┐  │
│  │   主进程 (Main)       │  IPC     │   渲染进程 (Renderer)    │  │
│  │   Node.js 后端        │◄────────►│   React + HeroUI v3     │  │
│  │                      │          │   前端界面               │  │
│  │  · TCP 服务端         │          │                         │  │
│  │  · LLM Provider      │          │  · 对话面板              │  │
│  │  · 提示词系统         │          │  · 配置面板              │  │
│  │  · Function Calling  │          │  · 上下文监控            │  │
│  │  · 工作区管理         │          │  · 智能体列表            │  │
│  │  · 记忆/任务系统      │          │                         │  │
│  │                      │          │  不会被杀毒软件误杀       │  │
│  │  打包为 .exe 主程序   │          │  仅负责 UI 渲染          │  │
│  └──────────────────────┘          └─────────────────────────┘  │
│                                                                 │
│  Preload Script (contextBridge)                                  │
│  · 安全暴露 IPC API 给渲染进程                                    │
│  · 不暴露 Node.js 原生模块                                        │
└─────────────────────────────────────────────────────────────────┘
```

**安全优势**：后端逻辑（TCP 服务端、LLM 调用、数据库操作）全部运行在 Electron 主进程中，打包后是单一 `.exe` 文件，不会被杀毒软件误判为独立服务端程序。渲染进程仅负责 UI 渲染，通过 `contextBridge` 与主进程通信，`contextIsolation: true` 确保安全隔离。

#### 1.2.3 自定义标题栏

使用 Electron `frame: true` + `titleBarStyle: 'hidden'`（Windows）实现自定义标题栏：

| 功能         | 实现方式                                              |
| ---------- | ------------------------------------------------- |
| 窗口拖拽       | `-webkit-app-region: drag` CSS 属性                 |
| 最小化/最大化/关闭 | 自定义按钮 + `ipcRenderer.invoke('window:minimize')` 等 |
| 双击最大化      | 标题栏区域监听 `dblclick` 事件                             |
| 右键系统菜单     | `-webkit-app-region: no-drag` 区域禁用拖拽              |

### 1.3 功能需求列表

| 需求 ID    | 需求名称                          | 优先级 | 实现状态 |
| -------- | ----------------------------- | :-: | :--: |
| AC-UI-03 | LLM 对话面板 v2（输入/输出/思考过程可视化） | P0 | ✅ 阶段1-2完成 |
| AC-UI-05 | 配置面板（Provider 选择/模型参数/TCP 端口） | P0 | ✅ 阶段1-2完成 |

#### AC-UI-03 详细需求

| 子需求     | 说明                                 |
| ------- | ---------------------------------- |
| 消息列表    | 按时间顺序展示用户消息和 LLM 回复，支持滚动           |
| 流式输出    | LLM 回复逐 token 显示，带打字机效果            |
| 思考过程可视化 | LLM 返回 `thinking` 内容时，可折叠展示思考过程    |
| 工具调用高亮  | `tool_calls` 以卡片形式展示，显示工具名、参数、执行状态 |
| 输入框     | 支持多行输入、Enter 发送、Shift+Enter 换行     |
| 工作区关联   | 对话绑定到当前选中的工作区                      |
| 消息历史持久化 | 对话历史保存到 SQLite，重启后恢复               |

#### AC-UI-05 详细需求

| 子需求         | 说明                                     |
| ----------- | -------------------------------------- |
| Provider 选择 | 下拉选择 OpenAI / Claude / Gemini / Ollama |
| 模型选择        | 根据 Provider 动态加载可用模型列表                 |
| 模型参数        | temperature、maxTokens、topP 等参数调节       |
| TCP 配置      | 端口号配置（默认 27541）                        |
| 配置持久化       | 修改后自动保存到 SQLite config 表               |
| 实时生效        | 部分配置（如 Provider 切换）无需重启即可生效            |

### 1.4 界面布局设计

基于用户草稿，V7 采用**三栏布局**：

```
┌─────────────────────────────────────────────────────────────────────┐
│  自定义标题栏（拖拽区域 + 窗口控制按钮）                               │
├────────────┬────────────────────────────────────┬──────────────────┤
│            │                                    │                  │
│  左栏       │           中栏                      │    右栏           │
│  (240px)   │          (flex-1)                   │   (280px)        │
│            │                                    │                  │
│ · 运行实例选择 │  · 对话标题栏（左智能体名称+右操作按钮（切换消息/设置））     │ · 上下文窗口使用率  │
│ · 导航菜单   │  · 消息列表（可滚动，自动折叠）        │   进度条 + 百分比   │
│   - 仪表盘  │  · 停止按钮（底部右边固定）             │                  │
│   - 模型    │                                    │ · 用量监控         │
│   - 知识与技能│                                    │   今日/本月 tokens │
│   - 机器人  │                                    │   柱状图           │
│            │                                    │                  │
│ · 智能体列表 │                                    │ · 待办事项         │
│   【新建】   │                                    │                  │
│   -        │                                    │                 │
│            │                                    │                  │
│            │                                    │                  │
│ [⚙ 设置]   │                                    │                  │
├────────────┴────────────────────────────────────┴──────────────────┤
│  状态栏（连接状态 / 版本信息）                                          │
└─────────────────────────────────────────────────────────────────────┘
```

**V7 聚焦中栏（对话面板）和右栏（配置面板通过抽屉/弹窗呈现）**，左栏框架在 V8 完善。

### 1.5 验收标准

| #    | 验收条件           | 验证方法                      | 测量指标                             |
| ---- | -------------- | ------------------------- | -------------------------------- |
| 7.1  | 自定义标题栏可拖拽窗口    | 鼠标按住标题栏拖动                 | 窗口跟随移动，无卡顿                       |
| 7.2  | 窗口控制按钮正常       | 点击最小化/最大化/关闭              | 窗口正确响应                           |
| 7.3  | 对话面板消息流正常      | 发送消息后 LLM 回复流式呈现          | 逐 token 显示，< 200ms 刷新            |
| 7.4  | 思考过程可折叠        | LLM 返回 thinking 标签        | 点击展开/收起，默认收起                     |
| 7.5  | 工具调用高亮显示       | LLM 调用多个工具                | 工具卡片显示名称、参数、状态                   |
| 7.6  | Provider 切换生效  | 配置面板切换 Provider           | 后续请求使用新 Provider                 |
| 7.7  | 模型参数可调         | 调整 temperature 0.3 → 0.8  | LLM 输出风格变化（可感知）                  |
| 7.8  | TCP 端口可配置      | 修改端口 27541 → 27542        | 服务端重启后在新端口监听                     |
| 7.9  | 配置持久化          | 修改配置后重启应用                 | 配置值不变                            |
| 7.10 | 输入框快捷键         | Enter 发送 / Shift+Enter 换行 | 行为正确                             |
| 7.11 | UI 响应速度        | 面板操作无明显卡顿                 | < 200ms（React DevTools Profiler） |
| 7.12 | 打包为 Windows 应用 | electron-builder 构建       | 生成 .exe 安装包，可正常安装运行              |

***

## 第二部分：架构文档

### 2.1 整体架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                         V7 UI 界面模块                                 │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                    渲染进程 (Renderer)                         │    │
│  │                                                              │    │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │    │
│  │  │ 对话面板      │  │  配置面板     │  │  共享组件库          │  │    │
│  │  │ ChatPanel   │  │ ConfigPanel  │  │  (HeroUI v3 封装)   │  │    │
│  │  │             │  │              │  │                    │  │    │
│  │  │ · MessageList│  │ · Provider   │  │ · CustomTitleBar  │  │    │
│  │  │ · MessageBubble│ │ · ModelSelect│  │ · StatusBar       │  │    │
│  │  │ · ThinkingBlock│ │ · ParamSlider│  │ · ToolCallCard    │  │    │
│  │  │ · ToolCallCard│  │ · TcpConfig  │  │ · ContextMeter    │  │    │
│  │  │ · InputBox   │  │              │  │                    │  │    │
│  │  └──────┬──────┘  └──────┬───────┘  └────────────────────┘  │    │
│  │         │                 │                                   │    │
│  │         └────────┬────────                                   │    │
│  │                  ▼                                            │    │
│  │  ┌─────────────────────────────────────────────────────────┐  │    │
│  │  │                    IPC Bridge Layer                       │  │    │
│  │  │  window.electronAPI.send / invoke / on                   │  │    │
│  │  └────────────────────────┬────────────────────────────────┘  │    │
│  ───────────────────────────┼────────────────────────────────────┘  │
│                              │ IPC                                    │
│  ┌───────────────────────────┼────────────────────────────────────┐  │
│  │                    主进程 (Main)                                │  │
│  │                           ▼                                    │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │                    IPC Handler Layer                      │  │  │
│  │  │  chat.send / chat.stream / config.get / config.set      │  │  │
│  │  │  window.minimize / window.maximize / window.close       │  │  │
│  │  └────────────────────────┬────────────────────────────────┘  │  │
│  │                           │                                    │  │
│  │  ┌────────────────────────▼────────────────────────────────┐  │  │
│  │  │                  业务服务层                                │  │  │
│  │  │  V5 PromptBuilder · V6 ModelRouter · V4 Pipeline        │  │  │
│  │  │  TCP Server · WorkspaceManager · ConfigManager          │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  ──────────────────────────────────────────────────────────────  │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 IPC 通信协议

#### 2.2.1 Channel 定义

| Channel               |  方向 | 用途              | 请求参数                       | 返回值                |
| --------------------- | :-: | --------------- | -------------------------- | ------------------ |
| `chat:send`           | R→M | 发送对话消息          | `{ workspaceId, message }` | `{ id, content }`  |
| `chat:stream`         | R→M | 流式对话            | `{ workspaceId, message }` | `SSE-like chunks`  |
| `chat:history`        | R→M | 获取对话历史          | `{ workspaceId, limit? }`  | `Message[]`        |
| `config:get`          | R→M | 读取配置            | `{ key }`                  | `{ key, value }`   |
| `config:set`          | R→M | 写入配置            | `{ key, value }`           | `{ success }`      |
| `config:getAll`       | R→M | 获取全部配置          | `{}`                       | `ConfigEntry[]`    |
| `provider:list`       | R→M | 获取 Provider 列表  | `{}`                       | `ProviderInfo[]`   |
| `model:list`          | R→M | 获取模型列表          | `{ providerId }`           | `ModelInfo[]`      |
| `window:minimize`     | R→M | 最小化窗口           | -                          | -                  |
| `window:maximize`     | R→M | 最大化/还原窗口        | -                          | -                  |
| `window:close`        | R→M | 关闭窗口            | -                          | -                  |
| `window:is-maximized` | R→M | 查询最大化状态         | -                          | `boolean`          |
| `workspace:current`   | R→M | 获取当前工作区         | -                          | `WorkspaceInfo`    |
| `workspace:list`      | R→M | 获取工作区列表         | -                          | `WorkspaceInfo[]`  |
| `tcp:status`          | R→M | 获取 TCP 连接状态     | -                          | `TcpStatus`        |
| `llm:usage`           | R→M | 获取 LLM 用量统计     | `{ period }`               | `UsageStats`       |
| `llm:context-tokens`  | R→M | 获取上下文 token 使用量 | `{ workspaceId }`          | `ContextTokenInfo` |

#### 2.2.2 流式输出方案

采用 `ipcRenderer.invoke` + 事件回调模式实现流式输出：

```typescript
// 渲染进程
const abortController = new AbortController();
window.electronAPI.on('chat:stream:chunk', (chunk: StreamChunk) => {
  // 逐 chunk 更新 UI
  appendToMessage(chunk);
});
window.electronAPI.on('chat:stream:done', () => {
  // 流式结束
  finalizeMessage();
});
window.electronAPI.on('chat:stream:error', (error: Error) => {
  // 错误处理
  showError(error);
});
await window.electronAPI.invoke('chat:stream', {
  workspaceId: 'xxx',
  message: '你好',
  abortSignal: abortController.signal
});
```

### 2.3 前端组件架构

#### 2.3.1 目录结构

```
packages/agent-core/src/renderer/src/
├── App.tsx                          # 根组件（三栏布局）
├── main.tsx                         # 入口
├── index.css                        # 全局样式 + Tailwind 指令
│
├── components/
│   ├── layout/
│   │   ├── AppLayout.tsx            # 三栏布局容器
│   │   ├── CustomTitleBar.tsx       # 自定义标题栏
│   │   ├── LeftSidebar.tsx          # 左栏（导航 + 智能体列表）
│   │   ├── RightSidebar.tsx         # 右栏（上下文监控 + 用量）
│   │   └── StatusBar.tsx            # 底部状态栏
│   │
│   ├── chat/
│   │   ├── ChatPanel.tsx            # 对话面板容器
│   │   ├── MessageList.tsx          # 消息列表（虚拟滚动）
│   │   ├── MessageBubble.tsx        # 单条消息气泡
│   │   ├── ThinkingBlock.tsx        # 思考过程折叠块
│   │   ├── ToolCallCard.tsx         # 工具调用卡片
│   │   ├── ToolCallList.tsx         # 工具调用列表
│   │   └── ChatInput.tsx            # 输入框
│   │
│   ├── config/
│   │   ├── ConfigPanel.tsx          # 配置面板（抽屉/弹窗）
│   │   ├── ProviderSelector.tsx     # Provider 选择器
│   │   ├── ModelSelector.tsx        # 模型选择器
│   │   ├── ParamSlider.tsx          # 参数滑块（temperature 等）
│   │   └── TcpConfig.tsx            # TCP 端口配置
│   │
│   └── shared/
│       ├── AgentAvatar.tsx          # 智能体头像
│       ├── StatusBadge.tsx          # 状态徽章
│       ├── ContextMeter.tsx         # 上下文使用率仪表
│       ├── UsageChart.tsx           # 用量柱状图
│       ── TodoList.tsx             # 待办事项列表
│
├── hooks/
│   ├── useChat.ts                   # 对话逻辑 Hook
│   ├── useConfig.ts                 # 配置管理 Hook
│   ├── useStream.ts                 # 流式输出 Hook
│   ├── useWindowControls.ts         # 窗口控制 Hook
│   └── useWorkspace.ts              # 工作区切换 Hook
│
├── stores/
│   ├── chatStore.ts                 # 对话状态（Zustand）
│   ├── configStore.ts               # 配置状态
│   ── workspaceStore.ts            # 工作区状态
│
└── lib/
    ├── ipc.ts                       # IPC 调用封装
    └── types.ts                     # 前端类型定义
```

#### 2.3.2 核心组件关系

```
AppLayout
├── CustomTitleBar
── LeftSidebar
│   ├── ServerSelector
│   ├── NavMenu
│   ├── AgentList
│   └── SettingsButton
├── ChatPanel (中栏)
│   ├── ChatHeader
│   ├── MessageList
│   │   └── MessageBubble (× N)
│   │       ├── ThinkingBlock (可折叠)
│   │       ── ToolCallList
│   │           └── ToolCallCard (× N)
│   ── ChatInput
├── RightSidebar
│   ├── ContextMeter
│   ├── UsageChart
│   └── TodoList
└── StatusBar
```

### 2.4 状态管理方案

采用 **Zustand** 作为轻量级状态管理库：

| Store            | 职责     | 关键状态                                                     |
| ---------------- | ------ | -------------------------------------------------------- |
| `chatStore`      | 对话消息管理 | `messages[]`、`isStreaming`、`currentWorkspaceId`          |
| `configStore`    | 配置缓存   | `providers[]`、`selectedProvider`、`modelParams`、`tcpPort` |
| `workspaceStore` | 工作区状态  | `workspaces[]`、`currentWorkspace`、`tcpStatus`            |

**数据流**：

```
用户操作 → Hook 调用 → IPC invoke → 主进程处理 → 结果返回
                                              ↓
                                    Store 更新 → React 重渲染
```

### 2.5 与已有模块的集成

| 已有模块                | 集成方式                                                        |
| ------------------- | ----------------------------------------------------------- |
| V5 提示词系统            | 主进程调用 `PromptBuilder.build()` 生成 messages，通过 IPC 传给 LLM     |
| V6 LLM Provider     | 主进程通过 `ModelRouter.resolve()` 选择 Provider，流式结果通过 IPC 传给渲染进程 |
| V4 Function Calling | 主进程执行管线，tool\_calls 结果通过 IPC 事件推送给渲染进程展示                    |
| ConfigManager       | 主进程读写 SQLite config 表，渲染进程通过 `config:get/set` IPC 访问        |
| WorkspaceManager    | 主进程管理工作区，渲染进程通过 `workspace:list/current` IPC 获取状态           |

***

## 第三部分：执行文档

### 3.1 依赖安装

```bash
# 在 packages/agent-core 目录下
pnpm add @heroui/react @heroui/styles
pnpm add zustand
pnpm add tailwindcss @tailwindcss/vite
pnpm add -D @types/node
```

**Tailwind CSS v4 配置**（Vite 插件模式）：

```typescript
// electron.vite.config.ts 更新
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // ...
  renderer: {
    plugins: [react(), tailwindcss()]
  }
})
```

```css
/* src/renderer/src/index.css */
@import "tailwindcss";
@import "@heroui/styles";
```

### 3.2 主进程改造

#### 3.2.1 窗口配置更新

```typescript
// src/main/index.ts
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: true,
    titleBarStyle: 'hidden',           // Windows 自定义标题栏
    titleBarOverlay: {                 // Windows 11 覆盖层样式
      color: '#1a1a2e',
      symbolColor: '#e0e0e0',
      height: 36
    },
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.resolve(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false                   // 需要访问 IPC
    },
    show: false                        // 先隐藏，加载完成后显示
  })

  // 开发环境加载 dev server，生产环境加载打包后的文件
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.resolve(__dirname, '../renderer/index.html'))
  }

  // 窗口就绪后显示，避免白屏
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // 在外部浏览器打开外部链接
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}
```

#### 3.2.2 IPC Handler 注册

```typescript
// src/main/ipc/chat-handler.ts
import { ipcMain } from 'electron'
import { ModelRouter } from '../llm'
import { PromptBuilder } from '../prompt'
import { Pipeline } from '../pipeline'
import { WorkspaceManager } from '../workspace'

export function registerChatHandlers(): void {
  // 发送对话消息（非流式）
  ipcMain.handle('chat:send', async (_event, { workspaceId, message }) => {
    const workspace = WorkspaceManager.get(workspaceId)
    const messages = PromptBuilder.build({ workspace, userMessage: message })
    const provider = ModelRouter.resolve(workspace)
    const response = await provider.chat(messages)
    return { id: response.id, content: response.content }
  })

  // 流式对话
  ipcMain.handle('chat:stream', async (event, { workspaceId, message }) => {
    const workspace = WorkspaceManager.get(workspaceId)
    const messages = PromptBuilder.build({ workspace, userMessage: message })
    const provider = ModelRouter.resolve(workspace)

    for await (const chunk of provider.chatStream(messages)) {
      event.sender.send('chat:stream:chunk', {
        id: chunk.id,
        content: chunk.content,
        thinking: chunk.thinking,
        toolCalls: chunk.toolCalls,
        isLast: chunk.isLast
      })
    }

    event.sender.send('chat:stream:done', {})
  })

  // 获取对话历史
  ipcMain.handle('chat:history', async (_event, { workspaceId, limit = 50 }) => {
    const workspace = WorkspaceManager.get(workspaceId)
    return workspace.getMessages(limit)
  })
}
```

```typescript
// src/main/ipc/config-handler.ts
import { ipcMain } from 'electron'
import { ConfigManager } from '../llm/config'

export function registerConfigHandlers(): void {
  ipcMain.handle('config:get', async (_event, { key }) => {
    return ConfigManager.get(key)
  })

  ipcMain.handle('config:set', async (_event, { key, value }) => {
    await ConfigManager.set(key, value)
    return { success: true }
  })

  ipcMain.handle('config:getAll', async () => {
    return ConfigManager.getAll()
  })

  ipcMain.handle('provider:list', async () => {
    return ConfigManager.getProviders()
  })

  ipcMain.handle('model:list', async (_event, { providerId }) => {
    return ConfigManager.getModels(providerId)
  })
}
```

```typescript
// src/main/ipc/window-handler.ts
import { ipcMain, BrowserWindow } from 'electron'

export function registerWindowHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('window:minimize', () => {
    mainWindow.minimize()
  })

  ipcMain.handle('window:maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
    return mainWindow.isMaximized()
  })

  ipcMain.handle('window:close', () => {
    mainWindow.close()
  })

  ipcMain.handle('window:is-maximized', () => {
    return mainWindow.isMaximized()
  })
}
```

#### 3.2.3 IPC 入口整合

```typescript
// src/main/ipc/index.ts
import { BrowserWindow } from 'electron'
import { registerChatHandlers } from './chat-handler'
import { registerConfigHandlers } from './config-handler'
import { registerWindowHandlers } from './window-handler'

export function registerAllIpcHandlers(mainWindow: BrowserWindow): void {
  registerChatHandlers()
  registerConfigHandlers()
  registerWindowHandlers(mainWindow)
}
```

### 3.3 Preload 脚本扩展

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // 平台信息
  platform: process.platform,

  // IPC 通信
  send: (channel: string, ...args: unknown[]) => {
    ipcRenderer.send(channel, ...args)
  },
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, subscription)
    return () => ipcRenderer.removeListener(channel, subscription)
  },
  invoke: (channel: string, ...args: unknown[]) => {
    return ipcRenderer.invoke(channel, ...args)
  },

  // 窗口控制（快捷方法）
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized')
  }
})
```

### 3.4 前端类型定义

```typescript
// src/renderer/src/lib/types.ts

/** 对话消息 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  thinking?: string           // 思考过程（可折叠）
  toolCalls?: ToolCallInfo[]  // 工具调用列表
  timestamp: number
  workspaceId: string
}

/** 工具调用信息 */
export interface ToolCallInfo {
  id: string
  name: string
  category: string            // 感知/移动/背包/生物/生存/方块/对话/QQ/记忆/任务
  params: Record<string, unknown>
  result?: {
    success: boolean
    data?: unknown
    duration_ms?: number
  }
  status: 'pending' | 'running' | 'success' | 'error'
}

/** 流式输出 Chunk */
export interface StreamChunk {
  id: string
  content?: string
  thinking?: string
  toolCalls?: ToolCallInfo[]
  isLast: boolean
}

/** Provider 信息 */
export interface ProviderInfo {
  id: string
  name: string
  available: boolean
  latencyMs?: number
}

/** 模型信息 */
export interface ModelInfo {
  id: string
  name: string
  providerId: string
  supportsFunctionCalling: boolean
  contextWindow: number
}

/** 配置项 */
export interface ConfigEntry {
  key: string
  value: string
  valueType: 'string' | 'number' | 'boolean' | 'json'
  description?: string
}

/** 工作区信息 */
export interface WorkspaceInfo {
  id: string
  name: string
  status: 'offline' | 'connecting' | 'online'
  toolCount: number
  lastActiveAt?: number
}

/** TCP 状态 */
export interface TcpStatus {
  port: number
  connectionCount: number
  isListening: boolean
}

/** LLM 用量统计 */
export interface UsageStats {
  todayTokens: number
  monthTokens: number
  dailyUsage: { date: string; tokens: number }[]
}

/** 上下文 Token 信息 */
export interface ContextTokenInfo {
  used: number
  max: number
  percentage: number
  breakdown: {
    system: number
    history: number
    tools: number
    state: number
  }
}
```

### 3.5 核心组件实现

#### 3.5.1 CustomTitleBar

```tsx
// src/renderer/src/components/layout/CustomTitleBar.tsx
import React from 'react'
import { Button } from '@heroui/react'

const CustomTitleBar: React.FC = () => {
  const handleMinimize = () => window.electronAPI.window.minimize()
  const handleMaximize = () => window.electronAPI.window.maximize()
  const handleClose = () => window.electronAPI.window.close()

  return (
    <div
      className="flex items-center justify-between h-9 bg-[#1a1a2e] select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* 拖拽区域 - 左侧空白 */}
      <div className="flex-1" />

      {/* 窗口控制按钮 - 不可拖拽 */}
      <div
        className="flex items-center h-full"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Button
          isIconOnly
          variant="light"
          size="sm"
          onPress={handleMinimize}
          className="text-gray-400 hover:text-white"
        >
          <MinimizeIcon />
        </Button>
        <Button
          isIconOnly
          variant="light"
          size="sm"
          onPress={handleMaximize}
          className="text-gray-400 hover:text-white"
        >
          <MaximizeIcon />
        </Button>
        <Button
          isIconOnly
          variant="light"
          size="sm"
          onPress={handleClose}
          className="text-gray-400 hover:text-red-500"
        >
          <CloseIcon />
        </Button>
      </div>
    </div>
  )
}
```

#### 3.5.2 ChatPanel

```tsx
// src/renderer/src/components/chat/ChatPanel.tsx
import React from 'react'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { useChat } from '../../hooks/useChat'

const ChatPanel: React.FC = () => {
  const { messages, isStreaming, sendMessage } = useChat()

  return (
    <div className="flex flex-col h-full">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        <MessageList messages={messages} isStreaming={isStreaming} />
      </div>

      {/* 输入框 */}
      <ChatInput onSend={sendMessage} disabled={isStreaming} />
    </div>
  )
}
```

#### 3.5.3 MessageBubble

```tsx
// src/renderer/src/components/chat/MessageBubble.tsx
import React, { useState } from 'react'
import { Card, CardBody, Avatar, Chip } from '@heroui/react'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallList } from './ToolCallList'
import type { ChatMessage } from '../../lib/types'

interface Props {
  message: ChatMessage
}

const MessageBubble: React.FC<Props> = ({ message }) => {
  const isUser = message.role === 'user'

  return (
    <div className={`flex gap-3 mb-4 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <Avatar
        src={isUser ? undefined : '/agent-avatar.png'}
        name={isUser ? 'U' : 'AI'}
        size="sm"
      />

      <Card className={`max-w-[70%] ${isUser ? 'bg-primary-500' : 'bg-default-100'}`}>
        <CardBody className="p-3">
          {/* 思考过程（可折叠） */}
          {message.thinking && (
            <ThinkingBlock content={message.thinking} />
          )}

          {/* 工具调用列表 */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <ToolCallList toolCalls={message.toolCalls} />
          )}

          {/* 消息内容 */}
          {message.content && (
            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
```

#### 3.5.4 ThinkingBlock

```tsx
// src/renderer/src/components/chat/ThinkingBlock.tsx
import React, { useState } from 'react'
import { Card, CardHeader, CardBody, Button } from '@heroui/react'

interface Props {
  content: string
}

const ThinkingBlock: React.FC<Props> = ({ content }) => {
  const [expanded, setExpanded] = useState(false)

  return (
    <Card className="mb-2 bg-default-50 border border-default-200">
      <CardHeader className="pb-0 pt-2 px-3">
        <Button
          variant="light"
          size="sm"
          onPress={() => setExpanded(!expanded)}
          className="text-xs text-default-500"
          startContent={<ThinkingIcon />}
        >
          思考过程
        </Button>
      </CardHeader>
      {expanded && (
        <CardBody className="pt-1 px-3 pb-2">
          <p className="text-xs text-default-600 italic whitespace-pre-wrap">
            {content}
        </p>
        </CardBody>
      )}
    </Card>
  )
}
```

#### 3.5.5 ToolCallCard

```tsx
// src/renderer/src/components/chat/ToolCallCard.tsx
import React from 'react'
import { Card, CardBody, Chip, Badge } from '@heroui/react'
import type { ToolCallInfo } from '../../lib/types'

interface Props {
  toolCall: ToolCallInfo
}

const categoryColors: Record<string, string> = {
  感知: 'blue',
  移动: 'green',
  背包: 'yellow',
  生物: 'red',
  生存: 'orange',
  方块: 'purple',
  对话: 'cyan',
  QQ: 'pink',
  记忆: 'indigo',
  任务: 'violet'
}

const ToolCallCard: React.FC<Props> = ({ toolCall }) => {
  const statusColor = {
    pending: 'warning',
    running: 'primary',
    success: 'success',
    error: 'danger'
  }[toolCall.status] as 'warning' | 'primary' | 'success' | 'danger'

  return (
    <Card className="my-1 bg-default-50">
      <CardBody className="py-2 px-3">
        <div className="flex items-center gap-2">
          <Chip
            size="sm"
            color={categoryColors[toolCall.category] || 'default'}
            variant="flat"
          >
            {toolCall.category}
          </Chip>
          <span className="text-sm font-mono font-medium">
            {toolCall.name}
          </span>
          <Chip size="sm" color={statusColor} variant="dot">
            {toolCall.status}
          </Chip>
          {toolCall.result?.duration_ms && (
            <span className="text-xs text-default-400 ml-auto">
              {toolCall.result.duration_ms}ms
            </span>
          )}
        </div>

        {/* 参数展示 */}
        {Object.keys(toolCall.params).length > 0 && (
          <pre className="mt-1 text-xs text-default-500 bg-default-100 rounded p-2 overflow-x-auto">
            {JSON.stringify(toolCall.params, null, 2)}
          </pre>
        )}

        {/* 结果展示 */}
        {toolCall.result?.data && (
          <pre className="mt-1 text-xs text-success-600 bg-success-50 rounded p-2 overflow-x-auto">
            {JSON.stringify(toolCall.result.data, null, 2)}
          </pre>
        )}
      </CardBody>
    </Card>
  )
}
```

#### 3.5.6 ConfigPanel（抽屉式）

```tsx
// src/renderer/src/components/config/ConfigPanel.tsx
import React from 'react'
import {
  Drawer, Select, SelectItem, Slider, Input, Button, Tab, Tabs
} from '@heroui/react'
import { useConfig } from '../../hooks/useConfig'

interface Props {
  isOpen: boolean
  onClose: () => void
}

const ConfigPanel: React.FC<Props> = ({ isOpen, onClose }) => {
  const {
    providers, selectedProvider, setSelectedProvider,
    models, selectedModel, setSelectedModel,
    temperature, setTemperature,
    maxTokens, setMaxTokens,
    tcpPort, setTcpPort,
    saveConfig
  } = useConfig()

  return (
    <Drawer isOpen={isOpen} onClose={onClose} placement="right" size="md">
      <Drawer.Backdrop />
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Heading>配置</Drawer.Heading>
        </Drawer.Header>
        <Drawer.Body className="p-4 space-y-6">
          {/* LLM 配置 */}
          <section>
            <h3 className="text-sm font-semibold mb-3">LLM 模型</h3>

            <Select
              label="Provider"
              selectedKeys={[selectedProvider]}
              onSelectionChange={(keys) => setSelectedProvider(Array.from(keys)[0] as string)}
              className="mb-3"
            >
              {providers.map(p => (
                <SelectItem key={p.id}>{p.name}</SelectItem>
              ))}
            </Select>

            <Select
              label="模型"
              selectedKeys={[selectedModel]}
              onSelectionChange={(keys) => setSelectedModel(Array.from(keys)[0] as string)}
              className="mb-3"
            >
              {models.map(m => (
                <SelectItem key={m.id}>{m.name}</SelectItem>
              ))}
            </Select>

            <Slider
              label="Temperature"
              step={0.1}
              minValue={0}
              maxValue={2}
              value={temperature}
              onChange={setTemperature}
              className="mb-3"
            />

            <Input
              label="Max Tokens"
              type="number"
              value={String(maxTokens)}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
            />
          </section>

          {/* TCP 配置 */}
          <section>
            <h3 className="text-sm font-semibold mb-3">TCP 服务端</h3>
            <Input
              label="端口"
              type="number"
              value={String(tcpPort)}
              onChange={(e) => setTcpPort(Number(e.target.value))}
            />
          </section>
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="flat" onPress={onClose}>取消</Button>
          <Button color="primary" onPress={() => { saveConfig(); onClose() }}>
            保存
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}
```

### 3.6 自定义 Hook 实现

#### 3.6.1 useChat

```typescript
// src/renderer/src/hooks/useChat.ts
import { useCallback, useEffect } from 'react'
import { useChatStore } from '../stores/chatStore'
import type { ChatMessage, StreamChunk } from '../lib/types'

export function useChat() {
  const {
    messages, isStreaming, currentWorkspaceId,
    addMessage, updateMessage, setStreaming,
    loadHistory
  } = useChatStore()

  // 加载历史消息
  useEffect(() => {
    if (currentWorkspaceId) {
      loadHistory(currentWorkspaceId)
    }
  }, [currentWorkspaceId])

  // 发送消息
  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isStreaming) return

    // 添加用户消息
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
      workspaceId: currentWorkspaceId
    }
    addMessage(userMsg)

    // 添加助手消息占位
    const assistantMsgId = crypto.randomUUID()
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      workspaceId: currentWorkspaceId
    }
    addMessage(assistantMsg)

    setStreaming(true)

    try {
      // 监听流式 chunk
      const unsubscribe = window.electronAPI.on(
        'chat:stream:chunk',
        (chunk: StreamChunk) => {
          updateMessage(assistantMsgId, {
            content: (chunk.content ? chunk.content : ''),
            thinking: chunk.thinking,
            toolCalls: chunk.toolCalls
          })
        }
      )

      // 监听流式结束
      window.electronAPI.on('chat:stream:done', () => {
        setStreaming(false)
        unsubscribe()
      })

      // 监听错误
      window.electronAPI.on('chat:stream:error', () => {
        setStreaming(false)
        unsubscribe()
      })

      // 发起流式请求
      await window.electronAPI.invoke('chat:stream', {
        workspaceId: currentWorkspaceId,
        message: content
      })
    } catch (error) {
      setStreaming(false)
      updateMessage(assistantMsgId, {
        content: `错误: ${error instanceof Error ? error.message : String(error)}`
      })
    }
  }, [isStreaming, currentWorkspaceId])

  return { messages, isStreaming, sendMessage }
}
```

#### 3.6.2 useConfig

```typescript
// src/renderer/src/hooks/useConfig.ts
import { useCallback, useEffect, useState } from 'react'
import { useConfigStore } from '../stores/configStore'
import type { ProviderInfo, ModelInfo } from '../lib/types'

export function useConfig() {
  const store = useConfigStore()
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])

  // 加载 Provider 列表
  useEffect(() => {
    window.electronAPI.invoke('provider:list').then(setProviders)
  }, [])

  // 加载模型列表
  useEffect(() => {
    if (store.selectedProvider) {
      window.electronAPI.invoke('model:list', {
        providerId: store.selectedProvider
      }).then(setModels)
    }
  }, [store.selectedProvider])

  const saveConfig = useCallback(async () => {
    await window.electronAPI.invoke('config:set', {
      key: 'llm_selected_provider',
      value: store.selectedProvider
    })
    await window.electronAPI.invoke('config:set', {
      key: 'llm_selected_model',
      value: store.selectedModel
    })
    await window.electronAPI.invoke('config:set', {
      key: 'llm_temperature',
      value: String(store.temperature)
    })
    await window.electronAPI.invoke('config:set', {
      key: 'llm_max_tokens',
      value: String(store.maxTokens)
    })
    await window.electronAPI.invoke('config:set', {
      key: 'tcp_port',
      value: String(store.tcpPort)
    })
  }, [store])

  return {
    providers, models,
    selectedProvider: store.selectedProvider,
    setSelectedProvider: store.setSelectedProvider,
    selectedModel: store.selectedModel,
    setSelectedModel: store.setSelectedModel,
    temperature: store.temperature,
    setTemperature: store.setTemperature,
    maxTokens: store.maxTokens,
    setMaxTokens: store.setMaxTokens,
    tcpPort: store.tcpPort,
    setTcpPort: store.setTcpPort,
    saveConfig
  }
}
```

### 3.7 Zustand Store 实现

```typescript
// src/renderer/src/stores/chatStore.ts
import { create } from 'zustand'
import type { ChatMessage } from '../lib/types'

interface ChatState {
  messages: ChatMessage[]
  isStreaming: boolean
  currentWorkspaceId: string | null

  addMessage: (msg: ChatMessage) => void
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void
  setStreaming: (streaming: boolean) => void
  setCurrentWorkspace: (id: string) => void
  loadHistory: (workspaceId: string) => Promise<void>
  clearMessages: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  currentWorkspaceId: null,

  addMessage: (msg) => set((state) => ({
    messages: [...state.messages, msg]
  })),

  updateMessage: (id, updates) => set((state) => ({
    messages: state.messages.map((m) =>
      m.id === id ? { ...m, ...updates } : m
    )
  })),

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  setCurrentWorkspace: (id) => set({
    currentWorkspaceId: id,
    messages: []
  }),

  loadHistory: async (workspaceId) => {
    const history = await window.electronAPI.invoke('chat:history', {
      workspaceId,
      limit: 50
    })
    set({ messages: history, currentWorkspaceId: workspaceId })
  },

  clearMessages: () => set({ messages: [] })
}))
```

```typescript
// src/renderer/src/stores/configStore.ts
import { create } from 'zustand'

interface ConfigState {
  selectedProvider: string
  selectedModel: string
  temperature: number
  maxTokens: number
  tcpPort: number

  setSelectedProvider: (id: string) => void
  setSelectedModel: (id: string) => void
  setTemperature: (value: number) => void
  setMaxTokens: (value: number) => void
  setTcpPort: (value: number) => void
}

export const useConfigStore = create<ConfigState>((set) => ({
  selectedProvider: 'openai',
  selectedModel: 'gpt-4o',
  temperature: 0.7,
  maxTokens: 4096,
  tcpPort: 27541,

  setSelectedProvider: (id) => set({ selectedProvider: id }),
  setSelectedModel: (id) => set({ selectedModel: id }),
  setTemperature: (value) => set({ temperature: value }),
  setMaxTokens: (value) => set({ maxTokens: value }),
  setTcpPort: (value) => set({ tcpPort: value })
}))
```

### 3.8 主进程启动流程改造

```typescript
// src/main/index.ts（更新版）
import { app, BrowserWindow, shell } from 'electron'
import path from 'path'
import { TcpServer } from './tcp'
import { WorkspaceManager } from './workspace'
import { ConfigManager } from './llm/config'
import { ModelRouter } from './llm'
import { registerAllIpcHandlers } from './ipc'

let mainWindow: BrowserWindow | null = null

async function initializeServices(): Promise<void> {
  // 初始化配置
  await ConfigManager.init()

  // 初始化 TCP 服务端
  const tcpPort = await ConfigManager.get('tcp_port') || 27541
  const tcpServer = new TcpServer(Number(tcpPort))
  await tcpServer.start()

  // TCP 连接时自动创建工作区
  tcpServer.on('connection', (conn) => {
    WorkspaceManager.createWorkspace(conn)
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1a1a2e',
      symbolColor: '#e0e0e0',
      height: 36
    },
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.resolve(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.resolve(__dirname, '../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // 注册所有 IPC Handler
  registerAllIpcHandlers(mainWindow)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  await initializeServices()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
```

***

## 第四部分：性能目标

| 指标        | 目标                      | 测量方式                                      |
| --------- | ----------------------- | ----------------------------------------- |
| 首屏渲染      | < 1s（从窗口创建到可见）          | `ready-to-show` 事件计时                      |
| 消息渲染      | < 50ms（单条消息 DOM 更新）     | React DevTools Profiler                   |
| 流式输出刷新    | < 100ms（chunk 到 UI 更新）  | 自定义性能标记                                   |
| 配置切换      | < 200ms（Provider 切换生效）  | 计时日志                                      |
| 内存占用（UI）  | < 80MB（渲染进程）            | Electron `process.getProcessMemoryInfo()` |
| Bundle 大小 | < 2MB（renderer JS，gzip） | `electron-vite build` 输出分析                |

***

## 第五部分：附录

### 5.1 HeroUI v3 组件选型清单

| UI 需求       | HeroUI 组件               | 用途               |
| ----------- | ----------------------- | ---------------- |
| 对话气泡        | `Card` + `CardBody`     | 消息容器             |
| 头像          | `Avatar`                | 用户/AI 头像         |
| 输入框         | `Textarea`              | 多行消息输入           |
| 按钮          | `Button`                | 发送/操作按钮          |
| Provider 选择 | `Select` + `SelectItem` | 下拉选择             |
| 模型选择        | `Select` + `SelectItem` | 下拉选择             |
| 参数滑块        | `Slider`                | temperature 等连续值 |
| 数字输入        | `Input`                 | maxTokens、端口等    |
| 配置抽屉        | `Drawer`                | 右侧滑出配置面板         |
| 标签/分类       | `Chip`                  | 工具分类标签           |
| 状态徽章        | `Badge` / `Chip`        | 连接状态、工具状态        |
| 进度条         | `Progress`              | 上下文使用率           |
| 选项卡         | `Tabs` + `Tab`          | 配置分组             |
| 分隔线         | `Divider`               | 区域分隔             |
| 提示/通知       | `Toast`                 | 操作反馈             |
| 加载状态        | `Spinner`               | 流式输出中            |
| 折叠面板        | `Accordion`             | 思考过程/工具参数折叠      |
| 滚动容器        | 原生 + `data-scrollbar`   | 消息列表滚动           |

### 5.2 electron-builder 打包配置（V15 预留）

```yaml
# electron-builder.yml（V15 时启用）
appId: com.mcagent.alice
productName: Alice Mod
directories:
  output: release
files:
  - dist/**/*
  - package.json
win:
  target:
    - nsis
    - portable
  artifactName: ${productName}-Setup-${version}.${ext}
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
```

### 5.3 文件清单

#### 新增文件

| 文件路径                                                      | 用途                 |
| --------------------------------------------------------- | ------------------ |
| `src/main/ipc/index.ts`                                   | IPC Handler 注册入口   |
| `src/main/ipc/chat-handler.ts`                            | 对话相关 IPC Handler   |
| `src/main/ipc/config-handler.ts`                          | 配置相关 IPC Handler   |
| `src/main/ipc/window-handler.ts`                          | 窗口控制 IPC Handler   |
| `src/renderer/src/index.css`                              | 全局样式 + Tailwind 指令 |
| `src/renderer/src/components/layout/AppLayout.tsx`        | 三栏布局容器             |
| `src/renderer/src/components/layout/CustomTitleBar.tsx`   | 自定义标题栏             |
| `src/renderer/src/components/layout/LeftSidebar.tsx`      | 左栏框架               |
| `src/renderer/src/components/layout/RightSidebar.tsx`     | 右栏框架               |
| `src/renderer/src/components/layout/StatusBar.tsx`        | 底部状态栏              |
| `src/renderer/src/components/chat/ChatPanel.tsx`          | 对话面板               |
| `src/renderer/src/components/chat/MessageList.tsx`        | 消息列表               |
| `src/renderer/src/components/chat/MessageBubble.tsx`      | 消息气泡               |
| `src/renderer/src/components/chat/ThinkingBlock.tsx`      | 思考过程折叠块            |
| `src/renderer/src/components/chat/ToolCallCard.tsx`       | 工具调用卡片             |
| `src/renderer/src/components/chat/ToolCallList.tsx`       | 工具调用列表             |
| `src/renderer/src/components/chat/ChatInput.tsx`          | 输入框                |
| `src/renderer/src/components/config/ConfigPanel.tsx`      | 配置面板               |
| `src/renderer/src/components/config/ProviderSelector.tsx` | Provider 选择器       |
| `src/renderer/src/components/config/ModelSelector.tsx`    | 模型选择器              |
| `src/renderer/src/components/config/ParamSlider.tsx`      | 参数滑块               |
| `src/renderer/src/components/config/TcpConfig.tsx`        | TCP 配置             |
| `src/renderer/src/components/shared/AgentAvatar.tsx`      | 智能体头像              |
| `src/renderer/src/components/shared/StatusBadge.tsx`      | 状态徽章               |
| `src/renderer/src/components/shared/ContextMeter.tsx`     | 上下文使用率             |
| `src/renderer/src/components/shared/UsageChart.tsx`       | 用量柱状图              |
| `src/renderer/src/components/shared/TodoList.tsx`         | 待办事项               |
| `src/renderer/src/hooks/useChat.ts`                       | 对话逻辑 Hook          |
| `src/renderer/src/hooks/useConfig.ts`                     | 配置管理 Hook          |
| `src/renderer/src/hooks/useStream.ts`                     | 流式输出 Hook          |
| `src/renderer/src/hooks/useWindowControls.ts`             | 窗口控制 Hook          |
| `src/renderer/src/hooks/useWorkspace.ts`                  | 工作区切换 Hook         |
| `src/renderer/src/stores/chatStore.ts`                    | 对话状态 Store         |
| `src/renderer/src/stores/configStore.ts`                  | 配置状态 Store         |
| `src/renderer/src/stores/workspaceStore.ts`               | 工作区状态 Store        |
| `src/renderer/src/lib/ipc.ts`                             | IPC 调用封装           |
| `src/renderer/src/lib/types.ts`                           | 前端类型定义             |

#### 修改文件

| 文件路径                        | 修改内容                                    |
| --------------------------- | --------------------------------------- |
| `src/main/index.ts`         | 添加 IPC 注册、窗口配置更新（titleBarStyle）、服务初始化   |
| `src/preload/index.ts`      | 扩展 window 控制 API                        |
| `src/renderer/src/App.tsx`  | 替换为 AppLayout 三栏布局                      |
| `src/renderer/src/main.tsx` | 添加 HeroUI Provider 包裹                   |
| `src/renderer/index.html`   | 添加 viewport meta、title                  |
| `electron.vite.config.ts`   | 添加 Tailwind CSS v4 插件                   |
| `package.json`              | 添加 @heroui/react、zustand、tailwindcss 依赖 |

### 5.4 开发顺序建议

| 阶段       | 内容          | 产出                                                                            |
| -------- | ----------- | ----------------------------------------------------------------------------- |
| **阶段 1** | 基础设施搭建      | 依赖安装、Tailwind 配置、HeroUI Provider、自定义标题栏、窗口控制                                  |
| **阶段 2** | IPC 通道打通    | 主进程 IPC Handler + Preload 扩展 + 前端 IPC 封装，验证通信正常                               |
| **阶段 3** | 对话面板核心      | ChatPanel + MessageList + MessageBubble + ChatInput + useChat Hook            |
| **阶段 4** | 流式输出        | useStream Hook + 流式 chunk 渲染 + 打字机效果                                          |
| **阶段 5** | 思考过程 + 工具调用 | ThinkingBlock + ToolCallCard + ToolCallList                                   |
| **阶段 6** | 配置面板        | ConfigPanel + ProviderSelector + ModelSelector + ParamSlider + useConfig Hook |
| **阶段 7** | 右栏监控        | ContextMeter + UsageChart + TodoList                                          |
| **阶段 8** | 集成测试 + 优化   | 全链路联调、性能优化、验收测试                                                               |

### 5.5 风险与应对

| 风险                       | 影响                 | 应对措施                                             |
| ------------------------ | ------------------ | ------------------------------------------------ |
| HeroUI v3 与 Electron 兼容性 | 部分 CSS 特性可能不生效     | 开发初期验证关键组件渲染，必要时降级到 v2                           |
| 流式输出 IPC 性能              | 高频 chunk 可能导致渲染卡顿  | 使用 requestAnimationFrame 节流，批量更新 DOM             |
| Tailwind CSS v4 构建问题     | Vite 插件模式可能有兼容问题   | 预留 PostCSS 模式作为备选方案                              |
| 自定义标题栏 Windows 版本差异      | Windows 10/11 表现不同 | titleBarOverlay 仅 Windows 11 生效，Win10 使用纯 CSS 方案 |
| Zustand 状态同步延迟           | IPC 异步导致 UI 闪烁     | 乐观更新 + 回滚机制                                      |

