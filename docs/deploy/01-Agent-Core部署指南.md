# Agent Core 部署指南

> 版本：v1.0
> 日期：2026-07-04
> 关联文档：[00-顶层设计.md](../00-顶层设计.md)、[02-模块划分与功能简介.md](../02-模块划分与功能简介.md)

---

## 第1章 概述

### 1.1 Agent Core 的角色

Agent Core 是 McAgent 系统的**智能体核心**，基于 Electron + TypeScript/Node.js 构建的桌面应用。它是整个系统的"大脑"，承担三个核心角色：

| 角色 | 说明 |
|------|------|
| **LLM 大脑** | 负责统一调度大语言模型，组装提示词、解析 Function Calling 结果、管理对话上下文；支持 OpenAI / Claude / Gemini / Ollama 等多 Provider 切换 |
| **调度中心** | 管理工作区生命周期，通过 TCP JSON-RPC 协议与多个 Adapter Core 实例通信，分发工具调用、收集执行结果、处理事件上报 |
| **记忆存储** | 基于 SQLite + Chroma 实现结构化和向量化双模存储，为 LLM 提供持久化记忆能力，支持记忆的存储、检索、更新、清理 |

Agent Core **不依赖游戏运行**，可独立启动。它通过 TCP 连接与 Adapter Core（运行在游戏服务器内的模组/插件）通信，一个 Agent Core 可同时管理多个 Adapter Core 实例（跨服、跨版本）。

### 1.2 系统架构位置图

```
┌──────────────────────────────────────────────────────────────────┐
│                      Agent Core                                  │
│                  Electron + TypeScript / Node.js                  │
│                                                                  │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐        │
│  │  UI 界面   │ │ LLM调度层  │ │ 工作区管理 │ │ QQ 机器人  │        │
│  │(React)    │ │(多模型接入)│ │ (多实例)   │ │ (消息桥接) │        │
│  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └─────┬─────┘        │
│        └──────────────┴──────────────┴──────────────┘            │
│                              │                                    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                  记忆系统（全局底层）                       │    │
│  │  角色记忆 · 环境记忆 · 经验库 · 知识库 · 用户偏好 · 任务存档 │    │
│  └──────────────────────────────────────────────────────────┘    │
│                              │                                    │
│                    ┌─────────┴─────────┐                          │
│                    │   TCP JSON-RPC    │                          │
│                    │   桥接层 (Batch)   │                          │
│                    └─────────┬─────────┘                          │
└──────────────────────────────┼───────────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
   ┌──────────────────┐ ┌──────────────┐ ┌──────────────┐
   │  Adapter Core    │ │  Adapter Core│ │  更多实例...  │
   │  基岩版          │ │  Java 版     │ │              │
   │ (LeviLamina 插件)│ │ (Fabric 模组)│ │              │
   │ 假人 + 108+ 工具  │ │ 假人 + 108+ 工具│ │              │
   └──────────────────┘ └──────────────┘ └──────────────┘
```

### 1.3 部署位置说明

```
┌────────────────────────────────────────────────────────────┐
│              用户电脑 / 服务器                              │
│                                                            │
│  ┌──────────────────────────────────┐                     │
│  │          Agent Core              │                     │
│  │  Electron 桌面应用               │                     │
│  │  不依赖游戏，可独立运行           │                     │
│  └──────────────┬───────────────────┘                     │
│                 │ TCP (JSON-RPC 2.0)                  │
│    ┌────────────┴────────────┐                         │
│    │                         │                         │
│    ▼                         ▼                         │
│  ┌──────────────┐    ┌──────────────┐                  │
│  │ Adapter Core │    │ Adapter Core │                  │
│  │  基岩版       │    │  Java 版     │                  │
│  │  (BDS 服务器) │    │  (Minecraft  │                  │
│  │               │    │   Java 服务器)│                  │
│  └──────────────┘    └──────────────┘                  │
│                                                            │
│  Agent Core 可同时管理多个 Adapter Core（跨服、跨版本）     │
└────────────────────────────────────────────────────────────┘
```

