# TCP 客户端与工具注册模块实现指引（V2 + V3）

> 版本：v1.0
> 日期：2026-07-11
> 关联文档：[BE-01-需求文档.md](BE-01-需求文档.md)、[BE-02-实施计划.md](BE-02-实施计划.md)、[BE-03-规范与验收标准.md](BE-03-规范与验收标准.md)

---

## 概述

本文档指导 V2（TCP 客户端模块）和 V3（工具注册模块 + 状态上报 + JSON 入口生成）的联合实现。V2 和 V3 构成 Adapter Core BE 的**通信与注册基础层**，是后续所有版本（V4-V15）的前提依赖。

### 模块定位

```
┌────────────────────────────────────────────────────────────────┐
│                     Agent Core (TCP Server)                      │
│               JSON-RPC 2.0 über TCP (27541)                      │
└──────────────────────────┬─────────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────────┐
│                    Adapter Core BE                                │
│                                                                  │
│  ┌──────────────────┐    ┌──────────────────────────────────┐   │
│  │   V2: TCP 客户端  │◄──►│  V3: 工具注册 + 状态上报 + JSON  │   │
│  │  (连接/握手/心跳)  │    │  (IToolModule/自动扫描/定时上报)  │   │
│  └────────┬─────────┘    └───────────┬──────────────────────┘   │
│           │                          │                          │
│           ▼                          ▼                          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              V4-V15: 执行层工具 + 后续模块                  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Alice/ (BDS 根目录)                                       │   │
│  │  ├── instance.json       # 实例入口文件（JSON-RPC 发现）    │   │
│  │  ├── data/               # 数据目录                        │   │
│  │  │   ├── instance_id.txt # UUID 持久化                     │   │
│  │  │   └── mcagent.db      # SQLite 数据库（V11 实现）       │   │
│  │  └── ...                                                   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 依赖关系

- V2 TCP 客户端是 V3-V15 **所有功能的通信基础**
- V3 工具注册模块是 V4-V9 **所有工具在 Agent Core 可见的前提**
- V2 和 V3 可**部分并行开发**（消息编解码 → TCP 连接 → 工具注册 → 状态上报）

---

## 模块划分

```
src/
├── tcp/                              # V2: TCP 客户端模块
│   ├── TcpClient.ts                  # TCP 客户端核心（连接/断开/重连）
│   ├── handshake.ts                  # 握手协议（hello 消息）
│   ├── heartbeat.ts                  # 心跳响应（ping → pong）
│   ├── reconnect.ts                  # 断线重连（指数退避）
│   ├── json-rpc.ts                   # JSON-RPC 2.0 消息编解码
│   └── message-frame.ts             # 粘包处理（按 \n 分割）
├── registry/                         # V3: 工具注册模块
│   ├── tool-module.types.ts          # IToolModule 接口定义
│   ├── tool-registry.ts              # 工具注册器（自动扫描）
│   ├── tool-manager.ts               # 工具管理器（查找/调用/超时）
│   └── tool-context.ts               # 工具执行上下文
├── status/
│   └── status-reporter.ts            # V3: 状态上报模块
├── entry/
│   └── instance-file.ts              # V3: JSON 入口生成
└── utils/
    ├── constants.ts                  # 常量定义
    └── helpers.ts                    # 工具函数
```

---

## V2: TCP 客户端模块

### 职责

实现 Adapter Core BE 与 Agent Core 之间的 TCP 通信通道，提供：
- 主动连接 Agent Core（默认 `127.0.0.1:27541`）
- 握手认证（携带 `auth_token` 和 `instance_id`）
- 心跳保活（收到 ping 后回复 pong）
- 断线重连（指数退避 1s→2s→4s→8s→16s）
- JSON-RPC 2.0 消息编解码与粘包处理

### 核心接口

```typescript
// 连接状态枚举
enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  HANDSHAKING = 'handshaking',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
}

// JSON-RPC 消息类型
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, any>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, any>;
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// 握手消息类型
interface HelloParams {
  instance_id: string;        // UUID v4
  schema_version: string;     // "1.0.0"
  auth_token: string;         // 认证令牌
  game_version: {
    edition: 'bedrock';
    version: string;          // "1.21.x"
  };
  mod_version: string;        // "1.0.0"
}

interface HelloResult {
  session_id: string;
  server_version: string;
  heartbeat_interval_ms: number;
  accepted: boolean;
  message?: string;
}
```

### TcpClient 类设计

```typescript
class TcpClient {
  // ---- 配置 ----
  private host: string;                    // 默认 "127.0.0.1"
  private port: number;                    // 默认 27541
  private authToken: string;               // 认证令牌
  private instanceId: string;              // UUID v4

  // ---- 内部状态 ----
  private socket: net.Socket | null;
  private state: ConnectionState;
  private reconnectAttempts: number;
  private reconnectTimer: NodeJS.Timeout | null;
  private messageBuffer: string;           // 粘包处理缓冲区
  private requestIdCounter: number;
  private pendingRequests: Map<number, { resolve, reject, timer }>;
  private messageHandler: ((msg: JsonRpcMessage) => void) | null;

  constructor(config: TcpClientConfig);

  // ---- 生命周期 ----
  async connect(): Promise<void>;          // 连接 + 握手
  async disconnect(): Promise<void>;       // 断开连接
  getState(): ConnectionState;
  isConnected(): boolean;

