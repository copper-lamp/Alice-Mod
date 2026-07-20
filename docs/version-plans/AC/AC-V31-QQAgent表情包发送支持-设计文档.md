# AC-V31 — QQAgent 表情包发送支持

> 版本：v2.0
> 日期：2026-07-20
> 版本号：V31
> 类型：设计文档（需求 / 架构 / 执行）
> 关联文档：
>
> - [AC-V10-QQ机器人模块.md](AC-V10-QQ机器人模块.md)
> - [AC-V27-QQAgent逻辑验证与修改计划-设计文档.md](AC-V27-QQAgent逻辑验证与修改计划-设计文档.md)
> - [AC-V15-QQ机器人多账号架构设计.md](AC-V15-QQ机器人多账号架构设计.md)
> - [AC-V28-QQ智能体独立Tab与独立系统提示词-设计文档.md](AC-V28-QQ智能体独立Tab与独立系统提示词-设计文档.md)

---

## 第1章 需求文档

### 1.1 背景

当前 QQAgent 的 `qq_send` 工具支持四种发送类型：`group_msg`（群文本）、`private_msg`（私聊文本）、`image`（图片）、`file`（文件）。LLM 在聊天互动中需要能够发送表情来增强互动效果，使群聊对话更自然。

### 1.2 目标

为 QQAgent 的 `qq_send` 工具增加表情包发送能力，支持两种方式：

| 表情方式 | 说明 | 谁控制具体内容 |
|---------|------|--------------|
| **内置表情 (Face)** | QQ 内置表情，LLM 通过数字 ID 指定具体表情 | LLM 自行选择 |
| **表情组 (Sticker Group)** | 用户预定义的一组表情（可混合 face + sticker），LLM 按语义名调用，系统随机选一个发送 | 用户配置，系统随机 |

### 1.3 核心概念

#### 表情组 (Sticker Group)

表情组是用户预定义的表情集合，一个组 = 一个语义概念。例如：

```json
{
  "蚌":   [{ "type": "face", "id": 123 }, { "type": "face", "id": 146 }, { "type": "sticker", "id": "xxxx" }],
  "赞":   [{ "type": "face", "id": 76 },  { "type": "sticker", "id": "yyyy" }],
  "哭":   [{ "type": "face", "id": 107 }, { "type": "face", "id": 109 }],
  "嗨":   [{ "type": "face", "id": 18 },  { "type": "face", "id": 21 }, { "type": "sticker", "id": "zzzz" }]
}
```

- **组名即语义**：`"蚌"` 表示"无语/蚌埠住了"，`"赞"` 表示"点赞/赞同"
- **组内可混合**：一个组可同时包含 face 和 sticker 类型
- **系统随机**：LLM 调用时只需指定组名，系统从组内随机选一个发送
- **LLM 无感知**：LLM 不知道具体 ID，也不需要知道

### 1.4 功能需求

#### FR1: 内置表情发送（Face）

- LLM 可通过 `qq_send` 工具，指定 `type: "face"` 和 `face_id` 参数发送 QQ 内置表情
- 支持群聊和私聊两种场景
- LLM 自行决定用哪个 face_id

#### FR2: 表情组发送（Sticker Group）

- LLM 可通过 `qq_send` 工具，指定 `type: "sticker"` 和 `sticker_group` 参数发送表情组
- 系统根据组名查找配置，随机选一个表情发送
- 支持群聊场景
- 组内可混合 face 和 sticker 类型
- 若组名为空或不存在，返回错误提示可用组名列表

#### FR3: 表情组配置管理

- 用户可在 QQBotConfig 中配置表情组（JSON 格式）
- 支持在 Agent 配置界面编辑
- 默认提供一组常用表情组

#### FR4: 兼容性

- 向后兼容，现有 `group_msg` / `private_msg` / `image` / `file` 类型不受影响
- 在 `qq_send` 的 `type` 参数中增加 `face` 和 `sticker` 两个枚举值

### 1.5 非功能需求

| 编号 | 需求 | 说明 |
|------|------|------|
| NFR1 | 时效性 | 表情发送延迟与普通文本消息一致 |
| NFR2 | 可靠性 | 发送失败时返回明确错误信息，不阻塞后续消息 |
| NFR3 | 随机性 | 表情组内随机选择，分布均匀 |
| NFR4 | 安全性 | 表情 ID 合理校验，防止异常值 |