---

## 第2章 环境要求

### 2.1 操作系统

| 操作系统 | 最低版本 | 备注 |
|----------|----------|------|
| Windows | 10 / 11 | 推荐 Windows 11 |
| macOS | 12 (Monterey) 及以上 | 支持 Apple Silicon 和 Intel |
| Ubuntu | 20.04 LTS 及以上 | 也适用于 Debian 11+、CentOS 8+ |

### 2.2 运行时环境

| 依赖 | 最低版本 | 推荐版本 |
|------|----------|----------|
| Node.js | 18.x | **20 LTS**（建议使用 v20.11.0 或更高） |
| npm | 9.x | 10.x |
| pnpm（可选） | 8.x | 9.x |

> **注意**：Agent Core 使用 Electron，需要与 Node.js 版本兼容。推荐使用 Node.js 20 LTS 以确保最佳的 Electron 兼容性。

### 2.3 硬件要求

| 资源 | 最低要求 | 推荐配置 |
|------|----------|----------|
| 内存 (RAM) | 4 GB | 8 GB 或更高 |
| 磁盘空间 | 500 MB（应用本身） | 2 GB（含数据存储） |
| CPU | 双核 2.0 GHz | 四核 2.5 GHz+ |

### 2.4 网络要求

| 需求 | 说明 |
|------|------|
| LLM API 访问 | 必须能够访问 OpenAI / Anthropic / Google 等 LLM API 端点（如需使用本地 Ollama 则可离线） |
| TCP 端口 | Agent Core 默认监听 `27541` 端口，需确保防火墙放行 |
| Adapter Core 连接 | Agent Core 与 Adapter Core 之间需 TCP 网络可达（同机部署通常无需额外配置） |

### 2.5 可选依赖

| 组件 | 用途 | 说明 |
|------|------|------|
| SQLite 3 | 主数据库 | **Node.js 内置**的 `better-sqlite3` 会自动编译，无需手动安装 |
| ChromaDB | 向量数据库（记忆语义检索） | 可选，如不使用向量检索功能可跳过；需要 Python 3.9+ 环境时以独立服务运行 |

---

## 第3章 安装与构建

### 3.1 从源码构建

#### 步骤一：克隆仓库

```bash
git clone https://github.com/xxx/mcagent.git
cd mcagent
```

#### 步骤二：安装依赖

使用 npm：

```bash
npm install
```

或使用 pnpm（推荐，速度更快）：

```bash
pnpm install
```

> **注意**：安装过程中 `better-sqlite3` 会进行原生编译，需要系统已安装构建工具链。
> - **Windows**：通常无需额外操作（npm 自带 MSBuild）
> - **macOS**：需要 Xcode Command Line Tools：`xcode-select --install`
> - **Linux**：需要 `build-essential` 和 `python3`：`sudo apt install build-essential python3`

#### 步骤三：构建

```bash
npm run build
```

#### 步骤四：构建产物

构建完成后，产物位于 `dist/` 目录：

```
dist/
├── win/               # Windows 安装包
│   └── McAgent-*.exe
├── mac/               # macOS 安装包
│   └── McAgent-*.dmg
├── linux/             # Linux AppImage
│   └── McAgent-*.AppImage
└── electron/          # Electron 可执行文件
    └── ...
```

### 3.2 从预构建包安装

直接从发布页面下载对应平台的预构建安装包，无需本地构建环境。

#### Windows

1. 下载 `McAgent-Setup-x.y.z.exe`
2. 双击运行安装程序
3. 选择安装目录（默认 `C:\Program Files\McAgent`）
4. 完成安装后自动创建桌面快捷方式

#### macOS

1. 下载 `McAgent-x.y.z.dmg`
2. 双击挂载 DMG 文件
3. 将 McAgent 拖入 `Applications` 文件夹
4. 首次启动时如提示"未识别的开发者"，前往 **系统设置 → 隐私与安全性** 中允许打开