  // ---- 消息发送 ----
  async sendRequest(method: string, params: any, timeout?: number): Promise<any>;
  sendNotification(method: string, params: any): void;
  sendRaw(data: string): void;

  // ---- 事件回调 ----
  onMessage(handler: (msg: JsonRpcMessage) => void): void;
  onStateChange(handler: (state: ConnectionState) => void): void;

  // ---- 内部方法 ----
  private onData(data: Buffer): void;      // 粘包处理
  private onMessage(message: JsonRpcMessage): void;  // 消息分发
  private handleHandshake(response: HelloResult): void;
  private handlePing(): void;              // 自动回复 pong
  private scheduleReconnect(): void;       // 指数退避
  private attemptReconnect(): Promise<void>;
  private generateRequestId(): number;
}
```

### 关键实现要点

#### 1. 连接与握手流程

```
TcpClient.connect()
  │
  ├─ 1. 创建 net.Socket 连接 (host:port)
  │     ├─ 成功 → state = CONNECTING
  │     └─ 失败 → 抛出异常，进入重连
  │
  ├─ 2. 发送握手消息 (hello)
  │     ├─ 构造 HelloParams (instance_id, auth_token, game_version 等)
  │     ├─ 发送 JSON-RPC Request: { method: "hello", params: {...} }
  │     └─ state = HANDSHAKING
  │
  ├─ 3. 等待握手响应
  │     ├─ result.accepted === true → state = CONNECTED
  │     │   ├─ 记录 session_id
  │     │   ├─ 重置重连计数
  │     │   └─ 触发 onStateChange(CONNECTED)
  │     └─ accepted === false → 断开连接，记录错误
  │
  └─ 4. 通知外部 (onStateChange / Promise resolve)
```

#### 2. 粘包处理

```typescript
private onData(data: Buffer): void {
  this.messageBuffer += data.toString('utf-8');

  // 按 \n 分割消息（JSON-RPC 消息以换行符分隔）
  const messages = this.messageBuffer.split('\n');
  // 最后一段可能是不完整的消息，保留到下次 data 事件
  this.messageBuffer = messages.pop() || '';

  for (const msg of messages) {
    const trimmed = msg.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed);
      this.onMessage(parsed);
    } catch (err) {
      logger.error(`[TcpClient] 消息解析失败: ${trimmed.substring(0, 100)}`);
    }
  }
}
```

#### 3. 心跳响应

```typescript
// 收到 ping 请求时自动回复 pong
private onMessage(message: JsonRpcMessage): void {
  if (message.method === 'ping' && 'id' in message) {
    // 立即回复 pong
    this.sendRaw(JSON.stringify({
      jsonrpc: '2.0',
      id: (message as JsonRpcRequest).id,
      result: { pong: true, timestamp: new Date().toISOString() },
    }));
    return;
  }
  // ... 其他消息分发
}
```

#### 4. 断线重连（指数退避）

```typescript
const RECONNECT_INTERVALS = [1000, 2000, 4000, 8000, 16000];
const MAX_RECONNECT_ATTEMPTS = 5;

private scheduleReconnect(): void {
  if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    logger.error(`[TcpClient] 已达最大重连次数 (${MAX_RECONNECT_ATTEMPTS})，停止重连`);
    this.state = ConnectionState.DISCONNECTED;
    this.onStateChange?.(ConnectionState.DISCONNECTED);
    return;
  }

  const delay = RECONNECT_INTERVALS[this.reconnectAttempts];
  this.reconnectAttempts++;
  this.state = ConnectionState.RECONNECTING;
  this.onStateChange?.(ConnectionState.RECONNECTING);

  logger.info(`[TcpClient] 将在 ${delay}ms 后重连 (第 ${this.reconnectAttempts} 次)`);
  this.reconnectTimer = setTimeout(() => this.attemptReconnect(), delay);
}

private async attemptReconnect(): Promise<void> {
  try {
    // 清理旧 socket
    this.cleanupSocket();

    // 重新连接 + 握手
    await this.connect();

    // 重连成功后自动重新注册工具
    this.emit('reconnected');
    this.reconnectAttempts = 0;
    logger.info('[TcpClient] 重连成功');
  } catch (err) {
    logger.error(`[TcpClient] 重连失败: ${err}`);
    this.scheduleReconnect();
  }
}
```

#### 5. JSON-RPC 消息编解码

```typescript
class JsonRpcCodec {
  // 构造请求
  static encodeRequest(method: string, params: any, id: number): string {
    return JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }) + '\n';
  }

  // 构造通知（无 id）
  static encodeNotification(method: string, params: any): string {
    return JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
    }) + '\n';
  }

  // 构造响应
  static encodeResponse(id: number | string, result: any): string {
    return JSON.stringify({
      jsonrpc: '2.0',
      id,
      result,
    }) + '\n';
  }

  // 构造错误响应
  static encodeError(id: number | string, code: number, message: string, data?: any): string {
    return JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code, message, data },
    }) + '\n';
  }

  // 解析消息
  static parse(raw: string): JsonRpcMessage {
    return JSON.parse(raw);
  }

  // 判断是否为请求（含 method 和 id）
  static isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
    return 'method' in msg && 'id' in msg;
  }

  // 判断是否为通知（含 method 但不含 id）
  static isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
    return 'method' in msg && !('id' in msg);
  }

  // 判断是否为响应（含 id 但不含 method）
  static isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
    return 'id' in msg && !('method' in msg);
  }
}
```

#### 6. 请求-响应映射

```typescript
// 发送请求并等待响应
async sendRequest(method: string, params: any, timeoutMs = 30000): Promise<any> {
  if (this.state !== ConnectionState.CONNECTED) {
    throw new Error('TCP 未连接');
  }

  const id = this.generateRequestId();

  return new Promise((resolve, reject) => {
    // 超时处理
    const timer = setTimeout(() => {
      this.pendingRequests.delete(id);
      reject(new Error(`请求超时: ${method} (${timeoutMs}ms)`));
    }, timeoutMs);

    // 注册待处理请求
    this.pendingRequests.set(id, { resolve, reject, timer });

    // 发送消息
    const raw = JsonRpcCodec.encodeRequest(method, params, id);
    this.sendRaw(raw);
  });
}

