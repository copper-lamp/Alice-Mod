# AC-V32 — 诊断信息打包工具

> 版本：v1.0
> 日期：2026-07-23
> 版本号：V32
> 类型：设计文档
> 关联文档：[IT-04-集成测试总结与上线检查清单.md](../IT/IT-04-集成测试总结与上线检查清单.md)

---

## 1. 概述

测试版本上线后，需要从用户手里拿到诊断信息来定位问题。设计一个后台工具，一键打包运行环境的关键信息为 ZIP 文件，用户手动发给我们。

### 目标

- **用户操作简单**：一个命令 / 一个按钮，生成 ZIP 包
- **信息完整**：自动收集版本、配置、日志、工具调用记录、游戏状态
- **隐私安全**：敏感字段自动脱敏，ZIP 生成后用户可预览再发送

---

## 2. 功能设计

### 2.1 触发方式

| 方式 | 说明 |
|------|------|
| **QQ Bot 命令** | 私聊发送 `生成诊断包`，Bot 回复 ZIP 文件路径 |
| **Dashboard 按钮** | 设置页新增「生成诊断包」按钮，下载 ZIP |
| **命令行参数** | 启动时加 `--diagnose` 参数，启动后直接生成并退出 |

### 2.2 打包内容

ZIP 包内包含以下文件（文件名为 `diagnose_YYYYMMDD_HHmmss`）：

```
diagnose_20260723_143022.zip
├── info.json                 # 基础环境信息
├── config_snapshot.json      # 配置快照（脱敏）
├── recent_logs.txt           # 最近 200 行日志
├── tool_call_history.json    # 最近 50 条工具调用记录
├── game_state.json           # 当前游戏状态（如果有活跃连接）
└── workspace_list.json       # 工作区列表与状态
```

### 2.3 各文件内容

#### info.json

```json
{
  "agentVersion": "1.0.0",
  "buildTime": "2026-07-23T10:00:00Z",
  "os": "Windows 10",
  "nodeVersion": "20.11.0",
  "electronVersion": "28.0.0",
  "adapterTypes": ["JE", "BE"],
  "uptimeSeconds": 3600,
  "memoryUsage": { "heapUsed": 256000000, "heapTotal": 512000000, "rss": 600000000 }
}
```

#### config_snapshot.json

从 `config.json` 提取关键字段，**跳过**以下敏感键名：

```
apiKey, api_key, apikey, token, password, passwd, secret, authorization
```

#### recent_logs.txt

取最近 200 行日志（按时间倒序），不限制日志级别，每行格式：

```
[2026-07-23 14:30:22] [ERROR] [ToolDispatcher] tool_call failed: timeout
[2026-07-23 14:30:20] [WARN] [Workspace] connection lost, retrying...
```

#### tool_call_history.json

从内存环形缓冲区取最近 50 条工具调用记录：

```json
[
  {
    "tool": "move_to",
    "params": { "target": { "x": 100, "y": 64, "z": -200 } },
    "success": true,
    "durationMs": 1500,
    "timestamp": "2026-07-23T14:30:00Z"
  }
]
```

#### game_state.json

如果当前有活跃的游戏连接，采集游戏状态：

```json
{
  "dimension": "minecraft:overworld",
  "health": 18,
  "hunger": 16,
  "position": { "x": 100, "y": 64, "z": -200 },
  "adapterType": "JE"
}
```

无活跃连接时，该文件内容为 `{ "connected": false }`。

#### workspace_list.json

```json
[
  {
    "id": "ws-001",
    "name": "主世界",
    "adapterType": "JE",
    "connected": true,
    "toolsRegistered": 32,
    "uptimeSeconds": 3600
  }
]
```

---

## 3. 实现

### 3.1 文件结构

```
packages/agent-core/src/main/
├── diagnose/
│   ├── index.ts          # 入口，调用各采集器生成 ZIP
│   ├── collector.ts      # 各信息采集方法
│   └── packer.ts         # 打包为 ZIP
```

### 3.2 核心代码

```typescript
// diagnose/index.ts
import { collectDiagnoseInfo } from './collector';
import { packToZip } from './packer';
import { app } from 'electron';
import path from 'path';

export async function generateDiagnoseZip(): Promise<string> {
  const info = await collectDiagnoseInfo();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const fileName = `diagnose_${timestamp}.zip`;
  const outputPath = path.join(app.getPath('downloads'), fileName);
  await packToZip(info, outputPath);
  return outputPath;
}
```

