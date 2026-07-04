# McAgent — Minecraft AI Agent 框架

> 让大语言模型像真人玩家一样思考、规划和执行，在 Minecraft 世界中自主完成从挖矿建造到全物品备货的复杂任务。
>
> **版本**：v1.0.0（开发中） · **迭代**：V1（项目初始化阶段）
> **架构**：Agent Core + TCP Bridge + Adapter Core 三层解耦

---

## 目录

- [1. 项目概述](#1-项目概述)
- [2. 快速导航](#2-快速导航)
- [3. 文档体系总览](#3-文档体系总览)
- [4. 开发环境准备](#4-开发环境准备)
- [5. 开发工作流](#5-开发工作流)
- [6. 版本路线](#6-版本路线)
- [7. 快速开始](#7-快速开始)
- [8. 代码仓库结构](#8-代码仓库结构)
- [9. 常见问题](#9-常见问题)

---

## 1. 项目概述

### 1.1 一句话定位

McAgent 是一个通用的 Minecraft AI Agent 框架，通过大语言模型（LLM）驱动游戏内假人，实现从感知、决策到执行的完整闭环。

### 1.2 系统架构

```
                         McAgent 系统
                              │
          ┌───────────────────┴───────────────────┐
          ▼                                        ▼
┌─────────────────────────────┐   ┌─────────────────────────────┐
│         Agent Core          │   │      Adapter Core           │
│      智能体核心桌面应用        │   │      接入核心（模组）         │
│                             │   │                             │
│  · UI 界面 (React)          │   │  ┌───────┬───────────────┐  │
│  · LLM 调度 (多 Provider)   │   │  │  BE   │      JE       │  │
│  · 提示词系统                │   │  │基岩版  │   Java 版     │  │
│  · 工作区管理                │   │  └───────┴───────────────┘  │
│  · TCP 服务端               │   │  · TCP 客户端                │
│  · 记忆系统 (SQLite+Chroma)  │   │  · 工具注册                  │
│  · QQ 机器人 (OneBot)       │   │  · 假人管理                  │
│  · 事件触发器                │   │  · 状态上报                  │
│  · 任务规划 (优先级队列)      │   │  · 执行AI 引擎               │
│  · 日志系统                  │   │  · 26 个工具                │
│  · 17 个工具                │   │  · 数据持久化                │
└──────────────┬──────────────┘   └──────────────┬──────────────┘
               │ TCP (JSON-RPC 2.0)               │
               └──────────────────────────────────┘

                         ┌──────────────┐
                         │  Shared 库   │
                         │ (类型定义/    │
                         │  ToolSchema/ │
                         │  常量/校验工具)│
                         └──────────────┘
```

### 1.3 核心数据

| 指标 | 数值 |
|------|------|
| **开发模块** | 3 个（Agent Core / Adapter BE / Adapter JE） |
| **工具总数** | **43 个**（精简自 111 个） |
| **版本迭代** | **15 个版本**，5 个阶段，约 20 周 |
| **团队规模** | **6 人**（每模块 2 人并行） |
| **支持版本** | 基岩版（LeviLamina）+ Java 版（Fabric） |
| **通信协议** | TCP 长连接 + JSON-RPC 2.0 + Batch 扩展 |

### 1.4 设计原则

| 原则 | 说明 |
|------|------|
| **LLM 不处理细节** | 移动、跳跃、视角等由执行AI 自动处理 |
| **上下文精简** | 只注入基础状态（~150 tokens），环境感知靠工具调用 |
| **工具粒度适中** | 一个工具 = 一个"动作"，不是"脚本" |
| **有反馈** | 工具返回执行结果（成功/失败/详情/耗时/消耗） |
| **可失败** | 工具可能失败，LLM 需处理异常 |
| **有成本** | 操作消耗时间、饥饿、耐久等资源 |

---

## 2. 快速导航

### 2.1 按角色导航

#### 我是 Agent Core 开发者

```
┌─ 必读 ─────────────────────────────────────────────┐
│  1. docs/00-顶层设计.md               — 整体架构    │
│  2. docs/02-模块划分与功能简介.md       — 模块职责    │
│  3. docs/version-plans/AC/AC-01-需求文档.md  — 需求  │
│  4. docs/version-plans/AC/AC-02-实施计划.md  — 实施  │
│  5. docs/version-plans/AC/AC-03-规范与验收标准.md    │
│  6. docs/api/01-LLM抽象层接口规范.md     — LLM接口   │
│  7. docs/api/04-任务系统接口规范.md      — 任务接口   │
│  8. docs/standards/01-代码规范与风格指南.md          │
├─ 参考 ─────────────────────────────────────────────┐
│  9. docs/api/03-记忆系统接口规范.md      — 记忆接口   │
│ 10. docs/protocols/01-通信协议规范.md    — TCP协议   │
│ 11. docs/deploy/01-Agent-Core部署指南.md            │
└─────────────────────────────────────────────────────┘
```

#### 我是 Adapter Core BE 开发者

```
┌─ 必读 ─────────────────────────────────────────────┐
│  1. docs/00-顶层设计.md               — 整体架构    │
│  2. docs/02-模块划分与功能简介.md       — 模块职责    │
│  3. docs/version-plans/BE/BE-01-需求文档.md  — 需求  │
│  4. docs/version-plans/BE/BE-02-实施计划.md  — 实施  │
│  5. docs/version-plans/BE/BE-03-规范与验收标准.md    │
│  6. docs/api/02-执行AI接口规范.md       — 执行AI接口  │
│  7. docs/tools/15-执行层开发规划.md      — 开发路线   │
│  8. docs/standards/01-代码规范与风格指南.md          │
├─ 参考 ─────────────────────────────────────────────┐
│  9. docs/protocols/01-通信协议规范.md    — TCP协议   │
│ 10. docs/deploy/02-Adapter-Core基岩版部署指南.md     │
│ 11. docs/tools/06-移动工具设计.md        — 工具设计   │
│ 12. docs/tools/07-背包与装备工具设计.md              │
└─────────────────────────────────────────────────────┘
```

#### 我是 Adapter Core JE 开发者

```
┌─ 必读 ─────────────────────────────────────────────┐
│  1. docs/00-顶层设计.md               — 整体架构    │
│  2. docs/02-模块划分与功能简介.md       — 模块职责    │
│  3. docs/version-plans/JE/JE-01-需求文档.md  — 需求  │
│  4. docs/version-plans/JE/JE-02-实施计划.md  — 实施  │
│  5. docs/version-plans/JE/JE-03-规范与验收标准.md    │
│  6. docs/api/02-执行AI接口规范.md       — 执行AI接口  │
│  7. docs/tools/15-执行层开发规划.md      — 开发路线   │
│  8. docs/standards/01-代码规范与风格指南.md          │
├─ 参考 ─────────────────────────────────────────────┐
│  9. docs/protocols/01-通信协议规范.md    — TCP协议   │
│ 10. docs/deploy/03-Adapter-Core-Java版部署指南.md    │
│ 11. docs/tools/06-移动工具设计.md        — 工具设计   │
│ 12. docs/tools/07-背包与装备工具设计.md              │
└─────────────────────────────────────────────────────┘
```

### 2.2 按任务导航

| 我要做什么 | 需要看的文档 |
|-----------|-------------|
| 了解项目全貌 | `00-顶层设计.md` + `02-模块划分与功能简介.md` |
| 开始开发 | 按角色导航的必读文档 |
| 编写代码 | `standards/01-代码规范与风格指南.md` |
| 提交代码 | `standards/02-Git工作流规范.md` |
| 编写测试 | `standards/03-测试规范.md` |
| 部署运行 | `deploy/01~04` 按模块选择 |
| 查看当前版本任务 | `version-plans/{AC/BE/JE}/-02-实施计划.md` |
| 了解通信协议 | `protocols/01-通信协议规范.md` |
| 了解工具设计 | `tools/05~14` 按类别选择 |

---

## 3. 文档体系总览

全部文档位于 `docs/` 目录，按以下体系组织：

```
docs/
├── 00-顶层设计.md                      ★ 项目总入口
├── 02-模块划分与功能简介.md             ★ 模块职责与依赖
├── 03-版本计划与迭代路线图.md           ★ 15版本路线
│
├── protocols/                          ─ 通信协议
│   └── 01-通信协议规范.md              ★ JSON-RPC 2.0
│
├── api/                                ─ 接口规范
│   ├── 01-LLM抽象层接口规范.md         ★ LLM Provider/Router/Pipeline
│   ├── 02-执行AI接口规范.md            ★ IToolModule/Bot 接口
│   ├── 03-记忆系统接口规范.md          ☆ MemoryManager + 地图索引
│   └── 04-任务系统接口规范.md          ★ TaskManager/Scheduler/Executor
│
├── tools/                              ─ 工具详细设计
│   ├── 05-感知系统设计.md              ☆ 5个工具设计
│   ├── 06-移动工具设计.md              ☆ 3个工具设计
│   ├── 07-背包与装备工具设计.md        ☆ 4个工具设计
│   ├── 08-生物交互工具设计.md          ☆ 4个工具设计
│   ├── 09-生存与状态工具设计.md        ☆ 3个工具设计
│   ├── 10-方块与物品工具设计.md        ☆ 4个工具设计
│   ├── 11-对话与社交工具设计.md        ☆ 3个工具设计
│   ├── 12-QQ外部连接工具设计.md        ☆ 2个工具设计
│   ├── 13-学习与记忆工具设计.md        ☆ 8个工具设计
│   ├── 14-任务与目标规划工具设计.md     ☆ 7个工具设计
│   ├── 15-执行层开发规划.md            ★ 执行AI开发路线
│   └── 工具精简清单-提案.md            ☆ 111→43 合并说明
│
├── standards/                          ─ 开发规范
│   ├── 01-代码规范与风格指南.md        ★ 编码/命名/异常规范
│   ├── 02-Git工作流规范.md             ★ Conventional Commits
│   └── 03-测试规范.md                  ★ Vitest/JUnit 5 测试
│
├── deploy/                             ─ 部署运维
│   ├── 01-Agent-Core部署指南.md        ☆ Electron 桌面应用部署
│   ├── 02-Adapter-Core基岩版部署指南.md ☆ LeviLamina 插件部署
│   ├── 03-Adapter-Core-Java版部署指南.md ☆ Fabric 模组部署
│   └── 04-QQ机器人配置指南.md          ☆ NapCat + OneBot 配置
│
└── version-plans/                      ─ 版本实施计划（9个文档）
    ├── AC/
    │   ├── AC-01-需求文档.md           ★ Agent Core 15版本需求
    │   ├── AC-02-实施计划.md           ★ Agent Core 实施任务分解
    │   └── AC-03-规范与验收标准.md     ★ AC 验收条件
    ├── BE/
    │   ├── BE-01-需求文档.md           ★ BE 15版本需求
    │   ├── BE-02-实施计划.md           ★ BE 实施任务分解
    │   └── BE-03-规范与验收标准.md     ★ BE 验收条件
    └── JE/
        ├── JE-01-需求文档.md           ★ JE 15版本需求
        ├── JE-02-实施计划.md           ★ JE 实施任务分解
        └── JE-03-规范与验收标准.md     ★ JE 验收条件

★ = 必须阅读  ☆ = 按需参考
```

### 文档说明

| 文档类型 | 解决什么问题 | 典型的读者 |
|----------|-------------|-----------|
| **顶层设计** | "这个项目是做什么的？" | 所有角色 |
| **模块划分** | "哪些模块？各自做什么？" | 所有角色 |
| **协议规范** | "模块之间怎么通信？" | AC + BE/JE 开发者 |
| **接口规范** | "我要实现/调用什么接口？" | 各模块开发者 |
| **工具设计** | "这个工具的参数/行为是什么？" | BE/JE 开发者 |
| **开发规范** | "代码怎么写？测试怎么写？" | 所有开发者 |
| **部署指南** | "怎么安装和运行？" | 运维/用户 |
| **版本计划** | "当前版本做什么？" | 所有开发者 |

---

## 4. 开发环境准备

### 4.1 通用工具

| 工具 | 版本要求 | 用途 |
|------|----------|------|
| Git | ≥ 2.30 | 版本控制 |
| VS Code | ≥ 1.85 | 推荐 IDE |
| pnpm | ≥ 8.0 | 包管理（Monorepo） |

### 4.2 Agent Core 环境

| 依赖 | 版本要求 | 验证命令 |
|------|----------|----------|
| Node.js | ≥ 20.0 LTS | `node --version` |
| TypeScript | ≥ 5.4 | `tsc --version` |
| SQLite | ≥ 3.x | 系统自带或 better-sqlite3 |
| Chroma | ≥ 0.4 | 向量数据库（可选，可用 SQLite 兜底） |

**VS Code 扩展**：ESLint、Prettier、Jest Runner、SQLite Viewer

### 4.3 Adapter Core BE 环境

| 依赖 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | ≥ 20.0 LTS | BDS 插件运行时 |
| BDS | 1.21.x | 基岩版专用服务器 |
| LeviLamina | ≥ 0.12.x | BDS 插件加载器 |
| better-sqlite3 | ≥ 11.0 | 本地数据库 |

**安装指引**：详见 [docs/deploy/02-Adapter-Core基岩版部署指南.md](docs/deploy/02-Adapter-Core基岩版部署指南.md)

### 4.4 Adapter Core JE 环境

| 依赖 | 版本要求 | 说明 |
|------|----------|------|
| JDK | ≥ 21 LTS | Java 开发工具包 |
| Fabric Loader | ≥ 0.16.x | Fabric 模组加载器 |
| Fabric API | ≥ 0.105.x | Fabric 核心 API |
| Minecraft | ≥ 1.21.x | Java 版客户端/服务端 |
| SQLite JDBC | ≥ 3.45 | Java SQLite 驱动 |

### 4.5 快速诊断

```bash
# 检查 Node.js
node --version   # 需要 ≥ 20.0.0

# 检查 pnpm
pnpm --version   # 需要 ≥ 8.0.0

# 检查 Java（JE 开发者）
java --version   # 需要 ≥ 21

# 检查 TypeScript
npx tsc --version  # 需要 ≥ 5.4
```

---

## 5. 开发工作流

### 5.1 Git 工作流

采用 **GitHub Flow** 模式：

```
main ─── 始终可部署
  │
  ├── feature/ac-llm-provider   ← AC 开发者从 main 创建
  ├── feature/be-pathfinding    ← BE 开发者从 main 创建
  └── feature/je-pathfinding    ← JE 开发者从 main 创建
```

| 阶段 | 操作 | 说明 |
|------|------|------|
| **开始任务** | `git checkout -b feature/{模块}-{功能名}` | 从 main 创建分支 |
| **开发中** | `git commit -m "feat({scope}): message"` | Conventional Commits |
| **完成** | `git push && 创建 PR` | PR 标题：`[{scope}] {描述}` |
| **合并** | Squash Merge | 保持 main 历史整洁 |

**Commit 类型**：`feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `chore`

**Scope**：`agent-core` / `adapter-be` / `adapter-je` / `shared` / `docs` / `deps`

> 完整规范详见 [docs/standards/02-Git工作流规范.md](docs/standards/02-Git工作流规范.md)

### 5.2 开发流程

```
┌─────────────────────────────────────────────────────────┐
│ 1. 从 version-plans 找到当前版本任务                       │
│    →  docs/version-plans/{AC|BE|JE}/AC|BE|JE-02-实施计划.md │
└─────────────────────┬───────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│ 2. 从 api/ 和 tools/ 了解接口定义                       │
│    → 按需阅读接口规范和工具设计文档                       │
└─────────────────────┬───────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│ 3. 从 standards/ 确认编码规范                           │
│    → 01-代码规范, 03-测试规范                           │
└─────────────────────┬───────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│ 4. 编码实现并编写测试                                   │
│    → 遵循 TDD / 先单元测试后集成测试                     │
└─────────────────────┬───────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│ 5. 本地验证（lint + typecheck + test）                  │
│    → npm run lint / npm run typecheck / npm run test    │
└─────────────────────┬───────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│ 6. 提交 PR，等待 Code Review                            │
│    → 至少 1 名 reviewer 通过后 Squash Merge             │
└─────────────────────────────────────────────────────────┘
```

### 5.3 PR 规范

| 维度 | 要求 |
|------|------|
| **文件变更** | ≤ 400 行 / PR（纯新增文件除外） |
| **Reviewer** | ≥ 1 人 |
| **CI 通过** | lint + typecheck + test 全部绿色 |
| **关联 Issue** | PR 描述中关联对应 Issue 编号 |
| **Squash Merge** | 合并后删除 feature 分支 |

### 5.4 集成节点

每个里程碑版本末进行 3 模块集成验证：

| 集成节点 | 版本 | 验证内容 |
|----------|:----:|----------|
| **I1** | V3 | TCP 通信 + 工具注册闭环 |
| **I2** | V6 | 执行AI 主体 + LLM 调度 |
| **I3** | V9 | 全部 43 个工具就绪 |
| **I4** | V13 | 全部功能模块完成 |
| **I5** | V15 | 最终集成发布 |

---

## 6. 版本路线

### 6.1 当前状态

```
当前版本：V1（项目初始化阶段）
状态：🔨 进行中
开始日期：2026-07-04
预计完成：第 1 周
```

### 6.2 5 阶段 15 版本

```
阶段一：基础建设（V1-V3）→ 项目骨架 + 通信通道
   ↓
阶段二：执行核心（V4-V6）→ 执行AI主体 + Agent Core调度
   ↓
阶段三：工具矩阵（V7-V9）→ 全部43个工具就绪
   ↓
阶段四：智能增强（V10-V12）→ 记忆/任务/QQ/事件
   ↓
阶段五：集成发布（V13-V15）→ 集成测试 + 性能优化 + 正式发布
```

### 6.3 版本总览

| 版本 | 阶段 | Agent Core | Adapter BE | Adapter JE | 里程碑 |
|:----:|:----:|-----------|-----------|-----------|--------|
| **V1** 🔨 | 基础 | 项目初始化 + Shared 库 | 插件骨架 | 模组骨架 | 3 模块搭建完成 |
| V2 | 基础 | TCP 服务端 + 协议实现 | TCP 客户端 + 认证 | TCP 客户端 + 认证 | TCP 通信双向打通 |
| V3 | 基础 | 工作区管理器 v1 | 工具注册 + 状态上报 | 工具注册 + 状态上报 | 工具注册闭环 |
| V4 | 执行 | LLM 调度层 v1 (FCP) | 寻路 + move_to + 骑乘 | 寻路 + move_to + 骑乘 | 假人可自主移动 |
| V5 | 执行 | 提示词系统 + 上下文管理 | 背包工具 x4 | 背包工具 x4 | Agent 可管理物品 |
| V6 | 执行 | 4 Provider + ModelRouter | 生存 x3 + 方块 x4 | 生存 x3 + 方块 x4 | 执行AI 主体完成 |
| V7 | 工具 | LLM 对话界面 v1 | 生物交互 x4 | 生物交互 x4 | 执行层工具就绪 |
| V8 | 工具 | 主界面面板 | 感知工具 x5 | 感知工具 x5 | 假人完整感知 |
| V9 | 工具 | 工具调用面板 + 日志 | 对话工具 x3 | 对话工具 x3 | **43 工具全部注册** |
| V10 | 智能 | QQ 机器人模块 v1 | 假人管理 v1 | 假人管理 v1 | 远程操控通道 |
| V11 | 智能 | 记忆系统 v1 (SQLite+Chroma) | 数据持久化 | 数据持久化 | 结构化记忆可用 |
| V12 | 智能 | 记忆系统 v2 (地图索引) | 配置接入 | 配置接入 | 完整记忆体系 |
| V13 | 智能 | 任务系统 v1 | 任务工具对接 | 任务工具对接 | 自主任务规划 |
| V14 | 集成 | 事件触发器 + 功能冻结 | 性能优化 + 稳定性 | 性能优化 + 稳定性 | 功能冻结 |
| V15 | 发布 | E2E + 打包 + 发布 | E2E + 打包 | E2E + 打包 | **v1.0 正式发布** |

> 完整版本计划详见 [docs/03-版本计划与迭代路线图.md](docs/03-版本计划与迭代路线图.md)
>
> 各模块详细版本任务详见 [docs/version-plans/](docs/version-plans/)

### 6.4 各模块当前版本任务

| 模块 | V1 任务 | 负责人 | 预计工时 |
|------|---------|--------|----------|
| **AC** | Electron 项目初始化、Shared 库搭建（D1-D4）、Monorepo 配置 | AC-A + AC-B | 5 人天 |
| **BE** | LeviLamina 插件骨架、Node.js 运行时集成 | BE-A | 2 人天 |
| **JE** | Fabric 模组项目初始化、Gradle 配置、Java 工具链 | JE-A | 2 人天 |

### 6.5 工具交付节奏

```
V4:  移动 x3         →  3 工具  [Agent 可移动]
V5: +背包 x4         →  7 工具  [+ 物品管理]
V6: +生存 x3 + 方块 x4 → 14 工具  [+ 生存/建造]
V7: +生物 x4         → 18 工具  [+ 战斗/交互]
V8: +感知 x5         → 23 工具  [+ 环境感知]
V9: +对话 x3         → 26 工具  [Adapter Core 全部就绪]
V10: +QQ x2          → 28 工具  [+ 远程操控]
V11: +记忆 x5         → 33 工具  [+ 记忆存储]
V12: +记忆 x3 (地图索引) → 36 工具 [+ 空间查询]
V13: +任务 x7         → 43 工具  [全部工具就绪]
```

---

## 7. 快速开始

### 7.1 克隆仓库

```bash
git clone https://github.com/your-org/mcagent.git
cd mcagent
```

### 7.2 安装依赖

```bash
# 安装 pnpm（如未安装）
npm install -g pnpm

# 安装所有依赖（Monorepo）
pnpm install
```

### 7.3 构建

```bash
# 构建所有包
pnpm build

# 仅构建 Shared 库
pnpm --filter shared build

# 仅构建 Agent Core
pnpm --filter agent-core build
```

### 7.4 运行

```bash
# 启动 Agent Core（开发模式）
pnpm --filter agent-core dev

# 启动 JE Adapter Core（需先构建模组）
# 将 build/libs/*.jar 复制到 Minecraft mods/ 目录
```

### 7.5 测试

```bash
# 运行全部测试
pnpm test

# 运行单模块测试
pnpm --filter agent-core test
pnpm --filter adapter-bedrock test

# 运行 lint 检查
pnpm lint

# 运行类型检查
pnpm typecheck
```

### 7.6 调试技巧

| 场景 | 方法 |
|------|------|
| TCP 通信调试 | 在 `agent-core` 中启用 `DEBUG=tcp:*` 环境变量 |
| LLM 调用调试 | 设置 `OPENAI_LOG=true` 查看完整 API 请求/响应 |
| 工具调用可视化 | 打开 Agent Core UI 的工具调用面板 |
| 状态上报查看 | Agent Core 游戏状态面板实时显示 |
| 日志查看 | `logs/mcagent-{date}.log` 分级日志文件 |

---

## 8. 代码仓库结构

```
mcagent/
├── .github/                     ─ CI/CD 配置
│   └── workflows/
│       ├── ci.yml               ─ TypeScript + Java 双重 CI
│       └── release.yml          ─ 自动发布
│
├── packages/                    ─ 代码包（Monorepo）
│   ├── agent-core/              ─ Agent Core（Electron + TypeScript/Node.js + React）
│   │   ├── src/
│   │   │   ├── main/            ─ Electron 主进程
│   │   │   │   ├── llm/         ─ LLM 调度层（Provider / Router / Pipeline）
│   │   │   │   ├── workspace/   ─ 工作区管理器
│   │   │   │   ├── tcp/         ─ TCP 服务端
│   │   │   │   ├── memory/      ─ 记忆系统（SQLite + Chroma）
│   │   │   │   ├── task/        ─ 任务规划系统
│   │   │   │   ├── qq/          ─ QQ 机器人（OneBot）
│   │   │   │   ├── trigger/     ─ 事件触发器
│   │   │   │   └── log/         ─ 日志系统
│   │   │   └── renderer/        ─ React UI 界面
│   │   │       ├── components/  ─ 组件（控制面板/对话/状态/工具调用/记忆浏览器/配置）
│   │   │       ├── hooks/       ─ React Hooks
│   │   │       └── stores/      ─ 状态管理
│   │   ├── __tests__/           ─ Vitest 测试
│   │   └── package.json
│   │
│   ├── adapter-bedrock/          ─ BE 接入核心（LeviLamina + TypeScript）
│   │   ├── tools/               ─ 26 个工具实现
│   │   │   ├── perception/      ─ 感知系统（5 工具）
│   │   │   ├── movement/        ─ 移动系统（3 工具）
│   │   │   ├── inventory/       ─ 背包系统（4 工具）
│   │   │   ├── entity/          ─ 生物交互（4 工具）
│   │   │   ├── survival/        ─ 生存系统（3 工具）
│   │   │   ├── block/           ─ 方块操作（4 工具）
│   │   │   └── chat/            ─ 对话系统（3 工具）
│   │   ├── src/
│   │   │   ├── ai/              ─ 执行AI 引擎
│   │   │   │   ├── pathfinding/ ─ 寻路系统（A* 3D）
│   │   │   │   ├── movement/    ─ 移动系统
│   │   │   │   ├── inventory/   ─ 背包操作引擎
│   │   │   │   ├── combat/      ─ 战斗系统
│   │   │   │   ├── interaction/ ─ 生物交互引擎
│   │   │   │   └── survival/    ─ 生存操作引擎
│   │   │   ├── tcp/             ─ TCP 客户端
│   │   │   ├── registry/        ─ 工具注册模块
│   │   │   ├── bot/             ─ 假人管理
│   │   │   ├── status/          ─ 状态上报
│   │   │   ├── persistence/     ─ 数据持久化（SQLite）
│   │   │   └── config/          ─ 配置接入
│   │   ├── __tests__/           ─ Vitest 测试
│   │   └── package.json
│   │
│   ├── adapter-java/             ─ JE 接入核心（Fabric + Java 21）
│   │   ├── src/main/java/io/mcagent/adapter/
│   │   │   ├── tool/            ─ 26 个工具实现（@ToolModule / @ToolMethod）
│   │   │   │   ├── perception/
│   │   │   │   ├── movement/
│   │   │   │   ├── inventory/
│   │   │   │   ├── entity/
│   │   │   │   ├── survival/
│   │   │   │   ├── block/
│   │   │   │   └── chat/
│   │   │   ├── ai/              ─ 执行AI 引擎
│   │   │   ├── tcp/             ─ TCP 客户端（Java Socket）
│   │   │   ├── registry/        ─ 工具注册
│   │   │   ├── bot/             ─ 假人管理
│   │   │   ├── status/          ─ 状态上报
│   │   │   ├── persistence/     ─ 数据持久化（SQLite JDBC）
│   │   │   └── config/          ─ 配置接入
│   │   ├── src/test/java/       ─ JUnit 5 测试
│   │   └── build.gradle
│   │
│   └── shared/                   ─ 共享类型定义库（TypeScript）
│       ├── src/
│       │   ├── types/           ─ JSON-RPC 2.0 核心类型
│       │   ├── schema/          ─ 工具 Schema 定义
│       │   ├── protocol/        ─ 协议校验工具
│       │   └── constants/       ─ 常量与枚举
│       └── package.json
│
├── docs/                        ─ 设计文档（见 [3. 文档体系总览](#3-文档体系总览)）
│
├── bds26.10/                    ─ BDS 服务器（开发环境）
│
├── .trae/                       ─ TRAE AI 配置
│
├── package.json                 ─ Monorepo 根配置（pnpm workspaces）
├── pnpm-workspace.yaml          ─ pnpm 工作区配置
├── tsconfig.json                ─ 全局 TypeScript 配置
├── .eslintrc.cjs                ─ ESLint 配置
├── .prettierrc                  ─ Prettier 配置
└── .gitignore                   ─ Git 忽略规则
```

---

## 9. 常见问题

### 9.1 我怎么知道当前版本做什么？

每个模块的 `docs/version-plans/{模块}/*-02-实施计划.md` 列出了当前版本的全部任务。每个版本都有明确的产出物和验收标准。

### 9.2 我是新来的开发者，从哪里开始？

1. 读完这份 README
2. 阅读 `docs/00-顶层设计.md` 了解架构全局
3. 按角色导航阅读该模块的必读文档
4. 查看 `docs/version-plans/{模块}/*-01-需求文档.md` 了解需求
5. 查看 `docs/version-plans/{模块}/*-02-实施计划.md` 了解当前版本任务

### 9.3 如何调试工具调用？

1. 打开 Agent Core UI 的工具调用面板，实时查看调用链
2. 查看 `logs/mcagent-{date}.log` 日志文件
3. 设置环境变量 `DEBUG=tcp:*` 查看 TCP 通信详情
4. 使用 `console.log` / `System.out.println` 在工具实现中打印调试信息

### 9.4 如何处理版本延期？

参考版本计划中的延期处理策略：

| 延期时间 | 处理方式 |
|----------|----------|
| < 3 天 | 压缩当前版本非核心功能，移至下版本 |
| 3-7 天 | 冻结新功能，优先修复阻塞 bug |
| > 7 天 | 缩减版本范围，拆分延期功能到后续版本 |

### 9.5 如何报告 Bug？

1. 在 GitHub Issues 创建 Bug 报告
2. 标题格式：`[{模块}] 简短描述`
3. 内容包含：环境信息、复现步骤、预期行为、实际行为、日志片段
4. 标注标签：`bug`、`{模块}`、`P0~P3`（优先级）

### 9.6 BE 和 JE 的实现差异

| 维度 | BE（基岩版） | JE（Java 版） |
|------|-------------|---------------|
| 平台 | LeviLamina 插件 | Fabric 模组 |
| 语言 | TypeScript / Node.js | Java 21 |
| 构建 | pnpm / tsc | Gradle |
| JSON 解析 | 原生 JSON | Gson |
| 数据库 | better-sqlite3 | SQLite JDBC |
| 工具注册 | 自动扫描 tools/ 目录 | `@ToolModule` / `@ToolMethod` 注解 |
| TCP | Node.js net 模块 | Java Socket |

**关键点**：模块划分和接口定义保持一致，实现方式各自适配平台 API。

### 9.7 联系方式

| 渠道 | 说明 |
|------|------|
| GitHub Issues | Bug 报告、功能请求 |
| 项目文档 | `docs/` 目录全部设计文档 |

---

> **下一步**：查看 [docs/00-顶层设计.md](docs/00-顶层设计.md) 了解完整项目架构，
> 或查看 [docs/03-版本计划与迭代路线图.md](docs/03-版本计划与迭代路线图.md) 了解版本计划详情。
>
> **开始开发**：从你的模块的 `version-plans/` 目录开始，查看当前版本任务。
