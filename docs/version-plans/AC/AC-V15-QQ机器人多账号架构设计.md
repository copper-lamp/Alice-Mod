# Alice Mod Core V15 — QQ 机器人多账号架构设计

> 版本：v1.0
> 日期：2026-07-15
> 版本号：V15（第 18 周）
> 关联文档：[AC-V10-QQ机器人模块.md](AC-V10-QQ机器人模块.md)、[AC-V10-NapCat托管管理器执行文档.md](AC-V10-NapCat托管管理器执行文档.md)、[AC-V14-事件触发器与QQ完善-架构文档.md](AC-V14-事件触发器与QQ完善-架构文档.md)

---

## 第一部分：需求文档

### 1.1 背景与问题

当前 QQ 机器人模块经过 V10~V14 的迭代，已完成 NapCat 托管管理、OneBot 协议对接、消息桥接、权限控制、事件触发器等核心能力。但在实际运行中存在以下问题：

| 问题 | 描述 | 影响 |
|------|------|------|
| **单 NapCat 实例限制** | `napCatManager` 为全局单例，只能管理一个 QQ 账号 | 无法同时登录多个 QQ 号 |
| **端口冲突** | OneBot 端口固定 3001，WebUI 端口固定 6099 | 第二个 NapCat 启动会端口冲突 |
| **重复启动崩溃** | `start()` 和 `stop()` 可并发执行，exit handler 触发 `handleCrash()` 导致错误重启 | 进程被意外杀后自动重启错误的 NapCat |
| **二维码获取失败** | `start()` 完成后 WebUI 就绪但 QQ 登录模块未初始化完成 | `getQRCode()` 返回空数据 |
| **OneBot 重连死循环** | `destroyNapCatManager()` 杀死 NapCat 后，旧 OneBotClient 继续重连已死亡的进程 | 日志刷屏，资源浪费 |

### 1.2 目标

| 目标 | 优先级 | 说明 |
|------|:------:|------|
| **多账号并行运行** | P0 | 一个 Agent Core 实例同时管理多个 QQ 账号，每个账号独立 NapCat 进程 |
| **端口自动分配** | P0 | 每个 NapCat 实例自动分配唯一端口（OneBot + WebUI），避免冲突 |
| **独立生命周期** | P0 | 每个账号的启停、延迟杀进程、崩溃恢复互相独立 |
| **二维码获取可靠** | P1 | 启动后等待 QQ 登录模块就绪，带重试机制 |
| **进程管理稳定** | P1 | 消除 `start()` 与 `stop()` 的竞态条件 |
| **OneBot 重连可控** | P1 | NapCat 被销毁时对应的 OneBot 也主动断开 |

### 1.3 非目标

- 不修改 OneBot 协议客户端实现
- 不修改 QQ Sub-Agent 的 LLM 处理逻辑
- 不修改事件触发器模块
- 不修改 NapCat 下载/安装逻辑

---

## 第二部分：架构文档

### 2.1 总体架构（目标）

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Agent Core (Electron)                          │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                  qq-bot-handler.ts (IPC 调度层)                  │  │
│  │                                                                   │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │  │
│  │  │ NapCat 管理器 │  │ NapCat 管理器 │  │ NapCat 管理器 │   ...     │  │
│  │  │ (账号 253...) │  │ (账号 118...) │  │ (账号 888...) │         │  │
│  │  │              │  │              │  │              │             │  │
│  │  │ 端口: 3001   │  │ 端口: 3002   │  │ 端口: 3003   │             │  │
│  │  │ WebUI: 6099  │  │ WebUI: 6100  │  │ WebUI: 6101  │             │  │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘             │  │
│  │         │                 │                 │                      │  │
│  │         ▼                 ▼                 ▼                      │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │  │
│  │  │ OneBotClient │  │ OneBotClient │  │ OneBotClient │   ...     │  │
│  │  │ (账号 253...) │  │ (账号 118...) │  │ (账号 888...) │         │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘             │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  持久化: accounts.json                                          │  │
│  │  [                                                                 │  │
│  │    { id, qqNumber: "2530702609", enabled: true, port: 3001, ... },│  │
│  │    { id, qqNumber: "1186650286", enabled: true, port: 3002, ... } │  │
│  │  ]                                                                 │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心数据结构

#### 2.2.1 NapCat 管理器（运行时）