#### Linux

1. 下载 `McAgent-x.y.z.AppImage`
2. 赋予执行权限：

```bash
chmod +x McAgent-x.y.z.AppImage
```

3. 直接运行：

```bash
./McAgent-x.y.z.AppImage
```

### 3.3 目录结构

Agent Core 的完整目录结构如下：

```
mcagent/
├── dist/                    # 构建产物
│   ├── win/
│   ├── mac/
│   └── linux/
├── src/
│   ├── main/               # Electron 主进程
│   │   ├── index.ts        # 入口文件
│   │   ├── tcp-server.ts   # TCP 服务端
│   │   ├── llm/            # LLM 调度层
│   │   ├── workspace/      # 工作区管理器
│   │   ├── memory/         # 记忆系统
│   │   ├── task/           # 任务规划
│   │   └── qq-bot/         # QQ 机器人
│   ├── renderer/           # UI 渲染进程
│   │   ├── index.html
│   │   ├── App.tsx
│   │   └── pages/          # 各面板页面
│   └── shared/             # 共享类型定义
│       ├── types.ts        # JSON-RPC 类型
│       ├── tool-schema.ts  # 工具 Schema
│       ├── protocol.ts     # 协议工具
│       └── constants.ts    # 常量与枚举
├── resources/              # 静态资源
│   ├── icons/
│   └── locales/
├── mcagent_instance.json   # 实例配置文件（由 Adapter Core 生成，用户导入使用）
├── data/                   # 运行时数据（用户数据目录）
│   ├── mcagent.db          # SQLite 主数据库
│   │   ├── config          # 配置表
│   │   ├── memory_meta     # 记忆元数据
│   │   ├── logs            # 日志表
│   │   └── task_archive    # 任务存档
│   ├── chroma/             # ChromaDB 向量数据（可选）
│   └── exports/            # 导出数据目录
├── config/                 # 用户配置
│   ├── llm.yaml            # LLM Provider 配置
│   └── settings.yaml       # 应用设置
├── logs/                   # 运行日志（运行时自动创建）
│   ├── app.log
│   └── error.log
└── package.json
```

---

## 第4章 首次运行配置

### 4.1 LLM Provider 配置

LLM Provider 配置文件位于 `config/llm.yaml`。首次启动时需要配置至少一个 Provider。

#### 配置文件格式

配置文件使用 YAML 格式，示例如下：

```yaml
# config/llm.yaml

# 默认使用的 Provider 名称
default_provider: openai

# Provider 列表
providers:
  openai:
    type: openai
    api_key: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    base_url: https://api.openai.com/v1
    model: gpt-4o
    max_tokens: 4096
    temperature: 0.7

  claude:
    type: claude
    api_key: sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    base_url: https://api.anthropic.com
    model: claude-sonnet-4-20250514
    max_tokens: 4096
    temperature: 0.7

  ollama:
    type: ollama
    base_url: http://localhost:11434
    model: qwen2.5:7b
    max_tokens: 4096
    temperature: 0.7
```

#### OpenAI / 兼容 API 配置

适用于 OpenAI、Azure OpenAI、DeepSeek、月之暗面等兼容 OpenAI API 格式的服务：

```yaml
providers:
  openai:
    type: openai
    api_key: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    base_url: https://api.openai.com/v1      # OpenAI 官方
    model: gpt-4o
    max_tokens: 4096
    temperature: 0.7

  deepseek:
    type: openai                             # DeepSeek 兼容 OpenAI API
    api_key: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    base_url: https://api.deepseek.com/v1
    model: deepseek-chat
    max_tokens: 4096
    temperature: 0.7
```

#### Claude 配置

```yaml
providers:
  claude:
    type: claude
    api_key: sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    base_url: https://api.anthropic.com
    model: claude-sonnet-4-20250514
    max_tokens: 4096
    temperature: 0.7
    # 可选：Claude 专用参数
    thinking:
      type: enabled
      budget_tokens: 2048
```