### 1.6 不使用场景

- 不支持商城表情（Mface）
- 不支持自定义上传表情包（需 NapCat 额外能力）
- 不支持表情接收展示（由 OneBot 客户端自动处理）

---

## 第2章 架构文档

### 2.1 架构总览

```
┌──────────────────────────────────────────────────┐
│                  LLM (QQAgent)                    │
│  调用 qq_send(type: "face", face_id: 9)          │
│  调用 qq_send(type: "sticker", sticker_group: "蚌")│
└──────────────────────┬───────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────┐
│             MainAgentRegistry                     │
│  qq_send_handler middleware                      │
│  → type=face: 直接打包 face_id 入队               │
│  → type=sticker: 查 StickerGroupRegistry         │
│     → 随机选一个表情 → 打包入队                   │
└──────────────────────┬───────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────┐
│             OneBotClient                          │
│  sendGroupFace / sendPrivateFace                 │
│  sendGroupSticker                                │
│  → 构造消息段数组 → WebSocket → OneBot API       │
└──────────────────────────────────────────────────┘
```

### 2.2 核心组件

#### StickerGroupRegistry

新增模块，负责管理表情组配置：

```
StickerGroupRegistry
├── groups: Map<string, StickerItem[]>    // 组名 → 表情列表
├── register(groupName, items)            // 注册/更新一个组
├── unregister(groupName)                 // 删除一个组
├── pickRandom(groupName): StickerItem    // 从组内随机选一个
├── listGroups(): string[]                // 列出所有可用组名
└── loadFromConfig(config)                // 从 QQBotConfig 加载
```

#### StickerItem

```typescript
interface StickerItem {
  type: 'face' | 'sticker';  // 表情类型
  id: string;                 // face_id 或 sticker_id
}
```

### 2.3 数据流

#### 场景 A: LLM 发送内置表情

```
1. LLM → qq_send({type: "face", target: "群号", face_id: 9})
2. qq_send_handler 解析 → face_id=9 直接入队 pendingQqSends
3. MessageBatcher 消费 → client.sendGroupFace("群号", 9)
4. OneBot API: send_group_msg + [{type:"face", data:{id:"9"}}]
```

#### 场景 B: LLM 发送表情组

```
1. LLM → qq_send({type: "sticker", target: "群号", sticker_group: "蚌"})
2. qq_send_handler 解析 → 查 StickerGroupRegistry.pickRandom("蚌")
   → 随机返回 {type: "face", id: "123"} 或 {type: "sticker", id: "xxxx"}
3. 根据随机结果打包入队 pendingQqSends（标记具体 type 和 ID）
4. MessageBatcher 消费 → 调用对应方法发送
```

### 2.4 接口设计

#### 2.4.1 qq_send 工具 Schema 扩展

```typescript
// 扩展后的 type 枚举
type: 'group_msg' | 'private_msg' | 'image' | 'file' | 'face' | 'sticker'

interface QQSendParams {
  type: 'group_msg' | 'private_msg' | 'image' | 'file' | 'face' | 'sticker';
  target: string;           // 目标 ID（群号或 QQ 号）
  content?: string;         // 文本消息内容（group_msg/private_msg 用）
  file_url?: string;        // 文件/图片 URL（image/file 用）
  file_name?: string;       // 文件名（file 用）
  face_id?: number;         // 内置表情 ID（type=face 时必填，范围 0-350）
  sticker_group?: string;   // 表情组名（type=sticker 时必填，如 "蚌"/"赞"/"哭"）
}
```

#### 2.4.2 OneBotClient 新增方法

```typescript
// 发送内置表情（群聊）
sendGroupFace(groupId: string, faceId: number): Promise<SendResult>
// 发送内置表情（私聊）
sendPrivateFace(userId: string, faceId: number): Promise<SendResult>
// 发送贴图（仅群聊，NapCat 支持的 sticker 类型）
sendGroupSticker(groupId: string, stickerId: string): Promise<SendResult>
```

#### 2.4.3 QQBotConfig 扩展

