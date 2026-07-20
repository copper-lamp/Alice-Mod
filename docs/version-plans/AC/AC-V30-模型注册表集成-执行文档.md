# Alice Mod Core V30 — 模型注册表集成

> 版本：v1.0
> 日期：2026-07-20
> 版本号：V30
> 关联文档：[需求文档](AC-V30-模型注册表集成-需求文档.md)、[架构文档](AC-V30-模型注册表集成-架构文档.md)

---

## 第1章 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/agent-core/src/main/ipc/model-handler.ts` | 重构 | 核心修改：注册表拉取 + 缓存 + 三层查询 |
| `packages/agent-core/src/main/ipc/app.ts` (或启动入口) | 修改 | 添加 `initModelRegistry()` 调用 |
| `packages/agent-core/src/renderer/src/components/model/ModelAddForm.tsx` | 修改 | 添加手动输入 contextWindow/FC 的字段 |
| `packages/agent-core/src/renderer/src/components/model/ModelList.tsx` | 修改 | 后端 Provider 列表替代硬编码 |
| `packages/agent-core/src/renderer/src/components/model/ModelPanel.tsx` | 可选 | 添加注册表加载状态提示 |

---

## 第2章 修改步骤

### 2.1 Step 1: 重构 `model-handler.ts`

**文件**: `d:\McAgent\packages\agent-core\src\main\ipc\model-handler.ts`

**变更内容**:

1. **删除** `MODEL_CONTEXT_WINDOWS` 和 `MODEL_FC_SUPPORT` 两个硬编码常量（~74 行）
2. **新增** `PROVIDER_DEFAULTS` — Provider 级别默认值（~20 行）
3. **新增** 注册表缓存模块 — `initModelRegistry()`、`fetchRegistry()`、`loadCache()`、`saveCache()`、定时刷新
4. **重构** `getAutoContextWindow()` / `getAutoFC()` — 改为三层查询（注册表 → Provider 默认值 → 最终兜底）
5. **调整** 添加模型 IPC — `model:add` 的 contextWindow 逻辑改为接收 `providerId` 参数
6. **新增** `huggingface` Provider 条目

#### 新增代码结构

```typescript
// ─── Provider 默认值（代替 MODEL_CONTEXT_WINDOWS + MODEL_FC_SUPPORT）───
const PROVIDER_DEFAULTS: Record<string, { contextWindow: number; supportsFC: boolean }> = {
  openai:    { contextWindow: 128000, supportsFC: true },
  claude:    { contextWindow: 200000, supportsFC: true },
  // ... 共 16 个 Provider
}
```typescript
// ─── 注册表缓存 ───
const REGISTRY_URL = 'https://models.dev/api.json'
const CACHE_FILE = 'model-registry-cache.json'
const REFRESH_INTERVAL = 24 * 60 * 60 * 1000 // 每天一次
const REGISTRY_TIMEOUT = 30000 // 3.2MB 数据需 30s

let registryCache: Map<string, { contextWindow: number; supportsFC: boolean }> | null = null
let registryLastUpdated = 0

/** 初始化注册表（启动时调用） */
async function initModelRegistry(): Promise<void> {
  // 1. 加载本地缓存
  await loadCache()
  // 2. 异步拉取远程
  fetchRegistry().catch(() => { /* 静默失败，使用缓存 */ })
  // 3. 定时刷新
  setInterval(() => fetchRegistry().catch(() => {}), REFRESH_INTERVAL)
}

// ─── 三层查询 ───
function getAutoContextWindow(modelName: string, providerId: string): number {
  const lower = modelName.toLowerCase()
  // Layer 1: 注册表精确匹配
  if (registryCache?.has(lower)) return registryCache.get(lower)!.contextWindow
  // Layer 2: Provider 默认值
  const def = PROVIDER_DEFAULTS[providerId]
  if (def) return def.contextWindow
  // Layer 3: 最终兜底
  return 4096
}
```

#### `model:add` handler 修改

```typescript
ipcMain.handle('model:add', async (_event, config: ModelConfigItem) => {
  const db = getDatabaseManager().getDb()
  const id = `${config.providerId}:${config.modelName}`
  // 三层查询，传入 providerId
  const contextWindow = config.contextWindow || getAutoContextWindow(config.modelName, config.providerId)
  const supportsFunctionCalling = config.supportsFunctionCalling !== undefined
    ? config.supportsFunctionCalling
    : getAutoFC(config.modelName, config.providerId)
  // ... 其余逻辑不变
})
```

### 2.2 Step 2: 启动入口添加注册表初始化

**文件**: `d:\McAgent\packages\agent-core\src\main\ipc\app.ts`（需确认实际文件名）

在应用启动时调用 `initModelRegistry()`：

```typescript
import { initModelRegistry } from './model-handler'