#### Ollama 本地配置

```yaml
providers:
  ollama:
    type: ollama
    base_url: http://localhost:11434          # Ollama 默认地址
    model: qwen2.5:7b                         # 本地已拉取的模型
    max_tokens: 4096
    temperature: 0.7
    # 可选参数
    keep_alive: 5m                            # 模型保持加载时间
    context_length: 8192                      # 上下文长度
```

#### 多 Provider 切换

Agent Core 支持在运行时切换 Provider，三种切换方式：

| 方式 | 说明 |
|------|------|
| **默认 Provider** | 在 `llm.yaml` 中设置 `default_provider`，启动时自动使用 |
| **按工作区切换** | 每个工作区（Adapter Core 实例）可独立指定使用的 Provider 和模型 |
| **按任务类型切换** | 配置路由规则，复杂任务使用更强模型，简单任务使用轻量模型 |

示例：按工作区指定模型（在 UI 配置面板或 settings.yaml 中）：

```yaml
workspace_models:
  "workspace-id-1": "openai/gpt-4o"
  "workspace-id-2": "claude/claude-sonnet-4-20250514"
```

### 4.2 工作区配置

工作区对应一个 Adapter Core 实例。Agent Core 支持两种方式添加工作区：

#### 方式一：通过 UI 添加

1. 启动 Agent Core
2. 进入 **配置面板 → 工作区管理**
3. 点击 **添加实例**
4. 在文件选择对话框中选择 Adapter Core 生成的 `mcagent_instance.json` 文件
5. 确认配置后，Agent Core 自动读取实例信息并建立连接

#### 方式二：手动指定路径

将 `mcagent_instance.json` 放入 Agent Core 的 `data/` 目录，或通过命令行参数指定：

```bash
# 启动时指定实例配置文件
npm start -- --instance /path/to/mcagent_instance.json
```

#### 工作区配置参数

`mcagent_instance.json` 文件内容示例：

```json
{
  "schema_version": "1.0.0",
  "instance_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "instance_name": "我的基岩版服务器",
  "agent_core": {
    "host": "127.0.0.1",
    "port": 27541
  },
  "edition": "bedrock",
  "game_version": "1.21.50",
  "mod_version": "1.0.0",
  "auth_token": "xxxx-xxxx-xxxx-xxxx",
  "database": {
    "path": "./data/mcagent.db",
    "chroma_path": "./data/chroma"
  },
  "status": "online",
  "world_name": "我的世界"
}
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `schema_version` | string | JSON Schema 版本号 |
| `instance_id` | string (UUID) | 实例唯一标识，自动生成 |
| `instance_name` | string | 实例名称，用于 UI 显示 |
| `agent_core.host` | string | Agent Core 的 TCP 监听地址 |
| `agent_core.port` | number | Agent Core 的 TCP 监听端口（默认 27541） |
| `edition` | string | 游戏版本：`bedrock` 或 `java` |
| `game_version` | string | 游戏版本号 |
| `mod_version` | string | Adapter Core 模组版本号 |
| `auth_token` | string | 认证令牌，用于 TCP 握手验证 |
| `database.path` | string | SQLite 数据库路径 |
| `database.chroma_path` | string | ChromaDB 数据目录（可选） |
| `status` | string | 实例状态：`online` / `offline` |
| `world_name` | string | 当前游戏世界名称 |

### 4.3 记忆系统配置

#### SQLite 路径配置

SQLite 数据库默认位于 `data/mcagent.db`，可通过配置文件修改：

```yaml
# config/settings.yaml
memory:
  sqlite:
    path: ./data/mcagent.db          # 数据库文件路径
    wal_mode: true                    # 启用 WAL 模式（提升并发性能）
    cache_size: -64000                # 缓存大小（KB，负值为页数）
