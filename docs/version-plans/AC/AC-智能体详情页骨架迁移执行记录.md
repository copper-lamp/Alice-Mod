# AC 智能体详情页骨架迁移执行记录

## 需求

依据《AC-智能体详情页重构实施设计》，将智能体详情页顶层结构收敛为“运行 / 设置”两个入口：运行页复用 `AgentHeader` 与 `AgentRuntimeView`，设置页复用现有 `AgentConfigForm`；移除旧信息、配置、QQ 分支及全局右侧栏。设置草稿存在未保存修改时，切换页签或离开智能体详情必须二次确认。

## 架构

`AgentInstanceView` 负责详情数据状态展示、HeroUI v3 `Tabs` compound API 接线和导航保护。`AgentHeader` 独占身份与运行控制，`AgentRuntimeView` 独占运行日志及摘要，`AgentConfigForm` 独占设置草稿并通过 `onDirtyChange` 同步 `uiStore`。确认弹窗读取 `pendingAgentNavigation`，确认或取消分别调用 Store 的继续/取消动作。`AppLayout` 只保留左侧导航、主内容和底部状态栏，运行摘要不再由全局布局承载。

## 执行

1. 重写 `components/agent/AgentInstanceView.tsx`，删除旧 `ChatPanel`、`QQPanel`、旧三 Tab、顶部删除和重复启停逻辑。
2. 使用 `Tabs.Panel` 接入运行与设置，补齐未选择、加载中、加载失败和详情缺失状态。
3. 通过 `onDirtyChange` 连接 `hasUnsavedAgentSettings`，通过 HeroUI `Modal` 处理待确认导航；删除成功后返回 `nav-view`。
4. 修改 `components/layout/AppLayout.tsx`，移除 `RightSidebar` 及相关 `aside`。
5. 运行 renderer typecheck，修复本次迁移直接引入的类型问题。
