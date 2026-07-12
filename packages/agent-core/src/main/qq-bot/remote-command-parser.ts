/**
 * RemoteCommandParser — QQ 远程指令解析器
 *
 * 处理 ADMIN / COMMAND 权限用户通过 QQ 发送的远程指令。
 * 支持 /status、/task list、/restart 等常用指令。
 */

import type { TaskManager } from '../task/task-manager';
import type { QQMessage } from './types';

export interface RemoteCommandParserDeps {
  taskManager?: TaskManager;
  getStatus?: () => string;
}

export class RemoteCommandParser {
  private deps: RemoteCommandParserDeps;

  constructor(deps: RemoteCommandParserDeps = {}) {
    this.deps = deps;
  }

  setDeps(deps: RemoteCommandParserDeps): void {
    this.deps = deps;
  }

  /**
   * 解析并执行远程指令
   * @returns 回复文本，null 表示不是已知远程指令
   */
  async execute(command: string, args: string, _msg: QQMessage): Promise<string | null> {
    switch (command.toLowerCase()) {
      case 'status':
        return this.handleStatus();
      case 'task':
        return this.handleTask(args);
      case 'restart':
        return this.handleRestart();
      case 'help':
        return this.handleHelp();
      default:
        return null;
    }
  }

  private handleStatus(): string {
    if (this.deps.getStatus) {
      return this.deps.getStatus();
    }

    const uptime = Math.floor(process.uptime());
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;

    return [
      '📊 Agent Core 状态',
      `运行时间: ${hours}h ${minutes}m ${seconds}s`,
      `Node 版本: ${process.version}`,
      `平台: ${process.platform}`,
    ].join('\n');
  }

  private handleTask(args: string): string {
    if (!this.deps.taskManager) {
      return '❌ 任务系统不可用';
    }

    const subCommand = args.trim().toLowerCase();

    if (subCommand === 'list' || subCommand === '') {
      const result = this.deps.taskManager.list({ limit: 10 });
      if (result.tasks.length === 0) {
        return '📋 当前没有任务';
      }

      const lines = result.tasks.map(t => {
        const progress = t.progress > 0 ? ` (${t.progress}%)` : '';
        return `• [${t.priority}] ${t.name} — ${t.status}${progress}`;
      });

      return `📋 最近任务（共 ${result.total} 个）：\n${lines.join('\n')}`;
    }

    return `❓ 未知 task 子指令: ${subCommand}`;
  }

  private handleRestart(): string {
    return '♻️ 重启指令已收到，请在主进程中手动执行重启。';
  }

  private handleHelp(): string {
    return [
      '📖 远程指令列表（仅管理员可用）',
      '/status — 查看 Agent Core 状态',
      '/task list — 查看最近任务',
      '/restart — 请求重启 Agent Core',
      '/help — 显示此帮助',
    ].join('\n');
  }
}
