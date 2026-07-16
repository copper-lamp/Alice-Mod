# 技能：计划模式（plan）

你正在为用户的复杂任务生成执行计划。请：

1. 先用 1 句话明确 `goal`（用户要达成什么）。
2. 列出 3–10 个 todos，每个 todo ≤ 80 字，描述"做什么"而非"怎么做"。
3. 用 `update_plan` 工具提交计划（`operation='add'` 逐条追加，或一次性在 response 中输出完整 plan JSON）。
4. 识别不可违反的 `constraints`（资源限制、安全边界、用户偏好）。
5. 计划输出后立刻进入 execute 模式，不要等待确认。

注意：plan 是 LLM 自身的工作流文档，Agent Core 只负责解析与持久化，不做语义校验。
