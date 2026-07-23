# JE Adapter 构建发布系统 - 执行文档

> 模块：JE（Java Edition Adapter 持续集成/持续交付）
> 文档版本：v1.0
> 日期：2026-07-23
> 上游文档：
> - [JE-Release-01-需求文档.md](./JE-Release-01-需求文档.md)
> - [JE-Release-02-架构文档.md](./JE-Release-02-架构文档.md)

---

## 第1章 当前状态

> 本文档为**代码实现阶段**输出。以下所有修改已落地。

| 交付物 | 状态 | 文件路径 |
|--------|------|---------|
| sync-je.yml | ✅ 已完成 | `.github/workflows/sync-je.yml` |
| release.yml (Alice-JE) | ✅ 已完成 | `SERVER/Alice-JE/.github/workflows/release.yml` |
| versions.json | ✅ 已完成 | `SERVER/Alice-JE/versions.json` |
| build.gradle CI 适配 | ✅ 已完成 | `packages/adapter-java/build.gradle` |
| 需求文档 | ✅ 已完成 | `SERVER/docs/JE-Release-01-需求文档.md` |
| 架构文档 | ✅ 已完成 | `SERVER/docs/JE-Release-02-架构文档.md` |
| 执行文档 | ✅ 已完成 | `SERVER/docs/JE-Release-03-执行文档.md` |

---

## 第2章 文件清单与变更说明

### 2.1 修改的文件

#### 2.1.1 `.github/workflows/sync-je.yml`

**变更内容**：

| 修改项 | 修改前 | 修改后 |
|--------|--------|--------|
| 触发条件 | `push: branches: [main]` + paths 过滤 | 新增 `push: tags: ['je/v*']` |
| 分支处理 | 直接使用 `${{ github.ref_name }}` 推送到 Alice-JE | 新增 `Determine target branch` 步骤，标签推送时目标分支固定为 main |
| 子仓库文件恢复 | `cp /tmp/release.yml .github/workflows/` | 使用独立备份目录 `/tmp/je-sync-backup/`，确保目录存在 |
| 标签推送 | 无 | 新增 `Push tag to Alice-JE` 步骤，剥离 `je/` 前缀后推送 |
| 发布触发 | `if: startsWith(github.ref, 'refs/tags/je/')` （永不触发） | 新增 `github.ref_type == 'tag'` 判断 + repository_dispatch |

#### 2.1.2 `packages/adapter-java/build.gradle`

**变更内容**：

| 修改项 | 修改前 | 修改后 |
|--------|--------|--------|
| fabric-loom 版本 | 硬编码 `"1.7.4"` | `project.findProperty("loom_version") ?: "1.7.4"`（支持 CI 动态注入） |
| deployToServer | `finalizedBy('build')` 无条件执行 | CI 环境跳过 |

```groovy
// Loom 版本改为动态属性（支持 CI 中按 MC 版本切换 loom）
id("fabric-loom") version project.findProperty("loom_version") ?: "1.7.4"

// deployToServer 仅在非 CI 环境
if (System.getenv('CI') == null) {
    tasks.named('build') { finalizedBy('deployToServer') }
}
```
- CI 环境变量 `CI=true`（GitHub Actions 自动设置）时跳过 deployToServer
- 本地开发时行为不变

#### 2.1.3 `SERVER/Alice-JE/.github/workflows/release.yml`

**变更内容**：

| 修改项 | 修改前 | 修改后 |
|--------|--------|--------|
| python 调用 | `python` | `python3`（确保兼容性） |
| 标签名获取 | 隐式依赖 `github.ref` | 新增 `Determine tag name` 步骤，支持 tag push 和 repository_dispatch 两种触发 |
| 动态属性 | 注入 loader/api/minecraft/carpet | 新增 `loom_version` 动态注入 |

新增 `Determine tag name` 步骤：
```yaml
- name: Determine tag name
  id: tag
  run: |
    if [[ "${{ github.event_name }}" == "repository_dispatch" ]]; then
      echo "name=${{ github.event.client_payload.tag }}" >> $GITHUB_OUTPUT
    else
      echo "name=${GITHUB_REF#refs/tags/}" >> $GITHUB_OUTPUT
    fi
```

#### 2.1.4 `SERVER/Alice-JE/versions.json`

**变更内容**：从 3 个版本扩展到 10 个版本，新增 `loom` 和 `java` 字段

