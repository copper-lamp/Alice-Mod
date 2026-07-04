# Alice Mod Git 工作流规范

> 版本：v1.0
> 日期：2026-07-04
> 适用范围：所有 Alice Mod 子模块（Agent Core、Adapter Core BE、Adapter Core JE、Shared）
> 关联文档：[00-顶层设计.md](../00-顶层设计.md)、[02-模块划分与功能简介.md](../02-模块划分与功能简介.md)

---

## 第1章 概述

### 1.1 目标

本规范旨在建立 Alice Mod 项目的统一 Git 工作流标准，实现以下目标：

| 目标 | 说明 |
| --- | --- |
| **一致的提交历史** | 所有提交遵循统一格式，便于追溯变更原因和责任人 |
| **清晰的版本管理** | 分支结构与版本号对应，发布流程可重现、可回溯 |
| **高效的协作** | PR + Code Review 机制保障代码质量，减少合并冲突 |

### 1.2 工作流模型：GitHub Flow

McAgent 采用 **GitHub Flow** 作为核心工作流模型：

```
main ───── feat/xxx ── PR ── squash merge ──→ main
  │                                              │
  └──── fix/xxx ──── PR ── squash merge ────────→ main
```

核心原则：
- **`main` 分支始终保持可部署状态**
- 所有开发工作在功能分支上进行
- 通过 **Pull Request (PR)** 合并回 `main`
- 合并后立即删除源分支

> 注意：当前团队规模下暂不设 `develop` 分支。如团队扩展至 5 人以上，可引入 `develop` 作为集成分支，功能分支从 `develop` 创建、合并回 `develop`，`main` 仅用于发布。

---

## 第2章 分支管理

### 2.1 主分支

#### `main` — 稳定发布分支

- 始终处于**可部署**状态
- 所有对 `main` 的修改必须通过 **PR + Code Review**
- **禁止直接 push 到 `main`**
- 每次合并到 `main` 即产生一个新版本（打 tag）

#### `develop` — 开发主线（可选）

> 当前阶段不启用。当团队规模扩大或需要多个特性并行开发时引入。

- 功能分支从 `develop` 创建
- 定期合并到 `main` 进行发布

### 2.2 功能分支

| 属性 | 规则 |
| --- | --- |
| **命名格式** | `feat/模块名称-简要描述` |
| **示例** | `feat/agent-core-ollama-provider` |
| **创建来源** | 从 `main` 最新 commit 创建 |
| **合并目标** | 合并回 `main`（通过 PR） |

**命名约定：**

- `模块名称` 使用以下缩写之一：`agent-core`、`adapter-be`、`adapter-je`、`shared`
- `简要描述` 使用 kebab-case，英文小写

**完整示例：**

| 分支名 | 说明 |
| --- | --- |
| `feat/agent-core-ollama-provider` | Agent Core 添加 Ollama Provider |
| `feat/adapter-be-inventory-tools` | BE 适配器新增背包工具 |
| `feat/shared-message-types` | Shared 库新增消息类型 |
| `feat/adapter-je-fabric-setup` | JE 适配器初始化 Fabric 项目 |

**生命周期：**

```
创建分支 → 本地开发 → 提交代码 → 推送远程 → 发起 PR → Code Review → 合并 → 删除分支
```

### 2.3 修复分支

| 属性 | 规则 |
| --- | --- |
| **命名格式** | `fix/问题描述` |
| **示例** | `fix/tcp-reconnect-timeout`、`fix/memory-leak-chroma` |
| **创建来源** | 从 `main` 最新 commit 创建（紧急修复） |
| **合并目标** | 合并回 `main`（通过 PR） |

**完整示例：**

| 分支名 | 说明 |
| --- | --- |
| `fix/tcp-reconnect-timeout` | 修复 TCP 重连超时问题 |
| `fix/adapter-be-item-slot-offset` | 修复 BE 物品槽位偏移 |
| `fix/agent-core-crash-empty-config` | 修复空配置导致崩溃 |

### 2.4 其他分支

| 分支类型 | 命名格式 | 说明 |
| --- | --- | --- |
| 文档 | `docs/xxx` | 文档新增或修改 |
| 重构 | `refactor/xxx` | 代码重构，不改变外部行为 |
| 杂项 | `chore/xxx` | 构建脚本、CI/CD、依赖更新等 |
| 性能 | `perf/xxx` | 性能优化 |

