# Agent Core — QQAgent 上下文与工具隔离

> 日期：2026-07-28
> 状态：已实施（2026-07-28）

## 第一部分：需求

### 1.1 问题

QQAgent 与主 Agent 复用 PromptBuilder 和 ToolRegistry。虽然 QQAgent 已有独立的系统提示词和历史存储，但当前工具组装读取“工作区工具 + Agent Core 本地工具”的合并结果，导致 Adapter 注册的游戏内工具描述和模型工具定义进入 QQAgent，形成上下文污染。

### 1.2 隔离目标

1. 主 Agent 与 QQAgent 使用严格区分的系统上下文。
2. QQAgent 只能看到并调用 Agent Core 本地注册工具。
3. Adapter/Workspace 注册的所有游戏内工具不得进入 QQAgent 的系统提示词、工具提示区或模型 tools 参数。
4. QQAgent 的游戏操作请求只能通过 Agent Core 内置的 `request_game_action` 委托主 Agent。
5. 主 Agent 维持现有工作区游戏工具能力，不受 QQAgent 过滤影响。
6. QQAgent 不继承主 Agent 的自定义 Prompt fragments、任务进展或技能文本。
7. QQAgent 保留独立人设、独立历史、QQ 消息上下文和必要的 peer context。

### 1.3 验收标准

- QQAgent 的系统消息不包含任何 Adapter/Workspace 工具名称或描述。
- QQAgent 提交给模型的工具定义只来自 Agent Core 本地工具集合。
- QQAgent 可继续调用 QQ、联网、Wiki、记忆及 `request_game_action` 等 AC 内置工具。
- 主 Agent 提交给模型的游戏工具保持可用。
- 新增 Adapter 工具时无需维护 QQ 黑名单，也不会自动暴露给 QQAgent。
- 现有 QQ 独立历史键 `qq:<agentId>` 保持不变。

## 第二部分：架构

### 2.1 工具来源边界

ToolRegistry 明确维护两类来源：

- Workspace tools：由 Java/Bedrock Adapter 通过 `register_tools` 注册，属于游戏内工具。
- Local tools：由 Agent Core 通过 `registerLocal` 注册，属于 AC 内置工具。

新增只读来源接口：

- `getWorkspaceTools(workspaceId)`：仅返回 Adapter/Workspace 工具。
- `getLocalTools(workspaceId)`：仅返回 Agent Core 本地工具。
- `getTools(workspaceId)`：维持现有合并语义，供主 Agent 使用。

QQAgent 使用 `getLocalTools`；主 Agent继续使用 `getTools`。隔离依据是注册来源，不依赖易遗漏的类别或名称黑名单。

### 2.2 Prompt 构建边界

PromptBuilder 增加构建级工具来源选择，默认值仍为合并工具，保证主 Agent 行为不变：

- 主 Agent：`toolScope = all`
- QQAgent：`toolScope = local`

工具组装器根据 scope 选择 Registry 接口。这样 `promptResult.tools` 在生成时已经隔离，后续 LLM tools 转换不再依赖二次类别过滤。

QQAgent 构建时同时关闭主 Agent 专属动态注入：

- 不追加自定义 `system_end` fragment。
- 不注入 `before_tools` / `after_tools` fragment。
- 不透传主 Agent 的 progress 和 skills。
- 继续允许 QQ 专用 `systemOverride`、peer context 和 QQ 用户消息。

### 2.3 编译提示词边界

`PromptCompiler.compileQQ` 生成工具说明时只读取 `getLocalTools(workspaceId)`。提示词中的工具清单与模型请求中的 tools 定义由同一来源规则约束，避免“提示词不可见但仍可调用”或“提示词宣称可用但模型未提供”的不一致。

### 2.4 数据流

```text
Adapter register_tools ──> Workspace tools ──> 主 Agent
                                              └─X─> QQAgent

Agent Core registerLocal ─> Local tools ─────> 主 Agent
                                      └──────> QQAgent

QQ 游戏操作 ──> request_game_action ──> 主 Agent ──> Workspace 游戏工具
```

### 2.5 兼容性

- 保留 `getTools` 的现有合并行为，避免影响已有调用方。
- 旧的 `qqCompiledPrompt` 可能已包含污染内容；实施时应在 Agent 配置加载/更新链路重新编译，或使 QQ 运行时使用按新规则生成的提示词。
- 工具来源为空时，QQ fallback 仍只描述 AC 内置的基础 QQ 与委托工具。

## 第三部分：执行

### 3.1 修改范围

1. `workspace/tool-registry.ts`
   - 增加 workspace/local 分来源读取接口。
   - 保持 `getTools` 合并语义。

2. `prompt/types.ts`
   - 为 BuildParams/AssembleOptions 增加工具来源 scope 和 fragment 隔离选项。

3. `prompt/tools/tool-prompt-assembler.ts`
   - 按 scope 获取全部工具或仅本地工具。

4. `prompt/builder/prompt-builder.ts`
   - QQ 构建支持禁用主 Agent fragments。
   - 将工具 scope 透传给 assembler。

5. `prompt/compiler/prompt-compiler.ts`
   - `compileQQ` 仅使用 AC 本地工具生成说明。

6. `agent/main-agent.ts`
   - QQ 来源设置 local tool scope 并关闭主 Agent fragments/progress/skills。
   - 移除或收紧 QQ 端事后类别过滤，保证最终 tools 与编译提示一致。

### 3.2 测试

- ToolRegistry：验证 workspace、local、merged 三种读取结果。
- PromptCompiler：验证 QQ 编译提示只包含 local tools。
- PromptBuilder/MainAgent：验证 QQ 请求 tools 仅包含 local tools，且主 Agent fragments 不进入 QQ 消息。
- 主 Agent 回归：验证 workspace 游戏工具仍存在。
- 委托链路：验证 QQAgent 仍包含 `request_game_action`。

### 3.3 实施顺序

1. 扩展 ToolRegistry 的来源读取能力。
2. 扩展 Prompt 组装参数与 assembler。
3. 对 QQ 构建启用 local-only 与 fragment 隔离。
4. 调整 QQ 编译提示词来源。
5. 增加单元与集成测试。
6. 执行相关测试和 TypeScript 检查。

### 3.4 实施结果

- 已增加 Workspace/Local/Merged 三套工具读取接口。
- QQAgent 的系统提示词与模型 tools 参数均固定使用 Local tools。
- QQAgent 已关闭主 Agent fragments、progress 与 skills 注入。
- QQ 请求运行时重新按当前 Local tools 编译提示词，不再信任旧 `qqCompiledPrompt`。
- 主 Agent 保持合并工具与原有上下文能力。

### 3.5 验证结果

- ToolRegistry、工具组装器、QQ PromptCompiler、MainAgent：42 项测试通过。
- QQ/local-only 与主 Agent 默认流程集成测试：2 项测试通过。
- 合计：44 项相关测试通过。
- `tsc --noEmit` 已执行；当前仅被 Renderer 既有的 `AgentViewTab` 类型错误阻塞，本模块修改文件无编辑器诊断。
