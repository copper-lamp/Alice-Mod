# AC-V25: NapCat Docker 化重构 — 设计文档

## 1. 背景与动机

### 1.1 当前方案的问题

当前 NapCat 集成采用**进程托管模式**（`NapCatManager`），在 Electron 主进程中直接管理 NapCat 子进程，存在以下问题：

| 问题 | 描述 | 严重程度 |
|------|------|----------|
| **Windows 强依赖** | 整个 NapCatManager 模块（~1332 行）几乎全部针对 Windows 开发，包括 launcher.bat 生成、Hook DLL 注入、taskkill 进程树清理、PowerShell 解压等。macOS/Linux 用户无法使用。 | 致命 |
| **进程管理复杂** | 需要手动管理子进程生命周期：spawn、SIGTERM、SIGKILL、进程树清理、端口释放检测、崩溃恢复（最多 5 次重启）、WebUI 就绪轮询（120s 超时）等。 | 高 |
| **多账号冲突** | 每个账号需要分配独立端口（OneBot + WebUI），需要 per-account launcher.bat、per-account 工作目录，还需避免 Hook DLL 冲突。当前甚至限制了单账号运行。 | 高 |
| **下载与安装** | 内置了完整的下载引擎（aria2c → curl → Node 多连接分块下载 → fetch），以及 GitHub + 3 个国内镜像的多通道容错，代码量巨大且维护成本高。 | 中 |
| **WebUI 认证** | 需要 SHA256 哈希 + salt 认证、Token 管理、2FA 检测，增加了复杂度。 | 中 |
| **崩溃恢复脆弱** | 进程崩溃后自动重启，但 NapCat 状态不可靠（残留进程、端口被占用、配置冲突），容易陷入"崩溃→重启→再崩溃"循环。 | 高 |
| **环境隔离差** | NapCat 直接在宿主机运行，与 QQ 进程共享环境，Hook DLL 注入 QQ.exe 存在稳定性风险。 | 中 |

### 1.2 Docker 方案的优势

| 维度 | 当前方案 | Docker 方案 |
|------|----------|-------------|
| **跨平台** | 仅 Windows | 全平台（Win/Mac/Linux） |
| **进程管理** | 手动 spawn/kill/restart/crash recovery | `docker run/stop/restart`，Docker 守护进程自动管理 |
| **多账号** | 端口分配、独立目录、launcher.bat 生成 | 每个容器独立端口映射，天然隔离 |
| **安装** | 内置下载引擎 + 解压 + 配置生成 | `docker pull` 一行命令 |
| **更新** | 重新下载 zip + 解压替换 | `docker pull` 新镜像 |
| **环境隔离** | 与宿主机共享 | 完整容器隔离 |
| **稳定性** | 进程崩溃需手动恢复 | Docker 自动重启策略（`--restart=always`） |
| **资源管理** | 无限制 | CPU/内存限制（`--cpus` / `--memory`） |
| **日志** | 文件 + 回调 | `docker logs` + 日志驱动 |

## 2. 当前架构分析

### 2.1 当前模块关系

