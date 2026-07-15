# AC-V21 — 智能体实例注册 修复文档

> 版本：v1.0
> 日期：2026-07-16
> 版本号：V21
> 关联文档：[AC-V16-智能体创建向导-架构文档.md](AC-V16-智能体创建向导-架构文档.md)、[AC-V20-主链路组装-设计文档.md](AC-V20-主链路组装-设计文档.md)

---

## 第1章 问题描述

### 1.1 当前状态

V16 实现了智能体创建向导，创建后的智能体配置通过 `AgentConfigManager` 保存到 SQLite 的 `agents` 表。但存在以下问题：

| 问题 | 影响 |
|------|------|
| 智能体配置仅存于 SQLite，未导出到模组目录 | JE 侧无法读取智能体配置，无法创建对应的假人实例 |
| 创建智能体后未触发实例注册流程 | 智能体在游戏中不可见，无法使用 |
| JE 侧无从感知新智能体创建 | 需要手动同步配置 |

### 1.2 根因分析

```
当前流程:
  AC 创建智能体 → SQLite INSERT → 前端列表刷新 → 结束
                                      ↑
                                   缺少: 导出到模组目录 + 通知 JE 侧

目标流程:
  AC 创建智能体 → SQLite INSERT → 导出 JSON 到 Alice/agents/ → 通知 JE 侧刷新
                                                                            ↓
                                                                     JE 注册假人实例
```

---

## 第2章 修复方案

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         AC 主进程                                     │
│                                                                      │
│  AgentConfigManager.create()                                         │
│       │                                                              │
│       ├──→ SQLite INSERT (已有)                                       │
│       │                                                              │
│       └──→ AgentFileExporter.export()  (新增)                         │
│               │                                                      │
│               └──→ 写入 Alice/agents/<agentId>.json                  │
│                                                                      │
│  Alice/agents/ 目录:                                                  │
│    <AliceDir>/agents/                                                 │
│      ├── agent-xxxx.json                                             │
│      ├── agent-yyyy.json                                             │
│      └── ...                                                         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                               │ 文件系统
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         JE 侧 (adapter-java)                         │
│                                                                      │
│  AgentConfigWatcher (新增)                                            │
│       │                                                              │
│       ├──→ 监听 Alice/agents/ 目录变更                                 │
│       │                                                              │
│       └──→ 读取代理配置 → BotManager.spawn()                          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Alice 目录结构

```
<gameDir>/
├── Alice/
│   ├── mcagent_instance.json    -- 入口文件（已有）
│   ├── config.json              -- 配置文件（已有）
│   ├── mcagent.db               -- 全局数据库（已有）
│   ├── agents/                  -- 新增：智能体配置文件目录
│   │   ├── agent-xxxx.json      -- 每个智能体一个文件
│   │   └── agent-yyyy.json
│   ├── worlds/                  -- 世界数据库目录（已有）
│   └── logs/                    -- 日志目录（已有）
```

### 2.3 智能体配置文件格式

每个智能体导出为一个 JSON 文件，存放在 `Alice/agents/` 目录下：

```json
{
  "schema_version": "1.0",
  "agent_id": "agent-xxxx",
  "name": "后勤专家",
  "alias": "小后勤",
  "skin_data": "base64...",
  "persona": {
    "identity": "你是一名Minecraft后勤管理专家...",
    "expertise": ["采矿专家", "资源管理"],
    "personality": ["有条理", "务实", "谨慎"],
    "workflow_id": "mining_smelting",
    "behavior_rules": {
      "core": ["优先保障资源供应"],
      "strategy": [],
      "constraints": []
    }
  },
  "persona_preset_id": "preset-logistics",
  "tools": {
    "enabled_tools": {
      "scan_surroundings": true,
      "move_to": true,
      "mine_block": true
    }
  },
  "qq_binding": {
    "enabled": false,
    "account": "",
    "groups": [],
    "settings": {}
  },
  "llm_config": {
    "main_model": {
      "provider_id": "openai",
      "model_id": "gpt-4o",
      "model_name": "GPT-4o"
    },
    "qq_bot_model": {
      "same_as_main": true
    },
    "compression_model": {
      "same_as_main": true
    }
  },
  "is_main": false,
  "workspace_id": "workspace-xxxx",
  "created_at": 1234567890,
  "updated_at": 1234567890
}
```

---

## 第3章 AC 侧修改

### 3.1 AgentFileExporter

**新增文件**：`packages/agent-core/src/main/agent/agent-file-exporter.ts`

**职责**：将智能体配置从 SQLite 导出为 JSON 文件到模组目录。

```typescript
export class AgentFileExporter {
  /**
   * 写入智能体配置文件到 Alice/agents/<agentId>.json
   */
  static async export(config: AgentConfig): Promise<void>
  
  /**
   * 删除 Alice/agents/<agentId>.json
   */
  static async remove(agentId: string): Promise<void>
  
  /**
   * 获取 Alice 目录路径
   * 从 InstanceManager 中查找已注册实例的 file_path，
   * 取其父目录作为 Alice 目录
   */
  private static resolveAliceDir(): string | null
}
```

### 3.2 AgentConfigManager 修改

**修改文件**：`packages/agent-core/src/main/agent/agent-config-manager.ts`

在 `create()` 和 `update()` 方法中，保存到 SQLite 后，调用 `AgentFileExporter.export()` 将配置导出到文件。

```typescript
async create(config: AgentConfig): Promise<string> {
  await this.ensureLoaded()
  const id = `agent-${randomUUID().slice(0, 8)}`
  const now = Date.now()
  const record: AgentConfig = { ...config, id, createdAt: now, updatedAt: now }
  this.cache.set(id, record)
  this.saveToDb(id, record)
  
  // V21: 导出到模组目录
  AgentFileExporter.export(record).catch(err =>
    console.warn('[AgentConfigManager] 导出到文件失败:', err)
  )
  
  return id
}

async update(id: string, config: Partial<AgentConfig>): Promise<boolean> {
  // ... 现有逻辑 ...
  // 更新后重新导出
  AgentFileExporter.export(updated).catch(...)
  return true
}
```