// 收到响应时匹配
private handleResponse(response: JsonRpcResponse): void {
  const pending = this.pendingRequests.get(response.id as number);
  if (!pending) {
    logger.warn(`[TcpClient] 收到未知请求 ID 的响应: ${response.id}`);
    return;
  }

  clearTimeout(pending.timer);
  this.pendingRequests.delete(response.id as number);

  if (response.error) {
    pending.reject(new Error(`[${response.error.code}] ${response.error.message}`));
  } else {
    pending.resolve(response.result);
  }
}
```

### 配置参数

```typescript
interface TcpClientConfig {
  host: string;                    // 默认 "127.0.0.1"
  port: number;                    // 默认 27541
  authToken: string;               // 认证令牌（从配置文件读取）
  instanceId: string;              // UUID v4（首次生成后持久化）
  schemaVersion: string;           // 默认 "1.0.0"
  gameVersion: string;             // 如 "1.21.0"
  modVersion: string;              // 默认 "1.0.0"
  connectTimeoutMs: number;        // 默认 5000
  requestTimeoutMs: number;        // 默认 30000
  maxReconnectAttempts: number;    // 默认 5
}
```

---

## V3: 工具注册模块

### 职责

实现 IToolModule 接口规范，自动扫描 `tools/` 目录注册工具，提供工具查找、调用、超时管理能力，为 Agent Core 提供完整的工具注册信息。

### 核心接口

```typescript
// ---- IToolModule 接口 ----

type ToolCategory =
  | 'perception' | 'movement' | 'inventory'
  | 'entity' | 'survival' | 'block' | 'chat';

interface ToolMetadata {
  name: string;                    // 工具名称，如 "move_to"
  description: string;             // 工具描述
  category: ToolCategory;          // 工具分类
  input_schema: Record<string, any>;   // 输入参数 JSON Schema
  output_schema?: Record<string, any>;  // 输出结果 JSON Schema
  execution?: {
    timeout_default_ms?: number;   // 默认超时（毫秒）
    timeout_max_ms?: number;       // 最大超时
    is_movement?: boolean;         // 是否移动类工具
    is_async?: boolean;            // 是否异步执行
  };
}

interface ToolContext {
  player: PlayerAccess;            // BDS 玩家操作 API
  world: WorldAccess;              // BDS 世界操作 API
  bot: BotAccess;                  // 假人管理 API
  sendEvent(event: EventNotification): void;  // 发送事件通知
  logger: Logger;                  // 日志记录器
  getElapsedMs(): number;          // 获取执行耗时
}

interface ToolResult {
  success: boolean;
  data?: Record<string, any>;
  error?: string;
  duration_ms: number;
}

interface IToolModule {
  metadata(): ToolMetadata;
  execute(params: Record<string, any>, ctx: ToolContext): Promise<ToolResult>;
}

// ---- 工具注册器 ----

interface ToolRegistryConfig {
  toolsDir: string;                // tools/ 目录绝对路径
  scanIntervalMs?: number;         // 热扫描间隔（默认 0，不热扫描）
}

interface RegisteredTool {
  name: string;
  metadata: ToolMetadata;
  module: IToolModule;
  loadedAt: Date;
}
```

### 工具注册器设计

```typescript
class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();
  private config: ToolRegistryConfig;

  constructor(config: ToolRegistryConfig);

  // ---- 扫描与注册 ----

  /**
   * 扫描 tools/ 目录下的所有工具模块并注册
   * 目录结构约定：
   *   tools/
   *   ├── movement/         # 移动工具目录
   *   │   ├── index.ts      # 工具实现（默认导出 IToolModule 实例）
   *   │   └── manifest.json # 工具元数据（可选）
   *   ├── inventory/
   *   ├── combat/
   *   ├── block/
   *   ├── interaction/
   *   ├── survival/
   *   ├── perception/
   *   └── chat/
   */
  async scanAndRegister(): Promise<number> {
    // 1. 遍历 tools/ 下每个子目录
    // 2. 对每个子目录，require() 加载 index.js
    // 3. 验证是否为有效的 IToolModule 实现
    // 4. 注册到 tools Map
    // 5. 返回注册的工具数量
  }

  // ---- 查询 ----

  get(name: string): RegisteredTool | undefined;
  getAll(): RegisteredTool[];
  getByCategory(category: ToolCategory): RegisteredTool[];
  listToolNames(): string[];

  // ---- 工具调用 ----

  /**
   * 执行指定工具
   * @param name 工具名称
   * @param params 工具参数
   * @param ctx 执行上下文
   * @returns 执行结果
   */
  async executeTool(
    name: string,
    params: Record<string, any>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `工具未找到: ${name}`,
        duration_ms: 0,
      };
    }

    const timeout = tool.metadata.execution?.timeout_max_ms
      ?? tool.metadata.execution?.timeout_default_ms
      ?? 30000;

    const startTime = Date.now();

    try {
      // 超时控制
      const result = await Promise.race([
        tool.module.execute(params, ctx),
        this.createTimeout(timeout, name),
      ]);

      return {
        ...result,
        duration_ms: Date.now() - startTime,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - startTime,
      };
    }
  }

  private createTimeout(ms: number, toolName: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`TOOL_TIMEOUT: ${toolName} 执行超时 (${ms}ms)`));
      }, ms);
    });
  }

  // ---- 序列化 ----

  /**
   * 生成所有工具注册信息的 JSON Schema 列表
   * 用于发送 register_tools 消息给 Agent Core
   */
  generateRegistrationPayload(): ToolMetadata[] {
    return Array.from(this.tools.values()).map(t => t.metadata);
  }
}
```

### 工具执行上下文

```typescript
class ToolContextImpl implements ToolContext {
  readonly player: PlayerAccess;
  readonly world: WorldAccess;
  readonly bot: BotAccess;
  readonly logger: Logger;
  private startTime: number;
  private sendEventFn: (event: EventNotification) => void;