```
┌─────────────────────────────────────────────────────┐
│                   Electron 主进程                      │
│                                                       │
│  ┌────────────────────────────────────────────────┐  │
│  │              qq-bot-handler.ts                   │  │
│  │  ┌──────────────────────────────────────────┐   │  │
│  │  │  NapCatManager (进程管理)                  │   │  │
│  │  │  ├─ 下载/安装/配置生成                     │   │  │
│  │  │  ├─ spawn/kill/restart                    │   │  │
│  │  │  ├─ WebUI 认证 + QR 扫码                  │   │  │
│  │  │  └─ 崩溃恢复                              │   │  │
│  │  └──────────────────────────────────────────┘   │  │
│  │  ┌──────────────────────────────────────────┐   │  │
│  │  │  NapCat 子进程 (第三方)                    │   │  │
│  │  │  ├─ launcher.bat → QQ.exe + Hook DLL     │   │  │
│  │  │  ├─ OneBot WebSocket 服务 (127.0.0.1)    │   │  │
│  │  │  └─ WebUI HTTP 服务 (127.0.0.1)          │   │  │
│  │  └──────────────────────────────────────────┘   │  │
│  └────────────────────────────────────────────────┘  │
│                                                       │
│  ┌────────────────────────────────────────────────┐  │
│  │              integration.ts                     │  │
│  │  ┌──────────────────────────────────────────┐   │  │
│  │  │  OneBotClient (WebSocket 客户端)           │   │  │
│  │  │  ├─ connect/disconnect                    │   │  │
│  │  │  ├─ 消息收发 (sendGroupMsg/sendPrivateMsg) │   │  │
│  │  │  ├─ 心跳 + 自动重连                        │   │  │
│  │  │  └─ 事件转发                              │   │  │
│  │  └──────────────────────────────────────────┘   │  │
│  │  ┌──────────────────────────────────────────┐   │  │
│  │  │  MessageHandler + QQSubAgent + ...        │   │  │
│  │  └──────────────────────────────────────────┘   │  │
│  └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 2.2 当前代码量统计

| 模块 | 文件 | 行数 | 影响 |
|------|------|------|------|
| `NapCatManager` | `napcat-manager.ts` | ~1332 | **核心重写对象** |
| `qq-bot-handler.ts` | IPC handler | ~1061 | **大幅简化**（NapCat 管理相关代码） |
| `OneBotClient` | `onebot-client.ts` | ~403 | 基本不变 |
| `integration.ts` | 集成模块 | ~369 | 小幅调整 |
| `config.ts` | 配置管理 | ~88 | 修改配置结构 |
| `types.ts` | 类型定义 | ~273 | 修改配置类型 |

## 3. Docker 方案设计

### 3.1 目标架构

```
┌─────────────────────────────────────────────────────┐
│                   Electron 主进程                      │
│                                                       │
│  ┌────────────────────────────────────────────────┐  │
│  │              qq-bot-handler.ts                   │  │
│  │  ┌──────────────────────────────────────────┐   │  │
│  │  │  DockerContainerManager (新增)            │   │  │
│  │  │  ├─ docker pull (安装/更新)               │   │  │
│  │  │  ├─ docker run/stop/restart               │   │  │
│  │  │  ├─ 端口映射管理                           │   │  │
│  │  │  ├─ 容器健康检查                           │   │  │
│  │  │  ├─ 日志流 (docker logs → 回调)           │   │  │
│  │  │  └─ QR 扫码 (通过容器内 WebUI)            │   │  │
│  │  └──────────────────────────────────────────┘   │  │
│  │                               ▲                  │  │
│  │                               │ docker CLI       │  │
│  └───────────────────────────────┼──────────────────┘  │
│                                  │                      │
│  ┌───────────────────────────────┼──────────────────┐  │
│  │  Docker 守护进程               │                  │  │
│  │  ┌────────────────────────────┴──────────────┐  │  │
│  │  │  NapCat 容器 (ghcr.io/napneko/napcat:latest) │  │  │
│  │  │  ├─ 独立 Alpine Linux 环境                  │  │  │
│  │  │  ├─ QQ 进程 (容器内)                        │  │  │
│  │  │  ├─ OneBot WebSocket :3001 → 宿主机 :3001   │  │  │
│  │  │  └─ WebUI HTTP :6099 → 宿主机 :6099        │  │  │
│  │  └──────────────────────────────────────────┘  │  │
│  │  ┌──────────────────────────────────────────┐  │  │
│  │  │  NapCat 容器 (账号2)                       │  │  │
│  │  │  ├─ OneBot :3001 → 宿主机 :3002           │  │  │
│  │  │  └─ WebUI :6099 → 宿主机 :6100            │  │  │
│  │  └──────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────┘  │
│                                                       │
│  ┌────────────────────────────────────────────────┐  │
│  │  OneBotClient (不变)                            │  │
│  │  └─ ws://127.0.0.1:3001 (映射到容器)            │  │
│  └────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────┐  │
│  │  integration.ts (不变)                          │  │
│  └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 3.2 核心组件：`DockerContainerManager`

