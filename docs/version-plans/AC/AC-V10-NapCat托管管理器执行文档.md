# Alice Mod Core V10 — NapCat 托管管理器执行文档

> 版本：v1.0
> 日期：2026-07-10
> 版本号：V10（第 12 周）
> 对应需求：AC-QQ-01、AC-QQ-02、AC-QQ-UI-02
> 关联文档：[AC-V10-NapCatQQ集成分析.md](../../analysis/AC-V10-NapCatQQ集成分析.md)、[AC-V10-QQ机器人模块.md](AC-V10-QQ机器人模块.md)、[AC-V10-QQ机器人UI设计.md](AC-V10-QQ机器人UI设计.md)

---

## 1. 目标与范围

### 1.1 本次实现目标

补齐 NapCat 托管进程管理器和真实二维码获取流程，使 QQ 机器人模块从"模拟二维码"进入"真实可扫码登录"阶段。

具体目标：

1. 新增 `NapCatManager`：负责 NapCat 子进程的下载、配置、启动、停止、健康监控和崩溃恢复。
2. 改造 `NapCatManagerOptions`：新增 `installDir`，默认使用软件安装目录，支持用户自定义安装位置。
3. 改造 `qq-bot-handler.ts`：通过 `NapCatManager` 获取真实二维码 URL，并提供登录状态轮询、安装向导相关接口。
4. 新增 `NapCatSetupWizard`：首次使用或 NapCat 未安装时强制显示安装向导。
5. 改造 `RobotPage`：未安装 NapCat 时无法进入机器人页面，安装成功后才能看到账号列表/添加账号。

### 1.2 非目标

- 不替换 OneBot 协议客户端。
- 不改写 QQ Sub-Agent 的 LLM 处理逻辑。
- 不实现 NapCat 自动更新（预留接口，本次不实现）。
- 不处理 NapCat 安装包内的 QQ 安装流程（依赖 `NapCat.Shell.Windows.OneKey.zip` 或用户已配置环境）。

---

## 2. 关键设计决策

### 2.1 运行模式选择

采用 **方案 B：托管子进程**（已在 [AC-V10-NapCatQQ集成分析.md](../../analysis/AC-V10-NapCatQQ集成分析.md) 中确定）。

原因：
- 用户要求一键式体验和真实二维码。
- Framework 真嵌入不可行（需要 QQNT 进程上下文）。
- npm 依赖引入无法脱离 QQNT 环境收发消息。

### 2.2 二维码获取方式

通过 NapCat 内置 WebUI API 获取：

1. 启动 NapCat 子进程。
2. 等待 WebUI 就绪（默认端口 `6099`，启动日志会输出实际端口和 token）。
3. 使用 WebUI token 调用 `/api/auth/login` 获取 Credential。
4. 使用 Credential 调用 `/api/QQLogin/GetQQLoginQrcode` 获取二维码 URL。
5. 前端使用 `qrcode` 库将 URL 渲染为二维码图片。

### 2.3 登录状态轮询

后端提供 `qq-bot:check-qr-login` 接口，前端每 2 秒轮询一次：

- 返回 `isLogin=true` 时，表示扫码登录成功，后端自动创建账号并启动 OneBot 连接。
- 返回 `isOffline=true` 或 `loginError` 时，表示异常，前端提示错误。
- 二维码过期时，前端调用 `qq-bot:start-qr-login` 刷新。

### 2.4 配置生成

NapCatManager 在启动前自动生成两个配置文件：

- `{napcatDir}/config/onebot11.json`：配置正向 WebSocket 服务器，供 Agent Core 的 `OneBotClient` 连接。
- `{napcatDir}/config/webui.json`：固定 WebUI token，便于程序化登录。

### 2.5 可执行文件来源

- 默认自动下载 `NapCat.Shell.Windows.OneKey.zip`（Windows）或 `NapCat.Shell.zip`（Linux/macOS）到软件安装目录下的 `napcat/` 子目录。
- 支持用户通过安装向导自定义本地 NapCat 目录（推荐非系统盘）。
- 自动下载失败时，提示用户手动下载并解压到自定义目录。
- 账号、消息日志等运行时数据仍存放在 `{userData}/qq-bot/`，不占用 NapCat 安装目录空间。

---

