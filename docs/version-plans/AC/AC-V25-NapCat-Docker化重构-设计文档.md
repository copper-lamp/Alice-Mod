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
| **稳定性** | 进程崩溃需手动恢复 | Docker 自动重启策略（`--restart=unless-stopped`） |
| **资源管理** | 无限制 | CPU/内存限制（`--cpus` / `--memory`） |
| **日志** | 文件 + 回调 | `docker logs` + 日志驱动 |

### 1.3 保留桌面版方案的原因

尽管 Docker 方案优势明显，但仍有部分用户需要桌面版 NapCat：

- **未安装 Docker** 的用户（Docker Desktop 占用 C 盘空间，部分用户不愿安装）
- **已有 NapCat 使用经验** 的用户，希望保留原有工作流
- **Docker 不可用** 的环境（如某些受限网络环境）

因此，本设计**同时支持两种部署方式**，用户可在首次安装时自由选择，也支持每个账号独立配置。

## 2. 当前架构分析

### 2.1 当前模块关系（重构前）

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
| `NapCatManager` | `napcat-manager.ts` | ~1332 | **保留，降级为备选方案** |
| `DockerContainerManager` | `docker-container-manager.ts` | ~790 | **新增，推荐方案** |
| `qq-bot-handler.ts` | IPC handler | ~1061 | **重构，增加双模式支持** |
| `OneBotClient` | `onebot-client.ts` | ~403 | 基本不变 |
| `integration.ts` | 集成模块 | ~369 | 不变 |
| `config.ts` | 配置管理 | ~88 | 修改配置结构 |
| `types.ts` | 类型定义 | ~273 | 修改配置类型 |

## 3. 双模式架构设计

### 3.1 目标架构

```
┌──────────────────────────────────────────────────────────────────┐
│                        Electron 主进程                              │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    qq-bot-handler.ts                          │  │
│  │                                                               │  │
│  │  ┌──────────────────────────┐  ┌──────────────────────────┐  │  │
│  │  │  DockerContainerManager   │  │  NapCatManager (备选)     │  │  │
│  │  │  (推荐方案)               │  │  (桌面版进程管理)          │  │  │
│  │  │  ├─ docker pull          │  │  ├─ 下载/安装/配置生成     │  │  │
│  │  │  ├─ docker run/stop      │  │  ├─ spawn/kill/restart    │  │  │
│  │  │  ├─ 端口映射管理          │  │  ├─ WebUI 认证 + QR 扫码  │  │  │
│  │  │  ├─ 容器健康检查          │  │  └─ 崩溃恢复              │  │  │
│  │  │  ├─ 日志流               │  │  └──────────┬───────────┘  │  │
│  │  │  └─ QR 扫码              │  │             │              │  │
│  │  └──────────┬───────────────┘  │             │              │  │
│  │             │                  │             │              │  │
│  │             ▼                  │             ▼              │  │
│  │  ┌──────────────────┐         │  ┌──────────────────┐      │  │
│  │  │ Docker 守护进程   │         │  │ NapCat 子进程    │      │  │
│  │  │ ┌──────────────┐ │         │  │ ┌──────────────┐ │      │  │
│  │  │ │ NapCat 容器  │ │         │  │ │ QQ.exe       │ │      │  │
│  │  │ │ (Alpine)    │ │         │  │ │ + Hook DLL   │ │      │  │
│  │  │ │ WS:3001     │ │         │  │ │ WS:3001      │ │      │  │
│  │  │ │ WebUI:6099  │ │         │  │ │ WebUI:6099   │ │      │  │
│  │  │ └──────────────┘ │         │  │ └──────────────┘ │      │  │
│  │  └──────────────────┘         │  └──────────────────┘      │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  OneBotClient (不变) — ws://127.0.0.1:<port>                 │  │
│  │  integration.ts (不变)                                       │  │
│  │  message-router.ts (不变)                                    │  │
│  └─────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 核心组件

#### 3.2.1 DockerContainerManager（推荐方案）

通过 `dockerode` SDK 管理 NapCat 容器，简化启动流程：

```
用户点击"启用" → ensureManagedConnection()
  → getOrCreateManagedContainer()
    → 判断 deploymentMode
    → Docker: getOrCreateDockerContainer()
    → Desktop: getOrCreateNapcatContainer()
  → manager.start()
    → Docker: docker run --restart unless-stopped ...
    → Desktop: NapCatManager.start() (原有进程管理)
  → delay(2000)
  → connectOneBot() (不变)
