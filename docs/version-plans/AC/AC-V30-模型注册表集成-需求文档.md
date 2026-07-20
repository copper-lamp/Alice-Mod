# Alice Mod Core V30 — 模型注册表集成

> 版本：v1.0
> 日期：2026-07-20
> 版本号：V30
> 关联文档：[AC-V6-LLMProvider.md](AC-V6-LLMProvider.md)、[AC-V16-智能体创建向导-需求文档.md](AC-V16-智能体创建向导-需求文档.md)

---

## 第1章 概述

### 1.1 模块定位

V30 重构 AC 的模型配置模块（`model-handler.ts`），解决当前硬编码模型列表不全面、新模型需要手动改代码才能支持的问题。

### 1.2 现状问题

| 问题 | 描述 | 影响范围 |
|------|------|---------|
| 模型列表硬编码 | `MODEL_CONTEXT_WINDOWS` 和 `MODEL_FC_SUPPORT` 手动维护 ~70 个模型 | 新模型发布后需修改代码才能使用 |
| 模糊匹配不可靠 | `includes()` 匹配可能误匹配（如 `qwen2.5` 匹配到 `qwen` 系列） | 自动配置错误 |
| Provider 信息硬编码 | `PROVIDER_INFO` 中的 baseUrl 和 apiKey 示例写死在代码中 | 新增 Provider 需改代码 |
| 前端 Provider 列表重复 | `ModelAddForm.tsx` 和 `ModelList.tsx` 各自维护 Provider 列表 | 两处不同步 |
| 缺失国产/新模型 | 大量国产模型（如 DeepSeek V3、Qwen3 等）和海外新模型未收录 | 用户体验差 |

### 1.3 核心变更

| 变更项 | 现状（V6/V16） | 目标（V30） |
|--------|---------------|------------|
| 模型元数据来源 | 代码内硬编码映射 | 远程注册表 + 本地 Provider 默认值 + 手动输入 |
| 新增模型 | 需改代码、重新打包 | 注册表自动更新，或用户手动输入 |
| 国产模型覆盖 | 手动维护，容易遗漏 | 注册表自动覆盖主流模型 |
| 前端 Provider 列表 | 前端组件各自维护 | 后端统一通过 `provider:full-list` 提供 |
| 配置兜底 | 无（未匹配到则返回 4096） | 三层兜底：注册表 → Provider 默认值 → 用户手动输入 |

### 1.4 功能需求总表

| 需求 ID | 需求名称 | 优先级 | 说明 |
|---------|---------|--------|------|
| V30-REQ-01 | 远程注册表拉取 | P0 | 启动时从 `models.dev/api.json` 拉取模型元数据并缓存 |
| V30-REQ-02 | 本地缓存 | P0 | 注册表数据缓存到内存及本地文件，离线可用 |
| V30-REQ-03 | Provider 级别默认值 | P0 | 注册表未覆盖时，按 Provider 返回合理默认值 |
| V30-REQ-04 | 用户手动输入 | P0 | 陌生模型允许用户手动输入 contextWindow 和 FC 支持 |
| V30-REQ-05 | 后端统一 Provider 列表 | P0 | `provider:full-list` 返回所有内置 Provider，前端不再硬编码 |
| V30-REQ-06 | 注册表定时刷新 | P1 | 每小时后台刷新一次注册表缓存 |
| V30-REQ-07 | 加载状态反馈 | P1 | 注册表首次加载时前端显示加载状态 |
| V30-REQ-08 | 手动输入时显示自动检测值 | P2 | 用户输入陌生模型名时，显示注册表/默认值供参考 |

---

## 第2章 数据流

```
用户添加模型
    │
    ▼
ModelAddForm (前端)
    │ 调用 model:auto-context { modelName }
    ▼
model-handler.ts (后端)
    │
    ├─ 1. 查注册表缓存 (Registry)
    │     ├─ 命中 → 返回 contextWindow + FC
    │     └─ 未命中 →
    │           ├─ 2. 查 Provider 默认值 (PROVIDER_DEFAULTS)
    │           │     ├─ 命中 → 返回默认值
    │           │     └─ 未命中 → 返回 4096 / true
    │           └─ 前端显示 "未检测到自动配置，请手动填写"
    │
    ▼
用户确认 → 保存到 SQLite
    │
    ▼
ModelList (前端) 展示已有模型
```

---

## 第3章 验收标准

| 验收项 | 预期结果 |
|--------|---------|
| 启动时拉取注册表 | 应用启动后自动拉取 `models.dev/api.json` |
| 注册表命中 | 输入 `gpt-5.2`，自动返回正确的 contextWindow 和 FC |
| Provider 默认值命中 | 输入 `doubao-pro-256k`，注册表未收录，回退到 `doubao` 默认值 |
| 完全未知模型 | 输入 `my-custom-model`，返回默认值 4096/true，前端显示"手动填写"提示 |
| 离线启动 | 注册表拉取失败，使用本地缓存或 Provider 默认值，不影响功能 |
| Provider 列表同步 | 前端 Provider 下拉框与后端 `provider:full-list` 一致 |