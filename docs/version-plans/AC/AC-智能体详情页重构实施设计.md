# AC 智能体详情页重构实施设计

> 状态：已确认，待实施
>
> 目标：按照已确认的 Web 预览重构智能体详情页。实现必须使用 HeroUI v3，保持项目现有灰白配色，不增加新的品牌色，不堆叠黑色边框，并保证现有功能完整迁移。

## 一、需求

### 1. 重构范围

本次重构覆盖智能体详情页完整工作区，而非只调整顶部标题栏：

* 智能体身份与运行控制。

* “运行 / 设置”顶层导航。

* 游戏与 QQ 统一运行日志。

* 可折叠对话渠道栏。

* 可折叠运行摘要。

* 主智能体与 QQ 的统一设置页。

* 保存、放弃、启停、上线、清空历史、删除等完整交互。

* 加载、空、失败、处理中和未保存状态。

* 相关 Store、IPC 包装和必要主进程错误返回修正。

不修改：

* 智能体创建向导。

* 全局左侧主导航的信息结构。

* 桌面端主动聊天能力。

* 不存在于后端的 QQ 群聊/私聊细粒度会话能力。

* 无关页面的视觉样式。

### 2. 页面信息结构

页面只保留一个导航层级：

```text
智能体详情
├─ 紧凑身份栏
├─ 运行（默认）
│  ├─ 对话渠道栏
│  ├─ 统一日志区
│  └─ 运行摘要
└─ 设置
   ├─ 基本与模型
   ├─ 人设与能力
   ├─ 连接与自动化
   └─ 危险操作
```

必须移除：

* “信息 / 配置 / QQ”三级顶层入口。

* QQ 页面内部“对话 / 配置”二级页签。

* QQ 配置内部“基本 / 定时 / 工具 / 技能 / 偏好 / 设定”左侧导航。

* 无实际功能的“偏好”占位页。

### 3. 功能完整性

#### 3.1 身份与运行控制

必须保留：

* 头像或名称首字占位。

* 智能体名称。

* 启用/禁用状态与操作。

* 最后活跃时间。

* QQ 在线、连接中、离线状态。

* 假人在线、离线状态。

* 假人上线、下线。

体验要求：

* 状态只用 HeroUI `Chip` 展示，不伪装成按钮。

* 启用/禁用使用带明确文字和无障碍名称的 HeroUI `Switch`。

* 上线/下线使用 HeroUI `Button`，因为它是运行命令而不是设置开关。

* 操作中禁止重复提交。

* 失败时恢复原状态，并使用 Toast 显示原因。

#### 3.2 运行日志

必须保留：

* 主智能体历史记录。

* QQ 专属历史记录。

* 全部、游戏、QQ 三种来源。

* 用户、系统、智能体和工具结果消息。

* 思考过程。

* 工具参数、结果、错误和耗时。

* 流式输出。

* 每 5 秒增量检查。

* 历史分页。

* 手动刷新。

* LLM 响应中状态。

* QQ 历史清空。

新增的前端体验：

* 来源切换不再改变页面，只筛选日志。

* 类型筛选为“全部 / 消息 / 工具 / 系统”。

* 自动跟随开启时定位到最新事件。

* 用户向上滚动查看历史时自动暂停跟随。

* “加载更早记录”放在列表顶部。

* QQ 历史清空必须二次确认，后端成功后才清空前端列表。

* 数据失败显示可重试错误，不得显示成“暂无日志”。

数据约束：

* 当前实时事件没有可靠的渠道字段，因此第一阶段仅在“全部”来源实时追加流式内容。

* “游戏”或“QQ”来源在流式完成后刷新对应历史，禁止在前端猜测来源。

* 渠道栏第一阶段只提供“全部 / 游戏 / QQ”，不虚构具体群聊和私聊。

#### 3.3 运行摘要

必须迁移现有右侧栏能力：

* 上下文窗口占用。

* Token 用量。

* 最近七日用量。

* 待办事项。

说明：当前部分统计是工作区或全局维度，界面文案不得宣称全部数据均为当前智能体独占。

布局要求：

* 宽屏默认展开。

* 中等宽度默认收起。

* 窄宽度隐藏为可恢复的摘要入口。

* 摘要只允许展开/收起，不增加内部导航。

#### 3.4 设置页