**示例：**

```
docs/api-llm-interface          # 完善 LLM 接口文档
refactor/agent-core-modules     # 重构 Agent Core 模块结构
chore/ci-add-lint-check         # CI 新增 lint 检查
perf/memory-index-optimization  # 优化记忆系统索引性能
```

### 2.5 分支清理

- 合并到 `main` 后，**立即删除**源分支（远程 + 本地）
- 定期清理本地陈旧分支：
  ```bash
  git branch --merged main | grep -v "main" | xargs git branch -d
  ```

---

## 第3章 提交规范 (Conventional Commits)

### 3.1 提交格式

```
<type>(<scope>): <description>

[body]

[footer]
```

### 3.2 type（必填）

提交类型，表示本次提交的类别：

| type | 说明 | 是否出现在 Changelog |
| --- | --- | --- |
| `feat` | 新功能 | ✅ |
| `fix` | Bug 修复 | ✅ |
| `docs` | 文档变更 | ✅ |
| `style` | 代码格式（空格、分号等），不影响逻辑 | ❌ |
| `refactor` | 重构（既不修复 bug 也不增加功能） | ✅ |
| `perf` | 性能优化 | ✅ |
| `test` | 新增或修改测试 | ✅ |
| `chore` | 构建、CI、依赖等 | ❌ |

### 3.3 scope（必填）

影响范围，表示本次修改涉及的模块：

| scope | 对应模块 |
| --- | --- |
| `agent-core` | Agent Core（Electron + TypeScript） |
| `adapter-be` | Adapter Core BE（LeviLamina/TypeScript） |
| `adapter-je` | Adapter Core JE（Fabric/Java） |
| `shared` | Shared 类型库（TypeScript） |
| `deps` | 依赖管理 |
| `docs` | 文档 |

### 3.4 description（必填）

- 使用**中文**或**英文**
- 使用**祈使句**（"添加"、"修复"、"更新"，而非"添加了"、"修复了"）
- 首字母**小写**（英文时）
- 不超过 **72 个字符**

### 3.5 body（可选）

- 说明本次修改的**动机**和**背景**
- 与 description 之间空一行
- 每行不超过 **72 个字符**

### 3.6 footer（可选）

- `BREAKING CHANGE:` — 不兼容变更，后跟说明
- `Closes #N` — 关联的 Issue 编号
- `Refs #N` — 引用的 Issue 编号

### 3.7 完整示例

```bash
# 新功能
git commit -m "feat(agent-core): 添加 Ollama Provider 支持

实现 Ollama Provider 的 chat 和 chatStream 接口，
支持本地模型接入。

Closes #42"

# Bug 修复
git commit -m "fix(adapter-be): 修复背包物品数量显示错误

物品数量读取时未考虑堆叠上限，导致超出 maxStackSize 的数值显示异常。"

# 重构
git commit -m "refactor(shared): 重构消息类型定义

将重复的类型定义抽取为共享接口，减少 Agent Core 和 Adapter Core 之间的类型不一致。"

# 文档
git commit -m "docs(agent-core): 更新 LLM Provider 接入文档"

# 带 BREAKING CHANGE
git commit -m "feat(shared): 重构通信协议消息格式

将消息头从固定长度改为变长 TLV 格式，以支持扩展字段。

BREAKING CHANGE: 消息头格式不再兼容 v1.x，需要同时更新 Agent Core 和 Adapter Core。"
```

### 3.8 提交规范检查清单

- [ ] type 使用正确，不超过允许的范围
- [ ] scope 准确反映修改涉及的模块
- [ ] description 简洁明了，其他开发者能理解意图
- [ ] body 说明修改的 why，而非 what
- [ ] 存在 BREAKING CHANGE 时已在 footer 标注
- [ ] 关联的 Issue 已在 footer 引用

---

## 第4章 Pull Request 流程

### 4.1 PR 标题

PR 标题遵循提交信息格式：

```
<type>(<scope>): <description>
```

**示例：**

```
feat(agent-core): 添加 Ollama Provider 支持
fix(adapter-be): 修复 TCP 重连超时
docs(shared): 更新模块接口文档
```

### 4.2 PR 模板

发起 PR 时使用以下模板：

