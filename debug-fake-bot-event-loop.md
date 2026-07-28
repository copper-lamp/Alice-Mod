# 假人反复上下线且无 LLM 调用调试记录

状态：[OPEN]
会话：fake-bot-event-loop

## 需求

定位假人反复上下线、死亡后被重新拉起且没有 LLM 调用记录的根因；基于运行时证据实施最小修复，并对比修复前后日志。

## 架构

关注链路：Minecraft Mod 事件 → TCP event 通知 → Agent Core trigger → Agent/任务链 → LLM；并行检查 bot_control 状态同步与假人死亡/上下线生命周期。

## 假设

1. event 转发动态加载 `./trigger` 失败，事件无法进入触发器和 LLM 调用链。
2. 构建产物漏打包 trigger，或运行时相对路径错误。
3. 假人死亡后状态同步仍判定其应在线，控制端持续下发 online/offline。
4. LLM 依赖事件触发，事件转发失败导致任务链没有有效输入。
5. 主 Agent bot 未生成，hads 仅由 bot_control 拉起，因此不会触发预期 Agent/LLM 行为。

## 执行

- [x] 收集用户提供的 Mod 与 Agent Core 日志。
- [x] 定位 event 转发、trigger 加载、bot_control 和 LLM 调用代码路径。
- [x] 添加最小网络调试插桩并复现。
- [x] 根据证据实施最小修复。
- [x] 完成类型检查、构建产物检查。
- [ ] 用户重启 Agent Core 后复现并确认运行时结果。
- [ ] 用户确认后清理调试产物。

## 证据与结论

- Mod 已成功握手并注册 32 个工具。
- `hads` 两次上线后均被 Zombie 杀死并离线；两次上线前均有明确的外部 `bot_control: online`，不是 LLM 自主反复拉起。
- `status` 每约 30 秒出现一次，对应 Agent Core `agent:get-status` 的状态轮询。
- Agent Core 每次 event 通知均报 `Cannot find module './trigger'`，Require stack 指向 `packages/agent-core/dist/main/index.js`。
- pre-fix 网络证据：`dist/main` 仅包含 `index.js` 与 `chunks`，`require('./trigger')` 解析失败，与现场错误一致。
- 根因：electron-vite 已将 trigger 静态打入 bundle，但通知处理又执行原生 CommonJS `require('./trigger')`；产物不存在独立 `trigger.js`。
- 修复：`game_chat` 与 `event` 改用顶部静态导入的 `getTriggerModule`。
- post-fix 构建产物中已无 `require('./trigger')`，两条通知路径均直接调用 bundle 内 `getTriggerModule()`。
- `pnpm typecheck` 与 `pnpm build` 通过；触发器测试因正在运行的 Electron 锁定 `better_sqlite3.node`，pretest 无法切换 Node ABI，未进入测试用例。
- 无 LLM 记录的第一层原因是事件在进入 TriggerModule 前失败；该问题已修复。
- post-fix 网络证据：`player_join`、`bot_respawn`、`health_low` 已成功解析 TriggerModule，`triggerReady=true`。
- 运行数据库 `event_triggers` 表为 0 条，因此匹配数恒为 0；当前没有配置任何插件事件到 LLM 的规则。
- Agent 配置 `hads` 仅包含 persona、工具、QQ 与模型配置，没有事件触发配置，且 `is_main=false`。
- 假人死亡后自动重生存在独立生命周期缺陷：`onDeathInternal` 加入重生队列但未移除 `bots` 在线索引，`respawn` 随后直接返回旧死亡实体。已在死亡入队前调用 `unregisterBot(body)`。
- Adapter Java 当前源码构建被项目已有的 Minecraft 映射错误阻塞（`Fireball`、`Sheep`、`SavedDataType` 无法解析），与本次改动无关；需使用正确映射/现有发布构建链验证。