```typescript
// 当前（单例）                                  // 目标（多实例）
let napCatManager: NapCatManager | null = null   // →  Map<string, NapCatManager>
let napCatStopTimer: NodeJS.Timeout | null = null  // →  Map<string, NodeJS.Timeout>
```

每个 NapCat 实例的配置：

```typescript
interface NapCatInstanceConfig {
  qqNumber: string
  oneBotPort: number      // 自动分配，如 3001、3002...
  webUiPort: number       // 自动分配，如 6099、6100...
  webUiToken: string      // 每个实例独立 token
  accessToken: string     // 每个实例独立 access token
  manager: NapCatManager  // 运行时实例
  stopTimer: NodeJS.Timeout | null  // 延迟杀进程定时器
}
```

#### 2.2.2 持久化（accounts.json）

```typescript
// 当前
interface QQAccount {
  id: string
  qqNumber: string
  nickname: string
  status: 'online' | 'reconnecting' | 'offline' | 'error'
  enabled: boolean
  error?: string
  config: QQAccountConfig
  createdAt: number
}

// 目标（新增字段）
interface QQAccount {
  // ... 现有字段不变
  config: QQAccountConfig & {
    managed?: boolean
    assignedPort?: number     // ← 新增：分配的 OneBot 端口
    assignedWebUiPort?: number // ← 新增：分配的 WebUI 端口
  }
}
```

### 2.3 端口分配策略

#### 2.3.1 分配规则

```
基础端口: OneBot=3001, WebUI=6099
偏移量:   按账号创建顺序分配

账号 1: OneBot 3001, WebUI 6099
账号 2: OneBot 3002, WebUI 6100
账号 N: OneBot 3000+N, WebUI 6098+N
```

#### 2.3.2 端口冲突检测

```
分配端口时检查：
  1. 该端口是否已被本进程的其他 NapCat 实例占用
  2. 该端口是否可 listen（通过 net.createServer 检测）
  3. 如果冲突，自动 +1 重试，最多尝试 10 次
```

#### 2.3.3 端口持久化

```
一旦账号创建成功，端口号持久化到 accounts.json
即使重启 Agent Core，同一个账号使用相同端口
避免配置文件变化导致 NapCat 需要重新登录
```

### 2.4 生命周期管理

#### 2.4.1 状态机（每个账号独立）

```
         ┌──────────┐
         │   idle   │
         └────┬─────┘
              │ start()
         ┌────▼─────┐
         │ starting │
         └────┬─────┘
              │ WebUI 就绪 + 认证成功
         ┌────▼─────┐
         │ running  │
         └────┬─────┘
              │ stop() / 延迟杀进程
         ┌────▼─────┐
         │ stopping │
         └────┬─────┘
              │ 进程退出
         ┌────▼─────┐
         │   idle   │
         └──────────┘

异常路径:
  running ──崩溃──► error ──自动重启──► starting
  starting ──失败──► error
  error ──手动重试──► starting
```

#### 2.4.2 并发安全

```typescript
// 每个账号独立锁，互不干扰
const pendingAccountConnections = new Set<string>()  // 当前不变，但每个账号独立
```

#### 2.4.3 延迟杀进程（每个账号独立）

```typescript
// 当前（全局一个定时器）
let napCatStopTimer: NodeJS.Timeout | null = null

// 目标（每个账号独立定时器）
interface AccountStopTimer {
  accountId: string
  timer: NodeJS.Timeout
}

// 账号 A 关闭 → 60s 后杀 A 的 NapCat 进程
// 账号 B 仍在运行 → 不受影响
// 账号 A 60s 内重开 → 取消 A 的定时器，复用 A 的 NapCat 进程
```

### 2.5 进程管理

#### 2.5.1 竞态条件修复

**当前问题：** `start()` 中 kill 旧进程时，exit handler 触发 `handleCrash()`。

```typescript
// 修复方案
proc.on('exit', (code, signal) => {
  this.process = null
  // status 为 'starting' 时，是被 start() 主动 kill 旧进程，不触发错误重启
  if (this.status !== 'stopping' && this.status !== 'starting') {
    this.handleCrash()
  }
})
```

#### 2.5.2 进程树清理

**当前：** `forceKillNapCatProcesses()` 按名杀进程（可能误杀其他账号的 NapCat）。

**目标：** 每个账号的 `forceKillNapCatProcesses()` 只杀该账号绑定 PID 的进程树。

```
每个 NapCat 实例的进程 PID 存储在各自的 NapCatManager 中
清理时只 kill 该 PID 的进程树（taskkill /T /PID）
不再按进程名全局搜索
```