```markdown
## 改动描述

<!-- 简要说明本次 PR 做了什么，为什么需要这个改动 -->

## 关联 Issue

<!-- Closes #N 或 Refs #N -->

## 测试方式

- [ ] 本地构建通过
- [ ] 单元测试通过
- [ ] 集成测试通过
- [ ] 已在 BDS 环境运行验证（适配器改动）
- [ ] 已在 JE 环境运行验证（适配器改动）

## 截图（如适用）

<!-- UI 改动请附截图 -->

## 检查清单

- [ ] 代码遵循项目编码规范
- [ ] 无未处理的边界情况
- [ ] 添加了必要的注释（仅对复杂逻辑）
- [ ] 更新了相关文档
- [ ] 提交信息符合 Conventional Commits 规范
- [ ] 分支命名符合规范
```

### 4.3 PR 流程

```
1. 创建功能/修复分支
2. 提交代码，推送远程
3. 发起 PR，填写模板
4. 指派 Reviewer（至少 1 人）
5. 通过 CI 检查（lint + test + build）
6. Code Review 通过
7. 使用 Squash Merge 合并到 main
8. 删除源分支（远程 + 本地）
```

### 4.4 合并策略

**强制使用 Squash Merge：**

```
所有提交压缩为一个 commit 合并到 main
```

理由：
- 保持 `main` 历史线性、整洁
- 每个 merge commit 对应一个完整的功能/bugfix
- 便于 cherry-pick 和 revert

合并后的 commit message 格式：

```
<type>(<scope>): <description> (#PR编号)
```

### 4.5 PR 大小限制

- 单个 PR 建议不超过 **400 行** 代码变更
- 超过 400 行的 PR 应拆分为多个小 PR
- 纯配置文件或自动生成的代码可例外

---

## 第5章 Code Review 规范

### 5.1 Reviewer 职责

Reviewer 需检查以下方面：

| 维度 | 检查要点 |
| --- | --- |
| **逻辑正确性** | 算法是否正确、边界条件是否处理、并发安全 |
| **功能完整性** | 是否覆盖所有需求场景、错误处理是否完善 |
| **代码风格** | 是否遵循项目编码规范、命名是否清晰 |
| **测试覆盖** | 是否有足够的单元测试、边界用例是否覆盖 |
| **性能影响** | 是否存在性能瓶颈、是否有不必要的资源开销 |
| **安全性** | 是否存在注入风险、敏感信息是否泄漏 |
| **兼容性** | 是否向后兼容、BREAKING CHANGE 是否标注 |

### 5.2 Author 职责

- PR 发起者应在 **24 小时内** 回复 Reviewer 的 comment
- 处理 feedback 的方式：
  - **采纳**：修改代码并在对应 comment 回复 "Done"
  - **讨论**：对不同意的地方给出理由，达成共识
  - **推迟**：标注为后续 PR 处理，获得 Reviewer 同意
- 处理完所有 feedback 后，@ 提醒 Reviewer 重新 review

### 5.3 Code Review 禁忌

| ❌ 禁止行为 | 说明 |
| --- | --- |
| **直接 push 到 main** | 所有对 `main` 的修改必须经过 PR |
| **合并自己的 PR** | PR 必须由他人合并 |
| **Review 超过 400 行的 PR** | 超过应要求拆分为小 PR |
| **LGTM 后不合并（>48h）** | 超过 48 小时未合并需重新 Review |
| **未通过 CI 就合并** | CI 必须全绿 |
| **夜间/凌晨合并** | 避免在无人值守时合并，以防意外 |

### 5.4 Review 检查清单

```markdown
## Reviewer 检查清单

### 功能与逻辑
- [ ] 代码实现了预期功能
- [ ] 所有边界情况已处理
- [ ] 错误路径有合理处理

### 代码质量
- [ ] 代码可读性好，命名清晰
- [ ] 无重复代码（DRY）
- [ ] 复杂度可接受（无过度嵌套）
- [ ] 注释仅用于解释"为什么"

### 测试
- [ ] 新增代码有对应测试
- [ ] 测试覆盖了正常路径和异常路径

### 安全与兼容
- [ ] 无安全漏洞（命令注入、路径遍历等）
- [ ] BREAKING CHANGE 已标注
- [ ] 配置变更已更新文档
```

