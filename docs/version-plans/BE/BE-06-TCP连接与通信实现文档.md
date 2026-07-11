# BE 插件 TCP 连接与通信实现文档

> 版本：v1.0
> 日期：2026-07-11
> 关联文档：[01-通信协议规范.md](../../protocols/01-通信协议规范.md)、[BE-02-实施计划.md](BE-02-实施计划.md)、[BE-05-TCP客户端与工具注册模块实现指引.md](BE-05-TCP客户端与工具注册模块实现指引.md)

---

## 第1章 概述

### 1.1 实现范围

本文档记录 Adapter Core BE（基岩版插件）与 Agent Core（AC）之间的 TCP 通信连接实现。AC 端已就绪，BE 端适配 AC 实际实现的通信协议。

### 1.2 模块架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent Core (TCP Server)                    │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  TcpServer → TcpConnection → HandshakeHandler         │   │
│  │  HeartbeatManager → sendPing() as notification        │   │
│  │  method: "handshake"                                   │   │
│  └───────────────────────┬───────────────────────────────┘   │
│                          │ TCP 27541                         │
└──────────────────────────┼──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                 Adapter Core BE (TCP Client)                  │
│                                                               │
│  src/tcp/                TCP 通信层                            │
│  ├── TcpClient.ts       客户端核心（连接/握手/心跳/重连）      │
│  ├── handshake.ts       握手协议（适配 AC 的 handshake 格式）  │
│  ├── heartbeat.ts       心跳响应（接收 ping notification）    │
│  ├── reconnect.ts       断线重连（指数退避）                   │
│  ├── json-rpc.ts        JSON-RPC 2.0 编解码                   │
│  └── message-frame.ts   粘包处理（\n 分隔）                    │
│                                                               │
│  src/index.ts            插件入口（集成层）                    │
│  ├── 初始化 TCP 客户端                                        │
│  ├── 注册工具（register_tools notification）                  │
│  ├── 状态上报（status_report 通知）                           │
│  ├── 事件推送（event 通知）                                   │
│  ├── 工具调用处理（tool_call + tool_call_batch）              │
│  └── 游戏事件监听（onChat/onPlayerDie/onPlayerJoin/Left）     │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 关键设计决策

| 决策 | 方案 | 原因 |
|------|------|------|
| 握手 method | `"handshake"` | AC 端已实现的 method 名 |
| 握手参数格式 | `{ instance_id, auth_token, version: { protocol, edition }, mod? }` | 匹配 AC 的 HandshakeParams |
| 心跳格式 | 接收 ping 作为 notification（无 id），回复 pong 作为 notification | AC 使用 `sendPing()` 发送无 id 的 ping |
| 工具注册 | 使用 `sendNotification('register_tools', ...)` | AC 的 handleNotification 处理 register_tools |
| 批量工具调用 | `tool_call_batch` method | 协议规范定义的批量调用方式 |

---

## 第2章 握手协议适配

### 2.1 AC 端期望的握手协议

**请求（BE → AC）**：
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "handshake",
  "params": {
    "instance_id": "a1b2c3d4-e5f6-4789-abcd-ef1234567890",
    "auth_token": "mct_a1b2c3d4e5f67890abcdef1234567890",
    "version": {
      "protocol": "1.0.0",
      "edition": "bedrock"
    },
    "mod": "1.0.0"
  }
}
```

**响应（AC → BE）**：
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "success": true,
    "version": "1.0.0",
    "server_name": "Alice Mod Agent Core",
    "max_tools": 43
  }
}
```

### 2.2 与协议规范的差异

| 字段 | 协议规范 v1.0 | AC 实际实现 | BE 适配方案 |
|------|:------------:|:-----------:|:----------:|
| method | `hello` | `handshake` | 使用 `HANDSHAKE_METHOD = 'handshake'` |
| params 结构 | `{ instance_id, schema_version, auth_token, game_version: { edition, version }, mod_version }` | `{ instance_id, auth_token, version: { protocol, edition }, mod? }` | 合并版本信息到 `version` 对象 |
| result.accepted | `boolean` | 无 | 使用 `result.success` |
| result.session_id | `string` | 无 | 使用 `result.server_name` 替代 |
| result.server_version | `string` | `result.version` | 使用 `result.version` |
| result.heartbeat_interval | `number` | 无 | 固定 10000ms |

### 2.3 核心代码变更