// 在 app.whenReady() 或类似启动位置
await initModelRegistry()
```

### 2.3 Step 3: 修改前端 `ModelAddForm.tsx`

**文件**: `d:\McAgent\packages\agent-core\src\renderer\src\components\model\ModelAddForm.tsx`

**变更内容**:

1. `model:auto-context` 调用传入 `providerId` 参数
2. 添加 `contextWindow` 和 `supportsFunctionCalling` 的手动输入字段（默认隐藏，仅当自动检测值为默认值 4096 时显示提示）
3. 添加 "未检测到自动配置，请手动填写" 提示

```typescript
// 修改 model:auto-context 调用
const autoCtx = await window.electronAPI.invoke('model:auto-context', {
  modelName: modelName.trim(),
  providerId: providerId,  // 新增参数
}) as { contextWindow: number; supportsFunctionCalling: boolean }

// 新增手动输入字段
const [manualCtx, setManualCtx] = useState(autoCtx?.contextWindow || 4096)
const [manualFC, setManualFC] = useState(autoCtx?.supportsFunctionCalling ?? true)
const [showManual, setShowManual] = useState(false)

// 自动检测后，如果是默认值（4096），提示用户手动填写
useEffect(() => {
  if (autoCtx && autoCtx.contextWindow === 4096) {
    setShowManual(true)
  }
}, [autoCtx])
```

### 2.4 Step 4: 修改 `ModelList.tsx` 消除硬编码

**文件**: `d:\McAgent\packages\agent-core\src\renderer\src\components\model\ModelList.tsx`

**变更内容**:

1. 删除 `providerLabels` 硬编码对象
2. 改为从后端 `provider:full-list` 获取 Provider 信息

### 2.5 Step 5: 编译验证

```bash
cd packages/agent-core
npm run build  # 或 tsc --noEmit
```

---

## 第3章 测试方案

### 3.1 单元测试

| 测试项 | 测试方法 | 预期结果 |
|--------|---------|---------|
| 注册表拉取 | 调用 `fetchRegistry()` | 成功返回模型列表，缓存更新 |
| 注册表精确匹配 | 查询 `gpt-4o` | 返回 128000 / true |
| Provider 默认值 | 查询 `doubao-pro-256k` | 回退到 `doubao` 默认值 131072 / true |
| 完全未知模型 | 查询 `my-custom-model` + `unknown-provider` | 返回 4096 / true |
| 离线缓存 | 断网后查询 | 使用本地缓存返回值 |
| Provider 列表 | 调用 `provider:full-list` | 返回 17 个 Provider |

### 3.2 手动测试

| 测试步骤 | 操作 | 预期 |
|---------|------|------|
| 1. 启动应用 | 启动 AC | 控制台输出 "模型注册表加载完成" |
| 2. 添加已知模型 | 添加 `gpt-4o` | 自动填入 128000 contextWindow |
| 3. 添加陌生模型 | 添加 `my-model` | 显示 "未检测到自动配置" 提示，允许手动输入 |
| 4. 手动输入 | 填写 contextWindow 和 FC | 保存到 SQLite，重启后仍生效 |
| 5. 离线启动 | 断网后重启 | 模型添加功能正常，使用缓存/默认值 |

### 3.3 回滚方案

如果出现问题，回退到 Git 版本：

```bash
git checkout -- packages/agent-core/src/main/ipc/model-handler.ts
```

---

## 第4章 风险与注意事项

| 风险 | 影响 | 应对措施 |
|------|------|---------|
| models.dev 不可用 | 3.2MB 注册表数据无法拉取 | 使用本地缓存 + Provider 默认值兜底 |
| 注册表数据格式变化 | 解析失败 | 添加 try-catch 和类型校验 |
| 首次拉取较慢（~13s） | 首次启动时自动配置延迟 | 后台异步拉取，不阻塞启动，使用 Provider 默认值作为过渡 |
| 缓存文件损坏 | 启动时加载失败 | 删除损坏缓存，重新拉取 |
| 新增 Provider 需更新前端 | 前端 Provider 列表与服务端不同步 | 后端统一提供，前端动态获取 |