  constructor(options: {
    player: PlayerAccess;
    world: WorldAccess;
    bot: BotAccess;
    logger: Logger;
    sendEvent: (event: EventNotification) => void;
  }) {
    this.player = options.player;
    this.world = options.world;
    this.bot = options.bot;
    this.logger = options.logger;
    this.sendEventFn = options.sendEvent;
    this.startTime = Date.now();
  }

  sendEvent(event: EventNotification): void {
    this.sendEventFn(event);
  }

  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }
}

// ---- 游戏 API 访问接口 ----

interface PlayerAccess {
  getHealth(): number;
  getMaxHealth(): number;
  getHunger(): number;
  getSaturation(): number;
  getPosition(): { x: number; y: number; z: number; dimension: string };
  getRotation(): { yaw: number; pitch: number };
  getSelectedSlot(): number;
  getInventory(): any;
  getEquipment(): Record<string, any>;
  // ... 其他 BDS Player API 包装
}

interface WorldAccess {
  getBlock(x: number, y: number, z: number): any;
  getTime(): number;
  getWeather(): string;
  getEntities(options?: any): any[];
  getOnlinePlayers(): any[];
  // ... 其他 BDS World API 包装
}

interface BotAccess {
  // 假人管理接口（V10 实现）
}

interface EventNotification {
  type: string;
  data: Record<string, any>;
  timestamp: string;
}
```

### 目录扫描约定

```
tools/
├── movement/         # 移动工具目录
│   ├── index.ts      # 工具实现（导出默认 IToolModule 实例）
│   └── manifest.json # 工具元数据（可选，优先读取 metadata()）
├── inventory/        # 背包工具
├── combat/           # 战斗工具
├── block/            # 方块工具
├── interaction/      # 生物交互工具
├── survival/         # 生存工具
├── perception/       # 感知工具
└── chat/             # 对话工具
```

**工具文件示例**：

```typescript
// tools/movement/move-to.ts
import type { IToolModule, ToolMetadata, ToolResult, ToolContext }
  from '../../registry/tool-module.types';

export class MoveToTool implements IToolModule {
  metadata(): ToolMetadata {
    return {
      name: 'move_to',
      description: '移动假人到指定目标位置，支持坐标/实体/方块三种目标类型，自动寻路',
      category: 'movement',
      input_schema: {
        type: 'object',
        properties: {
          target: {
            type: 'object',
            description: '目标位置或实体',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
              entity_id: { type: 'string' },
            },
          },
          target_type: {
            type: 'string',
            enum: ['coordinate', 'entity', 'block'],
          },
          distance: { type: 'number', default: 2 },
          sprint: { type: 'boolean', default: false },
        },
        required: ['target', 'target_type'],
      },
      output_schema: {
        type: 'object',
        properties: {
          position: { type: 'object' },
          distance: { type: 'number' },
          duration_ms: { type: 'number' },
          hunger_cost: { type: 'number' },
        },
      },
      execution: {
        timeout_default_ms: 30000,
        timeout_max_ms: 120000,
        is_movement: true,
        is_async: false,
      },
    };
  }

  async execute(params: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    // V4 实现，V3 阶段可返回占位结果
    return {
      success: true,
      data: { message: 'move_to 工具已注册，实现在 V4' },
      duration_ms: 0,
    };
  }
}

// 必须导出默认实例
export default new MoveToTool();
```

---

## V3: 状态上报模块

### 职责

周期性采集假人状态，每 2s 通过 TCP 发送 `status_report` 通知到 Agent Core。支持基础状态采集（生命、位置、装备、背包摘要）。

### 核心接口

```typescript
interface StatusReport {
  timestamp: string;                  // ISO 8601
  health: {
    health: number;                   // 当前生命值
    max_health: number;               // 最大生命值
    hunger: number;                   // 当前饥饿值
    saturation: number;               // 饱和度
    air: number;                      // 氧气值
  };
  position: {
    x: number;
    y: number;
    z: number;
    dimension: string;
    yaw: number;
    pitch: number;
  };
  equipment: Record<string, string | null>;  // 装备快照
  inventory_summary: {
    used_slots: number;
    total_slots: number;
    items: Array<{ name: string; count: number }>;
  };
}
```

### StatusReporter 类设计

```typescript
class StatusReporter {
  private tcpClient: TcpClient;
  private worldAccess: WorldAccess;
  private playerAccess: PlayerAccess;
  private intervalMs: number;          // 默认 2000
  private timer: NodeJS.Timeout | null;
  private enabled: boolean;