```

#### 3.2.2 NapCatManager（桌面版备选方案）

保留原有 NapCatManager 代码，用于桌面版场景。与 Docker 方案共享同一套 IPC Handler 接口。

### 3.3 双模式协调

| 维度 | Docker 模式 | 桌面版模式 |
|------|-------------|-----------|
| 管理器 | `DockerContainerManager` | `NapCatManager` |
| 启动方式 | `docker run` | `spawn()` 子进程 |
| 停止方式 | `docker stop` + `docker rm` | `SIGTERM` + `taskkill` |
| 崩溃恢复 | Docker 自动（`--restart`） | 手动重启（最多 5 次） |
| 端口管理 | 自动映射 | 手动分配 |
| 安装 | `docker pull` | 内置下载引擎 |
| 数据持久化 | 容器卷挂载 | 文件系统目录 |

## 4. 配置结构变更

### 4.1 全局配置（QQBotConfig）

```typescript
export interface QQBotConfig {
  // 全局部署模式：docker（容器）| desktop（桌面版）| external（外部）| managed（已废弃）
  mode: 'docker' | 'desktop' | 'external' | 'managed';

  docker?: DockerConfig;     // Docker 模式配置
  external?: { ... };        // 外部模式（不变）
  managed?: { ... };         // @deprecated
  // ...
}
```

### 4.2 账号级配置（QQAccountConfig）

每个账号可独立选择部署方式：

```typescript
interface QQAccountConfig {
  connectionType: 'qr' | 'manual';
  // 部署模式：docker（推荐）| desktop（桌面版）
  deploymentMode: 'docker' | 'desktop';
  authorization: { ... };
  bridges: BridgeConfig[];
  assignedPort?: number;
  assignedWebUiPort?: number;
  dataDir?: string;           // 数据持久化目录
}
```

### 4.3 选择逻辑

1. **首次安装** → 前端 `NapCatSetupWizard` 让用户选择 Docker 或 Desktop
2. **创建账号** → 默认 `deploymentMode: 'docker'`
3. **运行时** → `ensureManagedConnection()` 根据 `deploymentMode` 分发到对应管理器
4. **用户可随时修改** → 在账号详情页的"部署方式"切换按钮

## 5. 前端变更

### 5.1 NapCatSetupWizard

新增**模式选择页**作为第一步：

```
┌─────────────────────────────────┐
│    选择 NapCat 部署方式           │
│                                 │
│  ┌───────────────────────────┐  │
│  │ Docker 容器方案（推荐）     │  │
│  │ 跨平台、自动重启、多账号隔离 │  │
│  └───────────────────────────┘  │
│                                 │
│  ┌───────────────────────────┐  │
│  │ 桌面版 NapCat              │  │
│  │ 直接在本机运行，无需 Docker  │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
     │                    │
     ▼                    ▼
