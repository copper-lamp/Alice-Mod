# AC 自动更新模块 - 架构文档

> 模块：Agent Core（AC）客户端
> 文档版本：v1.0
> 日期：2026-07-23
> 上游文档：[AC-V33-自动更新模块-需求文档.md](./AC-V33-自动更新模块-需求文档.md)
> 关联服务端：[SERVER 架构文档](../../../SERVER/docs/02-架构文档.md)

---

## 第1章 架构总览

### 1.1 模块定位

AC 自动更新模块位于 `packages/agent-core/src/main/updater/`，是 Electron 主进程的一部分。它在 `app.whenReady()` 之后执行，负责：

- 许可证管理（token 加密存储）
- 启动时拉取 Release Policy
- 版本对比与更新决策
- 更新下载与安装（基于 electron-updater）
- Feature Flag 管理与注入

### 1.2 系统分层

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: 启动入口（src/main/index.ts）                       │
│  在 app.whenReady() 后调用 bootstrapUpdater()                 │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: 核心流程（src/main/updater/）                       │
│                                                              │
│  ┌──────────────────┐  ┌────────────────────────────────┐   │
│  │  bootstrap.ts     │  │ 启动流程编排                     │   │
│  │  Bootstrapper     │→│ 1. loadLicense()                │   │
│  │                   │  │ 2. fetchPolicy()               │   │
│  │                   │  │ 3. compareVersion()            │   │
│  │                   │  │ 4. checkForceUpgrade()         │   │
│  │                   │  │ 5. initFeatureFlags()          │   │
│  └──────────────────┘  └────────────────────────────────┘   │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ LicenseMgr   │  │ PolicyClient │  │ R2Downloader     │   │
│  │ token 加密存  │→│ API 调用     │→│ electron-updater  │   │
│  │ license.dat  │  │ 重试/超时   │  │ 包装器           │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
│                                                              │
│  ┌──────────────────┐  ┌────────────────────────────────┐   │
│  │ FeatureFlags     │  │ types.ts                        │   │
│  │ Flag 单例管理     │  │ 共享类型定义                    │   │
│  │ get/set/init     │  │ ReleasePolicy, FeatureFlags...  │   │
│  └──────────────────┘  └────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: 服务端（Cloudflare Workers + R2）                   │
│  GET /v1/release → ReleasePolicy                              │
│  R2 签名 URL → 安装包下载                                     │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 启动流程

```
AC 启动
  │
  ▼
app.whenReady()
  │
  ├─ 1. loadLicense() ───────────── license.dat → token | null
  │
  ├─ 2. fetchPolicy(token, version) ── GET /v1/release
  │     │
  │     ├─ 成功 → ReleasePolicy
  │     ├─ 401 → clearLicense()，使用默认策略
  │     └─ 失败/超时 → 使用默认策略
  │
  ├─ 3. compareVersion(policy, currentVersion)
  │     │
  │     ├─ 已是最新 → 静默
  │     ├─ 有更新，未超宽限 → 后台下载
  │     └─ 有更新，已超宽限 → 弹强制升级对话框
  │
  ├─ 4. initFeatureFlags(policy.features)
  │
  └─ 5. createMainWindow() ─────── 正常创建窗口
```

---

## 第2章 模块划分

### 2.1 目录结构

```
packages/agent-core/src/main/updater/
├── index.ts                  # 模块导出
├── bootstrap.ts              # 启动流程编排主入口
├── license-manager.ts        # token 加密存储
├── policy-client.ts          # /v1/release API 调用
├── feature-flags.ts          # Feature Flag 单例
├── r2-downloader.ts          # electron-updater 包装
├── types.ts                  # 共享类型定义
└── __tests__/
    ├── license-manager.test.ts
    ├── policy-client.test.ts
    └── feature-flags.test.ts
```

### 2.2 模块职责

#### 2.2.1 bootstrap.ts — 启动流程编排

**职责**：整合所有子模块，编排完整的启动检查流程。