#### 3.2.1 职责

替换 `NapCatManager` 的全部功能，通过 Docker CLI 或 Dockerode SDK 管理 NapCat 容器。

#### 3.2.2 接口设计

```typescript
// 容器状态
type ContainerStatus = 'idle' | 'pulling' | 'starting' | 'running' | 'stopping' | 'error'

// 容器管理选项
interface DockerContainerOptions {
  containerName: string       // 容器名称，如 napcat-<accountId>
  image: string               // 镜像，默认 ghcr.io/napneko/napcat:latest
  account?: string            // QQ 号（可选，用于快速登录）
  oneBotPort: number          // 宿主机 OneBot 端口映射
  webUiPort: number           // 宿主机 WebUI 端口映射
  webUiToken?: string         // WebUI Token
  accessToken?: string        // OneBot 鉴权 Token
  cpuLimit?: string           // CPU 限制，如 "1.5"
  memoryLimit?: string        // 内存限制，如 "512M"
  restartPolicy?: string      // 重启策略，默认 "unless-stopped"
  onLog?: (line: string) => void
  onStatusChange?: (status: ContainerStatus) => void
}

class DockerContainerManager {
  // ── 生命周期 ──
  async pull(): Promise<void>                // docker pull 镜像
  async start(): Promise<void>               // docker run（或 docker start）
  async stop(): Promise<void>                // docker stop
  async restart(): Promise<void>             // docker restart
  async remove(): Promise<void>              // docker rm

  // ── 状态查询 ──
  getStatus(): ContainerStatus
  isRunning(): Promise<boolean>              // docker inspect
  getContainerId(): Promise<string | null>   
  getLogs(): string[]                        // 缓存的日志行

  // ── QR 扫码登录 ──
  async getQRCode(): Promise<QRCodeResult>         // 通过 WebUI API
  async checkLoginStatus(): Promise<LoginStatusResult>
  async getLoginInfo(): Promise<QQLoginInfo | null>

  // ── 端口映射 ──
  getOneBotPort(): number
  getWebUiPort(): number

  // ── 健康检查 ──
  async healthCheck(): Promise<boolean>      // 检查 WebUI 是否就绪
}
```

#### 3.2.3 实现要点

**Docker 交互方式**：使用 `dockerode` npm 包（Node.js Docker 客户端），而非直接调用 docker CLI。原因：
- 类型安全 (TypeScript)
- 无需解析 CLI 输出
- 流式日志支持
- 更好的错误处理

**镜像选择**：
- 官方镜像：`ghcr.io/napneko/napcat:latest`
- 支持版本标签：`latest`, `v4.18.9`, `v4.19.0` 等
- 首次使用自动 `docker pull`

**容器启动参数**：
```bash
docker run -d \
  --name napcat-<accountId> \
  --restart unless-stopped \
  -p <oneBotPort>:3001 \
  -p <webUiPort>:6099 \
  -e ACCOUNT=<qqNumber> \       # 可选，快速登录
  -e WEBUI_TOKEN=<token> \      # WebUI 鉴权
  -e ACCESS_TOKEN=<token> \     # OneBot 鉴权
  -v <dataDir>:/app/.config/QQ \  # 持久化登录态
  ghcr.io/napneko/napcat:latest
```

**数据持久化**：
- 将容器内 `/app/.config/QQ` 挂载到宿主机 `Alice/qq-bot/napcat-data/<accountId>/`
- 这样容器重启后登录态不丢失，无需重新扫码

**日志流**：
- 使用 `dockerode.getContainer().logs({ follow: true, stdout: true, stderr: true })` 获取实时日志
- 转换为 `onLog` 回调