  constructor(options: {
    tcpClient: TcpClient;
    worldAccess: WorldAccess;
    playerAccess: PlayerAccess;
    intervalMs?: number;               // 默认 2000
  });

  // ---- 生命周期 ----
  start(): void;                       // 启动定时上报
  stop(): void;                        // 停止定时上报
  isRunning(): boolean;

  // ---- 数据采集 ----
  async collect(): Promise<StatusReport> {
    // 1. 采集生命状态
    // 2. 采集位置信息
    // 3. 采集装备快照
    // 4. 采集背包摘要
    // 5. 组装并返回 StatusReport
  }

  // ---- 上报 ----
  async report(): Promise<void> {
    if (!this.tcpClient.isConnected()) return;

    const startTime = Date.now();
    const report = await this.collect();

    // 发送通知（不等待响应）
    this.tcpClient.sendNotification('status_report', report);

    const elapsed = Date.now() - startTime;
    if (elapsed > 100) {
      logger.warn(`[StatusReporter] 状态上报耗时 ${elapsed}ms（阈值 100ms）`);
    }
  }

  private async tick(): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.report();
    } catch (err) {
      logger.error(`[StatusReporter] 上报失败: ${err}`);
    }
  }
}
```

---

## V3: JSON 入口生成模块

### 职责

插件首次启动时在 BDS 根目录生成 `Alice/` 文件夹，内含 `instance.json` 入口文件，包含当前实例的标识信息，供 Agent Core 发现和匹配。后续所有数据文件（数据库、持久化配置等）均存放在 `Alice/` 目录下，确保工具系统的灵活性和模块性。

### 目录结构

```
BDS 根目录/
├── Alice/                       # 插件对外数据目录
│   ├── instance.json            # 实例入口文件（JSON-RPC 发现）
│   ├── data/                    # 数据目录
│   │   ├── instance_id.txt      # UUID 持久化（首次生成，后续复用）
│   │   └── mcagent.db           # SQLite 数据库（V11 实现）
│   └── ...                      # 其他运行时数据
├── plugins/
│   └── mcagent-adapter-be/      # 插件内部目录（工具实现、内部配置）
│       ├── tools/               # 工具实现目录
│       │   ├── movement/
│       │   ├── inventory/
│       │   └── ...
│       └── config.json          # 插件内部配置
└── ...
```

设计原则：
- `Alice/` 目录对外暴露，Agent Core 可扫描发现；`plugins/` 目录为插件内部实现，不对外暴露
- `instance.json` 作为实例入口，遵循 JSON-RPC 发现协议规范，与 [TCP 服务端模块](../modules/01-TCP服务端模块.md) 的握手认证流程配合
- 数据库和持久化数据统一存放在 `Alice/data/` 下，避免散落在 BDS 根目录

### 核心接口

```typescript
interface InstanceFile {
  _schema_version: string;   // 入口文件格式版本 "1.0.0"
  instance_id: string;       // UUID v4，首次生成后持久化
  mod_version: string;       // 插件版本 "1.0.0"
  game: {
    edition: 'bedrock';
    version: string;         // 如 "1.21.0"
  };
  network: {
    protocol: 'json-rpc-2.0';
    transport: 'tcp';
    host: string;            // 默认 "127.0.0.1"
    port: number;            // 默认 27541
  };
  status: {
    online: boolean;         // 当前是否连接到 Agent Core
    last_seen: string;       // ISO 8601
  };
  capabilities: {
    tools_count: number;     // 已注册工具数量
    max_bots: number;        // 最大假人数量
  };
}
```

### InstanceFileHelper 类设计

```typescript
class InstanceFileHelper {
  private static readonly ALICE_DIR = './Alice/';
  private static readonly DATA_DIR = './Alice/data/';
  private static readonly INSTANCE_FILE_PATH = './Alice/instance.json';
  private static readonly INSTANCE_ID_FILE = './Alice/data/instance_id.txt';

  /**
   * 确保 Alice/ 目录结构存在
   */
  private static ensureDirectories(): void {
    if (!File.exists(this.ALICE_DIR)) {
      File.mkdir(this.ALICE_DIR);
    }
    if (!File.exists(this.DATA_DIR)) {
      File.mkdir(this.DATA_DIR);
    }
  }

  /**
   * 生成或更新 Alice/instance.json
   * 包含实例标识、网络配置、状态信息，供 Agent Core 发现和匹配
   */
  static generate(options: {
    tcpClient: TcpClient;
    registry: ToolRegistry;
  }): boolean {
    this.ensureDirectories();
    const instanceId = this.loadOrCreateInstanceId();

    const instanceFile: InstanceFile = {
      _schema_version: '1.0.0',
      instance_id: instanceId,
      mod_version: '1.0.0',
      game: {
        edition: 'bedrock',
        version: mc.getServerVersion() || '1.21.0',
      },
      network: {
        protocol: 'json-rpc-2.0',
        transport: 'tcp',
        host: '127.0.0.1',
        port: 27541,
      },
      status: {
        online: options.tcpClient.isConnected(),
        last_seen: new Date().toISOString(),
      },
      capabilities: {
        tools_count: options.registry.getAll().length,
        max_bots: 3,
      },
    };

    // 写入文件
    try {
      File.writeTo(this.INSTANCE_FILE_PATH, JSON.stringify(instanceFile, null, 2));
      return true;
    } catch (err) {
      logger.error(`[InstanceFile] 写入失败: ${err}`);
      return false;
    }
  }

