# TCP 服务端模块 — 技术文档

> 对应版本：V2（第 2 周）
> 模块：Agent Core（AC）
> 关联文档：[AC-01-需求文档.md](../version-plans/AC/AC-01-需求文档.md)、[AC-02-实施计划.md](../version-plans/AC/AC-02-实施计划.md)

---

## 第一部分：需求文档

### 1.1 模块定位

TCP 服务端模块是 Agent Core 与 Adapter Core（BE/JE）之间的通信通道。它基于 TCP 长连接 + JSON-RPC 2.0 协议，负责：

- 监听端口，接受 Adapter Core 的连接
- 消息的编码/解码/粘包处理
- 握手认证与版本协商
- 心跳保活与超时检测
- Batch 批量调用支持
- 连接池管理与事件通知

### 1.2 功能需求列表

| 需求 ID | 需求名称 | 优先级 | 实现状态 |
|---------|----------|--------|:--------:|
| AC-TCP-01 | TCP 端口监听（默认 27541） | P0 | ✅ |
| AC-TCP-02 | JSON-RPC 2.0 消息解析/组装 | P0 | ✅ |
| AC-TCP-03 | 握手认证协议（instance_id + auth_token） | P0 | ✅ |
| AC-TCP-04 | 粘包处理（`\n` 分隔消息帧） | P0 | ✅ |
| AC-TCP-05 | 心跳管理（服务端 Ping，10s 间隔） | P0 | ✅ |
| AC-TCP-06 | 超时检测（30s 无响应断开） | P0 | ✅ |
| AC-TCP-07 | Batch 调用支持（批量消息接收与分发） | P0 | ✅ |
| AC-TCP-09 | 断线自动重连（指数退避，最多 5 次） | P0 | ✅ |
| AC-TCP-08 | 连接池管理（多连接并发） | P0 | V3 |
| AC-TCP-10 | 工具调用分发（按工作区路由） | P0 | V4 |
| AC-TCP-11 | 结果收集与格式化 | P0 | V4 |
| AC-TCP-12 | 工具注册接收（register_tools） | P0 | V3 |
| AC-TCP-13 | 实例管理器 | P0 | V3 |
| AC-TCP-14 | 离线访问 | P1 | V3 |

### 1.3 验收标准

| # | 验收条件 | 验证方法 | 状态 |
|---|---------|----------|:----:|
| 2.1 | TCP 端口监听正常 | `server.isListening === true` | ✅ |
| 2.2 | JSON-RPC 请求正确解析 | 发送合法请求，解析后 id=1, method='handshake' | ✅ |
| 2.3 | 握手认证成功 | 发送合法 auth_token | ✅ |
| 2.4 | 握手认证失败（错误 auth_token） | 返回 error code=-32001 | ✅ |
| 2.5 | 粘包处理正确 | 连续发送 3 条消息，一次性写入 Socket | ✅ |
| 2.6 | 心跳正常维持 | 服务端每 10s 发送 Ping | ✅ |
| 2.7 | 超时断开 | 30s 内未收到 Pong，连接断开 | ✅ |
| 2.8 | Batch 消息正确接收 | 发送 Batch 数组，逐个解析 | ✅ |

---

## 第二部分：架构文档

### 2.1 模块层级

```
┌──────────────────────────────────────────────────┐
│                   TcpServer                       │
│  （连接池管理 + 事件分发 + 生命周期控制）             │
├──────────────────────────────────────────────────┤
│                   TcpConnection                   │
│  （单连接封装 + 状态机 + 消息分发 + 握手 + 心跳）    │
├──────────┬──────────┬──────────┬──────────────────┤
│  Frame   │  Codec   │ Handshake│ Heartbeat        │
│ 粘包处理   │ 消息编解码 │ 握手认证  │ 心跳管理          │
├──────────┴──────────┴──────────┴──────────────────┤
│                   Batch（批量支持）                   │
│                   Types（类型定义）                   │
└──────────────────────────────────────────────────┘
```

### 2.2 连接状态机

```
                    ┌──────────┐
                    │ Disconnected │
                    └─────┬────┘
                          │ TCP 连接建立
                          ▼
                    ┌──────────┐
                    │ Connecting │
                    └─────┬────┘
                          │ Socket 'connect' 事件
                          ▼
                    ┌───────────┐
                    │ Handshaking│ ← 等待 handshake 请求
                    └─────┬─────┘
                          │ handshake 验证通过
                          ▼
                    ┌──────────┐
                    │ Connected │ ← 心跳启动，消息可收发
                    └─────┬────┘
                          │ 连接断开 / 心跳超时
                          ▼
                    ┌──────────┐
                    │ Disconnected │
                    └──────────┘
```

