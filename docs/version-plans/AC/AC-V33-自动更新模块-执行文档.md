# AC 自动更新模块 - 执行文档

> 模块：Agent Core（AC）客户端
> 文档版本：v1.0
> 日期：2026-07-23
> 上游文档：
> - [AC-V33-自动更新模块-需求文档.md](./AC-V33-自动更新模块-需求文档.md)
> - [AC-V33-自动更新模块-架构文档.md](./AC-V33-自动更新模块-架构文档.md)
> 关联服务端：[SERVER 执行文档](../../../SERVER/docs/03-执行文档.md)

---

## 第1章 当前状态

> 本文档为**设计阶段**输出。所有代码尚未实现，需要后续 Phase 逐项落地。

**本阶段交付物**：
- [x] 需求文档（AC-V33-自动更新模块-需求文档.md）
- [x] 架构文档（AC-V33-自动更新模块-架构文档.md）
- [x] 执行文档（AC-V33-自动更新模块-执行文档.md）
- [ ] 核心模块代码（`src/main/updater/`）
- [ ] UI 组件（激活入口、更新通知、强制升级对话框）
- [ ] 单元测试
- [ ] 集成测试

---

## 第2章 目录结构

### 2.1 新增文件

```
d:\McAgent\packages\agent-core\src\main\updater\
├── index.ts                    # 模块导出
├── bootstrap.ts                # 启动流程编排
├── license-manager.ts          # token 加密存储
├── policy-client.ts            # 策略 API 调用
├── feature-flags.ts            # Feature Flag 单例
├── r2-downloader.ts            # electron-updater 包装
└── types.ts                    # 共享类型定义
```

### 2.2 修改文件

```
d:\McAgent\packages\agent-core\
├── src/main/index.ts                       # 新增 bootstrapUpdater() 调用
├── src/renderer/pages/Settings.tsx         # 新增激活入口区域
├── src/renderer/pages/About.tsx            # 新增版本信息展示
├── src/renderer/components/UpdateToast.tsx # 新建：更新通知 toast
├── src/renderer/components/ForceUpgradeDialog.tsx  # 新建：强制升级对话框
├── package.json                            # 新增 electron-updater 依赖 + publish 配置
└── config.json                             # 新增 updater 配置段
```

---

## 第3章 实施阶段

### Phase 1：核心模块实现（2 天）

> 目标：updater/ 目录下所有核心模块可运行，覆盖标准版用户路径

#### 任务清单

- [ ] **1.1** 实现 `types.ts`
  - 定义 `ReleasePolicy`、`FeatureFlagsMap`、`BootstrapResult`、`UpdateCheckResult` 等接口
  - 与服务端 SERVER 架构文档中的类型定义保持一致

- [ ] **1.2** 实现 `license-manager.ts`
  - 使用 `electron.safeStorage` 加密/解密 token
  - 文件路径：`app.getPath('userData')/license.dat`
  - 提供 `save()` / `load()` / `clear()` 三个方法
  - 处理 `safeStorage.isEncryptionAvailable()` 不可用时的降级（不加密，但记录警告日志）

- [ ] **1.3** 实现 `policy-client.ts`
  - 封装 `GET /v1/release?token=xxx&app_version=x.x.x`
  - 默认超时 5 秒
  - 重试策略：3 次，指数退避（1s → 2s → 4s）
  - 处理 401（返回 null）、403（返回 active=false）、5xx/网络错误（重试后返回 null）
  - 标准版用户（无 token）直接返回默认策略

- [ ] **1.4** 实现 `feature-flags.ts`
  - 单例模式，默认值：
    ```typescript
    { active: true, max_premium_features: false, update_channel: 'stable', force_upgrade_days: 14 }
    ```
  - 提供 `init()` / `get()` / `getAll()` 方法
  - 类型安全：`get<T>(key: string): T`

- [ ] **1.5** 实现 `r2-downloader.ts`
  - 包装 `electron-updater`
  - 运行时动态设置 `channel` 和 `feedURL`
  - 暴露 `checkForUpdates()` / `downloadUpdate()` / `installAndRestart()`
  - 事件：`onProgress` / `onUpdateDownloaded` / `onError`

- [ ] **1.6** 实现 `bootstrap.ts`
  - 编排完整启动流程：loadLicense → fetchPolicy → compareVersion → handleUpdate → initFeatureFlags
  - 版本对比逻辑：
    - `current.major < policy.allowed_major` → 有更新
    - `current.major === policy.allowed_major && current.minor < policy.allowed_minor` → 有更新
    - 否则 → 已是最新
  - 强制升级判断：`daysSinceRelease > policy.force_upgrade_after_days`
  - 非强制更新：后台下载，不阻塞启动
  - 强制更新：弹阻断对话框，阻塞启动

- [ ] **1.7** 修改 `src/main/index.ts`
  - 在 `app.whenReady()` 后、`createMainWindow()` 前调用 `bootstrapUpdater()`

