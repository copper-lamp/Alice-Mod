import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../src/main/workspace/tool-registry';
import type { ToolSchema } from '@alice-mod/shared';

const makeTool = (name: string): ToolSchema => ({
  name,
  description: `Tool ${name}`,
  category: 'movement' as const,
  parameters: {},
});

describe('ToolRegistry', () => {
  it('should register tools for a workspace', () => {
    const registry = new ToolRegistry();
    registry.register('ws-1', [makeTool('move_to'), makeTool('dig')]);

    const tools = registry.getTools('ws-1');
    expect(tools).toHaveLength(2);
  });

  it('should return empty array for unknown workspace', () => {
    const registry = new ToolRegistry();
    expect(registry.getTools('unknown')).toEqual([]);
  });

  it('should replace tools on re-register', () => {
    const registry = new ToolRegistry();
    registry.register('ws-1', [makeTool('move_to')]);
    expect(registry.getTools('ws-1')).toHaveLength(1);

    registry.register('ws-1', [makeTool('move_to'), makeTool('dig'), makeTool('attack')]);
    expect(registry.getTools('ws-1')).toHaveLength(3);
  });

  it('should find tool by name', () => {
    const registry = new ToolRegistry();
    registry.register('ws-1', [makeTool('move_to'), makeTool('dig')]);

    const tool = registry.findTool('ws-1', 'dig');
    expect(tool).toBeDefined();
    expect(tool!.name).toBe('dig');
  });

  it('should return undefined for unknown tool name', () => {
    const registry = new ToolRegistry();
    registry.register('ws-1', [makeTool('move_to')]);

    expect(registry.findTool('ws-1', 'non_existent')).toBeUndefined();
  });

  it('should unregister tools for a workspace', () => {
    const registry = new ToolRegistry();
    registry.register('ws-1', [makeTool('move_to')]);
    registry.unregister('ws-1');

    expect(registry.getTools('ws-1')).toEqual([]);
    expect(registry.workspaceCount).toBe(0);
  });

  it('should track workspace count', () => {
    const registry = new ToolRegistry();
    expect(registry.workspaceCount).toBe(0);

    registry.register('ws-1', [makeTool('a')]);
    registry.register('ws-2', [makeTool('b')]);
    expect(registry.workspaceCount).toBe(2);
  });

  it('should return all tool names across workspaces', () => {
    const registry = new ToolRegistry();
    registry.register('ws-1', [makeTool('move_to'), makeTool('dig')]);
    registry.register('ws-2', [makeTool('dig'), makeTool('attack')]);

    const names = registry.getAllToolNames();
    expect(names).toContain('move_to');
    expect(names).toContain('dig');
    expect(names).toContain('attack');
  });

  it('should clear all registrations', () => {
    const registry = new ToolRegistry();
    registry.register('ws-1', [makeTool('a')]);
    registry.register('ws-2', [makeTool('b')]);
    registry.clear();

    expect(registry.workspaceCount).toBe(0);
  });
});
