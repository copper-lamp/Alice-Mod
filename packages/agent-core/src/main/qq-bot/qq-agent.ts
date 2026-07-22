/**
 * V23 QQ Agent — 继承 MainAgent 的 QQ 消息处理子 Agent
 *
 * 与主 Agent 共享：
 * - ChatHistory（同一 SQLite 表，按 source 区分）
 * - LTM（同一 memories 表，按 agent:xxx 标签过滤）
 * - PlayerIdentity（QQ 账号 ↔ 游戏玩家 UUID 映射）
 *
 * 与 MainAgent 差异：
 * - 默认 source='qq'（自动选 qqBotModel）
 * - 工具集 = qq_send, qq_info, request_game_action, emit_report 等
 * - 订阅 AgentReportBus 中的 report 事件
 * - 通过 requestGameAction 转发游戏操作到主 Agent
 */

import { MainAgent } from '../agent/main-agent';
import type { MainAgentDeps, MainAgentEvent, MainAgentResult } from '../agent/main-agent';
import type { MainAgentRegistry } from '../agent/main-agent-registry';
import { getWorkspaceManager } from '../workspace';
import type { AgentReportBus } from '../agent/agent-report-bus';
import type { PlayerIdentityStore } from '../agent/player-identity';
import type { ChatHistoryStore } from '../chat-history/chat-history-store';
import type { MemoryManager } from '../memory/memory-manager';
import type { OneBotClient } from './onebot-client';
import { PermissionManager } from './permission';
import type {
  QQMessage,
  QQSubAgentEvent,
  QQSubAgentEventHandler,
  SubAgentStatus,
  GameActionResult,
} from './types';

/** QQ Agent 依赖 */
export interface QQAgentDeps extends MainAgentDeps {
  /** QQ 客户端（用于执行 qq_send 等工具） */
  client: OneBotClient;
  /** 权限管理器 */
  permissionManager: PermissionManager;
  /** 主 Agent 注册表（用于 requestGameAction 转发） */
  mainAgentRegistry: MainAgentRegistry;
  /** 汇报总线 */
  reportBus: AgentReportBus;
  /** 玩家身份存储 */
  playerIdentity: PlayerIdentityStore;
  /** 记忆管理器（用于注入 peer LTM） */
  memoryManager: MemoryManager;
  /** 本 Agent 对应的主 Agent id */
  mainAgentId: string;
}

/**
 * QQ Agent — 专职处理 QQ 消息的 MainAgent 子类
 *
 * 用法：
 *   const agent = new QQAgent(deps);
 *   const result = await agent.handleQQMessage(msg);
 */
export class QQAgent extends MainAgent {
  // 子类专属依赖（通过构造函数初始化，不覆盖父类 deps 字段）
  private client: OneBotClient;
  private permissionManager: PermissionManager;
  private mainAgentRegistry: MainAgentRegistry;
  private reportBus: AgentReportBus;
  private playerIdentity: PlayerIdentityStore;
  private memoryManager: MemoryManager;
  private mainAgentId: string;

  private status: SubAgentStatus = 'idle';
  private currentMsg: QQMessage | null = null;
  private eventHandlers: Set<QQSubAgentEventHandler> = new Set();
  private unsubReport: (() => void) | null = null;

  constructor(deps: QQAgentDeps) {
    super(deps);
    this.client = deps.client;
    this.permissionManager = deps.permissionManager;
    this.mainAgentRegistry = deps.mainAgentRegistry;
    this.reportBus = deps.reportBus;
    this.playerIdentity = deps.playerIdentity;
    this.memoryManager = deps.memoryManager;
    this.mainAgentId = deps.mainAgentId;

    // 订阅 MainAgent 的 report（按 targetAgentId 过滤）
    this.unsubReport = this.reportBus.subscribe(
      deps.agentId,
      (report) => this.handleIncomingReport(report).catch((err) =>
        console.error('[QQAgent] 处理汇报失败:', err),
      ),
    );
  }

  destroy(): void {
    this.unsubReport?.();
  }

  // ════════════════════════════════════════════════════════════
  // 事件系统
  // ════════════════════════════════════════════════════════════