  /**
   * 加载或创建实例 ID
   * 首次运行时生成 UUID v4，持久化到 Alice/data/instance_id.txt，后续复用
   */
  private static loadOrCreateInstanceId(): string {
    this.ensureDirectories();

    if (File.exists(this.INSTANCE_ID_FILE)) {
      return File.readFrom(this.INSTANCE_ID_FILE).trim();
    }

    const uuid = mc.randomGuid();
    File.writeTo(this.INSTANCE_ID_FILE, uuid);
    return uuid;
  }

  /**
   * 更新实例状态（连接/断开时调用）
   * 仅更新 instance.json 中的 status 字段，不重复生成 instance_id
   */
  static updateStatus(options: {
    tcpClient: TcpClient;
    registry: ToolRegistry;
  }): boolean {
    return this.generate(options);
  }
}
```

---

## 集成设计

### 插件入口初始化流程

```typescript
// src/index.ts — 插件入口

// 全局变量
let tcpClient: TcpClient;
let toolRegistry: ToolRegistry;
let statusReporter: StatusReporter;

function initPlugin(): void {
  // 1. 加载配置
  const config = loadConfig();

  // 2. 初始化 TCP 客户端
  tcpClient = new TcpClient({
    host: config.tcpHost || '127.0.0.1',
    port: config.tcpPort || 27541,
    authToken: config.authToken || '',
    instanceId: InstanceFileHelper.loadOrCreateInstanceId(),
    schemaVersion: '1.0.0',
    gameVersion: mc.getServerVersion() || '1.21.0',
    modVersion: '1.0.0',
  });

  // 3. 初始化工具注册器
  toolRegistry = new ToolRegistry({
    toolsDir: './plugins/mcagent-adapter-be/tools/',
  });

  // 4. 注册 TCP 消息处理器
  tcpClient.onMessage((msg) => {
    handleMessage(msg);
  });

  // 5. TCP 连接状态变化处理
  tcpClient.onStateChange((state) => {
    handleStateChange(state);
  });

  // 6. 延迟到 onServerStarted 事件中启动
  // 因为 BDS 命令系统和世界 API 在那时才就绪
}

// 注意：文件末尾直接调用，不使用 module.exports 生命周期钩子
// 但需要等待 onServerStarted 事件
mc.listen('onServerStarted', () => {
  // 1. 连接 TCP
  tcpClient.connect().catch(err => {
    logger.error(`[McAgent] TCP 连接失败: ${err}`);
  });

  // 2. 扫描并注册工具
  const count = await toolRegistry.scanAndRegister();
  logger.info(`[McAgent] 已注册 ${count} 个工具`);

  // 3. 生成 JSON 入口文件
  InstanceFileHelper.generate({
    tcpClient,
    registry: toolRegistry,
  });

  // 4. 启动状态上报
  statusReporter = new StatusReporter({
    tcpClient,
    worldAccess: new WorldAccessImpl(),
    playerAccess: new PlayerAccessImpl(),
    intervalMs: 2000,
  });
  statusReporter.start();

  // 5. 注册命令
  registerCommands();
});

// 消息处理
function handleMessage(msg: JsonRpcMessage): void {
  if (JsonRpcCodec.isRequest(msg)) {
    const request = msg as JsonRpcRequest;

    switch (request.method) {
      case 'tool_call':
        handleToolCall(request);
        break;
      case 'ping':
        // TCP 客户端自动处理 ping → pong
        break;
      default:
        tcpClient.sendRaw(
          JsonRpcCodec.encodeError(request.id, -32601, `方法未找到: ${request.method}`)
        );
    }
  }
}

// 工具调用处理
async function handleToolCall(request: JsonRpcRequest): Promise<void> {
  const { tool_name, parameters } = request.params || {};
  const ctx = new ToolContextImpl({
    player: new PlayerAccessImpl(),
    world: new WorldAccessImpl(),
    bot: new BotAccessImpl(),
    logger,
    sendEvent: (event) => tcpClient.sendNotification('event', event),
  });

  const result = await toolRegistry.executeTool(tool_name, parameters, ctx);

  // 发送响应
  tcpClient.sendRaw(JsonRpcCodec.encodeResponse(request.id, result));
}

// 状态变化处理
function handleStateChange(state: ConnectionState): void {
  // 更新 JSON 入口文件
  InstanceFileHelper.updateStatus({
    tcpClient: tcpClient,
    registry: toolRegistry,
  });

  // 连接成功时自动注册工具
  if (state === ConnectionState.CONNECTED) {
    const payload = toolRegistry.generateRegistrationPayload();
    tcpClient.sendNotification('register_tools', {
      tools: payload,
      instance_id: tcpClient.instanceId,
    });
    logger.info(`[McAgent] 已向 Agent Core 注册 ${payload.length} 个工具`);
  }

  if (state === ConnectionState.DISCONNECTED) {
    statusReporter?.stop();
  }
}