所有配置由一个表单草稿统一管理，并一次保存。

**基本与模型**

* 名称。

* 头像。

* 主模型。

* 压缩模型。

* 添加模型入口。

**人设与能力**

* 身份描述。

* 个性特征。

* 主工具启用摘要。

* 主技能启用/禁用。

* 主系统提示词只读预览。

**连接与自动化**

* 启用 QQ。

* QQ 账号。

* 绑定群组。

* 仅 @ 触发。

* QQ 模型跟随主模型或独立选择。

* QQ 人设跟随主智能体或独立配置。

* QQ 工具跟随主智能体或独立配置。

* QQ 技能跟随主智能体或独立配置。

* 定时触发：关闭、Cron、固定间隔、随机时段、时区、触发提示词。

**危险操作**

* 删除智能体。

* 删除入口只出现在设置页底部。

* 使用 HeroUI `Modal` 或经当前版本验证可用的 `AlertDialog`。

* 删除失败时保留弹窗和当前页面。

表单交互要求：

* 顶部固定显示“放弃修改 / 保存更改”。

* 存在修改时显示未保存状态。

* 放弃修改恢复最近一次成功保存的数据。

* 保存失败保留草稿。

* 从设置切换到运行或其他智能体前，存在未保存修改时必须确认。

* QQ 系统提示词编辑弹窗中的确认按钮命名为“应用到表单”；只有设置页“保存更改”代表持久化。

### 4. HeroUI 强制要求

项目当前使用：

* `@heroui/react 3.0.0-rc.1`

* `@heroui/styles 3.0.0-rc.1`

* Tailwind CSS v4

* React 19

实现必须沿用 HeroUI v3 compound API，不套用 v2 示例。

| 场景            | HeroUI 组件                       |
| ------------- | ------------------------------- |
| 运行 / 设置导航     | `Tabs` + `Tabs.Panel`           |
| 操作按钮          | `Button`                        |
| 图标操作          | `Button isIconOnly` + `Tooltip` |
| 状态标签          | `Chip`                          |
| 启用、继承、自动跟随    | `Switch`                        |
| 日志类型筛选        | `ToggleButtonGroup`             |
| 渠道栏、运行摘要、高级设置 | `Disclosure`                    |
| 页面和分组容器       | `Surface`、`Card`                |
| 长列表滚动提示       | `ScrollShadow`                  |
| 删除与清空确认       | `Modal` 或验证后的 `AlertDialog`     |
| 页面持续错误        | `Alert`                         |
| 短暂成功与失败反馈     | `toast`                         |
| 加载和上下文占用      | `ProgressBar`                   |

禁止：

* 为已有 HeroUI 对应能力继续编写原生 `<button>`。

* 自制 fixed 遮罩弹窗。

* 只有 `title`、没有 `aria-label` 的图标按钮。

* 移除焦点轮廓却不提供 `focus-visible` 替代样式。

* 使用原生按钮模拟页签、开关或折叠控件。

### 5. 视觉与排版约束

#### 5.1 配色

保持现有应用灰白配色和 HeroUI 默认语义色：

* 页面背景：`background`。

* 主容器：`surface`。

* 次级容器：`surface-secondary` 或低透明灰底。

* 主文字：`foreground`。

* 辅助文字：`muted`。

* 普通边界：`border`。

* 弱分隔：`separator`。

* 成功、警告、错误仅使用 `success / warning / danger`。

不得：

* 更换项目品牌配色。

* 新增第二套高饱和主色。

* 用大面积绿色、橙色或红色背景表示普通状态。

* 在组件中继续堆叠 `gray-* / blue-* / green-* / red-*` 硬编码；优先使用 HeroUI 语义 token。

#### 5.2 边框与层次

“不要黑线太多”的具体执行规则：

1. 页面主 Surface 不使用黑色边框。
2. 卡片最多使用一层浅色边界或轻阴影，禁止边框和重阴影同时叠加。
3. 删除设置页连续 `<hr>`。
4. 不为每个字段单独套描边卡片。
5. 顶部身份栏、导航栏和工具栏只保留必要的 `separator`。
6. 渠道选中使用浅色背景和文字权重，不使用黑色描边。
7. 日志消息主要依靠背景明度、间距和角色标签区分。
8. 危险区域使用普通浅边界，危险语义由标题、Alert 和危险按钮表达。

