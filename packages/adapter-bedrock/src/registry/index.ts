// 工具注册模块占位
// 用于注册和管理所有可用的工具（MCP 风格）

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }
}

export const toolRegistry = new ToolRegistry();
