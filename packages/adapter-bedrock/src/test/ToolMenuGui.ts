/**
 * 游戏内 GUI 测试菜单
 */

import type { ToolCategory } from '../registry/tool-module.types.js';
import type { MainMenuAction } from './types.js';

const CATEGORY_LABELS: Record<ToolCategory | string, string> = {
  movement: '§a移动工具\nmove_to / ride / dismount',
  inventory: '§e背包工具\ndrop / take / put / equip',
  survival: '§b生存工具\neat / sleep / use_item',
  block: '§d方块工具\nmine / place / use / area',
  perception: '§7感知工具',
  entity: '§7生物交互',
  chat: '§7聊天工具',
};

export type MenuCallback<T> = (action: T) => void;

export class ToolMenuGui {
  /**
   * 主菜单
   */
  static showMainMenu(
    player: Player,
    activeBot: string,
    hasMultipleBots: boolean,
    callback: MenuCallback<MainMenuAction>,
  ): void {
    try {
      logger.info(`[ToolMenuGui] 开始构建主菜单, player=${player?.realName}, activeBot=${activeBot}`);
      const form = mc.newSimpleForm();
      if (!form) {
        logger.error('[ToolMenuGui] mc.newSimpleForm() 返回 null');
        player.sendText('§c无法创建 GUI 表单');
        return;
      }

      form.setTitle('§lAlice Mod 工具测试');

      let content = '§7选择要测试的工具类别\n';
      content += `§f当前目标假人: §a${activeBot}`;
      form.setContent(content);

      if (hasMultipleBots) {
        form.addButton('§7选择目标假人');
      }

      form.addButton(CATEGORY_LABELS.movement);
      form.addButton(CATEGORY_LABELS.inventory);
      form.addButton(CATEGORY_LABELS.survival);
      form.addButton(CATEGORY_LABELS.block);
      form.addButton('§a■ 全部冒烟测试');
      form.addButton('§7☰ 查看测试报告');
      form.addButton('§6⇠ 旧版测试套件');
      form.addButton('§c✕ 关闭');

      logger.info('[ToolMenuGui] 主菜单表单构建完成，准备发送');
      player.sendForm(form, (_pl, id) => {
        if (id == null) return;

        let offset = 0;
        if (hasMultipleBots) {
          if (id === 0) {
            callback({ type: 'selectBot' });
            return;
          }
          offset = 1;
        }

        const index = id - offset;
        switch (index) {
          case 0: callback({ type: 'category', category: 'movement' }); break;
          case 1: callback({ type: 'category', category: 'inventory' }); break;
          case 2: callback({ type: 'category', category: 'survival' }); break;
          case 3: callback({ type: 'category', category: 'block' }); break;
          case 4: callback({ type: 'smoke' }); break;
          case 5: callback({ type: 'report' }); break;
          case 6: callback({ type: 'legacy' }); break;
          default: callback({ type: 'close' }); break;
        }
      });
    } catch (err) {
      logger.error(`[ToolMenuGui] showMainMenu 异常: ${err}`);
      player.sendText(`§c打开主菜单失败: ${err}`);
    }
  }

  /**
   * 分类工具菜单
   */
  static showCategoryMenu(
    player: Player,
    category: string,
    tools: Array<{ name: string; description: string }>,
    onSelect: (toolName: string) => void,
    onBack: () => void,
  ): void {
    const form = mc.newSimpleForm();
    form.setTitle(`§l${CATEGORY_LABELS[category] || category}`);
    form.setContent('§7选择一个工具进行测试');

    for (const tool of tools) {
      form.addButton(`§f${tool.name}\n§7${tool.description}`);
    }
    form.addButton('§7⇠ 返回上级');

    player.sendForm(form, (_pl, id) => {
      if (id == null) return;
      if (id === tools.length) {
        onBack();
        return;
      }
      const selected = tools[id];
      if (selected) {
        onSelect(selected.name);
      }
    });
  }

  /**
   * 假人选择菜单
   */
  static showBotSelector(
    player: Player,
    bots: string[],
    onSelect: (botName: string) => void,
    onBack: () => void,
  ): void {
    const form = mc.newSimpleForm();
    form.setTitle('§l选择目标假人');
    form.setContent('§7选择一个假人作为工具执行目标');

    for (const name of bots) {
      form.addButton(`§a${name}`);
    }
    form.addButton('§7⇠ 返回上级');

    player.sendForm(form, (_pl, id) => {
      if (id == null) return;
      if (id === bots.length) {
        onBack();
        return;
      }
      const selected = bots[id];
      if (selected) {
        onSelect(selected);
      }
    });
  }
}
