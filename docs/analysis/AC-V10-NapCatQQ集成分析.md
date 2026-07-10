# NapCatQQ 集成方案分析

> 版本：v1.0
> 日期：2026-07-10
> 分析目标：V10 QQ 机器人模块 · NapCatQQ 框架集成方案
> 关联文档：[AC-01-需求文档.md](../version-plans/AC/AC-01-需求文档.md)、[12-QQ外部连接工具设计.md](../tools/12-QQ外部连接工具设计.md)、[04-QQ机器人配置指南.md](../deploy/04-QQ机器人配置指南.md)

---

## 第1章 NapCatQQ 概述

### 1.1 项目定位

[NapCatQQ](https://github.com/NapNeko/NapCatQQ) 是一个基于 TypeScript 构建的现代 Bot 框架，通过主动调用 QQ Node 模块提供的接口实现 Bot 功能。它实现了 **OneBot v11 标准**，对外暴露 WebSocket/HTTP 端点。

| 特性 | 说明 |
|------|------|
| 技术栈 | TypeScript + pnpm monorepo |
| 协议标准 | OneBot v11（正向 WebSocket + HTTP） |
| 运行模式 | Shell（独立进程）/ Framework（嵌入） |
| 内存占用 | 50~100 MB（无头运行） |
| 部署方式 | Windows 直接运行 / Docker / Linux 直接部署 |
| 登录方式 | 二维码扫码 / 快速登录 / 密码登录 |
| 管理界面 | 内置 WebUI（默认端口 6099） |

### 1.2 架构层级

```
┌──────────────────────────────────────────────────┐
│                   Plugin System                   │
│  (napcat-plugin-builtin / 第三方插件)              │
├──────────────────────────────────────────────────┤
│              Management Interface                 │
│  (napcat-webui-backend / napcat-webui-frontend)   │
├──────────────────────────────────────────────────┤
│                 Network Layer                     │
│  (napcat-onebot / napcat-universal)              │
│  WebSocket / HTTP / Reverse WS                   │
├──────────────────────────────────────────────────┤
│              Protocol Adapters                    │
│  OneBot 11 标准 / NapCat 自定义协议               │
├──────────────────────────────────────────────────┤
│               Core Services                      │
│  (napcat-core) 群/好友/消息/事件 业务逻辑          │
├──────────────────────────────────────────────────┤
│              Runtime Environments                 │
│  napcat-shell (独立) / napcat-framework (嵌入)     │
├──────────────────────────────────────────────────┤
│              Native Modules                       │
│  (napcat-native) QQ NT 原生模块接口                │
└──────────────────────────────────────────────────┘
```

### 1.3 两种运行模式对比

NapCatQQ 提供两种运行模式，架构差异显著：

| 方面 | Shell 模式（独立） | Framework 模式（嵌入） |
|------|-------------------|----------------------|
| 入口 | `napcat-shell/base.ts` | `napcat-framework/napcat.ts` |
| 初始化 | `NCoreInitShell()` | `NCoreInitFramework(session, loginService, ...)` |
| QQNT 会话 | 自管理（`loadQQWrapper`） | 由宿主提供 |
| 进程模型 | Master-Worker（可选） | 单进程（集成） |
| 使用场景 | 独立部署 / Docker | 嵌入现有 QQNT 客户端 |
| 工作环境 | `NapCatCoreWorkingEnv.Shell` | `NapCatCoreWorkingEnv.Framework` |
| 是否需要 QQNT 安装 | 否（自带加载器） | 是（需要宿主进程提供） |

---

## 第2章 集成方案分析

### 2.1 方案总览

| 方案 | 描述 | 复杂度 | 用户体验 | 推荐度 |
|------|------|--------|----------|:------:|
| **A: 外部进程（当前设计）** | NapCat 独立运行，Agent Core 通过 WebSocket 连接 | ⭐ 低 | 需用户手动部署 | ⭐⭐ |
| **B: 托管子进程（推荐）** | Agent Core 自动管理 NapCat 子进程生命周期 | ⭐⭐ 中 | 一键启动 | ⭐⭐⭐⭐⭐ |
| **C: 真嵌入（Framework 模式）** | 将 NapCat 作为库嵌入 Agent Core 进程 | ⭐⭐⭐⭐⭐ 极高 | 最佳 | ⭐ |
| **D: npm 依赖引入** | 将 NapCat packages 作为 npm 依赖直接引用 | ⭐⭐⭐ 高 | 较好 | ⭐⭐ |

### 2.2 方案 A：外部进程（当前设计）

**描述：** NapCat 作为独立进程运行，Agent Core 通过正向 WebSocket 连接 NapCat 暴露的 OneBot 接口。

**架构：**
```
┌─────────────────┐     WebSocket      ┌─────────────────┐
│   Agent Core    │ ◄───────────────── │    NapCat       │
│  (Electron)     │     ws://:3001     │  (独立进程)      │
│  QQ 模块        │                    │  Shell 模式      │
└─────────────────┘                    └─────────────────┘
```

**优点：**
- 架构简单，双方解耦
- NapCat 独立崩溃不影响 Agent Core
- 已有一份完整的配置指南
- 支持 Docker 部署，运维方便

**缺点：**
- 需要用户手动安装 NapCat，增加部署步骤
- 版本管理困难（用户可能安装不兼容版本）
- 用户需要理解 NapCat 的配置方式
- 无法在 Agent Core 内部直接监测 NapCat 状态

### 2.3 方案 B：托管子进程（推荐）

**描述：** Agent Core 将 NapCat 作为受管子进程启动，自动完成下载、安装、配置、启动、监控全生命周期管理。

**架构：**
```
┌─────────────────────────────────┐
│         Agent Core              │
│  (Electron)                     │
│                                 │
│  ┌───────────────────────────┐  │
│  │    QQ 模块                 │  │
│  │  ┌─────────────────────┐  │  │
│  │  │  NapCat 托管管理器    │  │  │
│  │  │  · 自动下载/更新      │  │  │
│  │  │  · 生命周期管理       │  │  │
│  │  │  · 配置注入           │  │  │
│  │  │  · 健康监控           │  │  │
│  │  └─────────┬───────────┘  │  │
│  │            │ 管理           │  │
│  │  ┌─────────▼───────────┐  │  │
│  │  │  NapCat (子进程)     │  │  │
│  │  │  Shell 模式          │  │  │
│  │  └─────────────────────┘  │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

**优点：**
- **一键式体验**：用户只需在配置面板填写 QQ 号，点击「启动」即可
- **自动版本管理**：首次启动时自动下载 NapCat 二进制，后续可自动更新
- **配置自动注入**：Agent Core 自动生成 NapCat 配置文件，用户无需手动配置
- **状态可监控**：Agent Core 可实时获取 NapCat 进程状态、日志输出
- **崩溃自动恢复**：NapCat 进程异常退出时自动重启
- **统一的日志系统**：NapCat 日志可直接接入 Agent Core 的日志系统

**缺点：**
- NapCat 二进制文件约 50-100MB，需在安装时下载
- 子进程管理增加复杂性（需处理 Windows 进程管理和信号）
- 部分用户可能已有独立 NapCat 实例，需支持「外部模式」和「托管模式」切换

**关键实现细节：**

```typescript
// NapCat 托管管理器核心接口
interface NapCatManager {
  // 生命周期
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  
  // 状态
  getStatus(): NapCatStatus;
  getLogs(): Observable<LogEntry>;
  
  // 配置
  updateConfig(config: NapCatConfig): Promise<void>;
  
  // 管理
  downloadVersion(version: string): Promise<void>;
  checkUpdate(): Promise<UpdateInfo>;
}

// 下载目录结构
// {userData}/napcat/
//   ├── napcat.exe          # NapCat 主程序
//   ├── config/             # NapCat 配置文件
//   │   └── napcat.json     # 由 Agent Core 自动生成
//   └── logs/               # NapCat 日志
```

### 2.4 方案 C：真嵌入（Framework 模式）

**描述：** 使用 NapCat 的 Framework 模式，将 `napcat-framework` 作为库直接嵌入到 Agent Core 进程中运行。

**分析结论：不可行。** 原因如下：

1. **Framework 模式需要 QQNT 进程上下文**：Framework 模式的设计前提是宿主已经是一个 QQNT 客户端进程，NapCat 作为插件/扩展注入。Agent Core 是 Electron 桌面应用，不是 QQNT 客户端，无法提供 QQNT session 和 loginService。

2. **依赖 QQNT 原生模块**：NapCat 的 `napcat-native` 包包含编译好的 C++ 原生模块（N-API），这些模块设计为在 QQNT 的 Node.js 运行时中加载，与 Electron 的 Node.js 运行时可能存在兼容性问题。

3. **许可证风险**：直接嵌入可能涉及对 QQ 私有协议的逆向工程，在分发层面存在法律风险。外部进程模式可以明确声明"NapCat 是第三方工具，用户自行安装"。

4. **维护成本高**：NapCat 的 Framework 模式并非为通用嵌入设计，API 不稳定，跟随 NapCat 版本升级需要频繁适配。

### 2.5 方案 D：npm 依赖引入

**描述：** 将 NapCat 的 `napcat-core`、`napcat-onebot` 等包作为 npm 依赖引入，直接在 Agent Core 进程中调用其 API。

**分析结论：部分可行，但不推荐。**

- NapCat 的 monorepo 确实发布 npm 包（如 `napcat-core`、`napcat-onebot` 等）
- 但这些包仍然需要 `napcat-native` 原生模块与 QQNT 通信
- 脱离 QQNT 环境后，虽然可以启动 OneBot 服务，但无法收发消息
- 本质问题与方案 C 相同：缺少 QQNT 协议层

### 2.6 方案对比总结

| 维度 | 方案 A（外部进程） | 方案 B（托管子进程） | 方案 C（真嵌入） | 方案 D（npm 依赖） |
|------|:---:|:---:|:---:|:---:|
| 部署复杂度 | 高（手动） | 低（自动） | 低（自动） | 中 |
| 用户操作步骤 | 5+ 步 | 2 步 | 1 步 | 1 步 |
| 稳定性 | 高 | 高 | 中（同进程崩溃风险） | 中 |
| 维护成本 | 低 | 中 | 极高 | 高 |
| 跨平台兼容 | 好 | 好 | 差（依赖 QQNT） | 差 |
| 监控能力 | 弱 | 强 | 强 | 强 |
| 实现工作量 | 小 | 中 | 极大 | 大 |
| **综合推荐** | 过渡方案 | **首选** | 不推荐 | 不推荐 |

---

## 第3章 推荐方案详述（方案 B：托管子进程）

### 3.1 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                   Agent Core (Electron)                   │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              QQ 机器人模块 (A7)                       │  │
│  │                                                       │  │
│  │  ┌──────────────┐  ┌──────────────────────────────┐  │  │
│  │  │  OneBot 客户端 │  │      NapCat 托管管理器        │  │  │
│  │  │  · WS 连接     │  │  · 下载/更新                   │  │  │
│  │  │  · 消息收发     │  │  · 进程管理                   │  │  │
│  │  │  · 事件监听     │  │  · 配置注入                   │  │  │
│  │  │  · 心跳维护     │  │  · 健康监控                   │  │  │
│  │  └──────┬───────┘  │  · 日志收集                   │  │  │
│  │         │           └──────────────┬───────────────┘  │  │
│  │         │ WebSocket                │ 子进程管理        │  │
│  │         ▼                          ▼                   │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │         NapCat (Shell 子进程)                     │  │  │
│  │  │  · 独立进程 · 50-100MB · 运行在 {userData}/napcat/│  │  │
│  │  │  · stdout 日志 → Agent Core 日志系统              │  │  │
│  │  │  · 退出信号 → 自动重启逻辑                        │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  配置面板 (UI)                                       │  │
│  │  · QQ 号输入 · 启动/停止按钮 · 状态指示灯 · 日志查看   │  │
│  │  · 扫码登录集成（WebView 内嵌 NapCat 二维码页面）      │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 3.2 用户交互流程

**首次使用：**
1. 用户在配置面板输入 QQ 号
2. 点击「启动 NapCat」按钮
3. Agent Core 检查本地 NapCat 二进制是否存在 → 不存在则自动下载
4. 自动生成 NapCat 配置文件（端口、Token 等）
5. 启动 NapCat 子进程
6. 子进程输出二维码 → Agent Core 捕获并显示在 UI 中
7. 用户用手机 QQ 扫码登录
8. 登录成功 → NapCat 就绪 → Agent Core 自动建立 WebSocket 连接
9. 状态指示灯变为绿色「已连接」

**日常使用：**
- 启动 Agent Core 时自动启动 NapCat（可配置）
- 退出 Agent Core 时自动关闭 NapCat
- NapCat 崩溃时自动重启，并在 UI 中提示
- 日志实时显示在 Agent Core 的日志面板中

**更新：**
- Agent Core 启动时检查 NapCat 新版本
- 用户点击「检查更新」按钮
- 下载新版本 → 替换旧版本 → 重启 NapCat

### 3.3 配置自动生成

Agent Core 自动生成 NapCat 配置文件，用户无需手动配置：

```json
{
  "port": 3001,
  "host": "127.0.0.1",
  "accessToken": "auto-generated-uuid",
  "account": "<用户输入的QQ号>",
  "webui": {
    "port": 0,
    "enabled": false
  },
  "heartbeat": {
    "interval": 10000,
    "enabled": true
  }
}
```

> 注意：NapCat WebUI 端口默认关闭（`port: 0`），因为 Agent Core 本身提供了 UI，无需启动 NapCat 自带的 WebUI 以减少资源占用。

### 3.4 进程管理核心逻辑

```typescript
class NapCatProcessManager {
  private process: ChildProcess | null = null;
  private restartCount = 0;
  private readonly maxRestarts = 3;
  private readonly restartWindow = 10000; // 10秒窗口

  async start(): Promise<void> {
    const napcatPath = await this.ensureNapCatBinary();
    const configPath = await this.writeConfig();
    
    this.process = spawn(napcatPath, ['--mode', 'shell'], {
      cwd: this.napcatDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // 日志收集管道
    this.process.stdout!.on('data', (chunk) => {
      this.logCollector.write(chunk);
      this.checkQRCode(chunk); // 检测二维码输出
    });

    this.process.on('exit', (code) => {
      if (code !== 0) this.handleCrash();
    });
  }

  private handleCrash(): void {
    const now = Date.now();
    if (now - this.lastCrashTime < this.restartWindow) {
      this.restartCount++;
    } else {
      this.restartCount = 1;
    }
    this.lastCrashTime = now;

    if (this.restartCount <= this.maxRestarts) {
      this.start(); // 自动重启
    } else {
      this.emit('status', 'crashed');
    }
  }
}
```

### 3.5 与现有设计的兼容性

方案 B 完全向后兼容现有设计：

| 现有设计 | 兼容性 |
|----------|--------|
| [04-QQ机器人配置指南.md](../deploy/04-QQ机器人配置指南.md) | 托管模式新增「一键启动」流程，外部模式仍可用 |
| [12-QQ外部连接工具设计.md](../tools/12-QQ外部连接工具设计.md) | 上层 OneBot 客户端接口不变，工具设计不受影响 |
| [AC-01-需求文档.md](../version-plans/AC/AC-01-需求文档.md) V10 需求 | 全部满足 |
| 已有 Docker 部署用户 | 可继续使用外部模式，不受影响 |

**双模式支持：**

```typescript
interface QQConfig {
  mode: 'managed' | 'external';  // 托管模式 / 外部模式
  
  // 托管模式配置
  managed?: {
    account: string;
    auto_start: boolean;
    auto_update: boolean;
  };
  
  // 外部模式配置（现有）
  external?: {
    ws_host: string;
    ws_port: number;
    access_token: string;
  };
}
```

---

## 第4章 实施建议

### 4.1 分阶段实施

| 阶段 | 版本 | 内容 | 工作量 |
|------|:----:|------|:------:|
| **Phase 1** | V10 | 外部模式实现 + OneBot 客户端 + QQ 工具 | 基础 |
| **Phase 2** | V10.1 | 托管子进程管理器（NapCat 下载/启动/配置注入） | 中等 |
| **Phase 3** | V10.2 | 进程监控 + 自动恢复 + 崩溃告警 | 小 |
| **Phase 4** | V10.3 | 二维码内置显示 + 一键登录交互 | 小 |
| **Phase 5** | V10.4 | 自动更新机制 | 小 |

### 4.2 关键风险

| 风险 | 等级 | 应对措施 |
|------|:----:|----------|
| NapCat 二进制文件分发合规性 | 中 | 仅在用户同意后从官方 GitHub Releases 下载，不自行分发 |
| QQ 账号风控 | 高 | 使用小号 + 频率限制 + 文档说明风险 |
| NapCat 版本更新导致配置变更 | 中 | 托管管理器做版本适配，锁定已知兼容版本 |
| Windows 子进程管理复杂 | 中 | 使用 `child_process.spawn` + 进程组管理，处理 Windows 信号差异 |
| 多用户场景下 NapCat 实例冲突 | 低 | 单实例限制，每个 Agent Core 只管理一个 NapCat 进程 |

### 4.3 与项目技术栈的匹配度

| 技术栈 | NapCatQQ | McAgent | 匹配度 |
|--------|----------|---------|:------:|
| TypeScript | ✅ | ✅ | 完全一致 |
| pnpm monorepo | ✅ | ✅ | 完全一致 |
| Electron | ❌（无头） | ✅ | 互补 |
| Node.js 20+ | ✅ | ✅ | 完全一致 |
| Windows/Linux/macOS | ✅ | ✅ | 完全一致 |

NapCatQQ 与 McAgent 技术栈高度一致，均为 TypeScript + pnpm monorepo，降低了集成和维护成本。

---

## 第5章 结论

### 最终推荐：方案 B（托管子进程）

| 决策 | 说明 |
|------|------|
| **推荐方案** | 方案 B：NapCat 作为 Agent Core 的托管子进程 |
| **嵌入可行性** | 不可行（NapCat Framework 模式依赖 QQNT 进程上下文，无法嵌入非 QQNT 应用） |
| **实施路径** | 先实现方案 A（外部模式）作为 V10 基础，再逐步演进到方案 B |
| **用户价值** | 从手动部署 5+ 步 → 一键启动，大幅降低使用门槛 |
| **技术风险** | 可控，NapCat 与 McAgent 技术栈高度一致 |

### 路线图

```
V10 Phase 1: 外部模式实现
  └── OneBot WebSocket 客户端
  └── qq_send / qq_info 工具
  └── 消息桥接（QQ ↔ 游戏）
  └── 权限控制体系

V10 Phase 2: 托管子进程管理器
  └── NapCat 二进制下载/校验
  └── 配置自动生成
  └── 子进程启动/停止/重启

V10 Phase 3: 监控与自动恢复
  └── 进程健康监控
  └── 崩溃自动恢复
  └── 日志实时收集

V10 Phase 4: 交互优化
  └── 二维码内置显示
  └── 状态面板集成
  └── 一键登录流程

V10.5+: 持续优化
  └── 自动更新
  └── 多实例支持
  └── WebUI 融合
```