### 5.5 Review 流程示意

```
Author 发起 PR
    ↓
指派 Reviewer（至少 1 人）
    ↓
Reviewer 提出 comment
    ↓
Author 修改代码 / 回复讨论
    ↓
循环直至无未解决 comment
    ↓
Reviewer Approve
    ↓
Author（或 Reviewer）执行 Squash Merge
    ↓
删除源分支
```

---

## 第6章 版本管理

### 6.1 语义化版本（SemVer）

版本号格式：**MAJOR.MINOR.PATCH**

| 版本位 | 递增条件 | 示例 |
| --- | --- | --- |
| **MAJOR** | 不兼容的 API 修改（BREAKING CHANGE） | `1.0.0` → `2.0.0` |
| **MINOR** | 向下兼容的功能新增 | `1.0.0` → `1.1.0` |
| **PATCH** | 向下兼容的 Bug 修复 | `1.0.0` → `1.0.1` |

**预发布版本：**

```
1.0.0-alpha.1
1.0.0-beta.1
1.0.0-rc.1
```

### 6.2 版本号与 git tag 对应

每个发布版本对应一个 git tag，tag 名称与版本号一致：

```
v1.0.0
v1.1.0
v1.1.0-beta.1
v2.0.0
```

### 6.3 版本号更新规则

| 变更类型 | type 字段 | 版本号更新 |
| --- | --- | --- |
| 不兼容 API 变更 | feat / refactor（含 BREAKING CHANGE） | MAJOR +1 |
| 新功能（兼容） | feat | MINOR +1 |
| Bug 修复 | fix | PATCH +1 |
| 性能优化 | perf | PATCH +1 |
| 文档、重构（无 API 变更） | docs / refactor | 不更新版本 |

### 6.4 CHANGELOG.md 自动生成

使用 **git-cliff** 从 Conventional Commits 自动生成 `CHANGELOG.md`。

**安装 git-cliff：**

```bash
# 通过 cargo
cargo install git-cliff

# 通过 npm
npm install -g git-cliff

# 通过 winget
winget install git-cliff
```

**基础配置（`cliff.toml`）：**

```toml
[changelog]
header = "# Changelog\n\n"
body = """
{% if version %}\n## {{ version }} - {{ timestamp | date(format="%Y-%m-%d") }}{% endif %}\n{% for group, commits in commits | group_by(attribute="group") %}
### {{ group | upper_first }}
{% for commit in commits %}
- {{ commit.message | upper_first }}{% if commit.scope %} ({{ commit.scope }}){% endif %}
{%- endfor %}
{% endfor %}\n
"""
trim = true

[git]
conventional_commits = true
commit_preprocessors = [
  { pattern = "^(feat|fix|docs|refactor|perf|test|chore)\\((.+?)\\)", replace = "$1($2)" },
]
```

**使用方式：**

```bash
# 生成完整 CHANGELOG
git-cliff -o CHANGELOG.md

# 仅生成最新版本的变更
git-cliff --unreleased -o CHANGELOG.md

# 生成并追加到现有 CHANGELOG
git-cliff -o CHANGELOG.md --prepend
```

> 备选方案：如不引入 git-cliff，可使用 `standard-version` 或 `semantic-release` 实现类似效果。

---

## 第7章 标签与发布

### 7.1 标签命名

| 类型 | 格式 | 示例 |
| --- | --- | --- |
| 正式版 | `v<MAJOR>.<MINOR>.<PATCH>` | `v1.0.0`、`v1.2.3` |
| 预发布版 | `v<MAJOR>.<MINOR>.<PATCH>-<tag>.<N>` | `v1.1.0-beta.1`、`v2.0.0-rc.2` |

**预发布标签规范：**

| 标签 | 含义 | 版本稳定性 |
| --- | --- | --- |
| `alpha.N` | 内部测试，功能未完整 | 不稳定 |
| `beta.N` | 公测，功能完整但可能有 bug | 较不稳定 |
| `rc.N` | 发布候选，只修 bug 不加功能 | 稳定 |

### 7.2 发布流程