**QR 扫码**：
- 容器启动后，NapCat 自动在容器内启动 WebUI 服务
- 通过 `http://127.0.0.1:<webUiPort>` 访问 WebUI API（与当前方案一致）
- 无需再处理 SHA256 认证（WebUI 默认可通过 `WEBUI_TOKEN` 环境变量配置）

### 3.3 需要修改的文件

| 文件 | 修改类型 | 说明 |
|------|----------|------|
| **新增** `docker-container-manager.ts` | 新增 | Docker 容器管理器，替换 NapCatManager |
| `qq-bot-handler.ts` | 重构 | 移除 NapCatManager 相关代码，改用 DockerContainerManager |
| `config.ts` | 修改 | 移除 managed 模式，新增 docker 配置 |
| `types.ts` | 修改 | 更新 QQBotConfig 类型，移除 managed 相关字段 |
| `index.ts` (qq-bot) | 修改 | 导出 DockerContainerManager 替代 NapCatManager |
| `napcat-manager.ts` | **删除** | 整个文件标记为废弃，过渡期后删除 |
| `package.json` | 修改 | 新增 `dockerode` 依赖 |
| `main/index.ts` | 微调 | 初始化流程中的 QQ 机器人启动部分 |

### 3.4 不受影响（无需修改）的文件

| 文件 | 原因 |
|------|------|
| `onebot-client.ts` | 纯 WebSocket 客户端，与 NapCat 运行方式无关 |
| `integration.ts` | 只关心 OneBotClient，不关心 NapCat 如何运行 |
| `message-router.ts` | 纯消息路由逻辑 |
| `message-handler.ts` | 消息处理中枢，与 NapCat 无关 |
| `qq-sub-agent.ts` | Sub-Agent 逻辑 |
| `qq-agent.ts` | MainAgent 子类 |
| `permission.ts` | 权限控制 |
| `message-bridge.ts` | 桥接逻辑 |
| `proactive-notifier.ts` | 主动通知 |
| `remote-command-parser.ts` | 远程指令解析 |
| `main-agent-queue.ts` | 双 Agent 通信队列 |
| `qq-store.ts` | 持久化存储 |
| `qq-trigger-adapter.ts` | 触发器适配器 |

### 3.5 配置结构变更

#### 当前配置（types.ts）

```typescript
export interface QQBotConfig {
  mode: 'managed' | 'external';  // 托管模式或外部模式

  managed?: {                     // 托管模式配置
    account: string;
    autoStart: boolean;
    autoUpdate: boolean;
  };

  external?: {                    // 外部模式配置
    wsHost: string;
    wsPort: number;
    wsProtocol: 'ws' | 'wss';
    accessToken: string;
  };
  // ...
}
```

#### 新配置

```typescript
export interface QQBotConfig {
  mode: 'docker' | 'external';   // Docker 模式或外部模式

  docker?: {                      // Docker 模式配置
    account: string;              // QQ 号
    image: string;                // 镜像，默认 ghcr.io/napneko/napcat:latest
    version?: string;             // 版本标签
    oneBotPort?: number;          // 宿主机 OneBot 端口（默认自动分配）
    webUiPort?: number;           // 宿主机 WebUI 端口（默认自动分配）
    webUiToken?: string;          // WebUI Token
    accessToken?: string;         // OneBot 鉴权 Token
    cpuLimit?: string;            // CPU 限制，如 "1.5"
    memoryLimit?: string;         // 内存限制，如 "512M"
    dataDir?: string;             // 持久化数据目录（默认 Alice/qq-bot/napcat-data/）
    autoStart: boolean;           // 自动启动
    autoUpdate: boolean;          // 自动更新镜像
  };

  external?: {                    // 外部模式（不变）
    wsHost: string;
    wsPort: number;
    wsProtocol: 'ws' | 'wss';
    accessToken: string;
  };
  // ...
}
```

### 3.6 数据流对比