#### 5.3 排版层级

全页最多三级文字层级：

1. 页面身份标题。
2. 设置分段标题或日志区标题。
3. 字段标题、状态说明和日志元信息。

禁止同时出现“页签 + 左侧设置导航 + 手风琴”的多重层级。

#### 5.4 尺寸统一

* 常规操作按钮：`size="sm"`，视觉高度约 32px。

* 图标按钮：`isIconOnly size="sm"`。

* 常规圆角：HeroUI `md`，约 8px。

* 工具栏操作间距：8px。

* 身份头像：36×36px。

* 渠道栏展开：200–220px。

* 渠道栏收起：44–48px。

* 运行摘要展开：约 220–260px，根据现有主区域宽度自适应。

### 6. 验收标准

1. 页面只有“运行 / 设置”一排顶层导航。
2. 默认进入运行页。
3. QQ 不再拥有独立页面和配置子导航。
4. 渠道栏可收起，收起后日志自然占据释放空间。
5. 设置页只有四个主要分段。
6. 所有现有主/QQ 配置均可读取、修改、放弃和保存。
7. 定时触发只存在一个入口。
8. 删除入口只存在于设置页底部。
9. 所有操作使用 HeroUI，不新增同类自制组件。
10. 页面保持现有灰白配色，不出现大量黑色分隔线。
11. 保存、启停、上线、删除、清空均有 pending、成功和失败反馈。
12. 切换智能体不显示上一个智能体的详情。
13. 加载失败与真正空状态可明确区分。
14. 宽屏、中宽和窄宽布局均可使用。

## 二、架构

### 1. 目标组件树

```text
AgentInstanceView
├─ AgentHeader
├─ Tabs
│  ├─ Tabs.Panel(runtime)
│  │  └─ AgentRuntimeView
│  │     ├─ ChannelRail
│  │     ├─ RuntimeToolbar
│  │     ├─ UnifiedLogPanel
│  │     │  └─ MessageList
│  │     │     ├─ MessageBubble
│  │     │     ├─ ThinkingBlock
│  │     │     └─ ToolCallBlock
│  │     └─ RuntimeSummary
│  └─ Tabs.Panel(settings)
│     └─ AgentConfigForm
│        ├─ BasicModelSection
│        ├─ PersonaCapabilitySection
│        ├─ ConnectionAutomationSection
│        └─ DangerZone
└─ UnsavedChangesDialog
```

### 2. 文件处置

#### 2.1 必须修改

* `components/agent/AgentInstanceView.tsx`

* `components/agent/AgentConfigForm.tsx`

* `components/chat/ChatPanel.tsx`

* `components/chat/MessageList.tsx`

* `components/chat/MessageBubble.tsx`

* `components/layout/AppLayout.tsx`

* `components/agent/sections/QQBindSection.tsx`

* `components/agent/sections/ScheduleSection.tsx`

* `stores/uiStore.ts`

* `stores/agentStore.ts`

* `lib/types.ts`

* `lib/ipc.ts`

#### 2.2 建议新增

运行模块：

* `components/agent/AgentHeader.tsx`

* `components/agent/runtime/AgentRuntimeView.tsx`

* `components/agent/runtime/ChannelRail.tsx`

* `components/agent/runtime/RuntimeToolbar.tsx`

* `components/agent/runtime/RuntimeSummary.tsx`

* `hooks/useAgentLogs.ts`

设置模块：

* `components/agent/settings/BasicModelSection.tsx`

* `components/agent/settings/PersonaCapabilitySection.tsx`

* `components/agent/settings/ConnectionAutomationSection.tsx`

* `components/agent/settings/DangerZone.tsx`

* `components/agent/settings/ToolSelectionList.tsx`

* `components/agent/settings/SkillSelectionList.tsx`

新增文件必须保持单一职责，不将原有超大表单机械拆成无意义的包装组件。

#### 2.3 迁移后删除

* `components/agent/QQPanel.tsx`

* `components/agent/QQChatPanel.tsx`

* `components/agent/QQConfigForm.tsx`

* `components/layout/RightSidebar.tsx`

删除必须在功能迁移、引用清理和验证完成后进行，不先删后补。

### 3. 状态归属

#### 3.1 `uiStore`

