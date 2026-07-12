/**
 * ToolRegistry — 工具注册器
 *
 * 负责自动扫描 tools/ 目录下的工具模块，动态加载并注册。
 * 支持按名称、分类查询工具，生成注册消息负载。
 */

import type { IToolModule, ToolMetadata, RegisteredTool, ToolRegistryConfig } from './tool-module.types.js';
// logger 为 LLSE 全局变量，无需导入

export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();
  private config: ToolRegistryConfig;

  constructor(config: ToolRegistryConfig) {
    this.config = config;
  }

  // ── 扫描与注册 ──

  /**
   * 扫描 tools/ 目录下的所有工具模块并注册
   * 目录结构约定：
   *   tools/
   *   ├── movement/         # 工具分类目录
   *   │   ├── move-to/      # 具体工具目录
   *   │   │   └── index.js  # 工具实现（默认导出 IToolModule 实例）
   *   │   └── ride/
   *   ├── inventory/
   *   │   ├── drop-item/
   *   │   ├── equip-item/
   *   │   ├── take-from-container/
   *   │   └── put-to-container/
   *   ├── combat/
   *   ├── block/
   *   ├── interaction/
   *   ├── survival/
   *   ├── perception/
   *   └── chat/
   */
  async scanAndRegister(): Promise<number> {
    const toolsDir = this.config.toolsDir;
    let count = 0;

    if (!File.exists(toolsDir)) {
      logger.warn(`[ToolRegistry] 工具目录不存在: ${toolsDir}`);
      File.mkdir(toolsDir);
      return 0;
    }

    const normalizedToolsDir = toolsDir.endsWith('/') ? toolsDir : `${toolsDir}/`;
    const toolDirs = this.discoverToolDirs(normalizedToolsDir);

    for (const toolDir of toolDirs) {
      const indexPath = `${toolDir}/index.js`;
      if (!File.exists(indexPath)) continue;

      const relativeName = toolDir.replace(normalizedToolsDir, '');
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(indexPath);

        // 支持默认导出或具名导出 IToolModule
        const toolModule: IToolModule | undefined = mod.default || mod;

        if (!toolModule || typeof toolModule.metadata !== 'function' ||
            typeof toolModule.execute !== 'function') {
          logger.warn(`[ToolRegistry] 跳过无效工具模块: ${relativeName}`);
          continue;
        }

        const metadata = toolModule.metadata();
        this.register(metadata.name, metadata, toolModule);
        count++;
        logger.info(`[ToolRegistry] 已注册工具: ${metadata.name} (${relativeName})`);
      } catch (err) {
        logger.error(`[ToolRegistry] 加载工具模块失败: ${relativeName}`, err);
      }
    }

    logger.info(`[ToolRegistry] 扫描完成，共注册 ${count} 个工具`);
    return count;
  }

  /**
   * 发现所有工具目录（支持 tools/{category}/{tool}/index.js 结构）
   */
  private discoverToolDirs(toolsDir: string): string[] {
    const result: string[] = [];
    if (!File.exists(toolsDir) || !File.checkIsDir(toolsDir)) return result;

    const categories = File.getFilesList(toolsDir);
    for (const category of categories) {
      const categoryPath = `${toolsDir}${category}`;
      if (!File.checkIsDir(categoryPath)) continue;

      const tools = File.getFilesList(categoryPath);
      for (const tool of tools) {
        const toolPath = `${categoryPath}/${tool}`;
        if (File.checkIsDir(toolPath)) {
          result.push(toolPath);
        }
      }
    }

    return result;
  }

  /**
   * 注册单个工具
   */
  private register(name: string, metadata: ToolMetadata, module: IToolModule): void {
    this.tools.set(name, {
      name,
      metadata,
      module,
      loadedAt: new Date(),
    });
  }

  /**
   * 手动注册工具（用于测试或直接注册）
   */
  registerTool(name: string, metadata: ToolMetadata, module: IToolModule): void {
    this.register(name, metadata, module);
  }

  // ── 查询 ──

  /**
   * 按名称获取工具
   */
  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有已注册工具
   */
  getAll(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 按分类获取工具
   */
  getByCategory(category: string): RegisteredTool[] {
    return this.getAll().filter((t) => t.metadata.category === category);
  }

  /**
   * 获取所有工具名称列表
   */
  listToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * 获取工具数量
   */
  get count(): number {
    return this.tools.size;
  }

  // ── 序列化 ──

  /**
   * 生成所有工具注册信息的 JSON Schema 列表
   * 用于发送 register_tools 消息给 Agent Core
   */
  generateRegistrationPayload(): ToolMetadata[] {
    return this.getAll().map((t) => t.metadata);
  }
}