```typescript
// 核心接口
export class Bootstrapper {
  async run(): Promise<BootstrapResult> {
    // 1. 加载许可证
    const token = await licenseManager.load();

    // 2. 拉取策略
    const policy = await policyClient.fetch(token, appVersion);

    // 3. 处理 token 失效
    if (policy === null || policy.active === false) {
      await licenseManager.clear();
    }

    // 4. 初始化 Feature Flag
    featureFlags.init(policy?.features ?? DEFAULT_FEATURES);

    // 5. 版本对比
    const updateInfo = this.compareVersion(policy, appVersion);

    // 6. 处理更新
    if (updateInfo.needsUpdate) {
      await this.handleUpdate(updateInfo, policy);
    }

    return { policy, featureFlags: featureFlags.getAll() };
  }
}
```

**关键决策**：
- 拉取超时 5s，超时后使用默认策略继续启动
- 不 `await` 更新下载（后台进行），不阻塞窗口创建
- 强制升级场景例外：对话框阻塞启动流程

#### 2.2.2 license-manager.ts — Token 加密存储

**职责**：使用 `electron.safeStorage` 加密存储 token 到 `userData/license.dat`。

```typescript
export class LicenseManager {
  private readonly filePath: string;  // userData/license.dat

  // 加密存储 token
  async save(token: string): Promise<void>;

  // 解密读取 token，文件不存在返回 null
  async load(): Promise<string | null>;

  // 清空 token 文件
  async clear(): Promise<void>;
}
```

**加密机制**：
```
明文 token
    │
    ▼
electron.safeStorage.encryptString(token)
    │
    ▼
Buffer → 写入 license.dat (二进制)
    │
    ▼
读取时：safeStorage.decryptString(buffer)
```

**安全特性**：
- 依赖 OS 级 keychain（Windows DPAPI、macOS Keychain、Linux libsecret）
- 卸载 Electron 应用后 keychain 条目自动清除
- 重新安装后的 token 不可恢复（标准版用户无影响）

#### 2.2.3 policy-client.ts — 策略客户端

**职责**：封装 `GET /v1/release` 的 HTTP 调用，处理重试和错误。

```typescript
export class PolicyClient {
  private readonly baseUrl: string;  // 从配置读取

  async fetch(
    token: string | null,
    appVersion: string
  ): Promise<ReleasePolicy | null>;

  async fetchDirect(
    channel: 'stable' | 'beta'
  ): Promise<ReleasePolicy | null>;
}
```

**请求格式**：
```
GET /v1/release?token=xxx&app_version=2.3.1
```

**响应格式**（与 SERVER 架构文档一致）：
```typescript
interface ReleasePolicy {
  tier: 'standard' | 'pro' | 'max';
  expire_at: number;
  active: boolean;
  allowed_major: number;
  allowed_minor: number;
  channel: 'stable' | 'beta';
  features: FeatureFlags;
  download_url: string;
  download_expires_in: number;
  force_upgrade_after_days: number;
  latest_version: string;
}
```

**错误处理**：
| 状态码 | 处理方式 |
|---|---|
| 200 | 返回 policy |
| 401 | 返回 null（触发 LicenseManager.clear()） |
| 403 | 返回 `{ active: false }` 的 policy |
| 429 | 等待 60s 后重试 |
| 5xx/网络错误 | 重试 3 次，指数退避 |

#### 2.2.4 feature-flags.ts — Feature Flag 单例

**职责**：管理 Feature Flag 的初始化和读取。

```typescript
export class FeatureFlags {
  private flags: FeatureFlagsMap = DEFAULT_FEATURES;

  // 初始化（首次启动时调用）
  init(flags: FeatureFlagsMap): void;

  // 读取单个 flag
  get<T = boolean>(key: string): T;

  // 读取所有 flag（用于调试/UI 展示）
  getAll(): FeatureFlagsMap;
}

// 默认值（标准版）
const DEFAULT_FEATURES: FeatureFlagsMap = {
  active: true,
  max_premium_features: false,
  update_channel: 'stable',
  force_upgrade_days: 14,
};
```

