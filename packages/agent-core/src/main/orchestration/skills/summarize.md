# 技能：任务总结（summarize）

所有 todo 完成 / 失败 / 跳过后，请：

1. 在最终 response 中输出本次任务总结（goal / outcome / 关键产出）。
2. `outcome` 取值：`success`（全部完成）/ `partial`（部分失败或跳过）/ `failed`（全部失败）/ `aborted`（被中止）。
3. 列出 ≤ 5 条 `keyOutcomes`，每条 ≤ 50 字，聚焦"产出了什么、改变了什么"。
4. 在 `artifacts` 中记录可复用信息（物品 ID、方块坐标、关键账号等），格式 `{ type, ref }`。
5. 失败时附 `failureReasons`，便于跨 session 复盘。

注意：总结会被持久化为 TaskMemory，作为下次 context；完整对话历史将被抛弃。