| MC 版本 | JDK | Fabric Loader | Fabric API | Carpet | Loom |
|---------|-----|--------------|-----------|--------|------|
| ✅ 1.21.4 | 21 | 0.16.10 | 0.119.4+1.21.4 | 1.21.4-1.4.161+v241203 | 1.7-SNAPSHOT |
| ✅ 1.21.5 | 21 | 0.16.10 | 0.120.0+1.21.5 | 1.21.5-1.4.162+v241204 | 1.7-SNAPSHOT |
| ✅ 1.21.6 | 21 | 0.16.14 | 0.128.1+1.21.6 | 1.21.6-1.4.175+v250627 | 1.7-SNAPSHOT |
| ✅ 1.21.7 | 21 | 0.16.14 | 0.129.0+1.21.7 | 1.21.7-1.4.176+v250630 | 1.7-SNAPSHOT |
| ✅ 1.21.8 | 21 | 0.16.14 | 0.130.0+1.21.8 | 1.21.8-1.4.179+v250731 | 1.7-SNAPSHOT |
| ✅ 1.21.9 | 21 | 0.16.14 | 0.135.0+1.21.9 | 1.21.9-1.4.185+v250930 | 1.7-SNAPSHOT |
| ✅ 1.21.10 | 21 | 0.16.14 | 0.136.0+1.21.10 | 1.21.10-1.4.186+v251009 | 1.7-SNAPSHOT |
| ✅ 1.21.11 | 21 | 0.16.14 | 0.137.0+1.21.11 | 1.21.11-1.4.194+v251223 | 1.7-SNAPSHOT |
| ✅ 26.1 | 25 | 0.18.4 | 0.144.3+26.1 | 26.1+v260402 | 1.15-SNAPSHOT |
| ✅ 26.2 | 25 | 0.19.3 | 0.152.2+26.2 | 26.2+v260616 | 1.17-SNAPSHOT |

> 所有版本号均经过 Fabric 官方文档和 CurseForge 发布页验证。

---

## 第3章 发布操作指南

### 3.1 常规发布流程

```bash
# Step 1: 确保 JE 代码已提交到 main
git checkout main
git push origin main

# Step 2: 创建发布标签
VERSION="1.0.0"
git tag -a "je/v${VERSION}" -m "JE Release v${VERSION}"
git push origin "je/v${VERSION}"

# Step 3: 等待 CI 完成
# - sync-je.yml 自动触发
# - Alice-JE 子仓库自动构建 10 个 MC 版本
# - GitHub Release 自动创建
```

### 3.2 验证发布

1. 进入 GitHub Actions 页面，确认 sync-je.yml 运行成功
2. 进入 copper-lamp/Alice-JE 仓库，确认 release.yml 运行成功
3. 检查 Alice-JE Release 页面，确认包含所有 10 个版本的 JAR

### 3.3 问题排查

| 现象 | 可能原因 | 解决方式 |
|------|---------|---------|
| sync-je.yml 未触发 | 标签不匹配 `je/v*` 模式 | `git tag -d` 后重新创建 |
| Alice-JE release.yml 未触发 | SUBREPO_PAT 权限不足 | 检查 PAT 的 `repo` / `contents:write` 权限 |
| Alice-JE 标签推送失败 | checkout 凭据未覆盖 tag push 或 PAT 权限不足 | 使用显式 `x-access-token:${{ secrets.SUBREPO_PAT }}` HTTPS URL 推送分支和标签，并移除吞错逻辑 |
| repository_dispatch 触发异常 | dispatch payload 使用了主仓库 `je/` 前缀标签 | 发送剥离后的 `v*` 标签，并使用 `curl --fail` 暴露 API 错误 |
| 某 MC 版本构建失败 | versions.json 版本号错误 | 检查对应版本的 Fabric API / Carpet 版本 |
| deployToServer 错误 | CI 环境变量未设置 | 确认 `CI=true` 环境变量存在（GitHub Actions 默认设置） |

---

## 第4章 维护指南

### 4.1 新增 MC 版本

1. 在 `SERVER/Alice-JE/versions.json` 中添加新版本条目
2. 将文件同步到 Alice-JE 子仓库（通过推送 main 分支自动同步）
3. 验证构建矩阵是否包含新版本

### 4.2 Gradle Wrapper 升级

```bash
cd packages/adapter-java
./gradlew wrapper --gradle-version 8.12
```

### 4.3 Fabric Loom 升级

编辑 `build.gradle`：
```groovy
id("fabric-loom") version "1.10.0"  # 根据 Fabric 官方文档更新
```

### 4.4 完整发布流程图

```
开发者
  │
  ├── git push main (代码变更)
  │   └── sync-je.yml: 同步代码到 Alice-JE main
  │
  └── git push tag je/v1.0.0
      └── sync-je.yml:
          ├── 同步代码到 Alice-JE main
          ├── push tag v1.0.0 到 Alice-JE
          │   └── Alice-JE release.yml (tag push 触发)
          │       ├── matrix-prepare: 读取 versions.json
          │       ├── build (×10): 并行构建所有 MC 版本
          │       └── publish: GitHub Release
          └── repository_dispatch → Alice-JE
              └── Alice-JE release.yml (dispatch 触发, 兜底)
```