#### 当前 NapCat 启动流程

```
用户点击"启用" → ensureManagedConnection()
  → getOrCreateNapCatManager()
    → ensureAccountLauncherBatch()  // 生成 per-account launcher.bat
    → new NapCatManager()
  → manager.start()
    → forceKillNapCatProcesses()    // 强制清理残留进程
    → waitForPortFree()             // 等待端口释放
    → ensureExecutable()            // 确保可执行文件存在
      → downloadRelease()           // 可能需要下载
    → writeOneBotConfig()           // 生成 onebot11.json
    → writeWebUiConfig()            // 生成 webui.json
    → spawnProcess()                // 启动子进程
    → waitForWebUiReady()           // 等待 WebUI 就绪（120s 轮询）
    → authenticateWebUi()           // SHA256 认证
  → delay(2000)                     // 等待 WS 就绪
  → connectOneBot()                 // OneBotClient 连接
```

#### Docker 启动流程

```
用户点击"启用" → ensureDockerConnection()
  → getOrCreateContainerManager()
    → new DockerContainerManager()
  → manager.start()
    → manager.pull()                // docker pull（如果镜像不存在）
    → docker run ...                // 一行命令启动容器
    → waitForWebUiReady()           // 等待 WebUI 就绪（简化版）
  → connectOneBot()                 // OneBotClient 连接（不变）
```

**简化效果**：从 ~15 步减少到 ~5 步，且无需处理进程管理、端口释放、配置文件生成、认证等复杂逻辑。

## 4. 详细实现计划

### 4.1 Phase 1: 基础 Docker 容器管理（核心）

**目标**：实现 `DockerContainerManager`，支持容器的拉取、启动、停止、删除。

**文件**：
- 新增 `packages/agent-core/src/main/qq-bot/docker-container-manager.ts`

**实现内容**：
1. 安装 `dockerode` 依赖
2. 实现 `DockerContainerManager` 类
   - `pull()`: 调用 `dockerode.pull()` 拉取镜像，带进度回调
   - `start()`: 调用 `dockerode.createContainer()` + `container.start()`
   - `stop()`: 调用 `container.stop()` + `container.wait()`
   - `remove()`: 调用 `container.remove()`
   - `restart()`: 调用 `container.restart()`
   - `isRunning()`: 调用 `container.inspect()`
   - `getContainerId()`: 返回容器 ID
   - 日志流：`container.logs({ follow: true })` → `onLog` 回调
3. 实现 `waitForWebUiReady()`: 简化版，轮询 `http://127.0.0.1:<port>/api/auth/check`
4. 实现 QR 扫码相关 API（通过 WebUI API，与当前方案一致）

**测试**：
- 单元测试：mock dockerode，验证容器生命周期调用
- 集成测试：需要 Docker 守护进程，验证容器实际启动

### 4.2 Phase 2: IPC Handler 重构

**目标**：将 `qq-bot-handler.ts` 中的 NapCatManager 相关代码替换为 DockerContainerManager。

**文件**：
- 修改 `packages/agent-core/src/main/ipc/qq-bot-handler.ts`

**实现内容**：
1. 将 `napCatInstances` Map 替换为 `dockerContainers` Map
2. 重写 `getOrCreateNapCatManager()` → `getOrCreateDockerContainer()`
3. 重写 `ensureManagedConnection()` → `ensureDockerConnection()`
4. 简化 `start-qr-login` / `check-qr-login` / `cancel-qr-login` handler
5. 移除以下函数的 NapCat 相关逻辑：
   - `destroyNapCatManager()` → `destroyDockerContainer()`
   - `scheduleNapCatStop()` / `cancelNapCatStop()` → 简化（Docker restart 策略由 `--restart` 处理）
   - `forceKillNapCatProcesses()` → **完全移除**
   - `ensureAccountLauncherBatch()` → **完全移除**
   - `loadNapCatSettings()` / `saveNapCatSettings()` → **移除**
   - `isNapCatInstalled()` → `isDockerAvailable()`（检查 Docker 是否安装）
   - `assignPorts()` → 简化（由 Docker 自动处理端口映射）
   - `findTempPort()` → 简化