Docker 检测流程      桌面版安装流程
```

### 5.2 账号详情页

新增"部署方式"切换按钮（Docker 容器 / 桌面版进程），用户可随时切换。

## 6. 需要修改的文件

### 6.1 新增文件

| 文件 | 说明 |
|------|------|
| `packages/agent-core/src/main/qq-bot/docker-container-manager.ts` | Docker 容器管理器（~790 行，已实现） |

### 6.2 修改文件

| 文件 | 修改说明 |
|------|----------|
| `packages/agent-core/src/main/qq-bot/types.ts` | `QQBotConfig.mode` 新增 `'desktop'` 值，`QQAccountConfig` 新增 `deploymentMode` |
| `packages/agent-core/src/main/qq-bot/config.ts` | 默认模式改为 `desktop`，`buildWsUrl`/`buildOneBotConfig`/`validateConfig` 支持 desktop 模式 |
| `packages/agent-core/src/main/ipc/qq-bot-handler.ts` | 重构支持双模式：`getOrCreateManagedContainer()`、`ensureManagedConnection()`、`destroyManagedContainer()`，`get-install-status`/`install-napcat` 支持双模式 |
| `packages/agent-core/src/main/qq-bot/index.ts` | 移除 NapCatManager 的 `@deprecated` 标记，恢复为正式导出 |
| `packages/agent-core/package.json` | 新增 `dockerode` 依赖 |
| `packages/agent-core/src/main/qq-bot/napcat-manager.ts` | 移除文件级 `@deprecated` JSDoc，更新注释为"桌面版进程管理器"，恢复为正式组件 |

### 6.3 前端修改文件

| 文件 | 修改说明 |
|------|----------|
| `NapCatSetupWizard.tsx` | 重写为双模式选择向导（choose/docker/desktop 三步流程） |
| `PermissionPanel.tsx` | 新增"部署方式"切换按钮（Docker 容器 / 桌面版进程） |
| `qqBotStore.ts` | `QQAccountConfig` 新增 `deploymentMode` 字段 |
| `RobotPage.tsx` | `InstallStatus` 接口新增 `dockerVersion`、`napcatInstalled` 等字段，支持双模式安装状态检测 |

### 6.4 不受影响（无需修改）的文件

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

## 7. 错误处理

### 7.1 Docker 不可用（Docker 模式）

1. 调用 `DockerContainerManager.getDockerInfo()` 检测 Docker 状态
2. 区分"未安装"和"未运行"两种场景，前端显示不同提示
3. "未安装" → 提供 Docker Desktop 下载链接
4. "已安装未运行" → 提示启动 Docker Desktop

### 7.2 NapCat 安装失败（桌面版模式）

1. 使用 `NapCatManager.start()` 检测安装状态
2. 失败时返回详细错误信息
3. 保留原有 NapCat 的 crash recovery 逻辑

### 7.3 双模式切换

1. 切换 `deploymentMode` 后，需要重启账号才能生效
2. 切换时自动清理原模式的容器/进程
3. 数据目录可共享（同一份 QQ 登录态）

## 8. 与 AC-V24 链路整合的关系

AC-V24 完成了端到端链路整合，包括：
- `message-router.ts` 路由 QQ 消息到 Agent
- `MainAgent` 预热机制
- 数据持久化到模组目录
- QQ 绑定管理

本次重构（AC-V25）新增 Docker 模式并保留桌面版 NapCat，不影响 AC-V24 建立的链路和数据流。AC-V24 的所有成果保留。

## 9. 验收标准

### 9.1 功能性验收

| # | 验收项 | 预期结果 |
|---|--------|----------|
| 1 | Docker 环境检测 | 应用能检测 Docker 是否安装并运行，区分"未安装"和"未运行" |
| 2 | 模式选择 | 首次安装时提供 Docker / Desktop 两种选择 |
| 3 | 镜像拉取 | Docker 模式首次启动自动 `docker pull` 镜像 |
| 4 | 容器启动 | Docker 模式一键启动 NapCat 容器 |
| 5 | 桌面版安装 | Desktop 模式使用 NapCatManager 安装 NapCat |
| 6 | 二维码登录 | 两种模式均可通过扫码登录 |
| 7 | 消息收发 | 登录后 OneBotClient 连接成功，消息正常收发 |
| 8 | 部署方式切换 | 账号详情页可切换部署方式 |
| 9 | 数据目录选择 | 用户可自定义数据存储目录，默认不占 C 盘 |
| 10 | 外部模式 | 外部模式仍可正常使用 |
| 11 | 多账号运行 | 同时支持 Docker 和 Desktop 混合多账号运行 |

### 9.2 代码质量验收

| # | 验收项 | 标准 |
|---|--------|------|
| 1 | 类型安全 | TypeScript 编译零错误 |
| 2 | 测试通过 | 全量测试通过（>= 999 个测试用例） |
| 3 | 向下兼容 | 现有配置和账号不丢失 |

## 10. 实施顺序

```
Phase 1 ───→ Phase 2 ───→ Phase 3 ───→ Phase 4
  Docker        IPC         双模式      前端 UI
  Container     Handler     配置        重构
  Manager      重构         更新
  (已完成)     (已完成)     (已完成)    (已完成)
```

- **Phase 1**: DockerContainerManager 核心实现
- **Phase 2**: IPC Handler 重构，支持双模式
- **Phase 3**: 配置更新（types.ts, config.ts, 前端类型）
- **Phase 4**: 前端 UI 重构（NapCatSetupWizard, PermissionPanel）