只保存跨组件导航状态：

* `agentViewTab: 'runtime' | 'settings'`。

* 当前是否存在未保存设置。

* 待确认的导航目标。

删除：

* `showRightSidebar`，因为运行摘要改为运行页局部组件。

* 旧 `info / config / qq` Tab 值。

不得放入 `uiStore`：

* 日志数组。

* 设置草稿。

* 渠道栏折叠状态。

* 摘要折叠状态。

* 日志筛选状态。

#### 3.2 `agentStore`

负责真实智能体数据：

* 智能体摘要列表。

* 当前智能体 ID。

* 当前智能体完整配置。

* 加载与错误状态。

* 获取、创建、更新、删除、启停操作。

必须修复：

* 切换 ID 时立即清空旧 `currentAgent`。

* 防止旧请求晚返回覆盖新智能体。

* 更新和删除失败必须向调用方抛出错误。

* 更新成功后同步详情和左侧摘要。

* 删除成功后同时清理 ID 和详情。

#### 3.3 `AgentConfigForm`

独占设置草稿：

```text
currentAgent
  → normalizeAgentConfig
  → initialForm + form
  → 子分段受控修改
  → dirty 比较
  → 单次 updateAgent
  → 后端真实结果回填 initialForm + form
```

子分段只接收 `value/onChange`，不得直接调用 Store 或 IPC。

#### 3.4 `AgentRuntimeView`

持有局部 UI 状态：

* `source: all | game | qq`。

* `typeFilter: all | message | tool | system`。

* 渠道栏展开状态。

* 摘要展开状态。

* 自动跟随状态。

* 清空 QQ 历史确认状态。

日志数据由 `useAgentLogs` 统一管理。

### 4. 统一日志数据流

```text
AgentRuntimeView
  → useAgentLogs(agentId, workspaceId)
     ├─ chatApi.history(game/main)
     ├─ chatApi.qqHistory
     ├─ chatApi.onStreamEvent
     ├─ 5 秒增量刷新
     ├─ 合并、去重、排序
     └─ clearQQHistory
  → 根据 source/typeFilter 生成显示列表
  → UnifiedLogPanel
  → MessageList
```

#### 4.1 全部来源

并行获取主历史和 QQ 历史，按 ID 去重并按时间升序合并。

#### 4.2 游戏来源

扩展 `chatApi.history` 的 options 参数并传入 `source: 'game'`。

#### 4.3 QQ 来源

继续使用现有 `chat:qq-history`，兼容已有 QQ 存储结构。

#### 4.4 流式事件

第一阶段：

* 仅“全部”来源实时展示无法识别渠道的流式事件。

* 收到 `done` 后刷新当前选中来源。

* `done.data.error` 必须显示错误反馈。

后续若主进程事件补充 `source`，Hook 可无损升级为分渠道实时展示。

### 5. 设置数据模型

继续使用现有 `AgentConfig`，不为页面重排新增另一套持久化模型。

初始化必须完整保留：

* `name / alias / skinData`

* `persona / personaPresetId`

* `tools / skills`

* `llmConfig`

* `qqBinding / qqPersona / qqTools / qqSkills`

* `schedule`

* `enabled`

* 其他当前页面未编辑但后端需要保留的字段

禁止逐字段构造一个不完整对象后覆盖后端配置。使用规范化深拷贝，只补默认值，不丢未知字段。

### 6. IPC 与错误契约

所有新增调用集中到 `lib/ipc.ts`，组件不新增裸 `window.electronAPI.invoke`。

统一 mutation 返回：

```ts
interface IpcMutationResult<T = undefined> {
  success: boolean
  data?: T
  error?: string
}
```

前端包装层遇到 `success: false` 时抛出 `Error`，Store 和组件通过正常 `try/catch` 处理。

需要覆盖：

* `agent:update`

* `agent:delete`

* `agent:set-enabled`

* `agent:bot-control`

* `chat:clear-qq-history`

历史查询异常不得在主进程静默转换为空数组，否则前端无法区分空状态与错误状态。应改为抛出异常或返回统一结果。

### 7. HeroUI 交互规范

* 所有 HeroUI Button 使用 `onPress`。

* 异步按钮使用 `isPending` 与 `isDisabled`。