```

> **注意**：SQLite 使用 WAL (Write-Ahead Logging) 模式可显著提升并发读写性能，建议保持启用。

#### ChromaDB 连接配置（可选）

如使用向量语义检索功能，需配置 ChromaDB：

```yaml
# config/settings.yaml
memory:
  chroma:
    enabled: false                     # 是否启用 ChromaDB
    mode: persistent                   # 运行模式：persistent / http
    # persistent 模式（嵌入式，无需单独启动服务）
    persistent_path: ./data/chroma     # 向量数据存储路径
    # HTTP 模式（连接到外部 ChromaDB 服务）
    # host: localhost
    # port: 8000
    # ssl: false
    collection_name: mcagent_memories  # 集合名称
```

两种运行模式：

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `persistent` | 嵌入式模式，ChromaDB 数据存储在本地文件 | 单机部署，无需额外服务 |
| `http` | 连接外部 ChromaDB 服务 | 多实例共享、数据需持久化到远端 |

#### 嵌入模型配置

向量检索需要使用嵌入模型将文本转换为向量：

```yaml
# config/settings.yaml
memory:
  embedding:
    provider: ollama                   # 嵌入模型 Provider
    model: nomic-embed-text            # 嵌入模型名称
    # 可选 Provider
    # provider: openai
    # model: text-embedding-3-small
    dimension: 768                     # 向量维度（需与模型匹配）
```

支持的嵌入模型 Provider：

| Provider | 推荐模型 | 向量维度 | 说明 |
|----------|----------|----------|------|
| Ollama | `nomic-embed-text` | 768 | 本地运行，无需 API Key |
| Ollama | `bge-m3` | 1024 | 多语言支持更好 |
| OpenAI | `text-embedding-3-small` | 1536 | 云端 API，需 API Key |
| OpenAI | `text-embedding-3-large` | 3072 | 精度更高，成本更高 |

---

## 第5章 运行与监控

### 5.1 启动

#### 开发模式启动

```bash
# 在 mcagent 项目根目录下
npm run dev
```

开发模式特点：

- 自动启动 Electron 主进程和 React 开发服务器
- 支持热重载（修改代码后自动刷新）
- 控制台输出详细日志
- 默认监听端口 `27541`

#### 生产模式启动

- **Windows**：双击桌面快捷方式，或从开始菜单启动
- **macOS**：从 Applications 文件夹或 Launchpad 启动
- **Linux**：双击 AppImage 文件，或命令行运行

命令行启动（适用于所有平台）：

```bash
# 直接启动
npm start

# 指定数据目录
npm start -- --data-dir /path/to/data

# 指定配置文件
npm start -- --config /path/to/config
```

#### 首次启动引导

首次启动时，Agent Core 会自动执行以下初始化流程：

1. **检查数据目录**：自动创建 `data/`、`config/`、`logs/` 目录
2. **初始化 SQLite**：创建 `mcagent.db` 并建立必要的数据表
3. **启动 TCP 服务**：在默认端口 `27541` 开始监听
4. **打开配置向导**：引导用户配置 LLM Provider
5. **等待连接**：显示主界面，等待 Adapter Core 实例连接

```
首次启动流程：
  ┌──────────────────┐
  │   启动应用        │
  └──────┬───────────┘
         ▼
  ┌──────────────────┐
  │ 检查/创建目录结构  │
  └──────┬───────────┘
         ▼
  ┌──────────────────┐
  │ 初始化 SQLite 数据库│
  └──────┬───────────┘
         ▼
  ┌──────────────────┐
  │ 启动 TCP 服务端    │  ← 监听 27541 端口
  └──────┬───────────┘
         ▼
  ┌──────────────────┐
  │  LLM Provider 配置 │  ← 配置向导
  └──────┬───────────┘
         ▼
  ┌──────────────────┐
  │   主界面就绪      │  ← 等待 Adapter Core 连接
  └──────────────────┘