6. 更新 `autoStartQQBotAccounts()` 使用 Docker 方案

**测试**：
- 单元测试：mock DockerContainerManager，验证 IPC handler 逻辑
- 手动测试：启动应用，验证 QR 登录流程

### 4.3 Phase 3: 配置更新

**目标**：更新配置结构和相关模块。

**文件**：
- 修改 `packages/agent-core/src/main/qq-bot/types.ts`
- 修改 `packages/agent-core/src/main/qq-bot/config.ts`
- 修改 `packages/agent-core/src/main/qq-bot/index.ts`

**实现内容**：
1. `types.ts`:
   - `QQBotConfig.mode` 新增 `'docker'` 值
   - 新增 `DockerConfig` 接口
   - 标记 `managed` 字段为 `@deprecated`
2. `config.ts`:
   - 更新 `DEFAULT_QQ_BOT_CONFIG` 默认模式为 `docker`
   - 更新 `validateConfig()` 支持 docker 模式验证
   - 更新 `buildWsUrl()` 处理 docker 模式
3. `index.ts`:
   - 导出 `DockerContainerManager` 替代 `NapCatManager`
   - 保留 `NapCatManager` 导出（兼容期）

### 4.4 Phase 4: 清理与迁移

**目标**：清理旧代码，编写迁移脚本。

**文件**：
- 标记 `napcat-manager.ts` 为 `@deprecated`
- 可选：编写迁移脚本，将现有 managed 配置迁移到 docker 配置

**实现内容**：
1. 在 `napcat-manager.ts` 文件顶部添加 `@deprecated` 注释
2. 编写 `config-migration.ts` 工具函数：
   - `migrateManagedToDocker(config: QQBotConfig): QQBotConfig`
   - 将 `managed.account` 映射到 `docker.account`
   - 设置默认值
3. 在 `autoStartQQBotAccounts()` 中检测旧配置并自动迁移

## 5. 配置项详解

### 5.1 Docker 环境要求

| 要求 | 说明 |
|------|------|
| Docker Engine | 需安装 Docker Desktop（Win/Mac）或 Docker Engine（Linux） |
| Docker CLI | 需要在系统 PATH 中可用 |
| 网络 | 容器需要访问 QQ 服务器（外网） |

### 5.2 默认镜像

```
ghcr.io/napneko/napcat:latest
```

NapCat 官方提供的 Docker 镜像，基于 Alpine Linux，仅包含 NapCat Shell（不含 QQ 本体），启动时自动在容器内下载 QQ。

### 5.3 数据持久化目录

```
Alice/qq-bot/napcat-data/
├── <accountId>/
│   ├── config/                    # NapCat 配置
│   ├── cache/                     # 缓存
│   └── QQ/                        # QQ 登录态（关键）
│       └── ...                    # QQ 账号数据
└── <accountId2>/
    └── ...
```

关键：`/app/.config/QQ` 目录持久化后，容器重启无需重新扫码登录。

### 5.4 环境变量说明

| 环境变量 | 说明 | 默认值 |
|----------|------|--------|
| `ACCOUNT` | QQ 号（可选，快速登录） | 无 |
| `WEBUI_TOKEN` | WebUI 鉴权 Token | 自动生成 |
| `ACCESS_TOKEN` | OneBot WebSocket 鉴权 Token | 空 |
| `NAPCAT_UID` | 容器内用户 UID | 自动 |
| `NAPCAT_GID` | 容器内用户 GID | 自动 |

## 6. 错误处理

### 6.1 Docker 不可用

场景：Docker 未安装或未运行。

处理：
1. 调用 `docker info` 检测 Docker 是否可用
2. 不可用时，在 `start()` 中抛出明确错误信息
3. 前端提示：请安装 Docker Desktop 并确保 Docker 正在运行
4. 提供 Docker 官方下载链接