在 [types.ts](file:///d:/McAgent/packages/agent-core/src/main/qq-bot/types.ts) 的 `QQBotConfig` 中新增 `stickerGroups` 字段：

```typescript
export interface QQBotConfig {
  // ... 现有字段 ...

  /** 表情组配置：组名 → 表情列表，系统随机发送 */
  stickerGroups?: Record<string, StickerItem[]>;
}

export interface StickerItem {
  type: 'face' | 'sticker';
  id: string;  // face 填数字 ID 的字符串，sticker 填贴图 ID
}
```

#### 2.4.4 pendingQqSends 队列扩展

```typescript
interface PendingQqSend {
  target: string;
  content: string;
  type: string;     // 原 + 'face'
  faceId?: number;  // 新增：具体表情 ID（face 类型或 sticker 组随机后）
  stickerId?: string; // 新增：具体贴图 ID（sticker 组随机后）
}
```

### 2.5 默认表情组配置

系统内置默认表情组，用户可覆盖：

```json
{
  "蚌":   [{ "type": "face", "id": "123" }, { "type": "face", "id": "146" }, { "type": "face", "id": "307" }],
  "赞":   [{ "type": "face", "id": "76" },  { "type": "face", "id": "320" }],
  "哭":   [{ "type": "face", "id": "107" }, { "type": "face", "id": "109" }],
  "嗨":   [{ "type": "face", "id": "18" },  { "type": "face", "id": "21" }],
  "疑问": [{ "type": "face", "id": "281" }, { "type": "face", "id": "32" }],
  "微笑": [{ "type": "face", "id": "4" },   { "type": "face", "id": "9" }],
  "尴尬": [{ "type": "face", "id": "14" },  { "type": "face", "id": "171" }],
  "可怜": [{ "type": "face", "id": "98" },  { "type": "face", "id": "74" }],
  "牛":   [{ "type": "face", "id": "320" }, { "type": "face", "id": "76" }],
  "裂开": [{ "type": "face", "id": "307" }]
}
```

### 2.6 影响范围

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `packages/agent-core/src/main/qq-bot/onebot-client.ts` | 修改 | 新增 `sendGroupFace`、`sendPrivateFace`、`sendGroupSticker` 方法 |
| `packages/agent-core/src/main/qq-bot/types.ts` | 修改 | `QQSendParams.type` 扩展；新增 `QQBotConfig.stickerGroups`、`StickerItem` 接口 |
| `packages/agent-core/src/main/qq-bot/qq_send.ts` | 修改 | `qqSend` 函数增加 `face`/`sticker` 分支处理 |
| `packages/agent-core/src/main/agent/main-agent-registry.ts` | 修改 | `QQ_SEND_TOOL_SCHEMA_LOCAL` 扩展；`qq_send_handler` 中间件集成 StickerGroupRegistry |
| `packages/agent-core/src/main/qq-bot/qq-sub-agent.ts` | 修改 | `QQ_SEND_TOOL` Schema 扩展；`executeTool` 中 `qq_send` 分支扩展 |
| `packages/agent-core/src/main/qq-bot/message-batcher.ts` | 修改 | `pendingQqSends` 消费逻辑中新增表情类型处理 |
| `packages/agent-core/src/main/qq-bot/sticker-group-registry.ts` | **新增** | 表情组注册表，管理配置和随机选择 |
| `packages/agent-core/src/main/qq-bot/index.ts` | 修改 | 初始化 StickerGroupRegistry 并注入 |

---

## 第3章 执行文档

### 3.1 新增文件：StickerGroupRegistry

**文件**: `packages/agent-core/src/main/qq-bot/sticker-group-registry.ts`

```typescript
import type { StickerItem } from './types';

/**
 * 表情组注册表
 *
 * 管理用户定义的表情组，LLM 按语义名调用时，
 * 系统从此注册表中随机选一个具体表情发送。
 */
export class StickerGroupRegistry {
  private groups = new Map<string, StickerItem[]>();

  /** 默认表情组 */
  private static readonly DEFAULT_GROUPS: Record<string, StickerItem[]> = {
    '蚌':   [{ type: 'face', id: '123' }, { type: 'face', id: '146' }, { type: 'face', id: '307' }],
    '赞':   [{ type: 'face', id: '76' },  { type: 'face', id: '320' }],
    '哭':   [{ type: 'face', id: '107' }, { type: 'face', id: '109' }],
    '嗨':   [{ type: 'face', id: '18' },  { type: 'face', id: '21' }],
    '疑问': [{ type: 'face', id: '281' }, { type: 'face', id: '32' }],
    '微笑': [{ type: 'face', id: '4' },   { type: 'face', id: '9' }],
    '尴尬': [{ type: 'face', id: '14' },  { type: 'face', id: '171' }],
    '可怜': [{ type: 'face', id: '98' },  { type: 'face', id: '74' }],
    '牛':   [{ type: 'face', id: '320' }, { type: 'face', id: '76' }],
    '裂开': [{ type: 'face', id: '307' }],
  };

  /**
   * 加载配置（合并默认组 + 用户自定义覆盖）
   * 用户配置同名的组会覆盖默认组
   */
  loadFromConfig(userGroups?: Record<string, StickerItem[]>): void {
    this.groups.clear();

    // 先加载默认组
    for (const [name, items] of Object.entries(StickerGroupRegistry.DEFAULT_GROUPS)) {
      this.groups.set(name, [...items]);
    }

    // 用户自定义覆盖
    if (userGroups) {
      for (const [name, items] of Object.entries(userGroups)) {
        if (items.length === 0) {
          this.groups.delete(name); // 空数组 = 删除该组
        } else {
          this.groups.set(name, [...items]);
        }
      }
    }
  }

  /** 注册/更新一个表情组 */
  register(groupName: string, items: StickerItem[]): void {
    if (items.length === 0) {
      this.groups.delete(groupName);
    } else {
      this.groups.set(groupName, [...items]);
    }
  }

  /** 删除一个表情组 */
  unregister(groupName: string): void {
    this.groups.delete(groupName);
  }

  /**
   * 从组内随机选一个表情
   * @returns 随机选中的表情项，组不存在返回 null
   */
  pickRandom(groupName: string): StickerItem | null {
    const items = this.groups.get(groupName);
    if (!items || items.length === 0) return null;
    const index = Math.floor(Math.random() * items.length);
    return items[index];
  }

  /** 列出所有可用组名 */
  listGroups(): string[] {
    return Array.from(this.groups.keys());
  }

  /** 获取指定组的内容 */
  getGroup(groupName: string): StickerItem[] | undefined {
    return this.groups.get(groupName);
  }
}
```

### 3.2 修改文件

#### Step 1: 类型定义扩展

**文件**: [types.ts](file:///d:/McAgent/packages/agent-core/src/main/qq-bot/types.ts)

```typescript
// 新增 StickerItem 接口
export interface StickerItem {
  type: 'face' | 'sticker';
  id: string;  // face 填数字 ID 的字符串，sticker 填贴图 ID
}

// 扩展 QQSendParams
export interface QQSendParams {
  type: 'group_msg' | 'private_msg' | 'image' | 'file' | 'face' | 'sticker';
  target: string;
  content?: string;
  file_url?: string;
  file_name?: string;
  face_id?: number;         // 新增
  sticker_group?: string;   // 新增
}

// 扩展 QQBotConfig
export interface QQBotConfig {
  // ... 现有字段 ...
  /** 表情组配置 */
  stickerGroups?: Record<string, StickerItem[]>;
}
```

#### Step 2: OneBotClient 新增方法

**文件**: [onebot-client.ts](file:///d:/McAgent/packages/agent-core/src/main/qq-bot/onebot-client.ts)

在 `sendGroupFile` 方法之后新增：

```typescript
// ── 内置表情发送 ──

async sendGroupFace(groupId: string, faceId: number): Promise<SendResult> {
  try {
    const result = await this.callApi('send_group_msg', {
      group_id: parseInt(groupId),
      message: [{ type: 'face', data: { id: String(faceId) } }],
    });
    return { success: true, messageId: String(result.data?.message_id ?? '') };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : '发送表情失败' };
  }
}

async sendPrivateFace(userId: string, faceId: number): Promise<SendResult> {
  try {
    const result = await this.callApi('send_private_msg', {
      user_id: parseInt(userId),
      message: [{ type: 'face', data: { id: String(faceId) } }],
    });
    return { success: true, messageId: String(result.data?.message_id ?? '') };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : '发送表情失败' };
  }
}

// ── 贴图发送（仅群聊，NapCat 支持） ──

async sendGroupSticker(groupId: string, stickerId: string): Promise<SendResult> {
  try {
    const result = await this.callApi('send_group_msg', {
      group_id: parseInt(groupId),
      message: [{ type: 'sticker', data: { id: stickerId } }],
    });
    return { success: true, messageId: String(result.data?.message_id ?? '') };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : '发送贴图失败' };
  }
}
```

#### Step 3: qq_send 工具实现扩展

**文件**: [qq_send.ts](file:///d:/McAgent/packages/agent-core/src/main/qq-bot/qq_send.ts)

在 `qqSend` 函数的 `switch` 中增加两个分支：

```typescript
case 'face':
  if (params.face_id === undefined) return { success: false, error: '内置表情 ID 不能为空' };
  return client.sendGroupFace(params.target, params.face_id);

case 'sticker':
  // sticker 类型由 qq_send_handler 中间件预解析为具体表情
  // 这里不会直接走到，因为中间件会先查 StickerGroupRegistry 随机选一个
  // 走到这里说明是直接调用（非中间件场景），返回错误
  return { success: false, error: 'sticker 类型需通过中间件解析，请使用 face 或直接调用对应 API' };
```

#### Step 4: Tool Schema 扩展

**文件**: [main-agent-registry.ts](file:///d:/McAgent/packages/agent-core/src/main/agent/main-agent-registry.ts)

```typescript
const QQ_SEND_TOOL_SCHEMA_LOCAL: ToolSchema = {
  name: 'qq_send',
  description: '发送 QQ 消息，支持群消息、私聊、图片、文件、内置表情、表情组六种方式。当需要向 QQ 群或用户发送消息时使用此工具。回复用户消息时必须使用此工具。',
  category: ToolCategory.QQ,
  parameters: {
    type: {
      type: 'string',
      description: '发送类型：group_msg=发送到群聊（回复群消息时用）, private_msg=发送私聊（回复私聊时用）, image=发送图片, file=发送文件, face=发送指定内置表情（需填 face_id）, sticker=发送表情组（系统随机选，需填 sticker_group）',
      required: true,
    } as ParamDefinition,
    target: { type: 'string', description: '目标 ID：群聊时填群号，私聊时填对方 QQ 号', required: true } as ParamDefinition,
    content: { type: 'string', description: '消息内容（type=group_msg 或 private_msg 时必填，纯文本消息内容）', required: false } as ParamDefinition,
    file_url: { type: 'string', description: '文件/图片 URL（type=image 或 file 时必填）', required: false } as ParamDefinition,
    file_name: { type: 'string', description: '文件名（type=file 时必填）', required: false } as ParamDefinition,
    face_id: { type: 'number', description: '内置表情 ID（type=face 时必填，范围 0-350，如 9=偷笑, 76=点赞, 107=流泪, 307=裂开）', required: false } as ParamDefinition,
    sticker_group: { type: 'string', description: '表情组名（type=sticker 时必填，如 "蚌"/"赞"/"哭"/"嗨"），系统从组内随机选一个表情发送', required: false } as ParamDefinition,
  },
};
```

**文件**: [qq-sub-agent.ts](file:///d:/McAgent/packages/agent-core/src/main/qq-bot/qq-sub-agent.ts)

同样扩展 `QQ_SEND_TOOL` 的 Schema 定义，保持一致。

#### Step 5: qq_send_handler 中间件集成 StickerGroupRegistry

**文件**: [main-agent-registry.ts](file:///d:/McAgent/packages/agent-core/src/main/agent/main-agent-registry.ts)

在 `qq_send_handler` 中间件中处理 `face` 和 `sticker` 类型：

```typescript
// 在文件顶部导入 StickerGroupRegistry
import { StickerGroupRegistry } from '../qq-bot/sticker-group-registry';

// 在 MainAgentRegistry 中持有 StickerGroupRegistry 实例
// 通过 deps 注入或在构造时创建
private stickerGroupRegistry: StickerGroupRegistry;

// 在 qq_send_handler 中间件中：
for (const call of qqSendCalls) {
  const startTime = Date.now();
  const params = call.arguments as Record<string, unknown>;
  const sendType = params.type as string;
  const target = params.target as string;

  let resolvedType = sendType;
  let faceId: number | undefined;
  let stickerId: string | undefined;

  if (sendType === 'face') {
    // 内置表情：直接取 face_id
    faceId = params.face_id as number | undefined;
    if (faceId === undefined) {
      ctx.results = ctx.results ?? [];
      ctx.results.push({
        type: 'tool_result',
        toolCallId: call.toolCallId,
        toolName: 'qq_send',
        success: false,
        error: '发送内置表情时必须指定 face_id',
        durationMs: Date.now() - startTime,
      } as any);
      continue;
    }
  } else if (sendType === 'sticker') {
    // 表情组：从 StickerGroupRegistry 随机选一个
    const groupName = params.sticker_group as string | undefined;
    if (!groupName) {
      const availableGroups = this.stickerGroupRegistry.listGroups();
      ctx.results = ctx.results ?? [];
      ctx.results.push({
        type: 'tool_result',
        toolCallId: call.toolCallId,
        toolName: 'qq_send',
        success: false,
        error: `表情组名不能为空，可用组名：${availableGroups.join('、')}`,
        durationMs: Date.now() - startTime,
      } as any);
      continue;
    }

    const picked = this.stickerGroupRegistry.pickRandom(groupName);
    if (!picked) {
      const availableGroups = this.stickerGroupRegistry.listGroups();
      ctx.results = ctx.results ?? [];
      ctx.results.push({
        type: 'tool_result',
        toolCallId: call.toolCallId,
        toolName: 'qq_send',
        success: false,
        error: `表情组 "${groupName}" 不存在，可用组名：${availableGroups.join('、')}`,
        durationMs: Date.now() - startTime,
      } as any);
      continue;
    }

    // 根据随机结果确定具体类型和 ID
    if (picked.type === 'face') {
      resolvedType = 'face';
      faceId = parseInt(picked.id);
    } else {
      resolvedType = 'sticker';
      stickerId = picked.id;
    }
  }

  // 去重 key（表情按 target:type:id 去重）
  const dedupKey = `${target}:${resolvedType}:${faceId ?? stickerId ?? ''}`;
  if (dedupSet.has(dedupKey)) {
    ctx.results = ctx.results ?? [];
    ctx.results.push({
      type: 'tool_result',
      toolCallId: call.toolCallId,
      toolName: 'qq_send',
      success: true,
      data: { message: '消息已加入发送队列（去重）' },
      durationMs: Date.now() - startTime,
    } as any);
    continue;
  }
  dedupSet.add(dedupKey);

  // 存入待发送队列
  const pending = pendingQqSends.get(agentId) ?? [];
  pending.push({ target, content: '', type: resolvedType, faceId, stickerId });
  pendingQqSends.set(agentId, pending);

  ctx.results = ctx.results ?? [];
  ctx.results.push({
    type: 'tool_result',
    toolCallId: call.toolCallId,
    toolName: 'qq_send',
    success: true,
    data: { message: '表情已加入发送队列' },
    durationMs: Date.now() - startTime,
  } as any);
}
```

#### Step 6: pendingQqSends 队列消费扩展

**文件**: [message-batcher.ts](file:///d:/McAgent/packages/agent-core/src/main/qq-bot/message-batcher.ts)

在 `flush()` 方法的消费循环中新增表情类型处理：

```typescript
try {
  switch (pending.type) {
    case 'private_msg':
    case 'private':
      await client.sendPrivateMsg(target, pending.content);
      break;
    case 'face':
      await client.sendGroupFace(target, pending.faceId!);
      break;
    case 'sticker':
      await client.sendGroupSticker(target, pending.stickerId!);
      break;
    default: // group_msg, image, file
      await client.sendGroupMsg(target, pending.content);
      break;
  }
  console.log(`[MessageBatcher] qq_send 消息已发送到 ${target}, type=${pending.type}`);
} catch (err) {
  console.error(`[MessageBatcher] 发送 qq_send 消息失败:`, err);
}
```

#### Step 7: 初始化 StickerGroupRegistry

**文件**: [qq-bot/index.ts](file:///d:/McAgent/packages/agent-core/src/main/qq-bot/index.ts) 或相关初始化位置

```typescript
import { StickerGroupRegistry } from './sticker-group-registry';

// 创建全局单例
export const stickerGroupRegistry = new StickerGroupRegistry();

// 在 QQ 机器人启动时加载配置
export function initStickerGroups(config?: Record<string, StickerItem[]>): void {
  stickerGroupRegistry.loadFromConfig(config);
}
```

在 `MainAgentRegistry` 构造时或 `qq_send_handler` 中间件初始化时注入 `stickerGroupRegistry`。

### 3.3 验证方案

| 测试项 | 预期结果 | 验证方式 |
|--------|---------|---------|
| 发送内置表情 (face) | 群聊/私聊中正确显示对应 QQ 表情 | 手动测试，qq_send type=face face_id=9 |
| 发送表情组 (sticker) | 群聊中随机显示组内一个表情，多次调用应有不同 | 手动测试，qq_send type=sticker sticker_group="蚌" 连续调用 5 次 |
| 表情组不存在 | 返回错误并列出可用组名 | 发送不存在的组名 |
| 参数校验 | face_id 为空中返回错误 | 测试 |
| 向后兼容 | 原有四种类型正常发送 | 回归测试 |
| 默认组加载 | 启动后 stickerGroupRegistry.listGroups() 返回默认 10 个组 | 单元测试 |
| 随机性 | 同组多次 pickRandom 返回不同结果 | 单元测试（100 次采样） |

### 3.4 风险与注意事项

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| NapCat 对 sticker 类型支持不一致 | 贴图发送失败 | face 类型是标准 OneBot 协议，始终可用；sticker 失败时回落提示 |
| 表情组配置丢失 | 默认组可用，用户自定义组丢失 | 默认组硬编码在代码中作为兜底 |
| 随机选择导致 LLM 困惑 | LLM 无法预期具体发出什么 | 设计上 LLM 不关心具体 ID，只关心语义组名 |
| 去重逻辑误拦截 | 同一表情组连续调用被拦截 | 去重 key 包含随机后的具体 ID，不同次随机结果不同则不会拦截 |

### 3.5 实施顺序

1. Step 1: 类型定义扩展（types.ts）
2. Step 2: 新增 StickerGroupRegistry（sticker-group-registry.ts）
3. Step 3: OneBotClient 新增方法（onebot-client.ts）
4. Step 4: qq_send 工具实现扩展（qq_send.ts）
5. Step 5: Tool Schema 扩展（main-agent-registry.ts + qq-sub-agent.ts）
6. Step 6: qq_send_handler 中间件集成（main-agent-registry.ts）
7. Step 7: pendingQqSends 队列消费扩展（message-batcher.ts）
8. Step 8: 初始化集成（index.ts 或相关位置）
9. 验证：按 3.3 验证方案执行测试

### 3.6 文件变更清单

| 文件 | 变更类型 | 变更说明 |
|------|---------|---------|
| `packages/agent-core/src/main/qq-bot/sticker-group-registry.ts` | **新增** | 表情组注册表，含默认组、配置加载、随机选择 |
| `packages/agent-core/src/main/qq-bot/types.ts` | 修改 | 新增 `StickerItem` 接口；`QQSendParams` 扩展 `face`/`sticker` 类型及参数；`QQBotConfig` 新增 `stickerGroups` |
| `packages/agent-core/src/main/qq-bot/onebot-client.ts` | 修改 | 新增 `sendGroupFace`、`sendPrivateFace`、`sendGroupSticker` 三个方法 |
| `packages/agent-core/src/main/qq-bot/qq_send.ts` | 修改 | `qqSend` 函数新增 `face`/`sticker` 分支 |
| `packages/agent-core/src/main/agent/main-agent-registry.ts` | 修改 | `QQ_SEND_TOOL_SCHEMA_LOCAL` 扩展；`qq_send_handler` 中间件集成 StickerGroupRegistry 随机选择逻辑 |
| `packages/agent-core/src/main/qq-bot/qq-sub-agent.ts` | 修改 | `QQ_SEND_TOOL` Schema 扩展；`executeTool` 中 `qq_send` 分支扩展 |
| `packages/agent-core/src/main/qq-bot/message-batcher.ts` | 修改 | `pendingQqSends` 消费循环新增 `face`/`sticker` 处理 |
| `packages/agent-core/src/main/qq-bot/index.ts` | 修改 | 初始化 StickerGroupRegistry 并注入到 MainAgentRegistry |