  onEvent(handler: QQSubAgentEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(event: QQSubAgentEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.error('[QQAgent] 事件处理器异常:', err);
      }
    }
  }

  private setStatus(status: SubAgentStatus): void {
    this.status = status;
    this.emit({ type: 'status_change', status });
  }

  getStatus(): SubAgentStatus {
    return this.status;
  }

  // ════════════════════════════════════════════════════════════
  // 主入口
  // ════════════════════════════════════════════════════════════

  /**
   * 处理一条 QQ 消息
   *
   * 流程：
   * 1. 解析玩家身份（QQ↔Game 映射）
   * 2. 调父类 handle（自动选 qqBotModel、写历史、调工具）
   * 3. 提取最终回复返回
   */
  async handleQQMessage(msg: QQMessage): Promise<{
    response: string;
    rounds: number;
    totalTokens: number;
    error?: string;
  }> {
    this.currentMsg = msg;
    this.setStatus('processing');

    // V28: 备份主 Agent 的 compiledPrompt，用于临时替换和恢复
    const originalCompiledPrompt = this.deps.agentConfig.compiledPrompt;

    try {
      // 1. 解析玩家身份
      const identity = msg.userId ? this.playerIdentity.resolveByQQ(msg.userId) : null;

      // 2. 加载 peer context（对端游戏历史 + 共享事实 + 待消费汇报）
      const peerHistory = await this.loadPeerHistory();
      const sharedFacts = await this.loadSharedFacts();
      const pendingReports = this.reportBus.consumePending(this.deps.agentId, { limit: 5 });

      // 3. 构建 prompt（含 peer_context）
      const prompt = this.formatQQPrompt(msg, identity);

      // V28: 使用 qqCompiledPrompt 作为系统提示词（与主 Agent 独立）
      // 临时替换 compiledPrompt 为 qqCompiledPrompt，调用后恢复
      if (this.deps.agentConfig.qqCompiledPrompt) {
        this.deps.agentConfig.compiledPrompt = this.deps.agentConfig.qqCompiledPrompt;
      } else {
        // V28: 兼容旧数据 — 惰性编译并回填
        try {
          const { PromptCompiler } = await import('../prompt/compiler/prompt-compiler');
          const compiled = PromptCompiler.compileQQ(this.deps.agentConfig);
          this.deps.agentConfig.compiledPrompt = compiled;
          this.deps.agentConfig.qqCompiledPrompt = compiled;
          // 异步回填到数据库
          const { getSharedAgentConfigManager } = await import('../ipc/agent-handler');
          getSharedAgentConfigManager().updateCompiledPrompt(this.deps.agentId, compiled).catch(err =>
            console.warn(`[QQAgent] 惰性编译回填失败 ${this.deps.agentId}:`, err),
          );
        } catch {
          // 回退到主 Agent 的 compiledPrompt
        }
      }

      // 4. 调父类 handle（自动选 qqBotModel、通过 scheduler 限流、写历史）
      const result = await super.handle({
        source: 'qq',
        prompt,
        metadata: {
          qqUserId: msg.userId,
          qqGroupId: msg.groupId,
          qqMessageId: msg.id,
          playerUuid: identity?.playerUuid,
          // 注入 peer_context 给 PromptBuilder
          peerContext: {
            peerSource: 'game' as const,
            peerHistory: peerHistory.map(e => ({
              role: e.role,
              content: e.content.slice(0, 200),
              createdAt: e.createdAt,
            })),
            sharedFacts: sharedFacts.map(f => ({
              key: String(f.content.key ?? ''),
              value: String(f.content.value ?? JSON.stringify(f.content)),
            })),
            pendingReports: pendingReports.map(r => ({
              reportType: r.reportType,
              summary: r.summary,
              timestamp: r.timestamp,
            })),
          },
        },
      });

      // 5. 标记汇报已消费
      if (pendingReports.length > 0) {
        this.reportBus.markConsumed(pendingReports.map(r => r.id));
      }

      // V28: 恢复主 Agent 的 compiledPrompt
      this.deps.agentConfig.compiledPrompt = originalCompiledPrompt;

      this.setStatus('idle');
      return {
        response: result.finalResponse,
        rounds: result.rounds,
        totalTokens: result.totalTokens,
        error: result.error,
      };
    } catch (err) {
      // V28: 确保恢复主 Agent 的 compiledPrompt
      this.deps.agentConfig.compiledPrompt = originalCompiledPrompt;
      this.setStatus('idle');
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { response: '', rounds: 0, totalTokens: 0, error: errorMsg };
    }
  }

  // ════════════════════════════════════════════════════════════
  // 子→父：请求游戏操作
  // ════════════════════════════════════════════════════════════

  /**
   * 请求主 Agent 执行游戏内操作
   * 替代 QQSubAgent 旧版的 mainAgentTaskQueue.complete 模式
   */
  async requestGameAction(
    description: string,
    priority: 'normal' | 'high' = 'normal',
  ): Promise<GameActionResult> {
    // V34: 检查当前 Agent 所属工作区是否在线
    const wm = getWorkspaceManager();
    const ws = wm.getWorkspace(this.deps.workspaceId);
    if (!ws || !ws.isOnline) {
      return {
        requestId: '',
        success: false,
        summary: '无法连接到游戏',
        error: 'WORLD_OFFLINE',
        durationMs: 0,
      };
    }

    const identity = this.currentMsg?.userId
      ? this.playerIdentity.resolveByQQ(this.currentMsg.userId)
      : null;

    // 通过 MainAgentRegistry 获取主 Agent 实例
    const mainAgent = this.mainAgentRegistry.getSync(
      this.deps.workspaceId,
      this.mainAgentId,
    );
    if (!mainAgent) {
      return {
        requestId: '',
        success: false,
        summary: '主 Agent 未就绪',
        error: 'MAIN_AGENT_NOT_FOUND',
        durationMs: 0,
      };
    }

    const startTime = Date.now();
    try {
      const result = await mainAgent.handle({
        source: 'trigger',
        prompt: `[QQ 用户 ${this.currentMsg?.userId ?? 'unknown'} 请求] ${description}`,
        metadata: {
          origin: 'qq_agent',
          qqUserId: this.currentMsg?.userId,
          qqGroupId: this.currentMsg?.groupId,
          priority,
          requestId: crypto.randomUUID(),
        },
      });

      return {
        requestId: result.metadata?.requestId as string ?? '',
        success: !result.error,
        summary: result.finalResponse,
        details: result.metadata?.details as string | undefined,
        error: result.error,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        requestId: '',
        success: false,
        summary: '主 Agent 调用异常',
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startTime,
      };
    }
  }

  // ════════════════════════════════════════════════════════════
  // 父→子：处理主 Agent 主动汇报
  // ════════════════════════════════════════════════════════════

  private async handleIncomingReport(report: import('../agent/report-store').AgentReport): Promise<void> {
    // 如果没有活跃的 QQ 会话，汇报通过 SQLite 持久化兜底
    if (!this.currentMsg) return;

    // 生成 QQ 友好格式的简短汇报
    const qqMessage = this.formatReportForQQ(report);
    if (!qqMessage) return;

    // 发送 QQ 消息（不阻塞主流程）
    const target = this.currentMsg.groupId ?? this.currentMsg.userId;
    this.client.sendMessage(target, qqMessage, this.currentMsg.type ?? 'group').catch((err: unknown) => {
      console.error('[QQAgent] 发送汇报失败:', err);
    });
  }

  // ════════════════════════════════════════════════════════════
  // 父→子：主 Agent 调度发送 QQ 消息
  // ════════════════════════════════════════════════════════════

  /**
   * V27: 被主 Agent 调度 — 主动发送 QQ 消息
   *
   * 主 Agent 可通过此方法让 QQ Agent 向指定群或用户发送消息。
   * 用于主 Agent 主动汇报任务进展、发送通知等场景。
   *
   * @param target 目标群号或 QQ 号
   * @param content 消息内容
   * @param type 消息类型：group=群消息, private=私聊
   * @returns 是否发送成功
   */
  async sendQQMessage(
    target: string,
    content: string,
    type: 'group' | 'private' = 'group',
  ): Promise<boolean> {
    try {
      if (type === 'group') {
        await this.client.sendGroupMsg(target, content);
      } else {
        await this.client.sendPrivateMsg(target, content);
      }
      console.log(`[QQAgent] 主 Agent 调度消息已发送到 ${type === 'group' ? '群' : '私聊'} ${target}`);
      return true;
    } catch (err) {
      console.error(`[QQAgent] 发送调度消息失败:`, err);
      return false;
    }
  }

  // ════════════════════════════════════════════════════════════
  // 辅助方法
  // ════════════════════════════════════════════════════════════

  /** 加载对端（游戏端）最近对话历史 */
  private async loadPeerHistory(): Promise<import('../chat-history/chat-history-store').ChatHistoryEntry[]> {
    const store = this.deps.historyStore as ChatHistoryStore;
    if (!store.loadWithPeer) return [];
    const result = await store.loadWithPeer(this.deps.workspaceId, this.deps.agentId, {
      peerSource: 'game',
      peerLimit: 5,
      limit: 20,
    });
    return result.peer;
  }

  /** 加载共享玩家事实 */
  private async loadSharedFacts(): Promise<import('../memory/types').Memory[]> {
    return this.memoryManager.loadPlayerFacts(this.deps.workspaceId, { limit: 20 });
  }

  /** 格式化 QQ 消息 prompt */
  private formatQQPrompt(msg: QQMessage, identity?: import('../agent/player-identity').PlayerIdentity | null): string {
    const parts: string[] = [];

    if (identity) {
      parts.push(`[身份信息] 该 QQ 用户绑定了游戏玩家：${identity.playerName}（${identity.playerUuid}）`);
    }

    if (msg.groupId) {
      parts.push(`[群消息] 来自群 ${msg.groupId}，用户 ${msg.userId}：${msg.content}`);
    } else {
      parts.push(`[私聊] 来自用户 ${msg.userId}：${msg.content}`);
    }

    return parts.join('\n');
  }

  /** 格式化汇报为 QQ 消息 */
  private formatReportForQQ(report: import('../agent/report-store').AgentReport): string {
    const typeLabels: Record<string, string> = {
      task_started: '🔄 开始任务',
      task_progress: '⏳ 进行中',
      task_milestone: '📍 里程碑',
      task_completed: '✅ 任务完成',
      task_failed: '❌ 任务失败',
      task_warning: '⚠️ 警告',
      player_event: '👤 玩家事件',
      world_event: '🌍 世界事件',
    };
    const label = typeLabels[report.reportType] ?? report.reportType;
    return `${label}: ${report.summary}`;
  }
}