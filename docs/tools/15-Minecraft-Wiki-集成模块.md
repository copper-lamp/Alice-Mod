# Minecraft Wiki 集成模块

> 版本：v1.0
> 日期：2026-07-11
> 状态：开发中

---

## 1. 概述

将 [Minecraft-Wiki-MCP](https://github.com/L3-N0X/Minecraft-Wiki-MCP)（v2 Python 版）的核心功能以**原生 MediaWiki API 封装**的方式集成到 Agent Core 中。

### 1.1 设计原则

- **零外部依赖**：不依赖 MCP 协议、不依赖 Python/uv 运行时，直接调用 MediaWiki REST API
- **模块化**：独立模块 `src/main/wiki/`，与 Agent Core 其他模块松耦合
- **双重消费**：同时提供给 LLM（通过 ToolSchema）和 UI（通过 IPC handler）
- **精简工具**：只暴露 3 个核心工具，不做多余功能

### 1.2 与原始项目的区别

| 特性 | Minecraft-Wiki-MCP v2 | 本模块 |
|------|----------------------|--------|
| 运行时 | Python 3.12+ / uv | Node.js（内置） |
| 通信协议 | MCP stdio/HTTP | ToolSchema + IPC |
| 工具数量 | 7 个 | 3 个（精简） |
| 安装部署 | 需 clone + uv sync | 零安装 |
| 中文支持 | 需改 `MINECRAFT_WIKI_API_URL` | 后续支持 |

---

## 2. 架构

```
┌─────────────────────────────────────────────────┐
│                  LLM Pipeline                     │
│  ┌──────────────┐    ┌────────────────────────┐  │
│  │ ToolRegistry │───▶│ wiki_search /           │  │
│  │              │    │ wiki_get_page /         │  │
│  │              │    │ wiki_get_section        │  │
│  └──────────────┘    └───────────┬────────────┘  │
│                                  │                │
├──────────────────────────────────┼────────────────┤
│                    WikiClient                     │
│          https://minecraft.wiki/api.php           │
└──────────────────────────────────┼────────────────┘
                                   │ HTTP
                          ┌────────▼────────┐
                          │  Minecraft Wiki  │
                          │  (MediaWiki API) │
                          └─────────────────┘
```

### 2.1 模块目录

```
src/main/wiki/
├── wiki-types.ts      # 类型定义
├── wiki-client.ts     # MediaWiki API HTTP 客户端
├── wiki-tools.ts      # ToolSchema 定义 + 执行函数
├── wiki-formatter.ts  # Markdown/JSON 输出格式
├── wiki-handler.ts    # IPC handler（前端调用）
├── index.ts           # 模块入口
└── __tests__/
    └── wiki.test.ts   # 测试
```

---

## 3. 工具定义

### 3.1 `minecraft_wiki_search`

搜索 Minecraft Wiki 页面。

| 属性 | 值 |
|------|-----|
| **名称** | `minecraft_wiki_search` |
| **分类** | `knowledge` |
| **描述** | 搜索 Minecraft Wiki，查找物品、方块、生物、结构等页面 |
| **参数** | `query`（必填，搜索关键词）, `limit`（可选，默认 5，最大 20） |
| **输出** | Markdown：编号列表（标题 + URL + 描述）；JSON：`WikiSearchResponse` |

### 3.2 `minecraft_wiki_get_page`

获取页面的摘要（简介 + 章节列表）或完整内容。

| 属性 | 值 |
|------|-----|
| **名称** | `minecraft_wiki_get_page` |
| **分类** | `knowledge` |
| **描述** | 获取页面摘要（含章节列表）或完整内容。先调 search 获得精确标题后再用此工具 |
| **参数** | `title`（必填，页面标题）, `mode`（可选，`summary`/`full`，默认 `summary`） |
| **输出** | Markdown：标题 + 简介文本 + 章节编号列表；JSON：`WikiPageSummary` / `WikiPageContent` |

### 3.3 `minecraft_wiki_get_section`

获取页面某个章节的详细内容。

| 属性 | 值 |
|------|-----|
| **名称** | `minecraft_wiki_get_section` |
| **分类** | `knowledge` |
| **描述** | 读取页面特定章节的详细文本内容。需要先用 `wiki_get_page` 获取章节索引 |
| **参数** | `title`（必填，页面标题）, `section_index`（必填，章节编号） |
| **输出** | Markdown：章节标题 + 正文；JSON：`{title, content}` |

---

## 4. UI 集成

### 4.1 位置

集成在 **知识与技能 → 资料库** 页面中，以「内置」分区展示。

```
资料库管理
├── 📚 知识条目（来自记忆系统，branch='knowledge'）
└── 🔌 内置
    └── Minecraft Wiki 搜索框
        ├── 搜索输入 + 搜索按钮
        └── 搜索结果列表（标题、描述、链接）
```

### 4.2 IPC 接口

| 通道 | 参数 | 返回 |
|------|------|------|
| `wiki:search` | `{query, limit?}` | `{results, total}` |
| `wiki:get-page` | `{title, mode?}` | `WikiPageSummary` / `WikiPageContent` |
| `wiki:get-section` | `{title, section_index}` | `{title, content}` |

---

## 5. ToolSchema 注册

Tools 通过 `WIKI_TOOL_SCHEMAS` 导出，在主进程初始化时注册到 `ToolRegistry`：

```typescript
// src/main/wiki/index.ts
export const WIKI_TOOL_SCHEMAS: ToolSchema[] = [
  WIKI_SEARCH_TOOL,
  WIKI_GET_PAGE_TOOL,
  WIKI_GET_SECTION_TOOL,
]
```

---

## 6. 测试计划

### 6.1 单元测试（`__tests__/wiki.test.ts`）

| 测试 | 验证内容 |
|------|----------|
| `search returns results` | 搜索 "diamond" 返回包含 "Diamond" 的结果 |
| `search empty query` | 空搜索词返回空结果，不抛异常 |
| `getPageSummary existing` | 获取 "Diamond" 页面，返回非空 extract |
| `getPageSummary nonexistent` | 不存在的页面返回 null |
| `getPageContent` | 获取完整页面内容，返回非空 content |
| `getSection` | 获取指定章节，返回非空内容 |
| `formatter renders markdown` | 渲染结果为合法 Markdown 字符串 |
| `client timeout handled` | 超时场景返回友好错误 |

### 6.2 测试命令

```bash
# 运行 Wiki 模块测试
cd packages/agent-core
npx vitest run src/main/wiki/__tests__/wiki.test.ts

# 运行所有测试
npx vitest run
```

---

## 7. 使用示例

### LLM 对话场景

```
用户: "Minecraft 里钻石剑怎么做？"

Agent (LLM) 调用:
1. wiki_search(query="钻石剑 合成") 
   → 返回: "Diamond Sword" 页面

2. wiki_get_page(title="Diamond Sword")
   → 返回摘要: "A diamond sword is a melee weapon..." + 章节列表

3. wiki_get_section(title="Diamond Sword", section_index=3)
   → 返回: "Crafting" 章节的详细内容

Agent: "钻石剑需要 2 颗钻石和 1 根木棍，在 crafting table 上合成..."
```

### 代码调用

```typescript
import { WikiClient } from './wiki-client'

const client = new WikiClient()

// 搜索
const { results } = await client.search('diamond sword')

// 获取页面
const page = await client.getPageSummary('Diamond Sword')

// 获取章节
const section = await client.getSection('Diamond Sword', 3)
```

---

## 8. 后续计划

- [ ] 多语言支持（通过 `MINECRAFT_WIKI_API_URL` 配置）
- [ ] 缓存搜索结果（减少重复请求）
- [ ] 中文 Wiki 支持（`https://zh.minecraft.wiki/api.php`）
- [ ] 结果分页
- [ ] 页面内容解析优化（minecraft-wiki-MDifier 集成）
