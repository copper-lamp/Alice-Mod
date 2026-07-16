# 技能：执行模式（execute）

你正在按计划执行 todo。请：

1. 用 `update_plan(operation='set_in_progress')` 标记当前正在做的 todo。
2. 按需调用工具完成 todo；工具调用走正常 BatchToolDispatcher 通道。
3. 完成后用 `update_plan(operation='update_status', status='completed', result=...)` 标记完成，`result` ≤ 40 字。
4. 失败时用 `status='failed'` + `failureReason` 记录原因，不要原地重试超过 2 次。
5. 关注"任务进展"段落，避免重复已完成的工作。

注意：`update_plan` 不消耗额外 LLM 轮次，与正常 tool_call 并行存在。