```

### 5.2 日志

#### 日志文件位置

所有日志文件默认存储在 `logs/` 目录：

```
logs/
├── app.log              # 应用运行日志（info 及以上级别）
├── error.log            # 错误日志（error 级别）
├── llm.log              # LLM 调用日志（对话内容、 tokens 消耗）
├── tcp.log              # TCP 通信日志（连接、消息、心跳）
└── memory.log           # 记忆操作日志（存储、检索、清理）
```

#### 日志级别配置

```yaml
# config/settings.yaml
logging:
  level: info                       # 全局日志级别
  # 可选值: debug | info | warning | error | silent
  modules:
    app: info                       # 应用日志级别
    llm: info                       # LLM 日志级别
    tcp: debug                      # TCP 通信日志级别
    memory: info                    # 记忆系统日志级别
  console: true                     # 是否同时输出到控制台
  file: true                        # 是否写入文件
```

#### 日志轮转

日志轮转按文件大小自动触发：

```yaml
# config/settings.yaml
logging:
  rotation:
    max_size: 50MB                  # 单个日志文件最大大小
    max_files: 10                   # 保留的最大文件数
    compress: true                  # 是否压缩历史日志
```

当日志文件达到 `max_size` 时，自动重命名并创建新文件。历史日志超过 `max_files` 数量时自动删除最旧的。

### 5.3 状态监控

Agent Core 提供实时状态监控功能，通过 UI 面板可视化展示。

#### 工作区状态

| 状态 | 图标色 | 说明 |
|------|--------|------|
| 在线 (online) | 绿色 | Adapter Core 已连接，工具已注册，心跳正常 |
| 连接中 (connecting) | 黄色 | 正在尝试建立 TCP 连接 |
| 离线 (offline) | 红色 | 连接已断开，未检测到心跳 |

每个工作区面板显示：

- 实例名称和版本信息
- TCP 连接状态和延迟
- 已注册工具数量
- 最后活动时间
- 会话消息数

#### LLM 调用统计

UI 面板实时显示 LLM 调用数据：

| 指标 | 说明 |
|------|------|
| Tokens 消耗 | 输入/输出 tokens 计数，支持按时间范围统计 |
| 调用耗时 | 每次 LLM API 调用的响应时间 |
| 模型使用分布 | 各模型被调用的次数和占比 |
| 错误率 | API 调用失败次数和占比 |
| 费用估算 | 基于模型单价估算的累计费用（需配置单价） |

#### 任务队列状态

| 指标 | 说明 |
|------|------|
| 待处理任务数 | 队列中等待执行的任务数量 |
| 执行中任务数 | 当前正在执行的任务数量 |
| 已完成任务数 | 当日/当周完成的任务计数 |
| 失败任务数 | 执行失败的任务计数 |
| 平均执行时间 | 任务的平均完成耗时 |

#### 记忆存储使用量

| 指标 | 说明 |
|------|------|
| SQLite 记录数 | 结构化记忆的总条目数 |
| Chroma 向量数 | 向量数据库中的嵌入向量数量 |
| 存储空间占用 | 数据库文件和数据目录的磁盘占用 |
| 记忆类型分布 | 各类记忆（角色/环境/经验/知识等）的数量分布 |

---

## 第6章 常见问题

### 6.1 Provider 连接失败

**现象**：启动后 LLM 调用一直超时或返回连接错误。

**排查步骤**：

1. 检查 `config/llm.yaml` 中的 `api_key` 是否正确
2. 检查 `base_url` 地址是否可达：
   ```bash
   # 测试网络连通性
   curl -I https://api.openai.com/v1
   curl -I http://localhost:11434
   ```
3. 检查网络代理设置：如使用代理，需确认代理已正确配置系统环境变量 `HTTP_PROXY` / `HTTPS_PROXY`
4. 查看 `logs/llm.log` 中的详细错误信息
5. 确认 API 账户余额充足（云端 API）

**解决方案**：

| 问题 | 解决 |
|------|------|
| API Key 无效 | 重新生成并更新配置文件 |
| 网络不可达 | 检查防火墙、代理设置 |
| 模型不存在 | 确认模型名称正确（如 Ollama 需先 `ollama pull`） |
| 速率限制 | 降低请求频率，或升级 API 套餐 |

### 6.2 TCP 端口被占用

**现象**：启动时提示 `EADDRINUSE` 错误，TCP 服务无法启动。

**排查步骤**：

```bash
# 查看端口占用情况
# Windows
netstat -ano | findstr :27541