#### 验收

- [ ] `license-manager` 单元测试通过（加密/解密/clear/文件不存在）
- [ ] `policy-client` 单元测试通过（成功/401/重试/超时）
- [ ] `feature-flags` 单元测试通过（init/get/默认值）
- [ ] `bootstrap.ts` 在标准版用户路径下不阻塞启动
- [ ] 启动日志中能看到更新检查结果

---

### Phase 2：UI 集成（1 天）

> 目标：用户可视化的激活入口、更新通知、版本信息

#### 任务清单

- [ ] **2.1** 渲染进程 IPC 通道
  - 定义 `updater:update-available`、`updater:download-progress`、`updater:update-downloaded`、`updater:force-upgrade` 事件
  - 主进程在更新事件发生时通知渲染进程

- [ ] **2.2** 设置页激活入口（`Settings.tsx`）
  - 未激活：显示"升级 Pro"（¥19.9/季）和"升级 Max"（¥79.9/年）按钮
  - 已激活：显示当前 tier、到期时间、续费链接
  - 即将过期（7 天内）：显示警告横幅
  - 激活码输入框 + 提交按钮

- [ ] **2.3** 关于页版本信息（`About.tsx`）
  - 显示：当前版本号、更新通道、最新版本号（如有）
  - "检查更新"按钮（手动触发）

- [ ] **2.4** 更新通知 toast（`UpdateToast.tsx`）
  - 更新可用时右下角弹出
  - 显示新版本号
  - "立即更新"按钮 → 触发下载安装
  - "稍后"按钮 → 关闭 toast，下次启动再提示

- [ ] **2.5** 强制升级对话框（`ForceUpgradeDialog.tsx`）
  - 模态对话框，无关闭按钮
  - 显示"请升级到最新版本以继续使用"
  - "立即升级"按钮 → 下载并安装
  - 下载进度条
  - 下载完成后自动重启

#### 验收

- [ ] 未激活用户能看到"升级"按钮，点击跳转爱发电
- [ ] 已激活用户能看到 tier 和到期时间
- [ ] 更新可用时 toast 弹出
- [ ] 强制升级对话框无法关闭
- [ ] 手动"检查更新"按钮工作正常

---

### Phase 3：服务端联调（1 天）

> 目标：AC 客户端与 SERVER 服务端完整流程打通

#### 前置条件

- SERVER 服务端 Phase 1-2 已完成（Webhook、策略下发、R2 签名）
- 服务端 `GET /v1/release` 接口可用
- R2 上已有测试用的 `latest.yml` 和安装包

#### 任务清单

- [ ] **3.1** 配置 `config.json` 中的 `updater.server_url`
- [ ] **3.2** 标准版用户路径测试
  - 无 token 启动 → 拉取默认策略 → stable 通道
  - 手动上传一个更高的版本到 R2 stable → 启动后检测到更新

- [ ] **3.3** Pro 用户路径测试
  - 手动调用 `POST /v1/auth/verify` 获取 token
  - 写入 `license.dat` → 重启 → 检测到 beta 通道更新

- [ ] **3.4** Max 用户路径测试
  - 获取 Max token → 重启 → 检测到 stable 通道（与标准版相同）

- [ ] **3.5** 强制升级测试
  - 设置 `force_upgrade_after_days = 0` → 启动后弹出强制升级对话框

- [ ] **3.6** 差分更新测试
  - 从 v2.3.0 升到 v2.4.0（同 minor）→ 下载量应 < 10MB

- [ ] **3.7** 异常场景测试
  - 服务端不可用 → 使用默认策略，不报错
  - 401 返回 → 清空 token，降级为标准版
  - 网络超时 → 重试 3 次后跳过

#### 验收

- [ ] 三档用户都能正确获取对应通道的更新
- [ ] 强制升级对话框按配置天数弹出
- [ ] 网络故障时不影响使用
- [ ] 失效 token 自动清空

---

### Phase 4：测试与发布（1 天）

> 目标：完整的测试覆盖，准备上线

#### 任务清单

- [ ] **4.1** 单元测试
  - `license-manager.test.ts`：加密/解密/文件不存在/clear
  - `policy-client.test.ts`：成功/401/重试/超时/标准版
  - `feature-flags.test.ts`：init/get/默认值/未知 key

- [ ] **4.2** 集成测试
  - 模拟服务端返回各种 policy 场景
  - 模拟网络故障场景

- [ ] **4.3** 端到端测试
  - 在开发环境启动一个 mock 服务端
  - 运行完整启动流程

- [ ] **4.4** 代码审查
  - 检查是否有 `tier ===` 硬编码出现在非 updater 模块
  - 确保所有错误路径都有日志记录

- [ ] **4.5** 文档更新
  - 更新 `README.md` 中的更新模块说明
  - 更新相关配置文档