// 命令注册（使用 LLSE 新命令 API）
function registerCommands(): void {
  const cmd = mc.newCommand('mcagent', 'McAgent 管理命令', PermType.Any, 0x80);
  cmd.setEnum('Status', ['status']);
  cmd.mandatory('action', ParamType.Enum, 'Status', 'Status', 1);
  cmd.overload(['Status']);
  cmd.setCallback((_cmd, origin, output, _result) => {
    if (origin.type === 'player') {
      output.success(
        `§a[McAgent] TCP: ${tcpClient.getState()} | ` +
        `工具: ${toolRegistry.getAll().length} 个已注册`
      );
    }
  });
  cmd.setup();
}

// 启动
initPlugin();
```

### 工具注册消息格式

当 TCP 连接建立后，插件自动发送 `register_tools` 通知：

```json
{
  "jsonrpc": "2.0",
  "method": "register_tools",
  "params": {
    "instance_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "tools": [
      {
        "name": "move_to",
        "description": "移动假人到指定目标位置",
        "category": "movement",
        "input_schema": { ... },
        "output_schema": { ... },
        "execution": {
          "timeout_default_ms": 30000,
          "timeout_max_ms": 120000,
          "is_movement": true,
          "is_async": false
        }
      }
      // ... 其他工具
    ]
  }
}
```

---

## 常量定义

```typescript
// ---- TCP 客户端 ----
const DEFAULT_TCP_HOST = '127.0.0.1';
const DEFAULT_TCP_PORT = 27541;
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const RECONNECT_INTERVALS = [1000, 2000, 4000, 8000, 16000];
const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_BUFFER_SIZE = 65536;

// ---- 状态上报 ----
const DEFAULT_STATUS_INTERVAL_MS = 2000;
const STATUS_REPORT_WARN_THRESHOLD_MS = 100;

// ---- 目录路径 ----
const PLUGIN_ROOT = './plugins/mcagent-adapter-be/';
const TOOLS_DIR = PLUGIN_ROOT + 'tools/';
const ALICE_DIR = './Alice/';
const DATA_DIR = ALICE_DIR + 'data/';
const INSTANCE_ID_FILE = DATA_DIR + 'instance_id.txt';
const INSTANCE_FILE_PATH = ALICE_DIR + 'instance.json';

// ---- JSON-RPC 错误码 ----
const JSONRPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  TOOL_TIMEOUT: -32005,
} as const;

// ---- 工具分类 ----
const TOOL_CATEGORIES = [
  'perception', 'movement', 'inventory',
  'entity', 'survival', 'block', 'chat',
] as const;

// ---- 工具注册 ----
const TOOL_MANIFEST_FILENAME = 'manifest.json';
const TOOL_ENTRY_FILENAME = 'index.js';
```

---

## 文件清单

| 文件 | 版本 | 说明 |
|------|:----:|------|
| `src/tcp/TcpClient.ts` | V2 | TCP 客户端核心（连接/断开/重连） |
| `src/tcp/handshake.ts` | V2 | 握手协议（hello 消息类型 + 处理） |
| `src/tcp/heartbeat.ts` | V2 | 心跳响应（ping → pong） |
| `src/tcp/reconnect.ts` | V2 | 断线重连逻辑（指数退避） |
| `src/tcp/json-rpc.ts` | V2 | JSON-RPC 2.0 消息编解码 |
| `src/tcp/message-frame.ts` | V2 | 粘包处理（按 \n 分割字节流） |
| `src/registry/tool-module.types.ts` | V3 | IToolModule 接口定义 |
| `src/registry/tool-registry.ts` | V3 | 工具注册器（自动扫描 + 注册） |
| `src/registry/tool-manager.ts` | V3 | 工具管理器（查找/调用/超时） |
| `src/registry/tool-context.ts` | V3 | 工具执行上下文 |
| `src/status/status-reporter.ts` | V3 | 状态上报（2s 周期） |
| `src/entry/instance-file.ts` | V3 | 入口文件管理（生成 Alice/instance.json 及 UUID 持久化） |
| `src/utils/constants.ts` | V2+V3 | 常量定义（路径、超时、错误码） |
| `src/utils/helpers.ts` | V2+V3 | 工具函数 |
| `src/index.ts` | V2+V3 | 插件入口（初始化流程） |

---

## 实施顺序

### V2 实施步骤

```
第 1 步: 工具函数（json-rpc.ts + message-frame.ts）
  ├── 实现 JsonRpcCodec（编解码 + 消息类型判断）
  └── 实现粘包处理逻辑（onData 分割 + 缓冲区管理）

第 2 步: TCP 客户端核心（TcpClient.ts）
  ├── 实现 net.Socket 连接管理
  ├── 实现 onData → onMessage 消息分发
  └── 实现 sendRequest / sendNotification

第 3 步: 握手协议（handshake.ts）
  ├── 定义 HelloParams / HelloResult 类型
  └── 实现握手流程（发送 hello → 等待响应 → 状态切换）

第 4 步: 心跳响应（heartbeat.ts）
  └── 实现 ping → pong 自动回复

第 5 步: 断线重连（reconnect.ts）
  ├── 实现指数退避算法
  └── 集成到 TcpClient 的 onData 错误处理

第 6 步: Agent Core 模拟器（mock-agent-core.ts）
  ├── 简单的 TCP 服务器，监听 27541
  ├── 接收连接 → 回复 hello → 发送 ping → 接收/发送消息
  └── 用于独立测试 TCP 通信
```

### V3 实施步骤

```
第 1 步: IToolModule 接口定义（tool-module.types.ts）
  ├── ToolMetadata / ToolCategory / ToolResult
  ├── ToolContext（PlayerAccess / WorldAccess / BotAccess）
  └── IToolModule 接口（metadata + execute）