### 3.3 Alice 目录路径解析

Alice 目录路径通过已注册的实例来确定。从 `InstanceManager` 或 `WorkspaceManager` 中获取已注册的实例，找到其 `file_path` 指向的 `mcagent_instance.json`，其父目录即为 `Alice/` 目录。

```typescript
// 从 WorkspaceManager 的实例中获取 Alice 目录
private static resolveAliceDir(): string | null {
  const { instanceManager } = require('../ipc/workspace-handler')
  const instances = instanceManager.getAll()
  if (instances.length === 0) return null
  
  // 取第一个实例的 file_path 的父目录
  const filePath = instances[0].file_path
  if (!filePath) return null
  
  const aliceDir = path.dirname(filePath)
  if (!fs.existsSync(aliceDir)) return null
  
  return aliceDir
}
```

### 3.4 启动时全量导出

在 AC 启动时，遍历所有已保存的智能体配置，全量导出到 `Alice/agents/` 目录。

**修改**：`packages/agent-core/src/main/ipc/agent-handler.ts`

在 `registerAgentHandlers()` 中，启动时执行全量导出：

```typescript
export function registerAgentHandlers(): void {
  // V21: 启动时全量导出
  exportAllAgents().catch(err =>
    console.warn('[AgentHandler] 启动时全量导出失败:', err)
  )
  
  // ... 现有 handler 注册 ...
}

async function exportAllAgents(): Promise<void> {
  const agents = await agentConfigManager.list()
  for (const summary of agents) {
    const config = await agentConfigManager.get(summary.id)
    if (config) {
      await AgentFileExporter.export(config)
    }
  }
  console.log(`[AgentHandler] 已导出 ${agents.length} 个智能体配置`)
}
```

---

## 第4章 JE 侧修改

### 4.1 AgentConfigReader

**新增文件**：`io/alice/mod/adapter/agent/AgentConfigReader.java`

**职责**：从 `Alice/agents/` 目录读取智能体配置文件。

```java
public class AgentConfigReader {
  /** 读取所有智能体配置 */
  public static List<AgentConfig> readAll(Path gameDir)
  
  /** 读取单个智能体配置 */
  public static Optional<AgentConfig> read(Path gameDir, String agentId)
  
  /** 智能体配置数据类 */
  public record AgentConfig(
    String agentId,
    String name,
    String alias,
    // ... 其他字段
  ) {}
}
```

### 4.2 AgentConfigWatcher

**新增文件**：`io/alice/mod/adapter/agent/AgentConfigWatcher.java`

**职责**：监听 `Alice/agents/` 目录的文件变更，自动加载新配置。

```java
public class AgentConfigWatcher {
  public void start(Path gameDir, Consumer<AgentConfig> onAgentCreated)
  public void stop()
}
```

### 4.3 WorldContext 集成

**修改**：`io/alice/mod/adapter/world/WorldContext.java`

在 `initialize()` 中，读取 `Alice/agents/` 目录下的智能体配置，为每个配置创建对应的假人。

```java
public void initialize() {
  // ... 现有初始化 ...
  
  // V21: 加载智能体配置
  List<AgentConfig> agents = AgentConfigReader.readAll(gameDir);
  for (AgentConfig agent : agents) {
    if (agent.isMain()) {
      String botName = agent.getAlias() != null ? agent.getAlias() : agent.getName();
      // 截断到 Minecraft 名称长度限制
      botName = botName.length() > 16 ? botName.substring(0, 16) : botName;
      botManager.spawn(botName, overworld, spawnPos);
    }
  }
}
```

---

## 第5章 文件变更清单

### 5.1 AC 侧新增

| 文件 | 职责 |
|------|------|
| `packages/agent-core/src/main/agent/agent-file-exporter.ts` | 智能体配置文件导出器 |

### 5.2 AC 侧修改

| 文件 | 变更 |
|------|------|
| `packages/agent-core/src/main/agent/agent-config-manager.ts` | create/update 后调用 AgentFileExporter.export() |
| `packages/agent-core/src/main/ipc/agent-handler.ts` | 启动时全量导出已有智能体配置 |

### 5.3 JE 侧新增

| 文件 | 职责 |
|------|------|
| `io/alice/mod/adapter/agent/AgentConfig.java` | 智能体配置数据类 |
| `io/alice/mod/adapter/agent/AgentConfigReader.java` | 读取智能体配置文件 |
| `io/alice/mod/adapter/agent/AgentConfigWatcher.java` | 监听智能体配置目录变更 |

### 5.4 JE 侧修改

| 文件 | 变更 |
|------|------|
| `io/alice/mod/adapter/world/WorldContext.java` | 初始化时加载智能体配置并创建假人 |
| `io/alice/mod/adapter/config/AlicePaths.java` | 新增 `agentsDir()` 方法 |

---

## 第6章 边界情况

| 场景 | 处理方式 |
|------|----------|
| 无已注册实例（未连接任何 Adapter Core） | 跳过导出，不报错 |
| 多个实例同时连接 | 取第一个实例的 Alice 目录路径 |
| Alice/agents/ 目录不存在 | 自动创建目录 |
| 智能体配置更新后 | 重新导出覆盖原文件 |
| 智能体删除后 | 删除对应的 JSON 文件 |
| Minecraft 名称长度限制（16字符） | 自动截断智能体名称 |
| 同名假人冲突 | 使用 agentId 后缀确保唯一性 |