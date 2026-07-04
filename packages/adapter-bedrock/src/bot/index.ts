// 假人管理占位
// 管理游戏中的 bot 实体

export interface BotInfo {
  id: string;
  name: string;
  connected: boolean;
}

export class BotManager {
  private bots: Map<string, BotInfo> = new Map();

  create(name: string): BotInfo {
    const bot: BotInfo = {
      id: `${name}-${Date.now()}`,
      name,
      connected: false,
    };
    this.bots.set(bot.id, bot);
    return bot;
  }

  get(id: string): BotInfo | undefined {
    return this.bots.get(id);
  }

  getAll(): BotInfo[] {
    return Array.from(this.bots.values());
  }

  remove(id: string): boolean {
    return this.bots.delete(id);
  }
}