* `Tabs` 必须配套 `Tabs.Panel`，不在外部手工条件渲染面板。

* `Switch` 必须提供对象明确的 `aria-label`。

* 图标按钮必须同时具备 `aria-label` 和 `Tooltip`。

* `Tooltip` 只补充说明，不承担唯一可访问名称。

* `Modal` 使用 `Modal.Heading` 建立标题关系。

* 删除失败时弹窗不关闭。

* 长内容使用 `ScrollShadow`，同时保留 `flex-1 min-h-0` 滚动约束。

* Toast 用于短暂结果，Alert 用于持续影响当前页面的错误或风险。

* 所有焦点样式使用 HeroUI 默认 focus ring，不主动移除。

### 8. 响应式布局

#### 宽屏

```text
渠道栏 210px | 日志主体自适应 | 运行摘要 240px
```

#### 中等宽度

```text
渠道栏 48px | 日志主体自适应 | 摘要收起
```

#### 窄宽度

* 渠道栏保持 44–48px 图标轨道。

* 运行摘要通过按钮打开 Drawer 或临时 Surface。

* 顶部隐藏非关键状态描述，但保留状态文本可访问性。

* 设置字段从双列改为单列。

* 不横向压缩日志消息正文。

## 三、执行

### 阶段 1：数据正确性和错误基础

修改：

* `stores/agentStore.ts`

* `lib/ipc.ts`

* `lib/types.ts`

* 必要的主进程 IPC Handler

执行内容：

1. 切换智能体时清除旧详情并增加请求竞态保护。
2. Mutation 检查 `success`，失败时抛出业务错误。
3. 更新成功后刷新详情与摘要列表。
4. 删除成功后清空当前 ID 与详情；失败时保持页面。
5. 为启用、上线、清空 QQ 历史增加统一 IPC 包装。
6. 历史查询失败不再返回伪空数组。
7. 增加运行 Tab、日志来源和日志类型 TypeScript 类型。

完成条件：数据切换、保存、删除和运行控制不会再产生“UI 显示成功但后端失败”。

### 阶段 2：统一日志能力

修改或新增：

* `hooks/useAgentLogs.ts`

* `components/chat/ChatPanel.tsx`

* `components/chat/MessageList.tsx`

* `components/chat/MessageBubble.tsx`

执行内容：

1. 合并主日志和 QQ 日志的加载、轮询、订阅、分页逻辑。
2. 全部来源并行查询并去重排序。
3. 游戏、QQ 来源使用真实 API 筛选。
4. 处理 `done.data.error`。
5. 自动跟随仅在开启且用户位于底部时执行。
6. 历史加载入口移到顶部。
7. 错误、空状态和旧数据刷新失败分别展示。
8. 清空 QQ 历史只在成功后刷新列表。

完成条件：统一 Hook 能在旧页面结构下独立通过主/QQ日志功能验证。

### 阶段 3：运行页组件化

新增：

* `AgentHeader.tsx`

* `runtime/AgentRuntimeView.tsx`

* `runtime/ChannelRail.tsx`

* `runtime/RuntimeToolbar.tsx`

* `runtime/RuntimeSummary.tsx`

执行内容：

1. 实现紧凑身份栏和运行控制。
2. 实现可折叠渠道栏。
3. 使用 HeroUI `ToggleButtonGroup` 实现日志类型筛选。
4. 使用 HeroUI `Switch` 实现自动跟随。
5. 迁移现有右侧上下文、用量和待办能力。
6. 实现宽、中、窄三档布局。
7. 所有异步交互接入 Toast 或 Alert。

完成条件：运行页具备预览稿的结构、样式和完整功能。

### 阶段 4：页面骨架切换

修改：

* `AgentInstanceView.tsx`

* `AppLayout.tsx`

* `uiStore.ts`

* `lib/types.ts`

执行内容：

1. 顶层改为 HeroUI `Tabs` 的“运行 / 设置”。
2. 使用 `Tabs.Panel` 承载对应页面。
3. 默认 Tab 改为 `runtime`。
4. 删除旧 QQ 顶层入口。
5. 从全局布局移除常驻 `RightSidebar`。
6. 运行摘要只在运行页内部出现。
7. 接入未保存设置的导航保护入口。

完成条件：页面不存在第二层页签，设置页不再被全局右栏挤压。