**使用方式**：
```typescript
// 在 electron-updater 配置中
const channel = featureFlags.get('update_channel');
autoUpdater.channel = channel;

// 在未来 Max 高级功能中
if (featureFlags.get('max_premium_features')) {
  enableMaxFeatures();
}
```

#### 2.2.5 r2-downloader.ts — 更新引擎

**职责**：包装 `electron-updater`，提供下载和安装功能。

```typescript
export class R2Downloader {
  private readonly autoUpdater: AutoUpdater;

  // 配置更新源
  configure(policy: ReleasePolicy): void;

  // 检查更新（调用 electron-updater 的 checkForUpdates）
  async checkForUpdates(): Promise<UpdateCheckResult | null>;

  // 下载更新（后台静默下载）
  async downloadUpdate(): Promise<void>;

  // 安装更新（重启应用）
  async installAndRestart(): Promise<void>;

  // 事件监听：下载进度、下载完成、错误
  onProgress(callback: (percent: number) => void): void;
  onUpdateDownloaded(callback: () => void): void;
  onError(callback: (error: Error) => void): void;
}
```

**electron-builder 配置**：
```json
{
  "build": {
    "publish": {
      "provider": "generic",
      "url": "https://r2.alice-mod.dev/",
      "channel": "stable"
    }
  }
}
```

**运行时动态设置 channel**：
```typescript
autoUpdater.channel = policy.channel;  // 'stable' | 'beta'
autoUpdater.setFeedURL({
  provider: 'generic',
  url: policy.download_url,  // 服务端返回的签名 URL
  channel: policy.channel
});
```

### 2.3 共享契约（types.ts）

```typescript
// packages/agent-core/src/main/updater/types.ts

export type Tier = 'standard' | 'pro' | 'max';
export type Channel = 'stable' | 'beta';

export interface ReleasePolicy {
  tier: Tier;
  expire_at: number;
  active: boolean;
  allowed_major: number;
  allowed_minor: number;
  channel: Channel;
  features: FeatureFlagsMap;
  download_url: string;
  download_expires_in: number;
  force_upgrade_after_days: number;
  latest_version: string;
}

export interface FeatureFlagsMap {
  active: boolean;
  max_premium_features: boolean;
  update_channel: Channel;
  force_upgrade_days: number;
  [key: string]: boolean | string | number;
}

export interface BootstrapResult {
  policy: ReleasePolicy | null;
  featureFlags: FeatureFlagsMap;
}

export interface UpdateCheckResult {
  available: boolean;
  version: string;
  forceUpgrade: boolean;
}

export interface LicenseData {
  token: string;
  email?: string;
  activatedAt?: number;
}
```

---

## 第3章 数据流设计

### 3.1 启动更新流程

```
[AC 启动]
    │
    ▼
[bootstrap.ts] Bootstrapper.run()
    │
    ├─ [license-manager.ts] load()
    │   ├─ 文件存在 → 解密 → return token
    │   └─ 文件不存在 → return null
    │
    ├─ [policy-client.ts] fetch(token, version)
    │   ├─ GET /v1/release?token=xxx&app_version=2.3.1
    │   │
    │   ├─ 200 → ReleasePolicy → 缓存到内存
    │   ├─ 401 → return null → 触发 clearLicense()
    │   ├─ 403 → return { active: false } → 触发 clearLicense()
    │   └─ 超时/5xx → return null → 使用默认策略
    │
    ├─ [feature-flags.ts] init(policy.features)
    │   └─ 写入 flags 单例
    │
    ├─ 版本对比
    │   ├─ 已是最新 → 静默，继续启动
    │   │
    │   ├─ 有更新，未超宽限 → 后台下载
    │   │   ├─ [r2-downloader.ts] checkForUpdates()
    │   │   ├─ [r2-downloader.ts] downloadUpdate()
    │   │   └─ 下载完成 → toast 提示重启
    │   │
    │   └─ 有更新，已超宽限 → 强制升级
    │       ├─ 弹阻断对话框
    │       ├─ 用户点击"立即升级"
    │       ├─ [r2-downloader.ts] downloadUpdate()
    │       └─ 下载完成 → 自动重启安装
    │
    └─ 返回 BootstrapResult → 继续创建窗口
```