### 6.2 镜像拉取失败

场景：网络问题导致无法拉取镜像。

处理：
1. 支持国内镜像加速（配置 `registry-mirrors`）
2. 提供离线镜像导入指引
3. 回退到外部模式（连接已有 NapCat 实例）

### 6.3 容器启动失败

场景：端口冲突、配置错误等。

处理：
1. 自动检测并释放端口冲突
2. 读取容器日志帮助定位问题
3. 提供 `docker logs <container>` 的等效命令给用户

### 6.4 容器崩溃

场景：NapCat 在容器内崩溃。

处理：
1. 依赖 `--restart=unless-stopped` 策略自动重启
2. 监控容器状态，检测到重启后重置 OneBotClient 连接
3. 超过 3 次重启后报警

## 7. 与现有方案的兼容性

### 7.1 外部模式不变

`external` 模式（连接外部已有 NapCat 实例）保持不变，用户仍可：
- 手动启动 NapCat
- 配置 WebSocket 地址和端口
- 连接远程 NapCat 实例

### 7.2 迁移路径

| 当前状态 | 迁移方式 |
|----------|----------|
| 使用托管模式（managed） | 自动迁移到 docker 模式，保留 QQ 号和配置 |
| 使用外部模式（external） | 不变，继续使用外部模式 |
| 新用户 | 默认使用 docker 模式 |
| 已有扫码登录的账号 | 迁移数据目录，保留登录态无需重新扫码 |

### 7.3 过渡期

- Phase 1-3 完成后，docker 成为默认模式
- `managed` 模式保留 1 个版本作为过渡，标记为 `@deprecated`
- 下一版本移除 `managed` 模式和 `NapCatManager`

## 8. 与现有模块的接口契约

### 8.1 OneBotClient 不变

`OneBotClient` 的接口完全不依赖 NapCat 的运行方式，无论 NapCat 是进程还是容器，OneBotClient 都通过 WebSocket 连接：

```typescript
// 不变 —— 无论 NapCat 如何运行
const client = new OneBotClient({ wsUrl: 'ws://127.0.0.1:3001' })
await client.connect()
client.onMessage((msg) => { ... })
```

### 8.2 MessageRouter 不变

`message-router.ts` 只关心 OneBotClient 和 Agent 绑定关系，不关心 NapCat 如何运行：

```typescript
// 不变
routeQQMessageToAgent(accountId, msg, client)
```

### 8.3 Integration 不变

`integration.ts` 只依赖 `OneBotClient`，完全独立于 NapCat 管理方式。

## 9. 与 AC-V24 链路整合的关系

AC-V24 完成了端到端链路整合，包括：
- `message-router.ts` 路由 QQ 消息到 Agent
- `MainAgent` 预热机制
- 数据持久化到模组目录
- QQ 绑定管理

本次重构（AC-V25）仅替换 NapCat 运行方式（进程 → Docker），不影响 AC-V24 建立的链路和数据流。AC-V24 的所有成果保留。

## 10. 验收标准

### 10.1 功能性验收

| # | 验收项 | 预期结果 |
|---|--------|----------|
| 1 | Docker 环境检测 | 应用能检测 Docker 是否安装并运行 |
| 2 | 镜像拉取 | 首次启动自动 `docker pull` 镜像 |
| 3 | 容器启动 | 一键启动 NapCat 容器 |
| 4 | 二维码登录 | 通过 WebUI API 获取二维码并扫码登录 |
| 5 | 消息收发 | 登录后 OneBotClient 连接成功，消息正常收发 |
| 6 | 容器停止 | 停止账号后容器正常停止 |
| 7 | 多账号运行 | 同时启动 2 个以上 NapCat 容器，互不冲突 |
| 8 | 容器重启 | 容器崩溃后 Docker 自动重启 |
| 9 | 数据持久化 | 重启容器后登录态保留，无需重新扫码 |
| 10 | 外部模式 | 外部模式仍可正常使用 |