### 2.3 消息处理流程

```
Adapter Core                  TCP 服务端
     │                            │
     │── TCP Connect ──────────►  │  → 创建 TcpConnection (Connecting)
     │                            │
     │── 'handshake' 请求 ───────►│  → HandshakeHandler.validate()
     │◄── 成功/失败响应 ──────────│  → 成功: Connected + 启动心跳
     │                            │
     │    [定时] Ping 通知 ──────►│  → HeartbeatManager
     │◄── [定时] Pong 响应 ──────│  → receivePong() 重置计时器
     │                            │
     │── 'register_tools' 通知 ──►│  → 更新 connection.toolCount
     │                            │
     │── 'call_tool' 请求 ───────►│  → messageHandler.onRequest()
     │◄── 工具执行结果 ──────────│
     │                            │
     │── TCP Disconnect ────────►│  → 关闭连接，触发事件
```

### 2.4 心跳时序

```
服务端 (AC)                    客户端 (Adapter)
    │                              │
    │  start()                      │
    │── [0s] Ping(通知) ──────────►│
    │                              │── receivePong()
    │◄── [即时] Pong(响应) ───────│
    │                              │
    │── [10s] Ping ──────────────►│
    │◄── [即时] Pong ─────────────│
    │                              │
    │── [20s] Ping ──────────────►│
    │      (30s 超时计时器启动)       │
    │      (客户端无响应)             │
    │  [50s] 超时 → 失败计数++       │
    │      (失败次数 ≥ 5)            │
    │  → 触发 HeartbeatEvent.Failed  │
    │  → close()                    │
```

### 2.5 帧结构

```
消息帧格式：
┌─────────────────────────────────────────────┐
│        JSON 消息体 (UTF-8)          │ \n │
├─────────────────────────────────────────────┤
│         可变长度                     │ 1B │
└─────────────────────────────────────────────┘

示例：
{"jsonrpc":"2.0","id":1,"method":"handshake","params":{...}}\n
```

---

## 第三部分：执行文档

### 3.1 文件结构

```
src/main/tcp/
├── index.ts          ─ 模块入口，统一导出
├── types.ts          ─ 类型定义（ConnectionState, TcpClientInfo, TcpServerOptions 等）
├── frame.ts          ─ 粘包处理（encodeFrame / decodeFrames / FrameAccumulator）
├── codec.ts          ─ JSON-RPC 消息编解码（Request / Response / Notification）
├── handshake.ts      ─ 握手认证（HandshakeHandler）
├── heartbeat.ts      ─ 心跳管理（HeartbeatManager / HeartbeatState）
├── batch.ts          ─ Batch 调用支持（parseBatch / BatchCollector）
├── connection.ts     ─ 单连接管理（TcpConnection + 状态机）
└── tcp-server.ts     ─ TCP 服务端（TcpServer + 连接池）
```

### 3.2 核心类/接口说明

#### `TcpServer`（tcp-server.ts）

```typescript
class TcpServer extends EventEmitter {
  constructor(options?: Partial<TcpServerOptions>)
  
  // 属性
  get isListening(): boolean
  get connectionCount(): number
  
  // 方法
  start(): Promise<void>           // 启动监听
  stop(): Promise<void>            // 关闭所有连接 + 停止监听
  getClients(): TcpClientInfo[]    // 获取所有客户端信息
  getConnection(id: string): TcpConnection | undefined
  findByInstanceId(instanceId: string): TcpConnection | undefined
  sendTo(clientId: string, message: string): boolean
  broadcast(message: string): void

  // 事件
  on('listening', ({host, port}) => void)
  on('closed', () => void)
  on('error', (err: Error) => void)
  on('connection:opened', ({clientId}) => void)
  on('connection:closed', ({clientId}) => void)
}
```

#### `TcpConnection`（connection.ts）

```typescript
class TcpConnection extends EventEmitter {
  readonly id: string
  readonly address: string
  instanceId: string | null
  toolCount: number

  get state(): ConnectionState
  get isConnected(): boolean
  
  setHandler(handler: MessageHandler): void  // 设置消息处理器
  send(message: string): void                // 发送消息
  sendJson(obj: unknown): void               // 发送 JSON 对象
  sendPing(): void                           // 发送 Ping 心跳
  close(): void                              // 关闭连接
  getClientInfo(): TcpClientInfo

  // 事件
  on('message', (json: string) => void)
  on('request', (clientId, request) => void)
  on('response', (response) => void)
  on('notification', (clientId, notification) => void)
  on('state-change', (clientId, newState, prevState) => void)
  on('closed', () => void)
  on('error', (err: Error) => void)
}
```