```typescript
// diagnose/collector.ts
import type { WorkspaceManager } from '../workspace/workspace-manager';
import type { ToolCallHistory } from '../pipeline/tool-call-history';
import type { LogBuffer } from '../log/log-buffer';

const SENSITIVE_KEYS = new Set([
  'apiKey', 'api_key', 'apikey',
  'token', 'password', 'passwd', 'secret', 'authorization',
]);

export interface DiagnoseInfo {
  info: object;
  config: object;
  logs: string;
  toolCalls: object[];
  gameState: object;
  workspaces: object[];
}

export async function collectDiagnoseInfo(
  workspaceManager?: WorkspaceManager,
  toolCallHistory?: ToolCallHistory,
  logBuffer?: LogBuffer,
): Promise<DiagnoseInfo> {
  return {
    info: collectEnvironmentInfo(),
    config: collectConfigSnapshot(),
    logs: logBuffer?.getRecent(200).map(l =>
      `[${l.timestamp}] [${l.level}] [${l.module}] ${l.message}`
    ).join('\n') ?? '（日志缓冲区不可用）',
    toolCalls: toolCallHistory?.getRecent(50) ?? [],
    gameState: collectGameState(workspaceManager),
    workspaces: collectWorkspaceList(workspaceManager),
  };
}

function collectEnvironmentInfo() {
  return {
    agentVersion: process.env.APP_VERSION ?? 'unknown',
    buildTime: process.env.BUILD_TIME ?? 'unknown',
    os: `${process.platform} ${process.arch}`,
    nodeVersion: process.version,
    electronVersion: process.versions.electron ?? 'unknown',
    adapterTypes: [], // 运行时从 workspaceManager 获取
    uptimeSeconds: Math.floor(process.uptime()),
    memoryUsage: process.memoryUsage(),
  };
}

function collectConfigSnapshot(): object {
  // 从全局 config 读取，递归跳过敏感键名
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

function collectGameState(workspaceManager?: WorkspaceManager): object {
  const ws = workspaceManager?.getActiveWorkspace();
  if (!ws?.isConnected()) return { connected: false };
  const ctx = ws.getAgentContext();
  return {
    connected: true,
    dimension: ctx?.gameState?.dimension ?? 'unknown',
    health: ctx?.gameState?.health,
    hunger: ctx?.gameState?.hunger,
    position: ctx?.gameState?.position,
    adapterType: ws.getAdapterType(),
  };
}

function collectWorkspaceList(workspaceManager?: WorkspaceManager): object[] {
  if (!workspaceManager) return [];
  return workspaceManager.listWorkspaces().map(ws => ({
    id: ws.id,
    name: ws.name,
    adapterType: ws.getAdapterType(),
    connected: ws.isConnected(),
    toolsRegistered: ws.getRegisteredTools().length,
    uptimeSeconds: ws.getUptimeSeconds(),
  }));
}
```

```typescript
// diagnose/packer.ts
import archiver from 'archiver';
import fs from 'fs';

export async function packToZip(info: DiagnoseInfo, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', resolve);
    archive.on('error', reject);

    archive.pipe(output);

    archive.append(JSON.stringify(info.info, null, 2), { name: 'info.json' });
    archive.append(JSON.stringify(info.config, null, 2), { name: 'config_snapshot.json' });
    archive.append(info.logs, { name: 'recent_logs.txt' });
    archive.append(JSON.stringify(info.toolCalls, null, 2), { name: 'tool_call_history.json' });
    archive.append(JSON.stringify(info.gameState, null, 2), { name: 'game_state.json' });
    archive.append(JSON.stringify(info.workspaces, null, 2), { name: 'workspace_list.json' });

    archive.finalize();
  });
}
```

### 3.3 QQ Bot 命令集成

在 [message-handler.ts](file:///d:/McAgent/packages/agent-core/src/main/qq-bot/message-handler.ts) 中增加命令路由：

```typescript
// 在命令路由中新增
if (text === '生成诊断包') {
  await qqClient.sendPrivateMsg(senderId, '🔄 正在生成诊断包，请稍候...');
  const zipPath = await generateDiagnoseZip();
  await qqClient.sendPrivateMsg(senderId,
    `✅ 诊断包已生成：\n${zipPath}\n\n请将此文件发送给开发者`
  );
}
```

### 3.4 Dashboard 按钮

在设置页新增一个按钮，点击后调用 `diagnose:generate` IPC 频道，返回 ZIP 路径。

---

## 4. 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `packages/agent-core/src/main/diagnose/index.ts` | **新增** | 入口函数 |
| `packages/agent-core/src/main/diagnose/collector.ts` | **新增** | 信息采集 + 脱敏 |
| `packages/agent-core/src/main/diagnose/packer.ts` | **新增** | ZIP 打包 |
| `packages/agent-core/src/main/qq-bot/message-handler.ts` | 修改 | 增加 `生成诊断包` 命令 |
| 前端 IPC 注册 | 修改 | 增加 `diagnose:generate` 频道 |

---

## 5. 验收标准

| 验收项 | 预期结果 |
|--------|---------|
| QQ Bot `生成诊断包` | 返回 ZIP 文件路径 |
| ZIP 包含 6 个文件 | info.json / config_snapshot.json / recent_logs.txt / tool_call_history.json / game_state.json / workspace_list.json |
| 敏感字段脱敏 | API Key、Token 等字段显示 `[REDACTED]` |
| 无活跃连接时 game_state.json | 内容为 `{ "connected": false }` |
| Dashboard 按钮 | 生成并下载 ZIP |