## 3. 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `packages/agent-core/src/main/qq-bot/napcat-manager.ts` | 新增 | NapCat 托管管理器核心实现，支持自定义 `installDir` |
| `packages/agent-core/src/main/qq-bot/index.ts` | 修改 | 导出 `NapCatManager` 及类型 |
| `packages/agent-core/src/main/ipc/qq-bot-handler.ts` | 修改 | 接入真实 NapCat 生命周期、二维码获取、安装向导接口 |
| `packages/agent-core/src/renderer/src/stores/qqBotStore.ts` | 修改 | 新增登录状态轮询 |
| `packages/agent-core/src/renderer/src/components/qq-bot/RobotPage.tsx` | 修改 | 未安装 NapCat 时显示安装向导 |
| `packages/agent-core/src/renderer/src/components/qq-bot/setup/NapCatSetupWizard.tsx` | 新增 | NapCat 安装向导 UI |
| `packages/agent-core/package.json` | 修改 | 新增 `node-fetch` 等依赖（如需要） |
| `docs/version-plans/AC/AC-V10-NapCat托管管理器执行文档.md` | 新增 | 本文档 |

---

## 4. NapCatManager 设计

### 4.1 接口

```typescript
export type NapCatStatus = 'idle' | 'downloading' | 'starting' | 'running' | 'stopping' | 'error'

export interface NapCatManagerOptions {
  /** NapCat 安装根目录（默认：软件安装目录/napcat） */
  installDir: string
  /** 用户数据目录（用于存放账号等运行时数据） */
  userDataPath: string
  account?: string
  executablePath?: string
  version?: string
  oneBotPort?: number
  webUiPort?: number
  webUiToken?: string
  accessToken?: string
  onLog?: (line: string) => void
  onStatusChange?: (status: NapCatStatus) => void
}

export interface QRCodeResult {
  url: string
  expiresAt: number
}

export interface LoginStatusResult {
  isLogin: boolean
  isOffline: boolean
  qrcodeUrl?: string
  loginError?: string
}

export interface QQLoginInfo {
  uin: string
  nickname: string
  avatarUrl?: string
  online?: boolean
}

export class NapCatManager {
  constructor(options: NapCatManagerOptions)
  getStatus(): NapCatStatus
  getLogs(): readonly string[]
  start(): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
  getQRCode(): Promise<QRCodeResult>
  checkLoginStatus(): Promise<LoginStatusResult>
  getLoginInfo(): Promise<QQLoginInfo | null>
}
```

### 4.2 启动流程

```
start()
  ├─ 确保 {installDir} 目录存在（默认软件安装目录/napcat，可配置）
  ├─ 若未指定 executablePath，触发 download() 下载并解压到 {installDir}
  ├─ 生成 {installDir}/config/onebot11.json
  ├─ 生成 {installDir}/config/webui.json（固定 token）
  ├─ spawn NapCat 子进程（Windows: napcat.exe / launcher.bat；Linux/macOS: napcat）
  ├─ 等待 stdout 中出现 WebUI 就绪日志
  ├─ 通过 WebUI /api/auth/login 获取 Credential
  ├─ 状态变为 running
```

### 4.3 WebUI 认证流程

```
1. 读取 config/webui.json 中的 token
2. POST /api/auth/login
   Body: { hash: sha256(token + '.napcat').toString('hex') }
   Response: { code: 0, data: { Credential: base64 } }
3. 后续请求 Header: Authorization: Bearer {Credential}
```

### 4.4 二维码获取流程

```
getQRCode()
  ├─ 确保已登录 WebUI（必要时重新 auth）
  ├─ POST /api/QQLogin/GetQQLoginQrcode
  ├─ Response: { code: 0, data: { qrcode: string } }
  └─ 返回 { url: qrcode, expiresAt: now + 120000 }
```

### 4.5 登录状态检查

```
checkLoginStatus()
  ├─ POST /api/QQLogin/CheckLoginStatus
  ├─ Response: { code: 0, data: { isLogin, isOffline, qrcodeurl, loginError } }
  └─ 返回 LoginStatusResult
```

### 4.6 崩溃恢复

- 监听子进程 `exit` 事件。
- 若状态不是 `stopping`，则延迟 5 秒后自动 restart（最多 5 次，避免无限重启）。
- 崩溃时调用 `onStatusChange('error')` 并记录最后 100 行日志。

