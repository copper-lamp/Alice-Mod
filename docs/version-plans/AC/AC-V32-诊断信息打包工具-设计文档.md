# AC-V32 — 诊断信息打包工具

> 版本：v2.0
> 日期：2026-07-23
> 版本号：V32
> 类型：设计文档

---

## 1. 概述

后台自动生成诊断信息 ZIP 包，用户只需要找到压缩包文件发给开发者即可。

### 关键约束

| 条目 | 值 |
|------|-----|
| **最大体积** | 200MB |
| **生成方式** | 后台自动，无需用户操作 |
| **用户操作** | 0 — 用户只负责找到 `.zip` 文件并发送 |
| **输出位置** | 应用数据目录下的 `diagnose/` 文件夹 |

---

## 2. 触发时机

诊断包**自动生成**，无需用户触发：

| 时机 | 说明 |
|------|------|
| **应用启动时** | 每次启动都生成一份，保留最近 3 份，自动清理旧的 |
| **异常崩溃后** | 下次启动时检测到上次异常退出，额外生成一份带崩溃上下文的包 |
| **定时生成** | 每 24 小时生成一份（仅保留最近 3 份） |

用户不需要知道诊断包的存在，只需要在需要时去 `diagnose/` 目录找文件发给开发者。

---

## 3. 打包内容

### 3.1 文件清单

```
diagnose_20260723_143022.zip
├── info.json                 # 基础环境信息
├── config_snapshot.json      # 配置快照（脱敏）
├── recent_logs.txt           # 最近日志（限 500KB，超长截断）
├── tool_call_history.json    # 最近 50 条工具调用记录
├── game_state.json           # 当前游戏状态
└── workspace_list.json       # 工作区列表与状态
```

### 3.2 各文件内容

#### info.json

```json
{
  "agentVersion": "1.0.0",
  "buildTime": "2026-07-23T10:00:00Z",
  "os": "Windows 10",
  "nodeVersion": "20.11.0",
  "electronVersion": "28.0.0",
  "adapterTypes": ["JE"],
  "uptimeSeconds": 3600,
  "memoryUsage": { "heapUsed": 256000000, "heapTotal": 512000000, "rss": 600000000 },
  "crashInfo": { "lastExitCode": -1, "lastRunCrashed": true }
}
```

#### config_snapshot.json

从 `config.json` 提取，跳过敏感键名：

```
apiKey, api_key, apikey, token, password, passwd, secret, authorization
```

#### recent_logs.txt

取最近日志，**体积上限 500KB**，超长时从末尾截断，头部加一行说明：

```
[日志已截断，仅保留最近 500KB]
[2026-07-23 14:30:22] [ERROR] [ToolDispatcher] tool_call failed: timeout
...
```

#### tool_call_history.json

从内存环形缓冲区取最近 50 条，JSON 紧凑格式（无缩进）：

```json
[{"tool":"move_to","success":true,"durationMs":1500,"timestamp":"2026-07-23T14:30:00Z"}]
```

#### game_state.json

```json
{
  "connected": true,
  "dimension": "minecraft:overworld",
  "health": 18,
  "hunger": 16,
  "position": { "x": 100, "y": 64, "z": -200 },
  "adapterType": "JE"
}
```

无活跃连接时内容为 `{ "connected": false }`。

---

## 4. 体积控制策略

### 4.1 各项目标体积

| 文件 | 目标体积 | 控制手段 |
|------|---------|---------|
| `info.json` | < 1KB | 固定字段，体积稳定 |
| `config_snapshot.json` | < 10KB | 固定字段，体积稳定 |
| `recent_logs.txt` | **≤ 500KB** | 超长截断，只保留末尾 |
| `tool_call_history.json` | < 50KB | 固定 50 条，紧凑格式 |
| `game_state.json` | < 1KB | 固定字段 |
| `workspace_list.json` | < 1KB | 固定字段 |
| **ZIP 总大小** | **< 200MB** | 以上总和解压后 ≈ 560KB，压缩后 < 100KB |

### 4.2 压缩策略

| 策略 | 说明 |
|------|------|
| **JSON 紧凑格式** | 所有 JSON 文件使用 `JSON.stringify(obj)` 无缩进，而非 `null, 2` 美化格式，体积减少约 60% |
| **日志截断** | 日志文本限制 500KB，超长时从末尾截断，防止日志膨胀 |
| **ZIP 压缩级别** | 使用最高压缩级别 `level: 9`，文本类数据压缩率通常可达 10:1 ~ 20:1 |
| **文件数限制** | 仅打包 6 个核心文件，不包含任何二进制文件（截图、数据库等） |
| **生成后校验** | 生成完成后检查 ZIP 大小，若超过 200MB 则重新生成：日志缩至 100KB、工具调用缩至 20 条 |