### 10.2 代码质量验收

| # | 验收项 | 标准 |
|---|--------|------|
| 1 | 删除代码量 | 移除 `napcat-manager.ts`（~1332 行）及相关进程管理代码 |
| 2 | 新增代码量 | `DockerContainerManager` 不超过 500 行 |
| 3 | 测试覆盖率 | 新增代码单元测试覆盖率 >= 80% |
| 4 | 类型安全 | TypeScript 编译零错误 |

## 11. 修改文件清单

### 新增文件

| 文件 | 预计行数 | 说明 |
|------|----------|------|
| `packages/agent-core/src/main/qq-bot/docker-container-manager.ts` | ~400 | Docker 容器管理器 |

### 修改文件

| 文件 | 预计变更行数 | 说明 |
|------|-------------|------|
| `packages/agent-core/src/main/ipc/qq-bot-handler.ts` | ~400 行重构 | 替换 NapCatManager 为 DockerContainerManager |
| `packages/agent-core/src/main/qq-bot/types.ts` | ~30 行修改 | 新增 DockerConfig，标记 managed 为 deprecated |
| `packages/agent-core/src/main/qq-bot/config.ts` | ~20 行修改 | 更新默认配置和验证逻辑 |
| `packages/agent-core/src/main/qq-bot/index.ts` | ~10 行修改 | 导出 DockerContainerManager |
| `packages/agent-core/package.json` | +1 行 | 新增 `dockerode` 依赖 |
| `packages/agent-core/src/main/qq-bot/napcat-manager.ts` | +3 行 | 顶部添加 `@deprecated` 注释 |

### 无需修改的文件

| 文件 | 说明 |
|------|------|
| `onebot-client.ts` | 纯 WebSocket 客户端 |
| `integration.ts` | 只依赖 OneBotClient |
| `message-router.ts` | 纯消息路由 |
| `message-handler.ts` | 消息处理中枢 |
| `qq-sub-agent.ts` | Sub-Agent 逻辑 |
| `qq-agent.ts` | MainAgent 子类 |
| `permission.ts` | 权限控制 |
| `message-bridge.ts` | 桥接逻辑 |
| `proactive-notifier.ts` | 主动通知 |
| `remote-command-parser.ts` | 远程指令解析 |
| `main-agent-queue.ts` | 双 Agent 通信队列 |
| `qq-store.ts` | 持久化存储 |
| `qq-trigger-adapter.ts` | 触发器适配器 |
| `main/index.ts` | 初始化流程 |

## 12. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 用户未安装 Docker | 无法使用 docker 模式 | 1. 清晰错误提示 + 安装指引；2. 保留 external 模式作为回退 |
| 国内无法拉取 ghcr.io 镜像 | 安装失败 | 1. 支持配置 registry-mirrors；2. 提供阿里云/腾讯云镜像替代方案 |
| Docker 容器网络性能 | 消息延迟略增 | 使用 `--network host` 模式（Linux）减少网络开销 |
| 容器内 QQ 账号被封 | 高风险 | 1. 容器化不会增加封号风险（NapCat 行为不变）；2. 建议使用小号 |
| Docker 资源占用 | 与进程方案差异不大 | 容器仅运行 NapCat（~100MB 内存），与进程方案开销相近 |

## 13. 实施顺序

```
Phase 1 ───→ Phase 2 ───→ Phase 3 ───→ Phase 4
 创建             IPC            配置           清理
DockerContainer   Handler       更新           旧代码
Manager          重构
```

- **Phase 1**: 2-3 天（核心实现 + 单元测试）
- **Phase 2**: 1-2 天（IPC Handler 重构 + 集成测试）
- **Phase 3**: 0.5 天（配置更新）
- **Phase 4**: 0.5 天（清理 + 文档更新）

**总计**: 4-6 天