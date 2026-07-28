# 需求

## 背景

OneBot 可能回推机器人账号自己发送的消息。若该事件继续进入消息处理器，会再次触发 QQAgent，形成自发消息回环。同时，QQAgent 需要统一理解 QQ 回复的唯一发送通道及工具成功后的后续行为，避免相同内容重复发送。

## 范围

- 在 OneBotClient 的入站 message 事件最早分发点过滤 `user_id` 与 `self_id` 相等的事件。
- 普通群聊和私聊消息继续触发既有 messageHandlers。
- QQ 回复必须通过 `qq_send`；普通最终文本不作为 QQ 回复。
- 一次回复内容只发送一次。`qq_send` 成功后，由 LLM 根据任务是否完成决定结束或继续，不在代码中强制结束多轮。
- 保留 MainAgent 现有 assistant tool_call 与 tool result 的历史持久化和加载能力。
- 不修改 qq-sub-agent 旧链路及用户已有无关改动。

## 验收项

- 机器人自身 message 事件不触发 handler，也就不会进入 QQAgent。
- 普通群聊与私聊事件仍正常触发 handler。
- 动态 QQ 工具规则、fallback QQ 工具规则、QQ 默认人设和 `qq_send` schema 均包含一致发送规范。
- `qq_send` 成功结果明确提示消息已记录/加入发送队列、无需重复发送，以及完成时结束、未完成时继续。
- 相关最小测试、类型检查或构建通过。

# 架构

## 入站链路

`OneBot WebSocket → OneBotClient.handleRawMessage → messageHandlers → message-router → MainAgentRegistry/MainAgent`

过滤放在 `handleRawMessage` 识别出 `post_type=message` 后、转换 QQMessage 和遍历 messageHandlers 前。比较时统一转为字符串，以兼容 OneBot ID 的数字或字符串表示。notice 与 API 响应链路不受影响。

## 发送链路

`PromptCompiler QQ 规则 → LLM 调用 qq_send → MainAgentRegistry 本地中间件 → pendingQqSends → message-batcher 投递`

规范由四处保持一致：默认 QQ 人设、动态工具规则、fallback 工具规则、`qq_send` schema。工具成功结果回注 LLM，提示相同内容无需再次发送；MainAgent 多轮循环仍按模型 finish reason 和既有轮次上限运行，不增加 qq_send 特殊终止分支。

## 历史上下文

MainAgent 继续加载并持久化 assistant 的 tool_calls 和对应 tool result。此次不修改历史转换、清理与持久化逻辑，确保后续轮次可知道已调用过的工具及发送内容。

# 执行

## 改动记录

1. `onebot-client.ts`：在 messageHandlers 分发前过滤 `user_id === self_id`。
2. `main-agent-registry.ts`：同步 `qq_send` schema 描述，并增强成功与去重结果反馈。
3. `prompt-compiler.ts`：同步动态及 fallback QQ 工具规则。
4. `prompt/templates/qq-persona/default.json`：同步默认 QQ 发送规范。
5. `onebot-client.test.ts`：增加机器人自身消息不触发 handler 的用例，保留普通群聊、私聊用例。
6. `prompt-compiler-qq-rules.test.ts`：验证 QQ 规范关键文本。

## 验收执行

- 运行 OneBotClient 定向测试。
- 运行 QQ PromptCompiler 规范定向测试。
- 运行 agent-core 类型检查。
- 运行 agent-core 构建；如构建受环境影响，则记录具体结果，不扩大修复范围。
- 核对 git diff，确认未修改 `packages/agent-core/src/main/index.ts`、`.dbg/debug` 文件、adapter-java 用户改动或 qq-sub-agent 旧链路。