第 2 步: 工具注册器（tool-registry.ts）
  ├── 实现 tools/ 目录遍历
  ├── 实现动态 require() 加载工具模块
  ├── 实现 get / getAll / getByCategory
  └── 实现 generateRegistrationPayload()

第 3 步: 工具执行上下文（tool-context.ts）
  ├── 实现 ToolContextImpl
  ├── 实现 PlayerAccessImpl（BDS Player API 包装）
  └── 实现 WorldAccessImpl（BDS World API 包装）

第 4 步: 状态上报（status-reporter.ts）
  ├── 实现状态数据采集（生命/位置/装备/背包摘要）
  ├── 实现定时上报（setInterval 2s）
  └── 实现阈值告警（> 100ms 记录警告）

第 5 步: JSON 入口生成（instance-file.ts）
  ├── 实现 InstanceFile 类型定义（含 _schema_version 版本字段）
  ├── 实现 Alice/ 目录创建 + instance.json 生成逻辑
  └── 实现 UUID 持久化到 Alice/data/instance_id.txt

第 6 步: 集成入口（index.ts 更新）
  ├── 实现 onServerStarted 初始化流程
  ├── 实现 tool_call 消息分发
  ├── 实现 register_tools 自动发送
  └── 实现 /mcagent status 命令
```

---

## 验收标准

### V2 验收标准

| 验收条目 | 验证方法 | 预期结果 |
|----------|----------|----------|
| TCP 连接建立 | 启动 Agent Core 模拟器后启动插件 | 模拟器收到 TCP 连接 |
| 握手消息发送 | 抓包检查握手消息内容 | 消息格式符合协议规范，含 instance_id + auth_token |
| 握手响应处理 | 模拟器返回成功响应 | 插件日志出现 `Handshake successful` |
| 心跳 Pong 回复 | 模拟器发送 ping | 插件在 1s 内回复 pong |
| 断线重连（1s→16s） | 断开 TCP 连接 | 插件分别在 1s/2s/4s/8s/16s 后尝试重连 |
| 最大重连次数限制 | 持续断开 5 次 | 第 5 次后停止重连，日志输出已达最大次数 |
| 粘包处理 | 模拟器一次发送多条消息（无换行间隔） | 插件正确解析每条消息 |
| JSON-RPC 消息编解码 | 模拟器发送标准 Request | 插件返回正确格式的 Response |
| 连接超时处理 | 连接不可达地址 | 5000ms 后超时，进入重连流程 |
| 异常断开处理 | 模拟器主动关闭连接 | 插件自动进入重连流程 |

### V3 验收标准

| 验收条目 | 验证方法 | 预期结果 |
|----------|----------|----------|
| IToolModule 接口实现 | 创建测试工具注册 | 接口编译通过，无类型错误 |
| 自动扫描 tools/ 目录 | 在 tools/ 下放置 mock 工具 | 扫描到并自动注册 |
| 工具注册消息发送 | TCP 抓包 | `register_tools` 消息包含完整工具列表 JSON Schema |
| 注册确认处理 | 模拟器返回确认 | 插件日志出现 `Tools registered: N tools accepted` |
| 状态上报（2s 周期） | 模拟器接收 | 每 2s (±500ms) 收到 status_report 通知 |
| 状态上报数据完整性 | 检查上报内容 | 包含 health/position/equipment/inventory_summary 全部字段 |
| Alice/instance.json 生成 | 首次启动后检查 BDS 根目录 Alice/ 文件夹 | 文件夹存在，instance.json 文件存在，字段完整，instance_id 为 UUID v4 |
| JSON 文件更新 | 插件重连后检查 Alice/instance.json | status.online 字段正确更新 |
| 工具执行分发 | 模拟器发送 tool_call | 正确路由到对应工具实现并返回结果 |
| 工具超时处理 | 模拟器调用超时设置 < 执行时间的工具 | 返回 TOOL_TIMEOUT 错误 |

---

## 重要约束

1. **坐标参数**：传递给 LLSE API 的坐标参数必须使用 `new FloatPos(x, y, z, dimid)` 构建，不能传 plain object
2. **日志对象**：`logger` 全局对象在脚本加载时即可使用，无需等待生命周期回调
3. **模块加载**：`require()` 在顶层直接使用，无需 `import`（避免 TypeScript 生成 `__esModule` 头）
4. **命令注册时机**：命令注册必须放在 `onServerStarted` 事件回调中，此时 BDS 命令系统已就绪
5. **工具文件导出**：每个工具文件必须默认导出 `IToolModule` 实例（`export default new XxxTool()`）
6. **工具无状态**：工具实现不应持有可变状态，所有状态通过 `ToolContext` 访问
7. **工具超时**：超过 `timeout_max_ms` 必须返回 `TOOL_TIMEOUT` 错误，不抛异常
8. **工具资源释放**：执行完成后必须清理所有占用的游戏资源（如打开的容器界面）
9. **状态上报性能**：单次上报采集 + 序列化耗时必须 < 100ms，否则记录警告并优化
10. **Alice 目录规范**：插件首次启动必须在 BDS 根目录创建 `Alice/` 文件夹，所有对外暴露的文件（instance.json、数据库等）均存放于此，插件内部临时数据保持在 `plugins/` 目录下
11. **instance_id 持久化**：首次生成的 UUID 必须持久化到 `Alice/data/instance_id.txt`，后续重启复用