# macOS / Linux
lsof -i :27541
```

**解决方案**：

1. 终止占用进程：
   ```bash
   # Windows
   taskkill /PID <PID> /F
   
   # macOS / Linux
   kill -9 <PID>
   ```
2. 或修改 Agent Core 监听端口：

```yaml
# config/settings.yaml
tcp_server:
  host: 127.0.0.1
  port: 27542                       # 改为其他未被占用的端口
```

> **注意**：修改端口后，需同步更新 Adapter Core 的 `mcagent_instance.json` 中的 `agent_core.port`。

### 6.3 SQLite 文件锁定

**现象**：启动时提示 `SQLITE_BUSY` 或数据库操作超时。

**原因**：多个进程同时写同一个 SQLite 文件，或上一次非正常退出导致 WAL 文件未清理。

**解决方案**：

1. 确保只有一个 Agent Core 实例在运行
2. 删除 WAL 相关文件（如数据无异常）：
   ```
   data/
   ├── mcagent.db
   ├── mcagent.db-wal                  # 删除此文件
   └── mcagent.db-shm                  # 删除此文件
   ```
3. 如问题持续，检查 `data/mcagent.db` 文件权限
4. 建议启用 WAL 模式（默认已启用）以提升并发性能

### 6.4 内存不足

**现象**：运行一段时间后应用卡顿，或操作系统提示内存不足。

**原因**：LLM 对话上下文累积过多，或 ChromaDB 占用大量内存。

**解决方案**：

| 措施 | 说明 |
|------|------|
| 限制上下文窗口 | 在配置中降低 `max_context_tokens`（默认 4096） |
| 启用滑动窗口 | 限制保留的对话轮数（如最近 20 轮） |
| 关闭 ChromaDB | 如不使用向量检索，设置 `chroma.enabled: false` |
| 升级硬件 | 推荐 8 GB 以上内存 |
| 定期重启 | 定期重启 Agent Core 释放内存 |

### 6.5 ChromaDB 连接异常

**现象**：记忆检索失败，日志显示 ChromaDB 连接错误。

**排查步骤**：

1. 确认 ChromaDB 配置正确：
   - `persistent` 模式：检查 `persistent_path` 目录是否存在且可写
   - `http` 模式：确认 ChromaDB 服务正在运行：`curl http://localhost:8000/api/v1/heartbeat`
2. 查看 `logs/memory.log` 中的详细错误

**解决方案**：

| 问题 | 解决 |
|------|------|
| 目录权限不足 | 确保 `data/chroma/` 目录可读写 |
| 版本不兼容 | 检查 ChromaDB 客户端与服务端版本匹配 |
| 服务未启动（HTTP 模式） | 启动 ChromaDB 服务：`chroma run --path /path/to/chroma_data` |
| 数据损坏 | 删除 `data/chroma/` 目录重新初始化（注意：会丢失向量数据） |

---

## 第7章 更新与卸载

### 7.1 更新流程

Agent Core 支持版本升级，推荐按以下步骤操作：

1. **备份配置和数据**（重要）：

```bash
# 备份整个数据目录
cp -r data/ data_backup/
cp -r config/ config_backup/
```

2. **下载新版本**：
   - 从发布页面下载对应平台的最新安装包
   - 或通过源码更新：`git pull` 后重新 `npm run build`