#### 2.5.3 崩溃恢复隔离

```
账号 A 崩溃 → 只重启 A 的 NapCat 进程
账号 B 正常运行 → 不受影响
每个账号独立的重启计数器和重启定时器
```

### 2.6 二维码获取流程

#### 2.6.1 当前流程（已修复）

```
start-qr-login
  → disconnectAllManagedClients()
  → destroyNapCatManager()
  → new NapCatManager() + start()
  → 重试 3 次 getQRCode()，每次间隔 2s
```

#### 2.6.2 多账号下的扫码流程

```
start-qr-login 仍然创建临时 NapCat 实例（无 -q 参数）
  → 分配临时端口（OneBot 3001+N, WebUI 6099+N）
  → 启动后获取二维码
  → 扫码成功 → 创建账号 → 端口号持久化
  → 账号启用 → 该账号的 NapCat 实例启动（带 -q 参数，快速登录）

扫码登录成功后，账号使用分配的端口
后续启动都是快速登录模式（带 -q），无需再次扫码
```

### 2.7 OneBot 客户端管理

#### 2.7.1 连接映射

```typescript
// 当前
const activeClients = new Map<string, OneBotClient>()
// key = accountId, value = OneBotClient 实例

// 目标（不变，但每个 client 连接不同的 wsUrl）
// 账号 A 的 OneBotClient → ws://127.0.0.1:3001
// 账号 B 的 OneBotClient → ws://127.0.0.1:3002
```

#### 2.7.2 WS URL 构建