```
1. 确认 main 分支处于可发布状态（CI 全绿、所有 PR 已合并）
2. 更新版本号（修改 package.json 或相关配置文件）
3. 生成 / 更新 CHANGELOG.md
4. 提交版本更新 commit：
   git commit -m "chore(release): v1.2.0"
5. 打 tag：
   git tag v1.2.0
6. 推送 tag 到远程：
   git push origin v1.2.0
7. 在 GitHub 创建 Release：
   - 选择对应 tag：v1.2.0
   - 标题：v1.2.0
   - 内容：粘贴 CHANGELOG 中对应版本的变更记录
   - 如有二进制产物，上传附件
8. （可选）发布 Release 后通知团队
```

### 7.3 自动化发布（推荐）

配置 GitHub Actions 实现推送 tag 自动发布：

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Generate Release Notes
        run: |
          npx git-cliff --latest --output RELEASE_NOTES.md
      - name: Create Release
        uses: softprops/action-gh-release@v2
        with:
          body_path: RELEASE_NOTES.md
          files: |
            dist/*.zip
```

---

## 附录

### A. 提交信息速查表

```
# 新功能
feat(agent-core): 添加 xxx 功能

# Bug 修复
fix(adapter-be): 修复 xxx 问题

# 文档
docs(agent-core): 更新 xxx 文档

# 重构
refactor(shared): 重构 xxx 模块

# 性能优化
perf(agent-core): 优化 xxx 性能

# 测试
test(adapter-be): 添加 xxx 测试

# 杂项
chore(deps): 更新 xxx 依赖到 v1.2.0

# 样式
style(agent-core): 格式化 xxx 文件

# 不兼容变更（在 footer 标出）
feat(shared): 重构通信协议
BREAKING CHANGE: 消息格式不再兼容 v1.x
```

### B. 分支命名速查表

```
# 功能分支
feat/模块名称-简要描述
feat/agent-core-ollama-provider
feat/adapter-be-inventory-tools

# 修复分支
fix/问题描述
fix/tcp-reconnect-timeout
fix/memory-leak-chroma

# 其他分支
docs/xxx
refactor/xxx
chore/xxx
perf/xxx
```

### C. 常用 git alias 推荐

在 `~/.gitconfig` 中配置：

```ini
[alias]
  # 查看历史（单行）
  lg = log --oneline --graph --decorate --all

  # 查看历史（详细）
  lga = log --oneline --graph --decorate --all --author-date-order

  # 查看未推送的提交
  unpushed = log origin/main..HEAD --oneline

  # 查看已合并到 main 的分支
  merged = branch --merged main | grep -v main

  # 清理已合并的本地分支
  clean-branches = !git branch --merged main | grep -v main | xargs git branch -d

  # 交互式 rebase 最近 N 个提交
  rebase-n = "!f() { git rebase -i HEAD~$1; }; f"

  # 修复最近一次提交信息
  amend = commit --amend

  # 查看某个文件的提交历史
  hist = log --follow --oneline --

  # 当前分支状态
  st = status -s

  # 暂存所有变更并添加信息
  save = !git add -A && git commit -m
```

使用示例：

```bash
git lg              # 查看分支图谱
git unpushed        # 检查哪些提交尚未推送
git clean-branches  # 清理已合并分支
git hist README.md  # 查看 README.md 的修改历史
```

### D. 常用操作流程

#### D.1 开始新功能开发

```bash
# 同步 main
git checkout main
git pull

# 创建功能分支
git checkout -b feat/agent-core-ollama-provider

# 开发、提交...
git add .
git commit -m "feat(agent-core): 添加 Ollama Provider 基础接口"
git add .
git commit -m "feat(agent-core): 实现 Ollama chat 和 chatStream"

# 推送到远程
git push -u origin feat/agent-core-ollama-provider

# 在 GitHub 发起 PR
```

#### D.2 同步 main 到功能分支

```bash
# 方法一：rebase（推荐，历史更整洁）
git checkout feat/agent-core-ollama-provider
git rebase main

# 方法二：merge（保留合并上下文）
git checkout feat/agent-core-ollama-provider
git merge main
```

#### D.3 修正提交信息

```bash
# 修正最近一次提交
git commit --amend

# 修正前 N 次提交
git rebase -i HEAD~3
# 将需要修改的提交前的 pick 改为 reword
```

### E. 参考文献

- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/zh-hans/)
- [Semantic Versioning 2.0.0](https://semver.org/lang/zh-CN/)
- [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow)
- [git-cliff](https://git-cliff.org/)