---

## 5. qq-bot-handler.ts 改造点

### 5.1 新增/修改的 IPC 接口

| 通道 | 变更 | 说明 |
|------|------|------|
| `qq-bot:start-qr-login` | 修改 | 启动 NapCat，返回真实二维码 URL |
| `qq-bot:cancel-qr-login` | 不变 | 停止 NapCat 扫码流程 |
| `qq-bot:check-qr-login` | 新增 | 轮询登录状态 |
| `qq-bot:get-accounts` | 不变 | 获取账号列表 |
| `qq-bot:add-account` | 不变 | 手动配置添加账号 |
| `qq-bot:toggle-account` | 修改 | 启用时连接 OneBot，禁用时断开 |
| `qq-bot:get-install-status` | 新增 | 检查 NapCat 安装状态 |
| `qq-bot:choose-install-dir` | 新增 | 打开目录选择对话框 |
| `qq-bot:install-napcat` | 新增 | 自动下载并安装 NapCat 到指定目录 |
| `qq-bot:set-napcat-dir` | 新增 | 手动设置 NapCat 目录 |

### 5.2 start-qr-login 流程

```typescript
ipcMain.handle('qq-bot:start-qr-login', async () => {
  const manager = await getOrCreateNapCatManager()
  await manager.start()
  const qr = await manager.getQRCode()
  return { url: qr.url, expiresAt: qr.expiresAt }
})
```

### 5.3 check-qr-login 流程

```typescript
ipcMain.handle('qq-bot:check-qr-login', async () => {
  const manager = getNapCatManager()
  if (!manager) return { isLogin: false, isOffline: false }
  const status = await manager.checkLoginStatus()
  if (status.isLogin) {
    const info = await manager.getLoginInfo()
    if (info && !findAccountByUin(info.uin)) {
      createManagedAccount(info)
    }
  }
  return status
})
```

### 5.4 托管账号持久化

扫码登录成功后创建的账号：

```typescript
interface QQAccount {
  id: string
  qqNumber: string
  nickname: string
  status: 'online' | 'reconnecting' | 'offline' | 'error'
  enabled: boolean
  config: QQAccountConfig & { managed: true; napcatDir: string }
}
```

---

## 6. 前端改造点

### 6.1 NapCatSetupWizard 安装向导

- 进入 QQ 机器人页面前先调用 `qq-bot:get-install-status` 检查安装状态。
- 未安装时显示全屏安装向导，提供两种模式：
  - **自动下载安装**：用户选择安装目录（默认软件安装目录/napcat），调用 `qq-bot:install-napcat`。
  - **手动指定目录**：用户选择已解压的 NapCat 目录，调用 `qq-bot:set-napcat-dir` 校验。
- 安装成功后刷新状态并进入账号列表。

### 6.2 qqBotStore.ts 新增轮询

- `startQRLogin()` 成功后启动定时器，每 2 秒调用 `checkQRLogin()`。
- `checkQRLogin()` 调用 `qq-bot:check-qr-login`：
  - `isLogin=true` -> `qrCodeStatus='success'`，调用 `loadAccounts()`。
  - `isOffline=true` 或 `loginError` -> `qrCodeStatus='error'`。
  - 二维码过期（`expiresAt < now`）-> `qrCodeStatus='expired'`。
- `cancelQRLogin()` 停止定时器并调用后端 `qq-bot:cancel-qr-login`。

### 6.3 UI 状态映射

| 后端状态 | 前端 qrCodeStatus | UI 行为 |
|---------|------------------|---------|
| 二维码获取中 | loading | 显示 Spinner |
| 二维码就绪 | ready | 显示二维码图片 + 倒计时 |
| 已扫码登录 | success | 显示成功提示，1 秒后返回列表 |
| 二维码过期 | expired | 显示"已过期，点击刷新" |
| NapCat 异常 | error | 显示错误提示和重试按钮 |

---

## 7. 配置示例

### 7.1 onebot11.json