### 3.2 激活流程

```
[用户] 在设置页输入激活码
    │
    ▼
[renderer] IPC → [main] 激活处理器
    │
    ├─ POST /v1/auth/verify → { token, tier, expire_at, features }
    │
    ├─ 成功：
    │   ├─ [license-manager.ts] save(token)
    │   └─ 提示"激活成功，请重启应用"
    │
    └─ 失败：
        ├─ INVALID_CODE → 提示激活码无效
        ├─ CODE_EXPIRED → 提示联系客服
        └─ 网络错误 → 提示重试
```

### 3.3 续费/降级流程

```
[服务端] 用户续费 → expire_at 延长
    │
    ▼
[AC 下次启动] GET /v1/release
    │
    ├─ 续费成功 → 返回 active: true, 新的 expire_at
    │
    └─ 未续费 → 返回 active: false
        │
        ├─ [license-manager.ts] clear()
        ├─ 使用默认策略（standard）
        └─ 更新通道变为 stable
```

---

## 第4章 与现有系统的集成

### 4.1 启动入口修改

在 `src/main/index.ts` 中增加一行：

```typescript
// 在 app.whenReady() 之后、窗口创建之前
import { bootstrapper } from './updater/bootstrap';

app.whenReady().then(async () => {
  await bootstrapper.run();     // ← 新增
  await createMainWindow();
});
```

### 4.2 electron-builder 配置

在 `package.json` 中新增 publish 配置：

```json
{
  "build": {
    "publish": {
      "provider": "generic",
      "url": "https://r2.alice-mod.dev/",
      "channel": "stable"
    },
    "win": { "target": "nsis" },
    "mac": { "target": ["dmg", "zip"] },
    "linux": { "target": "AppImage" }
  }
}
```

### 4.3 依赖新增

在 `package.json` 中新增：

```json
{
  "dependencies": {
    "electron-updater": "^6.3.0"
  }
}
```

### 4.4 UI 改动

需要在以下渲染器模块中新增/修改：

| 文件 | 改动 |
|---|---|
| `src/renderer/pages/Settings.tsx` | 新增"激活"入口区域 |
| `src/renderer/pages/About.tsx` | 显示版本号、更新通道、最新版本 |
| `src/renderer/components/UpdateToast.tsx` | 更新通知 toast（新建） |
| `src/renderer/components/ForceUpgradeDialog.tsx` | 强制升级对话框（新建） |

### 4.5 IPC 通信

```typescript
// 新增 IPC 通道
interface UpdaterIPC {
  // 主进程 → 渲染进程
  'updater:update-available': (version: string) => void;
  'updater:download-progress': (percent: number) => void;
  'updater:update-downloaded': () => void;
  'updater:force-upgrade': (version: string) => void;

  // 渲染进程 → 主进程
  'updater:install': () => void;      // 触发安装重启
  'updater:check-now': () => void;    // 手动检查更新
}
```

---

## 第5章 安全设计

### 5.1 Token 安全

| 维度 | 措施 |
|---|---|
| 存储 | `electron.safeStorage.encryptString()` |
| 文件 | `userData/license.dat`，二进制加密 |
| 传输 | 仅 HTTPS |
| 失效 | 服务端返回 401 时自动清空 |

### 5.2 更新包安全

| 维度 | 措施 |
|---|---|
| 下载源 | 仅通过服务端签名 URL |
| 包校验 | electron-updater 内置签名校验 |
| URL 过期 | 签名 URL 30 秒过期，防止重放 |

### 5.3 防篡改

| 攻击向量 | 防护 |
|---|---|
| 修改 license.dat | 加密存储，修改后无法解密 |
| 伪造 policy | 无意义，客户端不依赖 policy 做授权决策 |
| 替换更新包 | electron-updater 签名校验失败 |
| 阻止更新检查 | 静默失败，用户继续使用旧版 |

---

## 第6章 配置项

### 6.1 config.json 新增字段