3. **安装新版本**：
   - **Windows**：运行新的 `.exe` 安装程序，建议安装到同一目录
   - **macOS**：挂载新的 `.dmg`，将应用拖入 Applications 覆盖旧版本
   - **Linux**：运行新的 `.AppImage` 覆盖旧文件

   > **安装程序会自动保留 `data/` 和 `config/` 目录**，数据不会丢失。

4. **验证升级**：
   - 启动新版本
   - 检查日志中是否显示版本号已更新
   - 确认所有工作区连接正常
   - 测试 LLM 调用和工具执行

### 7.2 数据迁移

Agent Core 的用户数据全部存储在 `data/` 和 `config/` 目录中，**不会因版本更新被覆盖**。

如需迁移到另一台机器：

```bash
# 源机器打包数据
tar -czf mcagent-data.tar.gz data/ config/

# 目标机器解压到 Agent Core 安装目录的相应位置
tar -xzf mcagent-data.tar.gz -C /path/to/mcagent/
```

迁移后需检查：

- `config/llm.yaml` 中的 API Key 是否有效
- `mcagent.db` 文件是否可正常读取
- ChromaDB 数据是否完整

### 7.3 卸载

#### Windows

1. 打开 **设置 → 应用 → 安装的应用**
2. 找到 **McAgent**，点击卸载
3. 系统会提示是否保留用户数据

#### macOS

将 Applications 中的 McAgent 拖入废纸篓即可。

#### 保留数据目录

卸载程序会询问是否删除用户数据目录。建议**选择保留**，以防将来重新安装：

```
# 需手动确认的数据目录
data/
├── mcagent.db          # 数据库（记忆、配置、任务存档）
├── chroma/             # ChromeDB 向量数据
└── exports/            # 导出文件

config/
├── llm.yaml            # LLM Provider 配置
└── settings.yaml       # 应用设置
```

如需完全清除所有数据，在卸载后手动删除：

- **Windows**：`%APPDATA%\McAgent\`
- **macOS**：`~/Library/Application Support/McAgent/`
- **Linux**：`~/.config/McAgent/`

### 7.4 配置备份建议

定期备份配置和数据是良好的运维习惯：

| 备份内容 | 路径 | 频率 | 说明 |
|----------|------|------|------|
| LLM 配置 | `config/llm.yaml` | 每次修改后 | 包含 API Key，需安全存储 |
| 应用设置 | `config/settings.yaml` | 每次修改后 | 工作区映射、日志级别等 |
| SQLite 数据库 | `data/mcagent.db` | 每周 | 记忆数据、任务存档 |
| ChromaDB | `data/chroma/` | 每月 | 向量数据量通常较大 |

> **安全提示**：`config/llm.yaml` 中包含 LLM API Key，建议：
> - 不将配置文件提交到版本控制系统
> - 使用环境变量替代明文 API Key（如已支持）
> - 备份时注意存储位置的安全性

---

## 附录A：命令行参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `--data-dir` | 指定数据目录 | `--data-dir ./my_data` |
| `--config` | 指定配置文件 | `--config ./my_config/settings.yaml` |
| `--port` | 指定 TCP 端口 | `--port 27541` |
| `--dev` | 开发模式 | `--dev` |
| `--instance` | 指定实例配置文件路径 | `--instance /path/to/mcagent_instance.json` |
| `--disable-gpu` | 禁用 GPU 加速（兼容性问题时使用） | `--disable-gpu` |

## 附录B：环境变量

| 变量 | 说明 | 优先级 |
|------|------|--------|
| `MCAGENT_DATA_DIR` | 数据目录路径 | 高于 `--data-dir` |
| `MCAGENT_CONFIG_DIR` | 配置目录路径 | 高于 `--config` |
| `MCAGENT_TCP_PORT` | TCP 监听端口 | 高于 `--port` |
| `HTTP_PROXY` | HTTP 代理（用于 LLM API 请求） | 系统标准变量 |
| `HTTPS_PROXY` | HTTPS 代理 | 系统标准变量 |
| `NODE_ENV` | Node.js 运行环境（`production` / `development`） | 影响日志输出格式 |