```json
{
  "network": {
    "httpServers": [],
    "httpClients": [],
    "websocketServers": [
      {
        "name": "McAgentWSServer",
        "enable": true,
        "host": "127.0.0.1",
        "port": 3001,
        "messagePostFormat": "array",
        "reportSelfMessage": false,
        "token": "",
        "enableForcePushEvent": true,
        "debug": false,
        "heartInterval": 30000
      }
    ],
    "websocketClients": []
  },
  "musicSignUrl": "",
  "enableLocalFile2Url": false,
  "parseMultMsg": false
}
```

### 7.2 webui.json

```json
{
  "host": "127.0.0.1",
  "port": 6099,
  "token": "mcagent-webui-token",
  "loginRate": 3
}
```

---

## 8. 测试策略

### 8.1 单元测试

- `napcat-manager.ts` 中纯逻辑函数（token hash、配置文件生成、URL 构建）可单元测试。
- 子进程启动和 WebUI API 调用需要集成测试或手动测试。

### 8.2 手动测试清单

1. 点击"扫码登录" -> NapCat 子进程启动 -> 二维码显示。
2. 手机 QQ 扫码 -> 账号出现在列表中，状态为在线。
3. 发送 QQ 群消息 -> Agent Core 收到消息并回复。
4. 关闭账号开关 -> OneBot 断开，状态变为离线。
5. 重新开启账号 -> OneBot 重连成功。
6. 手动结束 NapCat 进程 -> 管理器检测到崩溃并自动重启。

---

## 9. 风险与回退

| 风险 | 影响 | 回退方案 |
|------|------|---------|
| NapCat 下载包结构变化 | 自动下载失败 | 用户手动下载并配置 `executablePath` |
| WebUI API 变化 | 二维码获取失败 | 降级为解析 stdout 中的二维码 URL |
| QQ 登录需要验证 | 扫码后仍无法登录 | 提示用户通过 NapCat WebUI 手动完成登录 |
| Windows 权限问题 | OneKey 安装失败 | 提示用户以管理员身份运行或手动安装 NapCat |

---

## 10. 验收标准

| # | 验收条件 | 验证方法 |
|---|---------|----------|
| 1 | 首次进入 QQ 机器人页面显示 NapCat 安装向导 | 未安装时无法进入账号列表 |
| 2 | 安装向导可选择非系统盘目录 | 目录选择器可用，默认不使用 C 盘 |
| 3 | 自动下载失败时提示手动安装 | 断开网络后点击安装 |
| 4 | 安装成功后进入账号列表/添加账号 | 向导关闭，显示机器人页面 |
| 5 | 点击扫码登录后显示真实可扫描的二维码 | 手机 QQ 可成功识别二维码 |
| 6 | 扫码后账号自动出现在列表中 | 观察账号列表变化 |
| 7 | 账号状态显示为在线 | 状态圆点为绿色 |
| 8 | 可通过 OneBot 收发消息 | 在 QQ 群发送消息，Agent Core 收到事件 |
| 9 | NapCat 异常退出后自动恢复 | 手动 kill 进程，5 秒后自动重启 |
| 10 | 关闭账号开关后状态变为离线 | 点击开关，观察状态变化 |

---

## 11. 实现记录

> 状态：已完成（2026-07-10）

### 11.1 已实现内容

- `NapCatManager` 完整实现：自动下载 NapCat、生成 onebot11.json / webui.json、子进程启动/停止/重启、崩溃自动恢复；支持自定义 `installDir`，默认使用软件安装目录。
- `qq-bot-handler.ts` 接入真实 NapCat：新增安装向导接口（`get-install-status`、`choose-install-dir`、`install-napcat`、`set-napcat-dir`）；`start-qr-login` 启动 NapCat 并返回真实二维码 URL；`check-qr-login` 轮询登录状态并在成功后自动创建托管账号。
- 前端 `NapCatSetupWizard` + `RobotPage`：未安装 NapCat 时强制显示安装向导，支持自动下载安装和手动指定目录，安装成功后才能进入机器人页面。
- 前端 `qqBotStore.ts` + `AddAccountPanel.tsx`：每 2 秒轮询登录状态，登录成功后自动刷新账号列表并选中该账号。
- `OneBotClient` 在账号启用时自动连接，禁用时断开；手动配置账号支持真实 WebSocket 连接测试。

### 11.2 验证结果

- `tsc --noEmit`：通过（0 错误）
- `vitest run`：550 个测试全部通过
- `electron-vite build`：构建成功
