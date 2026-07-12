/**
 * 工具执行结果与测试报告渲染
 */

import type { ToolResult } from '../registry/tool-module.types.js';
import type { ReportEntry, ReportStats } from './ToolTestReport.js';

export class ToolResultRenderer {
  /**
   * 渲染单条工具执行结果
   */
  static render(
    player: Player,
    toolName: string,
    result: ToolResult,
    onBack?: (player: Player) => void,
  ): void {
    const form = mc.newSimpleForm();
    form.setTitle(`§l测试结果: ${toolName}`);

    const status = result.success ? '§a● 成功' : '§c● 失败';
    let content = `${status}\n\n`;
    content += `§e耗时: §f${result.duration_ms}ms\n`;

    if (result.error) {
      content += `§c错误: §f${result.error}\n`;
    }

    if (result.data && Object.keys(result.data).length > 0) {
      content += `\n§b返回数据:\n${JSON.stringify(result.data, null, 2)}`;
    }

    form.setContent(content);
    form.addButton('§a返回主菜单');
    form.addButton('§7关闭');

    player.sendForm(form, (pl, id) => {
      if (id === 0 && onBack) {
        onBack(pl);
      }
    });
  }

  /**
   * 渲染错误提示
   */
  static renderError(player: Player, message: string, onBack?: (player: Player) => void): void {
    const form = mc.newSimpleForm();
    form.setTitle('§l§c执行异常');
    form.setContent(`§c${message}`);
    form.addButton('§a返回主菜单');
    form.addButton('§7关闭');

    player.sendForm(form, (pl, id) => {
      if (id === 0 && onBack) {
        onBack(pl);
      }
    });
  }

  /**
   * 渲染测试报告汇总
   */
  static renderReport(
    player: Player,
    stats: ReportStats,
    entries: ReportEntry[],
    onBack?: (player: Player) => void,
  ): void {
    const form = mc.newSimpleForm();
    form.setTitle('§l测试报告');

    let content = `§a通过: ${stats.passed}  §c失败: ${stats.failed}  §e超时: ${stats.timeout}\n`;
    content += `§f总计: ${stats.total}\n\n`;

    if (entries.length === 0) {
      content += '§7暂无测试记录';
    } else {
      content += '§7最近记录:\n';
      for (const entry of entries.slice().reverse()) {
        const icon = entry.success ? '§a✓' : '§c✗';
        const time = new Date(entry.timestamp).toLocaleTimeString();
        content += `${icon} §f${entry.tool} §7${time} ${entry.durationMs}ms\n`;
      }
    }

    form.setContent(content);
    form.addButton('§a返回主菜单');
    form.addButton('§7关闭');

    player.sendForm(form, (pl, id) => {
      if (id === 0 && onBack) {
        onBack(pl);
      }
    });
  }

  /**
   * 渲染冒烟测试进度文本
   */
  static sendProgress(player: Player, current: number, total: number, toolName: string): void {
    player.sendText(`§e[冒烟测试] ${current}/${total} 正在执行 ${toolName} ...`);
  }

  /**
   * 渲染冒烟测试汇总
   */
  static renderSmokeSummary(
    player: Player,
    results: { tool: string; result: ToolResult }[],
    onBack?: (player: Player) => void,
  ): void {
    const passed = results.filter((r) => r.result.success).length;
    const failed = results.length - passed;

    const form = mc.newSimpleForm();
    form.setTitle('§l冒烟测试汇总');

    let content = `§a通过: ${passed}  §c失败: ${failed}  §f总计: ${results.length}\n\n`;
    for (const { tool, result } of results) {
      const icon = result.success ? '§a✓' : '§c✗';
      content += `${icon} §f${tool} §7${result.duration_ms}ms\n`;
      if (result.error) {
        content += `  §c${result.error}\n`;
      }
    }

    form.setContent(content);
    form.addButton('§a返回主菜单');
    form.addButton('§7关闭');

    player.sendForm(form, (pl, id) => {
      if (id === 0 && onBack) {
        onBack(pl);
      }
    });
  }
}
