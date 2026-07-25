# Debug Session: je-ac-auth-token
- **Status**: [OPEN]
- **Issue**: JE 与 AC 建立 TCP 连接后，握手持续被 AC 以 `Invalid auth_token` 拒绝。
- **Debug Server**: Pending
- **Log File**: `.dbg/trae-debug-log-je-ac-auth-token.ndjson`

## Reproduction Steps
1. 启动 AC。
2. 启动 JE/Minecraft 服务端实例。
3. 观察 JE TCP 握手及 AC 响应。

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | JE 握手携带的 `auth_token` 与 AC 当前配置不一致 | High | Low | Pending |
| B | JE 读取了错误实例或工作目录中的旧 token | High | Medium | Pending |
| C | AC 启动或热更新后重新生成 token，JE 未同步 | Medium | Medium | Pending |
| D | v2 握手中的 token 字段序列化或配置键名回归 | Medium | Medium | Pending |
| E | JE 连接到了另一个 AC 进程或端口 | Low | Low | Pending |

## Log Evidence
- Terminal lines 270-321: JE repeatedly sends v2 handshake and AC replies `code=-32001, message=Invalid auth_token`.
- AC side logs for the received token and expected token are not yet available.

## 功能专属文档

### 需求
AC 启动时必须能够发现运行目录、工作区目录及环境变量指定位置中的 JE 实例文件，并将其中的认证 token 加入握手允许集合；JE 与 AC 必须使用同一 token 完成 TCP v2 握手。

### 架构
JE 由 `WorldIdentity` 持久化 `auth_token`，`InstanceFileGenerator` 写入 `Alice/mcagent_instance.json` 的 `auth.token`，`HandshakeManager` 将其发送为 `params.auth_token`。AC 在启动阶段扫描候选实例文件，读取 `instance.auth.token`，传给 `TcpServer` 和 `HandshakeHandler` 做严格匹配。

### 执行
修复 AC 的候选路径集合，补充 `process.cwd()/serverjava/Alice/mcagent_instance.json` 与 `process.cwd()/bds26.10/Alice/mcagent_instance.json`；保留 `MCAGENT_INSTANCE_FILE` 优先级。通过 token SHA-256 前缀日志核对两端，不记录明文 token。

## Verification Conclusion
Root cause identified; minimal path discovery fix applied. Pending rebuilt AC and JE runtime verification.
