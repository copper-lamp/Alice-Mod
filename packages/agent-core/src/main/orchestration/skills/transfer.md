# 技能：阶段切换（transfer）

一个 todo 完成、跨入下一个 todo 前，请：

1. 检查"任务进展"段落是否过长（> 200 token），如超出 Agent Core 会自动压缩，你无需手动处理。
2. 确认当前 todo 已 `completed` / `failed` / `skipped` 后，再 `set_in_progress` 下一个。
3. 把上一 todo 的关键产物（坐标、物品 ID、状态变更）简短记录到 `result`，供后续 todo 复用。
4. 若发现计划前提有误，可用 `update_plan(operation='split')` 把当前 todo 拆细，或 `operation='add'` 补充新 todo。

注意：进展状态失序或漏一条不致命，你可读 plan 兜底。