文件：[handshake.ts](file:///d:/McAgent/packages/adapter-bedrock/src/tcp/handshake.ts)

```typescript
export const HANDSHAKE_METHOD = 'handshake';

export function buildHelloParams(options: {
  instanceId: string;
  authToken: string;
  schemaVersion?: string;
  gameEdition?: 'bedrock' | 'java';
  modVersion?: string;
}): HelloParams {
  return {
    instance_id: options.instanceId,
    auth_token: options.authToken,
    version: {
      protocol: options.schemaVersion || DEFAULT_SCHEMA_VERSION,
      edition: options.gameEdition || 'bedrock',
    },
    mod: options.modVersion || DEFAULT_MOD_VERSION,
  };
}
```

文件：[TcpClient.ts](file:///d:/McAgent/packages/adapter-bedrock/src/tcp/TcpClient.ts)

```typescript
// 第 144 行：发送握手请求
const result = await this.sendRequest(HANDSHAKE_METHOD, helloParams, this.connectTimeoutMs);

// 第 391-406 行：处理握手结果
private handleHandshakeResult(result: HelloResult): void {
  if (isHandshakeAccepted(result)) {
    this.sessionId = result.server_name || '';
    this.serverVersion = result.version || '';
    this.heartbeatIntervalMs = 10000;
    // ...
  }
}
```

---

## 第3章 心跳协议适配

### 3.1 AC 端实际心跳行为

AC 端的 `TcpConnection.sendPing()` 发送通知格式（无 id）：
```json
{ "jsonrpc": "2.0", "method": "ping" }
```

AC 端在 `handleNotification` 和 `handleRequest` 中都处理 `pong`：
- 作为 notification: `notification.method === 'pong'`
- 作为 request: `request.method === 'pong'`

### 3.2 BE 端心跳处理

文件：[heartbeat.ts](file:///d:/McAgent/packages/adapter-bedrock/src/tcp/heartbeat.ts)

BE 端支持两种 ping 格式：
1. **Request 格式**（含 id）：传统 JSON-RPC 请求
2. **Notification 格式**（无 id）：AC 实际发送的格式

```typescript
export function isPingNotification(msg: any): boolean {
  return msg
    && msg.jsonrpc === '2.0'
    && msg.method === 'ping'
    && !('id' in msg);
}
```

Pong 响应以 notification 格式回复：
```json
{
  "jsonrpc": "2.0",
  "method": "pong",
  "params": {
    "timestamp": "2026-07-11T12:00:00.000Z",
    "tick": 1234567
  }
}
```

### 3.3 消息分发流程

文件：[TcpClient.ts](file:///d:/McAgent/packages/adapter-bedrock/src/tcp/TcpClient.ts#L332-L361)

```
handleMessage(msg)
  ├── isRequest && method === "ping" → 回复 pong (request 格式)
  ├── isPingNotification(msg) → 回复 pong (notification 格式)
  ├── isResponse → 匹配 pending request
  └── else → 转发给 messageHandler
```

---

## 第4章 插件入口集成

### 4.1 初始化流程

文件：[index.ts](file:///d:/McAgent/packages/adapter-bedrock/src/index.ts)

```
initPlugin()
  ├── 加载/创建 instance_id
  ├── 加载/创建 auth_token
  ├── 初始化 TcpClient
  ├── 初始化 ToolRegistry + ToolManager
  ├── 注册 onMessage 回调
  ├── 注册 onStateChange 回调
  ├── 初始化 StatusReporter
  ├── 加载 BotManager + BotTestSuite
  └── 注册游戏事件 + 命令

onServerStarted
  ├── tcpClient.connect() — 使用 handshake 协议
  ├── toolRegistry.scanAndRegister()
  ├── InstanceFileHelper.generate()
  ├── statusReporter.start()
  └── BotManager 数据加载
```

### 4.2 游戏事件推送

| 事件 | LLSE 监听 | 触发条件 |
|------|----------|----------|
| `death` | `onPlayerDie` | 假人死亡时推送 |
| `player_chat` | `onChat` | 任意玩家发送聊天消息 |
| `player_join` | `onPlayerJoin` | 玩家加入游戏 |
| `player_leave` | `onPlayerLeft` | 玩家离开游戏 |

### 4.3 工具调用

| Method | 处理函数 | 说明 |
|--------|---------|------|
| `tool_call` | `handleToolCall` | 单个工具调用 |
| `tool_call_batch` | `handleToolCallBatch` | 批量工具调用（顺序执行） |

---

## 第5章 通信流程验证

### 5.1 完整连接流程

```
BE (TcpClient)                     AC (TcpServer)
    │                                    │
    │  TCP Connect (127.0.0.1:27541)     │
    │ ──────────────────────────────→    │
    │                                    │
    │  handshake request                  │
    │ ──────────────────────────────→    │
    │  ← 校验 instance_id + auth_token    │
    │  ← 校验 version.protocol            │
    │                                    │
    │  handshake response (result)        │
    │ ←──────────────────────────────    │
    │  └ state = CONNECTED                │
    │                                    │
    │  register_tools (notification)      │
    │ ──────────────────────────────→    │
    │  ← 记录 toolCount                   │
    │                                    │
    │  ═══ 心跳循环 ═══                  │
    │  ← ping (notification) ─────────── │
    │  └→ pong (notification) ─────────→ │
    │                                    │
    │  ═══ 状态上报 ═══                  │
    │  ─ status_report →                 │
    │  (每 2 秒)                          │
    │                                    │
    │  ═══ 工具调用 ═══                  │
    │  ← tool_call ────────────────────  │
    │  └→ tool_call result ────────────→ │
```

### 5.2 断线重连流程

```
连接断开 (socket 'close' 事件)
    │
    ├─ 清理 pending requests
    ├─ state = RECONNECTING
    └─ ReconnectScheduler.schedule()
         │
         ├─ 1s 后 → attemptReconnect()
         │  ├─ 成功 → state = CONNECTED
         │  └─ 失败 → 2s 后重试
         │
         ├─ 2s 后 → attemptReconnect()
         │  ├─ 成功 → state = CONNECTED
         │  └─ 失败 → 4s 后重试
         │
         ├─ 4s 后 → attemptReconnect()
         │  ├─ ...
         │
         ├─ 8s 后 → ... 
         │
         └─ 16s 后 → 最后一次尝试
            ├─ 成功 → state = CONNECTED
            └─ 失败 → state = DISCONNECTED (停止重连)
```

---

## 第6章 文件变更记录

### 6.1 修改的文件

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| [handshake.ts](file:///d:/McAgent/packages/adapter-bedrock/src/tcp/handshake.ts) | 重写 | method 改为 `handshake`，params/result 格式对齐 AC |
| [TcpClient.ts](file:///d:/McAgent/packages/adapter-bedrock/src/tcp/TcpClient.ts) | 重写 | 使用 `HANDSHAKE_METHOD`，ping 支持 notification 格式 |
| [heartbeat.ts](file:///d:/McAgent/packages/adapter-bedrock/src/tcp/heartbeat.ts) | 重写 | pong 改为 notification 格式，添加 `isPingNotification` |
| [index.ts](file:///d:/McAgent/packages/adapter-bedrock/src/index.ts) | 重写 | 添加 `tool_call_batch`、事件推送、onChat/onPlayerJoin/onPlayerLeft 监听 |
| [tcp/index.ts](file:///d:/McAgent/packages/adapter-bedrock/src/tcp/index.ts) | 更新 | 添加新的导出项 |

### 6.2 未修改的文件

| 文件 | 说明 |
|------|------|
| [json-rpc.ts](file:///d:/McAgent/packages/adapter-bedrock/src/tcp/json-rpc.ts) | JSON-RPC 2.0 编解码，兼容 AC 格式 |
| [message-frame.ts](file:///d:/McAgent/packages/adapter-bedrock/src/tcp/message-frame.ts) | 粘包处理，与 AC frame.ts 一致（\n 分隔） |
| [reconnect.ts](file:///d:/McAgent/packages/adapter-bedrock/src/tcp/reconnect.ts) | 指数退避重连 |
| [tool-registry.ts](file:///d:/McAgent/packages/adapter-bedrock/src/registry/tool-registry.ts) | 工具注册器 |
| [tool-manager.ts](file:///d:/McAgent/packages/adapter-bedrock/src/registry/tool-manager.ts) | 工具管理器 |
| [tool-context.ts](file:///d:/McAgent/packages/adapter-bedrock/src/registry/tool-context.ts) | 工具执行上下文 |
| [status-reporter.ts](file:///d:/McAgent/packages/adapter-bedrock/src/status/status-reporter.ts) | 状态上报 |
| [instance-file.ts](file:///d:/McAgent/packages/adapter-bedrock/src/entry/instance-file.ts) | JSON 入口文件生成 |
| [constants.ts](file:///d:/McAgent/packages/adapter-bedrock/src/utils/constants.ts) | 常量定义 |

---

## 第7章 验收检查清单

### 7.1 TCP 连接

| 验收项 | 预期结果 |
|--------|----------|
| TCP 连接建立 | Socket 连接到 127.0.0.1:27541 成功 |
| 握手 method 名称 | 发送 `"handshake"`（非 `"hello"`） |
| 握手参数格式 | `{ instance_id, auth_token, version: { protocol, edition } }` |
| 握手成功 | 收到 `result.success === true` |
| Ping 接收 | 能处理无 id 的 ping notification |
| Pong 回复 | 回复 notification 格式的 pong |

### 7.2 工具注册

| 验收项 | 预期结果 |
|--------|----------|
| 连接成功后自动注册 | 发送 `register_tools` notification |
| 注册消息包含全部工具 | `tools` 数组包含所有已扫描工具的 metadata |

### 7.3 工具调用

| 验收项 | 预期结果 |
|--------|----------|
| 单工具调用 | `tool_call` 正确路由到对应工具并返回 |
| 批量工具调用 | `tool_call_batch` 顺序执行并返回结果数组 |
| 未知 method | 返回 `-32601 Method Not Found` |

### 7.4 事件通知

| 验收项 | 预期结果 |
|--------|----------|
| 假人死亡事件 | `onPlayerDie` → pushEvent('death', ...) |
| 玩家聊天事件 | `onChat` → pushEvent('player_chat', ...) |
| 玩家加入事件 | `onPlayerJoin` → pushEvent('player_join', ...) |
| 玩家离开事件 | `onPlayerLeft` → pushEvent('player_leave', ...) |

### 7.5 断线重连

| 验收项 | 预期结果 |
|--------|----------|
| 首次重连 | 断开后 1s 尝试重连 |
| 指数退避 | 1s → 2s → 4s → 8s → 16s |
| 最大次数 | 5 次后停止重连 |
| 重连成功 | 重新握手 + 注册工具 |