#### `HeartbeatManager`（heartbeat.ts）

```typescript
class HeartbeatManager {
  constructor(options: Partial<HeartbeatOptions>, onEvent: HeartbeatCallback)
  
  get currentState(): HeartbeatState
  get isHealthy(): boolean
  get lastPong(): number

  start(sendPing: () => void): void   // 启动心跳（立即发送一次 Ping）
  receivePong(): void                  // 收到 Pong 响应
  stop(): void                         // 停止心跳
  reset(): void                        // 重置计数器
}
```

#### `HandshakeHandler`（handshake.ts）

```typescript
class HandshakeHandler {
  constructor(authToken: string)
  
  validate(params: unknown): {
    valid: boolean
    response?: JsonRpcResponse
    instanceId?: string
  }
}
```

### 3.3 使用示例

```typescript
import { TcpServer, ServerEvent } from './tcp';

// 创建服务端（使用默认配置：端口 27541）
const server = new TcpServer();

// 监听事件
server.on(ServerEvent.Listening, ({ host, port }) => {
  console.log(`TCP 服务端已启动: ${host}:${port}`);
});

server.on(ServerEvent.ConnectionOpened, ({ clientId }) => {
  console.log(`新连接: ${clientId}`);
});

server.on(ServerEvent.RequestReceived, ({ clientId, request }) => {
  console.log(`收到请求: ${request.method}`);
});

server.on(ServerEvent.ConnectionClosed, ({ clientId }) => {
  console.log(`连接关闭: ${clientId}`);
});

// 启动
await server.start();

// 获取所有连接信息
const clients = server.getClients();

// 关闭
await server.stop();
```

### 3.4 测试指南

```bash
# 运行所有 TCP 模块测试
pnpm --filter agent-core test

# 运行特定测试文件
pnpm --filter agent-core vitest run __tests__/tcp/handshake.test.ts

# 运行带覆盖率的测试
pnpm --filter agent-core vitest run --coverage
```

测试覆盖的 5 个文件共 47 个测试用例：

| 测试文件 | 测试内容 | 关键用例 |
|----------|----------|----------|
| `frame.test.ts` | 粘包处理 | 多消息一次性发送、跨块累积、不完整帧 |
| `codec.test.ts` | 消息编解码 | 请求/响应/通知编解码、类型判断 |
| `handshake.test.ts` | 握手认证 | 成功/失败/错误码/版本/edition 校验 |
| `heartbeat.test.ts` | 心跳管理 | 定时Ping、超时恢复、失败断开、停止 |
| `batch.test.ts` | Batch 支持 | 批量解析、错误跳过、结果收集 |

### 3.5 常见问题

#### Q: 粘包为什么会发生？
TCP 是流式协议，没有消息边界。当多条消息连续发送时，可能在一个 TCP 包中到达。FrameAccumulator 通过 `\n` 分隔符提取完整消息。

#### Q: 握手失败的可能原因？
- `auth_token` 不匹配 → 返回 ErrorCode.AuthFailed（-32001）
- `instance_id` 缺失 → 返回 ErrorCode.InvalidParams（-32602）
- 协议版本不兼容 → 返回 ErrorCode.VersionMismatch（-32003）
- edition 不是 bedrock/java → 返回 ErrorCode.InvalidParams（-32602）

#### Q: 心跳超时如何处理？
HeartbeatManager 每次发送 Ping 时启动 30s 超时计时器。超时后增加失败计数，达到 5 次后触发 Failed 事件，TcpConnection 自动关闭连接。

#### Q: 如何自定义配置？
```typescript
const server = new TcpServer({
  port: 27541,
  host: '0.0.0.0',
  maxConnections: 10,
  heartbeatInterval: 10000,  // 10s
  heartbeatTimeout: 30000,    // 30s
  authToken: 'my-secret-token',
});
```

### 3.6 依赖关系

```
依赖树：
tcp-server.ts
  └── connection.ts
        ├── frame.ts
        ├── codec.ts
        ├── handshake.ts
        ├── heartbeat.ts
        └── types.ts
  └── batch.ts ─── codec.ts
  └── types.ts

外部依赖：
  @mcagent/shared  ── types, constants, protocol (isValidRequest/isValidResponse)
  node:net         ── net.Server, Socket
  node:crypto      ── crypto.randomUUID()
  node:events      ── EventEmitter
```

---

> **更新记录**
> - 2026-07-04：初版创建，对应 V2 TCP 服务端模块