### 阶段 5：统一设置页

修改或新增：

* `AgentConfigForm.tsx`

* `settings/*`

* `sections/QQBindSection.tsx`

* `sections/ScheduleSection.tsx`

执行内容：

1. 建立完整 `initialForm/form` 草稿。
2. 按四个分段迁移所有主智能体配置。
3. 将 QQ 模型、绑定、人设、工具和技能迁入连接与自动化。
4. 定时触发只保留一个受控组件。
5. 移除空“偏好”和六项左侧导航。
6. 增加 dirty 检测、放弃修改、保存和离开确认。
7. QQ 提示词编辑改用 HeroUI Modal，并将按钮改为“应用到表单”。
8. 删除智能体迁移到 DangerZone。
9. 删除连续 `<hr>` 和多余描边。

完成条件：一个设置页面可以完整读取、编辑、放弃和保存所有现有配置。

### 阶段 6：删除旧实现

确认无引用后删除：

* `QQPanel.tsx`

* `QQChatPanel.tsx`

* `QQConfigForm.tsx`

* `layout/RightSidebar.tsx`

清理：

* 旧 `info / config / qq` 类型值。

* 未使用 import。

* 重复定时表单。

* 手写弹窗。

* 原生图标按钮。

完成条件：代码库没有旧页面死代码或重复业务实现。

### 阶段 7：视觉统一

1. 将页面灰色硬编码逐步收敛到 HeroUI 语义 token。
2. Button、Chip、Switch、Card、Alert、Modal 使用统一 variant。
3. 删除多余 `border-b / border-r / <hr>`。
4. 卡片通过浅灰背景、留白和轻阴影建立层级。
5. 渠道选中只使用柔和背景，不使用黑框。
6. 状态色限制在 Chip、图标和短反馈区域。
7. 检查 HarmonyOS Sans SC 字体和现有全局淡入动画。
8. 为 `prefers-reduced-motion` 降低非必要动画。

完成条件：页面与应用其他模块风格一致，灰白配色不变，视觉上没有密集黑线。

### 阶段 8：验证

#### 静态验证

* TypeScript 类型检查。

* VS Code diagnostics。

* HeroUI v3 API 与当前 `3.0.0-rc.1` 类型一致。

* 无旧组件引用。

* 无未使用 import。

#### 自动验证

* `pnpm --filter @mcagent/agent-core typecheck`

* `pnpm --filter @mcagent/agent-core test`

* `pnpm --filter @mcagent/agent-core build`

#### 功能验证

* 切换智能体，不显示旧详情。

* 启用/禁用及失败回滚。

* 上线/下线及失败反馈。

* 全部、游戏、QQ 日志切换。

* 日志类型筛选。

* 流式输出和错误完成事件。

* 历史分页和自动跟随。

* QQ 历史清空成功与失败。

* 运行摘要加载、部分失败和重试。

* 四段设置完整回显。

* 放弃修改。

* 保存成功与失败。

* 未保存修改离开确认。

* 删除成功与失败。

#### 视觉验证

* 宽屏、中宽、窄宽。

* 渠道栏展开与收起。

* 运行摘要展开与收起。

* 设置页双列与单列。

* 灰白配色未改变。

* 不出现密集黑色边框。

* 同类按钮尺寸、圆角和 variant 一致。

* 状态 Chip 与按钮视觉语义明确分离。

#### 无障碍验证

* Tabs 方向键导航。

* 图标按钮可读名称。

* Switch 可读标签。

* Modal 焦点圈闭与关闭后焦点恢复。

* 键盘可完成运行/设置切换、筛选、保存和确认。

* Focus ring 可见。

* 状态不只依赖颜色表达。

## 四、实施约束

1. 按阶段实施，每阶段保持可运行，不进行一次性大爆炸替换。
2. 先迁移功能再删除旧组件。
3. 不创建与 HeroUI 重复的基础组件库。
4. 不为了视觉重构改动无关后端逻辑。
5. 如果 HeroUI RC.1 某组件 API 与文档不一致，以本地类型定义和现有可编译用法为准。
6. 随机定时模式只有在主进程补齐执行逻辑后才作为“功能完整”交付；否则界面必须明确标记不可用，不能保存后静默不执行。
7. 每个新模块保持单一职责，避免重新形成超大组件。