### 4.3 体积估算

```
info.json (1KB) + config.json (10KB) + logs (500KB) + tool_calls (50KB) + game_state (1KB) + workspace (1KB)
= 解压后约 563KB

ZIP level 9 压缩后 ≈ 50KB ~ 100KB
远低于 200MB 限制，日志截断和紧凑格式已经足够
```

---

## 5. 实现

### 5.1 文件结构

```
packages/agent-core/src/main/
├── diagnose/
│   ├── index.ts          # 定时器 + 启动自动生成
│   ├── collector.ts      # 各信息采集 + 脱敏
│   ├── packer.ts         # 打包 + 体积控制
│   └── scheduler.ts      # 自动调度（启动/定时/崩溃检测）
```

### 5.2 核心代码

```typescript
// diagnose/index.ts
export { initDiagnoseScheduler } from './scheduler';
export { generateDiagnoseZip } from './packer';
```

```typescript
// diagnose/scheduler.ts
import { generateDiagnoseZip } from './packer';
import path from 'path';
import fs from 'fs';

const DIAGNOSE_DIR = path.join(app.getPath('userData'), 'diagnose');
const MAX_KEEP = 3;
const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 小时

export function initDiagnoseScheduler(): void {
  fs.mkdirSync(DIAGNOSE_DIR, { recursive: true });

  // 启动时生成
  generateWithCleanup();

  // 检测上次是否崩溃
  const lastExit = getLastExitCode();
  if (lastExit !== 0) {
    generateWithCleanup({ reason: 'crash', lastExitCode: lastExit });
  }

  // 每 24 小时定时生成
  setInterval(() => generateWithCleanup(), INTERVAL_MS);
}

async function generateWithCleanup(options?: object): Promise<void> {
  const zipPath = await generateDiagnoseZip(DIAGNOSE_DIR, options);
  cleanupOldFiles(DIAGNOSE_DIR, MAX_KEEP);
}

function cleanupOldFiles(dir: string, keep: number): void {
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.zip'))
    .map(f => ({ name: f, time: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);

  files.slice(keep).forEach(f => fs.unlinkSync(path.join(dir, f)));
}
```

```typescript
// diagnose/collector.ts
const SENSITIVE_KEYS = new Set([
  'apiKey', 'api_key', 'apikey',
  'token', 'password', 'passwd', 'secret', 'authorization',
]);

export interface DiagnoseInfo {
  info: object;
  config: object;
  logs: string;
  toolCalls: string;  // 紧凑 JSON 字符串
  gameState: object;
  workspaces: object[];
}

export async function collectDiagnoseInfo(
  options?: { reason?: string; lastExitCode?: number },
): Promise<DiagnoseInfo> {
  return {
    info: collectEnvironmentInfo(options),
    config: collectConfigSnapshot(),
    logs: collectLogs(500 * 1024), // 最多 500KB
    toolCalls: collectToolCallsCompact(),
    gameState: collectGameState(),
    workspaces: collectWorkspaceList(),
  };
}

function collectLogs(maxBytes: number): string {
  const raw = getLogBuffer().getRecent(99999);
  let text = raw.map(l => `[${l.timestamp}] [${l.level}] [${l.module}] ${l.message}`).join('\n');

  if (Buffer.byteLength(text, 'utf-8') > maxBytes) {
    // 从末尾截断
    let truncated = `[日志已截断，仅保留最近 ${Math.round(maxBytes / 1024)}KB]\n`;
    let remaining = maxBytes - Buffer.byteLength(truncated, 'utf-8');
    // 从后往前逐行添加
    const lines = text.split('\n');
    let tail = '';
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i] + '\n';
      if (Buffer.byteLength(line, 'utf-8') > remaining) break;
      tail = line + tail;
      remaining -= Buffer.byteLength(line, 'utf-8');
    }
    text = truncated + tail;
  }
  return text;
}

function collectToolCallsCompact(): string {
  const calls = getToolCallHistory().getRecent(50);
  // 紧凑格式，移除 params 中敏感字段
  const sanitized = calls.map(c => ({
    t: c.tool,
    s: c.success,
    d: c.durationMs,
    ts: c.timestamp,
  }));
  return JSON.stringify(sanitized);
}

function collectConfigSnapshot(): object {
  return sanitizeConfig(getFullConfig());
}

function sanitizeConfig(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeConfig);
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = sanitizeConfig(value);
    }
  }
  return result;
}
```