```json
{
  "updater": {
    "server_url": "https://alice-mod-server.xxx.workers.dev",
    "check_interval_hours": 24,
    "request_timeout_ms": 5000,
    "retry_count": 3,
    "retry_delay_ms": 1000,
    "auto_download": true,
    "channel": "stable"
  }
}
```

### 6.2 环境变量

| 变量 | 用途 | 默认值 |
|---|---|---|
| `UPDATER_SERVER_URL` | 服务端地址 | 从 config.json 读取 |
| `UPDATER_DISABLE` | 禁用自动更新（开发环境） | `false` |
| `UPDATER_FORCE_CHANNEL` | 强制指定通道（调试用） | 无 |

---

## 第7章 与 Alice-App 仓库的集成

### 7.1 更新源说明

所有构建产物由 GitHub Actions 发布到 `copper-lamp/Alice-App` 仓库的 Releases 页面，并通过 R2 进行分发。AC 客户端从 R2 签名 URL 拉取更新，而非直接访问 GitHub Releases。

### 7.2 版本标签规范

AC 的版本标签遵循 `ac/v{大}.{小}.{补丁}` 格式，例如：

| 标签 | 通道 | 说明 |
|---|---|---|
| `ac/v2.3.0` | stable | 标准版 |
| `ac/v2.4.0-preview.1` | beta | 预览版 |
| `ac/v2.3.0-advanced.1` | advanced | 高级版（未来） |

详见 [SERVER 工作流方案](../../../SERVER/docs/04-GitHub工作流方案.md)。

### 7.3 R2 目录结构

```
alice-mod-releases/
├── stable/
│   ├── latest.yml           # electron-updater 元数据
│   ├── v2.3.0/
│   │   ├── Alice-App-Setup-2.3.0.exe
│   │   ├── Alice-App-2.3.0.dmg
│   │   ├── Alice-App-2.3.0.AppImage
│   │   ├── latest.yml
│   │   └── *.blockmap
│   └── v2.4.0/
│       └── ...
└── beta/
    ├── latest.yml
    └── v3.0.0-beta.1/
        └── ...
```

---

## 第8章 风险与决策

### 8.1 架构决策（ADR）

#### ADR-001 electron-updater 作为更新引擎
- **状态**：已确认
- **决策**：使用 `electron-updater` 而非自研更新逻辑
- **理由**：差分更新（blockmap）、签名校验、自动回滚、多平台支持

#### ADR-002 启动时检查而非定时检查
- **状态**：已确认
- **决策**：仅在启动时检查更新，运行时不做定时检查
- **理由**：简化逻辑，避免运行时更新干扰用户操作
- **未来扩展**：可在设置页添加"检查更新"按钮手动触发

#### ADR-003 不阻塞启动流程
- **状态**：已确认
- **决策**：更新检查超时或失败不影响 AC 正常启动
- **理由**：用户体验优先，用户不应因为网络问题无法使用软件

#### ADR-004 强制升级 UI 用模态对话框
- **状态**：已确认
- **决策**：强制升级使用阻断式模态对话框，无关闭按钮
- **理由**：确保用户必须升级，避免安全漏洞或兼容性问题

#### ADR-005 Token 用 OS keychain 而非自建加密
- **状态**：已确认
- **决策**：使用 `electron.safeStorage` 而非自建 AES 加密
- **理由**：OS 级安全，免去密钥管理

#### ADR-006 不从 GitHub Releases 直接下载
- **状态**：已确认
- **决策**：更新包通过 R2 签名 URL 分发，而非直接引用 GitHub Releases
- **理由**：R2 全球 CDN 加速、签名 URL 30 秒过期防滥用、与服务端 tier 策略联动

### 8.2 待决策项

- [ ] 是否需要支持"运行时检查更新"（设置页手动触发）
- [ ] 更新下载进度条在 UI 中的具体位置
- [ ] 差分包的上限大小（当前 < 10MB）

---

> 本文档为 AC 客户端自动更新模块的架构基线，与服务端 [SERVER 架构文档](../../../SERVER/docs/02-架构文档.md) 配套使用。