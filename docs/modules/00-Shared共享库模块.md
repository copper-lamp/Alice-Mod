# Shared 共享库模块 — 技术文档

> 对应版本：V1（第 1 周）
> 模块：Agent Core（AC）— 跨模块共享
> 关联文档：[AC-01-需求文档.md](../version-plans/AC/AC-01-需求文档.md)、[AC-02-实施计划.md](../version-plans/AC/AC-02-实施计划.md)

---

## 第一部分：需求文档

### 1.1 模块定位

Shared 库是所有模块（Agent Core / Adapter BE / Adapter JE）共享的类型定义和工具库。它确保跨模块的 JSON-RPC 通信、工具 Schema、错误码和协议常量保持一致。

**核心原则**：Shared 库不依赖任何运行时模块，纯 TypeScript 类型 + 纯函数，可在所有模块中安全使用。

### 1.2 功能需求列表

| 需求 ID | 需求名称 | 优先级 | 实现状态 |
|---------|----------|--------|:--------:|
| AC-SHARED-01 | Electron + TypeScript 项目初始化 | P0 | ✅ |
| AC-SHARED-02 | Shared 库 - JSON-RPC 2.0 核心类型定义 | P0 | ✅ |
| AC-SHARED-03 | Shared 库 - ToolSchema（ToolDefinition/ToolCategory） | P0 | ✅ |
| AC-SHARED-04 | Shared 库 - 协议工具（消息校验/错误码查询/版本比较） | P0 | ✅ |
| AC-SHARED-05 | Shared 库 - 常量与枚举（协议常量/错误码/事件类型） | P0 | ✅ |
| AC-SHARED-06 | Monorepo 配置 + 代码规范（tsconfig/eslint/prettier） | P0 | ✅ |

### 1.3 验收标准

| # | 验收条件 | 验证方法 | 状态 |
|---|---------|----------|:----:|
| 1.1 | Electron 窗口可正常显示 | `pnpm dev` 启动无报错 | ✅ |
| 1.2 | Shared 库类型可被 `src/main/` 引用 | `import { JsonRpcRequest }` 编译通过 | ✅ |
| 1.3 | Shared 库类型可被 `src/renderer/` 引用 | 渲染进程可导入 Shared 类型 | ✅ |
| 1.4 | `pnpm test` 全部通过 | `pnpm test` 执行 Vitest | ✅ (58 tests) |
| 1.5 | ESLint 无错误 | `pnpm lint` | ✅ (0 error) |
| 1.6 | TypeScript 编译无错误 | `pnpm typecheck` | ✅ |
| 1.7 | 4 个 Shared 模块全部就绪 | types/schema/protocol/constants | ✅ |
| 1.8 | 协议常量值正确 | DEFAULT_TCP_PORT=27541, PROTOCOL_VERSION='1.0.0' | ✅ |

---

## 第二部分：架构文档

### 2.1 模块划分

```
@mcagent/shared
├── types/              ─ JSON-RPC 2.0 核心类型
│   ├── JsonRpcRequest      请求（id + method + params）
│   ├── JsonRpcResponse     响应（id + result/error）
│   ├── JsonRpcNotification 通知（method + params，无 id）
│   ├── JsonRpcError        错误对象（code + message + data）
│   ├── ErrorCode           标准 + 自定义错误码枚举
│   └── ...BatchRequest    批量请求/响应类型
│
├── schema/             ─ 工具 Schema 定义
│   ├── ToolSchema          工具描述（name/description/parameters/category）
│   ├── ParamDefinition     参数定义（type/required/default/enum）
│   ├── ToolCategory        工具类别枚举
│   └── ToolResult          工具执行结果
│
├── protocol/           ─ 协议校验工具（纯函数）
│   ├── isValidRequest      校验请求格式
│   ├── isValidResponse     校验响应格式
│   ├── isValidBatchRequest 校验批量请求
│   ├── createRequest       创建请求对象
│   ├── createSuccessResponse 创建成功响应
│   └── createErrorResponse   创建错误响应
│
└── constants/          ─ 常量与枚举
    ├── DEFAULT_TCP_CONFIG     TCP 默认配置（端口 27541）
    ├── PROTOCOL_VERSION       协议版本（1.0.0）
    ├── VERSION                项目版本
    ├── TOOL                   工具相关常量
    ├── AC_TOOL_COUNT          AC 工具数（17）
    ├── ADAPTER_TOOL_COUNT     Adapter 工具数（26）
    └── CONTEXT/SCHEDULER      上下文/调度常量
```

### 2.2 跨模块引用关系

```
┌──────────────────────┐
│   packages/shared/   │  ← 纯类型 + 纯函数，无运行时依赖
└──────┬───────┬───────┘
       │       │
       ▼       ▼
┌──────────┐ ┌──────────────┐
│agent-core│ │adapter-      │
│(Electron)│ │bedrock(TS)   │
└──────────┘ └──────────────┘
       │
       ▼
┌──────────────┐
│adapter-java  │  ← Java 版需自行实现等价类型
│(Fabric/Java) │
└──────────────┘
```