```typescript
// diagnose/packer.ts
import archiver from 'archiver';
import fs from 'fs';

const MAX_ZIP_SIZE = 200 * 1024 * 1024; // 200MB

export async function generateDiagnoseZip(
  outputDir: string,
  options?: object,
): Promise<string> {
  const info = await collectDiagnoseInfo(options);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const fileName = `diagnose_${timestamp}.zip`;
  const outputPath = path.join(outputDir, fileName);

  await packToZip(info, outputPath);

  // 生成后校验体积
  const size = fs.statSync(outputPath).size;
  if (size > MAX_ZIP_SIZE) {
    // 超过限制，用更严格的参数重新生成
    console.warn(`[Diagnose] ZIP 体积 ${size} 超过 200MB 限制，重新生成`);
    await packToZipWithStrictLimits(info, outputPath, size);
  }

  return outputPath;
}

async function packToZip(info: DiagnoseInfo, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } }); // 最高压缩

    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);

    // 所有 JSON 使用紧凑格式（无缩进）
    archive.append(JSON.stringify(info.info), { name: 'info.json' });
    archive.append(JSON.stringify(info.config), { name: 'config_snapshot.json' });
    archive.append(info.logs, { name: 'recent_logs.txt' });
    archive.append(info.toolCalls, { name: 'tool_call_history.json' });
    archive.append(JSON.stringify(info.gameState), { name: 'game_state.json' });
    archive.append(JSON.stringify(info.workspaces), { name: 'workspace_list.json' });

    archive.finalize();
  });
}

// 严格模式：缩减日志和工具调用量
async function packToZipWithStrictLimits(
  info: DiagnoseInfo,
  outputPath: string,
  originalSize: number,
): Promise<void> {
  // 重新采集：日志缩至 100KB，工具调用缩至 20 条
  const strictInfo = await collectDiagnoseInfoStrict();
  await packToZip(strictInfo, outputPath);

  const finalSize = fs.statSync(outputPath).size;
  if (finalSize > MAX_ZIP_SIZE) {
    fs.unlinkSync(outputPath);
    throw new Error(`诊断包体积 ${finalSize} 仍超过 200MB 限制，请检查是否存在异常大文件`);
  }
}
```

### 5.3 输出位置

ZIP 文件保存在应用数据目录下的 `diagnose/` 文件夹：

| 平台 | 路径 |
|------|------|
| Windows | `%APPDATA%/alice-mod/diagnose/` |
| macOS | `~/Library/Application Support/alice-mod/diagnose/` |
| Linux | `~/.config/alice-mod/diagnose/` |

保留最近 3 份，旧文件自动清理。

---

## 6. 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `packages/agent-core/src/main/diagnose/index.ts` | **新增** | 模块导出 |
| `packages/agent-core/src/main/diagnose/collector.ts` | **新增** | 信息采集 + 脱敏 + 日志截断 + 紧凑格式 |
| `packages/agent-core/src/main/diagnose/packer.ts` | **新增** | ZIP 打包 + 体积校验 + 严格模式回退 |
| `packages/agent-core/src/main/diagnose/scheduler.ts` | **新增** | 自动调度（启动/定时/崩溃检测）+ 旧文件清理 |
| `packages/agent-core/src/main/index.ts` | 修改 | 启动时调用 `initDiagnoseScheduler()` |

---

## 7. 验收标准

| 验收项 | 预期结果 |
|--------|---------|
| 启动时自动生成 | 应用启动后 `diagnose/` 目录出现 ZIP 文件 |
| ZIP 包含 6 个文件 | info.json / config_snapshot.json / recent_logs.txt / tool_call_history.json / game_state.json / workspace_list.json |
| 敏感字段脱敏 | API Key、Token 等字段显示 `[REDACTED]` |
| 日志 ≤ 500KB | 超长时末尾截断，头部有截断提示 |
| JSON 紧凑格式 | 所有 JSON 文件一行无缩进 |
| ZIP 压缩级别 9 | 使用最高压缩比 |
| 总大小 ≤ 200MB | 超出后自动用严格模式重试（日志 100KB + 工具调用 20 条） |
| 保留最近 3 份 | 生成第 4 份时自动删除最早的一份 |
| 崩溃检测 | 上次异常退出时，下次启动额外生成一份带崩溃码的包 |
| 24 小时定时 | 每 24 小时自动生成新包 |