```typescript
// 当前（固定端口）
function buildWsUrlFromConfig(config: QQAccountConfig): string | null {
  return 'ws://127.0.0.1:3001'  // 固定
}

// 目标（使用分配的端口）
function buildWsUrlFromConfig(config: QQAccountConfig): string | null {
  if (config.connectionType === 'manual' && config.manual) {
    return `${config.manual.protocol}://${config.manual.host}:${config.manual.port}`
  }
  // 托管账号使用分配的端口
  const port = config.assignedPort || DEFAULT_ONE_BOT_PORT
  return `ws://127.0.0.1:${port}`
}
```

### 2.8 IPC 接口变更

#### 2.8.1 新增接口

| 通道 | 用途 | 说明 |
|------|------|------|
| `qq-bot:get-manager-status` | 获取单个账号的 NapCat 状态 | 新增 `accountId` 参数 |
| `qq-bot:stop-manager` | 停止单个账号的 NapCat | 新增 `accountId` 参数 |

#### 2.8.2 修改接口

| 通道 | 修改点 |
|------|--------|
| `qq-bot:start-qr-login` | 扫码登录的 NapCat 独立于已托管账号，分配临时端口 |
| `qq-bot:check-qr-login` | 扫码成功后创建账号时分配端口并持久化 |
| `qq-bot:toggle-account` | 启用时按账号端口启动对应 NapCat，禁用时延迟杀对应账号的进程 |
| `qq-bot:get-manager-status` | 改为接收 `accountId` 参数，返回对应账号的状态 |
| `qq-bot:stop-manager` | 改为接收 `accountId` 参数，停止对应账号的 NapCat |

#### 2.8.3 不变接口

| 通道 | 原因 |
|------|------|
| `qq-bot:get-accounts` | 已返回所有账号列表 |
| `qq-bot:add-account` | 手动配置，不涉及 NapCat 管理 |
| `qq-bot:remove-account` | 已清理对应 client |
| `qq-bot:get-config` | 基于 accountId，不变 |
| `qq-bot:save-config` | 基于 accountId，不变 |
| `qq-bot:get-message-log` | 基于 accountId，不变 |
| `qq-bot:clear-logs` | 基于 accountId，不变 |
| `qq-bot:test-connection` | 通用测试，不变 |
| `qq-bot:get-install-status` | NapCat 安装与账号无关 |
| `qq-bot:choose-install-dir` | 安装向导，不变 |
| `qq-bot:install-napcat` | 安装向导，不变 |
| `qq-bot:set-napcat-dir` | 安装向导，不变 |

### 2.9 数据流示例

#### 2.9.1 启动时自动连接两个账号

```
Agent Core 启动
  → QQ 集成初始化完成
  → autoStartQQBotAccounts()
    → 读取 accounts.json:
      [2530702609 (enabled, port=3001), 1186650286 (enabled, port=3002)]
    → 并行启动两个 NapCat 实例:
      → NapCatManager(account=2530702609, oneBotPort=3001, webUiPort=6099)
      → NapCatManager(account=1186650286, oneBotPort=3002, webUiPort=6100)
    → 并行等待就绪
    → 并行连接 OneBot:
      → OneBotClient(ws://127.0.0.1:3001) → 账号 253 在线
      → OneBotClient(ws://127.0.0.1:3002) → 账号 118 在线
```

#### 2.9.2 关闭一个账号

```
用户关闭账号 253
  → toggleAccount(253, enabled=false)
    → disconnectOneBot(253)  ← 断开 WS，立即生效
    → scheduleNapCatStop(253)  ← 60s 后杀 253 的 NapCat 进程
  → 账号 118 不受影响，正常运行
  → 60s 内用户重开 253:
    → cancelNapCatStop(253)
    → NapCat 仍在运行 → 直接 connectOneBot → 快速恢复
```

#### 2.9.3 添加新账号

```
用户点击"添加账号" → 扫码登录
  → start-qr-login
    → 临时分配端口 3003 / 6101
    → 启动临时 NapCat（无 -q）
    → 获取二维码
  → 用户扫码
  → check-qr-login → isLogin=true
    → createManagedAccount({ uin: "8888888", nickname: "新号" })
      → 账号配置中写入 assignedPort: 3003, assignedWebUiPort: 6101
      → 自动启用 → ensureManagedConnection(8888888)
        → 启动 NapCat(account=8888888, port=3003)
        → 快速登录成功 → 连接 OneBot(ws://127.0.0.1:3003)
```

---

## 第三部分：执行文档

### 3.1 变更文件清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `packages/agent-core/src/main/ipc/qq-bot-handler.ts` | 修改 | 单例 → 多实例 Map，端口分配，独立生命周期 |
| `packages/agent-core/src/main/qq-bot/napcat-manager.ts` | 修改 | exit handler 竞态修复 |
| `packages/agent-core/src/main/index.ts` | 不变 | 自动启动已支持遍历账号 |

### 3.2 具体变更（qq-bot-handler.ts）

#### 3.2.1 数据结构变更

```typescript
// 删除
let napCatManager: NapCatManager | null = null
let napCatStopTimer: NodeJS.Timeout | null = null

// 新增
interface ManagedNapCatInstance {
  qqNumber: string
  manager: NapCatManager
  stopTimer: NodeJS.Timeout | null
}

const napCatInstances = new Map<string, ManagedNapCatInstance>()
// key = accountId (QQAccount.id)
```

#### 3.2.2 端口分配函数

```typescript
const BASE_ONE_BOT_PORT = 3001
const BASE_WEB_UI_PORT = 6099
const MAX_PORT_OFFSET = 100

function assignPorts(accountId: string, preferredOneBot?: number, preferredWebUi?: number): { oneBot: number; webUi: number } {
  // 优先使用持久化的端口
  if (preferredOneBot && preferredWebUi) {
    return { oneBot: preferredOneBot, webUi: preferredWebUi }
  }

  // 查找最小可用端口
  const usedPorts = new Set<number>()
  for (const inst of napCatInstances.values()) {
    usedPorts.add(inst.manager['options'].oneBotPort)
    usedPorts.add(inst.manager['options'].webUiPort)
  }

  for (let offset = 0; offset < MAX_PORT_OFFSET; offset++) {
    const oneBot = BASE_ONE_BOT_PORT + offset
    const webUi = BASE_WEB_UI_PORT + offset
    if (!usedPorts.has(oneBot) && !usedPorts.has(webUi)) {
      return { oneBot, webUi }
    }
  }
  throw new Error('无法分配可用端口')
}
```

#### 3.2.3 管理器创建

```typescript
function getOrCreateNapCatManager(
  account: QQAccount,
  onProgress?: (p: { percent: number; stage: string; message: string }) => void,
): NapCatManager {
  const existing = napCatInstances.get(account.id)
  if (existing) return existing.manager

  const settings = loadNapCatSettings()
  const ports = assignPorts(account.id, account.config.assignedPort, account.config.assignedWebUiPort)

  const manager = new NapCatManager({
    installDir: settings.installDir,
    userDataPath: app.getPath('userData'),
    account: account.qqNumber,
    executablePath: settings.executablePath,
    oneBotPort: ports.oneBot,
    webUiPort: ports.webUi,
    onLog: (line) => console.log(line),
    onStatusChange: (status) => {
      console.log(`[NapCatManager(${account.qqNumber})] status:`, status)
    },
    onProgress,
  })

  // 持久化端口
  account.config.assignedPort = ports.oneBot
  account.config.assignedWebUiPort = ports.webUi
  const data = loadAccounts()
  const acc = data.accounts.find(a => a.id === account.id)
  if (acc) {
    acc.config.assignedPort = ports.oneBot
    acc.config.assignedWebUiPort = ports.webUi
    saveAccounts(data.accounts, data.order)
  }

  napCatInstances.set(account.id, { qqNumber: account.qqNumber, manager, stopTimer: null })
  return manager
}
```

#### 3.2.4 销毁管理器（按账号）

```typescript
function destroyNapCatManager(accountId?: string): void {
  if (accountId) {
    // 销毁指定账号的管理器
    cancelNapCatStop(accountId)
    disconnectAllManagedClients()  // 断开所有客户端（安全起见）
    const inst = napCatInstances.get(accountId)
    if (inst) {
      inst.manager.stop().catch(() => {})
      napCatInstances.delete(accountId)
    }
  } else {
    // 销毁所有管理器（兼容旧调用）
    for (const [id] of napCatInstances) {
      destroyNapCatManager(id)
    }
  }
}
```

#### 3.2.5 延迟杀进程（按账号）

```typescript
function scheduleNapCatStop(accountId: string): void {
  cancelNapCatStop(accountId)
  const inst = napCatInstances.get(accountId)
  if (!inst) return

  inst.stopTimer = setTimeout(async () => {
    console.log(`[QQBot] 延迟停止 NapCat (${inst.qqNumber}, 60s 无活动)`)
    try { await inst.manager.stop() } catch { /* ignore */ }
    napCatInstances.delete(accountId)
    inst.stopTimer = null
  }, 60000)
}

function cancelNapCatStop(accountId: string): void {
  const inst = napCatInstances.get(accountId)
  if (inst?.stopTimer) {
    clearTimeout(inst.stopTimer)
    inst.stopTimer = null
  }
}
```

#### 3.2.6 ensureManagedConnection（按账号）

```typescript
async function ensureManagedConnection(account: QQAccount): Promise<void> {
  if (account.config.connectionType !== 'qr') return
  if (pendingAccountConnections.has(account.id)) return
  pendingAccountConnections.add(account.id)

  try {
    const manager = getOrCreateNapCatManager(account)
    cancelNapCatStop(account.id)

    if (manager.getStatus() === 'idle' || manager.getStatus() === 'error') {
      console.log(`[QQBot] ▶ 启动 NapCat (account=${account.qqNumber})...`)
      await manager.start()
    }

    await delay(2000)  // 等待 WS 就绪

    try {
      await connectOneBot(account)
    } catch (err) {
      // 不杀进程，客户端自动重连
      throw err
    }
  } finally {
    pendingAccountConnections.delete(account.id)
  }
}
```

#### 3.2.7 toggleAccount（按账号）

```typescript
ipcMain.handle('qq-bot:toggle-account', async (_, id: string, enabled: boolean) => {
  const data = loadAccounts()
  const account = data.accounts.find(a => a.id === id)
  if (!account) return { success: false }

  account.enabled = enabled
  account.status = enabled ? 'reconnecting' : 'offline'
  account.error = undefined
  saveAccounts(data.accounts, data.order)

  if (enabled) {
    try {
      if (account.config.connectionType === 'qr') {
        await ensureManagedConnection(account)
      } else {
        await connectOneBot(account)
      }
    } catch (err) {
      account.status = 'error'
      account.error = err instanceof Error ? err.message : String(err)
      saveAccounts(data.accounts, data.order)
    }
  } else {
    await disconnectOneBot(id)
    if (account.config.managed) {
      scheduleNapCatStop(id)  // ← 按账号 ID 调度，不再全局
    }
  }
  return { success: true }
})
```

#### 3.2.8 autoStartQQBotAccounts（并行启动）

```typescript
export async function autoStartQQBotAccounts(): Promise<void> {
  const data = loadAccounts()
  const enabledAccounts = data.accounts.filter(a => a.enabled && a.config.connectionType === 'qr')
  if (enabledAccounts.length === 0) return

  console.log(`[QQBot] 自动启动 ${enabledAccounts.length} 个已启用的托管账号...`)

  // 并行启动所有账号，互不阻塞
  await Promise.allSettled(
    enabledAccounts.map(async (account) => {
      try {
        await ensureManagedConnection(account)
      } catch (err) {
        const data2 = loadAccounts()
        const acc = data2.accounts.find(a => a.id === account.id)
        if (acc) {
          acc.status = 'error'
          acc.error = err instanceof Error ? err.message : String(err)
          saveAccounts(data2.accounts, data2.order)
        }
        console.error(`[QQBot] 自动启动账号 ${account.qqNumber} 失败:`, err)
      }
    })
  )
}
```

### 3.3 具体变更（napcat-manager.ts）

#### 3.3.1 exit handler 竞态修复

```typescript
// 当前
proc.on('exit', (code, signal) => {
  this.log(`子进程退出: code=${code}, signal=${signal}`)
  this.process = null
  if (this.status !== 'stopping') {
    this.handleCrash()
  }
})

// 目标
proc.on('exit', (code, signal) => {
  this.log(`子进程退出: code=${code}, signal=${signal}`)
  this.process = null
  if (this.status !== 'stopping' && this.status !== 'starting') {
    this.handleCrash()
  }
})
```

### 3.4 兼容性

| 场景 | 状态 | 说明 |
|------|:----:|------|
| 已有单账号用户升级 | ✅ | 自动沿用旧端口，无需重新扫码 |
| 新增多账号 | ✅ | 新账号分配新端口，与旧账号互不干扰 |
| 手动配置账号（外部 NapCat） | ✅ | 手动配置不受影响，沿用 manual 配置的 host/port |
| 扫码登录流程 | ✅ | 扫码后自动分配端口，后续启动使用该端口 |
| 前端 IPC 调用 | ⚠️ | `get-manager-status` 和 `stop-manager` 需要传 `accountId` 参数 |

### 3.5 实施步骤

| 步骤 | 文件 | 内容 | 工作量 |
|:----:|------|------|:------:|
| 1 | napcat-manager.ts | exit handler 添加 `status !== 'starting'` 判断 | 小 |
| 2 | qq-bot-handler.ts | 定义 `ManagedNapCatInstance` 接口 + `napCatInstances` Map | 小 |
| 3 | qq-bot-handler.ts | 实现 `assignPorts()` 函数 | 小 |
| 4 | qq-bot-handler.ts | 改造 `getOrCreateNapCatManager()` → 按账号创建实例 | 中 |
| 5 | qq-bot-handler.ts | 改造 `destroyNapCatManager()` → 支持按账号销毁 | 中 |
| 6 | qq-bot-handler.ts | 改造 `scheduleNapCatStop()` / `cancelNapCatStop()` → 按账号调度 | 中 |
| 7 | qq-bot-handler.ts | 改造 `ensureManagedConnection()` → 使用按账号的 manager | 小 |
| 8 | qq-bot-handler.ts | 改造 `toggleAccount` → 使用按账号的生命周期 | 小 |
| 9 | qq-bot-handler.ts | 改造 `autoStartQQBotAccounts()` → 并行启动 | 小 |
| 10 | qq-bot-handler.ts | 改造 `buildWsUrlFromConfig()` → 使用 assignedPort | 小 |
| 11 | qq-bot-handler.ts | 改造 `start-qr-login` / `check-qr-login` → 分配并持久化端口 | 中 |
| 12 | qq-bot-handler.ts | 改造 `get-manager-status` / `stop-manager` → 支持 accountId | 小 |
| 13 | 编译验证 | `tsc --noEmit` | 小 |

### 3.6 测试策略

| 测试场景 | 方法 | 预期 |
|----------|------|------|
| 启动时自动连接 2 个账号 | 观察日志 | 两个 NapCat 进程分别启动，端口不同 |
| 关闭 1 个账号 | 点击开关 | 该账号 WS 断开，60s 后 NapCat 进程退出 |
| 60s 内重开 | 点击开关 | 不重新启动 NapCat，直接连 WS |
| 添加新账号扫码 | 完整扫码流程 | 二维码正常显示，扫码后自动分配端口 |
| 3 个账号并行 | 同时启动 | 端口 3001/6099, 3002/6100, 3003/6101 |
| 手动 kill 1 个 NapCat | 进程管理器 | 只有该账号的 NapCat 重启，其他不受影响 |
| 手动配置账号 | 添加 manual 账号 | 使用用户配置的 host/port，不受影响 |