#### 验收

- [ ] 单元测试覆盖率 > 80%
- [ ] 集成测试覆盖所有关键路径
- [ ] 代码审查通过
- [ ] 文档更新完成

---

## 第4章 测试计划

### 4.1 单元测试

| 模块 | 覆盖率目标 | 关键用例 |
|---|---|---|
| license-manager | > 90% | 加密/解密/文件不存在/clear/OS keychain 不可用 |
| policy-client | > 85% | 成功/401/403/429/5xx/超时/重试/标准版 |
| feature-flags | > 95% | init/get/默认值/未知 key/类型安全 |
| bootstrap | > 80% | 完整流程/强制升级/后台下载/超时降级 |

### 4.2 集成测试场景

| 场景 | 条件 | 预期 |
|---|---|---|
| 标准版启动 | 无 token，policy 可用 | 使用 stable 通道，不弹更新 |
| 标准版有更新 | 无 token，policy 有更高版本 | 后台下载更新 |
| Pro 启动 | 有 token，policy 返回 beta | 通道为 beta，可升到更高 major |
| Max 启动 | 有 token，policy 返回 stable | 通道为 stable，与标准版相同 |
| 强制升级 | 超过宽限天数 | 弹阻断对话框 |
| 401 响应 | token 过期 | 清空 token，降级为标准版 |
| 网络不可用 | 无网络连接 | 使用默认策略，跳过更新检查 |
| 重复激活 | 用同一激活码两次 | 第二次失败 |

### 4.3 安全测试

| 测试项 | 方法 | 预期 |
|---|---|---|
| 伪造 token | 写入任意字符串到 license.dat | 服务端返回 401，清空 |
| 篡改 policy | 修改本地缓存 | 下次启动重新拉取覆盖 |
| 拦截更新包 | 替换下载 URL | electron-updater 签名校验失败 |
| 硬编码检查 | grep 客户端代码 | 非 updater 模块无 `tier ===` |

---

## 第5章 上线检查清单

### 5.1 上线前

- [ ] Phase 1-3 所有任务完成
- [ ] 单元测试覆盖率达标
- [ ] 集成测试 100% 通过
- [ ] 代码审查通过
- [ ] 文档审核完成
- [ ] 服务端 `GET /v1/release` 接口可用
- [ ] R2 上已有测试用的安装包
- [ ] 三个测试用户（标准/Pro/Max）已准备好

### 5.2 上线当天

- [ ] 合并代码到 main 分支
- [ ] 打 tag 发布新版本
- [ ] 验证 CI 构建通过
- [ ] 验证 R2 上 latest.yml 正确
- [ ] 内测用户验证更新流程

### 5.3 上线后 7 天

- [ ] 监控更新检查的成功率
- [ ] 收集用户反馈
- [ ] 修补 P0 缺陷

---

## 第6章 时间规划

| Phase | 任务 | 预计工时 | 累计 |
|---|---|---|---|
| Phase 1 | 核心模块实现 | 16h | 2d |
| Phase 2 | UI 集成 | 8h | 3d |
| Phase 3 | 服务端联调 | 8h | 4d |
| Phase 4 | 测试与发布 | 8h | 5d |
| **总计** | | **40h** | **5d** |

---

## 第7章 回滚方案

### 7.1 代码回滚

```bash
# 回滚 updater 模块
git revert <commit-hash>

# 重新发布
git push origin main
```

### 7.2 紧急停止更新

如果发布的版本有严重问题，需要阻止用户更新：

```sql
-- 服务端操作：将 allowed_major 锁定到当前版本
UPDATE release_policy
SET allowed_major = <current_major>,
    allowed_minor = <current_minor>
WHERE tier = 'pro';
```

### 7.3 客户端回滚

如果用户安装了有问题的新版本：

```bash
# 用户手动操作：重新安装旧版本
# electron-updater 不支持自动回滚到旧版本
# 需要用户从 GitHub Releases 下载旧版本手动安装
```

---

## 第8章 依赖与外部接口

### 8.1 npm 依赖

```bash
pnpm add electron-updater@^6.3.0
```

### 8.2 外部 API

| API | 方法 | 用途 | 文档 |
|---|---|---|---|
| `GET /v1/release` | HTTP | 拉取 Release Policy | [SERVER 架构文档](../../../SERVER/docs/02-架构文档.md) |
| `POST /v1/auth/verify` | HTTP | 激活码兑换 token | [SERVER 架构文档](../../../SERVER/docs/02-架构文档.md) |
| `POST /v1/auth/reissue` | HTTP | 重发激活码 | [SERVER 架构文档](../../../SERVER/docs/02-架构文档.md) |

### 8.3 配置文件

在 `config.json` 中新增：

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

---

> 本文档为 AC 客户端自动更新模块的执行基线，与服务端 [SERVER 执行文档](../../../SERVER/docs/03-执行文档.md) 配套使用。