### 2.3 错误码体系

| 错误码 | 常量名 | 含义 |
|:------:|--------|------|
| -32700 | ParseError | JSON 解析错误 |
| -32600 | InvalidRequest | 无效请求 |
| -32601 | MethodNotFound | 方法未找到 |
| -32602 | InvalidParams | 参数无效 |
| -32603 | InternalError | 内部错误 |
| -32000 | ToolExecutionFailed | 工具执行失败 |
| -32001 | AuthFailed | 认证失败 |
| -32002 | Unauthorized | 未认证 |
| -32003 | VersionMismatch | 版本不匹配 |
| -32004 | ToolNotFound | 工具未找到 |
| -32005 | ToolTimeout | 工具超时 |
| -32006 | InstanceBusy | 实例忙 |
| -32009 | ConnectionLimitExceeded | 连接数超限 |

---

## 第三部分：执行文档

### 3.1 文件结构

```
packages/shared/
├── package.json           ─ 包配置（@mcagent/shared）
├── tsconfig.json          ─ TypeScript 配置
├── vitest.config.ts       ─ 测试配置
├── __tests__/             ─ 测试用例
│   ├── types.test.ts      ─ ErrorCode 枚举测试
│   ├── schema.test.ts     ─ ToolSchema 测试
│   ├── protocol.test.ts   ─ 协议校验工具测试
│   └── constants.test.ts  ─ 常量值测试
└── src/
    ├── index.ts            ─ 统一导出入口
    ├── types/index.ts      ─ 类型定义
    ├── schema/index.ts     ─ Schema 定义
    ├── protocol/index.ts   ─ 协议工具函数
    └── constants/index.ts  ─ 常量与枚举
```

### 3.2 核心导出 API

```typescript
// types
export type { JsonRpcRequest, JsonRpcResponse, JsonRpcSuccessResponse, JsonRpcErrorResponse }
export type { JsonRpcNotification, JsonRpcError, JsonRpcId, JsonRpcMessage }
export type { JsonRpcBatchRequest, JsonRpcBatchResponse }
export { ErrorCode }

// schema
export type { ToolSchema, ParamDefinition, ToolResult, ParamType }
export { ToolCategory }

// protocol
export { isValidRequest, isValidResponse, isValidError, isValidBatchRequest }
export { createRequest, createSuccessResponse, createErrorResponse }

// constants
export { DEFAULT_TCP_CONFIG, PROTOCOL_VERSION, VERSION, TOOL }
export { AC_TOOL_COUNT, ADAPTER_TOOL_COUNT, TOTAL_TOOL_COUNT }
export { CONTEXT, SCHEDULER, DB_NAME, PROJECT_NAME }
```

### 3.3 测试指南

```bash
# 运行所有 Shared 测试
pnpm --filter shared test

# 运行带覆盖率测试
pnpm --filter shared vitest run --coverage

# 特定测试文件
pnpm --filter shared vitest run __tests__/protocol.test.ts
```

测试覆盖 4 个文件共 58 个用例：

| 测试文件 | 用例数 | 关键测试场景 |
|----------|:------:|-------------|
| `types.test.ts` | 2 | ErrorCode 标准码 + 自定义码 |
| `schema.test.ts` | 6 | ToolCategory / ParamDefinition / ToolSchema / ToolResult |
| `protocol.test.ts` | 34 | 请求/响应/错误/批量校验/创建工具函数 |
| `constants.test.ts` | 20 | TCP配置/版本/工具数量/上下文/调度常量 |

### 3.4 使用示例

```typescript
// 在 agent-core 中引用
import type { JsonRpcRequest, JsonRpcResponse } from '@mcagent/shared';
import { isValidRequest, ErrorCode, DEFAULT_TCP_CONFIG } from '@mcagent/shared';

// 校验消息
const isValid = isValidRequest({ jsonrpc: '2.0', id: 1, method: 'handshake' });

// 使用常量
const port = DEFAULT_TCP_CONFIG.port; // 27541

// 使用错误码
const errorCode = ErrorCode.AuthFailed; // -32001
```

### 3.5 常见问题

#### Q: 修改 Shared 类型后需要做什么？
修改 Shared 源码后，需要重建才能使其他模块使用新版本：
```bash
pnpm --filter shared build
```

#### Q: ErrorCode 的值和规范不一致怎么办？
ErrorCode 枚举在 [types/index.ts](file:///d:/McAgent/packages/shared/src/types/index.ts) 中定义，必须与 AC-03 规范第 2.2.3 节保持对齐。修改后需更新对应测试。

#### Q: 如何新增一个共享常量？
1. 在 [constants/index.ts](file:///d:/McAgent/packages/shared/src/constants/index.ts) 中添加常量
2. 在 [index.ts](file:///d:/McAgent/packages/shared/src/index.ts) 中导出
3. 在 `__tests__/constants.test.ts` 中添加测试

---

> **更新记录**
> - 2026-07-04：初版创建，对应 V1 Shared 共享库模块
